/* ============================================================
   r3d/towers.js — 6 座炮塔 × 3 级

   造型规则（从设计稿反推，全部单位通用）：
     1. 三段式：石台座 → 深色腰环（一道阴影缝）→ 炮体。
        没有那道缝，整座塔会糊成一个色块。
     2. 基座直径 ≈ 炮体宽 × 2.2。太窄头重脚轻，太宽像个盘子。
     3. 所有棱边倒角。90° 硬边在 PBR 下必死黑。
     4. 每座塔只有一个「灵魂特征」，必须伸出轮廓外：
        机枪=旋转枪管簇 / 迫击炮=长炮管 / 导弹=并列发射箱 /
        电磁=等离子球 / 火焰=粗喷管 / 胶水=斜置碟形天线。
     5. 等级差异体现在**几何**上，不只是数值：加长、加粗、增加副件。
        玩家升级时必须一眼看出变化。

   坐标系：+Z 是炮口方向，+Y 向上，原点在格子中心的地面。
   1 单位 = 1 画布像素。
   ============================================================ */
import * as THREE from 'three';
import {
  rbox, box, cyl, cylZ, cylX, sphere, dome, cone, torus, ringFlat,
  lathe, tubeBetween, Kit, DEG,
} from './geo.js';
import { makeMaterials } from './core.js';

/* ---------------------------------------------------------------- 配色 */

export const TOWER_PAL = {
  gatling: {
    armor: '#50582b', armorDark: '#2b3120', armorLight: '#8b9260',
    accent: '#5c6256', glass: '#9de0c0', glow: '#7dffb0', red: '#b3261e',
  },
  mortar: {
    armor: '#5d6558', armorDark: '#2f352a', armorLight: '#8c916c',
    accent: '#52552c', glass: '#ffd08a', glow: '#ffb347', red: '#c1272d',
  },
  missile: {
    armor: '#5b6259', armorDark: '#2b3129', armorLight: '#8f8f6d',
    accent: '#515030', glass: '#ffb08a', glow: '#ff6a3c', red: '#b3261e',
  },
  tesla: {
    armor: '#254f5f', armorDark: '#132c36', armorLight: '#6f9499',
    accent: '#546561', glass: '#a6e2ef', glow: '#8fd8ff', red: '#b3261e',
  },
  flame: {
    armor: '#585a29', armorDark: '#2b3018', armorLight: '#979b5e',
    accent: '#32371a', glass: '#ffc08a', glow: '#ff9a2e', red: '#b3261e',
  },
  goo: {
    armor: '#5b665c', armorDark: '#2c352c', armorLight: '#9ba79f',
    accent: '#4c532d', glass: '#b6ff8a', glow: '#8ef05a', red: '#b3261e',
  },
};

const TIER_BASE = [1.00, 1.045, 1.09];
const TIER_BODY = [1.00, 1.12, 1.24];

/* ---------------------------------------------------------------- 公共台座 */

/**
 * 石台座。所有塔共用同一套结构，只在尺寸上微调 ——
 * 统一感来自台座，个性来自炮体，这是原作的做法。
 */
function plinth(M, scale, lv) {
  const kit = new Kit();
  const R = 34 * scale;

  /* 最底层：略大一圈的地脚，压住地面 */
  kit.add(cyl(R * 1.02, R * 0.94, 4.5, 8), M.stoneDark, [0, -0.6, 0], [0, Math.PI / 8, 0]);

  /* 主台座：八边形，比圆柱更有"工事"感 */
  kit.add(cyl(R, R * 1.03, 9, 8), M.stone, [0, 5.6, 0], [0, Math.PI / 8, 0]);

  /* 台座腰线（凹进去一圈深色） */
  kit.add(cyl(R * 0.98, R * 0.98, 2.2, 8), M.stoneDark, [0, 11.2, 0], [0, Math.PI / 8, 0]);

  /* 台面 */
  kit.add(cyl(R * 0.94, R * 0.97, 2.6, 8), M.stone, [0, 12.8, 0], [0, Math.PI / 8, 0]);

  /* 一圈螺栓：设计稿里台座边缘最典型的小零件 */
  kit.bolts([0, 13.9, 0], R * 0.86, 8, 1.5, 1.1, M.brassDark, 'y', Math.PI / 8);

  /* 四块踏板 + 黄铜包角：让台座有"被踩过"的重量感 */
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    kit.add(rbox(R * 0.42, 1.6, 6, 0.5), M.steelDark,
      [Math.cos(a) * R * 0.72, 13.4, Math.sin(a) * R * 0.72], [0, -a, 0]);
  }

  /* 台座编号铭牌：一小片黄铜，提供尺度和材质对比 */
  kit.add(rbox(7, 4, 0.8, 0.25), M.brass, [0, 7.6, R * 0.99], [0, 0, 0]);

  /* 等级刻线：1/2/3 道，升级后能直接数出来 */
  for (let i = 0; i <= lv; i++) {
    const a = -0.24 + i * 0.20;
    kit.add(box(1.4, 0.5, 1.8), M.glow,
      [Math.sin(a) * R * 1.0, 6.2, Math.cos(a) * R * 1.0], [0, 0, 0]);
  }

  return kit.group('plinth');
}

