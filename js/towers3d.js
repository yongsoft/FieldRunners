/* ============================================================
   towers.js —— 6 座炮塔（每座独立色系，取自设计稿实测）

   共用骨架（和已认可的第一座一致）：
        plinth 八棱台座 → 深色腰环 → 齿圈转盘 → 炮体 → 炮盾 → 炮管 → 细节

   每座塔只有一个「灵魂部件」，其余都是这个部件的陪衬：
        gatling  六管旋转枪簇 + 左侧大圆舱盖
        mortar   上仰的粗长炮管 + 大回转盘
        missile  双联倾斜发射箱 + 雷达盘
        tesla    钢鼓线圈 + 悬浮等离子球
        flame    卧式燃料罐 + 粗喷管
        goo      40° 斜置碟形天线 + 焦点球

   等级累进只做三件事：**加大主体 / 加长炮管 / 加装专属附件**，
   不改整体比例 —— 否则三级摆一起看不出是同一族。
   ============================================================ */
import * as THREE from 'three';
import {
  TAU, DEG, add, boltRing, buildBarrel, coneY, cylX, cylY, cylZ,
  hazardBand, rbox, ringY, ringZ, ventGrill,
} from './parts3d.js';

/* ---------------------------------------------------------------- 色板 */
export const TOWER_PAL = {
  gatling: { armor: '#50582b', armorDark: '#303823', armorLight: '#939a66', accent: '#5c6256', glow: '#8fe6b4' },
  mortar: { armor: '#5d6558', armorDark: '#313724', armorLight: '#8c916c', accent: '#52552c', glow: '#ffb347' },
  missile: { armor: '#5b6259', armorDark: '#2f3728', armorLight: '#8f8f6d', accent: '#515030', glow: '#ff6a3c' },
  tesla: { armor: '#254f5f', armorDark: '#16303a', armorLight: '#749793', accent: '#546561', glow: '#a6e2ef' },
  flame: { armor: '#585a29', armorDark: '#2b3018', armorLight: '#979b5e', accent: '#32371a', glow: '#ff9a2e' },
  goo: { armor: '#5b665c', armorDark: '#2f3828', armorLight: '#9ba79f', accent: '#4c532d', glow: '#8ef05a' },
};

export const TOWER_SPEC = {
  gatling: { name: 'GATLING', tag: '转管机枪', dmg: 6, dps: 24, rpm: 240 },
  mortar: { name: 'MORTAR', tag: '迫击炮', dmg: 34, dps: 17, rpm: 30 },
  missile: { name: 'MISSILE', tag: '导弹发射架', dmg: 48, dps: 24, rpm: 30 },
  tesla: { name: 'TESLA', tag: '电磁线圈', dmg: 22, dps: 44, rpm: 120 },
  flame: { name: 'FLAME', tag: '火焰喷射', dmg: 4, dps: 48, rpm: 720 },
  goo: { name: 'GOO', tag: '胶水炮', dmg: 8, dps: 13, rpm: 100 },
};

const TIER_MUL = [1, 1.08, 1.16];
/* 塔体起始高度 = 转盘上表面（0.44 + 0.165）。
   所有塔的「灵魂部件」都必须从这里往上长，否则会陷进基座里
   （第一版 mortar/tesla/flame/goo 从 y=0 开始，整塔只有 1.1 高）。 */
const Y0 = 0.63;

/* ---------------------------------------------------------------- 共用骨架 */
function plinth(M, s, lv) {
  const g = new THREE.Group();
  const R = 1.52 * s;

  // 八棱台座（上窄下宽）
  add(g, cylY(R, 0.30, 8, R * 0.93), M.armorDark, [0, 0.15, 0]);
  // 台面盖板（外沿露出一点，形成一圈亮边）
  add(g, cylY(R * 0.99, 0.055, 8, R * 0.99), M.armorLight, [0, 0.325, 0]);
  // 底部橡胶垫：塔「坐」在地上
  add(g, cylY(R * 1.02, 0.055, 8), M.rubber, [0, 0.026, 0]);
  // 警示斜纹带
  hazardBand(g, M.brass, M.armorDark, R * 0.965, 0.10, 12, (TAU / 12) * R * 0.92, 0.075, 0.055);
  // 台面螺栓圈
  boltRing(g, M.brassDark, 12, R * 0.80, 0.036, 0.030, [0, 0.355, 0], 'Y');
  // 深色腰环：基座与炮体之间的阴影缝，层次感的来源
  add(g, cylY(R * 0.78, 0.085, 28), M.steelDark, [0, 0.385, 0]);
  return g;
}

