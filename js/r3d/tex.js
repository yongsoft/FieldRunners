/* ============================================================
   r3d/tex.js — 程序化贴图库

   整套 3D 画面没有任何外部图片：地面、水面、装甲磨损、光斑、
   烟雾、火花全部在这里用 Canvas / ImageData 现场生成。

   为什么不用纯色：PBR 下「同一个颜色的一整块平面」会死板到像塑料。
   真实感来自 3 样东西 —— 颜色微差、粗糙度微差、法线微扰。
   所以每种表面对应一张 map + 一张 normalMap + 一张 roughnessMap。
   ============================================================ */
import * as THREE from 'three';

/* ---------------------------------------------------------------- 噪声 */

function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* 周期性 value noise —— period 保证贴图可无缝平铺 */
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const p = Math.max(1, period);
  const w = (a, b) => hash2(((a % p) + p) % p, ((b % p) + p) % p, seed);
  const a = w(xi, yi), b = w(xi + 1, yi), c = w(xi, yi + 1), d = w(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, period, seed, oct) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(x * f, y * f, period * f, seed + o * 71);
    norm += amp;
    amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

/* 从高度场生成法线贴图（Sobel，环绕采样保证无缝） */
function heightToNormal(h, size, strength) {
  const data = new Uint8ClampedArray(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const L = Math.hypot(nx, ny, nz) || 1;
      nx /= L; ny /= L; nz /= L;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

const clamp01 = v => v < 0 ? 0 : (v > 1 ? 1 : v);

const _cache = new Map();
function cached(key, make) {
  if (_cache.has(key)) return _cache.get(key);
  const v = make();
  _cache.set(key, v);
  return v;
}

function dataTex(data, size, { repeat = 1, srgb = false, wrap = THREE.RepeatWrapping } = {}) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = wrap;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  if (repeat !== 1) t.repeat.set(repeat, repeat);
  return t;
}

/* ---------------------------------------------------------------- 地面 */

const THEME = {
  grass: {
    base: [0.205, 0.365, 0.095], alt: [0.370, 0.545, 0.170],
    dark: [0.088, 0.165, 0.042], speck: [0.560, 0.615, 0.270],
    rough: 0.92,
  },
  desert: {
    /* 沙地反照率不能给足：4.7 强度的阳光一打就过曝，实测均值 149 → 压到 0.46 */
    base: [0.455, 0.335, 0.155], alt: [0.600, 0.470, 0.255],
    dark: [0.290, 0.205, 0.090], speck: [0.700, 0.605, 0.400],
    rough: 0.96,
  },
  snow: {
    /* 雪是最容易过曝的表面（实测均值 191、33% 像素贴上 224）。
       把 albedo 压到 0.50/0.68，让高光还给太阳而不是整片贴白。 */
    base: [0.405, 0.472, 0.552], alt: [0.560, 0.625, 0.695],
    dark: [0.255, 0.330, 0.430], speck: [0.760, 0.800, 0.840],
    rough: 0.72,
  },
};

/**
 * 地面三件套。512px 对应 512 世界单位 → 屏幕约 1:1，颗粒不会被拉糊。
 */
export function groundMaps(themeKey) {
  return cached('ground:' + themeKey, () => {
    const S = 512;
    const th = THEME[themeKey] || THEME.grass;
    const col = new Uint8ClampedArray(S * S * 4);
    const rgh = new Uint8ClampedArray(S * S * 4);
    const hgt = new Float32Array(S * S);

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        /* 三层：大块色斑 → 中频起伏 → 高频颗粒 */
        const macro = fbm(x / 256, y / 256, 2, 7, 3);      // 大块地貌（256px）
        const patch = fbm(x / 96, y / 96, S / 96, 11, 4);   // 中块色斑
        const grain = fbm(x / 14, y / 14, S / 14, 23, 3);   // 颗粒
        const fine = vnoise(x / 3.2, y / 3.2, S / 3.2, 37); // 细颗粒

        /* 草叶笔触：各向异性的高频条纹。这是"手绘草地"最关键的一层 ——
           没有它，地面在 3D 光照下就是一张均匀的绿布。 */
        const blade = vnoise(x / 1.7, y / 11, 300, 61);
        const blade2 = vnoise(x / 2.6 + 40, y / 15 + 17, 200, 67);
        const stroke = (blade - 0.5) * 0.45 + (blade2 - 0.5) * 0.30;

        /* 小石子 / 草簇：只有很尖的峰才点亮，形成"点"而不是"雾" */
        const peb = Math.max(0, (vnoise(x / 6.5, y / 6.5, S / 6.5, 51) - 0.80) / 0.20);

        const t = clamp01(patch * 0.62 + grain * 0.38 + (macro - 0.5) * 0.55);
        let r = th.base[0] + (th.alt[0] - th.base[0]) * t;
        let g = th.base[1] + (th.alt[1] - th.base[1]) * t;
        let b = th.base[2] + (th.alt[2] - th.base[2]) * t;

        /* 暗斑（土色 / 枯草） */
        const dk = Math.max(0, (0.46 - patch) / 0.46) * 0.55;
        r += (th.dark[0] - r) * dk; g += (th.dark[1] - g) * dk; b += (th.dark[2] - b) * dk;

        /* 大块明暗 + 草叶笔触：让地面有起伏和纹理，而不是一张均匀的绿布 */
        const mk = (0.80 + macro * 0.42) * (1.0 + stroke * 0.55);

        /* 高频颗粒 */
        const k = (0.86 + fine * 0.26) * mk;
        r *= k; g *= k; b *= k;

        /* 石子 */
        if (peb > 0) {
          const w = peb * 0.85;
          r += (th.speck[0] - r) * w; g += (th.speck[1] - g) * w; b += (th.speck[2] - b) * w;
        }

        const i = (y * S + x) * 4;
        col[i] = r * 255; col[i + 1] = g * 255; col[i + 2] = b * 255; col[i + 3] = 255;

        const rv = th.rough + (grain - 0.5) * 0.10 - peb * 0.10;
        rgh[i] = rgh[i + 1] = rgh[i + 2] = Math.max(0, Math.min(1, rv)) * 255;
        rgh[i + 3] = 255;

        hgt[y * S + x] = grain * 0.50 + fine * 0.14 + peb * 0.62 + macro * 0.26 + stroke * 0.55;
      }
    }

    return {
      map: dataTex(col, S, { srgb: true }),
      normalMap: dataTex(heightToNormal(hgt, S, 1.15), S),
      roughnessMap: dataTex(rgh, S),
    };
  });
}

