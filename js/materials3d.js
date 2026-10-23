/* ============================================================
   materials.js —— 材质库 + 程序化环境贴图

   这一版和之前所有尝试的根本区别：**用 PBR 金属材质 + 环境反射**，
   而不是把颜色平涂上去。所有「好看」的感觉都来自这里：
     · 金属度决定反射有多强
     · 粗糙度决定反射有多糊
     · 环境贴图决定反射里看到什么
   平涂赛璐璐永远做不出这种层次，因为它没有反射。
   ============================================================ */
import * as THREE from 'three';

/* 从设计稿实测出来的色系（暗橄榄装甲 + 钢 + 黄铜 + 警示红） */
export const C = {
  armor:      '#4f5733',
  armorDark:  '#2b3120',
  armorLight: '#6d7752',
  steel:      '#8b9299',
  steelDark:  '#3d444b',
  steelLight: '#b6bdc3',
  brass:      '#c9a24a',
  brassDark:  '#8a6d24',
  red:        '#b83a2c',
  glowCyan:   '#6fe8ff',
  glowAmber:  '#ffb347',
};

/**
 * 程序化 equirect 环境贴图：上半冷白天空、地平线暖带、下半橄榄地面，
 * 左上角一块太阳亮斑。
 *
 * 为什么值得手写：金属材质有 60% 的观感来自「反射里有什么」。
 * 纯色环境会让所有金属变成同一片灰，倒角也完全读不出来。
 */
export function makeEnvCanvas() {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  const sky = x.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.00, '#b9d4e8');
  sky.addColorStop(0.30, '#dce8ee');
  sky.addColorStop(0.44, '#f6efdf');
  sky.addColorStop(0.50, '#cfcbb0');
  sky.addColorStop(0.56, '#7e8a5e');
  sky.addColorStop(1.00, '#2e3520');
  x.fillStyle = sky;
  x.fillRect(0, 0, W, H);

  // 太阳亮斑（对应主光方向：左上前）
  const sun = x.createRadialGradient(W * 0.26, H * 0.20, 6, W * 0.26, H * 0.20, W * 0.30);
  sun.addColorStop(0.00, 'rgba(255,252,236,1)');
  sun.addColorStop(0.25, 'rgba(255,246,215,0.55)');
  sun.addColorStop(1.00, 'rgba(255,246,215,0)');
  x.fillStyle = sun;
  x.fillRect(0, 0, W, H);

  // 地平线一抹冷反光，金属侧壁才不会一片死黑
  const hor = x.createLinearGradient(0, H * 0.46, 0, H * 0.56);
  hor.addColorStop(0, 'rgba(255,255,255,0)');
  hor.addColorStop(0.5, 'rgba(238,246,255,0.42)');
  hor.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = hor;
  x.fillRect(0, H * 0.46, W, H * 0.10);

  return c;
}

/** 建立所有材质。envMap 由调用方在 renderer 就绪后传入。 */
export function makeMaterials(envMap) {
  const std = (opts) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 1.25, ...opts });

  const M = {
    /* 主装甲：橄榄绿金属。metalness 0.45 + roughness 0.38 →
       有明确的高光带但不至于像镜子 */
    armor: std({ color: C.armor, metalness: 0.45, roughness: 0.40 }),
    armorDark: std({ color: C.armorDark, metalness: 0.50, roughness: 0.48 }),
    armorLight: std({ color: C.armorLight, metalness: 0.40, roughness: 0.34 }),

    /* 钢：金属度拉高、粗糙度压低，用来做炮管/齿圈/螺栓，
       和装甲形成「哑光 vs 亮钢」的对比 */
    steel: std({ color: C.steel, metalness: 0.95, roughness: 0.20 }),
    steelDark: std({ color: C.steelDark, metalness: 0.90, roughness: 0.32 }),
    steelLight: std({ color: C.steelLight, metalness: 0.96, roughness: 0.14 }),

    brass: std({ color: C.brass, metalness: 1.0, roughness: 0.26 }),
    brassDark: std({ color: C.brassDark, metalness: 1.0, roughness: 0.36 }),

    red: std({ color: C.red, metalness: 0.25, roughness: 0.35 }),

    /* 橡胶/防滑垫：完全不反光，给大块金属之间留一个「静音」的呼吸点 */
    rubber: std({ color: '#191c17', metalness: 0.0, roughness: 0.94 }),

    /* 发光件。emissive 值调得比纯色高，靠后面的光晕 sprite 补 bloom 感 */
    glowCyan: new THREE.MeshStandardMaterial({
      color: '#0d2a33', emissive: new THREE.Color(C.glowCyan),
      emissiveIntensity: 3.2, metalness: 0.2, roughness: 0.3,
    }),
    glowAmber: new THREE.MeshStandardMaterial({
      color: '#331f08', emissive: new THREE.Color(C.glowAmber),
      emissiveIntensity: 3.6, metalness: 0.1, roughness: 0.4,
    }),
    lens: new THREE.MeshStandardMaterial({
      color: '#0a2c3a', emissive: new THREE.Color('#39c6e8'),
      emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.06,
    }),
  };
  return M;
}

/** 径向光晕贴图（additive sprite 用），零依赖模拟 bloom。 */
export function makeGlowTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.20)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 接触阴影贴图：中心黑、边缘透明。
    贴在塔脚下面，和真实 shadowMap 叠加 —— 有它塔才「坐」在地上，
    没有它无论阴影多准，塔都像贴上去的。 */
export function makeContactTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.10, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, 'rgba(0,0,0,0.72)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.40)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.11)');
  g.addColorStop(1.00, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