function turntable(M, s, lv, Rg = 1.10, teeth = 28) {
  const g = new THREE.Group();
  g.position.y = 0.44;
  Rg *= s;
  add(g, cylY(Rg, 0.16, 36), M.armor, [0, 0.06, 0]);
  // 齿圈：让「会转」这件事在外观上成立
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU;
    add(g, rbox(0.062, 0.085, 0.10, 0.012), M.steel,
      [Math.sin(a) * (Rg + 0.028), 0.045, Math.cos(a) * (Rg + 0.028)], [0, a, 0]);
  }
  add(g, cylY(Rg * 0.93, 0.05, 36), M.armorLight, [0, 0.165, 0]);
  return g;
}

function bodyBlock(g, M, w, h, d, y0, zOff = 0) {
  // 主体 + 缩进的顶盖 + 腰部深色带 + 前倾装甲板
  add(g, rbox(w, h, d * 0.72, 0.13), M.armor, [0, y0 + h / 2, zOff - d * 0.10]);
  add(g, rbox(w * 0.86, h * 0.92, d * 0.40, 0.15), M.armor, [0, y0 + h * 0.47, zOff + d * 0.30]);
  add(g, rbox(w * 0.88, 0.075, d * 0.72, 0.03), M.armorLight, [0, y0 + h + 0.02, zOff - d * 0.10]);
  add(g, rbox(w * 0.56, 0.045, d * 0.42, 0.02), M.armorLight, [0, y0 + h + 0.075, zOff - d * 0.12]);
  add(g, rbox(w * 1.015, 0.085, d * 0.74, 0.02), M.armorDark, [0, y0 + h * 0.34, zOff - d * 0.10]);
  // 前倾装甲板（接高光的关键面）
  add(g, rbox(w * 0.80, 0.50, 0.075, 0.03), M.armorLight,
    [0, y0 + h * 0.62, zOff + d * 0.44], [-16 * DEG, 0, 0]);
  // 侧面装甲裙：制造第二层轮廓
  for (const sg of [-1, 1]) {
    add(g, rbox(0.055, h * 0.50, d * 0.52, 0.02), M.armorDark,
      [sg * (w / 2 - 0.012), y0 + h * 0.36, zOff]);
  }
}

function hatch(g, M, w, h, y0, zOff, r = 0.235) {
  // 两侧圆形舱盖：圆 vs 方的对比，最显眼的识别特征
  for (const sg of [-1, 1]) {
    const hx = sg * (w / 2 + 0.010);
    const hz = zOff - 0.12;
    const hy = y0 + h * 0.56;
    add(g, cylY(r, 0.055, 24), M.steel, [hx, hy, hz], [0, 0, Math.PI / 2]);
    add(g, cylY(r * 0.79, 0.045, 24), M.steelLight, [hx + sg * 0.045, hy, hz], [0, 0, Math.PI / 2]);
    add(g, cylY(r * 0.31, 0.035, 16), M.brass, [hx + sg * 0.070, hy, hz], [0, 0, Math.PI / 2]);
    boltRing(g, M.brassDark, 6, r * 0.66, 0.020, 0.028,
      [hx + sg * 0.040, hy, hz], 'X');
  }
}

function sightLens(g, M, x, y, z) {
  add(g, cylY(0.088, 0.20, 16), M.steelDark, [x, y, z]);
  if (M.lens) add(g, cylY(0.062, 0.045, 16), M.lens, [x, y + 0.11, z]);
  else add(g, cylY(0.062, 0.045, 16), M.red, [x, y + 0.11, z]);
}

