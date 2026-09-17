/* 换字体副本：扫描勾选范围字体、映射后整份克隆到新工程 */
(function (App) {
  "use strict";

  const { toast } = App.Utils;
  const Remap = () => App.RemapCopy;

  function collectFonts(images) {
    const set = new Set();
    (images || []).forEach(img => {
      (img.texts || []).forEach(t => {
        const fam = t && typeof t.fontFamily === 'string' ? t.fontFamily.trim() : '';
        if (fam) set.add(fam);
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'));
  }

  function listTargetFonts() {
    if (App.Fonts && App.Fonts.listLoadedFamilies) return App.Fonts.listLoadedFamilies();
    return [];
  }

  function syncMenuButton() {
    Remap().syncMenuButton(
      App.Dom.fontRemapBtn,
      '按字体映射生成嵌字工程副本（原件保留）'
    );
  }

  function fillFontSelect(select, families, selected) {
    select.innerHTML = '';
    const list = families.slice();
    if (selected && list.indexOf(selected) < 0) list.unshift(selected);
    list.forEach(fam => {
      const opt = document.createElement('option');
      opt.value = fam;
      opt.textContent = fam;
      if (fam === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function buildMappingRowsInto(listEl, fonts) {
    if (!listEl) return;
    listEl.innerHTML = '';
    const targets = listTargetFonts();
    fonts.forEach(fam => {
      const row = document.createElement('div');
      row.className = 'font-remap-row';
      row.dataset.from = fam;

      const label = document.createElement('span');
      label.className = 'font-remap-from';
      label.textContent = fam;
      label.title = fam;

      const arrow = document.createElement('span');
      arrow.className = 'font-remap-arrow';
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');

      const select = document.createElement('select');
      select.className = 'font-remap-to';
      select.setAttribute('aria-label', '替换「' + fam + '」为');
      fillFontSelect(select, targets, fam);

      row.appendChild(label);
      row.appendChild(arrow);
      row.appendChild(select);
      listEl.appendChild(row);
    });
  }

  function buildMappingRows(fonts) {
    buildMappingRowsInto(App.Dom.fontRemapList, fonts);
  }

  function readFontMapFrom(listEl) {
    const map = {};
    if (!listEl) return map;
    listEl.querySelectorAll('.font-remap-row').forEach(row => {
      const from = row.dataset.from;
      const select = row.querySelector('select.font-remap-to');
      if (!from || !select) return;
      map[from] = select.value || from;
    });
    return map;
  }

  function readFontMapFromModal() {
    return readFontMapFrom(App.Dom.fontRemapList);
  }

  function closeModal() {
    const modal = App.Dom.fontRemapModal;
    if (modal && typeof modal.close === 'function') modal.close();
  }

  function openModal() {
    const R = Remap();
    const ctx = R.getContext();
    if (!ctx.ok) {
      toast(ctx.disabledReason || R.DISABLED_EMPTY);
      syncMenuButton();
      return false;
    }
    if (!R.hasAnyTextBox(ctx.images)) {
      toast('所选图片没有文字框，无法换字体');
      return false;
    }
    const fonts = collectFonts(ctx.images);
    if (!fonts.length) {
      toast('所选图片没有可映射的字体');
      return false;
    }
    if (!listTargetFonts().length) {
      toast('当前没有已加载的字体可选');
      return false;
    }

    buildMappingRows(fonts);
    const hint = App.Dom.fontRemapHint;
    if (hint) {
      hint.textContent = '将生成工程「' + R.uniqueProjectName(ctx.nameBase, '-换字体副本') +
        '」（共 ' + ctx.images.length + ' 张）。「当前 → 当前」表示不替换该字体。';
    }
    const modal = App.Dom.fontRemapModal;
    if (modal && typeof modal.showModal === 'function') modal.showModal();
    else if (modal) modal.setAttribute('open', '');
    return true;
  }

  async function run(fontMap) {
    const R = Remap();
    const ctx = R.getContext();
    if (!ctx.ok) {
      toast(ctx.disabledReason || R.DISABLED_EMPTY);
      return false;
    }
    if (!R.hasAnyTextBox(ctx.images) || !collectFonts(ctx.images).length) {
      toast('所选图片没有可映射的字体');
      return false;
    }

    const map = fontMap || {};
    const result = await R.runCloneToProject({
      nameSuffix: '-换字体副本',
      logLabel: 'font-remap',
      textTransform: texts => texts.map(t => {
        const next = Object.assign({}, t);
        const oldFam = typeof next.fontFamily === 'string' ? next.fontFamily : '';
        if (oldFam && Object.prototype.hasOwnProperty.call(map, oldFam)) {
          next.fontFamily = map[oldFam];
        }
        return next;
      })
    });

    if (!result.ok) {
      toast('生成失败：' + (result.error || '未知错误'));
      return false;
    }
    toast('已生成「' + result.projectName + '」（' + result.created.length + ' 张）');
    return true;
  }

  function init() {
    const {
      fontRemapBtn, fontRemapModal, fontRemapClose, fontRemapCancel, fontRemapConfirm
    } = App.Dom;

    if (fontRemapBtn) {
      fontRemapBtn.addEventListener('click', () => {
        const more = fontRemapBtn.closest('details.header-more');
        if (more) more.open = false;
        openModal();
      });
    }

    const close = () => closeModal();
    if (fontRemapClose) fontRemapClose.addEventListener('click', close);
    if (fontRemapCancel) fontRemapCancel.addEventListener('click', close);
    if (fontRemapModal) {
      fontRemapModal.addEventListener('click', e => {
        if (e.target === fontRemapModal) closeModal();
      });
    }
    if (fontRemapConfirm) {
      fontRemapConfirm.addEventListener('click', async () => {
        fontRemapConfirm.disabled = true;
        try {
          const map = readFontMapFromModal();
          const ok = await run(map);
          if (ok) closeModal();
        } finally {
          fontRemapConfirm.disabled = false;
        }
      });
    }

    syncMenuButton();
  }

  App.FontRemap = {
    getContext: () => Remap().getContext(),
    collectFonts,
    uniqueProjectName: (base) => Remap().uniqueProjectName(base, '-换字体副本'),
    listTargetFonts,
    buildMappingRowsInto,
    readFontMapFrom,
    run,
    openModal,
    closeModal,
    syncMenuButton,
    init
  };
})(window.App = window.App || {});
