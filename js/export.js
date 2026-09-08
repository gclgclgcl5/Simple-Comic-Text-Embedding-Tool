/* 图片导出：Canvas 渲染与 ZIP 下载 */
(function (App) {
  "use strict";

  const { exportName, stamp, toast } = App.Utils;
  const State = App.State;
  const { exportBtn, exportOneBtn } = App.Dom;
  const { makeZip } = App.Zip;
  const { wrapText, textInnerPad } = App.Editor;
  const BOLD_RATIO = 0.05;

  function uniqueName(base, used) {
    let n = base, k = 2;
    while (used.has(n)) n = base + ' (' + (k++) + ')';
    used.add(n);
    return n;
  }

  function safeFolderName(name) {
    return String(name || '工程').replace(/[\\/:*?"<>|]/g, '_').trim() || '工程';
  }

  function zipPartName(folder, imgName, used) {
    const fileBase = exportName(imgName);
    const base = folder ? (safeFolderName(folder) + '/' + fileBase) : fileBase;
    return uniqueName(base, used) + '.png';
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function paintGlyph(ctx, str, px, py, t, fs) {
    ctx.lineJoin = 'round';
    if (t.bold) {
      ctx.strokeStyle = t.color;
      ctx.lineWidth = Math.max(0.5, fs * BOLD_RATIO * 2);
      ctx.strokeText(str, px, py);
    }
    if (t.stroke) {
      ctx.strokeStyle = t.strokeColor;
      ctx.lineWidth = Math.max(0.5, t.strokePct * fs);
      ctx.strokeText(str, px, py);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(str, px, py);
  }

  async function renderTexts(ctx, img) {
    const used = new Set();
    img.texts.forEach(t => { if (t.fontFamily) used.add(t.fontFamily); });
    for (const fam of used) {
      try { await document.fonts.load('16px "' + fam + '"'); } catch (e) {}
    }
    ctx.textAlign = 'center';
    for (const t of img.texts) {
      if (!t.text || !t.text.trim()) continue;
      const fs = Math.max(6, Math.round(t.fontPct * img.h));
      const famRef = t.fontFamily ? ('"' + t.fontFamily + '"') : App.Utils.FONT;
      ctx.font = fs + 'px ' + famRef;
      if (t.vertical) {
        const cellH = Math.round(fs * 1.15);
        const colW = Math.max(10, fs);
        const cols = t.text.split('\n').map(s => [...s]);
        const maxLen = cols.reduce((m, col) => Math.max(m, col.length), 1);
        const x0 = t.x * img.w - (cols.length * colW) / 2 + colW / 2;
        const y0 = t.y * img.h - (maxLen * cellH) / 2 + cellH / 2;
        ctx.textBaseline = 'middle';
        for (let ci = 0; ci < cols.length; ci++) {
          const col = cols[ci];
          for (let i = 0; i < col.length; i++) {
            paintGlyph(ctx, col[i], x0 + ci * colW, y0 + i * cellH, t, fs);
          }
        }
      } else {
        const boxW = Math.max(10, t.widthPct * img.w);
        const innerW = Math.max(10, boxW - textInnerPad(t, fs));
        const lines = wrapText(t.text, fs, innerW, ctx);
        const lh = fs * 1.25;
        const cx = t.x * img.w, cy = t.y * img.h;
        const ang = ((typeof t.rotation === 'number' ? t.rotation : 0) * Math.PI) / 180;
        ctx.save();
        ctx.translate(cx, cy);
        if (ang) ctx.rotate(ang);
        ctx.textBaseline = 'middle';
        const y0 = -((lines.length - 1) * lh) / 2;
        lines.forEach((ln, i) => { if (!ln) return; paintGlyph(ctx, ln, 0, y0 + i * lh, t, fs); });
        ctx.restore();
      }
    }
  }

  async function renderImage(img) {
    const c = document.createElement('canvas');
    c.width = img.w;
    c.height = img.h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.imgEl, 0, 0, img.w, img.h);
    if (App.Draw) App.Draw.renderToExport(ctx, img);
    await renderTexts(ctx, img);
    return new Promise(res => c.toBlob(b => res(b), 'image/png'));
  }

  async function sampleColorAt(img, ix, iy) {
    const canvas = document.createElement('canvas');
    canvas.width = img.w;
    canvas.height = img.h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img.imgEl, 0, 0, img.w, img.h);
    if (App.Draw) App.Draw.renderToExport(ctx, img);
    await renderTexts(ctx, img);
    const px = Math.max(0, Math.min(img.w - 1, Math.floor(ix)));
    const py = Math.max(0, Math.min(img.h - 1, Math.floor(iy)));
    const data = ctx.getImageData(px, py, 1, 1).data;
    return '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function collectExportJobs() {
    const jobs = [];
    if (State.currentProjectId) {
      const project = State.getProject(State.currentProjectId);
      const folder = project ? project.name : null;
      State.imagesInProject(State.currentProjectId)
        .filter(i => i.selected)
        .forEach(img => jobs.push({ img, folder }));
      return jobs;
    }
    State.rootImages().filter(i => i.selected).forEach(img => {
      jobs.push({ img, folder: null });
    });
    State.projects.filter(p => p.selected).forEach(project => {
      State.imagesInProject(project.id).forEach(img => {
        jobs.push({ img, folder: project.name });
      });
    });
    return jobs;
  }

  async function exportSelected() {
    const jobs = collectExportJobs();
    if (!jobs.length) return;
    exportBtn.disabled = true;
    exportOneBtn.disabled = true;
    try {
      const used = new Set(), parts = [];
      for (let i = 0; i < jobs.length; i++) {
        exportBtn.innerHTML = `导出中 ${i + 1}/${jobs.length}`;
        const blob = await renderImage(jobs[i].img);
        parts.push({ name: zipPartName(jobs[i].folder, jobs[i].img.name, used), blob });
        await new Promise(r => setTimeout(r, 0));
      }
      const zip = await makeZip(parts);
      download(zip, '嵌字图片_' + stamp() + '.zip');
      toast('✅ 已导出 ' + parts.length + ' 张图片');
    } catch (err) {
      console.error(err);
      toast('❌ 导出失败：' + err.message, 3200);
    } finally {
      App.Gallery.syncSelectUI();
      exportOneBtn.disabled = !State.current();
    }
  }

  async function exportCurrent() {
    const img = State.current();
    if (!img) return;
    exportOneBtn.disabled = true;
    try {
      const blob = await renderImage(img);
      download(blob, exportName(img.name) + '.png');
      toast('✅ 已导出当前图片');
    } finally {
      exportOneBtn.disabled = false;
    }
  }

  App.Export = { renderImage, renderTexts, sampleColorAt, exportSelected, exportCurrent, download, uniqueName };
})(window.App = window.App || {});
