/* ============================================================
   parts.js —— 共用图元库 + 逐单位材质工厂

   这里是所有武器/敌人共用的「工业零件」集合。
   造型规则（从第一座炮塔验证出来的，全部沿用到别的单位）：

     1. **尺寸锚点**：基座直径 ≈ 车体宽 × 2.2（太窄头重脚轻，太宽像盘子）
     2. **所有边必须倒角**：90° 硬边在 PBR 下会死黑，倒角才接得到高光
     3. **三层结构**：底座 → 深色腰环（阴影缝）→ 主体
     4. **特征件必须伸出轮廓**：炮管/天线/舱盖超出主体，剪影才不是一块砖
     5. **小尺度信息**：螺栓圈、散热格栅、警示条纹 —— 60px 下还能读出的细节量

   材质：每个单位一套独立色（设计稿实测），不用同一套色刷所有单位。
   ============================================================ */
import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/* ---------------------------------------------------------------- 图元 */

/** 倒角盒 */
export function rbox(w, h, d, r = 0.03) {
  const rr = Math.max(0.002, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
  return new RoundedBoxGeometry(w, h, d, 3, rr);
}

/** 圆柱，轴向 Y */
export function cylY(r, h, seg = 28, rTop) {
  return new THREE.CylinderGeometry(rTop === undefined ? r : rTop, r, h, seg, 1);
}

/** 圆柱，轴向 Z（炮管、舱盖正面） */
export function cylZ(r, h, seg = 28, rFar) {
  const g = new THREE.CylinderGeometry(rFar === undefined ? r : rFar, r, h, seg, 1);
  g.rotateX(Math.PI / 2);
  return g;
}

/** 圆柱，轴向 X（横置的罐体） */
export function cylX(r, h, seg = 28) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** 薄环（箍、垫圈）—— 默认躺在 XY 平面，法线朝 Z，正好套炮管 */
export function ringZ(r, tube, seg = 26) {
  return new THREE.TorusGeometry(r, tube, 8, seg);
}

export function ringY(r, tube, seg = 32) {
  const g = new THREE.TorusGeometry(r, tube, 8, seg);
  g.rotateX(Math.PI / 2);
  return g;
}

/** 圆锥，轴向 Y */
export function coneY(rBot, rTop, h, seg = 20) {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
}

/** 建 mesh 并挂到父级 */
export function add(parent, geo, mat, pos, rot, castShadow = true) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* ---------------------------------------------------------------- 组合件 */

/** 一圈螺栓 —— 设计稿里每个圆盖/法兰边缘都有，最廉价的「工业感」 */
export function boltRing(parent, mat, n, R, r, h, center, axis = 'Y', phase = 0) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + phase;
    if (axis === 'Y') {
      add(parent, cylY(r, h, 6), mat,
        [center[0] + Math.sin(a) * R, center[1], center[2] + Math.cos(a) * R]);
    } else if (axis === 'X') {
      add(parent, cylY(r, h, 6), mat,
        [center[0], center[1] + Math.sin(a) * R, center[2] + Math.cos(a) * R],
        [0, 0, Math.PI / 2]);
    } else {
      add(parent, cylY(r, h, 6), mat,
        [center[0] + Math.sin(a) * R, center[1] + Math.cos(a) * R, center[2]],
        [Math.PI / 2, 0, 0]);
    }
  }
}

/** 散热格栅：一排细缝。真 3D 下有遮挡关系，比贴图画线条划算 */
export function ventGrill(parent, mat, n, sx, sy, sz, loc, gap, axis = 'Y') {
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * gap;
    const p = axis === 'Y' ? [loc[0], loc[1] + o, loc[2]]
      : axis === 'X' ? [loc[0] + o, loc[1], loc[2]]
        : [loc[0], loc[1], loc[2] + o];
    add(parent, rbox(sx, sy, sz, 0.006), mat, p);
  }
}

