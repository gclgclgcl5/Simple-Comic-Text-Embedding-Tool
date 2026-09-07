/* 内置字体与上传字体 */
(function (App) {
  "use strict";

  const { fontFormat, sanitizeFamily, baseNameFromPath, baseName, toast } = App.Utils;
  const { customFonts } = App.State;
  const { tbFont } = App.Dom;
  const { readZipEntries, inflateEntry } = App.Zip;

  const BUNDLED_FONTS = [
    { family: '方正卡通简体', files: ['字体样式/方正卡通简体/方正卡通简体/方正卡通_GBK.ttf'] },
    { family: '文渊圆体-常规', files: ['字体样式/文渊圆体/文渊圆体/WenYuanRoundedSC-TTF/WenYuanRoundedSC-Regular.ttf'] },
    { family: '文渊圆体-中', files: ['字体样式/文渊圆体/文渊圆体/WenYuanRoundedSC-TTF/WenYuanRoundedSC-Medium.ttf'] },
  ];

  const bundledFamilies = new Set(BUNDLED_FONTS.map(f => f.family));

  function injectBundledFonts() {
    let css = '';
    for (const f of BUNDLED_FONTS) {
      for (const file of f.files) {
        css += '@font-face{font-family:"' + f.family + '";src:url("' + file + '") format("' + fontFormat(file) + '");font-display:swap;}\n';
      }
    }
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function refreshFontSelect() {
    const prev = tbFont.value;
    tbFont.innerHTML = '';
    const o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = '默认（系统字体）';
    tbFont.appendChild(o0);
    const g1 = document.createElement('optgroup');
    g1.label = '内置样式';
    BUNDLED_FONTS.forEach(f => {
      const o = document.createElement('option');
      o.value = f.family;
      o.textContent = f.family;
      g1.appendChild(o);
    });
    tbFont.appendChild(g1);
    if (customFonts.length) {
      const g2 = document.createElement('optgroup');
      g2.label = '上传样式';
      customFonts.forEach(n => {
        const o = document.createElement('option');
        o.value = n;
        o.textContent = n;
        g2.appendChild(o);
      });
      tbFont.appendChild(g2);
    }
    tbFont.value = prev;
  }

  function toArrayBuffer(data) {
    if (data instanceof ArrayBuffer) return data;
    if (data instanceof Uint8Array) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return data;
  }

  async function loadFontFromStorage(family, data) {
    if (bundledFamilies.has(family) || customFonts.includes(family)) return;
    const ff = new FontFace(family, data);
    await ff.load();
    document.fonts.add(ff);
    customFonts.push(family);
  }

  async function registerFont(family, data, opts) {
    opts = opts || {};
    if (customFonts.includes(family)) {
      if (!opts.silent) toast('字体「' + family + '」已存在');
      return;
    }
    const ff = new FontFace(family, data);
    await ff.load();
    document.fonts.add(ff);
    customFonts.push(family);
    refreshFontSelect();
    if (!opts.silent) toast('已加载字体：' + family);
    if (App.Storage && App.Storage.isAvailable() && !App.Storage.isRestoring()) {
      await App.Storage.saveFont(family, toArrayBuffer(data), opts.fileName || family);
    }
  }

  async function addFontFile(file) {
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.zip')) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const entries = readZipEntries(buf);
        let n = 0;
        for (const en of entries) {
          const nm = en.name.toLowerCase();
          if (en.name.includes('__MACOSX') || en.name.startsWith('._')) continue;
          if (/\.(ttf|otf|woff2?)$/.test(nm)) {
            const data = await inflateEntry(en);
            const family = sanitizeFamily(baseNameFromPath(en.name));
            await registerFont(family, data, { fileName: baseNameFromPath(en.name) });
            n++;
          }
        }
        if (!n) throw new Error('压缩包里没有找到字体文件（支持 ttf/otf/woff/woff2）');
        return n;
      }
      if (!/\.(ttf|otf|woff2?)$/.test(lower)) throw new Error('仅支持 ttf / otf / woff / woff2 / zip');
      const buf = new Uint8Array(await file.arrayBuffer());
      const family = sanitizeFamily(baseName(file.name));
      await registerFont(family, buf, { fileName: file.name });
      return 1;
    } catch (e) {
      toast('字体加载失败：' + e.message, 3200);
      return 0;
    }
  }

  App.Fonts = { BUNDLED_FONTS, injectBundledFonts, refreshFontSelect, addFontFile, registerFont, loadFontFromStorage };
})(window.App = window.App || {});