/* ================================================================ 1. 机枪 */

function gatling(M, lv) {
  const S = TIER_BODY[lv];
  const kit = new Kit();
  const Y0 = 14;               // 台面高度

  /* ---- 炮体：低矮的装甲箱 ---- */
  const BW = 26 * S, BH = 15 * S, BD = 26 * S;
  kit.add(rbox(BW, BH, BD, 2.4), M.armor, [0, Y0 + BH / 2, 0]);

  /* 侧面装甲板（凸出一层，边缘吃高光） */
  for (const sx of [-1, 1]) {
    kit.plate(2.2, BH * 0.66, BD * 0.82, M.armorLight,
      [sx * (BW / 2 + 0.6), Y0 + BH * 0.52, 0], [0, 0, 0]);
  }
  /* 顶盖 */
  kit.plate(BW * 0.86, 2.0, BD * 0.78, M.armorLight, [0, Y0 + BH + 0.4, 0]);

  /* ---- 红色舱门（设计稿的识别特征） ---- */
  const hx = -BW / 2 - 0.4;
  kit.add(rbox(1.2, 7.5, 7.5, 0.5), M.red, [hx, Y0 + BH * 0.46, 2]);
  for (const dz of [-2, 2]) {
    kit.add(sphere(1.5, 8, 6), M.red, [hx - 0.5, Y0 + BH * 0.46 + 1.6, 2 + dz], null, [1, 1, 0.5]);
  }
  kit.add(cone(2.6, 3.4, 8), M.red, [hx - 0.5, Y0 + BH * 0.40 - 1.4, 2], [Math.PI / 2, 0, 0]);

  /* ---- 弹鼓（右侧） ---- */
  const drumR = 7.4 + lv * 0.9;
  kit.add(cylX(drumR, drumR, 11 + lv * 2, 16), M.accent, [BW / 2 + 0.5, Y0 + BH * 0.55, -3]);
  kit.add(cylX(drumR * 0.55, drumR * 0.55, 12.4 + lv * 2, 12), M.steelDark, [BW / 2 + 0.6, Y0 + BH * 0.55, -3]);
  kit.bolts([BW / 2 + 6.2, Y0 + BH * 0.55, -3], drumR * 0.62, 6, 1.0, 1.4, M.brass, 'x');

  /* ---- 黄铜弹链：从弹鼓绕到枪管簇 ---- */
  const beltPts = [
    [BW / 2 + 4, Y0 + BH * 0.9, -3],
    [BW / 2 + 5, Y0 + BH * 1.15, 2],
    [BW / 2 + 2, Y0 + BH * 1.3, 8],
    [BW * 0.30, Y0 + BH * 1.35, 12],
    [BW * 0.12, Y0 + BH * 1.32, 14],
  ];
  for (let i = 0; i < beltPts.length - 1; i++) {
    kit.put(tubeBetween(beltPts[i], beltPts[i + 1], 1.35, 6), M.brassDark);
  }
  /* 弹链上的弹壳（每节一颗，成本极低但细节密度提升明显） */
  for (let i = 0; i < beltPts.length - 1; i++) {
    const a = beltPts[i], b = beltPts[i + 1];
    for (let k = 1; k < 4; k++) {
      const t = k / 4;
      kit.add(cyl(0.75, 0.75, 2.6, 6), M.brass,
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t + 1.4], [Math.PI / 2, 0, 0]);
    }
  }

  /* ---- 枪管簇（会自转） ---- */
  const spin = new THREE.Group();
  spin.position.set(0, Y0 + BH * 0.95, BW * 0.35);
  const sk = new Kit();

  const NB = 6;
  const RING = 3.5;
  const LEN = 24 + lv * 3.5;
  for (let i = 0; i < NB; i++) {
    const a = (i / NB) * Math.PI * 2;
    const px = Math.cos(a) * RING, py = Math.sin(a) * RING;
    /* 枪管本体（深色钢） */
    sk.add(cylZ(0.95, 0.95, LEN, 8), M.steelDark, [px, py, LEN / 2]);
    /* 中段散热套 */
    sk.add(cylZ(1.5, 1.5, LEN * 0.34, 8), M.steel, [px, py, LEN * 0.42]);
    /* 枪口 */
    sk.add(cylZ(1.25, 1.25, 1.6, 8), M.steelLight, [px, py, LEN - 0.5]);
  }
  /* 前后固定环 */
  for (const zz of [LEN * 0.22, LEN * 0.62, LEN * 0.94]) {
    sk.add(cylZ(RING + 1.4, RING + 1.4, 1.8, 14, true), M.steel, [0, 0, zz]);
  }
  /* 中心轴 */
  sk.add(cylZ(1.6, 1.6, LEN * 0.9, 10), M.steelDark, [0, 0, LEN * 0.45]);

  if (lv >= 2) {
    /* 3 级：加装制退器（三片） */
    for (let i = 0; i < 3; i++) {
      sk.add(cylZ(RING + 2.6, RING + 2.6, 1.4, 14, true), M.steelDark, [0, 0, LEN * 0.76 + i * 3.2]);
    }
  }
  spin.add(sk.group('barrels'));

  /* ---- 枪管簇外壳：上半圈护罩（不旋转，遮住"背面"，让剪影更整） ---- */
  const shroud = new Kit();
  shroud.add(cylZ(RING + 2.6, RING + 2.0, 12, 14, true), M.armorDark, [0, Y0 + BH * 0.95, BW * 0.35 + 6]);
  shroud.grille([0, Y0 + BH * 0.95 + RING + 2.0, BW * 0.35 + 4], RING * 1.9, 8, 4, 1.2, M.armorDark, [0, 0, 0]);

  /* ---- 3 级：第二组枪管 + 侧挂弹箱 ---- */
  if (lv >= 2) {
    const spin2 = new THREE.Group();
    spin2.position.set(0, Y0 + BH * 0.42, BW * 0.3);
    const sk2 = new Kit();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      sk2.add(cylZ(0.8, 0.8, LEN * 0.72, 6), M.steelDark,
        [Math.cos(a) * 2.4, Math.sin(a) * 2.4, LEN * 0.36]);
    }
    sk2.add(cylZ(2.0, 2.0, 1.6, 12, true), M.steel, [0, 0, LEN * 0.7]);
    spin2.add(sk2.group('barrels2'));
    kit.add(rbox(9, 6, 12, 1.2), M.armorDark, [-BW * 0.34, Y0 + BH * 0.62, BW * 0.42]);
  } else {
    var spin2 = null;
  }

  return {
    kit, spin, spin2, shroud,
    muzzle: [0, Y0 + BH * 0.95, BW * 0.35 + LEN + 2],
    pitch: 0,
    anim: [],
  };
}