/** 警示斜纹带：一圈黄黑块，贴在基座/车身外壁 */
export function hazardBand(parent, matA, matB, R, y, n, cellW, h, thick, zOff = 0) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.13;
    add(parent, rbox(cellW, h, thick, 0.012), i % 2 ? matA : matB,
      [Math.sin(a) * R, y, Math.cos(a) * R + zOff], [0, a, 0]);
  }
}

/** 分段炮管：管身锥形 + 炮膛 + 环箍 + 制退器 + 炮口内膛。沿 +Z。 */
export function buildBarrel(parent, M, opt) {
  const {
    z0, len, r, rEnd = r * 0.86, seg = 5, brake = true, brakeR = 1.5,
  } = opt;
  const g = new THREE.Group();
  g.position.z = z0;
  parent.add(g);

  // 管身
  add(g, cylZ(r, len, 20, rEnd), M.steelDark, [0, 0, len / 2]);
  // 后段炮膛（加粗）
  add(g, cylZ(r * 1.42, len * 0.26, 20), M.steel, [0, 0, len * 0.13]);
  // 环箍
  for (let i = 0; i < seg; i++) {
    const t = 0.36 + i * (0.44 / Math.max(1, seg - 1));
    add(g, ringZ(r * 1.12, r * 0.22, 20), M.steelLight, [0, 0, len * t]);
  }
  if (brake) {
    const mb = len * 0.86;
    add(g, cylZ(r * brakeR, r * 1.5, 18), M.steel, [0, 0, mb]);
    add(g, ringZ(r * brakeR * 1.06, r * 0.30, 18), M.steelDark, [0, 0, mb + r * 0.5]);
    add(g, ringZ(r * brakeR * 1.06, r * 0.30, 18), M.steelDark, [0, 0, mb - r * 0.5]);
  }
  // 炮口内膛
  add(g, cylZ(r * 1.0, 0.06, 18), M.bore, [0, 0, len + r * 0.33]);
  g.userData.muzzleZ = z0 + len + r * 0.4;
  return g;
}

/* ---------------------------------------------------------------- 轮 / 履带 */
export function wheel(parent, M, r, w, pos, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.y = rotY;
  parent.add(g);
  // 胎：橡胶，不反光
  add(g, cylX(r, w, 20), M.rubber, [0, 0, 0], [0, 0, 0]);
  // 胎面纹：一圈凸块
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    add(g, rbox(w * 0.96, r * 0.16, r * 0.30, 0.01), M.rubberDeep,
      [0, Math.sin(a) * r * 0.96, Math.cos(a) * r * 0.96], [a, 0, 0]);
  }
  // 轮毂（黄铜，识别度最高的一处）
  add(g, cylX(r * 0.58, w * 1.02, 16), M.brass, [0, 0, 0]);
  add(g, cylX(r * 0.30, w * 1.08, 12), M.brassDark, [0, 0, 0]);
  boltRing(g, M.steelDark, 5, r * 0.42, r * 0.07, w * 1.1, [0, 0, 0], 'X');
  return g;
}

/** 履带：把一圈板条沿「体育场形」路径铺出来。
    路径在 Z-Y 平面：底边直线 → 前端半圆 → 顶边直线 → 后端半圆。
    按弧长参数化，板条间距才均匀（等角度分会让半圆处挤成一坨）。
    真 3D 的好处：转向时能看到履带内侧面和负重轮。 */
