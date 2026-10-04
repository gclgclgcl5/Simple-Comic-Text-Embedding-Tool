/* IndexedDB 工程持久化：图片、编辑态、字体、会话 */
(function (App) {
  "use strict";

  const DB_NAME = 'image-text-tool';
  const DB_VERSION = 1;
  const SESSION_KEY = 'main';
  /** 轻量落盘（shapes + 当前 raster），不含 undo 历史 */
  const EDIT_DEBOUNCE_MS = 1200;
  /** 撤销历史落盘：闲置约 5s */
  const HISTORY_DEBOUNCE_MS = 5000;
  const WARN_RATIO = 0.8;
  const QUOTA_WARN_SESSION_KEY = 'dsh_quota_warn_shown_v1';
  const FORCE_NOTIFY_COOLDOWN_MS = 2500;

  let db = null;
  let available = false;
  let restoring = false;
  /** 断线后的重连，避免导出/落盘同时各开一次 */
  let reopenPromise = null;
  const editTimers = new Map();
  const historyTimers = new Map();
  /** 同一 imageId 的写盘串行，避免轻量/历史并行互相覆盖 */
  const saveChains = new Map();
  let lastForceNotifyAt = 0;

  function enqueueEditWrite(imageId, fn) {
    const prev = saveChains.get(imageId) || Promise.resolve();
    const next = prev.then(() => fn()).catch(e => {
      if (e && e.name === 'QuotaExceededError') return;
      throw e;
    });
    saveChains.set(imageId, next.then(() => {
      if (saveChains.get(imageId) === next) saveChains.delete(imageId);
    }, () => {
      if (saveChains.get(imageId) === next) saveChains.delete(imageId);
    }));
    return next;
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }

  function toast(msg, ms) {
    if (App.Utils && App.Utils.toast) App.Utils.toast(msg, ms);
  }

  function isConnError(e) {
    if (!e) return false;
    if (e.name === 'InvalidStateError') return true;
    return /database connection is clos/i.test(String(e.message || ''));
  }

  function attachDb(database) {
    db = database;
    available = true;
    database.onerror = e => console.error('IndexedDB error', e);
    database.onversionchange = () => {
      if (db === database) {
        db = null;
        available = false;
      }
      try { database.close(); } catch (err) {}
    };
    database.onclose = () => {
      if (db !== database) return;
      db = null;
      available = false;
      if (!reopenPromise) kickReopen();
    };
  }

  function open() {
    return new Promise(resolve => {
      if (!window.indexedDB) {
        available = false;
        resolve(false);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('edits')) d.createObjectStore('edits', { keyPath: 'imageId' });
        if (!d.objectStoreNames.contains('fonts')) d.createObjectStore('fonts', { keyPath: 'family' });
        if (!d.objectStoreNames.contains('session')) d.createObjectStore('session');
      };
      req.onsuccess = () => {
        attachDb(req.result);
        resolve(true);
      };
      req.onerror = () => {
        available = false;
        resolve(false);
      };
      req.onblocked = () => {
        console.warn('IndexedDB open blocked');
      };
    });
  }

  /** 丢掉正在关闭的连接并重新 open。并发调用共用同一次重连。 */
  function kickReopen() {
    if (reopenPromise) return reopenPromise;
    const dying = db;
    db = null;
    available = false;
    const pending = new Promise(resolve => {
      setTimeout(() => {
        if (dying && dying !== db) {
          try { dying.close(); } catch (err) {}
        }
        open().then(ok => resolve(!!ok), () => resolve(false));
      }, 50);
    });
    reopenPromise = pending;
    pending.finally(() => {
      if (reopenPromise === pending) reopenPromise = null;
    });
    return pending;
  }

  async function withDb(fn) {
    if (!db) {
      const ok = await kickReopen();
      if (!ok || !db) return null;
    }
    try {
      return await fn(db);
    } catch (e) {
      if (!isConnError(e)) throw e;
      const ok = await kickReopen();
      if (!ok || !db) throw e;
      return await fn(db);
    }
  }

  function isAvailable() { return available; }
  function isRestoring() { return restoring; }

  async function put(storeName, value, key) {
    if (restoring) return;
    try {
      await withDb(async database => {
        const tx = database.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (key !== undefined) store.put(value, key);
        else store.put(value);
        await txDone(tx);
      });
    } catch (e) {
      handleWriteError(e);
      if (e && e.name === 'QuotaExceededError') throw e;
    }
  }

  async function del(storeName, key) {
    try {
      await withDb(async database => {
        const tx = database.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        await txDone(tx);
      });
    } catch (e) {
      handleWriteError(e);
    }
  }

  async function getAll(storeName) {
    const rows = await withDb(async database => {
      const store = database.transaction(storeName, 'readonly').objectStore(storeName);
      return reqToPromise(store.getAll());
    });
    return rows || [];
  }

  async function getOne(storeName, key) {
    const row = await withDb(async database => {
      const store = database.transaction(storeName, 'readonly').objectStore(storeName);
      return reqToPromise(store.get(key));
    });
    return row === undefined ? null : row;
  }

  function handleWriteError(e) {
    console.error(e);
    if (e && e.name === 'QuotaExceededError') {
      checkQuotaAndNotify({ force: true }).catch(() => {});
    }
  }

  async function estimateUsage() {
    try {
      if (!navigator.storage || typeof navigator.storage.estimate !== 'function') return null;
      const est = await navigator.storage.estimate();
      const usage = typeof est.usage === 'number' ? est.usage : 0;
      const quota = typeof est.quota === 'number' ? est.quota : 0;
      if (!quota || quota <= 0) return { usage, quota: 0, ratio: null };
      return { usage, quota, ratio: usage / quota };
    } catch (e) {
      console.warn('storage estimate failed', e);
      return null;
    }
  }

  /**
   * @param {{ force?: boolean }} [opts]
   * @returns {Promise<boolean>} 是否已打开占用引导弹窗
   */
  async function checkQuotaAndNotify(opts) {
    const force = !!(opts && opts.force);
    if (force) {
      const now = Date.now();
      if (now - lastForceNotifyAt < FORCE_NOTIFY_COOLDOWN_MS) return false;
      lastForceNotifyAt = now;
    }

    const est = await estimateUsage();
    const overWarn = est && typeof est.ratio === 'number' && est.ratio >= WARN_RATIO;

    if (!force && !overWarn) return false;

    if (!force && overWarn) {
      try {
        if (sessionStorage.getItem(QUOTA_WARN_SESSION_KEY) === '1') return false;
        sessionStorage.setItem(QUOTA_WARN_SESSION_KEY, '1');
      } catch (e) {}
    }

    if (App.UI && typeof App.UI.openStorageQuotaModal === 'function') {
      App.UI.openStorageQuotaModal({
        force,
        usage: est ? est.usage : null,
        quota: est ? est.quota : null,
        ratio: est ? est.ratio : null
      });
      return true;
    }

    if (force) toast('本地存储空间不足，请导出备份后清除缓存', 4000);
    return false;
  }

  function canvasToBlob(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return Promise.resolve(null);
    return new Promise(resolve => {
      try {
        canvas.toBlob(blob => resolve(blob), 'image/png');
      } catch (e) {
        resolve(null);
      }
    });
  }

  /** 整图 getImageData 探测（仅小图或无标志时使用） */
  function canvasHasInkScan(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return false;
    try {
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) return true;
      }
    } catch (e) {}
    return false;
  }

  /**
   * 是否有栅格墨迹。有 img.draw.hasRasterInk 时直接用标志，避免高清整图 getImageData。
   * 无标志时：小图可扫描；大图（>2MP）默认 false，由调用方依赖标志。
   */
  function canvasHasInk(canvas, img) {
    if (!canvas || !canvas.width || !canvas.height) return false;
    if (img && img.draw && typeof img.draw.hasRasterInk === 'boolean') {
      return !!img.draw.hasRasterInk;
    }
    const mp = (canvas.width * canvas.height) / 1e6;
    if (mp > 2) return false;
    return canvasHasInkScan(canvas);
  }

  function rasterNeedsPersist(img) {
    if (!img || !img.draw || !img.draw.rasterCanvas) return false;
    return !!img.draw.hasRasterInk;
  }

  function restoreRaster(canvas, blob) {
    if (!canvas || !blob) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(img.src);
        resolve();
      };
      img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('raster restore failed')); };
      img.src = URL.createObjectURL(blob);
    });
  }

  function loadImageFromBlob(record) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(record.blob);
      const el = new Image();
      el.onload = () => {
        resolve({
          id: record.id,
          name: record.name,
          url,
          imgEl: el,
          w: record.w || el.naturalWidth,
          h: record.h || el.naturalHeight,
          sourceBlob: record.blob,
          texts: [],
          draw: App.Gallery.createDrawState(),
          selected: !!record.selected,
          projectId: record.projectId || null
        });
      };
      el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed: ' + record.name)); };
      el.src = url;
    });
  }

  async function saveImage(record) {
    if (!record || !record.blob) return;
    await put('images', {
      id: record.id,
      name: record.name,
      w: record.w,
      h: record.h,
      selected: !!record.selected,
      projectId: record.projectId || null,
      blob: record.blob
    });
  }

  async function saveImageMeta(img) {
    if (!img || !img.sourceBlob) return;
    await saveImage({
      id: img.id,
      name: img.name,
      w: img.w,
      h: img.h,
      selected: !!img.selected,
      projectId: img.projectId || null,
      blob: img.sourceBlob
    });
  }

  async function deleteImage(id) {
    await del('images', id);
    await del('edits', id);
  }

  async function saveEdit(imageId, payload) {
    if (!imageId || !payload) return;
    await put('edits', { imageId, ...payload });
  }

  function snapshotEdit(img) {
    if (!img) return null;
    const d = img.draw || App.Gallery.createDrawState();
    const prefs = App.State.drawPrefs || {};
    return {
      texts: JSON.parse(JSON.stringify(img.texts || [])),
      shapes: JSON.parse(JSON.stringify(d.shapes || [])),
      draw: {
        tool: prefs.tool || 'brush',
        color: prefs.color || '#ffffff',
        brushSize: prefs.brushSize ?? 12,
        eraserSize: prefs.eraserSize ?? 20,
        selectedShapeId: d.selectedShapeId || null
      }
    };
  }

  /** 轻量落盘：texts/shapes/raster，保留已有 drawHistory，不序列化 undo */
  async function flushSaveEdit(imageId) {
    if (restoring || !imageId) return;
    const img = App.State.getImage(imageId);
    if (!img) return;
    const snap = snapshotEdit(img);
    let rasterBlob = null;
    if (rasterNeedsPersist(img)) {
      rasterBlob = await canvasToBlob(img.draw.rasterCanvas);
    }
    let prevHistory = null;
    try {
      const existing = await getOne('edits', imageId);
      if (existing && existing.drawHistory) prevHistory = existing.drawHistory;
    } catch (e) {}
    const payload = { ...snap, rasterBlob, drawHistory: prevHistory };
    try {
      await saveEdit(imageId, payload);
      checkQuotaAndNotify().catch(() => {});
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        try {
          await saveEdit(imageId, { ...snap, rasterBlob, drawHistory: null });
        } catch (e2) {
          console.error('save edit without history failed', e2);
        }
        return;
      }
      throw e;
    }
  }

  /** 仅更新 drawHistory（合并当前 snap + raster，避免历史先写时缺正文） */
  async function flushSaveDrawHistory(imageId) {
    if (restoring || !imageId) return;
    const img = App.State.getImage(imageId);
    if (!img) return;
    const snap = snapshotEdit(img);
    let rasterBlob = null;
    let existing = null;
    try {
      existing = await getOne('edits', imageId);
    } catch (e) {}
    if (rasterNeedsPersist(img)) {
      rasterBlob = await canvasToBlob(img.draw.rasterCanvas);
    } else if (existing && existing.rasterBlob) {
      rasterBlob = existing.rasterBlob;
    }

    let drawHistory = null;
    if (App.Draw && typeof App.Draw.serializeUndoForDisk === 'function') {
      try {
        const hist = await App.Draw.serializeUndoForDisk(img);
        if (hist && Array.isArray(hist.undo) && hist.undo.length) drawHistory = hist;
      } catch (e) {
        console.warn('serialize draw history failed', e);
      }
    }

    const payload = { ...snap, rasterBlob, drawHistory: drawHistory || null };
    try {
      await saveEdit(imageId, payload);
      checkQuotaAndNotify().catch(() => {});
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        try {
          await saveEdit(imageId, { ...snap, rasterBlob, drawHistory: null });
        } catch (e2) {
          console.error('save draw history quota failed', e2);
        }
        return;
      }
      throw e;
    }
  }

  function scheduleSaveEdit(imageId) {
    if (restoring || !imageId || !window.indexedDB) return;
    if (editTimers.has(imageId)) clearTimeout(editTimers.get(imageId));
    editTimers.set(imageId, setTimeout(() => {
      editTimers.delete(imageId);
      enqueueEditWrite(imageId, () => flushSaveEdit(imageId)).catch(e => {
        if (e && e.name === 'QuotaExceededError') return;
        handleWriteError(e);
      });
    }, EDIT_DEBOUNCE_MS));
  }

  function scheduleSaveDrawHistory(imageId) {
    if (restoring || !imageId || !window.indexedDB) return;
    if (historyTimers.has(imageId)) clearTimeout(historyTimers.get(imageId));
    historyTimers.set(imageId, setTimeout(() => {
      historyTimers.delete(imageId);
      enqueueEditWrite(imageId, () => flushSaveDrawHistory(imageId)).catch(e => {
        if (e && e.name === 'QuotaExceededError') return;
        handleWriteError(e);
      });
    }, HISTORY_DEBOUNCE_MS));
  }

  async function saveFont(family, data, fileName) {
    if (!family || !data) return;
    const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    await put('fonts', { family, fileName: fileName || family, data: buf });
  }

  async function getFont(family) {
    if (!family) return null;
    return getOne('fonts', family);
  }

  async function saveSession() {
    if (restoring) return;
    const State = App.State;
    await put('session', {
      currentId: State.currentId,
      selectedTextId: State.selectedTextId,
      uidSeq: State.uidSeq,
      editMode: State.editMode,
      currentProjectId: State.currentProjectId || null,
      projects: (State.projects || []).map(p => ({
        id: p.id,
        name: p.name,
        selected: !!p.selected
      }))
    }, SESSION_KEY);
  }

  async function clearAll() {
    editTimers.forEach(t => clearTimeout(t));
    editTimers.clear();
    historyTimers.forEach(t => clearTimeout(t));
    historyTimers.clear();
    const names = ['images', 'edits', 'fonts', 'session'];
    await withDb(async database => {
      const tx = database.transaction(names, 'readwrite');
      names.forEach(n => tx.objectStore(n).clear());
      await txDone(tx);
    });
  }

  function normalizeProjects(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seenNames = new Set();
    raw.forEach(p => {
      if (!p || typeof p !== 'object') return;
      if (typeof p.id !== 'string' || !p.id) return;
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      if (!name || seenNames.has(name)) return;
      seenNames.add(name);
      out.push({ id: p.id, name, selected: !!p.selected });
    });
    return out;
  }

  async function restoreSession(opts) {
    const onProgress = (opts && typeof opts.onProgress === 'function') ? opts.onProgress : function () {};
    if (!available || !db) return false;
    restoring = true;
    let skipped = 0;
    try {
      onProgress({ phase: 'read', detail: '正在读取本地工程…' });
      const imageRecords = await getAll('images');
      const session = await getOne('session', SESSION_KEY);
      const projects = normalizeProjects(session && session.projects);

      if (!imageRecords.length && !projects.length) return false;

      const total = imageRecords.length;
      onProgress({ phase: 'fonts', detail: '正在加载字体…', total: total || undefined, current: total ? 0 : undefined });

      const fontRecords = await getAll('fonts');
      for (const f of fontRecords) {
        if (App.Fonts && App.Fonts.loadFontFromStorage) {
          try { await App.Fonts.loadFontFromStorage(f.family, f.data); } catch (e) { console.warn('font restore', f.family, e); }
        }
      }

      const editMap = new Map();
      (await getAll('edits')).forEach(e => editMap.set(e.imageId, e));

      const projectIds = new Set(projects.map(p => p.id));
      const images = [];
      for (let i = 0; i < imageRecords.length; i++) {
        const rec = imageRecords[i];
        onProgress({
          phase: 'image',
          current: i + 1,
          total,
          detail: rec.name || ('第 ' + (i + 1) + ' 张'),
          skipped
        });
        try {
          const img = await loadImageFromBlob(rec);
          if (img.projectId && !projectIds.has(img.projectId)) img.projectId = null;
          const edit = editMap.get(rec.id);
          if (edit) {
            img.texts = JSON.parse(JSON.stringify(edit.texts || []));
            if (edit.draw) {
              img.draw.selectedShapeId = edit.draw.selectedShapeId || null;
            }
            img.draw.shapes = JSON.parse(JSON.stringify(edit.shapes || []));
            if (edit.rasterBlob && App.Draw) {
              const canvas = App.Draw.ensureRaster(img);
              await restoreRaster(canvas, edit.rasterBlob);
              img.draw.hasRasterInk = true;
            }
            if (edit.drawHistory && Array.isArray(edit.drawHistory.undo) && App.Draw && App.Draw.hydrateUndoFromDisk) {
              await App.Draw.hydrateUndoFromDisk(img, edit.drawHistory.undo);
            }
          }
          images.push(img);
        } catch (e) {
          console.warn('skip image', rec.name, e);
          skipped++;
        }
        await new Promise(r => setTimeout(r, 0));
      }

      if (!images.length && !projects.length) return false;

      const State = App.State;
      State.images = images;
      State.projects = projects;
      const savedSelected = session && session.selectedTextId ? session.selectedTextId : null;
      const savedMode = session && session.editMode ? session.editMode : 'text';
      if (session && typeof session.uidSeq === 'number') State.uidSeq = session.uidSeq;
      const savedProjectId = session && session.currentProjectId ? session.currentProjectId : null;
      State.currentProjectId = (savedProjectId && projectIds.has(savedProjectId)) ? savedProjectId : null;
      State.currentId = (session && session.currentId && images.some(i => i.id === session.currentId))
        ? session.currentId
        : (images.length ? images[0].id : null);
      State.selectedTextId = null;

      App.Gallery.renderThumbs();

      if (State.currentId) {
        App.Editor.selectImage(State.currentId);
        if (savedMode === 'draw') State.setEditMode('draw');
        if (savedSelected && State.isTextMode()) {
          const t = State.current().texts.find(x => x.id === savedSelected);
          if (t) App.Editor.selectBox(t);
        }
        if (App.Draw) App.Draw.syncDrawPreview(State.current());
        if (App.DrawToolbar) App.DrawToolbar.syncUIFromDraw(State.current());
        App.Editor.syncPropsUI();
      }

      return skipped ? { restored: true, skipped } : true;
    } finally {
      restoring = false;
    }
  }

  function flushPendingForImage(imageId) {
    if (!imageId || !window.indexedDB) return;
    if (editTimers.has(imageId)) {
      clearTimeout(editTimers.get(imageId));
      editTimers.delete(imageId);
    }
    if (historyTimers.has(imageId)) {
      clearTimeout(historyTimers.get(imageId));
      historyTimers.delete(imageId);
    }
    enqueueEditWrite(imageId, () => flushSaveDrawHistory(imageId)).catch(() => {});
  }

  function flushAllPendingEdits() {
    if (!window.indexedDB) return;
    const ids = new Set([...editTimers.keys(), ...historyTimers.keys()]);
    const cur = App.State && App.State.currentId;
    if (cur) ids.add(cur);
    editTimers.forEach((timer, id) => {
      clearTimeout(timer);
      editTimers.delete(id);
    });
    historyTimers.forEach((timer, id) => {
      clearTimeout(timer);
      historyTimers.delete(id);
    });
    ids.forEach(id => {
      enqueueEditWrite(id, () => flushSaveDrawHistory(id)).catch(() => {});
    });
  }

  function initFlushHooks() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || !window.indexedDB) return;
      flushAllPendingEdits();
      saveSession();
    });
    window.addEventListener('pagehide', () => {
      if (!window.indexedDB) return;
      flushAllPendingEdits();
      saveSession();
    });
  }

  App.Storage = {
    open,
    isAvailable,
    isRestoring,
    saveImage,
    saveImageMeta,
    deleteImage,
    saveEdit,
    scheduleSaveEdit,
    flushSaveEdit,
    scheduleSaveDrawHistory,
    flushSaveDrawHistory,
    flushPendingForImage,
    snapshotEdit,
    saveFont,
    getFont,
    saveSession,
    restoreSession,
    clearAll,
    canvasToBlob,
    canvasHasInk,
    restoreRaster,
    initFlushHooks,
    estimateUsage,
    checkQuotaAndNotify,
    WARN_RATIO
  };
})(window.App = window.App || {});