/* ---------------------------------------------------------------- 水 */

/** 水面法线：两层不同频率的波纹，运行时靠 offset 反向滚动 = 流动感 */
export function waterNormal() {
  return cached('waterN', () => {
    const S = 256;
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const a = fbm(x / 34, y / 34, S / 34, 91, 4);
        const b = vnoise(x / 9, y / 9, S / 9, 97);
        h[y * S + x] = a * 0.8 + b * 0.2;
      }
    }
    return dataTex(heightToNormal(h, S, 2.6), S);
  });
}

/* ---------------------------------------------------------------- 装甲 */

/**
 * 装甲细节法线：细密颗粒 + 稀疏长划痕。
 * 用在炮塔和车体上，让平直的大面在掠射角下有"金属被加工过"的质感。
 */
export function armorNormal() {
  return cached('armorN', () => {
    const S = 256;
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let v = fbm(x / 6, y / 6, S / 6, 131, 3) * 0.55 + vnoise(x / 2.2, y / 2.2, S / 2.2, 137) * 0.18;
        /* 划痕：沿某个方向拉长的窄带 */
        const s1 = vnoise(x / 40, y / 1.6, S / 40, 141);
        if (s1 > 0.88) v -= (s1 - 0.88) * 3.4;
        h[y * S + x] = v;
      }
    }
    return dataTex(heightToNormal(h, S, 1.05), S);
  });
}