export function track(parent, M, opt) {
  const { len, h, w, plates = 28, roadWheels = 5 } = opt;
  const g = new THREE.Group();
  parent.add(g);
  const L = len / 2, H = h / 2;          // 半长 / 半高
  const straight = 2 * L;
  const cap = Math.PI * H;
  const per = straight * 2 + cap * 2;
  const plateLen = (per / plates) * 0.88;

  for (let i = 0; i < plates; i++) {
    const s = (i / plates) * per;        // 沿路径的弧长
    let z, y, th;
    if (s < straight) {                  // 底边：-L → +L，y=-H
      z = -L + s; y = -H; th = -Math.PI / 2;
    } else if (s < straight + cap) {     // 前端半圆
      th = -Math.PI / 2 + ((s - straight) / cap) * Math.PI;
      z = L + Math.cos(th) * H; y = Math.sin(th) * H;
    } else if (s < straight * 2 + cap) { // 顶边：+L → -L，y=+H
      const k = s - straight - cap;
      z = L - k; y = H; th = Math.PI / 2;
    } else {                            // 后端半圆
      th = Math.PI / 2 + ((s - straight * 2 - cap) / cap) * Math.PI;
      z = -L + Math.cos(th) * H; y = Math.sin(th) * H;
    }
    // 让板条的「薄」轴对准外法线：φ = π/2 − θ
    add(g, rbox(w, h * 0.11, plateLen, 0.010), M.track,
      [0, y, z], [Math.PI / 2 - th, 0, 0]);
  }

  // 负重轮：露出的黄铜轮毂 —— 设计稿里履带内最亮的一处
  const nw = roadWheels;
  for (let i = 0; i < nw; i++) {
    const zz = -L * 0.74 + (i / Math.max(1, nw - 1)) * L * 1.48;
    add(g, cylX(H * 0.54, w * 0.84, 16), M.steelDark, [0, -H * 0.30, zz]);
    add(g, cylX(H * 0.27, w * 0.92, 12), M.brass, [0, -H * 0.30, zz]);
  }
  // 主动轮 / 诱导轮（两端大轮）
  for (const s of [-1, 1]) {
    add(g, cylX(H * 0.72, w * 0.86, 18), M.steelDark, [0, 0, s * L]);
    add(g, cylX(H * 0.36, w * 0.95, 14), M.brassDark, [0, 0, s * L]);
    boltRing(g, M.steel, 6, H * 0.48, H * 0.08, w * 0.98, [0, 0, s * L], 'X');
  }
  return g;
}

/* ---------------------------------------------------------------- 材质工厂
   每个单位一套调色板。palette 形如
     { armor, armorDark, armorLight, accent, glass?, glow? }
   其余（钢/黄铜/橡胶）全局共用，保证同一套世界里的材质语言统一。 */
export function makeUnitMaterials(envMap, pal) {
  const std = (color, metalness, roughness, extra) =>
    new THREE.MeshStandardMaterial({
      envMap, envMapIntensity: 1.25,
      color, metalness, roughness, ...extra,
    });
  const M = {
    armor: std(pal.armor, pal.metal ?? 0.45, pal.rough ?? 0.40),
    armorDark: std(pal.armorDark, 0.50, 0.48),
    armorLight: std(pal.armorLight, 0.40, 0.34),
    accent: std(pal.accent, 0.35, 0.42),
    steel: std('#8b9299', 0.95, 0.20),
    steelDark: std('#3d444b', 0.90, 0.32),
    steelLight: std('#b6bdc3', 0.96, 0.14),
    brass: std('#c9a24a', 1.0, 0.26),
    brassDark: std('#8a6d24', 1.0, 0.36),
    rubber: std('#191c17', 0.0, 0.94),
    rubberDeep: std('#0f110d', 0.0, 0.98),
    track: std('#41463c', 0.72, 0.62),
    bore: std('#08090a', 0.4, 0.85),
    red: std('#b83a2c', 0.25, 0.35),
    warn: std('#e8b53a', 0.55, 0.40),
  };
  if (pal.glass) {
    M.glass = new THREE.MeshStandardMaterial({
      envMap, envMapIntensity: 1.6,
      color: pal.glass, metalness: 0.9, roughness: 0.06,
      transparent: true, opacity: 0.86,
    });
  }
  if (pal.glow) {
    M.glow = new THREE.MeshStandardMaterial({
      color: '#0d2a33', emissive: new THREE.Color(pal.glow),
      emissiveIntensity: 3.2, metalness: 0.2, roughness: 0.3,
    });
    M.lens = new THREE.MeshStandardMaterial({
      color: '#0a2c3a', emissive: new THREE.Color(pal.glow),
      emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.06,
    });
  }
  return M;
}

/* ---------------------------------------------------------------- 释放 */
export function disposeGroup(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}
