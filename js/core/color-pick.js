/* 颜色选择器：常用色块 + 原生调色盘（文字/画图共用） */
(function (App) {
  "use strict";

  const BASIC_COLORS = ['#ffffff', '#000000', '#333333', '#666666', '#999999', '#ff0000', '#ff6600', '#ffcc00', '#ffff00', '#99cc00', '#00cc66', '#00cccc', '#0099ff', '#3366ff', '#9933ff', '#ff66cc', '#8b4513', '#ffd700'];

  function closeColorPops() { document.querySelectorAll('.color-pop').forEach(p => { p.hidden = true; }); }

  function positionPop(btn, pop) {
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth || 180;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + 200 > window.innerHeight - 8) top = r.top - 6 - (pop.offsetHeight || 200);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  function setupColorPick({ input, btn, pop, chipsEl, moreBtn, onApply }) {
    chipsEl.innerHTML = BASIC_COLORS.map(c => `<button type="button" class="color-chip" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
    const syncSwatch = () => { btn.style.background = input.value; };
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (pop.hidden) {
        closeColorPops();
        pop.hidden = false;
        positionPop(btn, pop);
      } else {
        pop.hidden = true;
      }
    });
    chipsEl.addEventListener('click', e => {
      const chip = e.target.closest('.color-chip');
      if (!chip) return;
      input.value = chip.dataset.c;
      syncSwatch();
      onApply(input.value);
      pop.hidden = true;
    });
    moreBtn.addEventListener('click', e => { e.stopPropagation(); input.click(); });
    input.addEventListener('input', () => { syncSwatch(); onApply(input.value); });
    syncSwatch();
    return { syncSwatch };
  }

  App.ColorPick = { BASIC_COLORS, closeColorPops, setupColorPick };
})(window.App = window.App || {});