/* ================================================================ 2. 迫击炮 */

function mortar(M, lv) {
  const S = TIER_BODY[lv];
  const kit = new Kit();
  const Y0 = 14;

  /* ---- 大回转盘（灵魂特征之一：口径感） ---- */
  kit.add(cyl(28 * S, 29 * S, 5, 20), M.armor, [0, Y0 + 2.5, 0]);
  kit.add(cyl(24 * S, 26 * S, 3, 20), M.armorLight, [0, Y0 + 6.4, 0]);
  kit.bolts([0, Y0 + 7.9, 0], 21 * S, 12, 1.3, 1.0, M.brassDark, 'y');

  /* ---- 炮架 ---- */
  const BW = 22 * S;
  kit.add(rbox(BW, 12, BW * 0.9, 2.0), M.armor, [0, Y0 + 13, 0]);
  kit.plate(BW * 0.8, 1.6, BW * 0.7, M.armorLight, [0, Y0 + 19.6, 0]);

  /* ---- 两条液压支腿（黄铜活塞） ---- */
  for (const sx of [-1, 1]) {
    kit.add(cyl(2.6, 3.4, 16, 8), M.steelDark,
      [sx * 9, Y0 + 7, 6], [0.42, 0, sx * 0.30]);
    kit.add(cyl(1.7, 1.7, 12, 8), M.brass,
      [sx * 12.5, Y0 + 4.2, 11], [0.42, 0, sx * 0.30]);
    kit.add(cyl(3.6, 3.6, 2.0, 8), M.steelDark, [sx * 14.5, Y0 + 2.4, 14.4]);
  }

  /* ---- 炮管（上仰 26°，会俯仰） ---- */
  const pitch = new THREE.Group();
  pitch.position.set(0, Y0 + 16, 0);
  const ang = -26 * DEG;
  pitch.rotation.x = ang;
  const pk = new Kit();

  const L = 34 + lv * 6;
  const R = 4.0 + lv * 0.35;
  pk.add(cylZ(R * 1.5, R * 1.5, L * 0.22, 14), M.steelDark, [0, 0, L * 0.11]);  // 炮尾
  pk.add(cylZ(R, R * 1.1, L, 16), M.steelDark, [0, 0, L * 0.5]);
  /* 两道红箍 —— 设计稿里最醒目的识别色 */
  for (const t of [0.40, 0.62]) {
    pk.add(cylZ(R * 1.14, R * 1.14, 2.2, 16), M.red, [0, 0, L * t]);
  }
  pk.add(cylZ(R * 1.2, R * 1.2, 2.6, 16), M.steel, [0, 0, L * 0.98]);
  pk.add(cylZ(R * 0.86, R * 0.86, 1.0, 14), M.bore, [0, 0, L * 1.02]);

  /* 复进机（炮管下方的小油缸） */
  pk.add(cylZ(2.0, 2.0, L * 0.42, 10), M.steelLight, [0, -R - 2.2, L * 0.34]);
  pk.add(cylZ(1.1, 1.1, L * 0.5, 8), M.brass, [0, -R - 2.2, L * 0.58]);
  pitch.add(pk.group('tube'));

  /* ---- 弹盘（左侧，斜挂在架上） ---- */
  kit.add(cylX(8.5, 8.5, 5, 14), M.accent, [-BW * 0.85, Y0 + 14, -2], [0, 0, 0.2]);
  kit.bolts([-BW * 0.85 - 2.6, Y0 + 14, -2], 5.6, 6, 0.9, 1.2, M.brass, 'x');
  /* 三发待发弹 */
  for (let i = 0; i < 3; i++) {
    const a = -0.5 + i * 0.5;
    kit.add(cyl(1.5, 1.5, 7, 8), M.brassDark,
      [-BW * 0.85 + Math.cos(a) * 5, Y0 + 14 + Math.sin(a) * 5, 3.4], [Math.PI / 2, 0, 0]);
  }

  /* ---- 2 级起：观瞄镜 ---- */
  if (lv >= 1) {
    kit.add(cyl(1.6, 1.6, 9, 8), M.steelDark, [7.5, Y0 + 23, 2]);
    kit.add(cyl(2.0, 1.6, 3, 10), M.steelDark, [7.5, Y0 + 27, 4.2], [Math.PI / 2, 0, 0]);
    kit.add(cyl(1.7, 1.7, 0.7, 10), M.glass, [7.5, Y0 + 27, 5.8], [Math.PI / 2, 0, 0]);
  }
  /* ---- 3 级：侧装甲裙 + 第二对支腿 ---- */
  if (lv >= 2) {
    for (const sx of [-1, 1]) {
      kit.add(rbox(2.0, 8, 20, 0.8), M.armorDark, [sx * BW * 0.62, Y0 + 12, 0]);
      kit.add(cyl(2.0, 2.6, 13, 8), M.steelDark, [sx * 12, Y0 + 6, -8], [-0.5, 0, sx * 0.25]);
    }
  }

  /* 炮口世界位置（pitch 空间） */
  const mz = [0, Math.sin(-ang) * L, Math.cos(-ang) * L];
  return { kit, pitch, muzzle: mz, anim: [] };
}

