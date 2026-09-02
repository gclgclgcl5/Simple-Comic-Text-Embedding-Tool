/* IndexedDB 工程持久化：图片、编辑态、字体、会话 */
(function (App) {
  "use strict";

  const DB_NAME = 'image-text-tool';
  const DB_VERSION = 1;
  const SESSION_KEY = 'main';
  const DEBOUNCE_MS = 400;

  let db = null;
  let available = false;
  let restoring = false;
  const editTimers = new Map();

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
        db = req.result;
        db.onerror = e => console.error('IndexedDB error', e);
        available = true;
        resolve(true);
      };
      req.onerror = () => {
        available = false;
        resolve(false);
      };
    });
  }

  function isAvailable() { return available; }
  function isRestoring() { return restoring; }

  function getStore(name, mode) {
    if (!db) return null;
    return db.transaction(name, mode).objectStore(name);
  }

  async function put(storeName, value, key) {
    if (!available || restoring || !db) return;
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      if (key !== undefined) store.put(value, key);
      else store.put(value);
      await txDone(tx);
    } catch (e) {
      handleWriteError(e);
    }
  }

  async function del(storeName, key) {
    if (!available || !db) return;
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      await txDone(tx);
    } catch (e) {
      handleWriteError(e);
    }
  }

  async function getAll(storeName) {
    if (!db) return [];
    const store = getStore(storeName, 'readonly');
    if (!store) return [];
    return reqToPromise(store.getAll());
  }

  async function getOne(storeName, key) {
    if (!db) return null;
    const store = getStore(storeName, 'readonly');
    if (!store) return null;
    return reqToPromise(store.get(key));
  }

  function handleWriteError(e) {
    console.error(e);
    if (e && e.name === 'QuotaExceededError') toast('本地存储空间不足，请清除缓存或减少图片数量', 4000);
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

  function canvasHasInk(canvas) {
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
          selected: !!record.selected
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
    return {
      texts: JSON.parse(JSON.stringify(img.texts || [])),
      shapes: JSON.parse(JSON.stringify(d.shapes || [])),
      draw: {
        tool: d.tool || 'brush',
        color: d.color || '#ffffff',
        brushSize: d.brushSize ?? 12,
        eraserSize: d.eraserSize ?? 20,
        selectedShapeId: d.selectedShapeId || null
      }
    };
  }

  async function flushSaveEdit(imageId) {
    if (!available || restoring || !imageId) return;
    const img = App.State.getImage(imageId);
    if (!img) return;
    const snap = snapshotEdit(img);
    let rasterBlob = null;
    if (img.draw && img.draw.rasterCanvas && canvasHasInk(img.draw.rasterCanvas)) {
      rasterBlob = await canvasToBlob(img.draw.rasterCanvas);
    }
    await saveEdit(imageId, { ...snap, rasterBlob });
  }

  function scheduleSaveEdit(imageId) {
    if (!available || restoring || !imageId) return;
    if (editTimers.has(imageId)) clearTimeout(editTimers.get(imageId));
    editTimers.set(imageId, setTimeout(() => {
      editTimers.delete(imageId);
      flushSaveEdit(imageId).catch(e => handleWriteError(e));
    }, DEBOUNCE_MS));
  }

  async function saveFont(family, data, fileName) {
    if (!family || !data) return;
    const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    await put('fonts', { family, fileName: fileName || family, data: buf });
  }

  async function saveSession() {
    if (!available || restoring) return;
    const State = App.State;
    await put('session', {
      currentId: State.currentId,
      selectedTextId: State.selectedTextId,
      uidSeq: State.uidSeq,
      editMode: State.editMode
    }, SESSION_KEY);
  }

  async function clearAll() {
    if (!db) return;
    editTimers.forEach(t => clearTimeout(t));
    editTimers.clear();
    const names = ['images', 'edits', 'fonts', 'session'];
    const tx = db.transaction(names, 'readwrite');
    names.forEach(n => tx.objectStore(n).clear());
    await txDone(tx);
  }

  async function restoreSession() {
    if (!available || !db) return false;
    restoring = true;
    try {
      const imageRecords = await getAll('images');
      if (!imageRecords.length) return false;

      const fontRecords = await getAll('fonts');
      for (const f of fontRecords) {
        if (App.Fonts && App.Fonts.loadFontFromStorage) {
          try { await App.Fonts.loadFontFromStorage(f.family, f.data); } catch (e) { console.warn('font restore', f.family, e); }
        }
      }

      const editMap = new Map();
      (await getAll('edits')).forEach(e => editMap.set(e.imageId, e));

      const images = [];
      for (const rec of imageRecords) {
        try {
          const img = await loadImageFromBlob(rec);
          const edit = editMap.get(rec.id);
          if (edit) {
            img.texts = JSON.parse(JSON.stringify(edit.texts || []));
            if (edit.draw) {
              img.draw.tool = edit.draw.tool || 'brush';
              img.draw.color = edit.draw.color || '#ffffff';
              img.draw.brushSize = edit.draw.brushSize ?? 12;
              img.draw.eraserSize = edit.draw.eraserSize ?? 20;
              img.draw.selectedShapeId = edit.draw.selectedShapeId || null;
            }
            img.draw.shapes = JSON.parse(JSON.stringify(edit.shapes || []));
            if (edit.rasterBlob && App.Draw) {
              const canvas = App.Draw.ensureRaster(img);
              await restoreRaster(canvas, edit.rasterBlob);
            }
          }
          images.push(img);
        } catch (e) {
          console.warn('skip image', rec.name, e);
        }
      }

      if (!images.length) return false;

      const session = await getOne('session', SESSION_KEY);
      const State = App.State;
      State.images = images;
      const savedSelected = session && session.selectedTextId ? session.selectedTextId : null;
      const savedMode = session && session.editMode ? session.editMode : 'text';
      if (session && typeof session.uidSeq === 'number') State.uidSeq = session.uidSeq;
      State.currentId = (session && session.currentId && images.some(i => i.id === session.currentId))
        ? session.currentId : images[0].id;
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

      return true;
    } finally {
      restoring = false;
    }
  }

  function initFlushHooks() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || !available) return;
      editTimers.forEach((timer, id) => {
        clearTimeout(timer);
        editTimers.delete(id);
        flushSaveEdit(id);
      });
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
    saveFont,
    saveSession,
    restoreSession,
    clearAll,
    canvasToBlob,
    restoreRaster,
    initFlushHooks
  };
})(window.App = window.App || {});
