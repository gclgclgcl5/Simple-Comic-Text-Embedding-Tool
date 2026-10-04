/* 工作台预览降采样：原图 w/h 不变，舞台与画笔走 previewW/H */
(function (App) {
  "use strict";

  const PREVIEW_MAX_SIDE = 1800;

  function previewSize(w, h) {
    w = Math.max(1, Math.round(Number(w) || 1));
    h = Math.max(1, Math.round(Number(h) || 1));
    const long = Math.max(w, h);
    if (long <= PREVIEW_MAX_SIDE) {
      return { previewW: w, previewH: h, scale: 1 };
    }
    const scale = PREVIEW_MAX_SIDE / long;
    return {
      previewW: Math.max(1, Math.round(w * scale)),
      previewH: Math.max(1, Math.round(h * scale)),
      scale
    };
  }

  function rasterW(img) {
    if (!img) return 1;
    if (img.previewW) return img.previewW;
    return Math.max(1, img.w || 1);
  }

  function rasterH(img) {
    if (!img) return 1;
    if (img.previewH) return img.previewH;
    return Math.max(1, img.h || 1);
  }

  function displayUrl(img) {
    if (!img) return '';
    return img.previewUrl || img.url || '';
  }

  function previewSource(img) {
    if (!img) return null;
    return img.previewEl || img.imgEl || null;
  }

  function attach(img) {
    if (!img || !img.imgEl) return img;
    const w = img.w || img.imgEl.naturalWidth || 1;
    const h = img.h || img.imgEl.naturalHeight || 1;
    const sz = previewSize(w, h);
    img.previewW = sz.previewW;
    img.previewH = sz.previewH;
    if (sz.scale >= 1) {
      img.previewEl = img.imgEl;
      img.previewUrl = img.url;
      return img;
    }
    const c = document.createElement('canvas');
    c.width = sz.previewW;
    c.height = sz.previewH;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(img.imgEl, 0, 0, sz.previewW, sz.previewH);
    img.previewEl = c;
    try {
      img.previewUrl = c.toDataURL('image/jpeg', 0.88);
    } catch (e) {
      img.previewUrl = img.url;
    }
    return img;
  }

  function blitCanvas(src, destW, destH) {
    if (!src || !destW || !destH) return null;
    if (src.width === destW && src.height === destH) return src;
    const c = document.createElement('canvas');
    c.width = destW;
    c.height = destH;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, destW, destH);
    return c;
  }

  App.Preview = {
    PREVIEW_MAX_SIDE,
    previewSize,
    rasterW,
    rasterH,
    displayUrl,
    previewSource,
    attach,
    blitCanvas
  };
})(window.App = window.App || {});
