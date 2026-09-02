/* 画图：画笔、橡皮、矩形/椭圆、取色、历史 */
(function (App) {
  "use strict";

  const State = App.State;
  const { stage, drawRaster, drawShapeLayer } = App.Dom;
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const MIN_SHAPE = 0.008;
  const HISTORY_MAX = 50;

  function persistDraw() {
    const img = State.current();
    if (img && App.Storage && App.Storage.isAvailable()) {
      App.Storage.scheduleSaveEdit(img.id);
    }
  }

  let pointer = null;
  let previewShape = null;
  let lastToolBeforeEyedropper = 'brush';

  function ensureDraw(img) {
    if (!img.draw) img.draw = App.Gallery.createDrawState();
    return img.draw;
  }

  function ensureRaster(img) {
    const d = ensureDraw(img);
    if (!d.rasterCanvas) {
      d.rasterCanvas = document.createElement('canvas');
      d.rasterCanvas.width = img.w;
      d.rasterCanvas.height = img.h;
    } else if (d.rasterCanvas.width !== img.w || d.rasterCanvas.height !== img.h) {
      const old = d.rasterCanvas;
      d.rasterCanvas = document.createElement('canvas');
      d.rasterCanvas.width = img.w;
      d.rasterCanvas.height = img.h;
      d.rasterCanvas.getContext('2d').drawImage(old, 0, 0, img.w, img.h);
    }
    return d.rasterCanvas;
  }

  function stageToImage(clientX, clientY, img) {
    const r = stage.getBoundingClientRect();
    return {
      x: (clientX - r.left) / r.width * img.w,
      y: (clientY - r.top) / r.height * img.h,
      nx: (clientX - r.left) / r.width,
      ny: (clientY - r.top) / r.height
    };
  }

  function scaleFactor(img) { return img.w / Math.max(1, stage.clientWidth); }

  function saveSnapshot(img) {
    const d = ensureDraw(img);
    const canvas = d.rasterCanvas;
    let raster = null;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      raster = ctx.getImageData(0, 0, img.w, img.h);
    }
    return { raster, shapes: JSON.parse(JSON.stringify(d.shapes)) };
  }

  function restoreSnapshot(img, snap) {
    const d = ensureDraw(img);
    const canvas = ensureRaster(img);
    const ctx = canvas.getContext('2d');
    if (snap.raster) ctx.putImageData(snap.raster, 0, 0);
    else ctx.clearRect(0, 0, img.w, img.h);
    d.shapes = JSON.parse(JSON.stringify(snap.shapes));
    syncDrawPreview(img);
  }

  function pushHistory(img, before) {
    const d = ensureDraw(img);
    d.history.undo.push(before);
    d.history.redo = [];
    if (d.history.undo.length > HISTORY_MAX) d.history.undo.shift();
    App.DrawToolbar.updateHistoryButtons();
  }

  function undo(img) {
    const d = ensureDraw(img);
    if (!d.history.undo.length) return;
    const cur = saveSnapshot(img);
    const prev = d.history.undo.pop();
    d.history.redo.push(cur);
    restoreSnapshot(img, prev);
    App.DrawToolbar.updateHistoryButtons();
    App.DrawToolbar.updateDeleteButton();
    persistDraw();
  }

  function redo(img) {
    const d = ensureDraw(img);
    if (!d.history.redo.length) return;
    const cur = saveSnapshot(img);
    const next = d.history.redo.pop();
    d.history.undo.push(cur);
    restoreSnapshot(img, next);
    App.DrawToolbar.updateHistoryButtons();
    App.DrawToolbar.updateDeleteButton();
    persistDraw();
  }

  function bakeShapeToRaster(ctx, shape, img) {
    const cx = shape.x * img.w, cy = shape.y * img.h;
    const hw = shape.w * img.w, hh = shape.h * img.h;
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
  }

  function bakeIntersectingShapes(img, ix, iy, radius) {
    const d = ensureDraw(img);
    const ctx = ensureRaster(img).getContext('2d');
    const remaining = [];
    for (const s of d.shapes) {
      if (shapeIntersectsCircle(s, img, ix, iy, radius)) {
        bakeShapeToRaster(ctx, s, img);
      } else {
        remaining.push(s);
      }
    }
    d.shapes = remaining;
  }

  function shapeIntersectsCircle(s, img, ix, iy, radius) {
    const l = (s.x - s.w) * img.w, r = (s.x + s.w) * img.w;
    const t = (s.y - s.h) * img.h, b = (s.y + s.h) * img.h;
    const cx = Math.max(l, Math.min(ix, r));
    const cy = Math.max(t, Math.min(iy, b));
    const dx = ix - cx, dy = iy - cy;
    if (dx * dx + dy * dy <= radius * radius) return true;
    if (s.type === 'rect') return true;
    const nx = (ix / img.w - s.x) / Math.max(s.w, 0.001);
    const ny = (iy / img.h - s.y) / Math.max(s.h, 0.001);
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

  function syncDrawPreview(img) {
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
    updatePointerEvents();
  }

  function updatePointerEvents() {
    const drawMode = State.isDrawMode();
    stage.classList.toggle('mode-draw', drawMode);
    drawRaster.style.pointerEvents = drawMode ? 'auto' : 'none';
    drawShapeLayer.style.pointerEvents = drawMode ? 'auto' : 'none';
    updateCursor();
  }

  function updateCursor() {
    if (!State.isDrawMode()) { stage.style.cursor = ''; return; }
    const img = State.current();
    if (!img) return;
    const tool = ensureDraw(img).tool;
    const cursors = { brush: 'crosshair', eraser: 'crosshair', rect: 'crosshair', ellipse: 'crosshair', eyedropper: 'crosshair' };
    stage.style.cursor = cursors[tool] || 'default';
  }

  function initDrawLayers() {
    updatePointerEvents();
  }

  function onImageSelected(img) {
    if (!img) return;
    ensureDraw(img);
    deselectShape();
    syncDrawPreview(img);
    App.DrawToolbar.updateHistoryButtons();
    App.DrawToolbar.syncUIFromDraw(img);
  }

  function onStageResize() {
    const img = State.current();
    if (img) syncDrawPreview(img);
  }

  function onModeChange() {
    if (State.isTextMode()) deselectShape();
    updatePointerEvents();
    const img = State.current();
    if (img) syncDrawPreview(img);
  }

  function drawBrushDot(ctx, x, y, size, erase) {
    ctx.save();
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = ensureDraw(State.current()).color;
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
    if (!State.isDrawMode() || e.button !== 0) return;
    const img = State.current();
    if (!img || e.target.closest('#drawProps')) return;
    const d = ensureDraw(img);
    const p = stageToImage(e.clientX, e.clientY, img);
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const stageX = e.clientX - stage.getBoundingClientRect().left;
    const stageY = e.clientY - stage.getBoundingClientRect().top;

    if (d.tool === 'eyedropper') {
      e.preventDefault();
      pickColorAt(img, p.x, p.y);
      return;
    }

    if (d.tool === 'brush' || d.tool === 'eraser') {
      e.preventDefault();
      const before = saveSnapshot(img);
      pointer = { type: d.tool, before, lastX: p.x, lastY: p.y };
      const ctx = ensureRaster(img).getContext('2d');
      const size = (d.tool === 'eraser' ? d.eraserSize : d.brushSize) * scaleFactor(img);
      if (d.tool === 'eraser') bakeIntersectingShapes(img, p.x, p.y, size / 2);
      drawBrushDot(ctx, p.x, p.y, size, d.tool === 'eraser');
      syncDrawPreview(img);
      return;
    }

    if (d.tool === 'rect' || d.tool === 'ellipse') {
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
      pointer = { type: 'create', shapeType: d.tool, startNX: p.nx, startNY: p.ny, before: saveSnapshot(img) };
      previewShape = { type: d.tool, x: p.nx, y: p.ny, w: 0, h: 0, color: d.color };
      syncDrawPreview(img);
    }
  }

  function onPointerMove(e) {
    if (!pointer || !State.isDrawMode()) return;
    const img = State.current();
    if (!img) return;
    const d = ensureDraw(img);
    const p = stageToImage(e.clientX, e.clientY, img);

    if (pointer.type === 'brush' || pointer.type === 'eraser') {
      const ctx = ensureRaster(img).getContext('2d');
      const size = (pointer.type === 'eraser' ? d.eraserSize : d.brushSize) * scaleFactor(img);
      if (pointer.type === 'eraser') bakeIntersectingShapes(img, p.x, p.y, size / 2);
      drawBrushLine(ctx, pointer.lastX, pointer.lastY, p.x, p.y, size, pointer.type === 'eraser');
      pointer.lastX = p.x;
      pointer.lastY = p.y;
      syncDrawPreview(img);
      return;
    }

    if (pointer.type === 'create') {
      const l = Math.min(pointer.startNX, p.nx);
      const t = Math.min(pointer.startNY, p.ny);
      const r = Math.max(pointer.startNX, p.nx);
      const b = Math.max(pointer.startNY, p.ny);
      const ns = shapeFromBounds(l, t, r, b);
      previewShape = { type: pointer.shapeType, ...ns, color: d.color };
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
      pushHistory(img, pointer.before);
      pointer = null;
      persistDraw();
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
      syncDrawPreview(img);
      pointer = null;
      persistDraw();
      return;
    }

    if (pointer.type === 'move' || pointer.type === 'resize') {
      const s = getShape(img, pointer.shapeId);
      const changed = s && (s.x !== pointer.shapeStart.x || s.y !== pointer.shapeStart.y || s.w !== pointer.shapeStart.w || s.h !== pointer.shapeStart.h);
      if (changed && pointer.before) pushHistory(img, pointer.before);
      pointer = null;
      if (changed) persistDraw();
      return;
    }
    pointer = null;
  }

  async function pickColorAt(img, ix, iy) {
    const hex = await App.Export.sampleColorAt(img, ix, iy);
    ensureDraw(img).color = hex;
    App.DrawToolbar.syncColorUI(hex);
    const d = ensureDraw(img);
    if (d.tool === 'eyedropper') setTool(lastToolBeforeEyedropper);
  }

  function setTool(tool) {
    const img = State.current();
    if (!img) return;
    const d = ensureDraw(img);
    if (tool === 'eyedropper' && d.tool !== 'eyedropper') lastToolBeforeEyedropper = d.tool;
    d.tool = tool;
    if (tool !== 'rect' && tool !== 'ellipse') deselectShape();
    App.DrawToolbar.syncToolButtons(tool);
    updateCursor();
  }

  function applyDrawColor(color) {
    const img = State.current();
    if (!img) return;
    const d = ensureDraw(img);
    d.color = color;
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
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function renderToExport(ctx, img) {
    if (!img.draw) return;
    const d = img.draw;
    if (d.rasterCanvas) ctx.drawImage(d.rasterCanvas, 0, 0);
    d.shapes.forEach(s => bakeShapeToRaster(ctx, s, img));
  }

  App.Draw = {
    initDrawLayers, ensureDraw, ensureRaster, syncDrawPreview, deselectShape, selectShape,
    getSelectedShape, insertShapeFromPreset, removeSelectedShape,
    onImageSelected, onStageResize, onModeChange, bindPointerEvents,
    undo, redo, setTool, applyDrawColor, saveSnapshot, renderToExport, updatePointerEvents
  };
})(window.App = window.App || {});
