/* 图片上传与左侧图库 */
(function (App) {
  "use strict";

  const { esc, toast } = App.Utils;
  const State = App.State;
  const { gallery, emptySide, exportBtn, selInfo, checkAll, stage, emptyEditor, currentName, addTextBtn, exportOneBtn, propsPanel } = App.Dom;

  function createDrawState() {
    return {
      tool: 'brush',
      color: '#ffffff',
      brushSize: 12,
      eraserSize: 20,
      selectedShapeId: null,
      shapes: [],
      rasterCanvas: null,
      history: { undo: [], redo: [] }
    };
  }

  function persistImage(img) {
    if (App.Storage && App.Storage.isAvailable() && !App.Storage.isRestoring()) {
      App.Storage.saveImageMeta(img);
    }
  }

  function persistSession() {
    if (App.Storage && App.Storage.isAvailable() && !App.Storage.isRestoring()) {
      App.Storage.saveSession();
    }
  }

  function syncSelectUI() {
    const sel = State.images.filter(i => i.selected).length;
    exportBtn.disabled = sel === 0;
    exportBtn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-download"/></svg>导出所选 (${sel})`;
    selInfo.textContent = `${sel} / ${State.images.length}`;
    checkAll.checked = State.images.length > 0 && sel === State.images.length;
    checkAll.indeterminate = sel > 0 && sel < State.images.length;
  }

  function renderThumbs() {
    const st = gallery.scrollTop;
    gallery.innerHTML = '';
    if (!State.images.length) {
      emptySide.hidden = false;
      gallery.appendChild(emptySide);
    } else {
      emptySide.hidden = true;
      State.images.forEach(img => {
        const d = document.createElement('div');
        d.className = 'thumb' + (img.id === State.currentId ? ' current' : '');
        d.dataset.id = img.id;
        d.title = img.name;
        d.innerHTML = `
          <div class="thumb-preview"><img src="${img.url}" alt=""></div>
          <div class="thumb-body">
            <div class="meta">${esc(img.name)}</div>
            <span class="badge" ${img.texts.length ? '' : 'hidden'}>${img.texts.length} 段</span>
          </div>
          <div class="thumb-actions">
            <input type="checkbox" class="check" ${img.selected ? 'checked' : ''}>
            <button class="del" title="移除这张图片" aria-label="移除">×</button>
          </div>`;
        d.addEventListener('click', e => {
          if (e.target.closest('.check') || e.target.closest('.del')) return;
          App.Editor.selectImage(img.id);
        });
        d.querySelector('.check').addEventListener('click', e => {
          e.stopPropagation();
          img.selected = e.target.checked;
          syncSelectUI();
          persistImage(img);
        });
        d.querySelector('.del').addEventListener('click', e => { e.stopPropagation(); removeImage(img.id); });
        gallery.appendChild(d);
      });
    }
    syncSelectUI();
    gallery.scrollTop = st;
  }

  function updateBadge(id) {
    const b = gallery.querySelector(`.thumb[data-id="${id}"] .badge`);
    const img = State.getImage(id);
    if (!b || !img) return;
    b.hidden = !img.texts.length;
    b.textContent = `${img.texts.length} 段`;
  }

  function loadImageFile(file) {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      const img = {
        id: State.uid(), name: file.name, url, imgEl: el,
        w: el.naturalWidth, h: el.naturalHeight,
        sourceBlob: file,
        texts: [], draw: createDrawState(), selected: true
      };
      State.images.push(img);
      renderThumbs();
      if (!State.currentId) App.Editor.selectImage(img.id);
      persistImage(img);
      persistSession();
    };
    el.onerror = () => { URL.revokeObjectURL(url); toast('无法读取 ' + file.name); };
    el.src = url;
  }

  function addFiles(files) {
    files.forEach(loadImageFile);
    toast(`已添加 ${files.length} 张图片`);
  }

  function removeImage(id) {
    const img = State.getImage(id);
    if (!img) return;
    URL.revokeObjectURL(img.url);
    State.images = State.images.filter(i => i.id !== id);
    if (State.currentId === id) {
      State.currentId = null;
      State.selectedTextId = null;
      stage.hidden = true;
      emptyEditor.hidden = false;
      currentName.textContent = '未选择图片';
      addTextBtn.disabled = true;
      exportOneBtn.disabled = true;
      if (propsPanel) propsPanel.hidden = true;
      if (App.DrawToolbar) App.DrawToolbar.updateModeUI();
      if (App.UI) App.UI.syncPropsState();
    }
    renderThumbs();
    if (App.Storage && App.Storage.isAvailable()) {
      App.Storage.deleteImage(id);
      persistSession();
    }
  }

  function clearAll(skipStorage, silent) {
    State.images.forEach(i => URL.revokeObjectURL(i.url));
    State.images = [];
    State.currentId = null;
    State.selectedTextId = null;
    stage.hidden = true;
    emptyEditor.hidden = false;
    currentName.textContent = '未选择图片';
    addTextBtn.disabled = true;
    exportOneBtn.disabled = true;
    if (propsPanel) propsPanel.hidden = true;
    renderThumbs();
    if (App.DrawToolbar) App.DrawToolbar.updateModeUI();
    if (App.UI) App.UI.syncPropsState();
    if (!skipStorage && App.Storage && App.Storage.isAvailable()) {
      App.Storage.clearAll();
    }
    if (!silent) toast('已清空全部图片');
  }

  function persistAllSelected() {
    State.images.forEach(persistImage);
    persistSession();
  }

  App.Gallery = {
    createDrawState, addFiles, loadImageFile, removeImage, renderThumbs,
    syncSelectUI, clearAll, updateBadge, persistImage, persistSession, persistAllSelected
  };
})(window.App = window.App || {});
