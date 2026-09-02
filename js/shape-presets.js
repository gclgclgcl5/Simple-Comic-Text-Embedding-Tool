/* 画图模式：矩形/椭圆图形预设（6 槽 + SVG 预览） */
(function (App) {
  "use strict";

  const { toast } = App.Utils;
  const State = App.State;

  function presetTitle(p) {
    if (!p) return '点空白槽保存选中图形 · 点有内容插入 · × 删除';
    const kind = p.type === 'ellipse' ? '椭圆' : '矩形';
    return '点一下插入到图片中心\n'
      + kind + ' · ' + p.color
      + ' · 宽 ' + Math.round(p.w * 200) + '% × 高 ' + Math.round(p.h * 200) + '%';
  }

  function buildPreviewSvg(p) {
    const pad = Math.max(p.w, p.h, 0.02) * 0.12;
    const vx = 0.5 - p.w - pad;
    const vy = 0.5 - p.h - pad;
    const vw = p.w * 2 + pad * 2;
    const vh = p.h * 2 + pad * 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', vx + ' ' + vy + ' ' + vw + ' ' + vh);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');
    let shape;
    if (p.type === 'ellipse') {
      shape = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      shape.setAttribute('cx', '0.5');
      shape.setAttribute('cy', '0.5');
      shape.setAttribute('rx', String(p.w));
      shape.setAttribute('ry', String(p.h));
    } else {
      shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      shape.setAttribute('x', String(0.5 - p.w));
      shape.setAttribute('y', String(0.5 - p.h));
      shape.setAttribute('width', String(p.w * 2));
      shape.setAttribute('height', String(p.h * 2));
    }
    shape.setAttribute('fill', p.color);
    svg.appendChild(shape);
    return svg;
  }

  function renderShapePresets() {
    document.querySelectorAll('.shape-preset').forEach(slot => {
      const i = +slot.dataset.i;
      const p = State.shapePresets[i];
      const hit = slot.querySelector('.preset-hit');
      const removeBtn = slot.querySelector('.preset-remove');
      slot.classList.toggle('empty', !p);
      if (removeBtn) removeBtn.hidden = !p;
      if (hit) {
        hit.title = presetTitle(p);
        hit.innerHTML = '';
        if (p) hit.appendChild(buildPreviewSvg(p));
      }
    });
  }

  function deleteShapePreset(i) {
    if (!State.shapePresets[i]) { toast('该预设已是空的'); return; }
    State.shapePresets[i] = null;
    State.saveShapePresets();
    renderShapePresets();
    toast('已删除图形预设');
  }

  function snapFromShape(s) {
    return { type: s.type, w: s.w, h: s.h, color: s.color };
  }

  function bindShapePresetEvents() {
    document.querySelectorAll('.shape-preset').forEach(slot => {
      const i = +slot.dataset.i;
      const hit = slot.querySelector('.preset-hit');
      const removeBtn = slot.querySelector('.preset-remove');
      if (!hit) return;

      hit.addEventListener('click', () => {
        if (!State.isDrawMode()) { toast('请切换到画图模式'); return; }
        if (!State.current()) { toast('请先选择图片'); return; }
        const p = State.shapePresets[i];
        if (p) {
          App.Draw.insertShapeFromPreset(p);
          return;
        }
        const s = App.Draw.getSelectedShape();
        if (!s) { toast('请先选中一个图形再保存预设'); return; }
        State.shapePresets[i] = snapFromShape(s);
        State.saveShapePresets();
        renderShapePresets();
        toast('已保存图形预设');
      });

      if (removeBtn) {
        removeBtn.addEventListener('click', e => {
          e.stopPropagation();
          deleteShapePreset(i);
        });
      }
    });
  }

  App.ShapePresets = { renderShapePresets, bindShapePresetEvents };
})(window.App = window.App || {});
