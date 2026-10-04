/* 画图：画笔、橡皮、矩形/椭圆、取色、历史 */
(function (App) {
  "use strict";

  const State = App.State;
  const { stage, drawRaster, drawShapeLayer, drawBrushCursor } = App.Dom;
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const MIN_SHAPE = 0.008;
  const HISTORY_MAX = 50;
  /** 落盘 undo 步数（小于内存 HISTORY_MAX） */
  const DISK_UNDO_MAX = 8;
  const FULL_HISTORY_CAP_MP = 8; // 超过约 8MP 时限制 full 快照数量
  const FULL_HISTORY_MAX_HD = 15;

  function persistDraw() {
    const img = State.current();
    if (img && App.Storage && App.Storage.isAvailable()) {
      App.Storage.scheduleSaveEdit(img.id);
      if (App.Storage.scheduleSaveDrawHistory) {
        App.Storage.scheduleSaveDrawHistory(img.id);
      }
    }
  }

  function flushDrawHistoryNow(imageId) {
    if (!App.Storage || !App.Storage.isAvailable()) return;
    const id = imageId || (State.current() && State.current().id);
    if (!id) return;
    if (App.Storage.flushPendingForImage) {
      App.Storage.flushPendingForImage(id);
    } else if (App.Storage.flushSaveDrawHistory) {
      App.Storage.flushSaveDrawHistory(id).catch(() => {});
    } else if (App.Storage.scheduleSaveDrawHistory) {
      App.Storage.scheduleSaveDrawHistory(id);
    }
  }

  let pointer = null;
  let previewShape = null;
  /** @type {{ x0: number, y0: number, x1: number, y1: number } | null} 归一化轴对齐选区 */
  let smartfillPreview = null;
  let lastToolBeforeEyedropper = 'brush';
  /** @type {{ x: number, y: number } | null} 舞台内坐标 */
  let brushCursorPos = null;
  let brushCursorHovering = false;

  /** 笔画备份 canvas（drawImage，避免 pointerdown 整图 getImageData） */
  let strokeBackup = null;
  /** @type {{ x0: number, y0: number, x1: number, y1: number } | null} */
  let strokeDirty = null;
  let previewRaf = 0;
  let previewPendingImg = null;
  let lastSelectedImageId = null;

  function ensureDraw(img) {
    if (!img.draw) img.draw = App.Gallery.createDrawState();
    if (typeof img.draw.hasRasterInk !== 'boolean') img.draw.hasRasterInk = false;
    return img.draw;
  }

  function markRasterInk(img) {
    ensureDraw(img).hasRasterInk = true;
  }

  function drawHasInk(img) {
    if (!img || !img.draw) return false;
    const d = img.draw;
    if (d.hasRasterInk) return true;
    if (d.shapes && d.shapes.length) return true;
    return false;
  }

  function rw(img) {
    return (App.Preview && App.Preview.rasterW) ? App.Preview.rasterW(img) : Math.max(1, (img && img.w) || 1);
  }

  function rh(img) {
    return (App.Preview && App.Preview.rasterH) ? App.Preview.rasterH(img) : Math.max(1, (img && img.h) || 1);
  }

  function ensureRaster(img) {
    const d = ensureDraw(img);
    const tw = rw(img), th = rh(img);
    if (!d.rasterCanvas) {
      d.rasterCanvas = document.createElement('canvas');
      d.rasterCanvas.width = tw;
      d.rasterCanvas.height = th;
    } else if (d.rasterCanvas.width !== tw || d.rasterCanvas.height !== th) {
      const old = d.rasterCanvas;
      d.rasterCanvas = document.createElement('canvas');
      d.rasterCanvas.width = tw;
      d.rasterCanvas.height = th;
      d.rasterCanvas.getContext('2d').drawImage(old, 0, 0, tw, th);
    }
    return d.rasterCanvas;
  }

  function stageToImage(clientX, clientY, img) {
    const tw = rw(img), th = rh(img);
    if (App.Editor && App.Editor.clientToStageNorm) {
      const n = App.Editor.clientToStageNorm(clientX, clientY);
      return {
        x: n.nx * tw,
        y: n.ny * th,
        nx: n.nx,
        ny: n.ny
      };
    }
    const r = stage.getBoundingClientRect();
    return {
      x: (clientX - r.left) / r.width * tw,
      y: (clientY - r.top) / r.height * th,
      nx: (clientX - r.left) / r.width,
      ny: (clientY - r.top) / r.height
    };
  }

  /** 视口 → 舞台布局像素（供命中检测；兼容 CSS scale） */
  function clientToStageLayoutPx(clientX, clientY) {
    if (App.Editor && App.Editor.clientToStageLayout) {
      return App.Editor.clientToStageLayout(clientX, clientY);
    }
    const r = stage.getBoundingClientRect();
    const sw = stage.clientWidth || 1;
    const sh = stage.clientHeight || 1;
    return {
      x: (clientX - r.left) / (r.width || 1) * sw,
      y: (clientY - r.top) / (r.height || 1) * sh
    };
  }

  function scaleFactor(img) { return rw(img) / Math.max(1, stage.clientWidth); }

  function cloneShapes(d) {
    return JSON.parse(JSON.stringify((d && d.shapes) || []));
  }

  function saveSnapshot(img) {
    const d = ensureDraw(img);
    const canvas = d.rasterCanvas;
    let raster = null;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      raster = ctx.getImageData(0, 0, rw(img), rh(img));
    }
    return { kind: 'full', raster, shapes: cloneShapes(d) };
  }

  function ensureStrokeBackup(img) {
    const src = ensureRaster(img);
    const tw = rw(img), th = rh(img);
    if (!strokeBackup || strokeBackup.width !== tw || strokeBackup.height !== th) {
      strokeBackup = document.createElement('canvas');
      strokeBackup.width = tw;
      strokeBackup.height = th;
    }
    strokeBackup.getContext('2d').drawImage(src, 0, 0);
    return strokeBackup;
  }

  function expandStrokeDirty(cx, cy, radius) {
    const pad = Math.ceil(radius) + 2;
    const x0 = Math.floor(cx - pad);
    const y0 = Math.floor(cy - pad);
    const x1 = Math.ceil(cx + pad);
    const y1 = Math.ceil(cy + pad);
    if (!strokeDirty) {
      strokeDirty = { x0, y0, x1, y1 };
      return;
    }
    strokeDirty.x0 = Math.min(strokeDirty.x0, x0);
    strokeDirty.y0 = Math.min(strokeDirty.y0, y0);
    strokeDirty.x1 = Math.max(strokeDirty.x1, x1);
    strokeDirty.y1 = Math.max(strokeDirty.y1, y1);
  }

  function clampDirtyBox(img) {
    if (!strokeDirty) return null;
    const tw = rw(img), th = rh(img);
    const x0 = Math.max(0, Math.min(tw, Math.floor(strokeDirty.x0)));
    const y0 = Math.max(0, Math.min(th, Math.floor(strokeDirty.y0)));
    const x1 = Math.max(0, Math.min(tw, Math.ceil(strokeDirty.x1)));
    const y1 = Math.max(0, Math.min(th, Math.ceil(strokeDirty.y1)));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 1 || h < 1) return null;
    return { x: x0, y: y0, w, h };
  }

  function finishStrokePatch(img, shapesBefore) {
    if (!strokeBackup) {
      strokeDirty = null;
      return null;
    }
    const box = clampDirtyBox(img);
    strokeDirty = null;
    let snap = null;
    if (box) {
      try {
        const raster = strokeBackup.getContext('2d').getImageData(box.x, box.y, box.w, box.h);
        snap = {
          kind: 'patch',
          x: box.x, y: box.y, w: box.w, h: box.h,
          raster,
          shapes: shapesBefore
        };
      } catch (e) {
        console.warn('stroke patch snapshot failed, fallback full', e);
        try {
          const raster = strokeBackup.getContext('2d').getImageData(0, 0, rw(img), rh(img));
          snap = { kind: 'full', raster, shapes: shapesBefore };
        } catch (e2) {
          console.warn('stroke full fallback failed', e2);
          snap = null;
        }
      }
    }
    strokeBackup = null;
    return snap;
  }

  function snapshotPatchRegion(img, x, y, w, h, shapes) {
    const canvas = ensureRaster(img);
    const ctx = canvas.getContext('2d');
    const tw = rw(img), th = rh(img);
    const x0 = Math.max(0, Math.min(tw, Math.floor(x)));
    const y0 = Math.max(0, Math.min(th, Math.floor(y)));
    const x1 = Math.max(0, Math.min(tw, Math.ceil(x + w)));
    const y1 = Math.max(0, Math.min(th, Math.ceil(y + h)));
    const pw = x1 - x0;
    const ph = y1 - y0;
    if (pw < 1 || ph < 1) {
      return { kind: 'patch', x: x0, y: y0, w: 0, h: 0, raster: null, shapes: shapes || cloneShapes(ensureDraw(img)) };
    }
    return {
      kind: 'patch',
      x: x0, y: y0, w: pw, h: ph,
      raster: ctx.getImageData(x0, y0, pw, ph),
      shapes: shapes || cloneShapes(ensureDraw(img))
    };
  }

  function restoreSnapshot(img, snap) {
    const d = ensureDraw(img);
    const canvas = ensureRaster(img);
    const ctx = canvas.getContext('2d');
    if (!snap) {
      ctx.clearRect(0, 0, rw(img), rh(img));
      d.shapes = [];
      d.hasRasterInk = false;
    } else if (snap.kind === 'patch') {
      if (snap.raster && snap.w > 0 && snap.h > 0) {
        ctx.putImageData(snap.raster, snap.x, snap.y);
      }
      d.shapes = JSON.parse(JSON.stringify(snap.shapes || []));
      if (snap.raster) d.hasRasterInk = true;
    } else if (snap.raster) {
      ctx.putImageData(snap.raster, 0, 0);
      d.shapes = JSON.parse(JSON.stringify(snap.shapes || []));
      d.hasRasterInk = true;
    } else {
      ctx.clearRect(0, 0, rw(img), rh(img));
      d.shapes = JSON.parse(JSON.stringify(snap.shapes || []));
      d.hasRasterInk = false;
    }
    syncDrawPreview(img, true);
  }

  function countFullUndos(d) {
    return (d.history.undo || []).filter(s => s && s.kind !== 'patch').length;
  }

  function pushHistory(img, before) {
    if (!before) return;
    const d = ensureDraw(img);
    d.history.undo.push(before);
    d.history.redo = [];
    while (d.history.undo.length > HISTORY_MAX) d.history.undo.shift();
    const mp = (rw(img) * rh(img)) / 1e6;
    if (mp > FULL_HISTORY_CAP_MP) {
      while (countFullUndos(d) > FULL_HISTORY_MAX_HD) {
        const idx = d.history.undo.findIndex(s => s && s.kind !== 'patch');
        if (idx < 0) break;
        d.history.undo.splice(idx, 1);
      }
    }
    App.DrawToolbar.updateHistoryButtons();
  }

  async function imageDataToBlob(imageData, opts) {
    if (!imageData || !imageData.width || !imageData.height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    if (!(opts && opts.skipInkCheck)) {
      if (App.Storage && App.Storage.canvasHasInk && !App.Storage.canvasHasInk(canvas)) return null;
    }
    if (!App.Storage || !App.Storage.canvasToBlob) return null;
    return App.Storage.canvasToBlob(canvas);
  }

  async function blobToImageData(blob, w, h) {
    if (!blob || !w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    if (App.Storage && App.Storage.restoreRaster) {
      await App.Storage.restoreRaster(canvas, blob);
    } else {
      await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => {
          canvas.getContext('2d').drawImage(im, 0, 0, w, h);
          URL.revokeObjectURL(im.src);
          resolve();
        };
        im.onerror = () => { URL.revokeObjectURL(im.src); reject(new Error('blobToImageData failed')); };
        im.src = URL.createObjectURL(blob);
      });
    }
    return canvas.getContext('2d').getImageData(0, 0, w, h);
  }

  /**
   * 将内存 undo 尾部序列化为可写入 IndexedDB 的结构（不含 redo）。
   * patch 项带 patch:{x,y,w,h}；旧 full 无 patch 字段。
   */
  async function serializeUndoForDisk(img) {
    const d = ensureDraw(img);
    const undo = (d.history && d.history.undo) ? d.history.undo : [];
    const slice = undo.slice(Math.max(0, undo.length - DISK_UNDO_MAX));
    const out = [];
    for (let i = 0; i < slice.length; i++) {
      const snap = slice[i] || {};
      const shapes = JSON.parse(JSON.stringify(snap.shapes || []));
      let rasterBlob = null;
      let patch = null;
      if (snap.raster) {
        try {
          // undo 快照本身即墨迹来源，跳过整图/大图 ink 扫描
          rasterBlob = await imageDataToBlob(snap.raster, { skipInkCheck: true });
        } catch (e) {
          console.warn('serialize draw undo raster', e);
          rasterBlob = null;
        }
      }
      if (snap.kind === 'patch') {
        patch = { x: snap.x|0, y: snap.y|0, w: snap.w|0, h: snap.h|0 };
      }
      out.push({ shapes, rasterBlob, patch });
      await new Promise(r => setTimeout(r, 0));
    }
    return { undo: out };
  }

  async function hydrateUndoFromDisk(img, entries, opts) {
    const d = ensureDraw(img);
    d.history.redo = [];
    d.history.undo = [];
    if (!Array.isArray(entries) || !entries.length) {
      if (App.DrawToolbar && App.DrawToolbar.updateHistoryButtons) App.DrawToolbar.updateHistoryButtons();
      return;
    }
    const destW = rw(img), destH = rh(img);
    const srcW = (opts && opts.sourceW) || destW;
    const srcH = (opts && opts.sourceH) || destH;
    const sx = destW / Math.max(1, srcW);
    const sy = destH / Math.max(1, srcH);
    const needScale = Math.abs(sx - 1) > 0.002 || Math.abs(sy - 1) > 0.002;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] || {};
      const shapes = JSON.parse(JSON.stringify(entry.shapes || []));
      const p = entry.patch;
      if (p && typeof p.w === 'number' && typeof p.h === 'number' && p.w > 0 && p.h > 0 && entry.rasterBlob) {
        let x = p.x | 0, y = p.y | 0, w = p.w | 0, h = p.h | 0;
        if (needScale) {
          x = Math.round(x * sx);
          y = Math.round(y * sy);
          w = Math.max(1, Math.round(w * sx));
          h = Math.max(1, Math.round(h * sy));
        }
        let raster = null;
        try {
          raster = await blobToImageData(entry.rasterBlob, w, h);
        } catch (e) {
          console.warn('hydrate draw undo patch', e);
        }
        d.history.undo.push({
          kind: 'patch',
          x, y, w, h,
          raster,
          shapes
        });
      } else {
        let raster = null;
        if (entry.rasterBlob) {
          try {
            raster = await blobToImageData(entry.rasterBlob, destW, destH);
          } catch (e) {
            console.warn('hydrate draw undo raster', e);
          }
        }
        d.history.undo.push({ kind: 'full', raster, shapes });
      }
    }
    if (App.DrawToolbar && App.DrawToolbar.updateHistoryButtons) App.DrawToolbar.updateHistoryButtons();
  }

  function undo(img) {
    const d = ensureDraw(img);
    if (!d.history.undo.length) return;
    const prev = d.history.undo[d.history.undo.length - 1];
    let cur;
    if (prev && prev.kind === 'patch' && prev.w > 0 && prev.h > 0) {
      cur = snapshotPatchRegion(img, prev.x, prev.y, prev.w, prev.h, d.shapes);
    } else {
      cur = saveSnapshot(img);
    }
    d.history.undo.pop();
    d.history.redo.push(cur);
    restoreSnapshot(img, prev);
    App.DrawToolbar.updateHistoryButtons();
    App.DrawToolbar.updateDeleteButton();
    persistDraw();
  }

  function redo(img) {
    const d = ensureDraw(img);
    if (!d.history.redo.length) return;
    const next = d.history.redo[d.history.redo.length - 1];
    let cur;
    if (next && next.kind === 'patch' && next.w > 0 && next.h > 0) {
      cur = snapshotPatchRegion(img, next.x, next.y, next.w, next.h, d.shapes);
    } else {
      cur = saveSnapshot(img);
    }
    d.history.redo.pop();
    d.history.undo.push(cur);
    restoreSnapshot(img, next);
    App.DrawToolbar.updateHistoryButtons();
    App.DrawToolbar.updateDeleteButton();
    persistDraw();
  }

  function bakeShapeToRaster(ctx, shape, img, width, height) {
    const bw = width || rw(img);
    const bh = height || rh(img);
    const cx = shape.x * bw, cy = shape.y * bh;
    const hw = shape.w * bw, hh = shape.h * bh;
    ctx.fillStyle = shape.color;
    if (shape.type === 'rect') {
      ctx.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
    } else {
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(1, hw), Math.max(1, hh), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function bakeAllShapesToRaster(img) {
    const d = ensureDraw(img);
    if (!d.shapes.length) return;
    const ctx = ensureRaster(img).getContext('2d');
    d.shapes.forEach(s => bakeShapeToRaster(ctx, s, img));
    d.shapes = [];
    markRasterInk(img);
  }

  function bakeIntersectingShapes(img, ix, iy, radius) {
    const d = ensureDraw(img);
    const ctx = ensureRaster(img).getContext('2d');
    const remaining = [];
    let baked = false;
    for (const s of d.shapes) {
      if (shapeIntersectsCircle(s, img, ix, iy, radius)) {
        bakeShapeToRaster(ctx, s, img);
        baked = true;
      } else {
        remaining.push(s);
      }
    }
    d.shapes = remaining;
    if (baked) markRasterInk(img);
  }

  function shapeIntersectsCircle(s, img, ix, iy, radius) {
    const tw = rw(img), th = rh(img);
    const l = (s.x - s.w) * tw, r = (s.x + s.w) * tw;
    const t = (s.y - s.h) * th, b = (s.y + s.h) * th;
    const cx = Math.max(l, Math.min(ix, r));
    const cy = Math.max(t, Math.min(iy, b));
    const dx = ix - cx, dy = iy - cy;
    if (dx * dx + dy * dy <= radius * radius) return true;
    if (s.type === 'rect') return true;
    const nx = (ix / tw - s.x) / Math.max(s.w, 0.001);
    const ny = (iy / th - s.y) / Math.max(s.h, 0.001);
    if (nx * nx + ny * ny <= 1) return true;
    return false;
  }

  function getShape(img, id) { return ensureDraw(img).shapes.find(s => s.id === id); }

  function getSelectedShape(img) {
    img = img || State.current();
    if (!img || !img.draw || !img.draw.selectedShapeId) return null;
    return getShape(img, img.draw.selectedShapeId) || null;
  }

  function removeSelectedShape() {
    const img = State.current();
    if (!img) return false;
    const d = ensureDraw(img);
    const id = d.selectedShapeId;
    if (!id || !getShape(img, id)) return false;
    const before = saveSnapshot(img);
    d.shapes = d.shapes.filter(s => s.id !== id);
    d.selectedShapeId = null;
    pushHistory(img, before);
    syncDrawPreview(img);
    persistDraw();
    if (App.DrawToolbar) App.DrawToolbar.updateDeleteButton();
    return true;
  }

  function insertShapeFromPreset(preset) {
    const img = State.current();
    if (!img || !preset) return false;
    const before = saveSnapshot(img);
    const shape = {
      id: State.uid(),
      type: preset.type,
      x: 0.5, y: 0.5,
      w: preset.w, h: preset.h,
      color: preset.color
    };
    ensureDraw(img).shapes.push(shape);
    pushHistory(img, before);
    selectShape(shape.id);
    if (App.DrawToolbar) App.DrawToolbar.setTool(preset.type);
    syncDrawPreview(img);
    persistDraw();
    return true;
  }

  function shapeBounds(s) {
    return { l: s.x - s.w, t: s.y - s.h, r: s.x + s.w, b: s.y + s.h };
  }

  function shapeFromBounds(l, t, r, b) {
    return { x: (l + r) / 2, y: (t + b) / 2, w: (r - l) / 2, h: (b - t) / 2 };
  }

  function hitTestShape(img, nx, ny) {
    const d = ensureDraw(img);
    for (let i = d.shapes.length - 1; i >= 0; i--) {
      const s = d.shapes[i];
      const dx = (nx - s.x) / Math.max(s.w, 0.0001);
      const dy = (ny - s.y) / Math.max(s.h, 0.0001);
      if (s.type === 'rect') {
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return s;
      } else if (dx * dx + dy * dy <= 1) return s;
    }
    return null;
  }

  function hitTestHandle(s, sw, sh, px, py) {
    const pad = 8;
    const pts = handlePositions(s, sw, sh);
    for (const h of HANDLES) {
      const p = pts[h];
      if (Math.abs(px - p.x) <= pad && Math.abs(py - p.y) <= pad) return h;
    }
    return null;
  }

  function handlePositions(s, sw, sh) {
    const l = (s.x - s.w) * sw, r = (s.x + s.w) * sw;
    const t = (s.y - s.h) * sh, b = (s.y + s.h) * sh;
    const mx = (l + r) / 2, my = (t + b) / 2;
    return { nw: { x: l, y: t }, n: { x: mx, y: t }, ne: { x: r, y: t }, e: { x: r, y: my }, se: { x: r, y: b }, s: { x: mx, y: b }, sw: { x: l, y: b }, w: { x: l, y: my } };
  }

  function applyHandleDrag(shape, handle, nx, ny, startBounds) {
    let { l, t, r, b } = { ...startBounds };
    const min = MIN_SHAPE;
    if (handle.includes('w')) l = Math.min(nx, r - min);
    if (handle.includes('e')) r = Math.max(nx, l + min);
    if (handle.includes('n')) t = Math.min(ny, b - min);
    if (handle.includes('s')) b = Math.max(ny, t + min);
    const ns = shapeFromBounds(l, t, r, b);
    shape.x = ns.x; shape.y = ns.y; shape.w = ns.w; shape.h = ns.h;
  }

  function deselectShape() {
    const img = State.current();
    if (img) ensureDraw(img).selectedShapeId = null;
    previewShape = null;
    smartfillPreview = null;
    if (img) syncDrawPreview(img);
    if (App.DrawToolbar) App.DrawToolbar.updateDeleteButton();
  }

  function selectShape(id) {
    const img = State.current();
    if (!img) return;
    ensureDraw(img).selectedShapeId = id;
    const s = getShape(img, id);
    if (s) App.DrawToolbar.syncColorFromShape(s);
    syncDrawPreview(img);
    if (App.DrawToolbar) App.DrawToolbar.updateDeleteButton();
  }

  function syncDrawPreview(img, immediate) {
    if (!img) return;
    if (immediate) {
      if (previewRaf) {
        cancelAnimationFrame(previewRaf);
        previewRaf = 0;
      }
      previewPendingImg = null;
      doSyncDrawPreview(img);
      return;
    }
    previewPendingImg = img;
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0;
      const next = previewPendingImg;
      previewPendingImg = null;
      if (next) doSyncDrawPreview(next);
    });
  }

  function doSyncDrawPreview(img) {
    if (!img) return;
    const d = ensureDraw(img);
    const sw = stage.clientWidth, sh = stage.clientHeight;
    drawRaster.width = sw;
    drawRaster.height = sh;
    const ctx = drawRaster.getContext('2d');
    ctx.clearRect(0, 0, sw, sh);
    if (d.rasterCanvas) ctx.drawImage(d.rasterCanvas, 0, 0, sw, sh);

    drawShapeLayer.innerHTML = '';
    const shapes = [...d.shapes];
    if (previewShape) shapes.push(previewShape);
    shapes.forEach(s => {
      const el = document.createElement('div');
      el.className = 'draw-shape' + (s.type === 'ellipse' ? ' ellipse' : ' rect');
      el.style.left = ((s.x - s.w) * sw) + 'px';
      el.style.top = ((s.y - s.h) * sh) + 'px';
      el.style.width = (s.w * 2 * sw) + 'px';
      el.style.height = (s.h * 2 * sh) + 'px';
      el.style.background = s.color;
      if (s.id && s.id === d.selectedShapeId) {
        el.classList.add('selected');
        const box = document.createElement('div');
        box.className = 'shape-select-box';
        const pts = handlePositions(s, sw, sh);
        HANDLES.forEach(h => {
          const hd = document.createElement('div');
          hd.className = 'shape-handle';
          hd.dataset.handle = h;
          hd.style.left = (pts[h].x - (s.x - s.w) * sw) + 'px';
          hd.style.top = (pts[h].y - (s.y - s.h) * sh) + 'px';
          box.appendChild(hd);
        });
        el.appendChild(box);
      }
      drawShapeLayer.appendChild(el);
    });
    if (smartfillPreview) {
      const { x0, y0, x1, y1 } = smartfillPreview;
      const l = Math.min(x0, x1), t = Math.min(y0, y1);
      const r = Math.max(x0, x1), b = Math.max(y0, y1);
      const el = document.createElement('div');
      el.className = 'draw-smartfill-preview' + (smartfillPreview.bubble ? ' bubble' : '');
      el.style.left = (l * sw) + 'px';
      el.style.top = (t * sh) + 'px';
      el.style.width = ((r - l) * sw) + 'px';
      el.style.height = ((b - t) * sh) + 'px';
      drawShapeLayer.appendChild(el);
    }
    updatePointerEvents();
  }

  function updatePointerEvents() {
    const drawMode = State.isDrawMode();
    stage.classList.toggle('mode-draw', drawMode);
    drawRaster.style.pointerEvents = drawMode ? 'auto' : 'none';
    drawShapeLayer.style.pointerEvents = drawMode ? 'auto' : 'none';
    updateCursor();
  }

  function isBrushCursorTool(tool) {
    return tool === 'brush' || tool === 'eraser';
  }

  function hideBrushCursorEl() {
    if (drawBrushCursor) drawBrushCursor.hidden = true;
  }

  function updateBrushCursor() {
    if (!drawBrushCursor) return;
    const pan = App.Editor && App.Editor.isPanMode && App.Editor.isPanMode();
    const tool = State.drawPrefs.tool;
    const show = State.isDrawMode()
      && !pan
      && isBrushCursorTool(tool)
      && brushCursorHovering
      && brushCursorPos
      && State.current();

    if (!show) {
      hideBrushCursorEl();
      return;
    }

    const prefs = State.drawPrefs;
    const size = Math.max(1, tool === 'eraser' ? prefs.eraserSize : prefs.brushSize);
    drawBrushCursor.hidden = false;
    drawBrushCursor.classList.toggle('eraser', tool === 'eraser');
    drawBrushCursor.style.width = size + 'px';
    drawBrushCursor.style.height = size + 'px';
    drawBrushCursor.style.left = brushCursorPos.x + 'px';
    drawBrushCursor.style.top = brushCursorPos.y + 'px';
  }

  function refreshBrushCursorSize() {
    updateBrushCursor();
  }

  function trackBrushCursor(e) {
    if (!State.isDrawMode() || !isBrushCursorTool(State.drawPrefs.tool)) {
      if (brushCursorHovering) {
        brushCursorHovering = false;
        updateCursor();
      }
      return;
    }
    if (App.Editor && App.Editor.isPanMode && App.Editor.isPanMode()) {
      if (brushCursorHovering) {
        brushCursorHovering = false;
        updateCursor();
      }
      return;
    }
    const r = stage.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right
      && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) {
      if (brushCursorHovering) {
        brushCursorHovering = false;
        updateCursor();
      }
      return;
    }
    brushCursorHovering = true;
    const layout = clientToStageLayoutPx(e.clientX, e.clientY);
    brushCursorPos = { x: layout.x, y: layout.y };
    updateCursor();
  }

  function onBrushCursorLeave() {
    if (!brushCursorHovering) return;
    brushCursorHovering = false;
    updateCursor();
  }

  function updateCursor() {
    if (App.Editor && App.Editor.isPanMode && App.Editor.isPanMode()) {
      stage.style.cursor = '';
      hideBrushCursorEl();
      return;
    }
    if (!State.isDrawMode()) {
      stage.style.cursor = '';
      hideBrushCursorEl();
      return;
    }
    const img = State.current();
    if (!img) {
      hideBrushCursorEl();
      return;
    }
    const tool = State.drawPrefs.tool;
    if (isBrushCursorTool(tool) && brushCursorHovering && brushCursorPos) {
      stage.style.cursor = 'none';
      updateBrushCursor();
      return;
    }
    hideBrushCursorEl();
    const cursors = {
      brush: 'crosshair', eraser: 'crosshair', rect: 'crosshair', ellipse: 'crosshair',
      eyedropper: 'crosshair', smartfill: 'crosshair', 'smartfill-bubble': 'crosshair'
    };
    stage.style.cursor = cursors[tool] || 'default';
  }

  function isSmartFillTool(tool) {
    return tool === 'smartfill' || tool === 'smartfill-bubble';
  }

  /**
   * 在 ROI 内智能遮盖。mode: 'rect' | 'bubble'
   * @param {{ x0: number, y0: number, x1: number, y1: number }} norm 归一化选区
   */
  function applySmartFill(img, norm, mode) {
    if (!App.SmartFill) return false;
    const tw = rw(img), th = rh(img);
    const x0 = Math.floor(Math.min(norm.x0, norm.x1) * tw);
    const y0 = Math.floor(Math.min(norm.y0, norm.y1) * th);
    const x1 = Math.ceil(Math.max(norm.x0, norm.x1) * tw);
    const y1 = Math.ceil(Math.max(norm.y0, norm.y1) * th);
    const rx = Math.max(0, x0);
    const ry = Math.max(0, y0);
    const rx1 = Math.min(tw, x1);
    const ry1 = Math.min(th, y1);
    const roiW = rx1 - rx;
    const roiH = ry1 - ry;
    if (roiW < 4 || roiH < 4) return false;

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    const base = (App.Preview && App.Preview.previewSource) ? App.Preview.previewSource(img) : img.imgEl;
    if (base) ctx.drawImage(base, 0, 0, tw, th);
    const d = ensureDraw(img);
    if (d.rasterCanvas) ctx.drawImage(d.rasterCanvas, 0, 0, tw, th);
    d.shapes.forEach(s => bakeShapeToRaster(ctx, s, img, tw, th));

    let imageData;
    try {
      imageData = ctx.getImageData(rx, ry, roiW, roiH);
    } catch (e) {
      console.error('smartfill getImageData', e);
      if (App.Utils && App.Utils.toast) App.Utils.toast('无法读取选区像素');
      return false;
    }

    const rctx = ensureRaster(img).getContext('2d');

    if (mode === 'bubble') {
      const bubble = App.SmartFill.detectBubbleMask(imageData, roiW, roiH);
      if (!bubble) {
        if (App.Utils && App.Utils.toast) {
          App.Utils.toast('未能识别气泡内部，可改用矩形智能遮盖或手涂');
        }
        return false;
      }
      const color = App.SmartFill.sampleMaskColor(
        imageData, roiW, roiH, bubble.mask, bubble.threshold
      );
      const patch = rctx.getImageData(rx, ry, roiW, roiH);
      App.SmartFill.paintMaskIntoImageData(patch, bubble.mask, color);
      rctx.putImageData(patch, rx, ry);
      markRasterInk(img);
      return true;
    }

    const cover = App.SmartFill.detectCoverRect(imageData, roiW, roiH);
    if (!cover) {
      if (App.Utils && App.Utils.toast) App.Utils.toast('未检测到文字，可改用手涂或矩形');
      return false;
    }

    const color = App.SmartFill.sampleRingColor(imageData, roiW, roiH, cover, cover.threshold);
    rctx.fillStyle = color;
    rctx.fillRect(rx + cover.x, ry + cover.y, cover.w, cover.h);
    markRasterInk(img);
    return true;
  }

  function initDrawLayers() {
    updatePointerEvents();
  }

  function onImageSelected(img) {
    if (lastSelectedImageId && lastSelectedImageId !== (img && img.id)) {
      flushDrawHistoryNow(lastSelectedImageId);
    }
    lastSelectedImageId = img ? img.id : null;
    if (!img) return;
    ensureDraw(img);
    deselectShape();
    syncDrawPreview(img, true);
    App.DrawToolbar.updateHistoryButtons();
    App.DrawToolbar.syncUIFromPrefs(img);
  }

  function onStageResize() {
    const img = State.current();
    if (img) syncDrawPreview(img, true);
  }

  function onModeChange() {
    if (State.isTextMode()) {
      deselectShape();
      const img = State.current();
      if (img) flushDrawHistoryNow(img.id);
    }
    updatePointerEvents();
    const img = State.current();
    if (img) syncDrawPreview(img, true);
  }

  function drawBrushDot(ctx, x, y, size, erase) {
    ctx.save();
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = State.drawPrefs.color;
    }
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBrushLine(ctx, x0, y0, x1, y1, size, erase) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(1, size / 4);
    for (let i = 0; i <= dist; i += step) {
      const t = dist ? i / dist : 0;
      drawBrushDot(ctx, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, size, erase);
    }
  }

  function onPointerDown(e) {
    trackBrushCursor(e);
    if (App.Editor && App.Editor.isPanMode && App.Editor.isPanMode()) return;
    if (!State.isDrawMode() || e.button !== 0) return;
    const img = State.current();
    if (!img || e.target.closest('#drawProps')) return;
    const d = ensureDraw(img);
    const prefs = State.drawPrefs;
    const tool = prefs.tool;
    const p = stageToImage(e.clientX, e.clientY, img);
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const layoutPt = clientToStageLayoutPx(e.clientX, e.clientY);
    const stageX = layoutPt.x;
    const stageY = layoutPt.y;

    if (tool === 'eyedropper') {
      e.preventDefault();
      pickColorAt(img, p.x, p.y);
      return;
    }

    if (isSmartFillTool(tool)) {
      e.preventDefault();
      deselectShape();
      smartfillPreview = { x0: p.nx, y0: p.ny, x1: p.nx, y1: p.ny, bubble: tool === 'smartfill-bubble' };
      pointer = {
        type: 'smartfill',
        mode: tool === 'smartfill-bubble' ? 'bubble' : 'rect',
        startNX: p.nx, startNY: p.ny,
        before: saveSnapshot(img)
      };
      syncDrawPreview(img);
      return;
    }

    if (tool === 'brush' || tool === 'eraser') {
      e.preventDefault();
      const shapesBefore = cloneShapes(d);
      ensureStrokeBackup(img);
      strokeDirty = null;
      pointer = { type: tool, shapesBefore, lastX: p.x, lastY: p.y };
      const ctx = ensureRaster(img).getContext('2d');
      const size = (tool === 'eraser' ? prefs.eraserSize : prefs.brushSize) * scaleFactor(img);
      expandStrokeDirty(p.x, p.y, size / 2);
      if (tool === 'eraser') bakeIntersectingShapes(img, p.x, p.y, size / 2);
      drawBrushDot(ctx, p.x, p.y, size, tool === 'eraser');
      markRasterInk(img);
      syncDrawPreview(img);
      return;
    }

    if (tool === 'rect' || tool === 'ellipse') {
      const sel = d.selectedShapeId ? getShape(img, d.selectedShapeId) : null;
      if (sel) {
        const handle = hitTestHandle(sel, sw, sh, stageX, stageY);
        if (handle) {
          e.preventDefault();
          pointer = { type: 'resize', shapeId: sel.id, handle, startBounds: shapeBounds(sel), shapeStart: { ...sel }, before: saveSnapshot(img) };
          return;
        }
        const hit = hitTestShape(img, p.nx, p.ny);
        if (hit && hit.id === sel.id) {
          e.preventDefault();
          pointer = { type: 'move', shapeId: sel.id, startNX: p.nx, startNY: p.ny, shapeStart: { ...sel }, before: saveSnapshot(img) };
          return;
        }
      }
      const hit = hitTestShape(img, p.nx, p.ny);
      if (hit) {
        e.preventDefault();
        selectShape(hit.id);
        pointer = { type: 'move', shapeId: hit.id, startNX: p.nx, startNY: p.ny, shapeStart: { ...hit }, before: saveSnapshot(img) };
        return;
      }
      deselectShape();
      e.preventDefault();
      pointer = { type: 'create', shapeType: tool, startNX: p.nx, startNY: p.ny, before: saveSnapshot(img) };
      previewShape = { type: tool, x: p.nx, y: p.ny, w: 0, h: 0, color: prefs.color };
      syncDrawPreview(img);
    }
  }

  function onPointerMove(e) {
    trackBrushCursor(e);
    if (!pointer || !State.isDrawMode()) return;
    const img = State.current();
    if (!img) return;
    const d = ensureDraw(img);
    const p = stageToImage(e.clientX, e.clientY, img);

    if (pointer.type === 'brush' || pointer.type === 'eraser') {
      const ctx = ensureRaster(img).getContext('2d');
      const prefs = State.drawPrefs;
      const size = (pointer.type === 'eraser' ? prefs.eraserSize : prefs.brushSize) * scaleFactor(img);
      expandStrokeDirty(p.x, p.y, size / 2);
      expandStrokeDirty(pointer.lastX, pointer.lastY, size / 2);
      if (pointer.type === 'eraser') bakeIntersectingShapes(img, p.x, p.y, size / 2);
      drawBrushLine(ctx, pointer.lastX, pointer.lastY, p.x, p.y, size, pointer.type === 'eraser');
      pointer.lastX = p.x;
      pointer.lastY = p.y;
      markRasterInk(img);
      syncDrawPreview(img);
      return;
    }

    if (pointer.type === 'smartfill') {
      smartfillPreview = {
        x0: pointer.startNX, y0: pointer.startNY,
        x1: p.nx, y1: p.ny,
        bubble: pointer.mode === 'bubble'
      };
      syncDrawPreview(img);
      return;
    }

    if (pointer.type === 'create') {
      const l = Math.min(pointer.startNX, p.nx);
      const t = Math.min(pointer.startNY, p.ny);
      const r = Math.max(pointer.startNX, p.nx);
      const b = Math.max(pointer.startNY, p.ny);
      const ns = shapeFromBounds(l, t, r, b);
      previewShape = { type: pointer.shapeType, ...ns, color: State.drawPrefs.color };
      syncDrawPreview(img);
      return;
    }

    if (pointer.type === 'move') {
      const s = getShape(img, pointer.shapeId);
      if (!s) return;
      const dx = p.nx - pointer.startNX, dy = p.ny - pointer.startNY;
      s.x = pointer.shapeStart.x + dx;
      s.y = pointer.shapeStart.y + dy;
      syncDrawPreview(img);
      return;
    }

    if (pointer.type === 'resize') {
      const s = getShape(img, pointer.shapeId);
      if (!s) return;
      s.x = pointer.shapeStart.x;
      s.y = pointer.shapeStart.y;
      s.w = pointer.shapeStart.w;
      s.h = pointer.shapeStart.h;
      applyHandleDrag(s, pointer.handle, p.nx, p.ny, pointer.startBounds);
      syncDrawPreview(img);
    }
  }

  function onPointerUp() {
    if (!pointer) return;
    const img = State.current();
    if (!img) { pointer = null; return; }
    const d = ensureDraw(img);

    if (pointer.type === 'brush' || pointer.type === 'eraser') {
      const before = finishStrokePatch(img, pointer.shapesBefore);
      if (before) pushHistory(img, before);
      syncDrawPreview(img, true);
      pointer = null;
      persistDraw();
      return;
    }

    if (pointer.type === 'smartfill') {
      const norm = smartfillPreview || {
        x0: pointer.startNX, y0: pointer.startNY,
        x1: pointer.startNX, y1: pointer.startNY
      };
      smartfillPreview = null;
      const nw = Math.abs(norm.x1 - norm.x0);
      const nh = Math.abs(norm.y1 - norm.y0);
      let applied = false;
      if (nw >= MIN_SHAPE / 2 && nh >= MIN_SHAPE / 2) {
        applied = applySmartFill(img, norm, pointer.mode || 'rect');
      }
      if (applied && pointer.before) pushHistory(img, pointer.before);
      syncDrawPreview(img, true);
      pointer = null;
      if (applied) persistDraw();
      return;
    }

    if (pointer.type === 'create' && previewShape) {
      if (previewShape.w >= MIN_SHAPE / 2 && previewShape.h >= MIN_SHAPE / 2) {
        const shape = {
          id: State.uid(),
          type: previewShape.type,
          x: previewShape.x, y: previewShape.y,
          w: previewShape.w, h: previewShape.h,
          color: previewShape.color
        };
        d.shapes.push(shape);
        d.selectedShapeId = shape.id;
        if (pointer.before) pushHistory(img, pointer.before);
      }
      previewShape = null;
      syncDrawPreview(img, true);
      pointer = null;
      persistDraw();
      return;
    }

    if (pointer.type === 'move' || pointer.type === 'resize') {
      const s = getShape(img, pointer.shapeId);
      const changed = s && (s.x !== pointer.shapeStart.x || s.y !== pointer.shapeStart.y || s.w !== pointer.shapeStart.w || s.h !== pointer.shapeStart.h);
      if (changed && pointer.before) pushHistory(img, pointer.before);
      pointer = null;
      syncDrawPreview(img, true);
      if (changed) persistDraw();
      return;
    }
    pointer = null;
  }

  async function pickColorAt(img, ix, iy) {
    const ox = (ix / rw(img)) * img.w;
    const oy = (iy / rh(img)) * img.h;
    const hex = await App.Export.sampleColorAt(img, ox, oy);
    State.setDrawPrefsPartial({ color: hex });
    App.DrawToolbar.syncColorUI(hex);
    if (State.drawPrefs.tool === 'eyedropper') setTool(lastToolBeforeEyedropper);
  }

  function setTool(tool) {
    const prefs = State.drawPrefs;
    if (tool === 'eyedropper' && prefs.tool !== 'eyedropper') lastToolBeforeEyedropper = prefs.tool;
    State.setDrawPrefsPartial({ tool });
    if (tool !== 'rect' && tool !== 'ellipse') deselectShape();
    App.DrawToolbar.syncToolButtons(tool);
    updateCursor();
  }

  function applyDrawColor(color) {
    State.setDrawPrefsPartial({ color });
    const img = State.current();
    if (!img) return;
    const d = ensureDraw(img);
    if (d.selectedShapeId) {
      const s = getShape(img, d.selectedShapeId);
      if (s && s.color !== color) {
        const before = saveSnapshot(img);
        s.color = color;
        pushHistory(img, before);
        syncDrawPreview(img);
        persistDraw();
      }
    }
  }

  function bindPointerEvents() {
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointerleave', onBrushCursorLeave);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function renderToExport(ctx, img) {
    if (!img.draw) return;
    const d = img.draw;
    if (d.rasterCanvas) ctx.drawImage(d.rasterCanvas, 0, 0, img.w, img.h);
    d.shapes.forEach(s => bakeShapeToRaster(ctx, s, img, img.w, img.h));
  }

  App.Draw = {
    initDrawLayers, ensureDraw, ensureRaster, syncDrawPreview, deselectShape, selectShape,
    getSelectedShape, insertShapeFromPreset, removeSelectedShape,
    onImageSelected, onStageResize, onModeChange, bindPointerEvents,
    undo, redo, setTool, applyDrawColor, saveSnapshot, renderToExport, updatePointerEvents, updateCursor,
    refreshBrushCursorSize, updateBrushCursor,
    serializeUndoForDisk, hydrateUndoFromDisk, DISK_UNDO_MAX,
    drawHasInk, markRasterInk
  };
})(window.App = window.App || {});
