/* 通用常量与工具函数 */
(function (App) {
  "use strict";

  const FONT = 'system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';

  const $ = id => document.getElementById(id);

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const baseName = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; };

  const exportName = n => baseName(n) + '已嵌字';

  const stamp = () => {
    const d = new Date(), p = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };

  function fontFormat(n) {
    const l = n.toLowerCase();
    return l.endsWith('.otf') ? 'opentype' : l.endsWith('.woff2') ? 'woff2' : l.endsWith('.woff') ? 'woff' : 'truetype';
  }

  function sanitizeFamily(n) {
    n = String(n).replace(/["\\]/g, '').trim();
    const customFonts = App.State ? App.State.customFonts : [];
    return n || ('自定义字体' + (customFonts.length + 1));
  }

  function baseNameFromPath(p) {
    const i = p.replace(/\\/g, '/').lastIndexOf('/');
    return baseName(i >= 0 ? p.slice(i + 1) : p);
  }

  let toastTimer;
  function toast(msg, ms = 2400) {
    const toastEl = App.Dom && App.Dom.toastEl;
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  App.Utils = { FONT, $, esc, baseName, exportName, stamp, fontFormat, sanitizeFamily, baseNameFromPath, toast };
})(window.App = window.App || {});