/* ================================================================ 3. 导弹 */

function missile(M, lv) {
  const S = TIER_BODY[lv];
  const kit = new Kit();
  const Y0 = 14;

  /* ---- 底座回转环 ---- */
  kit.add(cyl(27 * S, 27 * S, 4, 20), M.armor, [0, Y0 + 2, 0]);
  kit.bolts([0, Y0 + 4.4, 0], 22 * S, 10, 1.3, 1.0, M.brassDark, 'y');

  /* ---- 炮体 ---- */
  const BW = 24 * S;
  kit.add(rbox(BW, 20 * S, BW, 2.2), M.armor, [0, Y0 + 4 + 10 * S, 0]);
  kit.plate(BW * 0.9, 1.8, BW * 0.9, M.armorLight, [0, Y0 + 4 + 20 * S + 0.6, 0]);

  /* ---- 液压升降臂 ---- */
  kit.add(cyl(2.4, 2.4, 14, 10), M.steelLight, [0, Y0 + 12, -6], [0.5, 0, 0]);
  kit.add(cyl(3.0, 3.0, 2.4, 10), M.brassDark, [0, Y0 + 9, -2]);

  /* ---- 两具并列发射箱（倾斜 22°） ---- */
  const rack = new THREE.Group();
  rack.position.set(0, Y0 + 16 * S + 3, -1);
  rack.rotation.x = -22 * DEG;
  const rk = new Kit();

  const BOXW = 10.5 * S, BOXH = 22 * S, BOXD = 20 * S;
  const rows = lv === 0 ? 2 : 3;
  for (const sx of [-1, 1]) {
    const cx = sx * (BOXW * 0.62 + 1.2);
    /* 箱体 */
    rk.add(rbox(BOXW, BOXH, BOXD, 1.8), M.armor, [cx, 0, 0]);
    /* 前面板 + 发射管口 */
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < 2; j++) {
        const oy = -BOXH * 0.28 + i * (BOXH * 0.28);
        const ox = cx + (j - 0.5) * BOXW * 0.4;
        const tubeR = BOXW * 0.17;
        rk.add(cyl(tubeR, tubeR, 2.0, 10), M.steelDark, [ox, oy, BOXD / 2 + 0.2], [Math.PI / 2, 0, 0]);
        rk.add(cyl(tubeR * 0.82, tubeR * 0.82, 1.2, 10), M.bore, [ox, oy, BOXD / 2 + 0.9], [Math.PI / 2, 0, 0]);
      }
    }
    /* 箱顶加强筋 */
    for (let i = 0; i < 3; i++) {
      rk.add(box(BOXW * 0.96, 1.0, 1.6), M.armorDark, [cx, BOXH / 2 - 1, -BOXD * 0.3 + i * BOXD * 0.3]);
    }
    /* 侧挂黄铜导轨 */
    rk.add(box(1.2, BOXH * 0.7, 2.0), M.brassDark, [cx + sx * (BOXW / 2 + 0.4), 0, BOXD * 0.2]);
  }

  /* ---- 2 级起：顶部雷达盘（会转） ---- */
  let radar = null;
  if (lv >= 1) {
    radar = new THREE.Group();
    radar.position.set(0, BOXH / 2 + 6, -BOXH * 0.1);
    const rad = new Kit();
    rad.add(cyl(1.2, 1.2, 5, 8), M.steelDark, [0, -2.5, 0]);
    /* 抛物面：压扁的球壳 */
    const dish = sphere(7.5, 18, 10, 0);
    dish.scale(1, 0.30, 1);
    rad.add(dish, M.steelLight, [0, 0, 0], [0.5, 0, 0]);
    rad.add(ringFlat(7.0, 7.6, 20), M.steel, [0, 0.4, 0], [-Math.PI / 2 + 0.5, 0, 0]);
    rad.add(sphere(1.1, 8, 6), M.glow, [0, 3.2, 1.6]);
    radar.add(rad.group('radar'));
  }

  rack.add(rk.group('rack'));

  /* 箱体合到 rack，rack 再挂到 kit 上（稍后统一加进 root） */
  return {
    kit, rack, radar, muzzle: [0, 0, 12], muzzleInRack: true,
    anim: [],
  };
}

