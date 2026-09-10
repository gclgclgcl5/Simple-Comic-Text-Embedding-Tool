/* 智能遮盖：矩形并集 / 异形泡内洪水填充（纯像素，无 OCR） */
(function (App) {
  "use strict";

  function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function medianOf(arr) {
    if (!arr.length) return 128;
    const a = arr.slice().sort((x, y) => x - y);
    const m = (a.length - 1) >> 1;
    return a.length % 2 ? a[m] : (a[m] + a[m + 1]) / 2;
  }

  function computeThreshold(data, w, h) {
    const n = w * h;
    const ys = new Array(n);
    let minY = 255;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const y = luminance(data[o], data[o + 1], data[o + 2]);
      ys[i] = y;
      if (y < minY) minY = y;
    }
    const med = medianOf(ys);
    let T = med - 0.35 * (med - minY);
    T = clamp(T, 40, 220);
    if (med - minY < 12) T = med - 8;
    return { T: clamp(T, 20, 240), median: med };
  }

  function buildInkMask(data, w, h, T) {
    const n = w * h;
    const ink = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (luminance(data[o], data[o + 1], data[o + 2]) < T) ink[i] = 1;
    }
    return ink;
  }

  /** 清除贴 ROI 四边的 ink（降低粗框带进气泡线的概率） */
  function clearBorderInk(ink, w, h) {
    for (let x = 0; x < w; x++) {
      floodClearBorder(ink, w, h, x, 0);
      floodClearBorder(ink, w, h, x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      floodClearBorder(ink, w, h, 0, y);
      floodClearBorder(ink, w, h, w - 1, y);
    }
  }

  function floodClearBorder(ink, w, h, sx, sy) {
    const start = sy * w + sx;
    if (!ink[start]) return;
    const stack = [start];
    ink[start] = 0;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      const tryPush = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const j = ny * w + nx;
        if (!ink[j]) return;
        ink[j] = 0;
        stack.push(j);
      };
      tryPush(x - 1, y);
      tryPush(x + 1, y);
      tryPush(x, y - 1);
      tryPush(x, y + 1);
    }
  }

  /** @returns {{ comps: object[], labels: Int32Array }} */
  function connectedComponentsLabeled(ink, w, h) {
    const n = w * h;
    const labels = new Int32Array(n);
    const comps = [];
    const stack = [];
    let nextId = 1;

    for (let i = 0; i < n; i++) {
      if (!ink[i] || labels[i]) continue;
      const id = nextId++;
      let minX = w, minY = h, maxX = -1, maxY = -1, area = 0;
      let touchBorder = false;
      let sumX = 0, sumY = 0;
      stack.length = 0;
      stack.push(i);
      labels[i] = id;
      while (stack.length) {
        const j = stack.pop();
        const x = j % w;
        const y = (j / w) | 0;
        area++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchBorder = true;
        const neigh = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (let k = 0; k < 4; k++) {
          const nx = neigh[k][0], ny = neigh[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nj = ny * w + nx;
          if (!ink[nj] || labels[nj]) continue;
          labels[nj] = id;
          stack.push(nj);
        }
      }
      comps.push({
        id, minX, minY, maxX, maxY, area, touchBorder,
        cx: sumX / area, cy: sumY / area
      });
    }
    return { comps, labels };
  }

  function filterComponents(comps, w, h) {
    const roiArea = w * h;
    const minArea = Math.max(8, Math.round(roiArea * 0.0005));
    const maxArea = Math.round(roiArea * 0.4);
    return comps.filter(c => {
      if (c.area < minArea || c.area > maxArea) return false;
      const bw = c.maxX - c.minX + 1;
      const bh = c.maxY - c.minY + 1;
      const fillRatio = c.area / Math.max(1, bw * bh);
      // 低填充率的大块多为气泡描边环，不当作文案
      if (fillRatio < 0.22 && Math.max(bw, bh) >= Math.min(w, h) * 0.25) return false;
      if (c.touchBorder) {
        const thin = Math.min(bw, bh) <= 3;
        const long = Math.max(bw, bh) >= Math.min(w, h) * 0.45;
        if (thin && long) return false;
      }
      return true;
    });
  }

  function analyzeRoi(imageData, width, height) {
    const data = imageData.data;
    const { T } = computeThreshold(data, width, height);
    const inkAll = buildInkMask(data, width, height, T);
    const inkText = new Uint8Array(inkAll);
    clearBorderInk(inkText, width, height);
    const { comps, labels } = connectedComponentsLabeled(inkText, width, height);
    const kept = filterComponents(comps, width, height);
    const keepIds = new Set(kept.map(c => c.id));
    const textMask = new Uint8Array(width * height);
    for (let i = 0; i < textMask.length; i++) {
      if (keepIds.has(labels[i])) textMask[i] = 1;
    }
    return { T, data, inkAll, textMask, kept };
  }

  /**
   * @returns {{ x: number, y: number, w: number, h: number, threshold: number } | null}
   */
  function detectCoverRect(imageData, width, height) {
    if (!imageData || width < 4 || height < 4) return null;
    const { T, kept } = analyzeRoi(imageData, width, height);
    if (!kept.length) return null;

    let minX = width, minY = height, maxX = -1, maxY = -1;
    kept.forEach(c => {
      if (c.minX < minX) minX = c.minX;
      if (c.minY < minY) minY = c.minY;
      if (c.maxX > maxX) maxX = c.maxX;
      if (c.maxY > maxY) maxY = c.maxY;
    });
    if (maxX < minX || maxY < minY) return null;

    const boxH = maxY - minY + 1;
    const pad = clamp(Math.round(0.08 * boxH), 2, 12);
    const x = clamp(minX - pad, 0, width - 1);
    const y = clamp(minY - pad, 0, height - 1);
    const x1 = clamp(maxX + pad, 0, width - 1);
    const y1 = clamp(maxY + pad, 0, height - 1);
    const rw = x1 - x + 1;
    const rh = y1 - y + 1;
    if (rw < 2 || rh < 2) return null;
    return { x, y, w: rw, h: rh, threshold: T };
  }

  function findBrightSeed(data, w, h, T, textMask, kept) {
    let cx = (w - 1) / 2, cy = (h - 1) / 2;
    if (kept.length) {
      let sx = 0, sy = 0, a = 0;
      kept.forEach(c => {
        sx += c.cx * c.area;
        sy += c.cy * c.area;
        a += c.area;
      });
      if (a > 0) {
        cx = sx / a;
        cy = sy / a;
      }
    }
    const maxR = Math.max(w, h);
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = Math.round(cx + dx);
          const y = Math.round(cy + dy);
          if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
          const i = y * w + x;
          if (textMask[i]) continue;
          const o = i * 4;
          if (luminance(data[o], data[o + 1], data[o + 2]) >= T) return { x, y };
        }
      }
    }
    return null;
  }

  const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const N8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

  function pixelLum(data, i) {
    const o = i * 4;
    return luminance(data[o], data[o + 1], data[o + 2]);
  }

  /** 将与 ROI 边界连通的非 mask 标为 exterior；其余非 mask 为封闭内洞，并入 mask */
  function fillEnclosedHoles(mask, w, h) {
    const n = w * h;
    const exterior = new Uint8Array(n);
    const stack = [];
    const pushExt = (i) => {
      if (mask[i] || exterior[i]) return;
      exterior[i] = 1;
      stack.push(i);
    };
    for (let x = 0; x < w; x++) {
      pushExt(x);
      pushExt((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      pushExt(y * w);
      pushExt(y * w + (w - 1));
    }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + N4[k][0], ny = y + N4[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        pushExt(ny * w + nx);
      }
    }
    let added = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i] && !exterior[i]) {
        mask[i] = 1;
        added++;
      }
    }
    return added;
  }

  /**
   * 从黑描边内侧剥离 mask：仅当邻接「不在 mask 内的很黑像素」（描边）时取消，
   * 避免把文字/已填麻点当成描边而掏空；把抗锯齿灰边还给原图。
   */
  function shrinkMaskFromStroke(mask, data, w, h, hardStroke, rounds) {
    const n = w * h;
    for (let r = 0; r < rounds; r++) {
      const rem = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (!mask[i]) continue;
        const x = i % w;
        const y = (i / w) | 0;
        for (let k = 0; k < 8; k++) {
          const nx = x + N8[k][0], ny = y + N8[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j]) continue;
          if (pixelLum(data, j) < hardStroke) {
            rem[i] = 1;
            break;
          }
        }
      }
      for (let i = 0; i < n; i++) if (rem[i]) mask[i] = 0;
    }
  }

  function countMask(mask) {
    let a = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) a++;
    return a;
  }

  /**
   * 从泡内亮点洪水填充：可走亮色与文字墨迹，停于描边等其它暗色；
   * 以封闭内洞清麻点；贴黑线处内缩 mask，保留描边抗锯齿。
   * @returns {{ mask: Uint8Array, threshold: number, area: number } | null}
   */
  function detectBubbleMask(imageData, width, height) {
    if (!imageData || width < 4 || height < 4) return null;
    const { T, data, textMask, kept } = analyzeRoi(imageData, width, height);
    const seed = findBrightSeed(data, width, height, T, textMask, kept);
    if (!seed) return null;

    const n = width * height;
    const mask = new Uint8Array(n);
    const stack = [seed.y * width + seed.x];
    mask[stack[0]] = 1;
    let borderTouch = 0;

    while (stack.length) {
      const i = stack.pop();
      const x = i % width;
      const y = (i / width) | 0;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) borderTouch++;

      for (let k = 0; k < 8; k++) {
        const nx = x + N8[k][0], ny = y + N8[k][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (mask[j]) continue;
        if (textMask[j]) {
          mask[j] = 1;
          stack.push(j);
          continue;
        }
        if (pixelLum(data, j) >= T) {
          mask[j] = 1;
          stack.push(j);
        }
      }
    }

    let area = countMask(mask);
    const roiArea = width * height;
    if (area < 16) return null;
    if (area > roiArea * 0.92) return null;
    if (borderTouch > Math.max(width, height) * 0.35) return null;

    fillEnclosedHoles(mask, width, height);
    fillEnclosedHoles(mask, width, height);
    // 不膨胀；从描边内侧剥离 1～2px，保住黑线平滑抗锯齿
    const hardStroke = Math.max(28, Math.min(T * 0.85, 90));
    shrinkMaskFromStroke(mask, data, width, height, hardStroke, 2);

    area = countMask(mask);
    if (area < 16) return null;
    if (area > roiArea * 0.95) return null;
    return { mask, threshold: T, area };
  }

  function medianChannel(vals) {
    if (!vals.length) return 255;
    return Math.round(medianOf(vals));
  }

  function toHex(r, g, b) {
    return '#' + [r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
  }

  function parseHex(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return { r: 255, g: 255, b: 255 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  /**
   * 紧框外环带取偏亮色；不足则用 ROI 内非 ink 中位色。
   */
  function sampleRingColor(imageData, width, height, rect, inkThreshold) {
    const data = imageData.data;
    const T = typeof inkThreshold === 'number' ? inkThreshold : 128;
    const ring = 3;
    const rx0 = rect.x, ry0 = rect.y;
    const rx1 = rect.x + rect.w - 1, ry1 = rect.y + rect.h - 1;
    const rs = [], gs = [], bs = [];

    const pushIfBright = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const o = (y * width + x) * 4;
      const yv = luminance(data[o], data[o + 1], data[o + 2]);
      if (yv < T) return;
      rs.push(data[o]);
      gs.push(data[o + 1]);
      bs.push(data[o + 2]);
    };

    for (let y = ry0 - ring; y <= ry1 + ring; y++) {
      for (let x = rx0 - ring; x <= rx1 + ring; x++) {
        const inside = x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1;
        if (inside) continue;
        pushIfBright(x, y);
      }
    }

    if (rs.length < 8) {
      rs.length = 0;
      gs.length = 0;
      bs.length = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const o = (y * width + x) * 4;
          if (luminance(data[o], data[o + 1], data[o + 2]) < T) continue;
          rs.push(data[o]);
          gs.push(data[o + 1]);
          bs.push(data[o + 2]);
        }
      }
    }

    if (!rs.length) return '#ffffff';
    return toHex(medianChannel(rs), medianChannel(gs), medianChannel(bs));
  }

  /** 从 mask 内偏亮像素估底色 */
  function sampleMaskColor(imageData, width, height, mask, inkThreshold) {
    const data = imageData.data;
    const T = typeof inkThreshold === 'number' ? inkThreshold : 128;
    const rs = [], gs = [], bs = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const o = i * 4;
      if (luminance(data[o], data[o + 1], data[o + 2]) < T) continue;
      rs.push(data[o]);
      gs.push(data[o + 1]);
      bs.push(data[o + 2]);
    }
    if (rs.length < 4) {
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const o = i * 4;
        rs.push(data[o]);
        gs.push(data[o + 1]);
        bs.push(data[o + 2]);
      }
    }
    if (!rs.length) return '#ffffff';
    return toHex(medianChannel(rs), medianChannel(gs), medianChannel(bs));
  }

  /**
   * 将 mask 以纯色写入目标 ImageData（ROI 尺寸），供 putImageData 合成。
   * 仅改 RGB，保留 alpha。
   */
  function paintMaskIntoImageData(targetData, mask, hex) {
    const { r, g, b } = parseHex(hex);
    const data = targetData.data;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const o = i * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }

  App.SmartFill = {
    detectCoverRect,
    detectBubbleMask,
    sampleRingColor,
    sampleMaskColor,
    paintMaskIntoImageData
  };
})(window.App = window.App || {});
