/* 画布编辑器：文字框渲染、拖动、选中、八点缩放 */
(function (App) {
  "use strict";

  const { FONT } = App.Utils;
  const State = App.State;
  const { canvasArea, stage, stageImg, emptyEditor, currentName, addTextBtn, exportOneBtn, tbDelBtn } = App.Dom;

  const TA_PAD_X = 6, TA_PAD_Y = 1, LH_RATIO = 1.25;
  /** 换行测宽相对字号的余量，避免贴边框在导出时因字体 hinting 多断一行 */
  const WRAP_SLACK_EM = 0.25;
  const BOLD_RATIO = 0.05;
  const HISTORY_MAX = 50;
  const MIN_TEXT_W = 40;
  const TEXT_PLACEHOLDER = '在此输入文字';
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const CONFIRM_BTN_GAP = 8;
  const CONFIRM_PAIR_WIDTH = 72;

  let measureCanvas = null;
  let rotateSession = {
    active: false,
    textId: null,
    before: 0,
    draft: 0,
    showConfirm: false
  };

  function measureCtx() {
    if (!measureCanvas) measureCanvas = document.createElement('canvas');
    return measureCanvas.getContext('2d');
  }

  function normalizeRotation(deg) {
    if (typeof deg !== 'number' || !isFinite(deg)) return 0;
    let d = ((deg + 180) % 360 + 360) % 360 - 180;
    if (d > 180) d = 180;
    if (d < -180) d = -180;
    return d;
  }

  function getTextRotation(t) {
    if (!t) return 0;
    return normalizeRotation(typeof t.rotation === 'number' ? t.rotation : 0);
  }

  function ensureTextRotation(t) {
    if (!t) return 0;
    t.rotation = getTextRotation(t);
    return t.rotation;
  }

  function displayRotation(t) {
    if (!t) return 0;
    if (rotateSession.active && rotateSession.textId === t.id) return rotateSession.draft;
    return getTextRotation(t);
  }

  function isRotating() {
    return !!rotateSession.active;
  }

  function applyBoxTransform(box, deg) {
    const n = normalizeRotation(deg);
    box.style.transformOrigin = 'center center';
    box.style.transform = n ? ('rotate(' + n + 'deg)') : '';
  }

  function clearRotateConfirmUI() {
    stage.querySelectorAll('.text-rotate-confirm').forEach(el => el.remove());
    rotateSession.showConfirm = false;
  }

  function positionRotateConfirmUI(box, ui) {
    if (!box || !ui) return;
    const stageRect = stage.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const centerX = (boxRect.left + boxRect.right) / 2 - stageRect.left;
    const top = boxRect.bottom - stageRect.top + CONFIRM_BTN_GAP;
    ui.style.left = Math.round(centerX - CONFIRM_PAIR_WIDTH / 2) + 'px';
    ui.style.top = Math.round(top) + 'px';
  }

  function mountRotateConfirmUI(box, t) {
    clearRotateConfirmUI();
    rotateSession.showConfirm = true;
    const ui = document.createElement('div');
    ui.className = 'text-rotate-confirm';
    ui.dataset.for = t.id;
    ui.innerHTML =
      '<button type="button" class="text-rotate-ok" title="确认角度">✓</button>' +
      '<button type="button" class="text-rotate-cancel" title="还原角度">×</button>';
    stage.appendChild(ui);
    positionRotateConfirmUI(box, ui);

    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    ui.addEventListener('pointerdown', stop);
    ui.addEventListener('mousedown', stop);

    ui.querySelector('.text-rotate-ok').addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      confirmRotate();
    });
    ui.querySelector('.text-rotate-cancel').addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      cancelRotateDraft();
    });
  }

  function syncRotatingClass(box, t) {
    const on = rotateSession.active && rotateSession.textId === t.id;
    box.classList.toggle('rotating', on);
  }

  function refreshRotateVisual(t) {
    if (!t) return;
    const box = stage.querySelector(`.text-box[data-id="${t.id}"]`);
    if (!box) return;
    applyBoxTransform(box, displayRotation(t));
    syncRotatingClass(box, t);
    if (rotateSession.showConfirm && rotateSession.textId === t.id) {
      const ui = stage.querySelector('.text-rotate-confirm[data-for="' + t.id + '"]');
      if (ui) positionRotateConfirmUI(box, ui);
      else mountRotateConfirmUI(box, t);
    }
  }

  function getRotateDraft() {
    return rotateSession.active ? rotateSession.draft : null;
  }

  function getDisplayRotation(t) {
    if (!t) return 0;
    return displayRotation(t);
  }

  function setRotateDraft(deg) {
    if (!rotateSession.active) return false;
    rotateSession.draft = normalizeRotation(deg);
    const img = State.current();
    const t = img && img.texts.find(x => x.id === rotateSession.textId);
    if (t) refreshRotateVisual(t);
    return true;
  }

  function notifyRotateUI() {
    if (App.Toolbar && App.Toolbar.syncRotateControls) App.Toolbar.syncRotateControls();
    syncPropsUI();
  }

  function startRotate() {
    if (!State.isTextMode() || !State.current() || !State.selectedTextId) return false;
    const t = State.current().texts.find(x => x.id === State.selectedTextId);
    if (!t || t.vertical) return false;
    if (rotateSession.active && rotateSession.textId === t.id) return true;
    if (rotateSession.active) abortRotateIfNeeded();
    const ang = ensureTextRotation(t);
    rotateSession = {
      active: true,
      textId: t.id,
      before: ang,
      draft: ang,
      showConfirm: false
    };
    clearRotateConfirmUI();
    const box = stage.querySelector(`.text-box[data-id="${t.id}"]`);
    if (box) {
      const ta = box.querySelector('textarea');
      if (ta && document.activeElement === ta) ta.blur();
      syncRotatingClass(box, t);
      applyBoxTransform(box, ang);
      syncTextHandles();
    }
    notifyRotateUI();
    return true;
  }

  function exitRotate(discard) {
    if (!rotateSession.active) return;
    const textId = rotateSession.textId;
    const before = rotateSession.before;
    const draft = rotateSession.draft;
    clearRotateConfirmUI();
    rotateSession = { active: false, textId: null, before: 0, draft: 0, showConfirm: false };
    const img = State.current();
    const t = img && textId ? img.texts.find(x => x.id === textId) : null;
    if (t) {
      if (discard) t.rotation = before;
      else t.rotation = normalizeRotation(draft);
      ensureTextRotation(t);
      const box = stage.querySelector(`.text-box[data-id="${t.id}"]`);
      if (box) {
        syncRotatingClass(box, t);
        applyBoxTransform(box, getTextRotation(t));
        syncTextHandles();
      }
    }
    notifyRotateUI();
  }

  function confirmRotate() {
    if (!rotateSession.active) return;
    const img = State.current();
    const t = img && img.texts.find(x => x.id === rotateSession.textId);
    if (!t) {
      exitRotate(true);
      return;
    }
    const next = normalizeRotation(rotateSession.draft);
    const prev = ensureTextRotation(t);
    if (next !== prev) pushHistory(img);
    t.rotation = next;
    clearRotateConfirmUI();
    rotateSession = { active: false, textId: null, before: 0, draft: 0, showConfirm: false };
    const box = stage.querySelector(`.text-box[data-id="${t.id}"]`);
    if (box) {
      syncRotatingClass(box, t);
      applyBoxTransform(box, next);
      syncTextHandles();
    }
    scheduleEdit();
    persistSession();
    notifyRotateUI();
  }

  function cancelRotateDraft() {
    if (!rotateSession.active) return;
    rotateSession.draft = rotateSession.before;
    clearRotateConfirmUI();
    const img = State.current();
    const t = img && img.texts.find(x => x.id === rotateSession.textId);
    if (t) refreshRotateVisual(t);
    notifyRotateUI();
  }

  function abortRotateIfNeeded() {
    if (!rotateSession.active) return false;
    exitRotate(true);
    return true;
  }

  function startBoxRotate(e, box, t) {
    e.preventDefault();
    e.stopPropagation();
    clearRotateConfirmUI();
    const stageRect = stage.getBoundingClientRect();
    const cx = t.x * stage.clientWidth;
    const cy = t.y * stage.clientHeight;
    const sx0 = e.clientX - stageRect.left;
    const sy0 = e.clientY - stageRect.top;
    const startPointerAngle = Math.atan2(sy0 - cy, sx0 - cx);
    const startDraft = rotateSession.draft;
    let moved = false;

    const move = ev => {
      const sx = ev.clientX - stageRect.left;
      const sy = ev.clientY - stageRect.top;
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) > 2) {
        moved = true;
        box.classList.add('dragging');
      }
      const ang = Math.atan2(sy - cy, sx - cx);
      let deltaDeg = (ang - startPointerAngle) * 180 / Math.PI;
      rotateSession.draft = normalizeRotation(startDraft + deltaDeg);
      applyBoxTransform(box, rotateSession.draft);
      if (App.Toolbar && App.Toolbar.syncAngleInput) App.Toolbar.syncAngleInput();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      box.classList.remove('dragging');
      mountRotateConfirmUI(box, t);
      notifyRotateUI();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  async function prepareTextFont(fontFamily, fs) {
    if (!fontFamily) return;
    try {
      await document.fonts.load(fs + 'px "' + fontFamily + '"');
    } catch (e) {}
  }

  async function prepareTextFontsForImage(img) {
    if (!img || !img.texts.length) return;
    const sh = stage.clientHeight || 400;
    const jobs = [];
    const seen = new Set();
    for (const t of img.texts) {
      const fam = t.fontFamily || State.DEFAULT_FONT;
      const fs = Math.max(6, Math.round(t.fontPct * sh));
      const key = fam + '|' + fs;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push(prepareTextFont(fam, fs));
    }
    await Promise.all(jobs);
  }

  function measureInk(t, fs) {
    return Math.ceil((t.bold ? fs * BOLD_RATIO : 0) * 2 + (t.stroke ? Math.max(0.5, t.strokePct * fs) : 0)) + 2;
  }

  /** 框体总内边距（含描边余量），用于定框宽 */
  function textInnerPad(t, fs) {
    return TA_PAD_X * 2 + measureInk(t, fs);
  }

  /**
   * 换行用内容宽度：与 textarea 的 padding(左右各 6px)对齐，
   * 并加字号相关余量，避免 CSS 能放下、Canvas measureText 多 1px 就断行。
   */
  function wrapContentWidth(boxW, fs) {
    const slack = Math.max(0.5, fs * WRAP_SLACK_EM);
    return Math.max(10, boxW - TA_PAD_X * 2 + slack);
  }

  function isWidthFixed(t) {
    return t.widthMode === 'fixed';
  }

  function isHeightFixed(t) {
    return t.heightMode === 'fixed';
  }

  function minBoxHeight(fs) {
    return Math.ceil(fs * LH_RATIO + TA_PAD_Y * 2);
  }

  function naturalBoxHeight(t, fs, contentW, ctx) {
    const lines = wrapText(t.text.length ? t.text : ' ', fs, contentW, ctx);
    return Math.max(minBoxHeight(fs), Math.ceil(lines.length * fs * LH_RATIO + TA_PAD_Y * 2));
  }

  function layoutHorizontalText(t, fs, fontFamily, sw, sh, ctx) {
    const innerPad = textInnerPad(t, fs);
    const maxBoxW = Math.floor(sw * 0.85);
    const famRef = fontFamily ? ('"' + fontFamily + '"') : FONT;
    ctx.font = fs + 'px ' + famRef;

    const isEmpty = !(t.text && t.text.length);
    // 空内容时按 placeholder 测宽，避免框太窄只露出「在」
    const raw = isEmpty ? TEXT_PLACEHOLDER : t.text;
    let maxLineW = fs * 0.5;
    for (const line of raw.split(/\r?\n/)) {
      const sample = line.length ? line : ' ';
      maxLineW = Math.max(maxLineW, ctx.measureText(sample).width);
    }

    let boxW;
    if (isWidthFixed(t)) {
      boxW = Math.max(MIN_TEXT_W, Math.min(maxBoxW, (t.widthPct || 0.4) * sw));
    } else {
      // 自动宽度略留余量，避免框宽贴死最长行导致导出多断行
      const contentW = Math.min(maxLineW + Math.ceil(fs * WRAP_SLACK_EM), Math.max(10, maxBoxW - innerPad));
      boxW = Math.min(Math.max(contentW + innerPad, MIN_TEXT_W), maxBoxW);
    }

    const contentW = wrapContentWidth(boxW, fs);
    const naturalH = naturalBoxHeight(t, fs, contentW, ctx);
    let boxH;
    if (isHeightFixed(t)) {
      boxH = Math.max(minBoxHeight(fs), (t.heightPct || naturalH / sh) * sh);
    } else {
      boxH = naturalH;
    }

    t.widthPct = boxW / sw;
    t.heightPct = boxH / sh;
    return { w: boxW, h: boxH };
  }

  function computeResizeBounds(handle, orig, sx, sy, minH) {
    const { left: ol, top: ot, width: ow, height: oh } = orig;
    const r = ol + ow, b = ot + oh;
    let l = ol, top = ot, w = ow, h = oh;
    if (handle.includes('e')) w = Math.max(MIN_TEXT_W, sx - l);
    if (handle.includes('w')) {
      w = Math.max(MIN_TEXT_W, r - sx);
      l = r - w;
    }
    if (handle.includes('s')) h = Math.max(minH, sy - top);
    if (handle.includes('n')) {
      h = Math.max(minH, b - sy);
      top = b - h;
    }
    return { left: l, top, width: w, height: h };
  }

  function updateTextHandlePositions(box) {
    const sb = box.querySelector('.text-select-box');
    if (!sb) return;
    const w = box.offsetWidth, h = box.offsetHeight;
    const mx = w / 2, my = h / 2;
    const pos = {
      nw: [0, 0], n: [mx, 0], ne: [w, 0], e: [w, my],
      se: [w, h], s: [mx, h], sw: [0, h], w: [0, my]
    };
    sb.querySelectorAll('.text-handle').forEach(hd => {
      const p = pos[hd.dataset.handle];
      if (p) {
        hd.style.left = p[0] + 'px';
        hd.style.top = p[1] + 'px';
      }
    });
  }

  function mountTextHandles(box) {
    let sb = box.querySelector('.text-select-box');
    if (!sb) {
      sb = document.createElement('div');
      sb.className = 'text-select-box';
      HANDLES.forEach(h => {
        const hd = document.createElement('div');
        hd.className = 'text-handle';
        hd.dataset.handle = h;
        sb.appendChild(hd);
      });
      box.appendChild(sb);
    }
    updateTextHandlePositions(box);
  }

  function mountDragZones(box) {
    if (box.querySelector('.text-drag-bar')) return;
    const ta = box.querySelector('textarea');
    const bar = document.createElement('div');
    bar.className = 'text-drag-bar';
    bar.setAttribute('aria-label', '拖动文字框');
    box.insertBefore(bar, ta);
    ['l', 'r', 'b'].forEach(side => {
      const edge = document.createElement('div');
      edge.className = 'text-drag-edge text-drag-edge-' + side;
      box.insertBefore(edge, ta);
    });
  }

  function syncDragZones() {
    if (!State.current()) return;
    stage.querySelectorAll('.text-box').forEach(box => {
      const hasZones = box.querySelector('.text-drag-bar');
      const rotating = rotateSession.active && rotateSession.textId === box.dataset.id;
      if (box.classList.contains('selected') && !rotating) {
        mountDragZones(box);
      } else if (hasZones) {
        box.querySelectorAll('.text-drag-bar, .text-drag-edge').forEach(el => el.remove());
      }
    });
  }

  function syncTextHandles() {
    if (!State.current()) return;
    stage.querySelectorAll('.text-box').forEach(box => {
      const sb = box.querySelector('.text-select-box');
      const t = State.current().texts.find(x => x.id === box.dataset.id);
      const rotating = rotateSession.active && rotateSession.textId === box.dataset.id;
      if (box.classList.contains('selected') && t && !t.vertical && !rotating) {
        mountTextHandles(box);
      } else if (sb) {
        sb.remove();
      }
    });
    syncDragZones();
  }

  let inputHistoryPending = false;
  let inputHistoryTimer = null;
  let styleHistoryPending = false;
  let styleHistoryTimer = null;

  function ensureTextHistory(img) {
    if (!img.textHistory) img.textHistory = { undo: [], redo: [] };
    return img.textHistory;
  }

  function saveTextSnapshot(img) {
    return {
      texts: JSON.parse(JSON.stringify(img.texts)),
      selectedTextId: State.selectedTextId
    };
  }

  function resetHistorySessions() {
    inputHistoryPending = false;
    if (inputHistoryTimer) { clearTimeout(inputHistoryTimer); inputHistoryTimer = null; }
    styleHistoryPending = false;
    if (styleHistoryTimer) { clearTimeout(styleHistoryTimer); styleHistoryTimer = null; }
  }

  function restoreTextSnapshot(img, snap) {
    abortRotateIfNeeded();
    img.texts = JSON.parse(JSON.stringify(snap.texts));
    img.texts.forEach(ensureTextRotation);
    State.selectedTextId = snap.selectedTextId;
    if (State.selectedTextId && !img.texts.some(t => t.id === State.selectedTextId)) {
      State.selectedTextId = null;
    }
    resetHistorySessions();
    renderBoxes();
    if (State.selectedTextId) {
      const t = img.texts.find(x => x.id === State.selectedTextId);
      if (t) App.Toolbar.syncToolbarFromText(t);
    }
    syncPropsUI();
    App.Gallery.updateBadge(img.id);
    scheduleEdit();
    persistSession();
  }

  function pushHistory(img) {
    if (!img) img = State.current();
    if (!img) return;
    const h = ensureTextHistory(img);
    h.undo.push(saveTextSnapshot(img));
    h.redo = [];
    if (h.undo.length > HISTORY_MAX) h.undo.shift();
  }

  function pushHistoryDebounced(img) {
    if (!img) img = State.current();
    if (!img) return;
    if (!styleHistoryPending) pushHistory(img);
    styleHistoryPending = true;
    clearTimeout(styleHistoryTimer);
    styleHistoryTimer = setTimeout(() => { styleHistoryPending = false; }, 600);
  }

  function onTextInputHistory(img) {
    if (!inputHistoryPending) pushHistory(img);
    inputHistoryPending = true;
    clearTimeout(inputHistoryTimer);
    inputHistoryTimer = setTimeout(() => { inputHistoryPending = false; }, 600);
  }

  function undo(img) {
    if (!img) img = State.current();
    if (!img) return false;
    const h = ensureTextHistory(img);
    if (!h.undo.length) return false;
    const cur = saveTextSnapshot(img);
    const prev = h.undo.pop();
    h.redo.push(cur);
    restoreTextSnapshot(img, prev);
    return true;
  }

  function redo(img) {
    if (!img) img = State.current();
    if (!img) return false;
    const h = ensureTextHistory(img);
    if (!h.redo.length) return false;
    const cur = saveTextSnapshot(img);
    const next = h.redo.pop();
    h.undo.push(cur);
    restoreTextSnapshot(img, next);
    return true;
  }

  function stageH() { return stage.clientHeight || 400; }

  function scheduleEdit() {
    if (State.currentId && App.Storage && App.Storage.isAvailable()) {
      App.Storage.scheduleSaveEdit(State.currentId);
    }
  }

  function persistSession() {
    if (App.Gallery) App.Gallery.persistSession();
  }

  function syncPropsUI() {
    const rotating = isRotating();
    if (tbDelBtn) tbDelBtn.disabled = rotating || !State.selectedTextId;
    if (App.UI) App.UI.syncPropsState();
    if (App.Toolbar && App.Toolbar.syncRotateControls) App.Toolbar.syncRotateControls();
  }

  function layoutStage() {
    if (!State.current()) return;
    const pad = 36;
    const aw = Math.max(canvasArea.clientWidth - pad, 200), ah = Math.max(canvasArea.clientHeight - pad, 200);
    let w = aw, h = w * State.current().h / State.current().w;
    if (h > ah) { h = ah; w = h * State.current().w / State.current().h; }
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';
    if (App.Draw) App.Draw.onStageResize();
  }

  function selectImage(id) {
    const img = State.getImage(id);
    if (!img) return;
    abortRotateIfNeeded();
    if (App.Main && App.Main.endPeekOriginal) App.Main.endPeekOriginal();
    else if (stage) stage.classList.remove('peek-original');
    State.currentId = id;
    State.selectedTextId = null;
    stageImg.src = img.url;
    stage.hidden = false;
    emptyEditor.hidden = true;
    currentName.textContent = img.name;
    addTextBtn.disabled = false;
    exportOneBtn.disabled = false;
    layoutStage();
    renderBoxes();
    App.Gallery.renderThumbs();
    if (App.Draw) App.Draw.onImageSelected(img);
    if (App.DrawToolbar) App.DrawToolbar.updateModeUI();
    syncPropsUI();
    persistSession();
  }

  function applyPreviewWeight(ta, t, fs) {
    ta.style.fontWeight = '400';
    const boldW = Math.max(0.5, fs * BOLD_RATIO);
    if (t.stroke) {
      ta.style.webkitTextStroke = Math.max(0.5, t.strokePct * fs) + 'px ' + t.strokeColor;
      if (t.bold) {
        const o = Math.max(0.4, fs * 0.035);
        ta.style.textShadow = `${o}px 0 0 ${t.color},-${o}px 0 0 ${t.color},0 ${o}px 0 ${t.color},0 -${o}px 0 ${t.color}`;
      } else {
        ta.style.textShadow = 'none';
      }
    } else if (t.bold) {
      ta.style.webkitTextStroke = boldW + 'px ' + t.color;
      ta.style.textShadow = 'none';
    } else {
      ta.style.webkitTextStroke = '0px transparent';
      ta.style.textShadow = 'none';
    }
  }

  async function syncBox(box, t) {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const fs = Math.max(6, Math.round(t.fontPct * sh));
    const ta = box.querySelector('textarea');
    const fontFamily = t.fontFamily || State.DEFAULT_FONT;
    const fam = '"' + fontFamily + '", ' + FONT;
    ta.style.fontFamily = fam;
    ta.style.fontSize = fs + 'px';
    ta.style.color = t.color;
    applyPreviewWeight(ta, t, fs);
    if (t.vertical) {
      ta.style.writingMode = 'vertical-lr';
      ta.style.textOrientation = 'upright';
      ta.style.lineHeight = '1.15';
      const isEmpty = !(t.text && t.text.length);
      const measureText = isEmpty ? TEXT_PLACEHOLDER : t.text;
      const cols = measureText.split('\n');
      const colW = Math.max(10, fs);
      const maxLen = Math.max(1, ...cols.map(c => [...c].length));
      const ink = Math.ceil((t.bold ? fs * BOLD_RATIO : 0) * 2) + 2;
      const w = cols.length * colW + TA_PAD_X * 2 + ink;
      const h = Math.ceil(maxLen * fs * 1.15 + TA_PAD_Y * 2);
      box.style.width = w + 'px';
      ta.style.height = h + 'px';
      box.style.left = Math.round(t.x * sw - w / 2) + 'px';
      box.style.top = Math.round(t.y * sh - h / 2) + 'px';
      t.widthPct = w / sw;
    } else {
      ta.style.writingMode = 'horizontal-tb';
      ta.style.lineHeight = String(LH_RATIO);
      await prepareTextFont(fontFamily, fs);
      const { w, h } = layoutHorizontalText(t, fs, fontFamily, sw, sh, measureCtx());
      box.style.width = w + 'px';
      ta.style.height = h + 'px';
      box.style.left = Math.round(t.x * sw - w / 2) + 'px';
      box.style.top = Math.round(t.y * sh - h / 2) + 'px';
    }
    applyBoxTransform(box, displayRotation(t));
    syncRotatingClass(box, t);
    syncTextHandles();
  }

  async function renderBoxes() {
    if (!State.current()) return;
    const keepConfirm = rotateSession.active && rotateSession.showConfirm ? rotateSession.textId : null;
    clearRotateConfirmUI();
    if (keepConfirm) rotateSession.showConfirm = true;
    stage.querySelectorAll('.text-box').forEach(el => el.remove());
    const img = State.current();
    img.texts.forEach(ensureTextRotation);
    await prepareTextFontsForImage(img);
    for (const t of img.texts) {
      const box = document.createElement('div');
      box.className = 'text-box' + (t.id === State.selectedTextId ? ' selected' : '');
      box.dataset.id = t.id;
      const ta = document.createElement('textarea');
      ta.rows = 1;
      ta.value = t.text || '';
      ta.spellcheck = false;
      ta.placeholder = TEXT_PLACEHOLDER;
      ta.readOnly = rotateSession.active && rotateSession.textId === t.id;
      box.appendChild(ta);
      stage.appendChild(box);
      await syncBox(box, t);
      ta.addEventListener('input', () => {
        if (rotateSession.active && rotateSession.textId === t.id) return;
        onTextInputHistory(img);
        t.text = ta.value;
        syncBox(box, t);
        App.Gallery.updateBadge(State.currentId);
        scheduleEdit();
      });
      ta.addEventListener('focus', () => {
        if (rotateSession.active && rotateSession.textId === t.id) {
          ta.blur();
          return;
        }
        if (State.isTextMode()) selectBox(t);
      });
      ta.addEventListener('dblclick', e => e.stopPropagation());
      box.addEventListener('pointerdown', e => onBoxPointerDown(e, box, t));
    }
    if (keepConfirm) {
      const t = img.texts.find(x => x.id === keepConfirm);
      const box = t && stage.querySelector(`.text-box[data-id="${keepConfirm}"]`);
      if (t && box) mountRotateConfirmUI(box, t);
      else rotateSession.showConfirm = false;
    }
    syncPropsUI();
    notifyRotateUI();
  }

  function applyResizeBox(box, t, handle, bounds, sw, sh, keepCenterY) {
    const fs = Math.max(6, Math.round(t.fontPct * sh));
    const ta = box.querySelector('textarea');
    const fontFamily = t.fontFamily || State.DEFAULT_FONT;
    const ctx = measureCtx();
    const famRef = fontFamily ? ('"' + fontFamily + '"') : FONT;
    ctx.font = fs + 'px ' + famRef;

    let { left, top, width, height } = bounds;

    if (handle === 'e' || handle === 'w') {
      t.widthMode = 'fixed';
      t.widthPct = width / sw;
      t.x = (left + width / 2) / sw;
      if (!isHeightFixed(t)) {
        const contentW = wrapContentWidth(width, fs);
        height = naturalBoxHeight(t, fs, contentW, ctx);
        top = keepCenterY - height / 2;
        t.heightMode = 'auto';
      } else {
        height = Math.max(minBoxHeight(fs), (t.heightPct || 0.1) * sh);
        top = keepCenterY - height / 2;
      }
      t.y = keepCenterY / sh;
    } else if (handle === 'n' || handle === 's') {
      t.heightMode = 'fixed';
      t.heightPct = height / sh;
      t.y = (top + height / 2) / sh;
    } else {
      t.widthMode = 'fixed';
      t.heightMode = 'fixed';
      t.widthPct = width / sw;
      t.heightPct = height / sh;
      t.x = (left + width / 2) / sw;
      t.y = (top + height / 2) / sh;
    }

    box.style.width = width + 'px';
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    if (ta) ta.style.height = height + 'px';
    t.heightPct = height / sh;
    updateTextHandlePositions(box);
  }

  function startBoxMove(e, box, t, sw, sh) {
    e.preventDefault();
    e.stopPropagation();
    const img = State.current();
    if (img) pushHistory(img);
    const ta = box.querySelector('textarea');
    const startX = e.clientX, startY = e.clientY;
    const origLeft = parseFloat(box.style.left), origTop = parseFloat(box.style.top);
    let moved = false;
    const move = ev => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
        moved = true;
        if (ta) ta.blur();
      }
      if (moved) {
        box.classList.add('dragging');
        box.style.left = (origLeft + dx) + 'px';
        box.style.top = (origTop + dy) + 'px';
        updateTextHandlePositions(box);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      box.classList.remove('dragging');
      if (moved) {
        t.x = (parseFloat(box.style.left) + box.offsetWidth / 2) / sw;
        t.y = (parseFloat(box.style.top) + box.offsetHeight / 2) / sh;
        scheduleEdit();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onBoxPointerDown(e, box, t) {
    if (!State.isTextMode()) return;
    if (e.button !== 0) return;
    if (e.target.closest('.text-rotate-confirm')) return;

    if (rotateSession.active) {
      if (rotateSession.textId !== t.id) {
        abortRotateIfNeeded();
        selectBox(t);
        return;
      }
      startBoxRotate(e, box, t);
      return;
    }

    selectBox(t);

    const stageRect = stage.getBoundingClientRect();
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const handle = e.target.closest('.text-handle')?.dataset.handle;

    if (!t.vertical && handle) {
      e.preventDefault();
      e.stopPropagation();
      const img = State.current();
      if (img) pushHistory(img);

      const fs = Math.max(6, Math.round(t.fontPct * sh));
      const minH = minBoxHeight(fs);
      const orig = {
        left: parseFloat(box.style.left),
        top: parseFloat(box.style.top),
        width: box.offsetWidth,
        height: box.offsetHeight
      };
      const keepCenterY = t.y * sh;
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;

      const move = ev => {
        const sx = ev.clientX - stageRect.left;
        const sy = ev.clientY - stageRect.top;
        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
        if (moved) {
          box.classList.add('dragging');
          const bounds = computeResizeBounds(handle, orig, sx, sy, minH);
          applyResizeBox(box, t, handle, bounds, sw, sh, keepCenterY);
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        box.classList.remove('dragging');
        if (moved) {
          syncBox(box, t);
          scheduleEdit();
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    if (e.target.closest('.text-drag-bar, .text-drag-edge')) {
      startBoxMove(e, box, t, sw, sh);
      return;
    }

    if (e.target.closest('textarea')) return;
  }

  function selectBox(t) {
    if (!State.isTextMode()) return;
    if (rotateSession.active && rotateSession.textId !== t.id) abortRotateIfNeeded();
    if (State.selectedTextId && State.selectedTextId !== t.id) App.Toolbar.commitSizeInput();
    State.selectedTextId = t.id;
    stage.querySelectorAll('.text-box').forEach(b => b.classList.toggle('selected', b.dataset.id === t.id));
    App.Toolbar.syncToolbarFromText(t);
    syncTextHandles();
    syncPropsUI();
    notifyRotateUI();
    persistSession();
  }

  function clearSelection() {
    if (!State.isTextMode()) return;
    abortRotateIfNeeded();
    if (!State.selectedTextId) return;
    App.Toolbar.commitSizeInput();
    App.Toolbar.closeColorPops();
    const box = stage.querySelector('.text-box.selected');
    const ta = box?.querySelector('textarea');
    if (ta && document.activeElement === ta) ta.blur();
    State.selectedTextId = null;
    stage.querySelectorAll('.text-box.selected').forEach(b => b.classList.remove('selected'));
    syncTextHandles();
    syncPropsUI();
    notifyRotateUI();
    persistSession();
  }

  async function addText(xPct, yPct) {
    if (!State.isTextMode() || !State.current()) return;
    abortRotateIfNeeded();
    const img = State.current();
    pushHistory(img);
    const ls = State.lastStyle;
    const t = {
      id: State.uid(), text: '', color: ls.color, fontPct: ls.fontPct,
      x: xPct ?? 0.5, y: yPct ?? 0.5, widthPct: 0.4, widthMode: 'auto', heightMode: 'auto',
      fontFamily: ls.fontFamily, bold: !!ls.bold, vertical: ls.vertical, stroke: ls.stroke,
      strokeColor: ls.strokeColor, strokePct: ls.strokePct, rotation: 0
    };
    State.current().texts.push(t);
    State.selectedTextId = t.id;
    await renderBoxes();
    selectBox(t);
    const ta = stage.querySelector(`.text-box[data-id="${t.id}"] textarea`);
    if (ta) {
      requestAnimationFrame(() => {
        ta.focus({ preventScroll: true });
      });
    }
    App.Gallery.updateBadge(State.currentId);
    scheduleEdit();
    persistSession();
  }

  function removeText(id) {
    if (!State.current()) return;
    if (rotateSession.active && rotateSession.textId === id) abortRotateIfNeeded();
    else if (rotateSession.active) abortRotateIfNeeded();
    pushHistory(State.current());
    State.current().texts = State.current().texts.filter(t => t.id !== id);
    if (State.selectedTextId === id) State.selectedTextId = null;
    renderBoxes();
    App.Gallery.updateBadge(State.currentId);
    scheduleEdit();
    persistSession();
  }

  function wrapText(text, fs, maxW, ctx) {
    const lines = [];
    // 亚像素容差：贴边测宽时避免因浮点/hinting 多断一字
    const limit = maxW + 0.5;
    for (const p of text.split(/\r?\n/)) {
      const tokens = p.split(/(\s+)/);
      let cur = '';
      for (const tk of tokens) {
        const test = cur + tk;
        if (ctx.measureText(test).width <= limit) { cur = test; continue; }
        if (cur) { lines.push(cur); cur = tk; continue; }
        let sub = '';
        for (const ch of tk) {
          if (sub && ctx.measureText(sub + ch).width > limit) { lines.push(sub); sub = ch; }
          else sub += ch;
        }
        cur = sub;
      }
      lines.push(cur);
    }
    return lines;
  }

  /**
   * 按舞台坐标系计算换行（与面板框宽一致），供导出绘制使用，避免原图像素下多断行。
   */
  function wrapTextForDisplay(t, text) {
    const sw = Math.max(1, stage.clientWidth || 1);
    const sh = Math.max(1, stage.clientHeight || 1);
    const fs = Math.max(6, Math.round(t.fontPct * sh));
    const boxW = Math.max(10, (t.widthPct || 0.4) * sw);
    const maxW = wrapContentWidth(boxW, fs);
    const fontFamily = t.fontFamily || State.DEFAULT_FONT;
    const famRef = fontFamily ? ('"' + fontFamily + '"') : FONT;
    const ctx = measureCtx();
    ctx.font = fs + 'px ' + famRef;
    return wrapText(text, fs, maxW, ctx);
  }

  App.Editor = {
    selectImage, layoutStage, stageH, syncPropsUI,
    applyPreviewWeight, syncBox, renderBoxes, onBoxPointerDown,
    selectBox, clearSelection, addText, removeText, wrapText, wrapTextForDisplay,
    pushHistory, pushHistoryDebounced, undo, redo,
    textInnerPad, wrapContentWidth, measureInk,
    startRotate, exitRotate, confirmRotate, cancelRotateDraft,
    abortRotateIfNeeded, isRotating, getTextRotation, ensureTextRotation,
    normalizeRotation, getRotateDraft, getDisplayRotation, setRotateDraft,
    BOLD_RATIO, FONT: () => FONT, LH_RATIO, TA_PAD_X, WRAP_SLACK_EM
  };
})(window.App = window.App || {});