/* ================================================================ 4. 电磁 */

function tesla(M, lv) {
  const S = TIER_BODY[lv];
  const kit = new Kit();
  const Y0 = 14;

  /* ---- 绝缘底座（深色陶瓷盘） ---- */
  kit.add(cyl(24 * S, 26 * S, 5, 20), M.armorDark, [0, Y0 + 2.5, 0]);
  kit.add(cyl(20 * S, 22 * S, 3, 20), M.accent, [0, Y0 + 6.2, 0]);

  /* ---- 钢鼓线圈 ---- */
  const R = 16 * S;
  const H = 30 + lv * 4;
  kit.add(cyl(R, R * 1.04, H, 20), M.armor, [0, Y0 + 7 + H / 2, 0]);

  /* 竖向加强筋 */
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    kit.add(box(2.0, H * 0.88, 2.4), M.armorDark,
      [Math.cos(a) * R, Y0 + 7 + H / 2, Math.sin(a) * R], [0, -a, 0]);
  }

  /* 线圈环：逐级加圈 */
  const NR = 4 + lv * 2;
  for (let i = 0; i < NR; i++) {
    const y = Y0 + 9 + i * (H - 5) / Math.max(1, NR - 1);
    kit.add(torus(R + 1.2, 1.5, 22, 7), M.steel, [0, y, 0], [Math.PI / 2, 0, 0]);
    kit.add(cyl(R + 0.4, R + 0.4, 1.2, 20), M.accent, [0, y + 2.0, 0]);
  }

  /* 顶盖 + 绝缘子堆 */
  const topY = Y0 + 7 + H;
  kit.add(cyl(R * 1.06, R, 2.6, 20), M.accent, [0, topY + 1.3, 0]);
  for (let i = 0; i < 3; i++) {
    kit.add(cyl(5.5 - i * 1.2, 6.4 - i * 1.2, 1.6, 12), M.steelLight, [0, topY + 3.4 + i * 2.2, 0]);
  }

  /* ---- 等离子球（灵魂特征，会脉动） ---- */
  const orbGroup = new THREE.Group();
  const OR = 7.4 + lv * 1.1;
  orbGroup.position.set(0, topY + 13 + OR * 0.6, 0);
  const ok = new Kit();
  ok.add(sphere(OR, 22, 16), M.glow, [0, 0, 0]);
  /* 外层玻璃罩（半透明，让球有"被封在罩里"的层次） */
  ok.add(sphere(OR * 1.35, 20, 14), M.glass, [0, 0, 0]);
  /* 三道赤道环 */
  for (let i = 0; i < 3; i++) {
    const t = torus(OR * 1.35, 0.8, 20, 6);
    ok.add(t, M.steelLight, [0, 0, 0], [i * 0.7, i * 0.5, 0]);
  }
  orbGroup.add(ok.group('orb'));

  /* ---- 环绕电缆 ---- */
  for (let i = 0; i < 3; i++) {
    const rg = torus(R + 3.0, 1.1, 20, 6, Math.PI * 1.35);
    kit.add(rg, M.steelDark, [0, Y0 + 12 + i * 7, 0], [Math.PI / 2 + 0.25, i * 1.1, 0.3]);
  }

  /* ---- 3 级：电极爪 ---- */
  if (lv >= 2) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      kit.add(cone(1.5, 7, 6), M.steelLight,
        [Math.cos(a) * OR * 1.5, topY + 13 + OR * 0.6 + 3, Math.sin(a) * OR * 1.5],
        [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6]);
    }
  }

  return {
    kit, orb: orbGroup, orbR: OR,
    muzzle: [0, topY + 13 + OR * 0.6, OR * 1.2],
    anim: [{ kind: 'pulse', obj: orbGroup, base: 1, amp: 0.06, speed: 2.6 }],
  };
}