/* ================================================================ 1. 加特林 */
function gatling(g, M, lv) {
  const s = TIER_MUL[lv];
  const W = 1.24 * s, H = 0.80 * s, D = 1.46 * s;
  const y0 = 0.63;
  bodyBlock(g, M, W, H, D, y0);
  hatch(g, M, W, H, y0, 0);

  // 顶部警示灯
  add(g, cylY(0.115, 0.06, 16), M.red, [-W * 0.26, y0 + H + 0.10, -D * 0.34]);
  add(g, cylY(0.070, 0.05, 14), M.glow || M.warn, [-W * 0.26, y0 + H + 0.15, -D * 0.34]);
  boltRing(g, M.brassDark, 6, 0.10, 0.020, 0.030, [-W * 0.26, y0 + H + 0.09, -D * 0.34], 'Y');

  // 炮盾
  const gy = y0 + H * 0.55;
  add(g, rbox(W * 0.52, H * 0.52, 0.34, 0.10), M.armor, [0, gy, D * 0.46]);
  boltRing(g, M.brassDark, 8, W * 0.20, 0.024, 0.030, [0, gy, D * 0.63], 'Z');

  // 枪簇
  const NB = [4, 6, 8][lv];
  const RAD = [0.215, 0.27, 0.345][lv];
  const EXT = [0.82, 1.02, 1.20][lv];
  const z0 = D * 0.46 + 0.16;
  const order = [...Array(NB).keys()].sort((a, b) => Math.cos(a / NB * TAU) - Math.cos(b / NB * TAU));
  for (const i of order) {
    const a = (i / NB) * TAU;
    const v = Math.sin(a) * RAD;
    const w = Math.cos(a) * RAD * 0.94;
    const bg = new THREE.Group();
    bg.position.set(v, gy + w, z0);
    g.add(bg);
    add(bg, cylZ(0.055, EXT, 12, 0.048), M.steel, [0, 0, EXT / 2]);
    add(bg, cylZ(0.062, 0.05, 12), M.steelLight, [0, 0, EXT + 0.02]);
  }
  // 轴心
  add(g, cylZ(RAD * 0.56, EXT * 0.80, 18), M.steelDark, [0, gy, z0 + EXT * 0.35]);

  // 2 级起：散热套筒
  if (lv >= 1) {
    add(g, cylZ(RAD + 0.20, EXT * 0.34, 20), M.armorDark, [0, gy, z0 + EXT * 0.22]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      add(g, rbox(0.030, 0.030, EXT * 0.24, 0.008), M.steelDark,
        [Math.sin(a) * (RAD + 0.19), gy + Math.cos(a) * (RAD + 0.19), z0 + EXT * 0.22]);
    }
  }
  // 3 级起：弹链 + 副枪
  if (lv >= 2) {
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      add(g, rbox(0.070, 0.055, 0.045, 0.014), M.brass,
        [-(W / 2 + 0.03), gy - 0.26 + Math.sin(t * Math.PI) * 0.10, z0 - 0.30 + t * 0.36],
        [0, -0.2 + t * 0.85, 0]);
    }
    add(g, cylZ(0.026, 0.34, 10), M.steel, [W / 2 + 0.10, gy + 0.02, 0.14]);
  }
  sightLens(g, M, -W * 0.26, y0 + H + 0.16, D * 0.22);
  // 天线
  add(g, cylY(0.020, 0.62, 8, 0.012), M.steelDark, [-W * 0.30, y0 + H + 0.36, -D * 0.44], [0.10, 0, 0]);
  add(g, new THREE.SphereGeometry(0.035, 10, 8), M.glow || M.warn, [-W * 0.30, y0 + H + 0.68, -D * 0.47]);
  return { muzzle: [0, gy, z0 + EXT + 0.1], shells: NB };
}

