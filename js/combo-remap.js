/* 组合替换副本：先字体映射再名词替换，单次克隆一份工程 */
(function (App) {
  "use strict";

  const { toast, esc } = App.Utils;
  const Remap = () => App.RemapCopy;

  let wizardStep = 1;
  let savedFontMap = {};
  let lastSearch = null;
  let rowSeq = 1;

  function syncMenuButton() {
    Remap().syncMenuButton(
      App.Dom.comboRemapBtn,
      '先映射字体再替换名词，生成一份组合替换工程副本（原件保留）'
    );
  }

  function showStep(step) {
    wizardStep = step;
    const s1 = App.Dom.comboRemapStep1;
    const s2 = App.Dom.comboRemapStep2;
    if (s1) s1.hidden = step !== 1;
    if (s2) s2.hidden = step !== 2;
    const back = App.Dom.comboRemapBack;
    const next = App.Dom.comboRemapNext;
    const search = App.Dom.comboRemapSearch;
    const generate = App.Dom.comboRemapGenerate;
    if (back) back.hidden = step !== 2;
    if (next) next.hidden = step !== 1;
    if (search) search.hidden = step !== 2;
    if (generate) {
      generate.hidden = step !== 2;
      updateGenerateEnabled();
    }
  }

  function invalidateSearch() {
    lastSearch = null;
    updateGenerateEnabled();
  }

  function updateGenerateEnabled() {
    const btn = App.Dom.comboRemapGenerate;
    if (!btn) return;
    btn.disabled = !(lastSearch && lastSearch.total > 0);
  }

  function updateHitBadges(counts) {
    const listEl = App.Dom.comboRemapTermList;
    if (!listEl) return;
    listEl.querySelectorAll('.term-remap-row').forEach((row, i) => {
      const badge = row.querySelector('.term-remap-hits');
      if (!badge) return;
      const n = counts && typeof counts[i] === 'number' ? counts[i] : null;
      badge.textContent = n == null ? '—' : String(n);
      badge.title = n == null ? '尚未搜索' : ('命中 ' + n + ' 处');
    });
  }

  function readCaseSensitive() {
    return !!(App.Dom.comboRemapCase && App.Dom.comboRemapCase.checked);
  }

  function readRules() {
    const listEl = App.Dom.comboRemapTermList;
    if (!listEl) return [];
    const rules = [];
    listEl.querySelectorAll('.term-remap-row').forEach(row => {
      const fromEl = row.querySelector('.term-remap-from');
      const toEl = row.querySelector('.term-remap-to');
      rules.push({
        from: fromEl ? fromEl.value : '',
        to: toEl ? toEl.value : ''
      });
    });
    return rules;
  }

  function normalizeRules(rules) {
    return (rules || [])
      .map(r => ({
        from: String(r.from || '').trim(),
        to: r.to == null ? '' : String(r.to)
      }))
      .filter(r => r.from);
  }

  function rulesFingerprint(rules, caseSensitive) {
    return JSON.stringify({
      c: !!caseSensitive,
      r: normalizeRules(rules).map(r => [r.from, r.to])
    });
  }

  function ensureAtLeastOneRow() {
    const listEl = App.Dom.comboRemapTermList;
    if (!listEl) return;
    if (!listEl.querySelector('.term-remap-row')) {
      listEl.appendChild(createRuleRow('', ''));
    }
  }

  function createRuleRow(from, to) {
    const row = document.createElement('div');
    row.className = 'term-remap-row';
    row.dataset.rowId = String(rowSeq++);

    const fromInp = document.createElement('input');
    fromInp.type = 'text';
    fromInp.className = 'term-remap-from';
    fromInp.placeholder = '搜索名词';
    fromInp.value = from || '';

    const hits = document.createElement('span');
    hits.className = 'term-remap-hits';
    hits.textContent = '—';
    hits.title = '尚未搜索';

    const arrow = document.createElement('span');
    arrow.className = 'term-remap-arrow';
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');

    const toInp = document.createElement('input');
    toInp.type = 'text';
    toInp.className = 'term-remap-to';
    toInp.placeholder = '替换（留空=删除）';
    toInp.value = to == null ? '' : to;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-mini term-remap-del';
    del.textContent = '×';
    del.title = '删除此行';

    row.appendChild(fromInp);
    row.appendChild(hits);
    row.appendChild(arrow);
    row.appendChild(toInp);
    row.appendChild(del);

    row.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        invalidateSearch();
        updateHitBadges(null);
      });
    });
    del.addEventListener('click', () => {
      row.remove();
      invalidateSearch();
      updateHitBadges(null);
      ensureAtLeastOneRow();
    });
    return row;
  }

  function setTermRules(rules) {
    const listEl = App.Dom.comboRemapTermList;
    if (!listEl) return;
    listEl.innerHTML = '';
    const list = normalizeRules(rules);
    if (!list.length) listEl.appendChild(createRuleRow('', ''));
    else list.forEach(r => listEl.appendChild(createRuleRow(r.from, r.to)));
    invalidateSearch();
    updateHitBadges(null);
  }

  function closeModal() {
    const modal = App.Dom.comboRemapModal;
    if (modal && typeof modal.close === 'function') modal.close();
  }

  function openModal() {
    const R = Remap();
    const FR = App.FontRemap;
    const ctx = R.getContext();
    if (!ctx.ok) {
      toast(ctx.disabledReason || R.DISABLED_EMPTY);
      syncMenuButton();
      return false;
    }
    if (!R.hasAnyTextBox(ctx.images)) {
      toast('所选图片没有文字框，无法组合替换');
      return false;
    }
    if (!FR || !FR.collectFonts) {
      toast('字体模块未加载');
      return false;
    }
    const fonts = FR.collectFonts(ctx.images);
    if (!fonts.length) {
      toast('所选图片没有可映射的字体，请改用「换名词副本」');
      return false;
    }
    if (!FR.listTargetFonts().length) {
      toast('当前没有已加载的字体可选');
      return false;
    }

    savedFontMap = {};
    lastSearch = null;
    FR.buildMappingRowsInto(App.Dom.comboRemapFontList, fonts);
    if (App.Dom.comboRemapCase) App.Dom.comboRemapCase.checked = false;
    setTermRules([{ from: '', to: '' }]);

    const hint = App.Dom.comboRemapHint;
    if (hint) {
      hint.textContent = '将生成工程「' + R.uniqueProjectName(ctx.nameBase, '-组合替换副本') +
        '」（共 ' + ctx.images.length + ' 张）。先设置字体映射，再设置名词并搜索后生成一份副本。';
    }

    showStep(1);
    const modal = App.Dom.comboRemapModal;
    if (modal && typeof modal.showModal === 'function') modal.showModal();
    else if (modal) modal.setAttribute('open', '');
    return true;
  }

  function goNext() {
    const FR = App.FontRemap;
    savedFontMap = FR.readFontMapFrom(App.Dom.comboRemapFontList);
    showStep(2);
  }

  function goBack() {
    showStep(1);
  }

  function doSearch() {
    const R = Remap();
    const TR = App.TermRemap;
    const ctx = R.getContext();
    if (!ctx.ok) {
      toast(ctx.disabledReason || R.DISABLED_EMPTY);
      return;
    }
    const rules = normalizeRules(readRules());
    if (!rules.length) {
      toast('请至少填写一个搜索名词');
      return;
    }
    const caseSensitive = readCaseSensitive();
    const { counts, total } = TR.countHits(ctx.images, rules, caseSensitive);
    lastSearch = {
      rulesFingerprint: rulesFingerprint(rules, caseSensitive),
      caseSensitive,
      counts: counts.slice(),
      total,
      rules: rules.map(r => ({ from: r.from, to: r.to }))
    };
    updateHitBadges(counts);
    updateGenerateEnabled();
    toast(total ? ('共命中 ' + total + ' 处') : '未命中任何名词');
  }

  function showResultModal(lines) {
    const body = App.Dom.comboRemapResultBody;
    if (body) {
      body.innerHTML = '<ul class="term-remap-result-list">' +
        lines.map(s => '<li>' + esc(s) + '</li>').join('') +
        '</ul>';
    }
    const modal = App.Dom.comboRemapResultModal;
    if (modal && typeof modal.showModal === 'function') modal.showModal();
    else if (modal) modal.setAttribute('open', '');
  }

  function closeResultModal() {
    const modal = App.Dom.comboRemapResultModal;
    if (modal && typeof modal.close === 'function') modal.close();
  }

  async function doGenerate() {
    const R = Remap();
    const TR = App.TermRemap;
    const ctx = R.getContext();
    if (!ctx.ok) {
      toast(ctx.disabledReason || R.DISABLED_EMPTY);
      return;
    }
    const rules = normalizeRules(readRules());
    const caseSensitive = readCaseSensitive();
    const fp = rulesFingerprint(rules, caseSensitive);
    if (!lastSearch || lastSearch.rulesFingerprint !== fp) {
      toast('规则已变更，请先重新搜索');
      updateGenerateEnabled();
      return;
    }
    if (!lastSearch.total) {
      toast('没有命中，无法生成');
      return;
    }

    const conflicts = TR.findOverlaps(ctx.images, rules, caseSensitive);
    if (conflicts.length) {
      const msg = conflicts.slice(0, 5).map(c => '「' + c.a + '」与「' + c.b + '」').join('；');
      toast('规则命中区间重叠，已中止：' + msg + (conflicts.length > 5 ? '…' : ''), 4200);
      return;
    }

    const fontMap = savedFontMap || {};
    const result = await R.runCloneToProject({
      nameSuffix: '-组合替换副本',
      logLabel: 'combo-remap',
      textTransform: texts => texts.map(t => {
        const next = Object.assign({}, t);
        const oldFam = typeof next.fontFamily === 'string' ? next.fontFamily : '';
        if (oldFam && Object.prototype.hasOwnProperty.call(fontMap, oldFam)) {
          next.fontFamily = fontMap[oldFam];
        }
        next.text = TR.applyRulesToText(next.text || '', rules, caseSensitive);
        return next;
      })
    });

    if (!result.ok) {
      toast('生成失败：' + (result.error || '未知错误'));
      return;
    }

    closeModal();
    const lines = [];
    lines.push('已生成「' + result.projectName + '」（' + result.created.length + ' 张）');
    lines.push('—— 字体 ——');
    const fontKeys = Object.keys(fontMap);
    if (!fontKeys.length) lines.push('（无字体映射）');
    else {
      fontKeys.forEach(from => {
        const to = fontMap[from];
        lines.push(from + ' → ' + to + (from === to ? '（未改）' : ''));
      });
    }
    lines.push('—— 名词 ——');
    rules.forEach((r, i) => {
      const n = lastSearch.counts[i] || 0;
      const toLabel = r.to === '' ? '（删除）' : r.to;
      lines.push(r.from + ' → ' + toLabel + '：' + n + ' 处');
    });
    showResultModal(lines);
    toast('已生成「' + result.projectName + '」');
  }

  function importTxtFile(file) {
    if (!file || !App.TermRemap) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = App.TermRemap.parseTxtRules(String(reader.result || ''));
      if (!parsed.length) {
        toast('未从文件中解析到有效规则（格式：搜索=替换）');
        return;
      }
      setTermRules(parsed);
      toast('已导入 ' + parsed.length + ' 条规则');
    };
    reader.onerror = () => toast('读取文件失败');
    reader.readAsText(file, 'UTF-8');
  }

  function init() {
    const {
      comboRemapBtn, comboRemapModal, comboRemapClose, comboRemapCancel,
      comboRemapBack, comboRemapNext, comboRemapSearch, comboRemapGenerate,
      comboRemapAddRow, comboRemapImport, comboRemapImportInput, comboRemapCase,
      comboRemapResultModal, comboRemapResultClose, comboRemapResultOk
    } = App.Dom;

    if (comboRemapBtn) {
      comboRemapBtn.addEventListener('click', () => {
        const more = comboRemapBtn.closest('details.header-more');
        if (more) more.open = false;
        openModal();
      });
    }

    if (comboRemapClose) comboRemapClose.addEventListener('click', closeModal);
    if (comboRemapCancel) comboRemapCancel.addEventListener('click', closeModal);
    if (comboRemapModal) {
      comboRemapModal.addEventListener('click', e => {
        if (e.target === comboRemapModal) closeModal();
      });
    }
    if (comboRemapNext) comboRemapNext.addEventListener('click', goNext);
    if (comboRemapBack) comboRemapBack.addEventListener('click', goBack);
    if (comboRemapSearch) comboRemapSearch.addEventListener('click', doSearch);
    if (comboRemapGenerate) {
      comboRemapGenerate.addEventListener('click', async () => {
        comboRemapGenerate.disabled = true;
        try {
          await doGenerate();
        } finally {
          updateGenerateEnabled();
        }
      });
    }
    if (comboRemapCase) {
      comboRemapCase.addEventListener('change', () => {
        invalidateSearch();
        updateHitBadges(null);
      });
    }
    if (comboRemapAddRow) {
      comboRemapAddRow.addEventListener('click', () => {
        const listEl = App.Dom.comboRemapTermList;
        if (!listEl) return;
        listEl.appendChild(createRuleRow('', ''));
        invalidateSearch();
      });
    }
    if (comboRemapImport && comboRemapImportInput) {
      comboRemapImport.addEventListener('click', () => comboRemapImportInput.click());
      comboRemapImportInput.addEventListener('change', () => {
        const f = comboRemapImportInput.files && comboRemapImportInput.files[0];
        comboRemapImportInput.value = '';
        if (f) importTxtFile(f);
      });
    }

    const closeResult = () => closeResultModal();
    if (comboRemapResultClose) comboRemapResultClose.addEventListener('click', closeResult);
    if (comboRemapResultOk) comboRemapResultOk.addEventListener('click', closeResult);
    if (comboRemapResultModal) {
      comboRemapResultModal.addEventListener('click', e => {
        if (e.target === comboRemapResultModal) closeResultModal();
      });
    }

    syncMenuButton();
  }

  App.ComboRemap = {
    openModal,
    closeModal,
    syncMenuButton,
    init
  };
})(window.App = window.App || {});