/* ================================================================ 5. 火焰 */

function flame(M, lv) {
  const S = TIER_BODY[lv];
  const kit = new Kit();
  const Y0 = 14;

  /* ---- 回转环 ---- */
  kit.add(cyl(26 * S, 27 * S, 4.5, 18), M.armor, [0, Y0 + 2.2, 0]);
  kit.bolts([0, Y0 + 4.6, 0], 21 * S, 10, 1.2, 0.9, M.brassDark, 'y');

  /* ---- 卧式燃料罐（炮体就是一只罐子） ---- */
  const RL = 12.5 * S;
  const LL = 30 + lv * 4;
  const ty = Y0 + 5 + RL;
  kit.add(cylX(RL, RL, LL, 20), M.armor, [0, ty, 0]);
  /* 两端半球封头 */
  for (const sx of [-1, 1]) {
    const cap2 = sphere(RL, 18, 12);
    cap2.scale(0.44, 1, 1);
    kit.add(cap2, M.accent, [sx * LL / 2, ty, 0]);
  }
  /* 箍带 */
  for (const t of [-0.30, 0.30]) {
    kit.add(torus(RL + 0.9, 1.4, 20, 7), M.armorDark, [t * LL, ty, 0], [0, 0, Math.PI / 2]);
  }
  /* 罐顶装甲板 */
  kit.add(rbox(LL * 0.62, 2.2, RL * 1.1, 0.8), M.armorLight, [0, ty + RL * 0.94, 0]);
  /* 罐顶加油口 */
  kit.add(cyl(3.2, 3.6, 3, 10), M.brass, [-LL * 0.3, ty + RL * 0.96, 0]);
  kit.add(cyl(2.0, 2.0, 1.4, 10), M.steelDark, [-LL * 0.3, ty + RL * 1.12, 0]);

  /* ---- 喷管（粗、短、多重环） ---- */
  const U0 = LL / 2 + RL * 0.35;
  const LN = 14 + lv * 3;
  const RB = 5.6 + lv * 0.5;
  kit.add(cylZ(RB, RB * 1.12, LN, 18), M.accent, [0, ty, U0 + LN / 2]);
  for (let i = 0; i < 3; i++) {
    kit.add(torus(RB * (1.02 - i * 0.05), 1.0, 18, 6), M.armorDark, [0, ty, U0 + LN * (0.2 + i * 0.3)]);
  }
  kit.add(cylZ(RB * 0.82, RB * 0.82, 1.2, 16), M.bore, [0, ty, U0 + LN + 0.4]);
  /* 引火苗（常亮的小球） */
  const pilot = new THREE.Group();
  pilot.position.set(0, ty - RB * 0.9, U0 + LN * 0.55);
  const pl = new Kit();
  pl.add(sphere(1.6, 10, 8), M.warn, [0, 0, 0]);
  pilot.add(pl.group('pilot'));

  /* ---- 侧面增压罐 ---- */
  for (const sx of [-1, 1]) {
    kit.add(cylX(3.4, 3.4, 13, 10), M.steelDark, [-4, Y0 + 9, sx * (RL + 3.4)]);
    kit.add(cylX(1.9, 1.9, 2.4, 8), M.brass, [2.6, Y0 + 9, sx * (RL + 3.4)]);
  }

  /* ---- 2 级：侧裙装甲 ---- */
  if (lv >= 1) {
    for (const sx of [-1, 1]) {
      kit.add(rbox(LL * 0.5, 5, 1.8, 0.7), M.armorDark, [0, ty - RL * 0.62, sx * RL * 0.9]);
    }
  }
  /* ---- 3 级：副喷口 ---- */
  if (lv >= 2) {
    kit.add(cylZ(RB * 0.6, RB * 0.66, LN * 0.66, 14), M.accent,
      [0, ty - RL * 0.72, U0 + LN * 0.42]);
    kit.add(cylZ(RB * 0.5, RB * 0.5, 1.0, 12), M.bore, [0, ty - RL * 0.72, U0 + LN * 0.76]);
  }

  return {
    kit, pilot,
    muzzle: [0, ty, U0 + LN + 1],
    anim: [{ kind: 'flicker', obj: pilot, base: 1, amp: 0.35, speed: 14 }],
  };
}

