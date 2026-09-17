/* 换字体/换名词副本共用：勾选上下文、克隆图片、落盘与进入新工程 */
(function (App) {
  "use strict";

  const { toast, baseName, isNameTaken } = App.Utils;
  const State = App.State;

  const DISABLED_MIX = '请只勾选散图，或只勾选一个工程（不可混选）';
  const DISABLED_MULTI_PROJ = '请只勾选一个工程';
  const DISABLED_EMPTY = '请先勾选要复制的散图或一个工程';

  function getContext() {
    if (State.currentProjectId) {
      const project = State.getProject(State.currentProjectId);
      const images = State.imagesInProject(State.currentProjectId).filter(i => i.selected);
      if (!images.length) {
        return { ok: false, images: [], nameBase: '', disabledReason: DISABLED_EMPTY };
      }
      return {
        ok: true,
        images,
        nameBase: (project && project.name) || '工程',
        disabledReason: ''
      };
    }

    const roots = State.rootImages().filter(i => i.selected);
    const projects = State.projects.filter(p => p.selected);
    const rootSel = roots.length;
    const projSel = projects.length;

    if (rootSel > 0 && projSel > 0) {
      return { ok: false, images: [], nameBase: '', disabledReason: DISABLED_MIX };
    }
    if (projSel > 1) {
      return { ok: false, images: [], nameBase: '', disabledReason: DISABLED_MULTI_PROJ };
    }
    if (projSel === 1 && rootSel === 0) {
      const project = projects[0];
      const images = State.imagesInProject(project.id).slice().sort(App.Utils.compareProjectImages);
      if (!images.length) {
        return { ok: false, images: [], nameBase: '', disabledReason: '该工程内没有图片' };
      }
      return { ok: true, images, nameBase: project.name || '工程', disabledReason: '' };
    }
    if (rootSel > 0 && projSel === 0) {
      const nameBase = baseName(roots[0].name) || '散图';
      return { ok: true, images: roots.slice(), nameBase, disabledReason: '' };
    }
    return { ok: false, images: [], nameBase: '', disabledReason: DISABLED_EMPTY };
  }

  function hasAnyTextBox(images) {
    return (images || []).some(img => (img.texts || []).length > 0);
  }

  function uniqueProjectName(nameBase, suffix) {
    const stem = String(nameBase || '散图').trim() || '散图';
    const suf = String(suffix || '-副本');
    const primary = stem + suf;
    if (!State.projects.some(p => p.name === primary)) return primary;
    let k = 2;
    let candidate = primary + ' (' + k + ')';
    while (State.projects.some(p => p.name === candidate)) {
      k++;
      candidate = primary + ' (' + k + ')';
    }
    return candidate;
  }

  function resolveUniqueImageName(scope, desired, excludeId) {
    if (!isNameTaken(scope, desired, excludeId)) return desired;
    const b = baseName(desired);
    const ext = desired.slice(b.length) || '.png';
    let k = 2;
    let candidate = b + ' (' + k + ')' + ext;
    while (isNameTaken(scope, candidate, excludeId)) {
      k++;
      candidate = b + ' (' + k + ')' + ext;
    }
    return candidate;
  }

  function loadImageFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve({ url, el: im });
      im.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片加载失败'));
      };
      im.src = url;
    });
  }

  async function ensureSourceBlob(img) {
    if (img.sourceBlob) return img.sourceBlob;
    if (img.imgEl && img.w && img.h) {
      const canvas = document.createElement('canvas');
      canvas.width = img.w;
      canvas.height = img.h;
      canvas.getContext('2d').drawImage(img.imgEl, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (blob) return blob;
    }
    throw new Error('无法读取原图数据');
  }

  /**
   * @param {object} src
   * @param {string} projectId
   * @param {object[]} nameScope
   * @param {(texts: object[]) => object[]} [textTransform]
   */
  async function cloneImage(src, projectId, nameScope, textTransform) {
    const blob = await ensureSourceBlob(src);
    const { url, el } = await loadImageFromBlob(blob);
    const name = resolveUniqueImageName(nameScope, src.name || 'image.png', null);

    let texts = JSON.parse(JSON.stringify(src.texts || [])).map(t =>
      Object.assign({}, t, { id: State.uid() })
    );
    if (typeof textTransform === 'function') {
      texts = textTransform(texts) || texts;
    }

    const draw = App.Gallery.createDrawState();
    if (src.draw) {
      draw.tool = src.draw.tool || 'brush';
      draw.color = src.draw.color || '#ffffff';
      draw.brushSize = src.draw.brushSize ?? 12;
      draw.eraserSize = src.draw.eraserSize ?? 20;
      draw.shapes = JSON.parse(JSON.stringify(src.draw.shapes || [])).map(s =>
        Object.assign({}, s, { id: State.uid() })
      );
    }
    draw.selectedShapeId = null;
    draw.history = { undo: [], redo: [] };

    const img = {
      id: State.uid(),
      name,
      url,
      imgEl: el,
      w: src.w || el.naturalWidth,
      h: src.h || el.naturalHeight,
      sourceBlob: blob,
      texts,
      draw,
      selected: false,
      projectId
    };

    nameScope.push(img);

    if (App.Draw && src.draw && src.draw.rasterCanvas) {
      const dest = App.Draw.ensureRaster(img);
      dest.getContext('2d').drawImage(src.draw.rasterCanvas, 0, 0, img.w, img.h);
    }

    return img;
  }

  function clearAllSelections() {
    State.images.forEach(i => { i.selected = false; });
    State.projects.forEach(p => { p.selected = false; });
  }

  async function persistClones(created) {
    if (App.Storage && App.Storage.isAvailable()) {
      for (let i = 0; i < created.length; i++) {
        const img = created[i];
        try {
          await App.Storage.saveImageMeta(img);
          if (App.Storage.snapshotEdit) {
            const snap = App.Storage.snapshotEdit(img);
            let rasterBlob = null;
            if (img.draw.rasterCanvas && App.Storage.canvasHasInk && App.Storage.canvasHasInk(img.draw.rasterCanvas)) {
              rasterBlob = await App.Storage.canvasToBlob(img.draw.rasterCanvas);
            }
            await App.Storage.saveEdit(img.id, { ...snap, rasterBlob, drawHistory: null });
          }
        } catch (e) {
          console.warn('remap-copy persist', img.id, e);
        }
      }
      if (App.Storage.saveSession) await App.Storage.saveSession();
      return;
    }
    if (App.Gallery && App.Gallery.persistSession) {
      App.Gallery.persistSession();
      created.forEach(img => {
        if (App.Gallery.persistImage) App.Gallery.persistImage(img);
      });
    }
  }

  function finalizeNewProject(project, created) {
    if (App.Gallery && App.Gallery.enterProject) App.Gallery.enterProject(project.id);
    else {
      State.currentProjectId = project.id;
      if (App.Gallery && App.Gallery.renderThumbs) App.Gallery.renderThumbs();
    }
    if (created[0] && App.Editor && App.Editor.selectImage) {
      App.Editor.selectImage(created[0].id);
    }
    if (App.Gallery && App.Gallery.syncSelectUI) App.Gallery.syncSelectUI();
  }

  /**
   * @param {{ nameSuffix: string, textTransform?: Function, logLabel?: string }} opts
   * @returns {Promise<{ ok: boolean, project?: object, created?: object[], projectName?: string, error?: string }>}
   */
  async function runCloneToProject(opts) {
    opts = opts || {};
    const ctx = getContext();
    if (!ctx.ok) {
      return { ok: false, error: ctx.disabledReason || DISABLED_EMPTY };
    }

    const projectName = uniqueProjectName(ctx.nameBase, opts.nameSuffix || '-副本');
    const project = { id: State.uid(), name: projectName, selected: false };
    State.projects.push(project);

    const nameScope = [];
    const created = [];
    const label = opts.logLabel || 'remap-copy';
    try {
      for (let i = 0; i < ctx.images.length; i++) {
        const clone = await cloneImage(
          ctx.images[i],
          project.id,
          nameScope,
          opts.textTransform
        );
        State.images.push(clone);
        created.push(clone);
      }
    } catch (e) {
      console.error(label + ' clone', e);
      created.forEach(img => {
        State.images = State.images.filter(x => x.id !== img.id);
        if (img.url) URL.revokeObjectURL(img.url);
      });
      State.projects = State.projects.filter(p => p.id !== project.id);
      return { ok: false, error: (e && e.message) ? e.message : '未知错误' };
    }

    clearAllSelections();
    await persistClones(created);
    finalizeNewProject(project, created);
    return { ok: true, project, created, projectName };
  }

  function syncMenuButton(btn, titleWhenOk) {
    if (!btn) return;
    const ctx = getContext();
    btn.disabled = !ctx.ok;
    btn.title = ctx.ok
      ? (titleWhenOk || '生成嵌字工程副本（原件保留）')
      : (ctx.disabledReason || DISABLED_EMPTY);
  }

  App.RemapCopy = {
    DISABLED_EMPTY,
    DISABLED_MIX,
    DISABLED_MULTI_PROJ,
    getContext,
    hasAnyTextBox,
    uniqueProjectName,
    cloneImage,
    clearAllSelections,
    persistClones,
    finalizeNewProject,
    runCloneToProject,
    syncMenuButton,
    toast
  };
})(window.App = window.App || {});