/* ================================================================ 2. 迫击炮 */
function mortar(g, M, lv) {
  const s = TIER_MUL[lv];
  const R = 1.02 * s;
  // 大回转盘（灵魂部件之一）
  add(g, cylY(R, 0.10, 32), M.accent, [0, Y0 + 0.05, 0]);
  add(g, cylY(R * 0.84, 0.06, 32), M.armorLight, [0, Y0 + 0.12, 0]);
  boltRing(g, M.brassDark, 10, R * 0.90, 0.032, 0.032, [0, Y0 + 0.15, 0], 'Y');

  // 炮座本体：方形块 + 前倾装甲板（和别的塔一致的「三层」语言）
  const BH = 0.52 * s;
  add(g, rbox(0.96 * s, BH, 0.92 * s, 0.08), M.armor, [0, Y0 + 0.15 + BH / 2, 0]);
  add(g, rbox(0.84 * s, 0.05, 0.80 * s, 0.02), M.armorLight, [0, Y0 + 0.15 + BH + 0.02, 0]);
  add(g, rbox(0.90 * s, 0.075, 0.86 * s, 0.02), M.armorDark, [0, Y0 + 0.15 + BH * 0.42, 0]);
  add(g, rbox(0.80 * s, 0.34, 0.075, 0.03), M.armorLight,
    [0, Y0 + 0.15 + BH * 0.70, 0.46 * s], [-16 * DEG, 0, 0]);
  // 两侧液压支腿
  for (const sg of [-1, 1]) {
    add(g, cylY(0.050, 0.40, 12), M.steelLight,
      [sg * 0.42 * s, Y0 + 0.28, -0.10], [0, 0, sg * 0.34]);
    add(g, cylY(0.070, 0.34, 12), M.accent,
      [sg * 0.56 * s, Y0 + 0.20, -0.10], [0, 0, sg * 0.34]);
  }

  // 炮管：上仰 34°（迫击炮的高仰角才认得出来）
  const ang = 34 * DEG;
  const L = [1.02, 1.14, 1.26][lv] * s;
  const R0 = [0.135, 0.148, 0.162][lv];
  const pivot = new THREE.Group();
  pivot.position.set(0, Y0 + 0.15 + BH + 0.06, 0.10);
  pivot.rotation.x = -ang;
  g.add(pivot);
  add(pivot, cylZ(R0 * 1.34, L * 0.28, 18), M.steelDark, [0, 0, L * 0.14]);
  add(pivot, cylZ(R0, L, 20, R0 * 0.94), M.steelDark, [0, 0, L * 0.5]);
  // 红箍（设计稿的识别色）
  for (const t of [0.34, 0.52]) {
    add(pivot, ringZ(R0 * 1.17, R0 * 0.22, 20), M.red, [0, 0, L * t]);
  }
  add(pivot, cylZ(R0 * 1.18, 0.09, 20), M.steel, [0, 0, L * 0.97]);
  add(pivot, cylZ(R0 * 0.80, 0.05, 18), M.bore, [0, 0, L * 1.02]);
  // 炮口内膛的支撑环
  boltRing(pivot, M.brassDark, 8, R0 * 1.3, R0 * 0.13, 0.05, [0, 0, L * 0.86], 'Z');

  // 弹盘（左侧）
  add(g, cylY(0.19, 0.12, 20), M.accent, [-R * 0.92, Y0 + 0.34, -0.10], [0, 0, Math.PI / 2]);
  boltRing(g, M.brassDark, 6, 0.14, 0.022, 0.03, [-R * 0.92, Y0 + 0.34, -0.10], 'X');

  // 2 级起：观瞄镜
  if (lv >= 1) {
    add(g, cylZ(0.052, 0.26, 14), M.steelDark, [0.26, Y0 + 0.62, 0.10]);
    add(g, cylZ(0.040, 0.05, 14), M.lens || M.glow, [0.26, Y0 + 0.62, 0.24]);
  }
  // 3 级起：侧装甲板
  if (lv >= 2) {
    for (const sg of [-1, 1]) {
      add(g, rbox(0.05, 0.26, 0.44, 0.02), M.armorDark,
        [sg * 0.50 * s, Y0 + 0.40, 0.10]);
    }
  }
  const py = Y0 + 0.15 + BH + 0.06;
  return { muzzle: [0, py + Math.sin(ang) * L, 0.10 + Math.cos(ang) * L], shells: 1 };
}

