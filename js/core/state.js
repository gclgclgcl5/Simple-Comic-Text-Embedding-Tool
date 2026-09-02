/* 运行时状态与 localStorage 持久化 */
(function (App) {
  "use strict";

  const DEFAULT_FONT = '方正卡通简体';
  const STYLE_KEY = 'dsh_text_style_v1';
  const PRESET_KEY = 'dsh_color_presets_v1';
  const SHAPE_PRESET_KEY = 'dsh_shape_presets_v1';
  const SHAPE_PRESET_MIN = 0.004;

  let images = [];
  let currentId = null;
  let selectedTextId = null;
  let uidSeq = 1;
  const customFonts = [];
  let presets = [null, null, null, null];
  let shapePresets = [null, null, null, null, null, null];

  let lastStyle = {
    color: '#ffffff', fontPct: 0.05, fontFamily: DEFAULT_FONT,
    bold: false, vertical: false, stroke: false, strokeColor: '#000000', strokePct: 0.08
  };

  function uid() { return 't' + (uidSeq++) + Date.now().toString(36); }

  function getImage(id) { return images.find(i => i.id === id); }

  function current() { return getImage(currentId); }

  function saveLastStyle() {
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(lastStyle)); } catch (e) {}
  }

  function loadLastStyle() {
    try {
      const raw = localStorage.getItem(STYLE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color)) lastStyle.color = s.color;
      if (typeof s.strokeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.strokeColor)) lastStyle.strokeColor = s.strokeColor;
      if (typeof s.fontPct === 'number' && s.fontPct >= 0.01 && s.fontPct <= 0.4) lastStyle.fontPct = s.fontPct;
      if (typeof s.strokePct === 'number' && s.strokePct >= 0.02 && s.strokePct <= 0.2) lastStyle.strokePct = s.strokePct;
      if (typeof s.fontFamily === 'string' && s.fontFamily) lastStyle.fontFamily = s.fontFamily;
      if (typeof s.bold === 'boolean') lastStyle.bold = s.bold;
      if (typeof s.vertical === 'boolean') lastStyle.vertical = s.vertical;
      if (typeof s.stroke === 'boolean') lastStyle.stroke = s.stroke;
    } catch (e) {}
    if (!lastStyle.fontFamily) lastStyle.fontFamily = DEFAULT_FONT;
  }

  function validHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }

  function validTextPreset(v) {
    if (!v || typeof v !== 'object') return null;
    if (!validHex(v.color) || !validHex(v.strokeColor)) return null;
    if (typeof v.fontPct !== 'number' || v.fontPct < 0.01 || v.fontPct > 0.4) return null;
    if (typeof v.stroke !== 'boolean') return null;
    if (typeof v.strokePct !== 'number' || v.strokePct < 0.02 || v.strokePct > 0.2) return null;
    const fontFamily = typeof v.fontFamily === 'string' && v.fontFamily ? v.fontFamily : DEFAULT_FONT;
    return {
      color: v.color,
      fontPct: v.fontPct,
      fontFamily,
      bold: typeof v.bold === 'boolean' ? v.bold : false,
      vertical: typeof v.vertical === 'boolean' ? v.vertical : false,
      stroke: v.stroke,
      strokeColor: v.strokeColor,
      strokePct: v.strokePct
    };
  }

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length !== 4) return;
      presets = arr.map(v => {
        if (v === null) return null;
        if (typeof v === 'string' && validHex(v)) {
          return validTextPreset({
            color: v, fontPct: 0.05, fontFamily: DEFAULT_FONT,
            bold: false, vertical: false, stroke: false, strokeColor: '#000000', strokePct: 0.08
          });
        }
        return validTextPreset(v);
      });
    } catch (e) {}
  }

  function savePresets() {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); } catch (e) {}
  }

  function validShapePreset(v) {
    if (!v || typeof v !== 'object') return null;
    if (v.type !== 'rect' && v.type !== 'ellipse') return null;
    if (typeof v.w !== 'number' || typeof v.h !== 'number') return null;
    if (v.w < SHAPE_PRESET_MIN || v.h < SHAPE_PRESET_MIN || v.w > 0.5 || v.h > 0.5) return null;
    if (!validHex(v.color)) return null;
    return { type: v.type, w: v.w, h: v.h, color: v.color };
  }

  function loadShapePresets() {
    try {
      const raw = localStorage.getItem(SHAPE_PRESET_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length !== 6) return;
      shapePresets = arr.map(v => (v === null ? null : validShapePreset(v)));
    } catch (e) {}
  }

  function saveShapePresets() {
    try { localStorage.setItem(SHAPE_PRESET_KEY, JSON.stringify(shapePresets)); } catch (e) {}
  }

  let editMode = 'text';

  function isTextMode() { return editMode === 'text'; }
  function isDrawMode() { return editMode === 'draw'; }

  function setEditMode(mode) {
    if (mode !== 'text' && mode !== 'draw') return;
    editMode = mode;
    selectedTextId = null;
    const img = current();
    if (img && img.draw) img.draw.selectedShapeId = null;
    if (App.Editor) App.Editor.syncPropsUI();
    if (App.Draw) App.Draw.deselectShape();
    if (App.DrawToolbar) App.DrawToolbar.updateModeUI();
    if (App.UI) App.UI.syncPropsState();
    if (App.Storage && App.Storage.isAvailable() && !App.Storage.isRestoring()) {
      App.Storage.saveSession();
    }
  }

  App.State = {
    get images() { return images; },
    set images(v) { images = v; },
    get currentId() { return currentId; },
    set currentId(v) { currentId = v; },
    get selectedTextId() { return selectedTextId; },
    set selectedTextId(v) { selectedTextId = v; },
    get uidSeq() { return uidSeq; },
    set uidSeq(v) { uidSeq = v; },
    get lastStyle() { return lastStyle; },
    customFonts,
    get presets() { return presets; },
    set presets(v) { presets = v; },
    get shapePresets() { return shapePresets; },
    set shapePresets(v) { shapePresets = v; },
    DEFAULT_FONT,
    STYLE_KEY,
    PRESET_KEY,
    SHAPE_PRESET_KEY,
    uid,
    getImage,
    current,
    saveLastStyle,
    loadLastStyle,
    validHex,
    validTextPreset,
    validShapePreset,
    loadPresets,
    savePresets,
    loadShapePresets,
    saveShapePresets,
    get editMode() { return editMode; },
    isTextMode,
    isDrawMode,
    setEditMode
  };
})(window.App = window.App || {});
