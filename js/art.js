/* ============================================================
   art.js — 全部美术资源均由 Canvas 程序化绘制
   风格对标原作：厚涂卡通 / 强描边 / 高饱和 / 俯视 3/4 视角
   ============================================================ */
const Art = (() => {

  /* ---------- 稳定随机 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const _rngs = {};
  function rng(seed) { if (!_rngs[seed]) _rngs[seed] = mulberry32(seed); return _rngs[seed]; }

  function cv(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); return { c, x };
  }
  function ell(x, cx, cy, rx, ry) { x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); }
  function ink(x, w, col) { x.lineWidth = w; x.strokeStyle = col || PAL.outline; x.stroke(); }
  function vgrad(x, y0, y1, stops) {
    const g = x.createLinearGradient(0, y0, 0, y1);
    stops.forEach(s => g.addColorStop(s[0], s[1])); return g;
  }
  function hgrad(x, x0, x1, stops) {
    const g = x.createLinearGradient(x0, 0, x1, 0);
    stops.forEach(s => g.addColorStop(s[0], s[1])); return g;
  }
  function rgrad(x, cx, cy, r0, r1, stops) {
    const g = x.createRadialGradient(cx, cy, r0, cx, cy, r1);
    stops.forEach(s => g.addColorStop(s[0], s[1])); return g;
  }
  function roundRect(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py); x.lineTo(px + w - r, py); x.quadraticCurveTo(px + w, py, px + w, py + r);
    x.lineTo(px + w, py + h - r); x.quadraticCurveTo(px + w, py + h, px + w - r, py + h);
    x.lineTo(px + r, py + h); x.quadraticCurveTo(px, py + h, px, py + h - r);
    x.lineTo(px, py + r); x.quadraticCurveTo(px, py, px + r, py);
    x.closePath();
  }

  /* ============================================================
     地形
     ============================================================ */
  const THEME = {
    grass: { base: ['#a8dc5c', '#8cc63c', '#6fae27'], patch: ['#bded7d', '#7cc02f'], dirt: '#cdb079', dirt2: '#b0904f' },
    desert: { base: ['#f4dcaa', '#e0b972', '#c9964c'], patch: ['#fbeac4', '#d4a75f'], dirt: '#b8843f', dirt2: '#96682f' },
    snow: { base: ['#ffffff', '#f2f8ff', '#dbeaf9'], patch: ['#ffffff', '#e6f1fc'], dirt: '#b6cfe6', dirt2: '#96b3d1' },
    crossroads: { base: ['#a8dc5c', '#8cc63c', '#6fae27'], patch: ['#bded7d', '#7cc02f'], dirt: '#cdb079', dirt2: '#b0904f' }
  };

  let groundCache = null;
  function buildGround(map, H) {
    H = H || CANVAS_H;                       // 地面延伸到整块画布，底栏背后也是地形
    const { c, x } = cv(FIELD_W, H);
    const th = THEME[map.theme] || THEME.grass;
    const R = mulberry32(map.seed);

    // 底色
    const g = x.createLinearGradient(0, 0, FIELD_W * 0.4, H);
    g.addColorStop(0, th.base[0]); g.addColorStop(0.55, th.base[1]); g.addColorStop(1, th.base[2]);
    x.fillStyle = g; x.fillRect(0, 0, FIELD_W, H);

    // 大块色斑（厚涂笔触感）—— 数量多、边缘软，读起来像手绘草地
    for (let i = 0; i < 320; i++) {
      const px = R() * FIELD_W, py = R() * H;
      const rx = 36 + R() * 120, ry = 20 + R() * 62;
      x.globalAlpha = 0.14 + R() * 0.20;
      x.fillStyle = R() > 0.5 ? th.patch[0] : th.patch[1];
      ell(x, px, py, rx, ry); x.fill();
    }
    x.globalAlpha = 1;

    // 泥土/裸地斑块（缩小 + 降透明度，别把草地压成橄榄色）
    const dirtN = map.theme === 'desert' ? 30 : 12;
    for (let i = 0; i < dirtN; i++) {
      const px = 60 + R() * (FIELD_W - 120), py = 50 + R() * (FIELD_H - 100);
      const rx = 26 + R() * 54, ry = 14 + R() * 30;
      x.globalAlpha = 0.34;
      x.fillStyle = th.dirt; ell(x, px, py, rx, ry); x.fill();
      x.globalAlpha = 0.26;
      x.fillStyle = th.dirt2; ell(x, px + rx * 0.15, py + ry * 0.25, rx * 0.7, ry * 0.6); x.fill();
      x.globalAlpha = 0.20;
      x.fillStyle = th.patch[0]; ell(x, px - rx * 0.2, py - ry * 0.3, rx * 0.55, ry * 0.45); x.fill();
    }
    x.globalAlpha = 1;

    // 细碎纹理（草簇 / 砂砾）
    if (map.theme === 'grass' || map.theme === 'crossroads') {
      for (let i = 0; i < 1500; i++) {
        const px = R() * FIELD_W, py = R() * H, s = 2 + R() * 4;
        x.globalAlpha = 0.3 + R() * 0.42;
        x.strokeStyle = R() > 0.42 ? '#43740f' : '#c4ea7a';
        x.lineWidth = 1.5; x.lineCap = 'round';
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 5, py - s * 1.9); x.stroke();
      }
      // 稀疏的三叶草 / 小花点
      for (let i = 0; i < 300; i++) {
        const px = R() * FIELD_W, py = R() * H;
        x.globalAlpha = 0.16 + R() * 0.2;
        x.fillStyle = R() > 0.5 ? '#3f7a10' : '#d8f59a';
        ell(x, px, py, 2.4 + R() * 2.6, 1.8 + R() * 1.8); x.fill();
      }
      // 小白花 / 小黄花（设计稿草地上密密的小花点）
      for (let i = 0; i < 340; i++) {
        const px = R() * FIELD_W, py = R() * H, s = 1.5 + R() * 1.7;
        x.globalAlpha = 0.62 + R() * 0.34;
        x.fillStyle = R() > 0.34 ? '#ffffff' : '#ffe763';
        ell(x, px, py, s, s * 0.82); x.fill();
        if (R() > 0.55) { x.fillStyle = '#ffd23d'; ell(x, px, py, s * 0.42, s * 0.4); x.fill(); }
      }
    } else if (map.theme === 'snow') {
      // 雪原：细雪颗粒 + 冰晶闪点（不能沿用沙漠的棕色砂砾，否则雪地会发灰）
      for (let i = 0; i < 1300; i++) {
        const px = R() * FIELD_W, py = R() * H, s = 1 + R() * 2.6;
        x.globalAlpha = 0.30 + R() * 0.40;
        x.fillStyle = R() > 0.42 ? '#ffffff' : '#bcd6ee';
        ell(x, px, py, s, s * 0.72); x.fill();
      }
      // 冰面反光的斜向亮痕
      for (let i = 0; i < 70; i++) {
        const px = R() * FIELD_W, py = R() * H;
        x.globalAlpha = 0.10 + R() * 0.16;
        x.strokeStyle = '#ffffff'; x.lineWidth = 1.6 + R() * 2.4;
        x.beginPath(); x.moveTo(px, py);
        x.quadraticCurveTo(px + 34 + R() * 46, py - 4 - R() * 8, px + 76 + R() * 70, py + R() * 6);
        x.stroke();
      }
    } else {
      for (let i = 0; i < 1600; i++) {
        const px = R() * FIELD_W, py = R() * H, s = 1 + R() * 2.4;
        x.globalAlpha = 0.16 + R() * 0.24;
        x.fillStyle = R() > 0.5 ? '#8a6a3a' : '#fff0cf';
        ell(x, px, py, s, s * 0.7); x.fill();
      }
      // 风纹
      for (let i = 0; i < 60; i++) {
        const px = R() * FIELD_W, py = R() * H;
        x.globalAlpha = 0.1 + R() * 0.12;
        x.strokeStyle = '#fff3d4'; x.lineWidth = 1.6 + R() * 2;
        x.beginPath(); x.moveTo(px, py);
        x.quadraticCurveTo(px + 30 + R() * 50, py - 6 - R() * 10, px + 70 + R() * 80, py + R() * 8);
        x.stroke();
      }
    }
    x.globalAlpha = 1;

    // 暗角（收得轻一点，设计稿的草地整体是明亮的）
    const vg = x.createRadialGradient(FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.36, FIELD_W / 2, FIELD_H / 2, FIELD_W * 0.66);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,10,0,0.24)');
    x.fillStyle = vg; x.fillRect(0, 0, FIELD_W, H);

    return c;
  }

  /* ============================================================
     地形（河流 / 浅滩 / 高地 / 房屋 / 基地）
     只在开局烘一次进 groundWithDecor 缓存，不参与每帧渲染。

     叠加技巧：同一组格子画两遍、第二遍的 pad 更小，
     相邻格之间的接缝会被第二遍盖住，只剩外圈露出第一遍的颜色 ——
     这样不用手工描边就能得到干净的外轮廓。
     ============================================================ */
  /* 对齐设计稿：水是明亮的青绿色（turquoise），不是深蓝；
     两岸是一圈浅色卵石滩（沙 + 石头），水里还有露头的沙洲。 */
  const WATER = {
    grass: { deep: '#1f8ea4', mid: '#41c0d2', lit: '#93e4e6', foam: '#f4ffff', bank: '#c0a06d', stone: '#a2947f', edge: '#4c731d' },
    crossroads: { deep: '#1f8ea4', mid: '#41c0d2', lit: '#93e4e6', foam: '#f4ffff', bank: '#c0a06d', stone: '#a2947f', edge: '#4c731d' },
    desert: { deep: '#2a93a6', mid: '#4fc6d4', lit: '#a4ecf0', foam: '#f6ffff', bank: '#cdb079', stone: '#b6a184', edge: '#a8834a' },
    snow: { deep: '#3a7fa8', mid: '#6ec2de', lit: '#b6e6f4', foam: '#faffff', bank: '#a9bccd', stone: '#9fb2c2', edge: '#8d9db0' }
  };
  /* 高地：顶面是草，崖壁是分层岩（浅土黄 / 中棕 / 深褐），
     设计稿里台地是"平顶 + 岩壁 + 底部碎石裙"，不是绿色土包。 */
  const HILLC = {
    grass: {
      top: ['#c6f090', '#9ad950', '#7ab62f'], rim: '#d8f8a8',
      rock: ['#c2a173', '#94774b', '#5f4a28'], rockD: '#33260f', talus: '#8a7448'
    },
    crossroads: {
      top: ['#c6f090', '#9ad950', '#7ab62f'], rim: '#d8f8a8',
      rock: ['#c2a173', '#94774b', '#5f4a28'], rockD: '#33260f', talus: '#8a7448'
    },
    desert: {
      top: ['#f6e2b6', '#e0be80', '#bd9350'], rim: '#fdedc9',
      rock: ['#e0bc82', '#b08c56', '#77552c'], rockD: '#3f2c12', talus: '#96713e'
    },
    snow: {
      top: ['#f8fcff', '#e2edf8', '#bccfe4'], rim: '#ffffff',
      rock: ['#b9c9d8', '#7b8c9d', '#4b5866'], rockD: '#232c35', talus: '#6a7885'
    }
  };

  /* 把一组格子并成"外轮廓带圆角"的形状：
     先按 pad=0 建并集路径，再用 round join 的粗描边把它外扩 r —— 
     外角变圆、内角也变圆，河湾就不会是一格一格的直角瓷砖了。
     只描边不填充时得到的是"环形"，所以描边后还要 fill 一次。 */
  function blobShape(x, cells, r, col) {
    if (r <= 0) { unionRects(x, cells, 0); }
    else {
      unionRects(x, cells, 0);
      x.lineWidth = r * 2; x.lineJoin = 'round'; x.lineCap = 'round';
      x.strokeStyle = col; x.stroke();
    }
    x.fillStyle = col; x.fill();
  }

  /* 并集的外轮廓线段（沿河岸撒石子用） */
  function boundarySegs(keySet) {
    const segs = [];
    for (const k of keySet) {
      const p = k.split(','), c = +p[0], r = +p[1];
      const x0 = c * CELL, y0 = r * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      if (!keySet.has(c + ',' + (r - 1))) segs.push([x0, y0, x1, y0, 0, -1]);
      if (!keySet.has(c + ',' + (r + 1))) segs.push([x0, y1, x1, y1, 0, 1]);
      if (!keySet.has((c - 1) + ',' + r)) segs.push([x0, y0, x0, y1, -1, 0]);
      if (!keySet.has((c + 1) + ',' + r)) segs.push([x1, y0, x1, y1, 1, 0]);
    }
    return segs;
  }

  /* 一颗河滩石子 */
  function pebble(x, px, py, r, R, stone) {
    const pal = stone
      ? [shade(stone, 0.35), stone, shade(stone, -0.3), shade(stone, 0.6)]
      : ['#d8cdb8', '#ab9d88', '#877966', '#e8dfcc'];
    ell(x, px, py, r, r * (0.64 + R() * 0.22));
    x.fillStyle = pal[Math.floor(R() * 4)]; x.fill();
    ink(x, 0.9, 'rgba(58,46,30,0.62)');
    x.fillStyle = 'rgba(255,255,255,0.46)';
    ell(x, px - r * 0.28, py - r * 0.3, r * 0.34, r * 0.24); x.fill();
  }


  // 把一组格子并成一个矩形联合路径（pad 为向外的扩张量）
  function unionRects(x, cells, pad) {
    x.beginPath();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i][0], r = cells[i][1];
      x.rect(c * CELL - pad, r * CELL - pad, CELL + pad * 2, CELL + pad * 2);
    }
  }

  /* 只描「多格并集」的外轮廓：逐格检查四邻，邻居不在集合里才画那条边。
     直接 stroke 多矩形路径会把每一格的四条边都描出来，形成难看的网格线 ——
     河面和台面都会变成一格一格的瓷砖。dirs 可选，只画指定方向（n/s/w/e）。 */
  function outlinePath(x, keySet, inset, dirs) {
    const N = !dirs || dirs.indexOf('n') >= 0, S = !dirs || dirs.indexOf('s') >= 0;
    const W = !dirs || dirs.indexOf('w') >= 0, E = !dirs || dirs.indexOf('e') >= 0;
    x.beginPath();
    for (const k of keySet) {
      const p = k.split(','), c = +p[0], r = +p[1];
      const x0 = c * CELL + inset, y0 = r * CELL + inset;
      const x1 = (c + 1) * CELL - inset, y1 = (r + 1) * CELL - inset;
      if (N && !keySet.has(c + ',' + (r - 1))) { x.moveTo(x0, y0); x.lineTo(x1, y0); }
      if (S && !keySet.has(c + ',' + (r + 1))) { x.moveTo(x0, y1); x.lineTo(x1, y1); }
      if (W && !keySet.has((c - 1) + ',' + r)) { x.moveTo(x0, y0); x.lineTo(x0, y1); }
      if (E && !keySet.has((c + 1) + ',' + r)) { x.moveTo(x1, y0); x.lineTo(x1, y1); }
    }
  }
  const keySetOf = cells => new Set(cells.map(p => p[0] + ',' + p[1]));
  /* 河岸大石块的浅灰配色（设计稿河岸上的石头是浅灰的） */
  const RIVER_ROCK = ['#d6dad4', '#a7aca6', '#6d726d'];

  /* ============================================================
     并集轮廓「有机化」工具
     格子并集的轮廓是一堆直角边，直接外扩出来永远是「圆角矩形」。
     设计稿里的河和台地都是自然曲线 —— 所以：
       1) boundaryLoops  把并集外轮廓抽成闭合折线
       2) smoothLoop     等距重采样 + Chaikin 平滑，抹掉直角
       3) organicPath    沿外法线外扩，并叠一层正弦起伏（波浪边）
     这三步对任何形状都成立（L 形、分叉的河都行），不依赖「河流必须竖直」这类假设。
     ============================================================ */

  /* 并集的外轮廓 → 若干条闭合折线（顶点是屏幕坐标） */
  function boundaryLoops(keySet) {
    const edges = new Map();
    const K = (px, py) => px + ',' + py;
    for (const k of keySet) {
      const p = k.split(','), c = +p[0], r = +p[1];
      const x0 = c * CELL, y0 = r * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      /* 四条外边按同一绕向首尾相接；这样切线左转 90° 就是外法线 */
      if (!keySet.has(c + ',' + (r - 1))) edges.set(K(x0, y0), K(x1, y0));
      if (!keySet.has((c + 1) + ',' + r)) edges.set(K(x1, y0), K(x1, y1));
      if (!keySet.has(c + ',' + (r + 1))) edges.set(K(x1, y1), K(x0, y1));
      if (!keySet.has((c - 1) + ',' + r)) edges.set(K(x0, y1), K(x0, y0));
    }
    const loops = [], used = new Set();
    for (const start of Array.from(edges.keys())) {
      if (used.has(start)) continue;
      const loop = [];
      let cur = start;
      while (cur !== undefined && !used.has(cur)) {
        used.add(cur);
        const nxt = edges.get(cur);
        if (nxt === undefined) break;
        const q = cur.split(',');
        loop.push([+q[0], +q[1]]);
        cur = nxt;
      }
      if (loop.length >= 4) loops.push(loop);
    }
    return loops;
  }

  /* 等距重采样 + Chaikin 平滑：直角格子轮廓 → 柔顺曲线 */
  function smoothLoop(loop, step, iter) {
    let pts = [];
    const n0 = loop.length;
    for (let i = 0; i < n0; i++) {
      const a = loop[i], b = loop[(i + 1) % n0];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.max(1, Math.round(L / step));
      for (let j = 0; j < k; j++) {
        const t = j / k;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    for (let it = 0; it < iter; it++) {
      const out = [], n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      pts = out;
    }
    return pts;
  }

  /* 往当前路径里追加一条「外扩 + 波浪」的闭合折线（不 beginPath） */
  function addOrganic(x, pts, expand, amp, cycles, phase) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      const nx = ty, ny = -tx;                       // 外法线
      const th = i / n * Math.PI * 2, ph = phase || 0;
      const d = expand + (amp
        ? amp * Math.sin(th * cycles + ph)
          + amp * 0.46 * Math.sin(th * cycles * 2.37 + ph * 2.7 + 1.1)
        : 0);
      const px = p[0] + nx * d, py = p[1] + ny * d;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
  }
  function organicPath(x, pts, expand, amp, cycles, phase) {
    x.beginPath(); addOrganic(x, pts, expand, amp, cycles, phase);
  }
  /* 只要偏移后的点（同一形状要重复画很多遍时，算一次就够了） */
  function organicPts(pts, expand, amp, cycles, phase) {
    const n = pts.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      const nx = ty, ny = -tx;
      const th = i / n * Math.PI * 2, ph = phase || 0;
      const d = expand + (amp
        ? amp * Math.sin(th * cycles + ph)
          + amp * 0.46 * Math.sin(th * cycles * 2.37 + ph * 2.7 + 1.1)
        : 0);
      out[i] = [p[0] + nx * d, p[1] + ny * d];
    }
    return out;
  }
  /* 把若干条点数组拼成一条路径（可含多个子路径） */
  function pathOf(x, arrs) {
    x.beginPath();
    for (let k = 0; k < arrs.length; k++) {
      const arr = arrs[k];
      for (let i = 0; i < arr.length; i++) {
        if (i === 0) x.moveTo(arr[i][0], arr[i][1]); else x.lineTo(arr[i][0], arr[i][1]);
      }
      x.closePath();
    }
  }
  /* 多条折线合成一条路径（用来 clip 整个并集） */
  function organicPathAll(x, loops, expand, amp, cycles, phase) {
    x.beginPath();
    for (let i = 0; i < loops.length; i++) {
      addOrganic(x, loops[i], expand, amp, Array.isArray(cycles) ? cycles[i] : cycles, phase);
    }
  }

  /* 并集轮廓 → 平滑好的折线数组 */
  function organicLoops(cells, step, iter) {
    return boundaryLoops(keySetOf(cells))
      .map(l => smoothLoop(l, step || 15, iter === undefined ? 2 : iter));
  }
  /* 按周长换算正弦周期数，保证大形状和小形状的波浪波长一致 */
  function loopCycles(pts, wave) {
    let per = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      per += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return Math.max(3, Math.round(per / (wave || 240)));
  }
  /* 一组点数组的包围盒（崖壁渐变要按真实高度铺，不能拍脑袋给常数） */
  function bboxOf(arrs) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < arrs.length; k++) {
      const arr = arrs[k];
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      }
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  /* 逐格判断水流方向：'v' 竖直 / 'h' 水平。
     急流条纹必须顺着本地流向画，否则 L 形河道拐弯处会出现横切的乱纹。 */
  function flowDirs(cells) {
    const set = keySetOf(cells), m = new Map();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i][0], r = cells[i][1];
      const nn = set.has(c + ',' + (r - 1)), ss = set.has(c + ',' + (r + 1));
      const ww = set.has((c - 1) + ',' + r), ee = set.has((c + 1) + ',' + r);
      const vv = (nn ? 1 : 0) + (ss ? 1 : 0), hh = (ww ? 1 : 0) + (ee ? 1 : 0);
      m.set(c + ',' + r, vv >= hh ? 'v' : 'h');
    }
    return m;
  }
  /* 柔边水花：几层递减透明度的椭圆叠出「晕」，硬边白圈会像贴纸 */
  function foam(x, px, py, rx, ry, col) {
    for (let k = 3; k >= 1; k--) {
      x.globalAlpha = 0.15 * k;
      x.fillStyle = col;
      ell(x, px, py, rx * (k / 3), ry * (k / 3)); x.fill();
    }
    x.globalAlpha = 1;
  }

  /* 一条折线的包围盒 + 主方向（用来判断水流朝向） */
  function loopInfo(pts) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, vertical: (y1 - y0) >= (x1 - x0) };
  }

  /* ============================================================
     河流 —— 对齐设计稿 mp-river：
       自然蜿蜒的水带（不是格子瓷砖）+ 窄沙岸 + 灰色石块 + 顺流的白色急流。
     轮廓走 organicLoops：格子并集 → 平滑曲线 → 正弦波浪边。
     ============================================================ */
  function drawRiver(x, cells, fordCells, w, R) {
    if (!cells.length) return;
    const all = cells.concat(fordCells);
    const loops = organicLoops(all, 15, 2);
    const CY = loops.map(p => loopCycles(p, 340));
    const dir = flowDirs(cells);
    /* 随机取一格 + 该格的流向（急流/波光都要贴着水面走） */
    const pick = () => {
      const c = cells[Math.floor(R() * cells.length)];
      return [c[0] * CELL, c[1] * CELL, dir.get(c[0] + ',' + c[1])];
    };

    /* 兜底：并集本身先铺满水色，曲线怎么摆都不会漏出草地 */
    x.save();
    unionRects(x, cells, 0); x.fillStyle = w.mid; x.fill();
    x.restore();

    /* ── 1. 窄沙岸 ──
       设计稿里草地几乎贴到水边，只有很窄一条土黄河滩。
       各层共用同一组 amp/phase，只改 expand —— 这样沙岸宽度恒定，
       不会出现「水鼓出来、沙没跟上」的漏底。
       三带：外侧暗土（与草地的过渡）→ 中间干沙 → 贴水湿沙。 */
    for (let i = 0; i < loops.length; i++) {
      organicPath(x, loops[i], 17, 8, CY[i], 2.3);
      x.fillStyle = shade(w.bank, -0.16); x.fill();
    }
    for (let i = 0; i < loops.length; i++) {
      organicPath(x, loops[i], 11, 8, CY[i], 2.3);
      x.fillStyle = shade(w.bank, 0.20); x.fill();
    }
    for (let i = 0; i < loops.length; i++) {
      organicPath(x, loops[i], 5, 7, CY[i], 2.3);
      x.fillStyle = shade(w.bank, -0.22); x.fill();
    }
    /* 草地压边：沙岸外侧一圈暗绿，河滩才嵌进草地 */
    for (let i = 0; i < loops.length; i++) {
      organicPath(x, loops[i], 20, 8, CY[i], 2.3);
      x.globalAlpha = 0.60; x.strokeStyle = w.edge || '#4c731d'; x.lineWidth = 5.2;
      x.lineJoin = 'round'; x.stroke();
    }
    x.globalAlpha = 1;

    /* ── 1.5 河床落差 ──
       水面比草地低一截，斜视下**远岸（屏幕上边）**会露出内壁。
       做法：把水面轮廓整体上移 DROP、填成暗土色，再画真正的水面压住下半部分 ——
       露出来的那条 DROP 高的带子就是土坎，河立刻从「贴纸」变成「凹下去的槽」。 */
    const DROP = 8.5;
    for (let i = 0; i < loops.length; i++) {
      organicPath(x, loops[i], 5, 7, CY[i], 2.3);
      x.save();
      x.translate(0, -DROP);
      x.fillStyle = shade(w.bank, -0.46); x.fill();
      /* 坎顶一道亮边：受光的土沿 */
      x.strokeStyle = shade(w.bank, 0.06); x.lineWidth = 2.0;
      x.lineJoin = 'round'; x.stroke();
      x.restore();
    }

    /* ── 2. 水面 ── */
    for (let i = 0; i < loops.length; i++) {
      organicPath(x, loops[i], 5, 7, CY[i], 2.3);
      x.fillStyle = w.mid; x.fill();
    }
    x.save();
    organicPathAll(x, loops, 5, 7, CY, 2.3); x.clip();

    /* 2a. 深浅渐变：对角铺，中间偏深、两岸偏亮 */
    const wg = x.createLinearGradient(0, 0, FIELD_W, FIELD_H);
    wg.addColorStop(0, w.lit); wg.addColorStop(0.42, w.mid); wg.addColorStop(1, w.deep);
    x.globalAlpha = 0.80; x.fillStyle = wg; x.fillRect(0, 0, FIELD_W, FIELD_H);
    x.globalAlpha = 1;

    /* 2b. 靠岸浅水：沿轮廓往里描一道亮色 */
    for (let i = 0; i < loops.length; i++) {
      organicPath(x, loops[i], 3, 7, CY[i], 2.3);
      x.globalAlpha = 0.46; x.strokeStyle = w.lit; x.lineWidth = 24;
      x.lineJoin = 'round'; x.stroke();
    }
    x.globalAlpha = 1;

    /* 2c. 河床：水底透出来的暖沙色（设计稿的水很清） */
    for (let i = 0; i < loops.length; i++) {
      organicPath(x, loops[i], 2, 7, CY[i], 2.3);
      x.globalAlpha = 0.34; x.strokeStyle = shade(w.bank, 0.34); x.lineWidth = 11;
      x.lineJoin = 'round'; x.stroke();
    }
    x.globalAlpha = 1;

    /* 2d. 水下沙洲 + 沉底石子 */
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i][0], r = cells[i][1];
      if (R() > 0.34) continue;
      const px = c * CELL + 8 + R() * (CELL - 16), py = r * CELL + 8 + R() * (CELL - 16);
      const rx = 14 + R() * 30, ry = 8 + R() * 14;
      x.globalAlpha = 0.20 + R() * 0.20;
      x.fillStyle = shade(w.bank, 0.34);
      ell(x, px, py, rx, ry); x.fill();
      x.globalAlpha = 0.16 + R() * 0.14;
      x.fillStyle = shade(w.bank, 0.62);
      ell(x, px - rx * 0.14, py - ry * 0.18, rx * 0.62, ry * 0.50); x.fill();
    }
    for (let i = 0; i < 90; i++) {
      const [c, r] = cells[Math.floor(R() * cells.length)];
      x.globalAlpha = 0.20 + R() * 0.26;
      pebble(x, c * CELL + R() * CELL, r * CELL + R() * CELL, 1.5 + R() * 3.0, R, w.stone);
    }
    x.globalAlpha = 1;

    /* 2e. 急流：顺流的白色条纹（设计稿里最提气的一笔） */
    for (let i = 0; i < 320; i++) {
      const p = pick();
      const px = p[0] + R() * CELL, py = p[1] + R() * CELL;
      const len = 16 + R() * 54;
      x.globalAlpha = 0.12 + R() * 0.30;
      x.strokeStyle = R() > 0.32 ? w.foam : shade(w.deep, 0.12);
      x.lineWidth = 1.2 + R() * 1.8; x.lineCap = 'round';
      x.beginPath();
      if (p[2] === 'v') {
        x.moveTo(px, py);
        x.quadraticCurveTo(px - 2 - R() * 4, py + len * 0.5, px, py + len);
      } else {
        x.moveTo(px, py);
        x.quadraticCurveTo(px + len * 0.5, py - 2 - R() * 4, px + len, py);
      }
      x.stroke();
    }
    /* 波光 */
    for (let i = 0; i < 130; i++) {
      const p = pick();
      const px = p[0] + R() * CELL, py = p[1] + R() * CELL;
      x.globalAlpha = 0.18 + R() * 0.32; x.fillStyle = w.foam;
      if (p[2] === 'v') ell(x, px, py, 1.4 + R() * 2.6, 3 + R() * 9);
      else ell(x, px, py, 3 + R() * 9, 1.4 + R() * 2.6);
      x.fill();
    }
    x.globalAlpha = 1;

    /* 2f. 水里露头的大石头 + 浪花（设计稿里最醒目的元素） */
    const nRock = Math.max(5, Math.round(cells.length * 0.40));
    for (let i = 0; i < nRock; i++) {
      const c = cells[Math.floor(R() * cells.length)];
      const px = c[0] * CELL + 8 + R() * (CELL - 16);
      const py = c[1] * CELL + 8 + R() * (CELL - 16);
      const rr = 0.22 + R() * 0.28;
      foam(x, px, py + rr * 5, rr * 46, rr * 24, w.foam);
      x.globalAlpha = 0.38;
      x.fillStyle = w.foam;
      ell(x, px, py + rr * 9, rr * 32, rr * 14); x.fill();
      x.globalAlpha = 1;
      rock(x, px, py, rr, RIVER_ROCK);
      /* 石头下游的水花弧线 */
      x.globalAlpha = 0.62; x.strokeStyle = w.foam; x.lineWidth = 2.2; x.lineCap = 'round';
      x.beginPath();
      x.moveTo(px - rr * 34, py + rr * 15);
      x.quadraticCurveTo(px, py + rr * 27, px + rr * 34, py + rr * 15);
      x.stroke();
      x.globalAlpha = 1;
    }
    /* 水线：沿轮廓的白边 */
    for (let i = 0; i < loops.length; i++) {
      organicPath(x, loops[i], 5, 7, CY[i], 2.3);
      x.globalAlpha = 0.44; x.strokeStyle = w.foam; x.lineWidth = 2.6;
      x.lineJoin = 'round'; x.stroke();
    }
    x.globalAlpha = 1;
    x.restore();

    /* ── 3. 河岸：零散小石 + 偶尔一块大石（不是"石头项链"） ── */
    for (const s of boundarySegs(keySetOf(all))) {
      const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
      const n = Math.max(1, Math.round(len / 30));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5 + (R() - 0.5) * 0.9) / n;
        const bx = s[0] + (s[2] - s[0]) * u, by = s[1] + (s[3] - s[1]) * u;
        const off = 4 + R() * 12;
        x.globalAlpha = 0.55 + R() * 0.45;
        pebble(x, bx + s[4] * off + (R() - 0.5) * 14, by + s[5] * off + (R() - 0.5) * 14,
          1.7 + R() * 3.0, R, R() > 0.55 ? w.stone : shade(w.stone, -0.35));
      }
      x.globalAlpha = 1;
      const n2 = Math.max(1, Math.round(len / 210));
      for (let i = 0; i < n2; i++) {
        const u = (i + 0.5 + (R() - 0.5) * 0.6) / n2;
        const bx = s[0] + (s[2] - s[0]) * u, by = s[1] + (s[3] - s[1]) * u;
        const off = 7 + R() * 9;
        rock(x, bx + s[4] * off + (R() - 0.5) * 12, by + s[5] * off + (R() - 0.5) * 12,
          0.22 + R() * 0.20, RIVER_ROCK);
      }
    }

    /* ── 4. 浅滩（渡口）：露出水面的沙石滩 ── */
    if (fordCells.length) {
      const fl = organicLoops(fordCells, 13, 2);
      const fc = fl.map(p => loopCycles(p, 150));
      /* 湿沙过渡圈 */
      for (let i = 0; i < fl.length; i++) {
        organicPath(x, fl[i], 11, 4, fc[i], 0.6);
        x.fillStyle = 'rgba(150,128,84,0.58)'; x.fill();
      }
      /* 露出水面的沙石滩 */
      for (let i = 0; i < fl.length; i++) {
        organicPath(x, fl[i], 4, 3, fc[i], 1.5);
        x.fillStyle = '#e0c691'; x.fill();
      }
      /* 滩沿一圈白色水线：浅滩是「露出水面」的，不是贴上去的 */
      for (let i = 0; i < fl.length; i++) {
        organicPath(x, fl[i], 6, 3, fc[i], 1.5);
        x.globalAlpha = 0.50; x.strokeStyle = w.foam; x.lineWidth = 2.4;
        x.lineJoin = 'round'; x.stroke();
      }
      x.globalAlpha = 1;

      x.save();
      organicPathAll(x, fl, 4, 3, fc, 1.5);
      x.clip();
      for (let i = 0; i < 44; i++) {
        const [c, r] = fordCells[Math.floor(R() * fordCells.length)];
        const px = c * CELL + R() * CELL, py = r * CELL + R() * CELL;
        x.globalAlpha = 0.5 + R() * 0.5;
        pebble(x, px, py, 2.2 + R() * 4.0, R, w.stone);
      }
      x.globalAlpha = 1;
      /* 浅滩上的水纹 */
      x.globalAlpha = 0.32; x.strokeStyle = w.foam; x.lineWidth = 2.0; x.lineCap = 'round';
      for (let i = 0; i < 52; i++) {
        const [c, r] = fordCells[Math.floor(R() * fordCells.length)];
        const px = c * CELL + R() * CELL, py = r * CELL + R() * CELL;
        x.beginPath(); x.moveTo(px - 12, py); x.quadraticCurveTo(px, py - 3, px + 12, py); x.stroke();
      }
      x.globalAlpha = 1;
      x.restore();
    }
  }

  /* ============================================================
     高地（台地）—— 对齐设计稿 mp-hills：
       2~3 层同心台地，每层 = 竖砌石块崖壁 + 亮绿草顶，
       轮廓走 organicLoops（平滑 + 波浪边），不是格子瓷砖。
       层数按高地的规模决定：大块台地才有 3 层。
     ============================================================ */
  function drawHills(x, cells, hc, R) {
    if (!cells.length) return;
    const loops = organicLoops(cells, 14, 2);
    const CY = loops.map(p => loopCycles(p, 210));

    const TIERS = cells.length >= 7 ? 3 : 2;
    const STEP = TIERS === 3 ? 19 : 24;                  // 每层抬高
    /* 顶层就是格子并集本身（台面最宽），下层逐层向外扩 ——
       对齐设计稿的"蛋糕"结构：最上面是一大片平草顶，下层从底下探出一圈。 */
    const EXP = TIERS === 3 ? [52, 26, 0] : [32, 0];
    const stoneL = hc.rock[0], stoneM = hc.rock[1], stoneD = hc.rock[2];

    /* ── 1. 落地影 ── */
    x.save(); x.translate(0, TIERS * STEP + 4);
    for (let i = 0; i < loops.length; i++) {
      organicPath(x, loops[i], EXP[0] + 6, 8, CY[i], 0.5);
      x.fillStyle = 'rgba(18,10,3,0.24)'; x.fill();
    }
    x.restore();

    let yOff = 0;
    for (let t = 0; t < TIERS; t++) {
      const ex = EXP[t];
      const arrs = loops.map((p, i) => organicPts(p, ex, 4.6, CY[i], 0.9));
      const bb = bboxOf(arrs);

      /* ── 2a. 石砌崖壁（这一层的底面） ── */
      x.save(); x.translate(0, yOff + STEP);
      pathOf(x, arrs);
      x.fillStyle = vgrad(x, bb.y0, bb.y1, [[0, stoneL], [0.42, stoneM], [1, shade(stoneM, -0.12)]]);
      x.fill();
      x.save();
      pathOf(x, arrs); x.clip();
      /* 底部压深：崖脚自然变暗 */
      x.fillStyle = vgrad(x, bb.y1 - 22, bb.y1, [[0, 'rgba(40,26,10,0)'], [1, 'rgba(40,26,10,0.42)']]);
      x.fillRect(bb.x0 - 10, bb.y0 - 10, bb.x1 - bb.x0 + 20, bb.y1 - bb.y0 + 20);
      /* 干砌石墙：两排错缝的石块 */
      const bw = 20, bh = STEP / 2;
      x.lineJoin = 'round';
      for (let row = 0; row < 2; row++) {
        const y0 = -STEP + row * bh;
        x.strokeStyle = 'rgba(42,28,10,0.60)'; x.lineWidth = 1.8;
        x.beginPath(); x.moveTo(-30, y0 + bh); x.lineTo(FIELD_W + 30, y0 + bh); x.stroke();
        const off = row * (bw / 2);
        for (let gx = -30 + off; gx < FIELD_W + 30; gx += bw) {
          x.beginPath(); x.moveTo(gx, y0); x.lineTo(gx, y0 + bh); x.stroke();
          x.strokeStyle = 'rgba(255,246,220,0.22)'; x.lineWidth = 1.3;
          x.beginPath(); x.moveTo(gx + 2.4, y0 + 1.4); x.lineTo(gx + 2.4, y0 + bh - 1.4); x.stroke();
          x.strokeStyle = 'rgba(42,28,10,0.60)'; x.lineWidth = 1.8;
        }
      }
      /* 嵌在崖壁上的碎石 */
      for (let i = 0; i < 12; i++) {
        const c = cells[Math.floor(R() * cells.length)];
        x.globalAlpha = 0.22 + R() * 0.26;
        pebble(x, c[0] * CELL + (R() - 0.5) * 48, c[1] * CELL + (R() - 0.5) * 48,
          2.0 + R() * 3.2, R, stoneL);
      }
      x.globalAlpha = 1;
      x.restore();
      /* 崖壁外缘描边：层与层之间才分得开 */
      pathOf(x, arrs);
      x.strokeStyle = 'rgba(52,36,16,0.58)'; x.lineWidth = 2.2;
      x.lineJoin = 'round'; x.stroke();
      x.restore();

      /* ── 2b. 亮绿草顶 ── */
      x.save(); x.translate(0, yOff);
      pathOf(x, arrs);
      /* 台面要「一片亮绿」，不能按整块高度做渐变 ——
         否则下层露出的那一圈会落在渐变底部，变成深绿描边线。 */
      x.fillStyle = vgrad(x, bb.y0, bb.y1,
        [[0, hc.top[0]], [0.62, hc.top[1]], [1, shade(hc.top[1], -0.05)]]);
      x.fill();
      x.save();
      pathOf(x, arrs); x.clip();
      for (let i = 0; i < 130; i++) {                    // 草簇
        const px = R() * FIELD_W, py = R() * FIELD_H;
        x.globalAlpha = 0.12 + R() * 0.22;
        x.strokeStyle = R() > 0.5 ? hc.top[2] : hc.rim;
        x.lineWidth = 1.3 + R() * 2;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 8, py - 3 - R() * 7); x.stroke();
      }
      for (let i = 0; i < 11; i++) {                     // 台面上的石头与灌木
        const c = cells[Math.floor(R() * cells.length)];
        const px = c[0] * CELL + (R() - 0.5) * 40, py = c[1] * CELL + (R() - 0.5) * 40;
        x.globalAlpha = 0.88;
        if (R() > 0.45) rock(x, px, py, 0.24 + R() * 0.20, RIVER_ROCK);
        else bush(x, px, py, 0.28 + R() * 0.18, R() > 0.5);
      }
      for (let i = 0; i < 46; i++) {                     // 小白花
        const px = R() * FIELD_W, py = R() * FIELD_H;
        x.globalAlpha = 0.24 + R() * 0.30;
        x.fillStyle = hc.rim;
        ell(x, px, py, 2 + R() * 5, 1.4 + R() * 2.4); x.fill();
      }
      x.globalAlpha = 1;
      x.restore();

      /* 草檐：一圈深绿压边 + 垂在崖壁上的草叶 —— 草地是「盖」在崖壁上的。
         不要亮色描边：设计稿里草地边缘是暗的，亮描边会变成等高线。 */
      const inner = loops.map((p, i) => organicPts(p, ex - 3.0, 4.6, CY[i], 0.9));
      pathOf(x, inner);
      x.strokeStyle = shade(hc.top[2], -0.34); x.lineWidth = 3.4;
      x.lineJoin = 'round'; x.stroke();
      for (let i = 0; i < inner.length; i++) {
        const arr = inner[i];
        for (let k = 0; k < arr.length; k++) {
          if (R() > 0.46) continue;
          const a = arr[k], b = arr[(k + 1) % arr.length];
          const dl = 3.0 + R() * 5.4;
          x.globalAlpha = 0.55 + R() * 0.35;
          x.fillStyle = R() > 0.5 ? hc.top[1] : shade(hc.top[2], -0.10);
          ell(x, (a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5 + dl * 0.46,
            2.4 + R() * 2.2, dl); x.fill();
        }
      }
      x.globalAlpha = 1;
      x.restore();

      yOff -= STEP;
    }

    /* ── 3. 台脚散落的碎石 ── */
    for (let i = 0; i < 24; i++) {
      const c = cells[Math.floor(R() * cells.length)];
      const px = c[0] * CELL + (R() - 0.5) * 78;
      const py = c[1] * CELL + (R() - 0.5) * 52 + TIERS * STEP + 3;
      x.globalAlpha = 0.55 + R() * 0.4;
      pebble(x, px, py, 2.4 + R() * 4.0, R, hc.talus);
    }
    x.globalAlpha = 1;
  }

  /* 房屋 —— 对齐设计稿：灰石块砌的遗迹，红瓦顶、拱门、破损的墙角、散落的碎石。
     （设计稿里房屋就是"石头废墟"，不是木屋） */
  function drawHouse(x, px, py, w, h, R) {
    const cx = px + w / 2;
    x.save();

    /* ── 落地阴影 ── */
    ell(x, cx, py + h - 3, w * 0.56, h * 0.26);
    x.fillStyle = 'rgba(20,12,4,0.30)'; x.fill();

    /* ── 墙脚碎石 ── */
    for (let i = 0; i < 14; i++) {
      const a = R() * Math.PI * 2;
      pebble(x, cx + Math.cos(a) * w * (0.42 + R() * 0.16),
        py + h * 0.62 + Math.sin(a) * h * (0.34 + R() * 0.16),
        2.4 + R() * 3.8, R, ['#c3bdae', '#9d9686', '#7c7466'][Math.floor(R() * 3)]);
    }

    /* ── 石墙（俯视 3/4：能看到下方一大截墙）── */
    const wy = py + h * 0.34, ww = w - 14, wh = h * 0.58;
    const wx0 = cx - ww / 2;
    roundRect(x, wx0, wy, ww, wh, 5);
    x.fillStyle = vgrad(x, wy, wy + wh, [[0, '#dcd7cc'], [0.35, '#bdb6a8'], [1, '#8e8779']]);
    x.fill(); ink(x, 2.6, '#3a352c');

    /* 石块砌缝 */
    x.save(); roundRect(x, wx0, wy, ww, wh, 5); x.clip();
    x.strokeStyle = 'rgba(70,64,52,0.34)'; x.lineWidth = 1.5;
    let row = 0;
    for (let by = wy + 11; by < wy + wh; by += 11) {
      x.beginPath(); x.moveTo(wx0, by); x.lineTo(wx0 + ww, by); x.stroke();
      const off = (row % 2) * 11;
      for (let bx = wx0 + 9 + off; bx < wx0 + ww; bx += 22) {
        x.beginPath(); x.moveTo(bx, by - 11); x.lineTo(bx, by); x.stroke();
      }
      row++;
    }
    x.restore();

    /* 墙面高光 */
    x.globalAlpha = 0.30; x.fillStyle = '#ffffff';
    roundRect(x, wx0 + 4, wy + 3, ww - 8, 7, 3); x.fill();
    x.globalAlpha = 1;

    /* ── 红瓦顶：两坡 + 屋脊 + 出檐 ── */
    const rx = cx - w / 2 + 2, ry = py + 3, rw = w - 4, rh = h * 0.52;
    const rg = x.createLinearGradient(0, ry, 0, ry + rh);
    rg.addColorStop(0, '#e2604a'); rg.addColorStop(0.42, '#bc3d26'); rg.addColorStop(1, '#7f2314');
    roundRect(x, rx, ry, rw, rh, 5); x.fillStyle = rg; x.fill(); ink(x, 3, '#33170c');
    /* 瓦楞 */
    x.save(); roundRect(x, rx, ry, rw, rh, 5); x.clip();
    x.globalAlpha = 0.30; x.strokeStyle = '#ffb9a0'; x.lineWidth = 2;
    for (let k = ry + 8; k < ry + rh; k += 10) { x.beginPath(); x.moveTo(rx, k); x.lineTo(rx + rw, k); x.stroke(); }
    x.globalAlpha = 0.36; x.strokeStyle = '#5e160b'; x.lineWidth = 1.6;
    for (let k = ry + 13; k < ry + rh; k += 10) { x.beginPath(); x.moveTo(rx, k); x.lineTo(rx + rw, k); x.stroke(); }
    /* 竖向瓦沟 */
    x.globalAlpha = 0.18; x.strokeStyle = '#5e160b'; x.lineWidth = 1.3;
    for (let k = rx + 8; k < rx + rw; k += 12) { x.beginPath(); x.moveTo(k, ry); x.lineTo(k, ry + rh); x.stroke(); }
    x.restore(); x.globalAlpha = 1;
    /* 屋脊高光 */
    x.globalAlpha = 0.5; x.strokeStyle = '#ffd9c6'; x.lineWidth = 3; x.lineCap = 'round';
    x.beginPath(); x.moveTo(rx + 6, ry + 3.5); x.lineTo(rx + rw - 6, ry + 3.5); x.stroke();
    x.globalAlpha = 1;

    /* ── 塌掉的屋角：右上角缺一块，露出石墙 ── */
    const crx = rx + rw - 20, cry = ry - 2;
    x.beginPath();
    x.moveTo(crx, cry); x.lineTo(rx + rw + 4, cry);
    x.lineTo(rx + rw + 4, ry + 17);
    x.lineTo(crx + 12, ry + 9);
    x.lineTo(crx + 4, ry + 13);
    x.closePath();
    x.fillStyle = vgrad(x, cry, cry + 20, [[0, '#cbc4b6'], [1, '#8b8476']]);
    x.fill(); ink(x, 2.4, '#3a352c');
    for (let i = 0; i < 5; i++) {
      pebble(x, crx + R() * 22, ry + 16 + R() * 16, 2.0 + R() * 3.0, R, '#9d9686');
    }

    /* ── 拱门 ── */
    const dw = Math.min(24, ww * 0.40), dh = Math.min(22, wh * 0.56);
    const dx = cx - dw / 2, dy = wy + wh - dh;
    x.beginPath();
    x.moveTo(dx, wy + wh);
    x.lineTo(dx, dy + dw / 2);
    x.arc(cx, dy + dw / 2, dw / 2, Math.PI, 0);
    x.lineTo(dx + dw, wy + wh);
    x.closePath();
    x.fillStyle = vgrad(x, dy, wy + wh, [[0, '#6d6555'], [0.5, '#3b352a'], [1, '#1c180f']]);
    x.fill(); ink(x, 2.4, '#2a251b');
    /* 拱券石 */
    x.strokeStyle = '#cbc4b6'; x.lineWidth = 3.4;
    x.beginPath();
    x.arc(cx, dy + dw / 2, dw / 2 + 2.6, Math.PI * 1.04, Math.PI * 1.96);
    x.stroke();

    /* ── 两扇小窗 ── */
    [wx0 + 11, wx0 + ww - 11].forEach(wx => {
      roundRect(x, wx - 6, wy + 15, 12, 11, 2);
      x.fillStyle = '#7fc7e8'; x.fill(); ink(x, 2.2, '#2c1c0c');
      x.globalAlpha = 0.6; x.fillStyle = '#ffffff';
      x.beginPath(); x.moveTo(wx - 6, wy + 26); x.lineTo(wx + 6, wy + 15);
      x.lineTo(wx + 6, wy + 19); x.lineTo(wx - 6, wy + 29); x.closePath(); x.fill();
      x.globalAlpha = 1;
    });

    x.restore();
  }

  function drawTerrain(x, map) {
    if (!map.terrain) return;
    const grid = parseTerrain(map);
    const R = mulberry32(map.seed + 11);
    const chOf = i => TILE_CHARS[grid[i]];
    const collect = ch => {
      const out = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (chOf(r * COLS + c) === ch) out.push([c, r]);
      return out;
    };

    const river = collect('~'), ford = collect('=');
    const w = WATER[map.theme] || WATER.grass;
    drawRiver(x, river, ford, w, R);

    drawHills(x, collect('^'), HILLC[map.theme] || HILLC.grass, R);

    // 房屋：把相邻的房屋格并成连通块，每块画一栋
    const seen = new Uint8Array(COLS * ROWS);
    for (const [sc, sr] of collect('#')) {
      if (seen[sr * COLS + sc]) continue;
      const stack = [[sc, sr]], comp = [];
      seen[sr * COLS + sc] = 1;
      while (stack.length) {
        const [c, r] = stack.pop(); comp.push([c, r]);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
          if (seen[nr * COLS + nc] || chOf(nr * COLS + nc) !== '#') continue;
          seen[nr * COLS + nc] = 1; stack.push([nc, nr]);
        }
      }
      let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
      comp.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
      drawHouse(x, x0 * CELL, y0 * CELL, (x1 - x0 + 1) * CELL, (y1 - y0 + 1) * CELL, R);
    }

    // 基地平台（堡垒本体由 drawBaseWall 每帧绘制）——
    // 压成浅色石台并加粗描边，好让堡垒从上面"浮"出来
    const base = collect('B');
    if (base.length) {
      const bset = keySetOf(base);
      blobShape(x, base, 5, '#b9b2a4');
      x.save();
      unionRects(x, base, 0);
      x.lineWidth = 6; x.lineJoin = 'round'; x.lineCap = 'round';
      x.strokeStyle = '#cfc8ba'; x.stroke();
      x.fillStyle = vgrad(x, 0, FIELD_H, [[0, '#ded8cc'], [0.5, '#bdb6a7'], [1, '#948c7c']]);
      x.fill(); x.clip();
      for (let i = 0; i < 150; i++) {
        const px = R() * FIELD_W, py = R() * FIELD_H;
        x.globalAlpha = 0.12 + R() * 0.24;
        x.fillStyle = R() > 0.5 ? '#f0ece2' : '#6f6858';
        roundRect(x, px, py, 6 + R() * 18, 5 + R() * 13, 2); x.fill();
      }
      x.globalAlpha = 1; x.restore();
      outlinePath(x, bset, -4);
      x.globalAlpha = 0.85; x.strokeStyle = '#5c5546'; x.lineWidth = 3.2; x.stroke();
      x.globalAlpha = 1;
    }
  }

  /* ---------- 装饰物 ---------- */
  function bush(x, px, py, s, dark) {
    const c1 = dark ? '#2f6b12' : '#3f8a17', c2 = dark ? '#4d9a22' : '#68b62c';
    x.save(); x.translate(px, py); x.scale(s, s);
    ell(x, 0, 4, 17, 9); x.fillStyle = 'rgba(0,0,0,0.22)'; x.fill();
    const lobes = [[-11, 0, 10], [0, -4, 12.5], [11, 0, 10], [-5, 5, 8.5], [6, 5, 8.5]];
    x.fillStyle = c1;
    lobes.forEach(l => { ell(x, l[0], l[1], l[2], l[2] * 0.86); x.fill(); });
    x.fillStyle = c2;
    lobes.forEach(l => { ell(x, l[0] - 1.5, l[1] - 3, l[2] * 0.66, l[2] * 0.5); x.fill(); });
    x.strokeStyle = '#22480c'; x.lineWidth = 1.6;
    lobes.forEach(l => { ell(x, l[0], l[1], l[2], l[2] * 0.86); x.stroke(); });
    x.restore();
  }

  function tree(x, px, py, s, seed) {
    const R = mulberry32(seed);
    x.save(); x.translate(px, py); x.scale(s, s);
    ell(x, 0, 8, 22, 10); x.fillStyle = 'rgba(0,0,0,0.26)'; x.fill();
    // 树干
    x.fillStyle = '#6b4a24'; x.beginPath();
    x.moveTo(-4, 12); x.lineTo(4, 12); x.lineTo(3, -2); x.lineTo(-3, -2); x.closePath(); x.fill();
    // 树冠
    const lobes = [[-13, -6, 13], [0, -12, 15], [13, -6, 13], [-7, 4, 11], [7, 4, 11], [0, -2, 16]];
    x.fillStyle = '#2f6b12';
    lobes.forEach(l => { ell(x, l[0], l[1], l[2], l[2] * 0.9); x.fill(); });
    x.fillStyle = '#4f9c1d';
    lobes.forEach(l => { ell(x, l[0] - 1, l[1] - 4, l[2] * 0.72, l[2] * 0.6); x.fill(); });
    x.fillStyle = '#7ac433';
    lobes.slice(0, 3).forEach(l => { ell(x, l[0] - 2, l[1] - 6, l[2] * 0.4, l[2] * 0.32); x.fill(); });
    x.strokeStyle = '#1e4009'; x.lineWidth = 1.8;
    lobes.forEach(l => { ell(x, l[0], l[1], l[2], l[2] * 0.9); x.stroke(); });
    x.restore();
  }

  function rock(x, px, py, s, tint) {
    const c = tint || ['#b9a894', '#8c7b66', '#5e5142'];
    const e1 = tint ? '#ffffff' : 'rgba(255,255,255,0.28)';
    x.save(); x.translate(px, py); x.scale(s, s);
    ell(x, 0, 5, 15, 6); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fill();
    x.beginPath(); x.moveTo(-14, 6); x.lineTo(-10, -6); x.lineTo(-2, -11);
    x.lineTo(8, -8); x.lineTo(14, 2); x.lineTo(9, 8); x.closePath();
    x.fillStyle = vgrad(x, -11, 8, [[0, c[0]], [0.5, c[1]], [1, c[2]]]); x.fill();
    ink(x, 2);
    x.beginPath(); x.moveTo(-9, -4); x.lineTo(-2, -8); x.lineTo(4, -5);
    x.fillStyle = e1; x.globalAlpha = tint ? 0.85 : 1; x.fill(); x.globalAlpha = 1;
    x.restore();
  }

  function cactus(x, px, py, s) {
    x.save(); x.translate(px, py); x.scale(s, s);
    ell(x, 0, 14, 13, 5); x.fillStyle = 'rgba(0,0,0,0.22)'; x.fill();
    x.strokeStyle = '#2c5c17'; x.lineWidth = 2;
    x.fillStyle = vgrad(x, -22, 14, [[0, '#79c04a'], [0.5, '#4f9a2c'], [1, '#2f6b18']]);
    roundRect(x, -6, -24, 12, 38, 6); x.fill(); x.stroke();
    roundRect(x, -16, -14, 9, 20, 4.5); x.fill(); x.stroke();
    roundRect(x, 7, -18, 9, 22, 4.5); x.fill(); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(-2, -20); x.lineTo(-2, 8); x.stroke();
    x.restore();
  }

  function palm(x, px, py, s) {
    x.save(); x.translate(px, py); x.scale(s, s);
    ell(x, 0, 14, 15, 6); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fill();
    x.strokeStyle = '#5a3d1c'; x.lineWidth = 6; x.lineCap = 'round';
    x.beginPath(); x.moveTo(-3, 14); x.quadraticCurveTo(1, 0, 6, -14); x.stroke();
    x.strokeStyle = '#7a5527'; x.lineWidth = 2.6;
    x.beginPath(); x.moveTo(-3, 14); x.quadraticCurveTo(1, 0, 6, -14); x.stroke();
    const fr = [[-24, -22, -8, -30], [10, -26, 26, -22], [-6, -34, -14, -42],
                [14, -30, 20, -40], [-18, -16, -32, -8], [12, -18, 28, -8]];
    fr.forEach(f => {
      x.strokeStyle = '#2f6b12'; x.lineWidth = 7; x.lineCap = 'round';
      x.beginPath(); x.moveTo(6, -14); x.quadraticCurveTo(f[0], f[1], f[2], f[3]); x.stroke();
      x.strokeStyle = '#5aa524'; x.lineWidth = 3;
      x.beginPath(); x.moveTo(6, -14); x.quadraticCurveTo(f[0], f[1], f[2], f[3]); x.stroke();
    });
    x.restore();
  }

  function flower(x, px, py, col) {
    x.save(); x.translate(px, py);
    x.fillStyle = col;
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      ell(x, Math.cos(a) * 3.2, Math.sin(a) * 3.2, 2.6, 2.2); x.fill();
    }
    x.fillStyle = '#ffe066'; ell(x, 0, 0, 1.9, 1.9); x.fill();
    x.restore();
  }

  function drawDecor(x, map) {
    const R = mulberry32(map.seed + 7);
    const th = map.theme;
    const isDesert = th === 'desert', isSnow = th === 'snow';
    const ICE = ['#eaf5ff', '#b6cfe6', '#7b9abc'];
    const GREY = ['#d6dad4', '#a7aca6', '#6d726d'];
    /* 只有平地上才撒装饰物 —— 否则灌木会长到河面上、树会插在高地里。
       场地外（边缘丛林那一圈）一律当作可放。 */
    const tgrid = map.terrain ? parseTerrain(map) : null;
    const clear = (px, py) => {
      if (!tgrid) return true;
      const c = Math.floor(px / CELL), r = Math.floor(py / CELL);
      if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
      return TILE_LIST[tgrid[r * COLS + c]].key === 'plain';
    };
    /* 边缘植被按矩形四边铺设（原作是一圈厚实的丛林，不是椭圆）。
       三层：外两层是乔木、内层是灌木，抖动放大到 ±20，避免排成规则的鳞片。 */
    const edge = (px, py, s, useTree) => {
      if (!clear(px, py)) return;
      if (isDesert) rock(x, px, py, s);
      else if (isSnow) { rock(x, px, py, s * 0.85, ICE); if (R() > 0.5) rock(x, px + 8, py + 6, s * 0.5, ICE); }
      else if (useTree) tree(x, px, py, s * 0.92, Math.floor(px * 31 + py * 17 + R() * 9999));
      else bush(x, px, py, s, R() > 0.55);
    };
    const RINGS = [
      { off: 0, sc: 1.30, step: 36, tree: true },
      { off: 20, sc: 1.05, step: 30, tree: true },
      { off: 40, sc: 0.80, step: 26, tree: false }
    ];
    for (const rg of RINGS) {
      for (let px = -24; px < FIELD_W + 24; px += rg.step) {
        const jx = (R() - 0.5) * 26, jy = (R() - 0.5) * 17;
        edge(px + jx, rg.off + jy, (0.86 + R() * 0.5) * rg.sc, rg.tree);
        edge(px + jx + rg.step * 0.5, FIELD_H - rg.off + jy, (0.86 + R() * 0.5) * rg.sc, rg.tree);
      }
      for (let py = -24; py < FIELD_H + 24; py += rg.step) {
        const jx = (R() - 0.5) * 17, jy = (R() - 0.5) * 26;
        edge(rg.off + jx, py + jy, (0.86 + R() * 0.5) * rg.sc, rg.tree);
        edge(FIELD_W - rg.off + jx, py + jy, (0.86 + R() * 0.5) * rg.sc, rg.tree);
      }
    }
    // 角落大树 / 岩石
    const corners = [[-6, -6], [FIELD_W + 6, -6], [-6, FIELD_H + 6], [FIELD_W + 6, FIELD_H + 6]];
    corners.forEach((c, i) => {
      if (isDesert) rock(x, c[0], c[1], 1.6);
      else if (isSnow) rock(x, c[0], c[1], 1.5, ICE);
      else tree(x, c[0], c[1], 1.3, map.seed + i);
    });

    // 底栏背后的植被带（让底栏也有地形依托）
    for (let i = 0; i < 54; i++) {
      const px = -20 + R() * (FIELD_W + 40), py = FIELD_H + 14 + R() * (CANVAS_H - FIELD_H - 2);
      edge(px, py, 0.7 + R() * 0.6);
    }

    // 随机点缀
    for (let i = 0; i < 40; i++) {
      const px = 34 + R() * (FIELD_W - 68), py = 28 + R() * (FIELD_H - 56);
      if (!clear(px, py)) continue;
      if (isDesert) {
        if (R() > 0.55) cactus(x, px, py, 0.6 + R() * 0.4);
        else if (R() > 0.7) palm(x, px, py, 0.55 + R() * 0.3);
        else rock(x, px, py, 0.4 + R() * 0.4);
      } else if (isSnow) {
        rock(x, px, py, 0.35 + R() * 0.3, ICE);
      } else {
        const q = R();
        if (q > 0.80) rock(x, px, py, 0.42 + R() * 0.42, GREY);          // 浅灰圆石（设计稿草地上的石头）
        else if (q > 0.52) flower(x, px, py, ['#ff5c8a', '#ffd93d', '#c17bff', '#ff8a3d'][Math.floor(R() * 4)]);
        else bush(x, px, py, 0.42 + R() * 0.3, R() > 0.5);
      }
    }
  }

  /* ============================================================
     出生点 / 基地标记 —— 对齐设计稿：
     木栅关卡（两根立柱 + 横梁 + 尖桩 + 栅栏横档）
     中间挂一面红旗，旗上有白色箭头指明敌人前进方向。
     局部坐标：+x 指向场地外侧；旗帜正面朝镜头。
     ============================================================ */

  /* 红旗 + 白箭头（会随风摆动） */
  function arrowBanner(x, px, py, w, h, t, i) {
    const sw = Math.sin(t * 2.1 + i * 1.7) * 2.4;
    x.save(); x.translate(px, py);
    /* 旗面（右侧被风吹得鼓起来） */
    x.beginPath();
    x.moveTo(-w / 2, -h / 2);
    x.quadraticCurveTo(0, -h / 2 - 2.4 + sw * 0.35, w / 2, -h / 2 + sw);
    x.lineTo(w / 2, h / 2 + sw);
    x.quadraticCurveTo(0, h / 2 + 2.4 + sw * 0.35, -w / 2, h / 2);
    x.closePath();
    x.fillStyle = '#d5322a'; x.fill();
    ink(x, 2.4, '#7d1a13');
    /* 上缘高光 */
    x.beginPath();
    x.moveTo(-w / 2 + 2, -h / 2 + 1.4);
    x.quadraticCurveTo(0, -h / 2 - 0.6 + sw * 0.35, w / 2 - 2, -h / 2 + 1.4 + sw);
    x.lineTo(w / 2 - 2, -h / 2 + 6 + sw);
    x.quadraticCurveTo(0, -h / 2 + 4 + sw * 0.35, -w / 2 + 2, -h / 2 + 6);
    x.closePath();
    x.fillStyle = '#ef5a44'; x.fill();
    /* 白色箭头（指向 +x = 场地外侧 / 敌人前进方向） */
    const a = w * 0.30;
    x.beginPath();
    x.moveTo(-a, -h * 0.11);
    x.lineTo(a * 0.12, -h * 0.11);
    x.lineTo(a * 0.12, -h * 0.31);
    x.lineTo(a, 0);
    x.lineTo(a * 0.12, h * 0.31);
    x.lineTo(a * 0.12, h * 0.11);
    x.lineTo(-a, h * 0.11);
    x.closePath();
    x.fillStyle = '#fff6ee'; x.fill();
    ink(x, 1.5, '#8f2318');
    x.restore();
  }

  /* 木栅关卡 */
  function gateMarker(x, t, i, s) {
    s = s === undefined ? 1 : s;
    x.save(); x.scale(s, s);
    const POST = 21, TOP = -42, BOT = 30;

    /* 落地阴影 */
    ell(x, 0, BOT + 3, 42, 8); x.fillStyle = 'rgba(18,11,4,0.28)'; x.fill();

    /* 两根立柱 */
    [-POST, POST].forEach(px => {
      roundRect(x, px - 6.5, TOP, 13, BOT - TOP, 3.5);
      x.fillStyle = vgrad(x, TOP, BOT, [[0, '#b98a4e'], [0.42, '#8b6130'], [1, '#553a1a']]);
      x.fill(); ink(x, 2.4, '#2e1d0c');
      x.strokeStyle = 'rgba(46,29,12,0.34)'; x.lineWidth = 1.2;
      for (let k = TOP + 9; k < BOT - 4; k += 9) {
        x.beginPath(); x.moveTo(px - 5, k); x.lineTo(px + 5, k + 1.6); x.stroke();
      }
      ell(x, px, TOP, 7.5, 3.4); x.fillStyle = '#c6975a'; x.fill(); ink(x, 2.0, '#2e1d0c');
    });

    /* 上横梁 */
    roundRect(x, -POST - 5, TOP + 9, POST * 2 + 10, 12, 3);
    x.fillStyle = vgrad(x, TOP + 9, TOP + 21, [[0, '#c08e50'], [0.5, '#8d6331'], [1, '#57391a']]);
    x.fill(); ink(x, 2.4, '#2e1d0c');

    /* 顶上的尖桩 */
    for (let k = -2; k <= 2; k++) {
      x.beginPath();
      x.moveTo(k * 9 - 4, TOP + 10); x.lineTo(k * 9, TOP - 5); x.lineTo(k * 9 + 4, TOP + 10);
      x.closePath();
      x.fillStyle = '#95682f'; x.fill(); ink(x, 1.8, '#2e1d0c');
    }

    /* 栅栏横档（往两侧伸出，读起来像"一道篱笆"） */
    for (let k = 0; k < 2; k++) {
      const ry = 8 + k * 13;
      [-1, 1].forEach(dir => {
        roundRect(x, dir > 0 ? POST - 2 : -POST - 30, ry, 32, 7, 2.4);
        x.fillStyle = vgrad(x, ry, ry + 7, [[0, '#a97c43'], [1, '#63421d']]);
        x.fill(); ink(x, 1.9, '#2e1d0c');
      });
    }

    /* 红旗 + 白箭头（挂在两根立柱之间） */
    arrowBanner(x, 0, -6, 40, 30, t, i);

    x.restore();
  }

  function drawBaseWall(x, map, t) {
    /* ── 基地（出口）：箭头指向基地内部 ── */
    map.exits.forEach((ex, i) => {
      const px = cellCX(ex.c), py = cellCY(ex.r);
      let ang = null, mx = 0, my = 0;
      if (ex.c >= COLS) { ang = 0; mx = FIELD_W - 20; my = clamp(py, 62, FIELD_H - 62); }
      else if (ex.c <= 0) { ang = Math.PI; mx = 20; my = clamp(py, 62, FIELD_H - 62); }
      else if (ex.r >= ROWS) { ang = Math.PI / 2; mx = clamp(px, 62, FIELD_W - 62); my = FIELD_H - 20; }
      else if (ex.r <= 0) { ang = -Math.PI / 2; mx = clamp(px, 62, FIELD_W - 62); my = 20; }

      x.save();
      if (ang !== null) {
        x.translate(mx, my); x.rotate(ang);
        gateMarker(x, t, i, 1);
      } else {
        // 中央基地：环形堡垒（石台 + 金属环 + 红色环带 + 金色核心）
        const sx = clamp(px, 70, FIELD_W - 70), sy = clamp(py, 70, FIELD_H - 70);
        x.translate(sx, sy);
        ell(x, 0, 10, 74, 34); x.fillStyle = 'rgba(15,10,4,0.35)'; x.fill();
        ell(x, 0, 0, 68, 60);
        x.fillStyle = vgrad(x, -60, 60, [[0, '#ded8cb'], [0.42, '#b0a898'], [1, '#6f6859']]); x.fill();
        ink(x, 3.2, '#2a251b');
        ell(x, 0, -4, 52, 46);
        x.fillStyle = vgrad(x, -50, 42, [[0, '#c6cfd6'], [0.5, '#818a92'], [1, '#414850']]); x.fill();
        ink(x, 2.8, '#22282d');
        // 红色环带
        x.strokeStyle = '#c1272d'; x.lineWidth = 9;
        ell(x, 0, -4, 52, 46); x.stroke();
        // 中央机库（金色核心）
        ell(x, 0, -6, 27, 24);
        x.fillStyle = rgrad(x, -8, -14, 2, 31, [[0, '#fff3b8'], [0.45, '#f0ad1d'], [1, '#8a4f04']]); x.fill();
        ink(x, 2.8);
        x.fillStyle = 'rgba(255,255,255,0.45)'; ell(x, -9, -15, 9, 6); x.fill();
        // 四面红旗（插在堡垒外缘，不被本体盖住）
        for (let k = 0; k < 4; k++) {
          const a = k * Math.PI / 2 + Math.PI / 4;
          x.save(); x.rotate(a); x.translate(76, 0);
          const sw = Math.sin(t * 2.4 + k) * 3;
          x.fillStyle = '#c1272d';
          x.beginPath(); x.moveTo(0, -11); x.lineTo(20 + sw, -7); x.lineTo(20 + sw, 7); x.lineTo(0, 11); x.closePath();
          x.fill(); ink(x, 1.8, '#6d1116');
          x.restore();
        }
      }
      x.restore();
    });

    /* ── 出生点：同样一道木栅，箭头指向场地内部（= 敌人前进方向） ── */
    (map.spawns || []).forEach((sp, i) => {
      const px = cellCX(sp.c), py = cellCY(sp.r);
      let ang, mx, my;
      if (sp.c <= 0) { ang = 0; mx = 20; my = clamp(py, 62, FIELD_H - 62); }
      else if (sp.c >= COLS) { ang = Math.PI; mx = FIELD_W - 20; my = clamp(py, 62, FIELD_H - 62); }
      else if (sp.r <= 0) { ang = Math.PI / 2; mx = clamp(px, 62, FIELD_W - 62); my = 20; }
      else { ang = -Math.PI / 2; mx = clamp(px, 62, FIELD_W - 62); my = FIELD_H - 20; }
      x.save(); x.translate(mx, my); x.rotate(ang);
      gateMarker(x, t, 100 + i, 0.94);
      x.restore();
    });
  }

  /* ============================================================
     炮塔
     严格对照设计稿 mew_design_23a569f7：
       基座 = 浅灰混凝土圆台 + 外缘一圈深色装甲块 + 前缘黄铜圆顶 + 绿色指示灯
       6 台装备：加特林机枪 / 长管加农炮 / 斜面火箭巢 / 等离子电磁塔 /
                 双管喷火器 / 抛物面喷射盘
     ============================================================ */
  const towerCache = {};
  const TOWER_TOP_SCALE = 1.12;   // 炮塔体约占基座宽度 0.7，长炮管允许探出基座

  /* 军绿 + 深钢 + 混凝土 + 红色点缀（取自设计稿取色） */
  const MIL = {
    oliveL: '#b0bf80', olive: '#87954f', oliveD: '#68753d', oliveX: '#485328',
    steelL: '#c8d1d7', steel: '#859098', steelD: '#4d565d', steelX: '#262d33',
    concL: '#dcdcd4', conc: '#b8b8b0', concD: '#8c8c84', concX: '#5a5a54',
    redL: '#ff7f59', red: '#d0392a', redD: '#7d1a0e',
    blueL: '#eaf8ff', blue: '#5ec8f7', blueD: '#1a72c2', blueX: '#0a3a70',
    brass: '#c8a13a', brassD: '#8a6a1e', brassL: '#f0dc8c'
  };
  const GRN = [[0, MIL.oliveL], [0.45, MIL.olive], [1, MIL.oliveX]];
  const GRND = [[0, MIL.olive], [0.5, MIL.oliveD], [1, MIL.oliveX]];
  const MET = [[0, MIL.steelL], [0.45, MIL.steel], [1, MIL.steelX]];
  const METD = [[0, MIL.steel], [0.5, MIL.steelD], [1, MIL.steelX]];
  const BRL  = [[0, '#a4aeb8'], [0.42, '#69737c'], [1, '#333b42']];   // 枪管 / 炮管

  /* 一块带描边的竖直渐变板 */
  function plate(x, px, py, w, h, r, stops, lw) {
    roundRect(x, px, py, w, h, r);
    x.fillStyle = vgrad(x, py, py + h, stops); x.fill();
    ink(x, lw === undefined ? 2.2 : lw);
  }
  /* 一根沿 +x 伸出的金属管 */
  function tube(x, px, py, len, h, stops, lw) {
    roundRect(x, px, py - h / 2, len, h, h * 0.44);
    x.fillStyle = vgrad(x, py - h / 2, py + h / 2, stops); x.fill();
    ink(x, lw === undefined ? 1.4 : lw, '#171c20');
  }
  /* 铆钉 */
  function rivet(x, px, py, r) {
    ell(x, px, py, r, r * 0.85);
    x.fillStyle = 'rgba(255,255,255,0.42)'; x.fill();
    ink(x, 0.7, 'rgba(18,22,26,0.55)');
  }
  /* 面板分割线 */
  function seam(x, px, py, len, vertical, a) {
    x.strokeStyle = 'rgba(18,22,26,' + (a === undefined ? 0.30 : a) + ')';
    x.lineWidth = 1.1; x.beginPath();
    if (vertical) { x.moveTo(px, py); x.lineTo(px, py + len); }
    else { x.moveTo(px, py); x.lineTo(px + len, py); }
    x.stroke();
  }

  /* ============================================================
     炮塔基座 —— 严格照设计稿（放大取色后重做）：
       · 外壁：**深炭灰**装甲板（每块上沿一条浅灰亮边）+ 竖向板缝
       · 台面：浅灰装甲盘，外圈一圈深橄榄楔形板 + 径向分割线
       · 正前方：深色圆角灯座 + 琥珀色圆灯
       · 左前外壁：1~3 颗等级琥珀灯
       底座一律中性色 —— 设计稿就是这样，塔种靠顶部装备区分
     ============================================================ */
  function towerBase(x, key, lv) {
    lv = lv || 0;

    const RX = BASE_RX;
    /* 台面椭圆必须和「地面平面」的正交投影同比例：
       会绕竖轴转的炮塔顶是按 scale(1, GROUND_K) 压过的，
       台面若用另一个比例，炮塔的落点就会浮在台面之外 —— 伪 3D 最露馅的地方。 */
    const RY = BASE_RY;
    const CY_TOP = BASE_CY_TOP;         // 台面圆心
    const RIM_H = BASE_RIM_H;           // 外壁高（设计稿的基座是厚墩子，不是薄盘）
    const CY_BOT = CY_TOP + RIM_H;

    /* 落地投影 */
    ell(x, 0, CY_BOT + 2.6, RX + 2.4, RY + 3.2);
    x.fillStyle = 'rgba(16,12,6,0.34)'; x.fill();

    /* ---- 外壁剪影 ----
       手工取点描出圆柱侧面，避免 ellipse() 扫掠方向不一致：
         (-RX,CY_TOP) → 下 → 底椭圆下半圈 → 上 → 顶椭圆下半圈 → 闭合 */
    const wall = () => {
      x.beginPath();
      x.moveTo(-RX, CY_TOP);
      x.lineTo(-RX, CY_BOT);
      for (let i = 1; i <= 26; i++) {
        const a = Math.PI - Math.PI * i / 26;
        x.lineTo(Math.cos(a) * RX, CY_BOT + Math.sin(a) * RY);
      }
      x.lineTo(RX, CY_TOP);
      for (let i = 1; i <= 26; i++) {
        const a = Math.PI * i / 26;
        x.lineTo(Math.cos(a) * RX, CY_TOP + Math.sin(a) * RY);
      }
      x.closePath();
    };
    /* 台面上某条横坐标处的上/下沿（做装甲板亮边用） */
    const topY = f => CY_TOP + Math.sqrt(Math.max(0, 1 - f * f)) * RY;
    const botY = f => CY_BOT + Math.sqrt(Math.max(0, 1 - f * f)) * RY;

    /* ---- 外壁：深炭灰装甲板（设计稿是石板灰，不是近黑，别压太暗） ---- */
    wall();
    x.fillStyle = vgrad(x, CY_TOP - RY * 0.30, CY_BOT + RY * 1.00,
      [[0, '#c9cec6'], [0.22, '#a9afa7'], [0.62, '#868c85'], [1, '#565c56']]);
    x.fill(); ink(x, 2.8, '#22261f');

    x.save(); wall(); x.clip();
    /* 左右压暗 + 中间提亮 → 圆柱感 */
    x.fillStyle = hgrad(x, -RX, RX,
      [[0, 'rgba(6,8,4,0.34)'], [0.20, 'rgba(6,8,4,0.05)'],
       [0.50, 'rgba(255,255,255,0.15)'], [0.80, 'rgba(6,8,4,0.05)'],
       [1, 'rgba(6,8,4,0.32)']]);
    x.fill();
    /* 每块装甲板的上沿一条浅灰亮边 */
    x.beginPath();
    for (let i = 0; i <= 40; i++) {
      const f = -1 + 2 * i / 40;
      if (i === 0) x.moveTo(f * RX, topY(f)); else x.lineTo(f * RX, topY(f));
    }
    x.strokeStyle = 'rgba(206,212,200,0.40)'; x.lineWidth = 2.4; x.stroke();
    /* 竖向板缝（深）+ 缝右侧窄高光 */
    const PL = 10;
    for (let i = 0; i < PL; i++) {
      const a = (i + 0.5) / PL * Math.PI * 2;
      const sa = Math.sin(a), ca = Math.cos(a);
      if (sa < -0.05) continue;                    // 背面被台面挡住
      const px = ca * RX;
      x.strokeStyle = 'rgba(4,6,2,0.74)'; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(px, CY_TOP + sa * RY); x.lineTo(px, CY_BOT + sa * RY); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.17)'; x.lineWidth = 1.1;
      x.beginPath(); x.moveTo(px + 1.9, CY_TOP + sa * RY + 1.4);
      x.lineTo(px + 1.9, CY_BOT + sa * RY - 1.8); x.stroke();
    }
    /* 台面压在外壁上的那道暗缝 */
    x.beginPath(); x.ellipse(0, CY_TOP, RX, RY, 0, 0, Math.PI * 2);
    x.strokeStyle = 'rgba(8,10,6,0.62)'; x.lineWidth = 1.9; x.stroke();
    x.restore();

    /* ---- 台面：浅灰装甲盘（设计稿台面很亮、占得很大，是基座的视觉主角） ---- */
    ell(x, 0, CY_TOP, RX - 2.2, RY - 1.6);
    x.fillStyle = vgrad(x, CY_TOP - RY, CY_TOP + RY,
      [[0, '#fbfaf3'], [0.38, '#eae7dc'], [0.76, '#d0cdc1'], [1, '#b3b1a5']]);
    x.fill(); ink(x, 2.6, '#22261f');

    x.save();
    ell(x, 0, CY_TOP, RX - 2.2, RY - 1.6); x.clip();
    /* 外圈一圈深橄榄楔形板（设计稿台面最显眼的一圈） */
    for (let i = 0; i < 7; i++) {
      const a0 = i / 7 * Math.PI * 2 + 0.30;
      const a1 = a0 + Math.PI * 2 / 7 * 0.56;
      x.beginPath();
      x.ellipse(0, CY_TOP, RX * 0.84, RY * 0.84, 0, a0, a1);
      x.strokeStyle = '#54682c'; x.lineWidth = 7.0; x.lineCap = 'butt'; x.stroke();
      x.beginPath();
      x.ellipse(0, CY_TOP, RX * 0.84, RY * 0.84, 0, a0, a1);
      x.strokeStyle = 'rgba(255,255,255,0.16)'; x.lineWidth = 2.2; x.stroke();
    }
    /* 径向分割线 */
    x.strokeStyle = 'rgba(28,32,24,0.34)'; x.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2 + 0.30;
      x.beginPath(); x.moveTo(Math.cos(a) * 5, CY_TOP + Math.sin(a) * 3.4);
      x.lineTo(Math.cos(a) * RX, CY_TOP + Math.sin(a) * (RY + 3)); x.stroke();
    }
    /* 污渍 / 苔痕 */
    const RB = rng(9001 + lv);
    for (let i = 0; i < 9; i++) {
      const px = (RB() - 0.5) * 60, py = CY_TOP + (RB() - 0.5) * 16;
      x.fillStyle = i % 3 === 0 ? 'rgba(84,104,44,0.16)' : 'rgba(122,118,98,0.13)';
      ell(x, px, py, 3 + RB() * 5, 1.6 + RB() * 2.2); x.fill();
    }
    /* 高光 */
    x.fillStyle = 'rgba(255,255,255,0.30)';
    ell(x, -9.5, CY_TOP - 4.8, 14.0, 3.2); x.fill();
    x.restore();

    /* 台面铆钉 */
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + 0.3;
      const px = Math.cos(a) * (RX - 6.6), py = CY_TOP + Math.sin(a) * (RY - 4.6);
      if (py < CY_TOP - 3.6) continue;
      ell(x, px, py, 1.15, 0.95);
      x.fillStyle = 'rgba(255,255,255,0.36)'; x.fill();
      x.strokeStyle = 'rgba(20,22,18,0.45)'; x.lineWidth = 0.6; x.stroke();
    }

    /* ---- 正前方：深色圆角灯座 + 绿色指示灯（设计稿里这颗灯很小，
           压在外壁正前方，不能盖过整个外壁） ---- */
    const gx = 0, gy = CY_BOT + RY - 4.4;      // 落在外壁正面，不被炮体挡住
    roundRect(x, gx - 5.6, gy - 6.4, 11.2, 9.0, 3.2);
    x.fillStyle = vgrad(x, gy - 6.4, gy + 2.6, [[0, '#3c4038'], [1, '#171a12']]);
    x.fill(); ink(x, 1.5, '#0b0d07');
    ell(x, gx, gy - 1.5, 3.3, 3.0);
    x.fillStyle = rgrad(x, gx - 0.8, gy - 2.4, 0.3, 3.5,
      [[0, '#f0ffe0'], [0.30, '#8ff04a'], [0.72, '#3f9c14'], [1, '#1d5a06']]);
    x.fill(); ink(x, 1.1, '#3f2602');
    x.fillStyle = 'rgba(255,255,255,0.85)';
    ell(x, gx - 0.9, gy - 2.5, 1.0, 0.8); x.fill();

    /* ---- 等级灯：外壁左前方的 1~3 颗琥珀灯（不挡正面灯） ---- */
    const slotA = [2.02, 2.30, 2.58];
    for (let i = 0; i < 3; i++) {
      const a = slotA[i];
      const px = Math.cos(a) * RX;
      const py = CY_TOP + Math.sin(a) * RY + RIM_H * 0.46;
      ell(x, px, py, 2.3, 2.1);
      x.fillStyle = '#1b1e17'; x.fill();
      x.strokeStyle = '#0b0d07'; x.lineWidth = 0.8; x.stroke();
      if (i <= lv) {
        ell(x, px, py - 0.15, 1.6, 1.4);
        x.fillStyle = lv === 0 ? '#8ce23c' : '#ffd24a'; x.fill();
        x.fillStyle = 'rgba(255,255,255,0.8)';
        ell(x, px - 0.5, py - 0.8, 0.6, 0.5); x.fill();
      }
    }
  }

  // 颜色明暗调节
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (k > 0) { r += (255 - r) * (k > 1 ? 0 : k); g += (255 - g) * k; b += (255 - b) * k; }
    else { r *= (1 + k); g *= (1 + k); b *= (1 + k); }
    return `rgb(${Math.round(clamp(r, 0, 255))},${Math.round(clamp(g, 0, 255))},${Math.round(clamp(b, 0, 255))})`;
  }

  /* ============================================================
     炮塔顶部 —— 真 3/4 斜视（对齐设计稿的透视）
     局部坐标： u = 前方（炮口朝向）, v = 右方, w = 上方（w=0 就是基座台面）
     投影 P()：地面沿屏幕竖直压 GROUND_K，高度只乘 HZ。
       · 朝向只把 u/v 在地面里转，**不影响 w** —— 所以转塔是绕竖轴转，
         不会像贴纸那样整张打转；
       · 炮管朝北时长度自然缩短 K 倍，朝东时不缩。
     零件全部用 box / tube / capU·capV·capW 拼出来，
     和设计稿一样：看得见顶面，也看得见朝向相机的两个侧面。

     三种圆盘的方向别搞混（法线朝哪条局部轴）：
       capU 法线沿 u —— 炮口端面、前脸指示灯
       capV 法线沿 v —— 侧面的圆形舱盖 / 弹鼓
       capW 法线沿 w —— 水平圆盘：顶灯、底座圆环、线圈盘
     ============================================================ */
  const TPW = 192, TPX = 84, TPY = 124;   // 离屏画布 / 原点位置
  const TT = 1.38;                        // 炮体整体放大（基座不动）

  function buildTop(key, lv, rot) {
    const { c, x } = cv(TPW, TPW);
    x.translate(TPX, TPY);
    x.scale(TT, TT);
    x.lineJoin = 'round'; x.lineCap = 'round';
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const INK = '#141a10';

    /* ---------- 3/4 基元 ---------- */
    /* UOFF：炮体整体沿 u 后移。设计稿里炮体是「坐在台座后半」的，
       台面前缘要露出一大块，不然炮体像扣在盘子上。逐塔设置。 */
    let UOFF = 0;
    function pt(u, v, w) {
      u += UOFF;
      return [u * ca - v * sa, (u * sa + v * ca) * GROUND_K - w * HZ];
    }
    function face(pts, fill, lw, inkCol) {
      x.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pt(pts[i][0], pts[i][1], pts[i][2]);
        if (i === 0) x.moveTo(p[0], p[1]); else x.lineTo(p[0], p[1]);
      }
      x.closePath();
      if (fill) { x.fillStyle = fill; x.fill(); }
      ink(x, lw === undefined ? 1.7 : lw, inkCol || INK);
    }
    /* ---- 三个局部平面上的「圆角矩形」----
       直接在投影后的平面里画圆角矩形，轮廓才是设计稿那种圆润的装甲块，
       而不是四个尖角拼出来的方盒子。路径建完再 restore()，fill 时用的是
       已落到设备空间的路径（和 disc() 同一套办法）。
       渐变必须**在平面自己的局部坐标里**建立 —— createLinearGradient 用的是
       建立那一刻的 user space，建在外面渐变就会跟着世界坐标跑，脸上没体积感。 */
    function fillW(u0, u1, v0, v1, w, r, stops, lw) {
      const p = pt(0, 0, w);
      x.save(); x.transform(ca, sa * GROUND_K, -sa, ca * GROUND_K, p[0], p[1]);
      x.beginPath();
      if (r > 0) x.roundRect(u0, v0, u1 - u0, v1 - v0, [r, r, r, r]);
      else x.rect(u0, v0, u1 - u0, v1 - v0);
      const g = vgrad(x, v0, v1, stops);   // 必须在这个平面的局部坐标里建
      x.restore();
      x.fillStyle = g; x.fill(); if (lw) ink(x, lw);
    }
    /* 前后面：局部 (v,w)，法线沿 u。局部 y=w，w 大的两个角在 3D 里是「上」 */
    function fillU(uu, v0, v1, w0, w1, r, stops, lw) {
      const p = pt(uu, 0, 0);
      x.save(); x.transform(-sa, ca * GROUND_K, 0, -HZ, p[0], p[1]);
      x.beginPath();
      if (r > 0) x.roundRect(v0, w0, v1 - v0, w1 - w0, [0, 0, r, r]);
      else x.rect(v0, w0, v1 - v0, w1 - w0);
      const g = vgrad(x, w0, w1, stops);   // 必须在这个平面的局部坐标里建
      x.restore();
      x.fillStyle = g; x.fill(); if (lw) ink(x, lw);
    }
    /* 左右面：局部 (u,w)，法线沿 v */
    function fillV(vv, u0, u1, w0, w1, r, stops, lw) {
      const p = pt(0, vv, 0);
      x.save(); x.transform(ca, sa * GROUND_K, 0, -HZ, p[0], p[1]);
      x.beginPath();
      if (r > 0) x.roundRect(u0, w0, u1 - u0, w1 - w0, [0, 0, r, r]);
      else x.rect(u0, w0, u1 - u0, w1 - w0);
      const g = vgrad(x, w0, w1, stops);   // 必须在这个平面的局部坐标里建
      x.restore();
      x.fillStyle = g; x.fill(); if (lw) ink(x, lw);
    }
    /* 侧面明暗：下缘压暗、上缘提亮，中间一道高光 —— 体积感全靠它 */
    function bodyGrad(c) {
      return [[0, shade(c, -0.36)], [0.22, shade(c, -0.05)],
              [0.60, shade(c, 0.24)], [1, shade(c, 0.04)]];
    }
    /* 顶面：靠后亮、靠前暗（受天光） */
    function topGrad(c) {
      return [[0, shade(c, 0.26)], [0.48, shade(c, 0.10)], [1, shade(c, -0.16)]];
    }
    /* 圆角长方体：两个朝向相机的侧面 + 顶面；顶面再压一块内嵌装甲板 + 板缝 */
    function box(u0, u1, v0, v1, w0, w1, cTop, cU, cV, lw, plain, rad) {
      const us = sa > 0 ? u1 : u0;
      const vs = ca > 0 ? v1 : v0;
      const o = lw === undefined ? 1.45 : lw;
      const R = rad === undefined
        ? Math.min(u1 - u0, v1 - v0, (w1 - w0) * 1.7) * 0.30 : rad;

      fillU(us, v0, v1, w0, w1, R, bodyGrad(cU), o);
      fillV(vs, u0, u1, w0, w1, R, bodyGrad(cV), o);
      fillW(u0, u1, v0, v1, w1, R, topGrad(cTop), o);

      if (plain) return;
      /* 顶面内嵌装甲板 + 中缝，做出设计稿那种「盖板」层次 */
      const iu = (u1 - u0) * 0.17, iv = (v1 - v0) * 0.17;
      fillW(u0 + iu, u1 - iu, v0 + iv, v1 - iv, w1, Math.max(0, R - iu * 0.6),
        [[0, shade(cTop, 0.32)], [0.55, shade(cTop, 0.14)], [1, shade(cTop, -0.02)]], o * 0.62);
      const m = (u0 + u1) / 2;
      const q1 = pt(m - 0.7, v0 + iv * 1.3, w1), q2 = pt(m + 0.7, v1 - iv * 1.3, w1);
      x.beginPath(); x.moveTo(q1[0], q1[1]); x.lineTo(q2[0], q2[1]);
      ink(x, o * 0.5, 'rgba(20,26,16,0.40)');
    }

    /* 任意走向的圆管（a/b 是局部端点），带粗黑描边 */
    function tube(a, b, r, cBody, lw) {
      const p = pt(a[0], a[1], a[2]), q = pt(b[0], b[1], b[2]);
      const th = 2 * r * HZ, o = (lw === undefined ? 1.7 : lw);
      x.strokeStyle = INK; x.lineWidth = th + o * 2;
      x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke();
      x.strokeStyle = cBody; x.lineWidth = th;
      x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke();
    }
    /* 圆环箍（炮管上的红箍等）：平头线帽，否则会鼓成一个圆饼 */
    function ring(u0, u1, v, w, r, cBody, lw) {
      const p = pt(u0, v, w), q = pt(u1, v, w);
      const th = 2 * r * HZ, o = (lw === undefined ? 1.4 : lw);
      x.save(); x.lineCap = 'butt';
      x.strokeStyle = INK; x.lineWidth = th + o * 2;
      x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke();
      x.strokeStyle = cBody; x.lineWidth = th;
      x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke();
      x.restore();
    }
    /* 圆盘：把局部某个平面上的圆按投影矩阵贴上去 */
    function disc(mat, u, v, w, r, fill, lw, inkCol) {
      const p = pt(u, v, w);
      x.save();
      x.transform(mat[0], mat[1], mat[2], mat[3], p[0], p[1]);
      x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2);
      x.restore();
      if (fill) { x.fillStyle = fill; x.fill(); }
      ink(x, lw === undefined ? 1.5 : lw, inkCol || INK);
    }
    const MU = [-sa, ca * GROUND_K, 0, -HZ];   // 法线沿 u
    const MV = [ca, sa * GROUND_K, 0, -HZ];    // 法线沿 v
    const MW = [ca, sa * GROUND_K, -sa, ca * GROUND_K];  // 法线沿 w（水平）
    function capU(u, v, w, r, f, lw, ic) { disc(MU, u, v, w, r, f, lw, ic); }
    function capV(u, v, w, r, f, lw, ic) { disc(MV, u, v, w, r, f, lw, ic); }
    function capW(u, v, w, r, f, lw, ic) { disc(MW, u, v, w, r, f, lw, ic); }
    /* 圆球（等离子球 / 指示灯）：投影仍是圆 */
    function ball(u, v, w, r, stops) {
      const p = pt(u, v, w);
      ell(x, p[0], p[1], r, r);
      x.fillStyle = rgrad(x, p[0] - r * 0.28, p[1] - r * 0.32, r * 0.10, r * 1.04, stops);
      x.fill(); ink(x, 1.5, '#10222c');
    }

    /* ---------- 配色（对齐设计稿：亮军绿机体 / 钢灰枪管 / 红色点缀） ---------- */
    const OL = { l: '#bdd183', m: '#8fa458', d: '#71833f', x: '#4e5c2a' };
    const ST = { l: '#c2cad0', m: '#8f9aa2', d: '#5a646c', x: '#333c43' };
    const RD = { l: '#f07a5e', m: '#d0402c', d: '#8d2013' };
    const BR = { l: '#f6e49a', m: '#cfa844', d: '#8a6d24' };

    /* ================= 1. 机枪塔 → 六管加特林 ================= */
    if (key === 'gatling') {
      UOFF = -5.2;
      const nB = [4, 6, 6][lv], ext = [7.5, 9.5, 11][lv], rad = [4.2, 5.2, 5.9][lv];
      const TOPW = 29, WY = 19.5;
      /* 方形底座：炮体先坐在一块方块上，设计稿里炮体不是直接落在台面上 */
      box(-13, 6, -11.5, 11.5, 0, 8.5, OL.l, OL.m, OL.d, 1.8, false, 4.0);
      capU(6.15, 0, 4.6, 2.4, RD.m, 1.1);            // 底座正面的红点
      /* 炮体：厚实的大块头 —— 设计稿的炮体比台座还高，这是最关键的一条比例 */
      box(-16, 8, -12, 12, 8.5, TOPW, OL.l, OL.m, OL.d, 1.9, false, 6.5);
      /* 左侧大圆舱盖（设计稿最显眼的特征） */
      tube([-5, -12, WY], [-5, -18.2, WY], 7.4, ST.m, 1.9);
      capV(-5, -18.2, WY, 7.4, ST.l, 1.8);
      capV(-5, -18.3, WY, 4.8, ST.d, 1.3);
      capV(-5, -18.4, WY, 2.0, '#8a4a30', 1.0);
      /* 顶部红色警示灯 */
      capW(-9.5, 0, TOPW, 3.3, RD.m, 1.3);
      capW(-9.5, 0, TOPW + 0.8, 2.0, RD.l, 1.0);
      /* 前段炮座 */
      box(8, 12.5, -8.4, 8.4, 11.0, 24.5, OL.l, OL.m, OL.d, 1.8, false, 3.4);
      /* 散热套筒（2 级起）：先画，枪管再压在上面 */
      if (lv >= 1) {
        const sr = rad + 2.2, sh = ext * 0.45;
        tube([11.5, 0, WY], [11.5 + sh, 0, WY], sr, ST.m, 1.9);
        for (let i = 0; i < 4; i++) {
          const uu = 12.2 + i * (sh - 2.4) / 4.0;
          capW(uu, 0, WY + sr * 0.82, 1.5, '#141a1e', 0.8, '#141a1e');
          capW(uu, 0, WY - sr * 0.82, 1.5, '#141a1e', 0.8, '#141a1e');
        }
      }
      /* 枪管簇：在 (v,w) 平面里绕轴均布，低的先画 */
      const order = [];
      for (let i = 0; i < nB; i++) order.push(i);
      order.sort((A, B) => Math.cos(A / nB * 6.2832) - Math.cos(B / nB * 6.2832));
      for (const i of order) {
        const a = i / nB * 6.2832;
        const v = Math.sin(a) * rad, w = WY + Math.cos(a) * rad * 0.94;
        tube([12.6, v, w], [12.6 + ext, v, w], 1.95, ST.d, 1.0);
        capU(12.6 + ext, v, w, 1.8, '#10161a', 0.9);
      }
      /* 黄铜弹链：2 级 1 条，3 级 2 条 */
      const belts = lv >= 2 ? [-1, 1] : (lv >= 1 ? [-1] : []);
      for (const dir of belts) {
        x.beginPath();
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          const p = pt(-13 + t * 6.0 * dir, dir * (11.5 + Math.sin(t * 3.0) * 2.6),
                       21.0 - t * 8.0 + Math.sin(t * 2.2) * 2.4);
          if (i === 0) x.moveTo(p[0], p[1]); else x.lineTo(p[0], p[1]);
        }
        x.strokeStyle = BR.d; x.lineWidth = 3.8; x.stroke();
        x.strokeStyle = BR.m; x.lineWidth = 2.4; x.stroke();
        x.strokeStyle = 'rgba(255,255,255,0.34)'; x.lineWidth = 0.9; x.stroke();
      }
      /* 前脸绿色指示灯 */
      capU(12.7, 0, 13.4, 2.6, '#7cf24a', 1.2, '#123f06');
    }

    /* ================= 2. 迫击炮 → 大口径长管炮 ================= */
    if (key === 'mortar') {
      UOFF = -5.2;
      const len = [18, 22, 26][lv], bore = [4.4, 5.0, 5.6][lv], WY = 17.5;
      box(-13, 7, -11.5, 11.5, 0, 9.0, OL.l, OL.m, OL.d, 1.8, false, 4.0);
      box(-15, 9, -11.5, 11.5, 9.0, 26.0, OL.l, OL.m, OL.d, 1.9, false, 6.0);
      /* 左前锈色装甲板（2 级起） */
      if (lv >= 1) face([[-3, -11.5, 9.6], [9, -11.5, 9.6], [9, -11.5, 25.4], [-3, -11.5, 25.4]],
        lv >= 2 ? '#cf7a42' : '#b06c33', 1.7);
      /* 左侧圆舱盖 + 红色中心 */
      capV(-6.5, -11.5, WY, 7.0, ST.m, 1.9);
      capV(-6.5, -11.6, WY, 4.0, RD.m, 1.3);
      /* 后座缓冲块 */
      box(-15, -7, -7.5, 7.5, 26.0, 29.4, OL.l, OL.m, OL.d, 1.8, false, 2.6);
      /* 炮管：由粗到细，带炮口制退器 */
      tube([9.0, 0, WY], [9.0 + len - 6, 0, WY], bore, ST.m, 2.0);
      tube([9.0 + len - 6, 0, WY], [9.0 + len, 0, WY], bore * 0.86, ST.d, 1.7);
      capU(9.0 + len, 0, WY, bore * 0.60, '#0e1216', 1.5);
      /* 炮管上的红箍（2 级起）—— 是环不是圆盘 */
      if (lv >= 1) {
        const ub = 9.0 + len * 0.46;
        ring(ub - 1.1, ub + 1.1, 0, WY, bore * 1.12, RD.m, 1.0);
      }
      if (lv >= 2) {
        const ub = 9.0 + len * 0.24;
        ring(ub - 1.1, ub + 1.1, 0, WY, bore * 1.12, RD.m, 1.0);
      }
      /* 顶部提把 */
      tube([-4, 0, 29.4], [2, 0, 29.4], 1.8, ST.d, 1.2);
    }

    /* ================= 3. 导弹塔 → 双联装发射箱 ================= */
    if (key === 'missile') {
      UOFF = -3.6;
      const rows = [2, 3, 3][lv], PIT = 0.30;      // 每箱几排弹 / 上仰角
      /* 底座 + 摇架 */
      box(-12, 5, -10, 10, 0, 8.6, OL.l, OL.m, OL.d, 1.7, false, 3.6);
      box(-8, 3, -3.6, 3.6, 8.6, 13.0, OL.l, OL.m, OL.d, 1.5, false, 2.0);
      /* 设计稿是左右两个并排的开口弹箱，不是一个 */
      const u0 = 0, u1 = 17, w0 = 12.8, wh = 2.2 + rows * 2.9;
      for (const vv of [[-11.4, -1.6], [1.6, 11.4]]) {
        const vA = vv[0], vB = vv[1];
        const wA0 = w0, wA1 = w0 + (u1 - u0) * PIT;
        /* 底板 */
        face([[u0, vA, wA0], [u1, vA, wA1], [u1, vB, wA1], [u0, vB, wA0]], OL.x, 1.6);
        /* 两侧壁：外侧板刷亮、内侧板压暗，开口才看得出来 */
        face([[u0, vA, wA0], [u1, vA, wA1], [u1, vA, wA1 + wh], [u0, vA, wA0 + wh]],
          vA < 0 ? OL.m : OL.d, 1.6);
        face([[u0, vB, wA0], [u1, vB, wA1], [u1, vB, wA1 + wh], [u0, vB, wA0 + wh]],
          vB < 0 ? OL.m : OL.d, 1.6);
        /* 后壁 */
        face([[u0, vA, wA0], [u0, vB, wA0], [u0, vB, wA0 + wh], [u0, vA, wA0 + wh]], OL.x, 1.5);
        /* 弹体：rows 排 × 3 发，红弹头朝前 */
        for (let r = 0; r < rows; r++) {
          const wb = wA0 + 1.7 + r * 2.9;
          for (let i = 0; i < 3; i++) {
            const vp = vA + (vB - vA) * (i + 0.5) / 3;
            const uu0 = u0 + 2.2, uu1 = u1 + 2.4;
            const wa = wb + (uu0 - u0) * PIT, wc = wb + (uu1 - u0) * PIT;
            tube([uu0, vp, wa], [uu1 - 3.6, vp, wc - 0.5], 1.75, '#ece6cd', 0.9);
            tube([uu1 - 3.6, vp, wc - 0.5], [uu1, vp, wc], 1.35, RD.m, 0.8);
            capU(uu1, vp, wc, 0.82, RD.l, 0.7);
          }
        }
      }
      /* 外侧钢面板 + 黄铜螺栓 + 红点（设计稿左箱外侧的灰钢板） */
      face([[-6, -11.4, 13.6], [4, -11.4, 16.6], [4, -11.4, 23.6], [-6, -11.4, 20.6]], ST.d, 1.7);
      capV(-1.0, -11.4, 18.6, 2.0, BR.m, 1.0);
      capV(-1.0, -11.5, 18.6, 0.9, RD.m, 0.8);
      /* 雷达小碟（2 级起，挂在右侧） */
      if (lv >= 1) {
        const o = pt(-1, 11.4, 20.0), d1 = pt(2, 11.4, 20);
        x.save(); x.translate(o[0], o[1]); x.rotate(Math.atan2(d1[1] - o[1], d1[0] - o[0]));
        ell(x, 0, 0, 8.4, 3.2); x.fillStyle = ST.l; x.fill(); ink(x, 1.5);
        ell(x, 0, 0, 6.6, 2.4); x.fillStyle = ST.m; x.fill(); ink(x, 1.0);
        ell(x, 0, 0, 2.0, 1.9); x.fillStyle = ST.x; x.fill();
        x.restore();
      }
    }

    /* ================= 4. 电磁塔 → 等离子线圈 ================= */
    if (key === 'tesla') {
      UOFF = 0;
      const RH = [13, 15, 17][lv];
      /* 底座圆环 */
      capW(0, 0, 1.0, 15.5, ST.d, 2.0);
      capW(0, 0, 3.0, 13.4, ST.m, 1.7);
      /* 中心圆筒 */
      tube([0, 0, 2.0], [0, 0, RH], 6.2, ST.m, 1.9);
      capW(0, 0, RH, 8.6, ST.l, 1.7);
      capW(0, 0, RH + 0.6, 6.2, '#2a3a44', 1.2);
      /* 蓝色电缆环 */
      x.beginPath();
      for (let i = 0; i <= 26; i++) {
        const a = i / 26 * 6.2832;
        const p = pt(Math.cos(a) * 11.5, Math.sin(a) * 11.5, 5.0 + Math.sin(a * 3) * 1.1);
        if (i === 0) x.moveTo(p[0], p[1]); else x.lineTo(p[0], p[1]);
      }
      x.strokeStyle = '#1d5f8a'; x.lineWidth = 5.2; x.stroke();
      x.strokeStyle = '#4fb6e8'; x.lineWidth = 3.2; x.stroke();
      /* 等离子晶体：一串「互相咬住」的光球 → 读成一个饱满的水滴，
         球心别拉太开，否则会变成糖葫芦 */
      const CR = [[7.4, 6.6, 4.6, 2.6], [8.0, 7.0, 4.9, 2.8], [8.6, 7.4, 5.2, 3.0]][lv];
      const CY = [[5.4, 9.4, 12.6, 15.0], [5.6, 10.0, 13.4, 16.0], [5.8, 10.6, 14.2, 17.0]][lv];
      ball(0, 0, RH + CY[0], CR[0], [[0, '#f2ffff'], [0.34, '#8fe8ff'], [0.70, '#2f9fe0'], [1, '#0b4a7a']]);
      ball(0, 0, RH + CY[1], CR[1], [[0, '#f6ffff'], [0.40, '#a8f0ff'], [1, '#1c6ea8']]);
      ball(0, 0, RH + CY[2], CR[2], [[0, '#ffffff'], [0.5, '#c6f4ff'], [1, '#2a86bc']]);
      ball(0, 0, RH + CY[3], CR[3], [[0, '#ffffff'], [0.6, '#d8f8ff'], [1, '#3a96c8']]);
      /* 两侧线圈柱（2 级起）：设计稿是左右各一根，不是四根 */
      if (lv >= 1) {
        const h = lv >= 2 ? 21 : 17;
        for (const vv of [-11.6, 11.6]) {
          tube([0, vv, 2.4], [0, vv, h], 2.5, ST.d, 1.5);
          for (let k = 0; k < 3; k++) capW(0, vv, 5.4 + k * 3.6, 3.4, '#4fb6e8', 1.2, '#12405e');
          ball(0, vv, h + 1.4, 2.2, [[0, '#eafcff'], [0.5, '#6fd0f4'], [1, '#1a6ea0']]);
        }
      }
    }

    /* ================= 5. 火焰塔 → 双联粗喷管 ================= */
    if (key === 'flame') {
      UOFF = -5.2;
      const nBar = lv >= 1 ? 2 : 1;
      const bore = [5.2, 6.0, 6.8][lv], len = [15, 18, 21][lv];
      box(-13, 8, -11.5, 11.5, 0, 9.0, OL.l, OL.m, OL.d, 1.8, false, 4.0);
      box(-15, 9, -11.5, 11.5, 9.0, 23.0, OL.l, OL.m, OL.d, 1.9, false, 6.0);
      /* 侧面锈色装甲（2 级起） */
      if (lv >= 1) face([[-15, 11.5, 9.6], [-4, 11.5, 9.6], [-4, 11.5, 22.4], [-15, 11.5, 22.4]],
        lv >= 2 ? '#cf7a42' : '#b06c33', 1.7);
      capV(-7.5, -11.5, 15.5, 6.2, ST.d, 1.8);
      capV(-7.5, -11.6, 15.5, 3.2, RD.m, 1.2);
      /* 喷管：微微上仰；红箍画成环 */
      for (let i = 0; i < nBar; i++) {
        const vv = nBar === 1 ? 0 : (i === 0 ? -5.4 : 5.4);
        tube([9.0, vv, 15.0], [9.0 + len, vv, 18.6], bore, OL.m, 2.1);
        capU(9.0 + len, vv, 18.6, bore * 0.84, '#1a1f12', 1.8);
        const ub = 9.0 + len * 0.52;
        ring(ub - 1.2, ub + 1.2, vv, 16.9, bore * 1.12, RD.m, 1.1);
      }
      /* 前脸绿色指示灯 */
      capU(9.1, 0, 5.0, 2.5, '#7cf24a', 1.2, '#123f06');
    }

    /* ================= 6. 胶水塔 → 抛物面天线 ================= */
    if (key === 'goo') {
      UOFF = -4.6;
      const R = [9.6, 11.6, 13.6][lv];
      box(-14, 8, -11.5, 11.5, 0, 9.5, OL.l, OL.m, OL.d, 1.8, false, 4.0);
      box(-15, 8, -11.5, 11.5, 9.5, 22.0, OL.l, OL.m, OL.d, 1.9, false, 6.0);
      capV(-7.0, -11.5, 15.0, 6.6, ST.m, 1.8);
      capV(-7.0, -11.6, 15.0, 3.4, RD.m, 1.2);
      /* 支撑臂 */
      tube([0, 0, 22.0], [6, 0, 27.5], 2.9, ST.d, 1.5);
      /* 抛物面：沿炮口方向的屏幕角倾斜 */
      const o = pt(8, 0, 30.0), d1 = pt(9, 0, 30.0);
      const ang = Math.atan2(d1[1] - o[1], d1[0] - o[0]);
      const RW = R, RH = R * 0.58;
      x.save(); x.translate(o[0], o[1]); x.rotate(ang);
      /* 背面：往下错开做出「碗」的厚度 */
      ell(x, 0, RH * 0.20, RW, RH); x.fillStyle = ST.d; x.fill(); ink(x, 2.0);
      /* 凹面：径向渐变（中间亮、边缘暗）—— 用同心环描边会看成漩涡 */
      ell(x, 0, 0, RW, RH);
      x.fillStyle = rgrad(x, 0, 0, RW * 0.05, RW,
        [[0, '#f4f8f9'], [0.32, '#cbd4d9'], [0.70, '#949ea6'], [1, '#5e676f']]);
      x.fill(); ink(x, 2.0);
      /* 三圈很淡的同心环，做出「一圈圈金属」的质感 */
      for (let i = 1; i <= 3; i++) {
        const k = 1 - i * 0.21;
        ell(x, 0, 0, RW * k, RH * k);
        x.strokeStyle = 'rgba(255,255,255,0.20)'; x.lineWidth = 1.3; x.stroke();
      }
      /* 中心毂 */
      ell(x, 0, 0, RW * 0.17, RH * 0.17); x.fillStyle = ST.x; x.fill(); ink(x, 1.2);
      x.restore();
      /* 中心馈源 */
      tube([8, 0, 30.0], [8 + R * 0.50, 0, 30.0], 1.6, ST.d, 1.0);
      ball(8 + R * 0.50, 0, 30.0, 2.3, [[0, '#e8ffd4'], [0.45, '#7cf24a'], [1, '#2c6208']]);
      /* 绿色天线（3 级 4 根 / 2 级 2 根 / 1 级 1 根） */
      const nA = lv >= 2 ? 4 : (lv >= 1 ? 2 : 1);
      for (let i = 0; i < nA; i++) {
        const a = (i + 0.5) / nA * 6.2832;
        const uu = Math.cos(a) * 9.5, vv = Math.sin(a) * 9.5;
        tube([uu, vv, 2.4], [uu, vv, 19.0], 1.7, ST.d, 1.2);
        ball(uu, vv, 20.6, 2.3, [[0, '#e8ffd4'], [0.45, '#7cf24a'], [1, '#2c6208']]);
      }
    }

    return c;
  }

  function getTowerSprite(key, lv) {
    const id = key + lv;
    if (towerCache[id]) return towerCache[id];
    const b = cv(96, 96); b.x.translate(48, 48); b.x.lineJoin = 'round'; b.x.lineCap = 'round';
    towerBase(b.x, key, lv);
    const o = { base: b.c };
    towerCache[id] = o; return o;
  }

  const NO_ROTATE = {};              // 真 3/4 之后所有炮塔都绕竖轴转，这里留空
  const TOWER_DRAW_SCALE = 1.0;

  /* ============================================================
     伪 3D 斜视投影 —— 全局只有这一套参数
     棋盘坐标仍是俯视的（1 单位 = 1 像素，寻路/射程/碰撞全都不动），
     但**贴地的东西**按正交斜视画：地面沿屏幕竖直压 GROUND_K，
     高度按 HZ 缩放。炮塔顶的 3/4 零件全部走这套投影（见 buildTop）。

     凡是在地面上量出来的偏移（炮口位置、后座位移、落影）都要用 projVec()，
     否则炮口焰会飘到炮管外面 —— 这是伪 3D 最容易露馅的地方。
     ============================================================ */
  const GROUND_K = 0.46;          // 地面压缩 ≈ sin(俯角)；0.46 约等于设计稿的透视
  const HZ = 0.90;                // 高度比例 ≈ cos(俯角)，美术上给足一点更有体积
  const K_ENEMY = 0.46;           // 载具同样贴地，与炮塔共用一套投影
  const K_AIR = 0.80;             // 空中单位几乎不压

  /* 基座尺寸 —— 量自设计稿：外径 117、总高 61、外壁高 15、台面椭圆半短轴 23
     → 台面椭圆比 0.39、外壁高 / 半径 0.26。设计稿的基座是一只「扁厚的墩子」，
     不是高圆柱；按这两个比例做，炮体才不会显得浮在半空。 */
  const BASE_RX = 35.0;
  const BASE_RY = BASE_RX * 0.39;
  const BASE_CY_TOP = BASE_RY * 0.28;
  const BASE_RIM_H = BASE_RX * 0.26;

  /* 世界方向 → 屏幕偏移（已含压缩；长度 = hypot(cos, sin·K)） */
  function projVec(ang, k) {
    const K = k === undefined ? GROUND_K : k;
    return [Math.cos(ang), Math.sin(ang) * K];
  }

  /* 炮塔顶：按朝向分桶缓存。桶内是一次完整的 3/4 重绘，
     运行时每座塔每帧只剩 1 次 drawImage。 */
  const TOP_BUCKETS = 48;                // 7.5° 一档
  const topProjCache = {}; let topProjCount = 0;
  function getTopProj(key, lv, rot) {
    let b = Math.round(rot / (Math.PI * 2) * TOP_BUCKETS) % TOP_BUCKETS;
    if (b < 0) b += TOP_BUCKETS;
    const id = key + lv + '|' + b;
    if (topProjCache[id]) return topProjCache[id];
    if (topProjCount > 400) { for (const kk in topProjCache) delete topProjCache[kk]; topProjCount = 0; }
    const c = buildTop(key, lv, b / TOP_BUCKETS * Math.PI * 2);
    topProjCache[id] = c; topProjCount++;
    return c;
  }
  /* 把局部原点（基座台面中心）画到 (0, BASE_CY_TOP) 所需的偏移 */
  const TOP_OX = -TPX, TOP_OY = -TPY + BASE_CY_TOP;

  function drawTower(x, tw, t) {
    /* 设计稿裁出来的 PNG：直接把整张画到格子中心，炮头用 ctx.rotate(rot) 转。
       保持落地缩放、影子、recoil 这些体验细节跟原版同。 */
    const useDesign = typeof Sprites !== 'undefined' && Sprites.enabled && Sprites.loaded;

    if (useDesign) {
      x.save();
      x.translate(tw.x, tw.y);
      if (tw.spawnT < 1) {
        const s = 0.5 + 0.5 * (1 - Math.pow(1 - tw.spawnT, 3)) + Math.sin(tw.spawnT * Math.PI) * 0.12;
        x.scale(s, s);
      }
      const K = GROUND_K;
      const rot = tw.aim;
      const recoil = tw.recoil ? tw.recoil * 5 : 0;

      /* 设计稿底座里自带阴影，先画一个轻地面阴影统一方向感（不旋转，跟着塔走） */
      x.save();
      x.globalAlpha = 0.28;
      x.fillStyle = '#1a1410';
      ell(x, 0, 4, 24, 9);
      x.fill();
      x.restore();

      /* 旋转前的整张（含底座 + 炮头）作为底盘 */
      Sprites.drawTowerBase(x, tw.key, tw.level, 0, 0);

      /* 炮头用与底座完全相同的图，但只对炮头部分做旋转。
         设计稿炮头通常是「从中心偏左上伸出」，所以旋转中心用 (0, 0) ——即格子中心——
         即可。recoil 用同方向偏移。 */
      x.save();
      x.translate(-Math.cos(rot) * recoil, -Math.sin(rot) * recoil * K);
      Sprites.drawTowerTop(x, tw.key, tw.level, 0, 0, rot);
      x.restore();
      x.restore();
      return;
    }

    const sp = getTowerSprite(tw.key, tw.level);
    const K = GROUND_K;
    x.save();
    x.translate(tw.x, tw.y);
    // 建造落地动画
    if (tw.spawnT < 1) {
      const s = 0.5 + 0.5 * (1 - Math.pow(1 - tw.spawnT, 3)) + Math.sin(tw.spawnT * Math.PI) * 0.12;
      x.scale(s, s);
    }
    x.scale(TOWER_DRAW_SCALE, TOWER_DRAW_SCALE);
    x.drawImage(sp.base, -48, -48);

    const recoil = tw.recoil ? tw.recoil * 5 : 0;
    const rot = tw.aim;

    /* 炮塔投在台面上的影子：跟着朝向一起转，塔「立」在基座上的感觉全靠它 */
    const sh = projVec(rot, K);
    x.save();
    x.globalAlpha = 0.22;
    x.fillStyle = '#0b0e06';
    ell(x, sh[0] * 6.0, BASE_CY_TOP + sh[1] * 6.0, 19.0, 19.0 * K);
    x.fill();
    x.restore();

    x.save();
    /* 后座位移是地面上的位移，必须走投影，否则炮口焰会飘到炮管外面 */
    x.translate(-Math.cos(rot) * recoil, -Math.sin(rot) * recoil * K);
    x.drawImage(getTopProj(tw.key, tw.level, rot), TOP_OX, TOP_OY);
    x.restore();
    x.restore();
  }

  /* ============================================================
     敌人
     ============================================================ */
  /* ============================================================
     敌人载具 —— 与炮塔同一套真 3/4 投影
     局部坐标 u=前, v=右, w=上（w=0 贴地）。朝向由 e.angle 决定，
     按 (类型, 动画帧, 朝向桶) 缓存，运行时每只敌人每帧只 1 次 drawImage。
     ============================================================ */
  const enemyCache = {};
  /* 离屏画布要装得下最大的 boss（放大后约 ±58px）和轰炸机的翼展，
     144 会裁掉翼尖，所以放到 176，原点也随之外移。 */
  const ENEMY_CV = 176;       // 离屏画布边长
  const ENEMY_FRAMES = 3;     // 动画帧数（3/4 重绘成本高，帧数收敛）
  const ETT = 1.45;           // 载具整体缩放
  const EPX = 88, EPY = 128;  // 原点 = 车体在地面上的着地点

  /* 逐车缩放：设计稿里各载具的「相对体量」并不均匀 ——
     摩托几乎和吉普一样长，直升机/轰炸机的翼展是吉普的三倍多，
     boss 又要再大一圈。用统一尺寸画会全部失真，所以按设计稿量出来的
     宽度比（以吉普为 1）逐车补偿。 */
  const ESCALE = {
    infantry: 1.00, runner: 1.36, commando: 1.12,
    truck: 1.09, heli: 1.50, bomber: 1.55, boss: 1.25
  };

  const EBUCKETS = 20;        // 朝向分桶（18° 一档）
  const enemyProjCache = {}; let enemyProjCount = 0;

  function getEnemyProj(kind, frame, ang) {
    let b = Math.round(ang / (Math.PI * 2) * EBUCKETS) % EBUCKETS;
    if (b < 0) b += EBUCKETS;
    const id = kind + '|' + frame + '|' + b;
    if (enemyProjCache[id]) return enemyProjCache[id];
    if (enemyProjCount > 220) { for (const kk in enemyProjCache) delete enemyProjCache[kk]; enemyProjCount = 0; }
    const c = buildVehicle(kind, frame, b / EBUCKETS * Math.PI * 2);
    /* 白闪图按需生成：每张都要占一份画布，全量预生成会白吃一倍内存，
       而受击闪光本来就不是每只敌人每帧都用得到。 */
    const o = { n: c, f: null };
    enemyProjCache[id] = o; enemyProjCount++;
    return o;
  }

  /* 受击白闪：必须在离屏画布上做 source-atop，
     直接在主画布上做会把整个矩形涂白（主画布处处不透明） */
  function makeFlash(src) {
    const { c, x } = cv(ENEMY_CV, ENEMY_CV);
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = '#fff';
    x.fillRect(0, 0, ENEMY_CV, ENEMY_CV);
    return c;
  }

  function buildVehicle(kind, frame, rot) {
    const { c, x } = cv(ENEMY_CV, ENEMY_CV);
    x.translate(EPX, EPY);
    const S = ETT * (ESCALE[kind] || 1);
    x.scale(S, S);
    x.lineJoin = 'round'; x.lineCap = 'round';
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const INK = '#161c10';
    /* ELW：载具描边的整体粗细系数。
       曾经用 1.0（即各处写的 1.4~1.9），在 176px 画布上再乘 ETT*ESCALE≈2，
       实际落笔 3~4px；而 sprite 在游戏里只有 ~50px 高 —— 描边吃掉 6% 高度，
       整个载具糊成一团黑。参考设计稿的描边只占身高的 1.2% 左右。
       实测：系数 1.0 时「近黑像素」占比 73%，参考稿只有 51%。 */
    const ELW = 0.58;
    const ph = frame / ENEMY_FRAMES * Math.PI * 2;
    const NEAR = ca > 0 ? 1 : -1;      // 朝向相机的那一侧

    /* ---------- 3/4 基元 ---------- */
    /* UOFF：炮体整体沿 u 后移。设计稿里炮体是「坐在台座后半」的，
       台面前缘要露出一大块，不然炮体像扣在盘子上。逐塔设置。 */
    let UOFF = 0;
    function pt(u, v, w) {
      u += UOFF;
      return [u * ca - v * sa, (u * sa + v * ca) * GROUND_K - w * HZ];
    }
    function face(pts, fill, lw, inkCol) {
      x.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pt(pts[i][0], pts[i][1], pts[i][2]);
        if (i === 0) x.moveTo(p[0], p[1]); else x.lineTo(p[0], p[1]);
      }
      x.closePath();
      if (fill) { x.fillStyle = fill; x.fill(); }
      ink(x, (lw === undefined ? 1.5 : lw) * ELW, inkCol || INK);
    }
    /* 带竖直渐变的四边形：按投影后的 y 跨度做「上亮下暗」，
       车体才有装甲块的体积感（和炮塔的 box 同一套思路） */
    function faceG(pts, base, lw, inkCol) {
      let ymin = 1e9, ymax = -1e9;
      const pj = [];
      for (const p of pts) {
        const q = pt(p[0], p[1], p[2]); pj.push(q);
        if (q[1] < ymin) ymin = q[1];
        if (q[1] > ymax) ymax = q[1];
      }
      x.beginPath();
      for (let i = 0; i < pj.length; i++) {
        if (i === 0) x.moveTo(pj[i][0], pj[i][1]); else x.lineTo(pj[i][0], pj[i][1]);
      }
      x.closePath();
      if (ymax - ymin < 0.8) { x.fillStyle = base; x.fill(); }
      else {
        x.fillStyle = vgrad(x, ymin, ymax,
          [[0, shade(base, 0.24)], [0.50, shade(base, 0.05)], [1, shade(base, -0.22)]]);
        x.fill();
      }
      ink(x, (lw === undefined ? 1.5 : lw) * ELW, inkCol || INK);
    }
    function box(u0, u1, v0, v1, w0, w1, cTop, cU, cV, lw) {
      const us = sa > 0 ? u1 : u0;
      const vs = ca > 0 ? v1 : v0;
      faceG([[us, v0, w0], [us, v1, w0], [us, v1, w1], [us, v0, w1]], cU, lw);
      faceG([[u0, vs, w0], [u1, vs, w0], [u1, vs, w1], [u0, vs, w1]], cV, lw);
      faceG([[u0, v0, w1], [u1, v0, w1], [u1, v1, w1], [u0, v1, w1]], cTop, lw);
    }
    /* 倒角盒：下半段直壁 + 上半段收成一个小顶面的棱台。
       纯 box() 在 3/4 视角下就是一砖头 —— 炮塔、驾驶室、机头都要这个转折
       才有「装甲块」的味道（设计稿里几乎没有一处是直角平顶）。
       cut = 棱台高度；顶面按 cut*0.55 内缩。 */
    function chamBox(u0, u1, v0, v1, w0, w1, cut, cTop, cU, cV, lw) {
      const wt = w1 - cut;
      const cu = cut * 0.55, cv = cut * 0.55;
      const t0 = u0 + cu, t1 = u1 - cu, s0 = v0 + cv, s1 = v1 - cv;
      box(u0, u1, v0, v1, w0, wt, cTop, cU, cV, lw);
      const us = sa > 0 ? u1 : u0, vs = ca > 0 ? v1 : v0;
      if (us === u1)
        faceG([[u1, v1, wt], [u1, v0, wt], [t1, s0, w1], [t1, s1, w1]], cU, lw);
      else
        faceG([[u0, v0, wt], [u0, v1, wt], [t0, s1, w1], [t0, s0, w1]], cU, lw);
      if (vs === v1)
        faceG([[u0, v1, wt], [u1, v1, wt], [t1, s1, w1], [t0, s1, w1]], cV, lw);
      else
        faceG([[u1, v0, wt], [u0, v0, wt], [t0, s0, w1], [t1, s0, w1]], cV, lw);
      faceG([[t0, s0, w1], [t1, s0, w1], [t1, s1, w1], [t0, s1, w1]], cTop, lw);
    }
    function tube(a, b, r, cBody, lw) {
      const p = pt(a[0], a[1], a[2]), q = pt(b[0], b[1], b[2]);
      const th = 2 * r * HZ, o = (lw === undefined ? 1.5 : lw) * ELW;
      x.strokeStyle = INK; x.lineWidth = th + o * 2;
      x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke();
      x.strokeStyle = cBody; x.lineWidth = th;
      x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke();
    }
    function disc(mat, u, v, w, r, fill, lw, inkCol) {
      const p = pt(u, v, w);
      x.save();
      x.transform(mat[0], mat[1], mat[2], mat[3], p[0], p[1]);
      x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2);
      x.restore();
      if (fill) { x.fillStyle = fill; x.fill(); }
      ink(x, (lw === undefined ? 1.3 : lw) * ELW, inkCol || INK);
    }
    const capU = (u, v, w, r, f, lw, ic) => disc([-sa, ca * GROUND_K, 0, -HZ], u, v, w, r, f, lw, ic);
    const capV = (u, v, w, r, f, lw, ic) => disc([ca, sa * GROUND_K, 0, -HZ], u, v, w, r, f, lw, ic);
    const capW = (u, v, w, r, f, lw, ic) => disc([ca, sa * GROUND_K, -sa, ca * GROUND_K], u, v, w, r, f, lw, ic);

    /* 椭圆盘：capU/capV/capW 只能画正圆，而机身/机头的横截面是扁的。
       需要「沿 v 半轴 rv、沿 w 半轴 rw」的椭圆，否则机头会鼓成一个球。
       轴向约定和 capU 完全一致（局部 x = v，局部 y = w）。 */
    function discE(mat, u, v, w, rv, rw, fill, lw, inkCol) {
      const p = pt(u, v, w);
      x.save();
      x.transform(mat[0], mat[1], mat[2], mat[3], p[0], p[1]);
      x.beginPath(); x.ellipse(0, 0, rv, rw, 0, 0, Math.PI * 2);
      x.restore();
      if (fill) { x.fillStyle = fill; x.fill(); }
      ink(x, (lw === undefined ? 1.3 : lw) * ELW, inkCol || INK);
    }
    const capUe = (u, v, w, rv, rw, f, lw, ic) =>
      discE([-sa, ca * GROUND_K, 0, -HZ], u, v, w, rv, rw, f, lw, ic);

    /* 正球：正交投影下球的轮廓永远是圆，所以直接画屏幕空间的圆即可。
       头盔、警示灯用它 —— capU 在侧视角会退化成一条竖线，画不了球。 */
    function ball(u, v, w, r, fill, lw, inkCol) {
      const p = pt(u, v, w);
      x.beginPath(); x.arc(p[0], p[1], r, 0, Math.PI * 2);
      if (fill) { x.fillStyle = fill; x.fill(); }
      ink(x, (lw === undefined ? 1.4 : lw) * ELW, inkCol || INK);
    }

    /* 屏幕空间锥管：a→b 半径 ra→rb。炮管锥度、排气管、旋翼轴都用它。
       和 tube() 同一套近似（竖向按 HZ 压），但两端半径可以不同。 */
    function taper(a, b, ra, rb, cBody, lw) {
      const p = pt(a[0], a[1], a[2]), q = pt(b[0], b[1], b[2]);
      const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const ta = ra * HZ, tb = rb * HZ, o = (lw === undefined ? 1.5 : lw) * ELW;
      const quad = (ka, kb, col) => {
        x.beginPath();
        x.moveTo(p[0] + nx * ka, p[1] + ny * ka);
        x.lineTo(q[0] + nx * kb, q[1] + ny * kb);
        x.lineTo(q[0] - nx * kb, q[1] - ny * kb);
        x.lineTo(p[0] - nx * ka, p[1] - ny * ka);
        x.closePath(); x.fillStyle = col; x.fill();
      };
      quad(ta + o, tb + o, INK);
      quad(ta, tb, cBody);
    }

    /* 相机侧判定：深度轴 d = (sa*HZ, ca*HZ, GK)，所以 v 越大越靠近相机（当 ca>0）。
       轮胎/履带的「近端面」必须用这个，不能拿 sign(v) 当远近 —— 车开到背向时 sign(v)
       和真实远近是反的，轮子会画成里外颠倒。 */
    const vNear = (v, hw) => v + (ca > 0 ? hw : -hw);
    const vFar = (v, hw) => v - (ca > 0 ? hw : -hw);

    /* 轮胎：圆柱轴沿 v。拆成「远侧」和「近侧」两半，
       好让车体插在中间 —— 不然车身会把靠近相机的轮子整块盖掉，
       或者反过来把远端轮子画到车身上面。 */
    function wheelFar(u, v, r, hw) {
      hw = hw === undefined ? 2.4 : hw;
      const nv = vNear(v, hw), fv = vFar(v, hw);
      capV(u, fv, r, r, '#262c32', 1.1);
      faceG([[u, fv, 0.6], [u, nv, 0.6], [u, nv, 2 * r - 0.6], [u, fv, 2 * r - 0.6]], '#3f474f', 1.3);
    }
    function wheelNear(u, v, r, hw) {
      hw = hw === undefined ? 2.4 : hw;
      const nv = vNear(v, hw);
      capV(u, nv, r, r, '#333b43', 1.4);
      capV(u, nv, r, r * 0.60, '#8b949c', 1.1);
      capV(u, nv, r, r * 0.28, '#5b646c', 1.0);
      capV(u, nv, r, r * 0.12, '#2f363c', 0.8);
      const n = Math.max(4, Math.round(r));           // 胎面花纹
      for (let i = 0; i < n; i++) {
        const a = -Math.PI * 0.5 + Math.PI * (i + 0.5) / n;
        capV(u + Math.cos(a) * r * 0.84, nv, r + Math.sin(a) * r * 0.84, r * 0.15, '#1d2329', 0.6);
      }
    }
    function wheelAt(u, v, r, hw) { wheelFar(u, v, r, hw); wheelNear(u, v, r, hw); }

    /* 履带：同样拆两半。不再用 tube 画成圆头胶囊（那会让坦克读成一条管子）。 */
    function trackFar(u0, u1, v, hw, h) {
      const nv = vNear(v, hw), fv = vFar(v, hw);
      face([[u0, fv, h * 0.05], [u1, fv, h * 0.05], [u1, fv, h * 0.95], [u0, fv, h * 0.95]], '#2c333a', 1.4);
      faceG([[u0, fv, h], [u1, fv, h], [u1, nv, h], [u0, nv, h]], '#5b646d', 1.5);
    }
    function trackNear(u0, u1, v, hw, h) {
      const nv = vNear(v, hw);
      faceG([[u0, nv, h * 0.05], [u1, nv, h * 0.05], [u1, nv, h * 0.95], [u0, nv, h * 0.95]], '#3a424b', 1.5);
      const n = Math.max(3, Math.round((u1 - u0) / 6.4));   // 负重轮
      for (let i = 0; i < n; i++) {
        const uu = u0 + (u1 - u0) * (i + 0.5) / n;
        capV(uu, nv, h * 0.48, h * 0.38, '#606a73', 1.0);
        capV(uu, nv, h * 0.48, h * 0.17, '#2b3238', 0.8);
      }
      const m = Math.max(8, Math.round((u1 - u0) / 4.2));   // 履带齿
      for (let i = 0; i < m; i++) {
        const uu = u0 + (u1 - u0) * (i + 0.5) / m;
        face([[uu - 0.6, nv, h * 0.08], [uu + 0.6, nv, h * 0.08],
              [uu + 0.6, nv, h * 0.92], [uu - 0.6, nv, h * 0.92]], null, 0.65, 'rgba(10,14,18,0.5)');
      }
    }
    function trackAt(u0, u1, v, hw, h) { trackFar(u0, u1, v, hw, h); trackNear(u0, u1, v, hw, h); }
    /* 近侧符号：履带/轮胎按「近的放后面画」排序时要先判断哪一侧离相机近 */
    const NSS = ca > 0 ? 1 : -1;

    /* ---------- 配色 ---------- */
    const OL = { l: '#bcd170', m: '#87a244', d: '#62792a', x: '#3d4d19' };
    const KA = { l: '#cfd99a', m: '#a7b46d', d: '#7f8b4c', x: '#5a6433' };
    const ST = { l: '#c2cad0', m: '#8f9aa2', d: '#5a646c', x: '#333c43' };
    const RD = { l: '#f07a5e', m: '#d0402c', d: '#8d2013' };
    const GL = { l: '#bdf0ff', m: '#7fd8f5', d: '#3d9ec4' };

    /* ================= 侦察吉普 =================
       设计稿是一台「方正装甲吉普」：车体本身就是一块厚装甲，
       引擎盖压低、驾驶舱高耸、四个大轮子明明白白露在车体外侧。
       画序：远侧轮 → 车体 → 近侧轮。轮子上缘压在车身下缘上是设计稿本来的样子
       （大号越野胎本来就盖住侧裙），所以近侧轮必须最后画。 */
    if (kind === 'infantry') {
      const WR = 5.0, WU = 10.8, WV = 10.2, WHW = 2.6;
      for (const vv of [-WV, WV]) for (const uu of [WU, -WU]) {
        if (Math.sign(vv) !== NSS) wheelFar(uu, vv, WR, WHW);
      }

      /* 底盘大梁：从轮子之间露出来的深色一块 */
      box(-16.4, 16.4, -8.0, 8.0, 2.2, 5.0, '#46561f', '#3c4a1b', '#313d17', 1.5);

      /* 车体 */
      box(-17, 17, -8.8, 8.8, 5.0, 12.0, OL.l, OL.m, OL.d, 1.9);
      /* 侧裙下缘压深，让车体有「厚装甲板」的读数 */
      for (const s of [-1, 1]) {
        face([[17, s * 8.85, 5.0], [-17, s * 8.85, 5.0], [-17, s * 8.85, 7.4], [17, s * 8.85, 7.4]], OL.x, 1.3);
      }
      /* 前脸：格栅 + 双大灯 + 保险杠 */
      face([[17.05, -8.1, 5.4], [17.05, 8.1, 5.4], [17.05, 8.1, 11.4], [17.05, -8.1, 11.4]], OL.d, 1.6);
      for (let i = 0; i < 5; i++) {
        const vv = -6.4 + i * 3.2;
        face([[17.12, vv - 0.9, 6.0], [17.12, vv + 0.9, 6.0],
              [17.12, vv + 0.9, 10.8], [17.12, vv - 0.9, 10.8]], '#2b3416', 0.9);
      }
      capU(17.4, -6.4, 8.5, 2.4, '#fff3c0', 1.2);
      capU(17.4, 6.4, 8.5, 2.4, '#fff3c0', 1.2);
      capU(17.7, -6.4, 8.5, 1.2, '#fffbe2', 0.8);
      capU(17.7, 6.4, 8.5, 1.2, '#fffbe2', 0.8);
      box(17.0, 18.8, -9.3, 9.3, 3.4, 6.6, ST.l, ST.m, ST.d, 1.5);

      /* 引擎盖：后半段平的 + 前段向下斜。设计稿的机盖是斜的，
         一整块平顶放上去立刻变成方盒子。 */
      box(4.0, 11.0, -8.2, 8.2, 12.0, 13.8, OL.l, OL.m, OL.d, 1.5);
      face([[11.0, -8.2, 13.8], [16.6, -8.2, 11.4], [16.6, 8.2, 11.4], [11.0, 8.2, 13.8]], OL.l, 1.5);
      for (const s of [-1, 1])
        face([[11.0, s * 8.2, 12.0], [16.6, s * 8.2, 12.0],
              [16.6, s * 8.2, 11.4], [11.0, s * 8.2, 13.8]], OL.m, 1.3);

      /* 驾驶舱（顶部倒角，不然和车体一样是块砖） */
      chamBox(-9.4, 4.0, -8.4, 8.4, 12.0, 18.2, 2.4, OL.l, OL.m, OL.d, 1.9);
      /* 前倾风挡（两层，外层亮内层淡，像玻璃有厚度） */
      face([[4.05, -7.6, 13.6], [2.9, -7.6, 16.2], [2.9, 7.6, 16.2], [4.05, 7.6, 13.6]], GL.m, 1.5);
      face([[4.15, -7.0, 14.0], [3.2, -7.0, 16.0], [3.2, -2.2, 16.0], [4.15, -2.2, 14.0]], GL.l, 1.0);
      /* 侧窗 */
      for (const s of [-1, 1]) {
        face([[-8.4, s * 8.45, 13.8], [-1.2, s * 8.45, 13.8], [-1.2, s * 8.45, 17.2], [-8.4, s * 8.45, 17.2]], GL.m, 1.4);
        face([[-7.6, s * 8.5, 14.3], [-2.2, s * 8.5, 14.3], [-2.2, s * 8.5, 16.7], [-7.6, s * 8.5, 16.7]], GL.l, 0.9);
      }
      /* 车顶行李架：用深橄榄而不是钢灰，钢灰在车顶上太抢眼，会把车顶读成一块平台 */
      box(-9.6, 4.2, -7.6, 7.6, 18.2, 18.8, OL.d, OL.x, OL.x, 1.2);
      for (let i = 0; i < 5; i++) {
        const uu = -8.6 + i * 3.0;
        face([[uu, -7.6, 18.8], [uu + 0.9, -7.6, 18.8], [uu + 0.9, 7.6, 18.8], [uu, 7.6, 18.8]],
          null, 0.8, 'rgba(28,34,18,0.5)');
      }
      /* 车顶机枪 */
      tube([-8.6, 0, 19.9], [1.4, 0, 19.9], 1.4, ST.d, 1.1);
      tube([1.0, 0, 19.9], [8.2, 0, 19.9], 0.9, ST.x, 0.85);
      capU(8.2, 0, 19.9, 0.9, '#12181c', 0.8);
      ball(-4.0, 0, 20.6, 1.3, RD.m, 0.9);

      /* 尾门备胎 */
      capU(-17.5, 0, 8.5, 4.0, '#3a4249', 1.5);
      capU(-18.1, 0, 8.5, 2.3, '#5b656d', 1.0);
      /* 尾部指挥旗：短杆，不要做成天线塔 */
      tube([-15.4, -6.6, 12.0], [-15.4, -6.6, 24.0], 0.9, ST.d, 0.85);
      face([[-15.4, -6.6, 24.0], [-15.4, -14.4, 22.2], [-15.4, -6.6, 20.6]], RD.m, 1.0);

      /* 近侧轮：最后画，压在车身下缘之上 */
      for (const vv of [-WV, WV]) for (const uu of [WU, -WU]) {
        if (Math.sign(vv) === NSS) wheelNear(uu, vv, WR, WHW);
      }
    }

    /* ================= 摩托兵 =================
       设计稿是一台「红色跑车 + 橄榄绿骑手」，车比人抢眼。
       之前车身整体压得太低（油箱顶只到 13.2，而头盔球心在 22.6），
       于是骑手像一坨大蘑菇盖住了整台车 —— 侧视只剩一个绿球 + 黑轮子。
       按设计稿反推的纵向比例（总高 26.3，地面 w=0）：
         轮半径 4.6 / 车架顶 9.2 / 油箱顶 17.4 / 整流罩顶 18.6 / 尾罩顶 18.2
         骑手躯干 13.4~20.8 / 头盔球心 23.2 r 3.1
       关键：**油箱、整流罩、尾罩三者必须几乎等高**，连成一条红色腰线，
       否则侧视看不出「车」。 */
    /* ================= 摩托兵 =================
       设计稿是一台「红色跑车 + 橄榄绿骑手」，车比人抢眼。
       从设计稿量出来的硬指标（总高记作 H）：
         整体 h/w ≈ 0.82 ；轮直径 ≈ 0.35H ；轴距 ≈ 0.86H ；头盔直径 ≈ 0.34H
       两个曾经踩过的坑：
       1) 车身用 4 个等高的 box 拼 —— 顶边是一条直线，侧视成一块方砖。
          设计稿的车是「尾高 → 座凹 → 油箱顶 → 整流罩尖」的**楔形**，
          所以这里改用侧面轮廓多边形 PROF/BOTP，顶边才有起伏。
       2) 头盔画小了。设计稿里头盔直径是总高的 1/3，比躯干还宽，
          画成小圆点就变成一个「缩头骑手」。 */
    if (kind === 'runner') {
      const WR = 4.9, WU = 11.4, WHW = 2.4, BHV = 2.9, FV = 2.9;
      /* 侧面轮廓（上缘 / 下缘），从车尾到车头。
         座位凹口要挖到 11.2 —— 骑手躯干正好压在这段上，凹得不够深
         车顶轮廓就只剩一条直线，侧视看不出「车」。 */
      const PROF = [[-13.8, 16.5], [-11.6, 19.5], [-9.2, 18.0], [-6.4, 14.0],
                    [-2.6, 11.2], [1.4, 15.5], [4.6, 18.0], [7.6, 19.4],
                    [10.2, 17.6], [12.0, 11.6]];
      const BOTP = [[-13.8, 9.0], [-11.6, 8.6], [-9.2, 8.2], [-6.4, 8.4],
                    [-2.6, 9.0], [1.4, 9.2], [4.6, 9.8], [7.6, 10.8],
                    [10.2, 11.6], [12.0, 11.6]];
      /* 挡泥板要「窄而薄」：跨 ±3.9 个单位、盖到 w=6.9 的话，
         轮子顶上四分之一全被红板吃掉，两个大轮子看起来就变小了。 */
      const fender = (uu, near, col) => {
        const s = near ? FV : -FV;
        face([[uu - 2.7, s, 8.2], [uu + 2.6, s, 7.9],
              [uu + 2.3, s, 9.3], [uu - 2.4, s, 9.6]], col, 1.2);
      };
      const fenderTop = (uu, col) =>
        face([[uu - 2.7, -FV, 9.6], [uu + 2.3, -FV, 9.3],
              [uu + 2.3, FV, 9.3], [uu - 2.7, FV, 9.6]], col, 1.1);

      wheelFar(-WU, 0, WR, WHW); wheelFar(WU, 0, WR, WHW);
      fender(-WU, false, RD.d); fender(WU, false, RD.m);
      for (const s of [-1, 1]) tube([WU, s * 2.2, WR], [8.6, s * 2.2, 16.0], 0.95, ST.m, 1.0);  // 前叉
      /* ---- 车身：远侧板 → 顶面 → 近侧板（侧板才是侧视的真正轮廓） ---- */
      for (const s of [-NSS, NSS]) {
        const pts = PROF.map(p => [p[0], s * BHV, p[1]]);
        for (let i = BOTP.length - 1; i >= 0; i--) pts.push([BOTP[i][0], s * BHV, BOTP[i][1]]);
        face(pts, s === NSS ? RD.m : RD.d, 1.6);
      }
      for (let i = 0; i < PROF.length - 1; i++)
        face([[PROF[i][0], -BHV, PROF[i][1]], [PROF[i + 1][0], -BHV, PROF[i + 1][1]],
              [PROF[i + 1][0], BHV, PROF[i + 1][1]], [PROF[i][0], BHV, PROF[i][1]]], RD.l, 1.15);
      /* ---- 机械件：压在轮廓上打破大色块 ---- */
      box(-5.6, 3.2, -3.2, 3.2, 4.6, 11.4, '#6f7883', ST.d, '#4a525a', 1.5);   // 发动机
      tube([-9.8, 4.0, 6.8], [-1.8, 4.4, 9.0], 1.1, ST.m, 1.0);                // 排气
      face([[-10.2, -BHV - 0.2, 13.2], [0.0, -BHV - 0.2, 13.6],
            [0.0, BHV + 0.2, 13.6], [-10.2, BHV + 0.2, 13.2]], '#3a4048', 1.2); // 车座
      /* 油箱侧板：设计稿的油箱是**灰橄榄**的，只有车尾和整流罩是红的。
         整块侧板刷红 → 侧视就是一坨红砖，加上这块才有「车」的分节。 */
      face([[-0.8, NSS * (BHV + 0.14), 15.0], [4.2, NSS * (BHV + 0.14), 17.4],
            [7.4, NSS * (BHV + 0.14), 18.3], [7.2, NSS * (BHV + 0.14), 15.4]],
        KA.m, 1.3);
      face([[-0.8, NSS * (BHV + 0.14), 15.0], [1.0, NSS * (BHV + 0.14), 15.9],
            [7.2, NSS * (BHV + 0.14), 15.4], [7.2, NSS * (BHV + 0.14), 14.9]],
        RD.m, 1.0);                                                             // 油箱红条
      face([[7.6, -2.7, 18.62], [10.0, -2.7, 17.42], [10.0, 2.7, 17.42],
            [7.6, 2.7, 18.62]], ST.m, 1.2);                                     // 整流罩灰顶
      face([[11.9, -2.5, 11.8], [10.8, -2.5, 18.0], [10.8, 2.5, 18.0],
            [11.9, 2.5, 11.8]], GL.m, 1.3);                                     // 风挡
      capUe(12.4, 0, 14.6, 2.3, 2.3, '#ffe9a8', 1.2);                           // 大灯
      capUe(12.6, 0, 14.6, 1.4, 1.4, '#fffbe0', 0.9);
      tube([8.8, -3.8, 16.0], [8.8, 3.8, 16.0], 0.85, ST.d, 0.9);               // 车把
      /* ---- 骑手：设计稿里骑手只占车身中后段的一小块，
             躯干一旦拉到 9 个单位长，就会把车身的楔形轮廓整个盖住。
             手臂同理 —— 从肩一直伸到车把会变成两根横杠压在整流罩上，
             所以只画到手肘，剩下的交给车把。 ---- */
      tube([-4.8, -2.7, 12.8], [0.4, -3.0, 6.6], 1.05, KA.d, 1.1);       // 双腿（膝朝前）
      tube([-4.8, 2.7, 12.8], [0.4, 3.0, 6.6], 1.05, KA.d, 1.1);
      box(-7.2, -0.8, -2.6, 2.6, 12.6, 19.4, KA.l, KA.m, KA.d, 1.5);     // 躯干
      box(-9.8, -6.8, -2.2, 2.2, 13.4, 18.6, RD.d, RD.m, RD.d, 1.3);     // 背包（设计稿是红的）
      tube([-0.9, -2.3, 17.6], [3.4, -2.7, 15.4], 0.8, KA.m, 1.0);       // 双臂（只到手肘）
      tube([-0.9, 2.3, 17.6], [3.4, 2.7, 15.4], 0.8, KA.m, 1.0);
      ball(-3.6, 0, 20.8, 3.7, KA.l, 1.5);                               // 头盔
      capUe(-1.4, 0, 20.6, 2.2, 1.7, GL.l, 1.1);                         // 面罩
      wheelNear(-WU, 0, WR, WHW); wheelNear(WU, 0, WR, WHW);
      fender(-WU, true, RD.m); fender(WU, true, RD.l);
      fenderTop(-WU, RD.m); fenderTop(WU, RD.l);
    }

    /* ================= 轻型坦克 =================
       设计稿的坦克是「厚车体 + 矮炮塔」：车体 3.8~13.6（9.8 个单位），
       炮塔再叠 8.2。之前车体只有 5.6 个单位高，炮塔反而比车体还高，
       整个比例是倒过来的。
       画序：远侧履带 → 车体/侧裙 → 近侧履带（近侧负重轮要露在裙板前面）。 */
    if (kind === 'commando') {
      const THW = 2.8, TV = 12.6;
      for (const vv of [-TV, TV]) if (Math.sign(vv) !== NSS) trackFar(-16.5, 16.5, vv, THW, 8.6);
      box(-19, 19, -10.4, 10.4, 3.8, 13.6, OL.l, OL.m, OL.d, 1.9);      // 车体
      for (const s of [-1, 1]) {                                        // 首上倾斜装甲
        face([[19.05, s * 10.4, 3.8], [14.0, s * 10.4, 3.8],
              [17.2, s * 10.4, 13.6], [19.05, s * 10.4, 13.6]], OL.d, 1.5);
        face([[-16.6, s * 12.0, 8.4], [16.6, s * 12.0, 8.4],
              [16.6, s * 12.0, 14.4], [-16.6, s * 12.0, 14.4]], OL.m, 1.6);  // 侧裙
        face([[-19.8, s * 9.4, 13.6], [-12.0, s * 9.4, 13.6],
              [-12.0, s * 15.6, 13.6], [-19.8, s * 15.6, 13.6]], OL.d, 1.4); // 前挡泥板
      }
      chamBox(-7.5, 9.5, -8.2, 8.2, 13.6, 22.6, 5.0, OL.l, OL.m, OL.d, 1.9);   // 炮塔（顶部倒角，别是方砖）
      /* 炮塔前脸：必须用椭圆（宽 8.2 × 高 4.1），用 capU 画正圆会变成一面大盾牌 */
      capUe(9.7, 0, 17.7, 8.2, 4.1, OL.m, 1.7);
      capUe(9.9, 0, 17.7, 5.4, 2.6, OL.l, 1.3);
      taper([9.5, 0, 17.8], [25.5, 0, 17.8], 2.8, 2.3, ST.m, 1.6);      // 主炮
      capU(25.5, 0, 17.8, 2.3, ST.d, 1.2);
      capU(26.1, 0, 17.8, 1.3, '#0e1418', 1.0);
      box(-4.0, 4.0, -1.7, 1.7, 21.8, 24.0, ST.m, ST.m, ST.d, 1.2);     // 车顶机枪座
      tube([-3.4, 0, 24.5], [7.2, 0, 24.5], 1.1, ST.d, 0.9);
      tube([-6.6, 7.0, 21.8], [-6.6, 7.0, 33.5], 0.8, ST.d, 0.8);       // 天线
      capW(-2.0, 0, 22.4, 1.4, RD.m, 0.9);
      capV(-12.0, NEAR * 12.2, 9.8, 2.2, RD.m, 1.1);                    // 侧灯
      capV(-12.0, -NEAR * 12.2, 9.8, 2.2, '#ffd24a', 1.1);
      for (const vv of [-TV, TV]) if (Math.sign(vv) === NSS) trackNear(-16.5, 16.5, vv, THW, 8.6);
    }

    /* ================= 装甲卡车 =================
       设计稿的卡车：底盘 + 高驾驶室（带挡风玻璃和侧窗）+ 比驾驶室还高的蓬布车厢。
       总高 ≈ 0.57 × 车长，之前只有 0.35，所以看起来是一台平板拖车。 */
    if (kind === 'truck') {
      const WV = 11.2, WR = 5.3, WHW = 2.7, WUS = [17.5, -5.5, -15.5];
      for (const vv of [-WV, WV]) for (const uu of WUS) if (Math.sign(vv) !== NSS) wheelFar(uu, vv, WR, WHW);
      box(-26, 21, -10.2, 10.2, 4.6, 11.6, '#46561f', '#3c4a1b', '#313d17', 1.6);  // 大梁
      /* 驾驶室（顶面倒角） */
      chamBox(9, 21, -10.4, 10.4, 11.6, 24.4, 2.6, OL.l, OL.m, OL.d, 1.9);
      face([[21.05, -9.8, 13.4], [21.05, 9.8, 13.4], [21.05, 9.8, 21.4], [21.05, -9.8, 21.4]], GL.m, 1.6);
      face([[21.15, -9.0, 14.0], [21.15, -0.6, 14.0], [21.15, -0.6, 20.8], [21.15, -9.0, 20.8]], GL.l, 1.0);
      face([[21.15, 0.6, 14.0], [21.15, 9.0, 14.0], [21.15, 9.0, 20.8], [21.15, 0.6, 20.8]], GL.l, 1.0);
      face([[21.12, -8.6, 11.8], [21.12, 8.6, 11.8], [21.12, 8.6, 13.0], [21.12, -8.6, 13.0]], OL.x, 1.2);
      capU(21.4, -7.6, 13.2, 2.4, '#fff3c0', 1.2);
      capU(21.4, 7.6, 13.2, 2.4, '#fff3c0', 1.2);
      for (const s of [-1, 1]) {
        face([[9.6, s * 10.45, 15.4], [17.0, s * 10.45, 15.4],
              [17.0, s * 10.45, 20.6], [9.6, s * 10.45, 20.6]], GL.m, 1.4);
        face([[10.4, s * 10.5, 16.0], [16.2, s * 10.5, 16.0],
              [16.2, s * 10.5, 20.0], [10.4, s * 10.5, 20.0]], GL.l, 0.9);
      }
      capW(12.6, 0, 24.6, 1.5, '#ffb03a', 1.0);                          // 顶灯
      capW(17.4, 0, 24.6, 1.5, '#ffb03a', 1.0);
      /* 蓬布车厢（篷顶同样是倒角 + 一根脊） */
      chamBox(-26, 7, -10.0, 10.0, 11.6, 26.6, 3.4, KA.l, KA.m, KA.d, 1.9);
      for (let i = 0; i < 5; i++) {
        const uu = -25 + i * 6.6;
        for (const s of [-1, 1]) {
          face([[uu, s * 10.05, 12.2], [uu + 1.1, s * 10.05, 12.2],
                [uu + 1.1, s * 10.05, 23.6], [uu, s * 10.05, 23.6]], null, 0.9, 'rgba(66,78,36,0.45)');
        }
      }
      box(-24.1, 5.1, -8.1, 8.1, 26.6, 27.8, KA.l, KA.m, KA.d, 1.4);      // 篷顶脊
      box(-27.6, -26, -10.0, 10.0, 4.6, 6.8, ST.d, ST.x, ST.x, 1.3);      // 尾部踏板
      for (const vv of [-WV, WV]) for (const uu of WUS) if (Math.sign(vv) === NSS) wheelNear(uu, vv, WR, WHW);
    }

    /* ================= 武装直升机 =================
       设计稿：粗机身 + 圆润玻璃机头 + 细尾梁 + 垂尾 + 五叶主旋翼 + 短翼火箭巢 + 起落橇。
       机身截面是扁的（宽 13.6 / 高 8.4），所以机头必须用椭圆盘收，不能用 capU 画成正圆。
       旋翼/尾桨/起落橇要「细」—— 它们一粗就变成一堆灰香肠，把机身整个吃掉。 */
    if (kind === 'heli') {
      box(-12, 13, -6.6, 6.6, 6.0, 14.6, OL.l, OL.m, OL.d, 1.8);         // 机身
      capUe(13.3, 0, 10.2, 6.6, 4.3, OL.m, 1.7);                         // 机头圆角
      capUe(13.7, 0, 9.8, 4.7, 2.9, GL.m, 1.5);                          // 玻璃座舱
      capUe(13.9, 0, 9.1, 3.0, 1.6, GL.l, 1.1);
      for (const s of [-1, 1]) {                                          // 侧窗
        face([[8.8, s * 6.65, 8.8], [12.6, s * 5.4, 8.2], [12.6, s * 5.4, 13.6], [8.8, s * 6.65, 13.6]], GL.m, 1.4);
      }
      box(-22, -12, -3.0, 3.0, 8.6, 12.6, OL.l, OL.m, OL.d, 1.6);         // 尾梁
      capUe(-22.3, 0, 10.6, 3.0, 2.0, OL.m, 1.5);
      face([[-24.6, -1.0, 12.6], [-21.4, -1.0, 12.6], [-21.4, -1.0, 23.4], [-24.6, -1.0, 23.4]], OL.m, 1.5);  // 垂尾
      for (const s of [-1, 1]) {
        face([[-23.6, s * 1.2, 15.0], [-18.8, s * 1.2, 15.0], [-18.8, s * 7.4, 15.0], [-23.6, s * 7.4, 15.0]], OL.d, 1.3);
      }
      /* 尾桨：两片细桨叶，不用粗管（粗管在侧视角会糊成一个灰球） */
      tube([-23.7, 1.4, 18.6], [-23.7, 8.6, 18.6], 0.75, '#8d969e', 0.8);
      tube([-23.7, 5.0, 15.2], [-23.7, 5.0, 22.0], 0.75, '#8d969e', 0.8);
      ball(-23.7, 5.0, 18.6, 1.2, ST.d, 0.9);
      /* 主旋翼：桨毂 + 五片细桨叶（跟着动画相位转）。
         设计稿里旋翼直径 ≈ 1.2 × 机身全长，桨叶太短会变成「大头苍蝇」。 */
      tube([0, 0, 14.6], [0, 0, 19.0], 1.3, ST.d, 1.1);
      capW(0, 0, 19.2, 2.0, ST.l, 1.2);
      for (let i = 0; i < 5; i++) {
        const a = ph * 0.35 + i * Math.PI * 2 / 5;
        const dx = Math.cos(a), dy = Math.sin(a);
        tube([dx * 26, dy * 26, 18.8], [dx * 3.0, dy * 3.0, 18.8], 0.72, '#9aa3ab', 0.85);
      }
      /* 短翼 + 火箭巢 */
      for (const s of [-1, 1]) {
        box(-3.0, 5.0, s * 6.4, s * 12.0, 8.6, 11.0, OL.l, OL.m, OL.d, 1.5);
        box(-2.6, 5.4, s * 8.0, s * 10.8, 5.4, 8.6, OL.d, OL.m, OL.x, 1.4);   // 火箭巢
        capU(5.6, s * 9.4, 7.0, 1.6, '#12181c', 1.0);
      }
      /* 起落橇：细杆 */
      for (const s of [-1, 1]) {
        tube([-10, s * 7.2, 0.9], [11, s * 7.2, 0.9], 0.7, ST.d, 0.95);
        tube([-5.5, s * 7.2, 0.9], [-5.5, s * 4.4, 6.0], 0.62, ST.d, 0.85);
        tube([8.5, s * 7.2, 0.9], [8.5, s * 4.4, 6.0], 0.62, ST.d, 0.85);
      }
    }

    /* ================= 轰炸机 =================
       设计稿：粗圆机身 + 玻璃机头 + 后掠主翼（红翼尖）+ 每侧两台翼吊发动机 + 后掠垂尾。
       机翼不能用 box —— 一个沿 v 拉的方块在 3/4 视角会糊成一块板。
       必须画成「后掠四边形 + 前后缘厚度面」，翼型才读得出来。 */
    if (kind === 'bomber') {
      const WT = 11.0, WB = 9.4;      // 机翼上下表面高度
      box(-24, 22, -6.6, 6.6, 5.0, 15.0, OL.l, OL.m, OL.d, 1.8);          // 机身
      capUe(22.3, 0, 10.0, 6.6, 4.6, OL.m, 1.7);
      capUe(22.7, 0, 9.6, 4.4, 2.8, GL.m, 1.4);                           // 机头玻璃
      capUe(22.9, 0, 9.0, 2.6, 1.5, GL.l, 1.0);
      capUe(-24.3, 0, 10.0, 5.0, 3.6, OL.m, 1.5);
      /* 后掠主翼：翼根弦 14、翼尖弦 9，后掠 13 */
      for (const s of [-1, 1]) {
        const V = (a) => s * a;
        const rl = 7.0, rt = -7.0, tl = -6.0, tt = -15.0;
        const rv = V(5.4), tv = V(22.0), tv2 = V(17.6), rv2 = V(5.4);
        face([[rl, rv, WB], [rt, rv, WB], [tt, tv, WB], [tl, tv, WB]], OL.d, 1.6);           // 下表面
        face([[rl, rv, WB], [rl, rv, WT], [tl, tv, WT], [tl, tv, WB]], OL.m, 1.5);           // 前缘
        face([[rt, rv, WB], [rt, rv, WT], [tt, tv, WT], [tt, tv, WB]], OL.d, 1.5);           // 后缘
        face([[tl, tv, WB], [tl, tv, WT], [tt, tv, WT], [tt, tv, WB]], OL.d, 1.4);           // 翼尖
        faceG([[rl, rv, WT], [rt, rv, WT], [tt, tv, WT], [tl, tv, WT]], OL.l, 1.6);          // 上表面
        /* 红翼尖（外段整块） */
        const k = (tv - tv2) / (tv - rv);
        const ml = rl + (tl - rl) * k, mt = rt + (tt - rt) * k;
        face([[ml, tv2, WT], [mt, tv2, WT], [tt, tv, WT], [tl, tv, WT]], RD.m, 1.3);
        face([[ml, tv2, WB], [mt, tv2, WB], [tt, tv, WB], [tl, tv, WB]], RD.d, 1.2);
        face([[ml, tv2, WB], [ml, tv2, WT], [tl, tv, WT], [tl, tv, WB]], RD.m, 1.2);
        /* 翼吊发动机 ×2（挂在翼下） */
        for (const o of [10.0, 16.4]) {
          const ov = V(o);
          box(-5.0, 8.4, ov - 2.1, ov + 2.1, 5.6, 9.4, OL.l, OL.m, OL.d, 1.4);
          capUe(8.5, ov, 7.5, 2.1, 1.9, ST.x, 1.1);
          capUe(9.3, ov, 7.5, 1.3, 1.1, '#0e1418', 0.9);
          capUe(-5.1, ov, 7.5, 2.1, 1.9, '#5b646c', 1.0);
        }
      }
      /* 平尾：同样给厚度，后掠 */
      for (const s of [-1, 1]) {
        const rv = s * 1.0, tv = s * 12.0;
        face([[ -19.0, rv, 9.8], [-25.0, rv, 9.8], [-27.0, tv, 9.8], [-21.0, tv, 9.8]], OL.m, 1.4);
        face([[-19.0, rv, 9.8], [-19.0, rv, 11.0], [-21.0, tv, 11.0], [-21.0, tv, 9.8]], OL.l, 1.2);
        face([[-25.0, rv, 9.8], [-25.0, rv, 11.0], [-27.0, tv, 11.0], [-27.0, tv, 9.8]], OL.d, 1.2);
        faceG([[-19.0, rv, 11.0], [-25.0, rv, 11.0], [-27.0, tv, 11.0], [-21.0, tv, 11.0]], OL.l, 1.4);
      }
      /* 后掠垂尾：两侧各一张 + 顶缘，中间留出厚度 */
      for (const s of [-1, 1]) {
        face([[-18.0, s * 0.9, 15.0], [-25.0, s * 0.9, 15.0],
              [-26.4, s * 0.9, 27.4], [-22.2, s * 0.9, 27.4]], s > 0 ? OL.d : OL.m, 1.5);
      }
      face([[-22.2, -0.9, 27.4], [-22.2, 0.9, 27.4], [-26.4, 0.9, 27.4], [-26.4, -0.9, 27.4]], OL.l, 1.3);
      face([[-18.0, -0.9, 15.0], [-18.0, 0.9, 15.0], [-22.2, 0.9, 27.4], [-22.2, -0.9, 27.4]], OL.m, 1.3);
      face([[-22.2, -0.9, 25.6], [-22.2, -0.9, 27.4], [-26.4, -0.9, 27.4], [-26.4, -0.9, 25.6]], RD.m, 1.2);
    }

    /* ================= 重装指挥车 =================
       设计稿的 boss 是一台三层结构：履带 + 厚车体 → 大炮塔（粗炮管红炮口）
       → 副炮塔 / 指挥塔 / 红旗。整体要比轻型坦克再放大一圈。 */
    if (kind === 'boss') {
      const THW = 3.2, TV = 15.0;
      for (const vv of [-TV, TV]) if (Math.sign(vv) !== NSS) trackFar(-24.0, 24.0, vv, THW, 10.4);
      box(-27, 27, -12.8, 12.8, 4.4, 16.2, OL.l, OL.m, OL.d, 2.0);        // 车体
      for (const s of [-1, 1]) {
        face([[27.05, s * 12.8, 4.4], [20.0, s * 12.8, 4.4],
              [23.6, s * 12.8, 16.2], [27.05, s * 12.8, 16.2]], OL.d, 1.6);
        face([[-24.4, s * 14.4, 9.6], [24.4, s * 14.4, 9.6],
              [24.4, s * 14.4, 17.0], [-24.4, s * 14.4, 17.0]], OL.m, 1.7);   // 侧裙
        face([[-26.0, s * 11.6, 16.2], [-16.0, s * 11.6, 16.2],
              [-16.0, s * 18.4, 16.2], [-26.0, s * 18.4, 16.2]], OL.d, 1.4);  // 后挡泥板
      }
      chamBox(-13, 12, -10.4, 10.4, 16.2, 28.0, 5.6, OL.l, OL.m, OL.d, 2.0);   // 主炮塔（倒角）
      capUe(12.3, 0, 21.8, 10.4, 5.6, OL.m, 1.8);
      capUe(12.6, 0, 21.8, 6.6, 3.4, OL.l, 1.3);
      taper([12.5, 0, 22.4], [34.0, 0, 22.4], 3.6, 3.0, ST.m, 1.8);       // 主炮
      capU(34.0, 0, 22.4, 3.0, ST.d, 1.4);
      capU(36.8, 0, 22.4, 3.4, '#c0392b', 1.5);                           // 红炮口
      capU(37.2, 0, 22.4, 1.9, '#7e1c12', 1.1);
      chamBox(2, 14, 5.0, 13.4, 27.4, 34.6, 4.0, OL.l, OL.m, OL.d, 1.7);  // 副炮塔
      taper([13.8, 9.2, 30.4], [22.6, 9.2, 30.4], 1.7, 1.4, ST.d, 1.2);
      chamBox(-11.0, -3.0, -5.4, 4.2, 27.4, 32.8, 2.8, OL.l, OL.m, OL.d, 1.6); // 指挥塔
      tube([-16.0, -8.0, 27.4], [-16.0, -8.0, 43.5], 1.0, ST.d, 0.9);     // 旗杆
      face([[-16.0, -8.0, 43.5], [-16.0, -20.5, 40.6], [-16.0, -20.5, 37.2], [-16.0, -8.0, 35.8]], RD.m, 1.2);
      face([[-16.0, -8.0, 40.2], [-16.0, -18.2, 38.8], [-16.0, -18.2, 37.4], [-16.0, -8.0, 37.2]], RD.l, 0.9);
      tube([-6.0, 6.4, 27.4], [-6.0, 6.4, 39.0], 0.85, ST.d, 0.8);        // 天线 ×2
      tube([6.0, -8.0, 33.6], [6.0, -8.0, 43.0], 0.85, ST.d, 0.8);
      capW(-5.0, 0, 33.8, 1.5, RD.m, 0.9);
      capV(-28.5, NEAR * 12.8, 10.6, 2.4, '#fff3c0', 1.1);
      capV(-28.5, -NEAR * 12.8, 10.6, 2.4, '#fff3c0', 1.1);
      for (const vv of [-TV, TV]) if (Math.sign(vv) === NSS) trackNear(-24.0, 24.0, vv, THW, 10.4);
    }

    return c;
  }

  // 逐车尺寸补偿已经搬进 buildVehicle 的 ESCALE，这里不再另存一份

  function drawEnemy(x, e, t) {
    /* 设计稿裁图：直接贴，按朝向旋转。 */
    const useDesign = typeof Sprites !== 'undefined' && Sprites.enabled && Sprites.loaded;
    if (useDesign) {
      x.save();
      x.translate(e.x, e.y);
      if (e.air) {
        x.globalAlpha = 0.24;
        x.fillStyle = '#000'; ell(x, 8, 22, 16, 6.5); x.fill();
        x.globalAlpha = 1;
        x.translate(0, -20 - Math.sin(t * 3 + e.seed) * 2.5);
      }
      Sprites.drawEnemy(x, e.art, 0, 0, e.angle);
      x.restore();
      return;
    }
    const frame = Math.floor(e.anim * ENEMY_FRAMES) % ENEMY_FRAMES;
    const sp = getEnemyProj(e.art, frame, e.angle);
    x.save();
    x.translate(e.x, e.y);
    // 空中单位：地面投影 + 悬停浮动
    if (e.air) {
      x.globalAlpha = 0.24;
      x.fillStyle = '#000'; ell(x, 8, 22, 16, 6.5); x.fill();
      x.globalAlpha = 1;
      x.translate(0, -20 - Math.sin(t * 3 + e.seed) * 2.5);
    }
    x.drawImage(sp.n, -EPX, -EPY);
    if (e.hitFlash > 0) {
      if (!sp.f) sp.f = makeFlash(sp.n);
      x.globalAlpha = Math.min(0.6, e.hitFlash * 0.6);
      x.drawImage(sp.f, -EPX, -EPY);
      x.globalAlpha = 1;
    }
    x.restore();
  }

  /* ============================================================
     UI 图标（炮塔按钮 / HUD）
     ============================================================ */
  /* 离屏炮塔图里墨迹的包围盒（图标对中用；每种塔只算一次） */
  const topBoxCache = {};
  function topInkBox(key, lv) {
    const id = key + lv;
    if (topBoxCache[id]) return topBoxCache[id];
    const c = getTopProj(key, lv, -0.35);
    const d = c.getContext('2d').getImageData(0, 0, TPW, TPW).data;
    let x0 = TPW, y0 = TPW, x1 = -1, y1 = -1;
    for (let y = 0; y < TPW; y++) {
      const row = y * TPW;
      for (let x = 0; x < TPW; x++) {
        if (d[(row + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = TPW; }
    const o = { x0: x0, y0: y0, x1: x1, y1: y1 };
    topBoxCache[id] = o; return o;
  }

  function towerIcon(key, size) {
    /* 设计稿：直接把 lvl1 裁图缩到 size×size，瞄准角写 0。 */
    if (typeof Sprites !== 'undefined' && Sprites.loaded) {
      const img = Sprites.img(`${key}_t_lvl1`);
      if (img && img.complete) {
        const c = document.createElement('canvas'); c.width = size; c.height = size;
        const x = c.getContext('2d');
        const s = Math.min(size / img.naturalWidth, size / img.naturalHeight);
        const w = img.naturalWidth * s, h = img.naturalHeight * s;
        x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        return c;
      }
    }
    const { c, x } = cv(size, size);
    x.translate(size / 2, size / 2);
    x.scale(size / 96, size / 96);
    x.lineJoin = 'round'; x.lineCap = 'round';
    towerBase(x, key);
    /* 图标用同一套 3/4 投影，玩家在按钮上看到的就是场上的样子。
       各塔高度差很大（胶水塔的天线最高、火焰塔最矮），写死一个顶高会把
       高的那几座削掉，所以按离屏画布里实际的墨迹范围来对中。 */
    const bb = topInkBox(key, 0);
    const topY = bb.y0 + TOP_OY;
    const botY = BASE_CY_TOP + BASE_RIM_H + BASE_RY + 4;
    x.translate(0, -(topY + botY) / 2);
    x.drawImage(getTopProj(key, 0, -0.35), TOP_OX, TOP_OY);
    return c;
  }

  return {
    cv, ell, ink, roundRect, vgrad, rgrad, mulberry32, rng,
    buildGround, drawDecor, drawTerrain, drawBaseWall,
    drawTower, drawEnemy, towerIcon, getTowerSprite,
    GROUND_K, projVec, getTopProj, TOP_OX, TOP_OY, BASE_CY_TOP,
    EPX, EPY, ENEMY_CV,
    bush, tree, rock, cactus, palm, flower, getEnemyProj
  };
})();