/* ================================================================ 3. 导弹 */
function missile(g, M, lv) {
  const s = TIER_MUL[lv];
  const W = 1.18 * s, H = 0.80 * s, D = 1.40 * s;
  const y0 = 0.63;
  bodyBlock(g, M, W, H, D, y0);
  // 摇架
  const z0 = -D * 0.10;
  const gz = y0 + H + 0.10;
  add(g, rbox(W * 0.62, 0.30, D * 0.44, 0.07), M.accent, [0, gz + 0.12, z0]);

  const ROWS = [2, 3, 4][lv];
  const PIT = 0.30;
  const U0 = -0.05, U1 = 0.92;
  const WH = 0.16 + ROWS * 0.20;

  // 左右两台并列弹箱
  for (const [vA, vB] of [[-0.62, -0.09], [0.09, 0.62]]) {
    const vc = (vA + vB) / 2;
    // 底板
    add(g, rbox(U1 - U0, vB - vA, 0.055, 0.02), M.armorDark,
      [(U0 + U1) / 2, gz + 0.26, vc], [0, 0, 0]);
    // 侧壁
    for (const vv of [vA, vB]) {
      add(g, rbox(U1 - U0, 0.075, WH, 0.02),
        vv < 0 ? M.armor : M.accent, [(U0 + U1) / 2, gz + 0.26 + WH / 2, vv]);
    }
    // 后壁
    add(g, rbox(0.075, vB - vA, WH, 0.02), M.armorDark,
      [U0, gz + 0.26 + WH / 2, vc]);
    // 弹体：ROWS 排 × 3 发
    for (let r = 0; r < ROWS; r++) {
      const wy = gz + 0.32 + r * 0.19;
      for (let i = 0; i < 3; i++) {
        const vp = vA + (vB - vA) * (i + 0.5) / 3;
        add(g, cylY(0.052, 0.72, 12), M.steelLight, [(U0 + U1) / 2 + 0.06, wy, vp], [0, 0, Math.PI / 2]);
        // 红色弹头
        add(g, coneY(0.052, 0.006, 0.16, 12), M.red, [U1 + 0.14, wy, vp], [0, 0, -Math.PI / 2]);
      }
    }
  }
  // 外侧钢面板
  add(g, rbox(0.54, 0.075, 0.40, 0.02), M.steelDark, [0.02, gz + 0.10, -0.62]);
  boltRing(g, M.brassDark, 4, 0.14, 0.022, 0.03, [0.02, gz + 0.10, -0.66], 'Z');

  // 2 级起：雷达盘（右侧）
  if (lv >= 1) {
    add(g, cylY(0.022, 0.34, 8), M.steelDark, [0.10, gz + 0.55, 0.60]);
    const dish = add(g, new THREE.SphereGeometry(0.20, 20, 12, 0, TAU, 0, Math.PI / 2.6),
      M.armorLight, [0.10, gz + 0.70, 0.60], [Math.PI, 0, 0]);
    add(g, new THREE.SphereGeometry(0.032, 10, 8), M.glow || M.warn, [0.10, gz + 0.80, 0.60]);
  }
  // 3 级起：侧裙 + 前向观瞄
  if (lv >= 2) {
    for (const sg of [-1, 1]) {
      add(g, rbox(0.05, 0.22, 0.46, 0.02), M.armorDark, [sg * (W / 2 + 0.02), y0 + H * 0.42, 0.06]);
    }
    add(g, cylZ(0.075, 0.20, 14), M.steelDark, [0, gz + 0.30, U1 + 0.22]);
    add(g, cylZ(0.055, 0.04, 14), M.lens || M.glow, [0, gz + 0.30, U1 + 0.34]);
  }
  return { muzzle: [0, gz + 0.36, U1 + 0.3], shells: 2 };
}

