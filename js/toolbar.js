/* 属性面板：颜色、预设、字号与样式控件 */
(function (App) {
  "use strict";

  const { $, toast } = App.Utils;
  const State = App.State;
  const {
    stage, tbColor, tbColorBtn, tbStrokeColor, tbStrokeColorBtn,
    tbColorEyedropper, tbStrokeColorEyedropper,
    tbSizeMinus, tbSize, tbSizePlus, tbFont, tbBold, tbVert, tbStroke, tbStrokeW, tbStrokeVal,
    tbRotateStart, tbRotateExit, tbRotateHint, tbRotMinus, tbRot, tbRotPlus, tbDelBtn
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
    const rot = typeof p.rotation === 'number' && p.rotation ? (' · ' + Math.round(p.rotation) + '°') : '';
    return '点一下套用到选中文字框\n样例字「' + char + '」· ' + p.fontFamily
      + ' · ' + p.color + ' · 字号 ' + Math.round(p.fontPct * 100) + '%' + rot;
  }

  function snapFromText(t) {
    const vertical = !!t.vertical;
    return {
      color: t.color,
      fontPct: t.fontPct,
      fontFamily: t.fontFamily || State.DEFAULT_FONT,
      bold: !!t.bold,
      vertical,
      stroke: !!t.stroke,
      strokeColor: t.strokeColor || '#000000',
      strokePct: t.strokePct || 0.08,
      rotation: vertical ? 0 : App.Editor.getTextRotation(t)
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
    const rot = (!p.vertical && typeof p.rotation === 'number') ? p.rotation : 0;
    el.style.transformOrigin = 'center center';
    el.style.transform = rot ? ('rotate(' + rot + 'deg)') : '';
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
    t.rotation = p.vertical ? 0 : App.Editor.normalizeRotation(
      typeof p.rotation === 'number' ? p.rotation : 0
    );
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

  function syncAngleInput(t) {
    if (!tbRot) return;
    if (!t) t = selectedText();
    if (!t || t.vertical) {
      tbRot.value = t && t.vertical ? '0' : '0';
      return;
    }
    const deg = App.Editor.getDisplayRotation
      ? App.Editor.getDisplayRotation(t)
      : App.Editor.getTextRotation(t);
    tbRot.value = String(Math.round(deg));
  }

  function applyRotationDeg(deg, opts) {
    const t = selectedText();
    if (!t || t.vertical) return;
    const next = App.Editor.normalizeRotation(deg);
    if (App.Editor.isRotating()) {
      App.Editor.setRotateDraft(next);
      syncAngleInput(t);
      return;
    }
    const prev = App.Editor.getTextRotation(t);
    if (next === prev) {
      syncAngleInput(t);
      return;
    }
    if (opts && opts.debounced) App.Editor.pushHistoryDebounced();
    else App.Editor.pushHistory();
    t.rotation = next;
    syncBoxFor(t);
    syncAngleInput(t);
    scheduleEdit();
  }

  function syncRotateControls() {
    const t = selectedText();
    const rotating = App.Editor && App.Editor.isRotating && App.Editor.isRotating();
    if (tbRotateStart) {
      tbRotateStart.hidden = !!rotating;
      tbRotateStart.disabled = !t || !!t.vertical || !!rotating;
      tbRotateStart.title = t && t.vertical
        ? '竖排文字不支持旋转'
        : '进入旋转模式，拖动文字框绕中心旋转';
    }
    if (tbRotateExit) tbRotateExit.hidden = !rotating;
    if (tbRotateHint) tbRotateHint.hidden = !rotating;

    const angleOk = !!t && !t.vertical;
    [tbRotMinus, tbRot, tbRotPlus].forEach(el => {
      if (el) el.disabled = !angleOk;
    });
    syncAngleInput(t);

    const lock = !!rotating;
    [tbSizeMinus, tbSize, tbSizePlus, tbFont, tbBold, tbVert, tbStroke, tbStrokeW,
      tbColorBtn, tbStrokeColorBtn, tbColorEyedropper, tbStrokeColorEyedropper].forEach(el => {
      if (!el) return;
      el.disabled = lock;
    });
    if (tbDelBtn) tbDelBtn.disabled = lock || !State.selectedTextId;
    document.querySelectorAll('.text-preset .preset-hit, .text-preset .preset-remove').forEach(el => {
      el.disabled = lock;
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
    syncRotateControls();
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
    syncRotateControls();
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
    if (tbRotateStart) {
      tbRotateStart.addEventListener('click', () => {
        if (App.Editor.startRotate()) toast('旋转模式：拖动文字框调整角度');
      });
    }
    if (tbRotateExit) {
      tbRotateExit.addEventListener('click', () => {
        App.Editor.abortRotateIfNeeded();
        toast('已退出旋转模式');
      });
    }

    if (tbRotMinus) {
      tbRotMinus.addEventListener('click', e => {
        const t = selectedText();
        if (!t || t.vertical) return;
        const step = e.shiftKey ? 5 : 1;
        const base = App.Editor.getDisplayRotation(t);
        applyRotationDeg(base - step);
      });
    }
    if (tbRotPlus) {
      tbRotPlus.addEventListener('click', e => {
        const t = selectedText();
        if (!t || t.vertical) return;
        const step = e.shiftKey ? 5 : 1;
        const base = App.Editor.getDisplayRotation(t);
        applyRotationDeg(base + step);
      });
    }
    if (tbRot) {
      tbRot.addEventListener('change', () => {
        const raw = tbRot.value;
        if (raw === '' || Number.isNaN(+raw)) {
          syncAngleInput();
          return;
        }
        applyRotationDeg(+raw, { debounced: false });
      });
      tbRot.addEventListener('input', () => {
        const raw = tbRot.value;
        if (raw === '' || Number.isNaN(+raw)) return;
        applyRotationDeg(+raw, { debounced: true });
      });
      tbRot.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); tbRot.blur(); }
      });
    }

    tbSizeMinus.addEventListener('click', () => {
      if (App.Editor.isRotating()) return;
      const t = selectedText();
      const base = t ? Math.round(t.fontPct * App.Editor.stageH()) : +tbSize.value;
      applyFontPx(base - 1);
    });
    tbSizePlus.addEventListener('click', () => {
      if (App.Editor.isRotating()) return;
      const t = selectedText();
      const base = t ? Math.round(t.fontPct * App.Editor.stageH()) : +tbSize.value;
      applyFontPx(base + 1);
    });
    tbSize.addEventListener('change', () => {
      if (App.Editor.isRotating()) return;
      applyFontPx(+tbSize.value);
    });
    tbSize.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tbSize.blur(); } });

    stage.addEventListener('wheel', e => {
      if (App.Editor.isRotating()) return;
      if (!State.selectedTextId) return;
      const box = e.target.closest('.text-box');
      if (!box || box.dataset.id !== State.selectedTextId) return;
      e.preventDefault();
      const t = selectedText();
      if (!t) return;
      const step = e.shiftKey ? 2 : 1;
      applyFontPx(Math.round(t.fontPct * App.Editor.stageH()) + (e.deltaY < 0 ? step : -step));
    }, { passive: false });

    const sizeStepper = tbSize && tbSize.closest('.stepper');
    if (sizeStepper) {
      sizeStepper.addEventListener('wheel', e => {
        if (App.Editor.isRotating()) return;
        e.preventDefault();
        const t = selectedText();
        const base = t ? Math.round(t.fontPct * App.Editor.stageH()) : +tbSize.value;
        const step = e.shiftKey ? 2 : 1;
        applyFontPx(base + (e.deltaY < 0 ? step : -step));
      }, { passive: false });
    }

    const rotStepper = tbRot && tbRot.closest('.stepper');
    if (rotStepper) {
      rotStepper.addEventListener('wheel', e => {
        const t = selectedText();
        if (!t || t.vertical) return;
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const base = App.Editor.getDisplayRotation(t);
        applyRotationDeg(base + (e.deltaY < 0 ? step : -step));
      }, { passive: false });
    }

    tbFont.addEventListener('change', () => {
      if (App.Editor.isRotating()) return;
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
      if (App.Editor.isRotating()) return;
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
      if (App.Editor.isRotating()) {
        tbVert.checked = !tbVert.checked;
        return;
      }
      const t = selectedText();
      if (t) {
        App.Editor.pushHistory();
        t.vertical = tbVert.checked;
        if (t.vertical) t.rotation = 0;
        syncBoxFor(t);
      }
      State.lastStyle.vertical = tbVert.checked;
      State.saveLastStyle();
      syncRotateControls();
    });

    tbStroke.addEventListener('change', () => {
      if (App.Editor.isRotating()) return;
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
      if (App.Editor.isRotating()) return;
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
    syncRotateControls,
    syncAngleInput,
    commitSizeInput,
    applyFontPx,
    syncSizeInput,
    cancelEyedropper
  };
})(window.App = window.App || {});