export function metalRoughness() {
  return cached('metalR', () => {
    const S = 128;
    const d = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = 0.30 + fbm(x / 10, y / 10, S / 10, 211, 3) * 0.42;
        const i = (y * S + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v * 255; d[i + 3] = 255;
      }
    }
    return dataTex(d, S);
  });
}

/* ---------------------------------------------------------------- 精灵 */

function sprite(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  draw(x, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 径向光斑：炮口焰、火花、等离子球都用它 */
export function glowSprite() {
  return cached('glow', () => sprite(128, (x, S) => {
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.16, 'rgba(255,252,232,0.92)');
    g.addColorStop(0.34, 'rgba(255,206,120,0.48)');
    g.addColorStop(0.62, 'rgba(255,140,50,0.15)');
    g.addColorStop(1.00, 'rgba(255,90,20,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }));
}

/** 柔和烟团 */
export function smokeSprite() {
  return cached('smoke', () => sprite(128, (x, S) => {
    for (let i = 0; i < 9; i++) {
      const r = S * (0.14 + Math.random() * 0.16);
      const cx = S * (0.30 + Math.random() * 0.40);
      const cy = S * (0.30 + Math.random() * 0.40);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.30)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    }
  }));
}

/** 地面焦痕 */
export function scorchSprite() {
  return cached('scorch', () => sprite(128, (x, S) => {
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, 'rgba(18,14,10,0.85)');
    g.addColorStop(0.42, 'rgba(26,20,14,0.55)');
    g.addColorStop(0.78, 'rgba(30,24,16,0.16)');
    g.addColorStop(1.00, 'rgba(30,24,16,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }));
}

/** 接触阴影：贴在单位脚下的软暗斑，补足 shadow map 抓不到的细节 */
export function contactShadow() {
  return cached('contact', () => sprite(64, (x, S) => {
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.34)');
    g.addColorStop(0.80, 'rgba(0,0,0,0.08)');
    g.addColorStop(1.00, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }));
}

/** 环境贴图：顶部天空、地平线暖光、地面暗色 —— 金属反射的来源 */
export function envCanvas() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, '#5d7ea6');   // 天顶冷蓝
  g.addColorStop(0.34, '#9fbcd6');
  g.addColorStop(0.49, '#e8e2cd');   // 地平线暖白
  g.addColorStop(0.52, '#8d7d5e');
  g.addColorStop(0.72, '#4a4232');   // 地面
  g.addColorStop(1.00, '#241f18');
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  /* 左上一块亮斑 = 太阳的高光区，金属上会出现一条漂亮的长条反射 */
  const sg = x.createRadialGradient(W * 0.28, H * 0.20, 0, W * 0.28, H * 0.20, W * 0.30);
  sg.addColorStop(0, 'rgba(255,250,232,0.95)');
  sg.addColorStop(0.35, 'rgba(255,238,200,0.35)');
  sg.addColorStop(1, 'rgba(255,230,190,0)');
  x.fillStyle = sg; x.fillRect(0, 0, W, H);

  /* 两片薄云，避免反射是死板的渐变 */
  for (let i = 0; i < 7; i++) {
    const cx = Math.random() * W, cy = H * (0.10 + Math.random() * 0.30);
    const r = 40 + Math.random() * 90;
    const cg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    cg.addColorStop(0, 'rgba(255,255,255,0.16)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = cg;
    x.beginPath(); x.ellipse(cx, cy, r * 1.6, r * 0.5, 0, 0, 7); x.fill();
  }
  return c;
}

export function disposeAll() {
  for (const v of _cache.values()) {
    if (v && v.dispose) v.dispose();
    else if (v && typeof v === 'object') {
      for (const k in v) if (v[k] && v[k].dispose) v[k].dispose();
    }
  }
  _cache.clear();
}
