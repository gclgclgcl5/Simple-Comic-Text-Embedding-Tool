/* 换名词副本：整词搜索/替换、txt 导入、冲突检测后克隆到新工程 */
(function (App) {
  "use strict";

  const { toast, esc } = App.Utils;
  const Remap = () => App.RemapCopy;

  let lastSearch = null;
  let rowSeq = 1;

  function isWordChar(ch) {
    if (!ch) return false;
    if (ch === '_') return true;
    const code = ch.codePointAt(0);
    // ASCII letter/digit
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return true;
    // CJK Unified + Ext A, Hiragana, Katakana, Hangul syllables
    if (code >= 0x3400 && code <= 0x4DBF) return true;
    if (code >= 0x4E00 && code <= 0x9FFF) return true;
    if (code >= 0x3040 && code <= 0x30FF) return true;
    if (code >= 0xAC00 && code <= 0xD7AF) return true;
    // Other letters via Unicode property when available
    try {
      return /\p{L}|\p{N}/u.test(ch);
    } catch (e) {
      return false;
    }
  }

  function fold(s) {
    return String(s).toLocaleLowerCase();
  }

  function findWholeWordMatches(text, needle, caseSensitive) {
    const src = String(text || '');
    const rawNeedle = String(needle || '');
    if (!src || !rawNeedle) return [];
    const hay = caseSensitive ? src : fold(src);
    const ndl = caseSensitive ? rawNeedle : fold(rawNeedle);
    const nlen = ndl.length;
    if (!nlen) return [];
    const out = [];
    let from = 0;
    while (from <= hay.length - nlen) {
      const idx = hay.indexOf(ndl, from);
      if (idx < 0) break;
      const end = idx + nlen;
      const left = idx > 0 ? src[idx - 1] : '';
      const right = end < src.length ? src[end] : '';
      if (!isWordChar(left) && !isWordChar(right)) {
        out.push({ start: idx, end });
      }
      from = idx + 1;
    }
    return out;
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

  function countHits(images, rules, caseSensitive) {
    const list = normalizeRules(rules);
    const counts = list.map(() => 0);
    (images || []).forEach(img => {
      (img.texts || []).forEach(t => {
        const text = t && t.text != null ? String(t.text) : '';
        list.forEach((rule, i) => {
          counts[i] += findWholeWordMatches(text, rule.from, caseSensitive).length;
        });
      });
    });
    const total = counts.reduce((a, b) => a + b, 0);
    return { counts, total, rules: list };
  }

  function findOverlaps(images, rules, caseSensitive) {
    const list = normalizeRules(rules);
    const conflicts = [];
    const seen = new Set();

    function addConflict(a, b) {
      const key = a < b ? a + '\0' + b : b + '\0' + a;
      if (seen.has(key)) return;
      seen.add(key);
      conflicts.push({ a, b });
    }

    (images || []).forEach(img => {
      (img.texts || []).forEach(t => {
        const text = t && t.text != null ? String(t.text) : '';
        const ranges = [];
        list.forEach((rule, i) => {
          findWholeWordMatches(text, rule.from, caseSensitive).forEach(m => {
            ranges.push({ start: m.start, end: m.end, from: rule.from, index: i });
          });
        });
        for (let i = 0; i < ranges.length; i++) {
          for (let j = i + 1; j < ranges.length; j++) {
            if (ranges[i].index === ranges[j].index) continue;
            const A = ranges[i];
            const B = ranges[j];
            if (A.start < B.end && B.start < A.end) {
              addConflict(A.from, B.from);
            }
          }
        }
      });
    });
    return conflicts;
  }

  /** 各规则独立扫原文，从右往左替换（无重叠时安全，互不连锁） */
  function applyRulesToText(text, rules, caseSensitive) {
    const src = String(text || '');
    const list = normalizeRules(rules);
    const ops = [];
    list.forEach(rule => {
      findWholeWordMatches(src, rule.from, caseSensitive).forEach(m => {
        ops.push({ start: m.start, end: m.end, to: rule.to });
      });
    });
    ops.sort((a, b) => b.start - a.start);
    let out = src;
    ops.forEach(op => {
      out = out.slice(0, op.start) + op.to + out.slice(op.end);
    });
    return out;
  }

  function parseTxtRules(text) {
    const map = new Map();
    String(text || '').split(/\r?\n/).forEach(line => {
      const raw = line.trim();
      if (!raw || raw.charAt(0) === '#') return;
      const eq = raw.indexOf('=');
      if (eq < 0) return;
      const from = raw.slice(0, eq).trim();
      const to = raw.slice(eq + 1).trim();
      if (!from) return;
      map.set(from, to);
    });
    return Array.from(map.entries()).map(([from, to]) => ({ from, to }));
  }

  function syncMenuButton() {
    Remap().syncMenuButton(
      App.Dom.termRemapBtn,
      '按名词规则生成嵌字工程副本（原件保留）'
    );
  }

  function invalidateSearch() {
    lastSearch = null;
    updateReplaceEnabled();
  }

  function readCaseSensitive() {
    const el = App.Dom.termRemapCase;
    return !!(el && el.checked);
  }

  function readRulesFromModal() {
    const listEl = App.Dom.termRemapList;
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

  function updateHitBadges(counts) {
    const listEl = App.Dom.termRemapList;
    if (!listEl) return;
    const rows = listEl.querySelectorAll('.term-remap-row');
    rows.forEach((row, i) => {
      const badge = row.querySelector('.term-remap-hits');
      if (!badge) return;
      const n = counts && typeof counts[i] === 'number' ? counts[i] : null;
      badge.textContent = n == null ? '—' : String(n);
      badge.title = n == null ? '尚未搜索' : ('命中 ' + n + ' 处');
    });
  }

  function updateReplaceEnabled() {
    const btn = App.Dom.termRemapReplace;
    if (!btn) return;
    const ok = !!(lastSearch && lastSearch.total > 0);
    btn.disabled = !ok;
  }

  function bindRowEvents(row) {
    row.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        invalidateSearch();
        updateHitBadges(null);
      });
    });
    const del = row.querySelector('.term-remap-del');
    if (del) {
      del.addEventListener('click', () => {
        row.remove();
        invalidateSearch();
        updateHitBadges(null);
        ensureAtLeastOneRow();
      });
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
    fromInp.setAttribute('aria-label', '搜索名词');

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
    toInp.setAttribute('aria-label', '替换名词，留空表示删除');

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-mini term-remap-del';
    del.textContent = '×';
    del.title = '删除此行';
    del.setAttribute('aria-label', '删除此行');

    row.appendChild(fromInp);
    row.appendChild(hits);
    row.appendChild(arrow);
    row.appendChild(toInp);
    row.appendChild(del);
    bindRowEvents(row);
    return row;
  }

  function ensureAtLeastOneRow() {
    const listEl = App.Dom.termRemapList;
    if (!listEl) return;
    if (!listEl.querySelector('.term-remap-row')) {
      listEl.appendChild(createRuleRow('', ''));
    }
  }

  function setRules(rules) {
    const listEl = App.Dom.termRemapList;
    if (!listEl) return;
    listEl.innerHTML = '';
    const list = normalizeRules(rules);
    if (!list.length) {
      listEl.appendChild(createRuleRow('', ''));
    } else {
      list.forEach(r => listEl.appendChild(createRuleRow(r.from, r.to)));
    }
    invalidateSearch();
    updateHitBadges(null);
  }

  function closeModal() {
    const modal = App.Dom.termRemapModal;
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
      toast('所选图片没有文字框，无法换名词');
      return false;
    }

    const hint = App.Dom.termRemapHint;
    if (hint) {
      hint.textContent = '将生成工程「' + R.uniqueProjectName(ctx.nameBase, '-换名词副本') +
        '」（共 ' + ctx.images.length +
        ' 张）。请先搜索查看命中；替换留空表示删除该词。导入格式：每行 搜索=替换。';
    }

    if (App.Dom.termRemapCase) App.Dom.termRemapCase.checked = false;
    setRules([{ from: '', to: '' }]);
    updateReplaceEnabled();

    const modal = App.Dom.termRemapModal;
    if (modal && typeof modal.showModal === 'function') modal.showModal();
    else if (modal) modal.setAttribute('open', '');
    return true;
  }

  function doSearch() {
    const R = Remap();
    const ctx = R.getContext();
    if (!ctx.ok) {
      toast(ctx.disabledReason || R.DISABLED_EMPTY);
      return;
    }
    const rules = normalizeRules(readRulesFromModal());
    if (!rules.length) {
      toast('请至少填写一个搜索名词');
      return;
    }
    const caseSensitive = readCaseSensitive();
    const { counts, total } = countHits(ctx.images, rules, caseSensitive);
    lastSearch = {
      rulesFingerprint: rulesFingerprint(rules, caseSensitive),
      caseSensitive,
      counts: counts.slice(),
      total,
      rules: rules.map(r => ({ from: r.from, to: r.to }))
    };
    updateHitBadges(counts);
    updateReplaceEnabled();
    toast(total ? ('共命中 ' + total + ' 处') : '未命中任何名词');
  }

  function showResultModal(lines) {
    const body = App.Dom.termRemapResultBody;
    if (body) {
      body.innerHTML = '<ul class="term-remap-result-list">' +
        lines.map(s => '<li>' + esc(s) + '</li>').join('') +
        '</ul>';
    }
    const modal = App.Dom.termRemapResultModal;
    if (modal && typeof modal.showModal === 'function') modal.showModal();
    else if (modal) modal.setAttribute('open', '');
  }

  function closeResultModal() {
    const modal = App.Dom.termRemapResultModal;
    if (modal && typeof modal.close === 'function') modal.close();
  }

  async function doReplace() {
    const R = Remap();
    const ctx = R.getContext();
    if (!ctx.ok) {
      toast(ctx.disabledReason || R.DISABLED_EMPTY);
      return;
    }
    const rules = normalizeRules(readRulesFromModal());
    const caseSensitive = readCaseSensitive();
    const fp = rulesFingerprint(rules, caseSensitive);
    if (!lastSearch || lastSearch.rulesFingerprint !== fp) {
      toast('规则已变更，请先重新搜索');
      updateReplaceEnabled();
      return;
    }
    if (!lastSearch.total) {
      toast('没有命中，无法替换');
      return;
    }

    const conflicts = findOverlaps(ctx.images, rules, caseSensitive);
    if (conflicts.length) {
      const msg = conflicts.slice(0, 5).map(c => '「' + c.a + '」与「' + c.b + '」').join('；');
      toast('规则命中区间重叠，已中止：' + msg + (conflicts.length > 5 ? '…' : ''), 4200);
      return;
    }

    const result = await R.runCloneToProject({
      nameSuffix: '-换名词副本',
      logLabel: 'term-remap',
      textTransform: texts => texts.map(t => {
        const next = Object.assign({}, t);
        next.text = applyRulesToText(next.text || '', rules, caseSensitive);
        return next;
      })
    });

    if (!result.ok) {
      toast('生成失败：' + (result.error || '未知错误'));
      return;
    }

    closeModal();
    const lines = rules.map((r, i) => {
      const n = lastSearch.counts[i] || 0;
      const toLabel = r.to === '' ? '（删除）' : r.to;
      return r.from + ' → ' + toLabel + '：' + n + ' 处';
    });
    lines.unshift('已生成「' + result.projectName + '」（' + result.created.length + ' 张）');
    showResultModal(lines);
    toast('已生成「' + result.projectName + '」');
  }

  function importTxtFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTxtRules(String(reader.result || ''));
      if (!parsed.length) {
        toast('未从文件中解析到有效规则（格式：搜索=替换）');
        return;
      }
      setRules(parsed);
      toast('已导入 ' + parsed.length + ' 条规则');
    };
    reader.onerror = () => toast('读取文件失败');
    reader.readAsText(file, 'UTF-8');
  }

  function init() {
    const {
      termRemapBtn, termRemapModal, termRemapClose, termRemapCancel,
      termRemapSearch, termRemapReplace, termRemapAddRow, termRemapImport,
      termRemapImportInput, termRemapCase,
      termRemapResultModal, termRemapResultClose, termRemapResultOk
    } = App.Dom;

    if (termRemapBtn) {
      termRemapBtn.addEventListener('click', () => {
        const more = termRemapBtn.closest('details.header-more');
        if (more) more.open = false;
        openModal();
      });
    }

    if (termRemapClose) termRemapClose.addEventListener('click', closeModal);
    if (termRemapCancel) termRemapCancel.addEventListener('click', closeModal);
    if (termRemapModal) {
      termRemapModal.addEventListener('click', e => {
        if (e.target === termRemapModal) closeModal();
      });
    }
    if (termRemapCase) {
      termRemapCase.addEventListener('change', () => {
        invalidateSearch();
        updateHitBadges(null);
      });
    }
    if (termRemapAddRow) {
      termRemapAddRow.addEventListener('click', () => {
        const listEl = App.Dom.termRemapList;
        if (!listEl) return;
        listEl.appendChild(createRuleRow('', ''));
        invalidateSearch();
      });
    }
    if (termRemapImport && termRemapImportInput) {
      termRemapImport.addEventListener('click', () => termRemapImportInput.click());
      termRemapImportInput.addEventListener('change', () => {
        const f = termRemapImportInput.files && termRemapImportInput.files[0];
        termRemapImportInput.value = '';
        if (f) importTxtFile(f);
      });
    }
    if (termRemapSearch) termRemapSearch.addEventListener('click', doSearch);
    if (termRemapReplace) {
      termRemapReplace.addEventListener('click', async () => {
        termRemapReplace.disabled = true;
        try {
          await doReplace();
        } finally {
          updateReplaceEnabled();
        }
      });
    }

    const closeResult = () => closeResultModal();
    if (termRemapResultClose) termRemapResultClose.addEventListener('click', closeResult);
    if (termRemapResultOk) termRemapResultOk.addEventListener('click', closeResult);
    if (termRemapResultModal) {
      termRemapResultModal.addEventListener('click', e => {
        if (e.target === termRemapResultModal) closeResultModal();
      });
    }

    syncMenuButton();
  }

  App.TermRemap = {
    isWordChar,
    findWholeWordMatches,
    countHits,
    findOverlaps,
    applyRulesToText,
    parseTxtRules,
    openModal,
    closeModal,
    syncMenuButton,
    init
  };
})(window.App = window.App || {});