/* ================================================================ 6. 胶水 */

function goo(M, lv) {
  const S = TIER_BODY[lv];
  const kit = new Kit();
  const Y0 = 14;

  /* ---- 罐体（矮胖，主视觉让给天线） ---- */
  const R = 19 * S;
  const H = 20 + lv * 3;
  kit.add(cyl(R, R * 1.05, H, 18), M.armor, [0, Y0 + H / 2, 0]);
  kit.add(cyl(R * 0.96, R, 2.4, 18), M.accent, [0, Y0 + H + 0.6, 0]);
  kit.bolts([0, Y0 + H + 2.4, 0], R * 0.82, 9, 1.2, 1.0, M.brassDark, 'y');

  /* ---- 液位窗：侧面四条发光带 ---- */
  for (let i = 0; i < 4; i++) {
    const a = -0.55 + i * 0.37;
    kit.add(rbox(2.2, 8, 1.2, 0.4), M.glow,
      [Math.sin(a) * (R + 0.4), Y0 + H * 0.5, Math.cos(a) * (R + 0.4)], [0, -a, 0]);
  }
  /* 底部排出阀 */
  kit.add(cyl(2.6, 2.6, 5, 10), M.brass, [R * 0.86, Y0 + 5, 0], [0, 0, Math.PI / 2]);
  kit.add(torus(3.2, 0.8, 12, 6), M.steelDark, [R * 0.86 + 3, Y0 + 5, 0], [0, Math.PI / 2, 0]);

  /* ---- 碟形天线（40° 仰角，灵魂特征） ---- */
  const ang = 40 * DEG;
  const PZ = Y0 + H + 4;
  const ARM = 12 + lv * 3;
  const DR = 8.5 + lv * 1.2;
  const tipY = PZ + Math.sin(ang) * ARM;
  const tipZ = Math.cos(ang) * ARM;

  /* 支臂 */
  kit.put(tubeBetween([0, PZ, 0], [0, tipY, tipZ], 1.7, 8), M.steelDark);
  kit.add(cyl(3.0, 3.6, 3.2, 10), M.steelDark, [0, PZ, 0]);

  /* 碟面：压扁的球壳 + 内凹反射面 */
  const dishG = sphere(DR, 22, 12);
  dishG.scale(1, 1, 0.24);
  const dish = new THREE.Mesh(dishG, M.armorLight);
  dish.position.set(0, tipY, tipZ);
  dish.rotation.x = -(Math.PI / 2 - ang);
  dish.castShadow = true; dish.receiveShadow = true;

  const innerG = sphere(DR * 0.78, 20, 10);
  innerG.scale(1, 1, 0.16);
  const inner = new THREE.Mesh(innerG, M.steelLight);
  inner.position.set(0, tipY, tipZ);
  inner.rotation.x = -(Math.PI / 2 - ang);

  /* 碟边缘加厚环 */
  const edge = new THREE.Mesh(torus(DR, 0.9, 22, 6), M.steelDark);
  edge.position.set(0, tipY, tipZ);
  edge.rotation.x = -(Math.PI / 2 - ang);

  /* 三根支撑 + 焦点球 */
  const FX = tipZ + Math.cos(ang) * DR * 0.88;
  const FY = tipY + Math.sin(ang) * DR * 0.88;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const bx = Math.cos(a) * DR * 0.62;
    const by = tipY + Math.sin(a) * DR * 0.62 * 0.9;
    const bz = tipZ + Math.sin(ang) * DR * 0.1;
    kit.put(tubeBetween([bx, by, bz], [0, FY, FX], 0.5, 5), M.steelDark);
  }
  const focus = new THREE.Group();
  focus.position.set(0, FY, FX);
  const fk = new Kit();
  fk.add(sphere(2.4 + lv * 0.4, 14, 10), M.glow, [0, 0, 0]);
  fk.add(torus(2.4 + lv * 0.4, 0.35, 14, 5), M.steelLight, [0, 0, 0], [0.6, 0, 0.4]);
  focus.add(fk.group('focus'));

  /* ---- 2 级：副碟 ---- */
  let sub = null;
  if (lv >= 1) {
    const sg = sphere(DR * 0.46, 16, 8);
    sg.scale(1, 1, 0.26);
    sub = new THREE.Mesh(sg, M.accent);
    sub.position.set(0, tipY + 1.5, tipZ - DR * 0.7);
    sub.rotation.x = -(Math.PI / 2 - ang);
  }
  /* ---- 3 级：侧副天线 ---- */
  if (lv >= 2) {
    kit.put(tubeBetween([R * 0.7, Y0 + H * 0.5, -R * 0.5], [R * 0.9, Y0 + H + 12, -R * 0.9], 0.9, 6), M.steelDark);
    kit.add(sphere(1.8, 10, 8), M.warn, [R * 0.9, Y0 + H + 13, -R * 0.9]);
  }

  return {
    kit, dish, inner, edge, focus, sub,
    muzzle: [0, FY, FX + 3],
    anim: [{ kind: 'pulse', obj: focus, base: 1, amp: 0.10, speed: 3.4 }],
  };
}

