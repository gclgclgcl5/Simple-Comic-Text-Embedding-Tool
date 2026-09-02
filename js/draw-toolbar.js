/* 画图工具栏 */
(function (App) {
  "use strict";

  const { $ } = App.Utils;
  const State = App.State;
  const {
    drawToolbar, drawColor, drawColorBtn, drawBrushSize, drawEraserSize,
    drawUndoBtn, drawRedoBtn, drawDelBtn, addTextBtn, modeTextBtn, modeDrawBtn, editor,
    textProps, drawProps, propsPanel
  } = App.Dom;

  let colorPick;

  function applyDrawColor(color) {
    App.Draw.applyDrawColor(color);
    syncColorUI(color);
  }

  function syncColorUI(color) {
    if (drawColor) {
      drawColor.value = color;
      if (colorPick) colorPick.syncSwatch();
    }
  }

  function syncColorFromShape(shape) {
    if (shape) syncColorUI(shape.color);
  }

  function syncUIFromDraw(img) {
    if (!img || !img.draw) return;
    const d = img.draw;
    syncColorUI(d.color);
    if (drawBrushSize) drawBrushSize.value = String(d.brushSize);
    if (drawEraserSize) drawEraserSize.value = String(d.eraserSize);
    syncToolButtons(d.tool);
    updateHistoryButtons();
    updateSizeSliders(d.tool);
  }

  function syncToolButtons(tool) {
    document.querySelectorAll('.draw-tool').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.tool === tool);
    });
  }

  function setTool(tool) {
    App.Draw.setTool(tool);
    updateSizeSliders(tool);
  }

  function updateSizeSliders(tool) {
    const brushWrap = $('drawBrushSizeWrap');
    const eraserWrap = $('drawEraserSizeWrap');
    if (brushWrap) brushWrap.hidden = tool !== 'brush';
    if (eraserWrap) eraserWrap.hidden = tool !== 'eraser';
  }

  function updateHistoryButtons() {
    const img = State.current();
    if (!drawUndoBtn || !drawRedoBtn) return;
    const d = img && img.draw;
    drawUndoBtn.disabled = !d || !d.history.undo.length;
    drawRedoBtn.disabled = !d || !d.history.redo.length;
  }

  function updateDeleteButton() {
    if (!drawDelBtn) return;
    drawDelBtn.disabled = !(State.isDrawMode() && !!App.Draw.getSelectedShape());
  }

  function updateModeUI() {
    const drawMode = State.isDrawMode();
    const hasImage = !!State.current();
    if (drawMode && App.Toolbar) App.Toolbar.cancelEyedropper();
    modeTextBtn.classList.toggle('active', !drawMode);
    modeDrawBtn.classList.toggle('active', drawMode);
    addTextBtn.disabled = drawMode || !hasImage;
    if (editor) editor.classList.toggle('mode-draw', drawMode);
    if (propsPanel) propsPanel.hidden = !hasImage;
    if (textProps) textProps.hidden = drawMode || !hasImage;
    if (drawProps) drawProps.hidden = !drawMode || !hasImage;
    App.Draw.onModeChange();
    if (App.UI) App.UI.syncPropsState();
    updateDeleteButton();
  }

  function init() {
    colorPick = App.ColorPick.setupColorPick({
      input: drawColor,
      btn: drawColorBtn,
      pop: $('drawColorPop'),
      chipsEl: $('drawColorChips'),
      moreBtn: $('drawColorMore'),
      onApply: applyDrawColor
    });

    document.querySelectorAll('.draw-tool').forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    if (drawBrushSize) {
      drawBrushSize.addEventListener('input', () => {
        const img = State.current();
        if (img) ensureDraw(img).brushSize = +drawBrushSize.value;
        if (img && App.Storage && App.Storage.isAvailable()) App.Storage.scheduleSaveEdit(img.id);
      });
    }
    if (drawEraserSize) {
      drawEraserSize.addEventListener('input', () => {
        const img = State.current();
        if (img) ensureDraw(img).eraserSize = +drawEraserSize.value;
        if (img && App.Storage && App.Storage.isAvailable()) App.Storage.scheduleSaveEdit(img.id);
      });
    }

    drawUndoBtn.addEventListener('click', () => {
      const img = State.current();
      if (img) App.Draw.undo(img);
    });
    drawRedoBtn.addEventListener('click', () => {
      const img = State.current();
      if (img) App.Draw.redo(img);
    });

    if (drawDelBtn) {
      drawDelBtn.addEventListener('click', () => App.Draw.removeSelectedShape());
    }

    modeTextBtn.addEventListener('click', () => State.setEditMode('text'));
    modeDrawBtn.addEventListener('click', () => State.setEditMode('draw'));
  }

  function ensureDraw(img) { return App.Draw.ensureDraw(img); }

  App.DrawToolbar = {
    init, applyDrawColor, syncColorUI, syncColorFromShape, syncUIFromDraw,
    syncToolButtons, updateHistoryButtons, updateDeleteButton, updateModeUI, setTool
  };
})(window.App = window.App || {});
