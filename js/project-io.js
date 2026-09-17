/* 汉化工程包：导出 / 导入（ZIP + manifest） */
(function (App) {
  "use strict";

  const FORMAT = 'image-text-tool-project';
  const VERSION = 2;

  const { stamp, toast, isNameTaken } = App.Utils;
  const State = App.State;

  function safeFilePart(name) {
    return String(name || 'file').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').slice(0, 80) || 'file';
  }

  function extFromName(name, fallback) {
    const m = String(name || '').match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : (fallback || 'bin');
  }

  function findEntry(entries, path) {
    const norm = String(path || '').replace(/^\.\//, '');
    return entries.find(e => e.name === norm || e.name.replace(/\\/g, '/') === norm) || null;
  }

  async function entryToUint8(en) {
    return App.Zip.inflateEntry(en);
  }

  async function entryToText(en) {
    const data = await entryToUint8(en);
    return new TextDecoder().decode(data);
  }

  async function entryToBlob(en, mime) {
    const data = await entryToUint8(en);
    return new Blob([data], { type: mime || 'application/octet-stream' });
  }

  function parseManifestFromEntries(entries) {
    const en = findEntry(entries, 'manifest.json');
    if (!en) return null;
    return entryToText(en).then(raw => {
      const man = JSON.parse(raw);
      if (!man || man.format !== FORMAT) return null;
      return man;
    }).catch(() => null);
  }

  async function isProjectZipFile(file) {
    if (!file || !/\.zip$/i.test(file.name)) return false;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const entries = App.Zip.readZipEntries(buf);
      const man = await parseManifestFromEntries(entries);
      return !!man;
    } catch (e) {
      return false;
    }
  }

  function collectCustomFontFamilies(images) {
    const set = new Set();
    (images || []).forEach(img => {
      (img.texts || []).forEach(t => {
        if (!t.fontFamily) return;
        if (App.Fonts && App.Fonts.isBundledFamily(t.fontFamily)) return;
        set.add(t.fontFamily);
      });
    });
    return [...set];
  }

  async function buildRasterBlob(img) {
    if (!img.draw || !img.draw.rasterCanvas) return null;
    if (!App.Storage.canvasHasInk(img.draw.rasterCanvas)) return null;
    return App.Storage.canvasToBlob(img.draw.rasterCanvas);
  }

  function syncExportLabels() {
    const { exportOneBtn, exportBtn, teamModeToggle } = App.Dom;
    const team = State.isTeamMode();
    if (teamModeToggle) teamModeToggle.checked = team;
    if (exportOneBtn) {
      const label = team ? '导出工程' : '导出这张';
      exportOneBtn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-download"/></svg>${label}`;
      exportOneBtn.title = team
        ? '导出当前图片为可继续编辑的工程包 ZIP'
        : '导出当前图片为 PNG';
    }
    if (exportBtn && App.Gallery) App.Gallery.syncSelectUI();
  }

  /**
   * @param {object[]} images
   * @param {{ progressEl?: HTMLElement }} opts
   */
  async function exportZip(images, opts) {
    opts = opts || {};
    const list = (images || []).filter(Boolean);
    if (!list.length) {
      toast('没有可导出的图片');
      return;
    }

    const parts = [];
    const manifestImages = [];
    const projectIds = new Set();
    const usedFontFiles = new Set();

    for (let i = 0; i < list.length; i++) {
      const img = list[i];
      if (opts.progressEl) {
        opts.progressEl.innerHTML = `导出工程 ${i + 1}/${list.length}`;
      }
      if (!img.sourceBlob) throw new Error('缺少原图数据：' + (img.name || img.id));

      const id = img.id;
      const imgPath = 'images/' + id + '.png';
      const editPath = 'edits/' + id + '.json';
      let rasterPath = null;

      parts.push({ name: imgPath, blob: img.sourceBlob });

      const snap = App.Storage.snapshotEdit(img);
      const editPayload = { ...snap };

      if (App.Draw && typeof App.Draw.serializeUndoForDisk === 'function') {
        try {
          const hist = await App.Draw.serializeUndoForDisk(img);
          if (hist && Array.isArray(hist.undo) && hist.undo.length) {
            const undoMeta = [];
            for (let hi = 0; hi < hist.undo.length; hi++) {
              const step = hist.undo[hi] || {};
              const shapes = JSON.parse(JSON.stringify(step.shapes || []));
              let rasterRef = null;
              if (step.rasterBlob) {
                rasterRef = 'edits/' + id + '-hist-' + hi + '.png';
                parts.push({ name: rasterRef, blob: step.rasterBlob });
              }
              undoMeta.push({ shapes, raster: rasterRef });
            }
            editPayload.drawHistory = { undo: undoMeta };
          }
        } catch (e) {
          console.warn('export draw history', img.name, e);
        }
      }

      parts.push({
        name: editPath,
        blob: new Blob([JSON.stringify(editPayload)], { type: 'application/json' })
      });

      const rasterBlob = await buildRasterBlob(img);
      if (rasterBlob) {
        rasterPath = 'edits/' + id + '-raster.png';
        parts.push({ name: rasterPath, blob: rasterBlob });
      }

      if (img.projectId) projectIds.add(img.projectId);

      manifestImages.push({
        id,
        name: img.name,
        w: img.w,
        h: img.h,
        selected: !!img.selected,
        projectId: img.projectId || null,
        file: imgPath,
        edit: editPath,
        raster: rasterPath
      });
      await new Promise(r => setTimeout(r, 0));
    }

    const projects = State.projects
      .filter(p => projectIds.has(p.id))
      .map(p => ({ id: p.id, name: p.name, selected: !!p.selected }));

    const fontFamilies = collectCustomFontFamilies(list);
    const fontsMeta = [];
    for (const family of fontFamilies) {
      const rec = App.Storage.isAvailable() ? await App.Storage.getFont(family) : null;
      if (!rec || !rec.data) continue;
      const ext = extFromName(rec.fileName, 'ttf');
      let fileName = 'fonts/' + safeFilePart(family) + '.' + ext;
      let n = 2;
      while (usedFontFiles.has(fileName)) {
        fileName = 'fonts/' + safeFilePart(family) + '_' + (n++) + '.' + ext;
      }
      usedFontFiles.add(fileName);
      parts.push({ name: fileName, blob: new Blob([rec.data]) });
      fontsMeta.push({ family, file: fileName });
    }

    const manifest = {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      projects,
      images: manifestImages,
      fonts: fontsMeta
    };
    parts.unshift({
      name: 'manifest.json',
      blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    });

    const zip = await App.Zip.makeZip(parts);
    App.Export.download(zip, '嵌字工程_' + stamp() + '.zip');
    toast('✅ 已导出工程包（' + list.length + ' 张）');
  }

  function resolveUniqueName(scopeImages, name) {
    if (!isNameTaken(scopeImages, name, null)) return name;
    const base = String(name || 'image');
    let k = 2;
    let candidate = base + ' (' + k + ')';
    while (isNameTaken(scopeImages, candidate, null)) {
      k++;
      candidate = base + ' (' + k + ')';
    }
    return candidate;
  }

  function ensureProjectMapping(packProjects) {
    const map = new Map();
    (packProjects || []).forEach(p => {
      if (!p || !p.name) return;
      let local = State.projects.find(x => x.name === p.name);
      if (!local) {
        local = { id: State.uid(), name: p.name, selected: false };
        State.projects.push(local);
      }
      map.set(p.id, local.id);
    });
    return map;
  }

  async function importZip(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const entries = App.Zip.readZipEntries(buf);
    const manifest = await parseManifestFromEntries(entries);
    if (!manifest) throw new Error('不是有效的嵌字工程包');

    // fonts first
    for (const f of (manifest.fonts || [])) {
      if (!f || !f.family || !f.file) continue;
      if (App.Fonts.isBundledFamily(f.family)) continue;
      if (State.customFonts.includes(f.family)) continue;
      const en = findEntry(entries, f.file);
      if (!en) continue;
      const data = await entryToUint8(en);
      await App.Fonts.registerFont(f.family, data, {
        fileName: f.file.split('/').pop(),
        silent: true
      });
    }
    App.Fonts.refreshFontSelect();

    const projectMap = ensureProjectMapping(manifest.projects);
    let imported = 0;
    let selectId = null;

    for (const meta of (manifest.images || [])) {
      if (!meta || !meta.file) continue;
      const imgEn = findEntry(entries, meta.file);
      if (!imgEn) {
        console.warn('missing image', meta.file);
        continue;
      }
      const blob = await entryToBlob(imgEn, 'image/png');
      const newId = State.uid();
      let projectId = null;
      if (meta.projectId && projectMap.has(meta.projectId)) {
        projectId = projectMap.get(meta.projectId);
      }

      const scope = projectId
        ? State.imagesInProject(projectId)
        : State.rootImages();
      const name = resolveUniqueName(scope, meta.name || ('image_' + newId));

      const url = URL.createObjectURL(blob);
      const el = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
        im.src = url;
      });

      const img = {
        id: newId,
        name,
        url,
        imgEl: el,
        w: meta.w || el.naturalWidth,
        h: meta.h || el.naturalHeight,
        sourceBlob: blob,
        texts: [],
        draw: App.Gallery.createDrawState(),
        selected: !!meta.selected,
        projectId
      };

      let editJson = null;
      if (meta.edit) {
        const editEn = findEntry(entries, meta.edit);
        if (editEn) {
          try {
            editJson = JSON.parse(await entryToText(editEn));
            img.texts = JSON.parse(JSON.stringify(editJson.texts || []));
            if (editJson.draw) {
              // tool/color/sizes 为全局偏好，工程包内旧字段不覆盖
              img.draw.selectedShapeId = null;
            }
            img.draw.shapes = JSON.parse(JSON.stringify(editJson.shapes || []));
          } catch (e) {
            console.warn('edit parse', meta.edit, e);
            editJson = null;
          }
        }
      }

      if (meta.raster) {
        const rEn = findEntry(entries, meta.raster);
        if (rEn && App.Draw) {
          try {
            const rBlob = await entryToBlob(rEn, 'image/png');
            const canvas = App.Draw.ensureRaster(img);
            await App.Storage.restoreRaster(canvas, rBlob);
          } catch (e) {
            console.warn('raster restore', meta.raster, e);
          }
        }
      }

      if (editJson && editJson.drawHistory && Array.isArray(editJson.drawHistory.undo) && App.Draw && App.Draw.hydrateUndoFromDisk) {
        const histEntries = [];
        for (let hi = 0; hi < editJson.drawHistory.undo.length; hi++) {
          const step = editJson.drawHistory.undo[hi] || {};
          let rasterBlobStep = null;
          if (step.raster) {
            const hEn = findEntry(entries, step.raster);
            if (hEn) {
              try {
                rasterBlobStep = await entryToBlob(hEn, 'image/png');
              } catch (e) {
                console.warn('hist raster', step.raster, e);
              }
            }
          }
          histEntries.push({
            shapes: JSON.parse(JSON.stringify(step.shapes || [])),
            rasterBlob: rasterBlobStep
          });
        }
        try {
          await App.Draw.hydrateUndoFromDisk(img, histEntries);
        } catch (e) {
          console.warn('hydrate draw history', meta.edit, e);
        }
      }

      State.images.push(img);
      if (App.Storage.isAvailable()) {
        await App.Storage.saveImageMeta(img);
        const snap = App.Storage.snapshotEdit(img);
        let rasterBlob = null;
        if (img.draw.rasterCanvas && App.Storage.canvasHasInk(img.draw.rasterCanvas)) {
          rasterBlob = await App.Storage.canvasToBlob(img.draw.rasterCanvas);
        }
        let drawHistory = null;
        if (App.Draw && typeof App.Draw.serializeUndoForDisk === 'function') {
          try {
            const hist = await App.Draw.serializeUndoForDisk(img);
            if (hist && Array.isArray(hist.undo) && hist.undo.length) drawHistory = hist;
          } catch (e) {
            console.warn('serialize draw history on import', e);
          }
        }
        await App.Storage.saveEdit(img.id, { ...snap, rasterBlob, drawHistory: drawHistory || null });
      }
      imported++;
      if (!selectId) selectId = img.id;
      await new Promise(r => setTimeout(r, 0));
    }

    if (App.Storage.isAvailable()) await App.Storage.saveSession();
    App.Gallery.renderThumbs();
    App.Gallery.syncSelectUI();
    if (selectId) App.Editor.selectImage(selectId);
    toast('✅ 已导入工程包（' + imported + ' 张）');
    return imported;
  }

  App.ProjectIO = {
    FORMAT,
    VERSION,
    exportZip,
    importZip,
    isProjectZipFile,
    syncExportLabels
  };
})(window.App = window.App || {});