/* ================================================================ 装配 */

const BUILDERS = { gatling, mortar, missile, tesla, flame, goo };

/* 台座用的石材材质：六座塔共享，保证"同一个工事体系" */
function stoneSet(envTex) {
  const mk = (col, rough, metal) => new THREE.MeshStandardMaterial({
    color: col, roughness: rough, metalness: metal, envMap: envTex,
    envMapIntensity: 0.5, flatShading: true,
  });
  return {
    stone: mk('#8b8778', 0.86, 0.06),
    stoneDark: mk('#4f4d44', 0.9, 0.08),
    brassDark: new THREE.MeshStandardMaterial({
      color: '#6d5220', roughness: 0.45, metalness: 0.85,
      envMap: envTex, envMapIntensity: 0.9,
    }),
    brass: new THREE.MeshStandardMaterial({
      color: '#c39237', roughness: 0.3, metalness: 0.95,
      envMap: envTex, envMapIntensity: 1.1,
    }),
    steelDark: new THREE.MeshStandardMaterial({
      color: '#4a545e', roughness: 0.4, metalness: 0.9,
      envMap: envTex, envMapIntensity: 0.9,
    }),
    glow: new THREE.MeshStandardMaterial({
      color: '#123', emissive: '#8fe6b4', emissiveIntensity: 2.0, roughness: 0.4,
    }),
  };
}

/**
 * 建一座塔。
 * @returns { root, yaw, gun, spin, specs }
 *   root  整体（含台座）；yaw 是旋转部分；gun 是可俯仰部分
 */
export function buildTower(key, lv, ctx, materials) {
  const M = materials[key];
  const stone = ctx.stone || (ctx.stone = stoneSet(ctx.envTex));
  /* 塔体材料合并了石材，Kit 只认一个材质对象 */
  const MM = Object.assign({}, M, { stone: stone.stone, stoneDark: stone.stoneDark });

  const root = new THREE.Group();
  root.name = 'tower:' + key + ':' + lv;

  /* 台座不转 */
  const base = plinth(MM, TIER_BASE[lv], lv);
  root.add(base);

  /* 旋转部分 */
  const yaw = new THREE.Group();
  yaw.name = 'yaw';
  yaw.position.y = 0;
  root.add(yaw);

  const R = BUILDERS[key](M, lv);
  yaw.add(R.kit.group(key + '-body'));

  /* 特殊子结构（名字留着，world 里 clone 之后要靠 getObjectByName 找回来） */
  if (R.spin) { R.spin.name = 'spin'; yaw.add(R.spin); }
  if (R.spin2) { R.spin2.name = 'spin2'; yaw.add(R.spin2); }
  if (R.pitch) { R.pitch.name = 'pitch'; yaw.add(R.pitch); }
  if (R.rack) { R.rack.name = 'rack'; yaw.add(R.rack); }
  if (R.orb) { R.orb.name = 'orb'; yaw.add(R.orb); }
  if (R.pilot) { R.pilot.name = 'pilot'; yaw.add(R.pilot); }
  if (R.focus) { R.focus.name = 'focus'; yaw.add(R.focus); }
  if (R.radar) { R.radar.name = 'radar'; }
  if (R.shroud) yaw.add(R.shroud.group(key + '-shroud'));
  if (R.dish) yaw.add(R.dish, R.inner, R.edge);
  if (R.sub) yaw.add(R.sub);

  /* 炮口：需要区分是在 yaw 空间还是 rack（倾斜）空间 */
  const muzzle = new THREE.Vector3(...R.muzzle);

  const specs = {
    muzzle, muzzleInRack: !!R.muzzleInRack,
    spin: R.spin || null,
    spin2: R.spin2 || null,
    pitch: R.pitch || null,
    rack: R.rack || null,
    radar: R.radar || null,
    anim: R.anim || [],
  };

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, yaw, specs };
}

/** 供 world 预建用：每种塔每级一套材质（按配色缓存，避免重复建） */
export function towerMaterials(ctx) {
  if (ctx.towerMats) return ctx.towerMats;
  const out = {};
  for (const k in TOWER_PAL) out[k] = makeMaterials(ctx.envTex, TOWER_PAL[k]);
  ctx.towerMats = out;
  return out;
}