/* ================================================================ 4. 电磁 */
function tesla(g, M, lv) {
  const s = TIER_MUL[lv];
  const R = 0.82 * s;
  const ZH = [1.18, 1.34, 1.50][lv];
  const B = Y0;                        // 鼓身底面 = 转盘顶面

  // 鼓座
  add(g, cylY(R * 1.12, 0.09, 28), M.armorDark, [0, B + 0.045, 0]);
  add(g, cylY(R * 1.06, 0.045, 28), M.armorLight, [0, B + 0.10, 0]);
  boltRing(g, M.brassDark, 12, R * 1.0, 0.030, 0.03, [0, B + 0.11, 0], 'Y');

  // 钢鼓线圈
  add(g, cylY(R, ZH, 32), M.armor, [0, B + 0.13 + ZH / 2, 0]);
  // 竖条加强筋
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    add(g, rbox(0.070, ZH * 0.86, 0.070, 0.012), M.armorDark,
      [Math.sin(a) * (R + 0.01), B + 0.13 + ZH / 2, Math.cos(a) * (R + 0.01)], [0, a, 0]);
  }
  // 线圈环（逐级加圈）
  const NR = 3 + 2 * lv;
  for (let i = 0; i < NR; i++) {
    const y = B + 0.24 + i * (ZH - 0.22) / Math.max(1, NR - 1);
    add(g, ringY(R + 0.035, 0.040, 32), i % 2 ? M.steelLight : M.steel, [0, y, 0]);
    add(g, cylY(R + 0.02, 0.028, 32), M.accent, [0, y + 0.040, 0]);
  }
  // 顶盖
  const TY = B + 0.13 + ZH;
  add(g, cylY(R * 0.98, 0.075, 32), M.accent, [0, TY + 0.04, 0]);
  boltRing(g, M.brassDark, 10, R * 0.80, 0.030, 0.032, [0, TY + 0.09, 0], 'Y');

  // 等离子球（灵魂部件）
  const BR = 0.26 + 0.032 * lv;
  const BY = TY + 0.40;
  add(g, cylY(0.058, 0.24, 12), M.steelDark, [0, TY + 0.20, 0]);
  add(g, new THREE.SphereGeometry(BR, 24, 16), M.glow || M.armorLight, [0, BY, 0]);
  add(g, ringY(BR * 1.36, 0.020, 32), M.steelLight, [0, BY, 0]);

  // 环绕电缆
  for (let i = 0; i < 3; i++) {
    const rg = new THREE.TorusGeometry(R + 0.09, 0.019, 6, 26);
    rg.rotateY(74 * DEG + i * 0.12);
    add(g, rg, M.steelDark, [0, B + ZH * (0.42 + i * 0.20), 0]);
  }
  // 3 级起：电极爪
  if (lv >= 2) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      add(g, coneY(0.028, 0.008, 0.16, 8), M.steelLight,
        [Math.sin(a) * BR * 1.75, BY + 0.05, Math.cos(a) * BR * 1.75],
        [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]);
    }
  }
  return { muzzle: [0, BY, 0.34], shells: 1, emitters: ['orb'] };
}

