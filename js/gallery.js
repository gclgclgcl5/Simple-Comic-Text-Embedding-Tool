/* 图片上传与左侧图库（含工程文件夹） */
(function (App) {
  "use strict";

  const {
    esc, toast, nextProjectImageName, isNameTaken, compareProjectImages, baseName
  } = App.Utils;
  const State = App.State;
  const {
    gallery, emptySide, exportBtn, selInfo, checkAll, stage, emptyEditor,
    currentName, addTextBtn, exportOneBtn, propsPanel
  } = App.Dom;

  const DRAG_IMG_MIME = 'application/x-itt-image-id';

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

  function scopeImagesFor(img) {
    if (img.projectId) return State.imagesInProject(img.projectId);
    return State.rootImages();
  }

  function exportableCount() {
    if (State.currentProjectId) {
      return State.imagesInProject(State.currentProjectId).filter(i => i.selected).length;
    }
    let n = State.rootImages().filter(i => i.selected).length;
    State.projects.filter(p => p.selected).forEach(p => {
      n += State.imagesInProject(p.id).length;
    });
    return n;
  }

  function syncSelectUI() {
    const sel = exportableCount();
    exportBtn.disabled = sel === 0;
    exportBtn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-download"/></svg>导出所选 (${sel})`;
    const checkAllText = App.Dom.checkAllText;
    if (State.currentProjectId) {
      const imgs = State.imagesInProject(State.currentProjectId);
      const imgSel = imgs.filter(i => i.selected).length;
      selInfo.textContent = `${imgSel} / ${imgs.length}`;
      checkAll.checked = imgs.length > 0 && imgSel === imgs.length;
      checkAll.indeterminate = imgSel > 0 && imgSel < imgs.length;
      if (checkAllText) checkAllText.textContent = '全选';
    } else {
      const roots = State.rootImages();
      const rootSel = roots.filter(i => i.selected).length;
      const projSel = State.projects.filter(p => p.selected).length;
      selInfo.textContent = projSel
        ? `${rootSel} 散图 / ${projSel} 工程`
        : `${rootSel} / ${roots.length}`;
      checkAll.checked = roots.length > 0 && rootSel === roots.length;
      checkAll.indeterminate = rootSel > 0 && rootSel < roots.length;
      if (checkAllText) checkAllText.textContent = '全选';
    }
  }

  function imageVisibleInCurrentView(img) {
    if (!img) return false;
    if (State.currentProjectId) return img.projectId === State.currentProjectId;
    return !img.projectId;
  }

  function ensureNameHasExt(name) {
    const n = String(name || '').trim();
    if (!n) return '';
    if (/\.[a-zA-Z0-9]+$/.test(n)) return n;
    return n + '.png';
  }

  function promptRenameImage(img) {
    const next = prompt('重命名图片', img.name);
    if (next == null) return;
    const name = ensureNameHasExt(next);
    if (!name) { toast('名称不能为空'); return; }
    if (isNameTaken(scopeImagesFor(img), name, img.id)) {
      toast('同名文件已存在');
      return;
    }
    img.name = name;
    persistImage(img);
    renderThumbs();
    if (State.currentId === img.id && currentName) currentName.textContent = img.name;
  }

  function createProject() {
    const raw = prompt('工程文件夹名称');
    if (raw == null) return;
    const name = String(raw).trim();
    if (!name) { toast('名称不能为空'); return; }
    if (State.projects.some(p => p.name === name)) {
      toast('工程名已存在');
      return;
    }
    const project = { id: State.uid(), name, selected: false };
    State.projects.push(project);
    persistSession();
    renderThumbs();
    toast('已创建工程「' + name + '」');
  }

  function renameProject(project) {
    const raw = prompt('重命名工程', project.name);
    if (raw == null) return;
    const name = String(raw).trim();
    if (!name) { toast('名称不能为空'); return; }
    if (State.projects.some(p => p.id !== project.id && p.name === name)) {
      toast('工程名已存在');
      return;
    }
    project.name = name;
    persistSession();
    renderThumbs();
  }

  function deleteProject(project) {
    const imgs = State.imagesInProject(project.id);
    const msg = imgs.length
      ? `确定删除工程「${project.name}」及其内 ${imgs.length} 张图片吗？\n所有文字编辑也会一并清除，且无法撤销。`
      : `确定删除空工程「${project.name}」吗？`;
    if (!confirm(msg)) return;
    imgs.slice().forEach(img => removeImage(img.id, true));
    State.projects = State.projects.filter(p => p.id !== project.id);
    if (State.currentProjectId === project.id) State.currentProjectId = null;
    persistSession();
    renderThumbs();
    toast('已删除工程「' + project.name + '」');
  }

  function enterProject(projectId) {
    State.currentProjectId = projectId;
    persistSession();
    renderThumbs();
  }

  function leaveProject() {
    State.currentProjectId = null;
    persistSession();
    renderThumbs();
  }

  function moveImageToProject(imgId, projectId) {
    const img = State.getImage(imgId);
    const project = State.getProject(projectId);
    if (!img || !project) return;
    if (img.projectId) {
      toast('仅支持将根目录散图拖入工程');
      return;
    }
    const siblings = State.imagesInProject(projectId);
    const name = nextProjectImageName(siblings);
    if (isNameTaken(siblings, name, img.id)) {
      toast('命名冲突，请稍后重试');
      return;
    }
    img.projectId = projectId;
    img.name = name;
    persistImage(img);
    persistSession();
    renderThumbs();
    toast(`已导入「${project.name}」为 ${name}`);
  }

  function selectAllInView(checked) {
    if (State.currentProjectId) {
      State.imagesInProject(State.currentProjectId).forEach(i => { i.selected = checked; });
    } else {
      State.rootImages().forEach(i => { i.selected = checked; });
    }
    renderThumbs();
    persistAllSelected();
  }

  function renderGalleryNav(parent) {
    if (!State.currentProjectId) return;
    const project = State.getProject(State.currentProjectId);
    const nav = document.createElement('div');
    nav.className = 'gallery-nav';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'gallery-nav-back';
    back.title = '返回根目录';
    back.textContent = '← ' + (project ? project.name : '返回');
    back.addEventListener('click', leaveProject);
    nav.appendChild(back);
    parent.appendChild(nav);
  }

  function renderProjectRow(project) {
    const d = document.createElement('div');
    d.className = 'project-row';
    d.dataset.projectId = project.id;
    d.title = '双击进入「' + project.name + '」';
    const count = State.imagesInProject(project.id).length;
    d.innerHTML = `
      <div class="project-icon" aria-hidden="true"></div>
      <div class="thumb-body">
        <div class="meta">${esc(project.name)}</div>
        <span class="badge project-badge">${count} 张</span>
      </div>
      <div class="thumb-actions">
        <input type="checkbox" class="check" ${project.selected ? 'checked' : ''} title="导出时包含本工程全部图片">
        <button type="button" class="rename-btn" title="重命名工程" aria-label="重命名">✎</button>
        <button type="button" class="del" title="删除工程" aria-label="删除">×</button>
      </div>`;
    d.addEventListener('dblclick', e => {
      if (e.target.closest('.check') || e.target.closest('.del') || e.target.closest('.rename-btn')) return;
      enterProject(project.id);
    });
    d.querySelector('.check').addEventListener('click', e => {
      e.stopPropagation();
      project.selected = e.target.checked;
      syncSelectUI();
      persistSession();
    });
    d.querySelector('.rename-btn').addEventListener('click', e => {
      e.stopPropagation();
      renameProject(project);
    });
    d.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      deleteProject(project);
    });
    d.addEventListener('dragover', e => {
      if (![...e.dataTransfer.types].includes(DRAG_IMG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      d.classList.add('drop-target');
    });
    d.addEventListener('dragleave', () => d.classList.remove('drop-target'));
    d.addEventListener('drop', e => {
      e.preventDefault();
      d.classList.remove('drop-target');
      const id = e.dataTransfer.getData(DRAG_IMG_MIME);
      if (id) moveImageToProject(id, project.id);
    });
    return d;
  }

  function renderImageThumb(img) {
    const inRoot = !State.currentProjectId;
    const showCurrent = img.id === State.currentId && imageVisibleInCurrentView(img);
    const d = document.createElement('div');
    d.className = 'thumb' + (showCurrent ? ' current' : '');
    d.dataset.id = img.id;
    d.title = img.name;
    if (inRoot) d.draggable = true;
    d.innerHTML = `
      <div class="thumb-preview"><img src="${img.url}" alt=""></div>
      <div class="thumb-body">
        <div class="meta" title="双击重命名">${esc(img.name)}</div>
        <span class="badge" ${img.texts.length ? '' : 'hidden'}>${img.texts.length} 段</span>
      </div>
      <div class="thumb-actions">
        <input type="checkbox" class="check" ${img.selected ? 'checked' : ''}>
        <button type="button" class="rename-btn" title="重命名" aria-label="重命名">✎</button>
        <button type="button" class="del" title="移除这张图片" aria-label="移除">×</button>
      </div>`;
    d.addEventListener('click', e => {
      if (e.target.closest('.check') || e.target.closest('.del') || e.target.closest('.rename-btn')) return;
      App.Editor.selectImage(img.id);
    });
    d.querySelector('.meta').addEventListener('dblclick', e => {
      e.stopPropagation();
      promptRenameImage(img);
    });
    d.querySelector('.rename-btn').addEventListener('click', e => {
      e.stopPropagation();
      promptRenameImage(img);
    });
    d.querySelector('.check').addEventListener('click', e => {
      e.stopPropagation();
      img.selected = e.target.checked;
      syncSelectUI();
      persistImage(img);
    });
    d.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      removeImage(img.id);
    });
    if (inRoot) {
      d.addEventListener('dragstart', e => {
        e.dataTransfer.setData(DRAG_IMG_MIME, img.id);
        e.dataTransfer.effectAllowed = 'move';
        d.classList.add('dragging');
      });
      d.addEventListener('dragend', () => d.classList.remove('dragging'));
    }
    return d;
  }

  function renderThumbs() {
    const st = gallery.scrollTop;
    gallery.innerHTML = '';

    if (State.currentProjectId) {
      const project = State.getProject(State.currentProjectId);
      if (!project) {
        State.currentProjectId = null;
        return renderThumbs();
      }
      renderGalleryNav(gallery);
      const imgs = State.imagesInProject(State.currentProjectId).slice().sort(compareProjectImages);
      if (!imgs.length) {
        const tip = document.createElement('div');
        tip.className = 'empty-side gallery-empty-hint';
        tip.innerHTML = '工程内还没有图片<br>拖入图片将自动命名为 1.png、2.png…';
        gallery.appendChild(tip);
      } else {
        imgs.forEach(img => gallery.appendChild(renderImageThumb(img)));
      }
    } else {
      const projects = State.projects.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      const roots = State.rootImages();
      if (!projects.length && !roots.length) {
        emptySide.hidden = false;
        gallery.appendChild(emptySide);
      } else {
        emptySide.hidden = true;
        projects.forEach(p => gallery.appendChild(renderProjectRow(p)));
        roots.forEach(img => gallery.appendChild(renderImageThumb(img)));
      }
    }

    syncSelectUI();
    gallery.scrollTop = st;
    const createBtn = App.Dom.createProjectBtn;
    if (createBtn) createBtn.hidden = !!State.currentProjectId;
  }

  function updateBadge(id) {
    const b = gallery.querySelector(`.thumb[data-id="${id}"] .badge`);
    const img = State.getImage(id);
    if (!b || !img) return;
    b.hidden = !img.texts.length;
    b.textContent = `${img.texts.length} 段`;
  }

  function loadImageFile(file, forcedName) {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      const projectId = State.currentProjectId || null;
      let name = forcedName || file.name;
      if (projectId && !forcedName) {
        name = nextProjectImageName(State.imagesInProject(projectId));
      }
      const img = {
        id: State.uid(), name, url, imgEl: el,
        w: el.naturalWidth, h: el.naturalHeight,
        sourceBlob: file,
        texts: [], draw: createDrawState(), selected: true,
        projectId
      };
      if (projectId && isNameTaken(State.imagesInProject(projectId), name, img.id)) {
        URL.revokeObjectURL(url);
        toast('命名冲突，请稍后重试');
        return;
      }
      if (!projectId && isNameTaken(State.rootImages(), name, img.id)) {
        let base = baseName(name);
        let ext = name.slice(base.length) || '.png';
        let k = 2;
        let candidate = base + ' (' + k + ')' + ext;
        while (isNameTaken(State.rootImages(), candidate, null)) {
          k++;
          candidate = base + ' (' + k + ')' + ext;
        }
        name = candidate;
        img.name = name;
      }
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
    const list = [...files];
    const projectId = State.currentProjectId || null;
    if (projectId) {
      const reserved = [];
      list.forEach(file => {
        const name = nextProjectImageName([
          ...State.imagesInProject(projectId),
          ...reserved.map(n => ({ name: n }))
        ]);
        reserved.push(name);
        loadImageFile(file, name);
      });
    } else {
      list.forEach(file => loadImageFile(file));
    }
    toast(`已添加 ${list.length} 张图片`);
  }

  function clearWorkspaceIfNeeded(removedCurrent) {
    if (!removedCurrent) return;
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

  function removeImage(id, skipRender) {
    const img = State.getImage(id);
    if (!img) return;
    if (State.currentId === id && App.Editor && App.Editor.abortRotateIfNeeded) {
      App.Editor.abortRotateIfNeeded();
    }
    URL.revokeObjectURL(img.url);
    const wasCurrent = State.currentId === id;
    State.images = State.images.filter(i => i.id !== id);
    clearWorkspaceIfNeeded(wasCurrent);
    if (!skipRender) renderThumbs();
    if (App.Storage && App.Storage.isAvailable()) {
      App.Storage.deleteImage(id);
      persistSession();
    }
  }

  function clearRootImages() {
    if (App.Editor && App.Editor.abortRotateIfNeeded) App.Editor.abortRotateIfNeeded();
    const roots = State.rootImages();
    roots.forEach(i => URL.revokeObjectURL(i.url));
    const rootIds = new Set(roots.map(i => i.id));
    const wasCurrent = State.currentId && rootIds.has(State.currentId);
    State.images = State.images.filter(i => i.projectId);
    clearWorkspaceIfNeeded(wasCurrent);
    renderThumbs();
    if (App.Storage && App.Storage.isAvailable()) {
      roots.forEach(i => App.Storage.deleteImage(i.id));
      persistSession();
    }
    toast('已清空根目录散图');
  }

  function clearAll(skipStorage, silent) {
    if (App.Editor && App.Editor.abortRotateIfNeeded) App.Editor.abortRotateIfNeeded();
    State.images.forEach(i => URL.revokeObjectURL(i.url));
    State.images = [];
    State.projects = [];
    State.currentProjectId = null;
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
    if (!silent) toast('已清空全部图片与工程');
  }

  function persistAllSelected() {
    State.images.forEach(persistImage);
    persistSession();
  }

  App.Gallery = {
    createDrawState, addFiles, loadImageFile, removeImage, renderThumbs,
    syncSelectUI, clearAll, clearRootImages, updateBadge, persistImage, persistSession,
    persistAllSelected, createProject, selectAllInView, enterProject, leaveProject,
    exportableCount
  };
})(window.App = window.App || {});
