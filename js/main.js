/* 应用入口：初始化与事件绑定 */
(function (App) {
  "use strict";

  const { toast } = App.Utils;
  const State = App.State;
  const {
    fileInput, checkAll, clearAllBtn, clearCacheBtn, addTextBtn, stage, canvasArea,
    fontUploadBtn, fontInput, exportOneBtn, exportBtn, tbDelBtn, tbBold
  } = App.Dom;

  let peekingOriginal = false;

  function canPeekOriginal() {
    if (!State.current() || !stage || stage.hidden) return false;
    const el = document.activeElement;
    const tag = (el && el.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (el && el.isContentEditable) return false;
    return true;
  }

  function startPeekOriginal() {
    if (peekingOriginal || !canPeekOriginal()) return;
    peekingOriginal = true;
    stage.classList.add('peek-original');
  }

  function endPeekOriginal() {
    if (!peekingOriginal) return;
    peekingOriginal = false;
    if (stage) stage.classList.remove('peek-original');
  }

  async function init() {
    App.UI.init();
    State.loadLastStyle();
    App.Fonts.injectBundledFonts();

    const storageOk = await App.Storage.open();
    if (storageOk) {
      App.Storage.initFlushHooks();
    } else {
      toast('本地持久化不可用，刷新后工作进度将无法自动恢复', 4000);
    }

    App.Toolbar.initColorPicks();
    State.loadPresets();
    App.Toolbar.renderPresets();
    App.Toolbar.bindPresetEvents();
    App.Toolbar.bindToolbarEvents();
    App.Draw.initDrawLayers();
    App.DrawToolbar.init();
    State.loadShapePresets();
    App.ShapePresets.renderShapePresets();
    App.ShapePresets.bindShapePresetEvents();

    let restored = false;
    if (storageOk) {
      try {
        restored = await App.Storage.restoreSession();
      } catch (e) {
        console.error('restore failed', e);
        toast('恢复上次进度失败', 3200);
      }
    }

    App.Fonts.refreshFontSelect();
    if (!restored) App.Toolbar.syncDefaultStylePanel();
    App.Draw.bindPointerEvents();

    if (restored) toast('已恢复上次工作进度');

    fileInput.addEventListener('change', () => {
      App.Gallery.addFiles([...fileInput.files]);
      fileInput.value = '';
    });

    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
      e.preventDefault();
      const files = [...e.dataTransfer.files];
      const imgs = files.filter(f => f.type.startsWith('image/'));
      const fonts = files.filter(f => /\.(ttf|otf|woff2?|zip)$/i.test(f.name));
      if (imgs.length) App.Gallery.addFiles(imgs);
      if (fonts.length) fonts.forEach(f => App.Fonts.addFontFile(f));
    });

    checkAll.addEventListener('change', e => {
      const v = e.target.checked;
      State.images.forEach(i => i.selected = v);
      App.Gallery.renderThumbs();
      App.Gallery.persistAllSelected();
    });

    clearAllBtn.addEventListener('click', () => {
      if (!State.images.length) { toast('列表已经是空的'); return; }
      if (!confirm('确定要清空全部 ' + State.images.length + ' 张图片吗？\n所有文字编辑也会一并清除，且无法撤销。')) return;
      App.Gallery.clearAll();
    });

    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', async () => {
        if (!confirm('将清除所有本地保存的图片、编辑与上传字体。\n当前内存中的内容也会一并清空，是否继续？')) return;
        if (App.Storage.isAvailable()) await App.Storage.clearAll();
        if (State.images.length) App.Gallery.clearAll(true, true);
        toast('已清除本地缓存');
      });
    }

    window.addEventListener('resize', () => {
      if (State.current()) {
        App.Editor.layoutStage();
        App.Editor.renderBoxes();
        if (State.selectedTextId) {
          const t = State.current().texts.find(x => x.id === State.selectedTextId);
          if (t) App.Toolbar.syncSizeInput(t);
        } else {
          App.Toolbar.syncDefaultStylePanel();
        }
      }
    });

    addTextBtn.addEventListener('click', () => {
      if (!State.isTextMode()) return;
      App.Editor.addText(0.5, 0.5);
    });

    stage.addEventListener('dblclick', e => {
      if (!State.isTextMode()) return;
      if (e.target.closest('.text-box') || e.target.closest('#textProps')) return;
      const r = stage.getBoundingClientRect();
      const x = Math.min(0.95, Math.max(0.05, (e.clientX - r.left) / r.width));
      const y = Math.min(0.95, Math.max(0.05, (e.clientY - r.top) / r.height));
      App.Editor.addText(x, y);
    });

    canvasArea.addEventListener('mousedown', e => {
      if (!State.isTextMode() || !State.selectedTextId) return;
      if (e.target.closest('.text-box') || e.target.closest('#textProps') || e.target.closest('.props-panel') || e.target.closest('.text-rotate-confirm')) return;
      App.Editor.clearSelection();
    });

    document.addEventListener('mousedown', e => {
      if (!e.target.closest('.color-pick')) {
        App.ColorPick.closeColorPops();
      }
    });

    tbDelBtn.addEventListener('click', () => {
      if (State.selectedTextId) App.Editor.removeText(State.selectedTextId);
    });

    document.addEventListener('keydown', e => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const mod = e.ctrlKey || e.metaKey;

      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (!e.repeat && canPeekOriginal()) {
          e.preventDefault();
          startPeekOriginal();
        } else if (peekingOriginal) {
          e.preventDefault();
        }
        return;
      }

      if (State.isDrawMode() && mod && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        if (e.key === 'z' || e.key === 'Z') {
          if (e.shiftKey) {
            e.preventDefault();
            const img = State.current();
            if (img) App.Draw.redo(img);
          } else {
            e.preventDefault();
            const img = State.current();
            if (img) App.Draw.undo(img);
          }
          return;
        }
        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          const img = State.current();
          if (img) App.Draw.redo(img);
          return;
        }
      }

      if (State.isDrawMode() && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (App.Draw.getSelectedShape()) {
          e.preventDefault();
          App.Draw.removeSelectedShape();
        }
        return;
      }

      if (!State.isTextMode()) return;

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (App.Editor.isRotating()) { App.Editor.abortRotateIfNeeded(); return; }
        const img = State.current();
        if (img) {
          if (e.shiftKey) App.Editor.redo(img);
          else App.Editor.undo(img);
        }
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (App.Editor.isRotating()) { App.Editor.abortRotateIfNeeded(); return; }
        const img = State.current();
        if (img) App.Editor.redo(img);
        return;
      }

      if (mod && (e.key === 'b' || e.key === 'B') && State.selectedTextId) {
        if (App.Editor.isRotating()) return;
        e.preventDefault();
        tbBold.click();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (App.Editor.isRotating()) { e.preventDefault(); return; }
        if (State.selectedTextId) { e.preventDefault(); App.Editor.removeText(State.selectedTextId); }
      } else if (e.key === 'Escape') {
        if (App.Toolbar.cancelEyedropper()) return;
        if (App.Editor.abortRotateIfNeeded()) return;
        if (State.selectedTextId) App.Editor.clearSelection();
      }
    });

    document.addEventListener('keyup', e => {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') endPeekOriginal();
    });
    window.addEventListener('blur', endPeekOriginal);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) endPeekOriginal();
    });

    fontUploadBtn.addEventListener('click', () => fontInput.click());
    fontInput.addEventListener('change', async () => {
      const files = [...fontInput.files];
      fontInput.value = '';
      let n = 0;
      for (const f of files) n += await App.Fonts.addFontFile(f);
      if (n) toast('已加载 ' + n + ' 个字体样式');
    });

    exportOneBtn.addEventListener('click', () => App.Export.exportCurrent());
    exportBtn.addEventListener('click', () => App.Export.exportSelected());
  }

  App.Main = { init, endPeekOriginal };
  init();
})(window.App = window.App || {});