/* ================================================================ 5. 火焰 */
function flame(g, M, lv) {
  const s = TIER_MUL[lv];
  const RL = 0.44 * s;
  const LL = [1.02, 1.16, 1.28][lv];
  const PH = 0.40;                    // 罐体支架高度
  const ty = Y0 + PH + RL;            // 罐轴高度

  // 支架：三条腿 + 底座板（卧式罐要架起来才像罐车/加压站）
  add(g, cylY(0.72 * s, 0.07, 24), M.armorDark, [0, Y0 + 0.035, 0]);
  add(g, rbox(1.10 * s, 0.07, 0.86 * s, 0.02), M.armor, [0, Y0 + PH, 0]);
  for (const [px, pz] of [[-0.34, 0.26], [0.34, 0.26], [0, -0.30]]) {
    add(g, cylY(0.045, PH - 0.04, 10), M.steelDark,
      [px * s, Y0 + PH / 2, pz * s]);
  }

  // 卧式燃料罐（灵魂部件，炮体就是一只罐子）
  add(g, cylX(RL, LL, 26), M.armor, [0, ty, 0]);
  for (const sg of [-1, 1]) {
    const cap = new THREE.SphereGeometry(RL, 20, 14);
    cap.scale(0.5, 1, 1);
    add(g, cap, M.accent, [sg * LL / 2, ty, 0]);
  }
  // 箍带
  for (const t of [-0.28, 0.28]) {
    add(g, ringY(RL + 0.02, 0.030, 26), M.armorDark, [t * LL, ty, 0], [0, 0, Math.PI / 2]);
  }
  // 罐顶装甲板
  add(g, rbox(LL * 0.66, 0.05, RL * 1.22, 0.02), M.armorLight, [0, ty + RL, 0]);

  // 喷管：粗、短、多重环
  const U0 = LL / 2 + RL * 0.2;
  const LN = [0.54, 0.64, 0.74][lv];
  const RB = 0.19 + 0.022 * lv;
  add(g, cylZ(RB * 1.14, LN, 22, RB * 0.86), M.accent, [0, ty, U0 + LN / 2]);
  for (let i = 0; i < 3; i++) {
    add(g, ringZ(RB * (1.07 - i * 0.03), 0.028, 22), M.armorDark,
      [0, ty, U0 + LN * (0.18 + i * 0.30)]);
  }
  add(g, cylZ(RB * 0.86, 0.05, 22), M.bore, [0, ty, U0 + LN + 0.02]);
  // 引火苗
  add(g, new THREE.SphereGeometry(0.056, 14, 10), M.glow || M.warn, [0, ty, U0 + LN + 0.07]);

  // 侧面增压罐
  for (const sg of [-1, 1]) {
    add(g, cylX(0.095, 0.42, 14), M.steelDark, [-0.14, ty - RL * 0.52, sg * (RL + 0.10)]);
    add(g, cylX(0.052, 0.05, 12), M.brass, [-0.14 + 0.23, ty - RL * 0.52, sg * (RL + 0.10)]);
  }
  // 2 级起：侧装甲裙
  if (lv >= 1) {
    for (const sg of [-1, 1]) {
      add(g, rbox(LL * 0.54, 0.18, 0.05, 0.02), M.armorDark,
        [0, ty - RL * 0.72, sg * (RL * 0.88)]);
    }
  }
  // 3 级起：副喷口
  if (lv >= 2) {
    add(g, cylZ(RB * 0.58, LN * 0.62, 16), M.accent,
      [0.16, ty - RL * 0.80, U0 + LN * 0.5]);
  }
  return { muzzle: [0, ty, U0 + LN + 0.1], shells: 1 };
}

