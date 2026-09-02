/* 属性面板：颜色、预设、字号与样式控件 */
(function (App) {
  "use strict";

  const { $, toast } = App.Utils;
  const State = App.State;
  const {
    stage, tbColor, tbColorBtn, tbStrokeColor, tbStrokeColorBtn,
    tbColorEyedropper, tbStrokeColorEyedropper,
    tbSizeMinus, tbSize, tbSizePlus, tbFont, tbBold, tbVert, tbStroke, tbStrokeW, tbStrokeVal
  } = App.Dom;

  let textColorPick, strokeColorPick;
  let textEyedropperTarget = null;

  function closeColorPops() { App.ColorPick.closeColorPops(); }

  function setupColorPick(opts) { return App.ColorPick.setupColorPick(opts); }

  function selectedText() {
    if (!State.selectedTextId || !State.current()) return null;
    return State.current().texts.find(x => x.id === State.selectedTextId) || null;
  }

  function syncBoxFor(t) {
    if (!t) return;
    const box = stage.querySelector(`.text-box[data-id="${t.id}"]`);
    if (box) App.Editor.syncBox(box, t);
    if (State.selectedTextId === t.id) scheduleEdit();
  }

  function scheduleEdit() {
    if (State.currentId && App.Storage && App.Storage.isAvailable()) {
      App.Storage.scheduleSaveEdit(State.currentId);
    }
  }

  function applyTextColor(color) {
    const t = selectedText();
    if (t) {
      App.Editor.pushHistory();
      t.color = color;
      syncBoxFor(t);
    }
    State.lastStyle.color = color;
    State.saveLastStyle();
  }

  function applyStrokeColor(color) {
    const t = selectedText();
    if (t) {
      App.Editor.pushHistory();
      t.strokeColor = color;
      syncBoxFor(t);
    }
    State.lastStyle.strokeColor = color;
    State.saveLastStyle();
  }

  function stageToImage(clientX, clientY, img) {
    const r = stage.getBoundingClientRect();
    return {
      x: (clientX - r.left) / r.width * img.w,
      y: (clientY - r.top) / r.height * img.h
    };
  }

  function syncEyedropperUI() {
    if (tbColorEyedropper) {
      tbColorEyedropper.classList.toggle('on', textEyedropperTarget === 'color');
      tbColorEyedropper.setAttribute('aria-pressed', textEyedropperTarget === 'color' ? 'true' : 'false');
    }
    if (tbStrokeColorEyedropper) {
      tbStrokeColorEyedropper.classList.toggle('on', textEyedropperTarget === 'stroke');
      tbStrokeColorEyedropper.setAttribute('aria-pressed', textEyedropperTarget === 'stroke' ? 'true' : 'false');
    }
    stage.classList.toggle('mode-text-eyedropper', !!textEyedropperTarget && State.isTextMode());
  }

  function cancelEyedropper() {
    if (!textEyedropperTarget) return false;
    textEyedropperTarget = null;
    syncEyedropperUI();
    return true;
  }

  function activateEyedropper(target) {
    if (!State.isTextMode() || !State.current()) return;
    closeColorPops();
    textEyedropperTarget = textEyedropperTarget === target ? null : target;
    syncEyedropperUI();
    if (textEyedropperTarget) toast('在图片上点击取色');
  }

  async function onEyedropperPointerDown(e) {
    if (!textEyedropperTarget || !State.isTextMode()) return;
    if (e.button !== 0) return;
    if (e.target.closest('.props-panel') || e.target.closest('#textProps')) return;
    const img = State.current();
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    const p = stageToImage(e.clientX, e.clientY, img);
    const hex = await App.Export.sampleColorAt(img, p.x, p.y);
    if (textEyedropperTarget === 'color') {
      tbColor.value = hex;
      textColorPick.syncSwatch();
      applyTextColor(hex);
    } else {
      tbStrokeColor.value = hex;
      strokeColorPick.syncSwatch();
      applyStrokeColor(hex);
    }
    textEyedropperTarget = null;
    syncEyedropperUI();
  }

  function bindEyedropperEvents() {
    if (tbColorEyedropper) {
      tbColorEyedropper.addEventListener('click', e => {
        e.stopPropagation();
        activateEyedropper('color');
      });
    }
    if (tbStrokeColorEyedropper) {
      tbStrokeColorEyedropper.addEventListener('click', e => {
        e.stopPropagation();
        activateEyedropper('stroke');
      });
    }
    stage.addEventListener('pointerdown', onEyedropperPointerDown, true);
  }

  function fontPxMin() { return Math.max(6, Math.ceil(App.Editor.stageH() * 0.01)); }
  function fontPxMax() { return Math.max(fontPxMin(), Math.floor(App.Editor.stageH() * 0.4)); }
  function clampFontPx(px) { return Math.min(fontPxMax(), Math.max(fontPxMin(), Math.round(px))); }

  function syncSizeFromFontPct(fontPct) {
    tbSize.min = String(fontPxMin());
    tbSize.max = String(fontPxMax());
    tbSize.value = String(clampFontPx(Math.round(fontPct * App.Editor.stageH())));
  }

  function syncSizeInput(t) {
    syncSizeFromFontPct(t.fontPct);
  }

  function applyFontPx(px, textId) {
    const id = textId ?? State.selectedTextId;
    const v = clampFontPx(px);
    if (id && State.current()) {
      const t = State.current().texts.find(x => x.id === id);
      if (!t) return;
      App.Editor.pushHistoryDebounced();
      t.fontPct = v / App.Editor.stageH();
      State.lastStyle.fontPct = t.fontPct;
      State.saveLastStyle();
      tbSize.value = String(v);
      syncBoxFor(t);
    } else if (State.current()) {
      State.lastStyle.fontPct = v / App.Editor.stageH();
      State.saveLastStyle();
      tbSize.value = String(v);
    }
  }

  function commitSizeInput() {
    const raw = String(tbSize.value).trim();
    if (raw === '' || Number.isNaN(+raw)) return;
    applyFontPx(+raw, State.selectedTextId);
  }

  const BOLD_RATIO = 0.05;
  const TEXT_PRESET_CHARS = ['故', '伦', '德', '里'];

  function presetTitle(p, char) {
    if (!p) return '点空白槽保存选中文字样式 · 点有内容套用 · × 删除';
    return '点一下套用到选中文字框\n样例字「' + char + '」· ' + p.fontFamily
      + ' · ' + p.color + ' · 字号 ' + Math.round(p.fontPct * 100) + '%';
  }

  function snapFromText(t) {
    return {
      color: t.color,
      fontPct: t.fontPct,
      fontFamily: t.fontFamily || State.DEFAULT_FONT,
      bold: !!t.bold,
      vertical: !!t.vertical,
      stroke: !!t.stroke,
      strokeColor: t.strokeColor || '#000000',
      strokePct: t.strokePct || 0.08
    };
  }

  function previewFontSize(fontPct) {
    return Math.min(36, Math.max(22, Math.round(fontPct * 500)));
  }

  function applyPreviewStyles(el, p) {
    const fs = previewFontSize(p.fontPct);
    const fam = p.fontFamily ? ('"' + p.fontFamily + '", sans-serif') : 'sans-serif';
    el.style.fontFamily = fam;
    el.style.fontSize = fs + 'px';
    el.style.color = p.color;
    el.style.fontWeight = '400';
    el.style.writingMode = p.vertical ? 'vertical-lr' : 'horizontal-tb';
    el.style.textOrientation = p.vertical ? 'upright' : 'mixed';
    const boldW = Math.max(0.5, fs * BOLD_RATIO);
    if (p.stroke) {
      el.style.webkitTextStroke = Math.max(0.5, p.strokePct * fs) + 'px ' + p.strokeColor;
      if (p.bold) {
        const o = Math.max(0.4, fs * 0.035);
        el.style.textShadow = `${o}px 0 0 ${p.color},-${o}px 0 0 ${p.color},0 ${o}px 0 ${p.color},0 -${o}px 0 ${p.color}`;
      } else {
        el.style.textShadow = 'none';
      }
    } else if (p.bold) {
      el.style.webkitTextStroke = boldW + 'px ' + p.color;
      el.style.textShadow = 'none';
    } else {
      el.style.webkitTextStroke = '0px transparent';
      el.style.textShadow = 'none';
    }
  }

  async function renderPresets() {
    const slots = document.querySelectorAll('.text-preset');
    for (const slot of slots) {
      const i = +slot.dataset.i;
      const char = slot.dataset.char || TEXT_PRESET_CHARS[i] || '';
      const p = State.presets[i];
      const hit = slot.querySelector('.preset-hit');
      const removeBtn = slot.querySelector('.preset-remove');
      if (!hit) continue;
      slot.classList.toggle('empty', !p);
      if (removeBtn) removeBtn.hidden = !p;
      hit.title = presetTitle(p, char);
      hit.innerHTML = '';
      const span = document.createElement('span');
      span.className = 'text-preset-preview';
      span.textContent = char;
      if (p) {
        try { await document.fonts.load(previewFontSize(p.fontPct) + 'px "' + p.fontFamily + '"'); } catch (e) {}
        applyPreviewStyles(span, p);
      }
      hit.appendChild(span);
    }
  }

  function deletePreset(i) {
    if (!State.presets[i]) { toast('该预设已是空的'); return; }
    State.presets[i] = null;
    State.savePresets();
    renderPresets();
    toast('已删除样式预设');
  }

  function applyPresetToText(p) {
    const t = selectedText();
    if (!t) { toast('请先选中文字框'); return; }
    App.Editor.pushHistory();
    t.color = p.color;
    t.fontPct = p.fontPct;
    t.fontFamily = p.fontFamily;
    t.bold = p.bold;
    t.vertical = p.vertical;
    t.stroke = p.stroke;
    t.strokeColor = p.strokeColor;
    t.strokePct = p.strokePct;
    syncToolbarFromText(t);
    syncBoxFor(t);
    scheduleEdit();
  }

  function bindPresetEvents() {
    document.querySelectorAll('.text-preset').forEach(slot => {
      const i = +slot.dataset.i;
      const hit = slot.querySelector('.preset-hit');
      const removeBtn = slot.querySelector('.preset-remove');
      if (!hit) return;

      hit.addEventListener('click', () => {
        const p = State.presets[i];
        if (p) {
          applyPresetToText(p);
          return;
        }
        const t = selectedText();
        if (!t) { toast('请先选中文字框'); return; }
        State.presets[i] = snapFromText(t);
        State.savePresets();
        renderPresets();
        toast('已保存样式预设');
      });

      if (removeBtn) {
        removeBtn.addEventListener('click', e => {
          e.stopPropagation();
          deletePreset(i);
        });
      }
    });
  }

  function syncToolbarFromText(t) {
    tbColor.value = t.color;
    textColorPick.syncSwatch();
    syncSizeInput(t);
    tbFont.value = t.fontFamily || '';
    tbBold.classList.toggle('on', !!t.bold);
    tbBold.setAttribute('aria-pressed', t.bold ? 'true' : 'false');
    tbVert.checked = !!t.vertical;
    tbStroke.checked = !!t.stroke;
    tbStrokeColor.value = t.strokeColor || '#000000';
    strokeColorPick.syncSwatch();
    tbStrokeW.value = Math.round((t.strokePct || 0.08) * 100);
    tbStrokeVal.textContent = Math.round((t.strokePct || 0.08) * 100) + '%';
  }

  function syncDefaultStylePanel() {
    const ls = State.lastStyle;
    tbColor.value = ls.color;
    textColorPick.syncSwatch();
    syncSizeFromFontPct(ls.fontPct);
    tbFont.value = ls.fontFamily || '';
    tbBold.classList.toggle('on', !!ls.bold);
    tbBold.setAttribute('aria-pressed', ls.bold ? 'true' : 'false');
    tbVert.checked = !!ls.vertical;
    tbStroke.checked = !!ls.stroke;
    tbStrokeColor.value = ls.strokeColor || '#000000';
    strokeColorPick.syncSwatch();
    tbStrokeW.value = Math.round((ls.strokePct || 0.08) * 100);
    tbStrokeVal.textContent = Math.round((ls.strokePct || 0.08) * 100) + '%';
  }

  function initColorPicks() {
    textColorPick = setupColorPick({
      input: tbColor, btn: tbColorBtn, pop: $('tbColorPop'), chipsEl: $('tbColorChips'), moreBtn: $('tbColorMore'),
      onApply: applyTextColor
    });
    strokeColorPick = setupColorPick({
      input: tbStrokeColor, btn: tbStrokeColorBtn, pop: $('tbStrokeColorPop'), chipsEl: $('tbStrokeColorChips'), moreBtn: $('tbStrokeColorMore'),
      onApply: applyStrokeColor
    });
  }

  function bindToolbarEvents() {
    tbSizeMinus.addEventListener('click', () => {
      const t = selectedText();
      const base = t ? Math.round(t.fontPct * App.Editor.stageH()) : +tbSize.value;
      applyFontPx(base - 1);
    });
    tbSizePlus.addEventListener('click', () => {
      const t = selectedText();
      const base = t ? Math.round(t.fontPct * App.Editor.stageH()) : +tbSize.value;
      applyFontPx(base + 1);
    });
    tbSize.addEventListener('change', () => applyFontPx(+tbSize.value));
    tbSize.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tbSize.blur(); } });

    stage.addEventListener('wheel', e => {
      if (!State.selectedTextId) return;
      const box = e.target.closest('.text-box');
      if (!box || box.dataset.id !== State.selectedTextId) return;
      e.preventDefault();
      const t = selectedText();
      if (!t) return;
      const step = e.shiftKey ? 2 : 1;
      applyFontPx(Math.round(t.fontPct * App.Editor.stageH()) + (e.deltaY < 0 ? step : -step));
    }, { passive: false });

    const sizeCtrl = document.querySelector('.size-ctrl');
    if (sizeCtrl) {
      sizeCtrl.addEventListener('wheel', e => {
        e.preventDefault();
        const t = selectedText();
        const base = t ? Math.round(t.fontPct * App.Editor.stageH()) : +tbSize.value;
        const step = e.shiftKey ? 2 : 1;
        applyFontPx(base + (e.deltaY < 0 ? step : -step));
      }, { passive: false });
    }

    tbFont.addEventListener('change', () => {
      const t = selectedText();
      if (t) {
        App.Editor.pushHistory();
        t.fontFamily = tbFont.value;
        syncBoxFor(t);
      }
      State.lastStyle.fontFamily = tbFont.value;
      State.saveLastStyle();
    });

    tbBold.addEventListener('click', () => {
      const t = selectedText();
      const next = t ? !t.bold : !State.lastStyle.bold;
      if (t) {
        App.Editor.pushHistory();
        t.bold = next;
        syncBoxFor(t);
      }
      State.lastStyle.bold = next;
      State.saveLastStyle();
      tbBold.classList.toggle('on', next);
      tbBold.setAttribute('aria-pressed', next ? 'true' : 'false');
    });

    tbVert.addEventListener('change', () => {
      const t = selectedText();
      if (t) {
        App.Editor.pushHistory();
        t.vertical = tbVert.checked;
        syncBoxFor(t);
      }
      State.lastStyle.vertical = tbVert.checked;
      State.saveLastStyle();
    });

    tbStroke.addEventListener('change', () => {
      const t = selectedText();
      if (t) {
        App.Editor.pushHistory();
        t.stroke = tbStroke.checked;
        syncBoxFor(t);
      }
      State.lastStyle.stroke = tbStroke.checked;
      State.saveLastStyle();
    });

    tbStrokeW.addEventListener('input', () => {
      const pct = +tbStrokeW.value / 100;
      const t = selectedText();
      if (t) {
        App.Editor.pushHistoryDebounced();
        t.strokePct = pct;
        syncBoxFor(t);
      }
      State.lastStyle.strokePct = pct;
      State.saveLastStyle();
      tbStrokeVal.textContent = Math.round(pct * 100) + '%';
    });

    bindEyedropperEvents();
  }

  App.Toolbar = {
    closeColorPops,
    initColorPicks,
    bindPresetEvents,
    bindToolbarEvents,
    renderPresets,
    syncToolbarFromText,
    syncDefaultStylePanel,
    commitSizeInput,
    applyFontPx,
    syncSizeInput,
    cancelEyedropper
  };
})(window.App = window.App || {});