/* ================================================================ 6. 胶水 */
function goo(g, M, lv) {
  const s = TIER_MUL[lv];
  const R = 0.74 * s;
  const ZH = [0.86, 0.98, 1.10][lv];
  const B = Y0 + 0.10;                // 罐体底面（留一圈底座）

  // 底座圈
  add(g, cylY(R * 1.10, 0.10, 28), M.armorDark, [0, Y0 + 0.05, 0]);
  boltRing(g, M.brassDark, 10, R * 1.0, 0.028, 0.03, [0, Y0 + 0.10, 0], 'Y');

  // 罐体（矮胖，主视觉让给天线）
  add(g, cylY(R, ZH, 30), M.armor, [0, B + ZH / 2, 0]);
  add(g, cylY(R * 0.94, 0.06, 30), M.accent, [0, B + ZH + 0.02, 0]);
  boltRing(g, M.brassDark, 9, R * 0.78, 0.026, 0.030, [0, B + ZH + 0.05, 0], 'Y');
  // 液位窗（侧面发光带）
  for (let i = 0; i < 4; i++) {
    add(g, rbox(0.052, 0.15, 0.032, 0.008), M.glow || M.warn,
      [-0.19 + i * 0.125, B + ZH * 0.52, -(R + 0.012)]);
  }

  // 碟形天线：仰角 40°（灵魂部件）
  const ang = 40 * DEG;
  const PZ = B + ZH + 0.06;
  const ARM = [0.44, 0.52, 0.58][lv];
  const DR = [0.32, 0.37, 0.42][lv];
  const tipY = PZ + Math.sin(ang) * ARM;
  const tipZ = Math.cos(ang) * ARM;
  // 支臂
  add(g, cylZ(0.046, ARM, 12), M.steelDark,
    [0, PZ + Math.sin(ang) * ARM / 2, Math.cos(ang) * ARM / 2], [-(90 * DEG - ang), 0, 0]);
  // 支臂根部的万向节
  add(g, new THREE.SphereGeometry(0.075, 14, 10), M.steel, [0, PZ, 0]);
  // 碟面
  const dish = new THREE.SphereGeometry(DR, 24, 14);
  dish.scale(1, 1, 0.26);
  add(g, dish, M.armorLight, [0, tipY, tipZ], [-(90 * DEG - ang), 0, 0]);
  const dishIn = new THREE.SphereGeometry(DR * 0.74, 20, 12);
  dishIn.scale(1, 1, 0.20);
  add(g, dishIn, M.steelLight, [0, tipY, tipZ], [-(90 * DEG - ang), 0, 0]);
  // 碟背加强筋
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    add(g, rbox(0.030, DR * 0.7, 0.028, 0.008), M.armorDark,
      [Math.cos(a) * DR * 0.42, tipY - Math.sin(0) * DR * 0.4, tipZ - 0.06],
      [-(90 * DEG - ang), 0, 0]);
  }
  // 焦点球 + 三根支撑
  const FX = tipZ + Math.cos(ang) * DR * 0.9;
  const FY = tipY + Math.sin(ang) * DR * 0.9;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    add(g, cylZ(0.012, DR * 1.02, 6), M.steelDark,
      [Math.cos(a) * DR * 0.5, tipY + Math.sin(ang) * DR * 0.45 + Math.sin(a) * DR * 0.4,
        tipZ + Math.cos(ang) * DR * 0.45], [-(90 * DEG - ang), 0, 0]);
  }
  const FR = 0.10 + 0.014 * lv;
  add(g, new THREE.SphereGeometry(FR, 18, 12), M.glow || M.armorLight, [0, FY, FX]);
  add(g, ringZ(FR * 1.5, 0.014, 24), M.steelLight, [0, FY, FX], [-(90 * DEG - ang), 0, 0]);

  // 2 级起：副碟
  if (lv >= 1) {
    const sd = new THREE.SphereGeometry(DR * 0.46, 18, 10);
    sd.scale(1, 1, 0.24);
    add(g, sd, M.accent, [0, tipY + 0.12, tipZ - 0.14], [-(90 * DEG - ang), 0, 0]);
  }
  // 3 级起：侧副天线
  if (lv >= 2) {
    add(g, cylZ(0.028, 0.40, 10), M.steelDark, [0.24, B + ZH + 0.20, -0.10], [-52 * DEG, 0, 0]);
    add(g, new THREE.SphereGeometry(0.042, 10, 8), M.glow || M.warn,
      [0.24, B + ZH + 0.40, 0.22]);
  }
  return { muzzle: [0, FY, FX + FR * 1.4], shells: 1 };
}

/* ---------------------------------------------------------------- 组装 */
const BUILDERS = { gatling, mortar, missile, tesla, flame, goo };

export function buildTower(key, lv, M) {
  const root = new THREE.Group();
  const base = plinth(M, TIER_MUL[lv], lv);
  root.add(base);

  /* yaw 组的原点就是世界原点：转台 (y=0.44) 和炮体 (y0=0.63) 都用绝对高度，
     这样 bob / 后坐只会叠很小的偏移，不会把整塔抬起来。 */
  const yaw = new THREE.Group();
  yaw.add(turntable(M, TIER_MUL[lv], lv,
    key === 'mortar' ? 1.14 : key === 'tesla' ? 1.02 : 1.10,
    key === 'mortar' ? 34 : 28));

  const body = new THREE.Group();
  yaw.add(body);
  const out = BUILDERS[key](body, M, lv);

  root.add(yaw);
  return { root, base, yaw, body, spec: out, level: lv, key };
}

export function towerStats(key, lv) {
  const s = TOWER_SPEC[key];
  const mul = [1, 1.85, 3.1][lv];
  return {
    name: s.name, tag: s.tag,
    dmg: Math.round(s.dmg * mul),
    dps: Math.round(s.dps * mul),
    rpm: Math.round(s.rpm * (1 + lv * 0.12)),
  };
}
