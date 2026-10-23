/* ============================================================
   enemies.js —— 7 种敌方载具（每种独立色系，取自设计稿实测）

   和炮塔同一套造型约定：
     · 贴地件（轮/履带/橇）先落地，再往上叠车体
     · 车体分三层：下部车架 → 主舱 → 顶部特征件
     · 玻璃/舱门/枪口必须伸出轮廓，剪影才不是一块砖
     · 每辆车只有一个「灵魂特征」：摩托=骑手，吉普=防滚架，
       坦克=楔形炮塔，卡车=帆布货厢，直升机=五叶旋翼，
       轰炸机=后掠翼+双发，BOSS=双主炮+四条履带

   朝向：车头 = +Z（和炮塔炮口方向一致，lab 里同一个 yaw 就能转）
   ============================================================ */
import * as THREE from 'three';
import {
  TAU, DEG, add, boltRing, buildBarrel, coneY, cylX, cylY, cylZ,
  rbox, ringY, ringZ, track, ventGrill, wheel,
} from './parts3d.js';

/* ---------------------------------------------------------------- 色板 */
export const ENEMY_PAL = {
  runner: { armor: '#5c6055', armorDark: '#2f352e', armorLight: '#9d9567', accent: '#554e33', glass: '#7fd4e8', glow: '#ff8a3a' },
  infantry: { armor: '#52582d', armorDark: '#2e3829', armorLight: '#99a169', accent: '#5b6355', glass: '#8fe0f0', glow: '#ffd24a' },
  commando: { armor: '#57542e', armorDark: '#333626', armorLight: '#9c9765', accent: '#5f6251', glass: '#9fd8e8', glow: '#ffb347' },
  truck: { armor: '#546030', armorDark: '#2f362c', armorLight: '#a2ab67', accent: '#596051', glass: '#9fe2f0', glow: '#ffd24a' },
  heli: { armor: '#60695b', armorDark: '#2e3826', armorLight: '#929b68', accent: '#4f592f', glass: '#a6e2ef', glow: '#ff5a3a' },
  bomber: { armor: '#909c61', armorDark: '#2f3828', armorLight: '#c2c9ac', accent: '#515a2f', glass: '#a6e2ef', glow: '#ff6a3c' },
  boss: { armor: '#5d6355', armorDark: '#31362c', armorLight: '#939468', accent: '#525331', glass: '#7fd4e8', glow: '#ff3a2a' },
};

export const ENEMY_SPEC = {
  runner: { name: 'RUNNER', tag: '摩托侦察兵', hp: 40, speed: 1.9 },
  infantry: { name: 'INFANTRY', tag: '吉普步兵', hp: 80, speed: 1.3 },
  commando: { name: 'COMMANDO', tag: '主战坦克', hp: 220, speed: 0.95 },
  truck: { name: 'TRUCK', tag: '补给卡车', hp: 160, speed: 1.05 },
  heli: { name: 'GUNSHIP', tag: '武装直升机', hp: 140, speed: 1.5 },
  bomber: { name: 'BOMBER', tag: '轰炸机', hp: 180, speed: 1.7 },
  boss: { name: 'OVERLORD', tag: '超重型陆战堡', hp: 1600, speed: 0.55 },
};

/* ---------------------------------------------------------------- 共用 */
function tiltFin(g, M, w, h, d, pos, rotZ = 0, rotX = 0) {
  const m = add(g, rbox(w, h, d, 0.02), M.armor, pos);
  m.rotation.z = rotZ; m.rotation.x = rotX;
  return m;
}

function headlight(g, M, x, y, z) {
  add(g, cylZ(0.052, 0.05, 14), M.steelDark, [x, y, z]);
  add(g, cylZ(0.040, 0.035, 14), M.glow || M.warn, [x, y, z + 0.035]);
}

/* ================================================================ 1. 摩托 */
function runner(g, M) {
  const WR = 0.30;                     // 轮半径
  const WY = WR;
  // 前后轮（沿 Z 排列）
  wheel(g, M, WR, 0.10, [0, WY, 0.56]);
  wheel(g, M, WR, 0.115, [0, WY, -0.54]);

  // 车架：主梁
  add(g, rbox(0.10, 0.055, 0.92, 0.02), M.steelDark, [0, 0.42, 0.02]);
  // 前叉（两根斜管）
  for (const sg of [-1, 1]) {
    add(g, cylZ(0.022, 0.52, 10), M.steelLight,
      [sg * 0.075, 0.52, 0.44], [-26 * DEG, 0, 0]);
  }
  // 油箱（橄榄，带高光的那块）
  const tank = new THREE.SphereGeometry(0.15, 18, 12);
  tank.scale(1, 0.78, 1.65);
  add(g, tank, M.armor, [0, 0.56, 0.10]);
  add(g, rbox(0.19, 0.05, 0.34, 0.03), M.armorDark, [0, 0.50, 0.10]);
  // 座垫
  add(g, rbox(0.16, 0.055, 0.34, 0.025), M.rubber, [0, 0.585, -0.24]);
  // 尾箱 + 排气管
  add(g, rbox(0.18, 0.12, 0.20, 0.03), M.accent, [0, 0.52, -0.48]);
  add(g, cylZ(0.036, 0.46, 10), M.steelDark, [0.10, 0.34, -0.30]);
  add(g, cylZ(0.046, 0.05, 10), M.brassDark, [0.10, 0.34, -0.53]);
  // 车把
  add(g, cylX(0.016, 0.44, 8), M.steelLight, [0, 0.74, 0.34]);
  for (const sg of [-1, 1]) add(g, cylX(0.026, 0.10, 8), M.rubber, [sg * 0.20, 0.74, 0.34]);
  // 前灯
  add(g, cylZ(0.062, 0.05, 14), M.steelDark, [0, 0.64, 0.46]);
  add(g, cylZ(0.048, 0.035, 14), M.glow || M.warn, [0, 0.64, 0.49]);

  /* ---- 骑手（灵魂特征）---- */
  const RY = 0.60;
  // 躯干前倾
  const torso = add(g, rbox(0.20, 0.28, 0.16, 0.05), M.accent, [0, RY + 0.24, -0.06]);
  torso.rotation.x = 18 * DEG;
  // 头盔
  add(g, new THREE.SphereGeometry(0.098, 16, 12), M.armor, [0, RY + 0.44, 0.01]);
  // 护目镜
  add(g, rbox(0.13, 0.045, 0.02, 0.008), M.glass || M.steelLight, [0, RY + 0.45, 0.095]);
  // 双臂伸向车把
  for (const sg of [-1, 1]) {
    const arm = add(g, cylY(0.036, 0.34, 8), M.accent, [sg * 0.12, RY + 0.24, 0.14]);
    arm.rotation.x = -64 * DEG; arm.rotation.z = sg * 0.12;
  }
  // 双腿夹住车身
  for (const sg of [-1, 1]) {
    const leg = add(g, cylY(0.042, 0.30, 8), M.accent, [sg * 0.10, RY - 0.02, -0.06]);
    leg.rotation.x = 22 * DEG;
  }
  // 背后的步枪（剪影上很提气）
  add(g, rbox(0.035, 0.035, 0.34, 0.008), M.steelDark, [0.13, RY + 0.30, -0.14], [0, 0.35, 0]);
  return { muzzle: [0, 0.70, 0.50], shells: 1 };
}

/* ================================================================ 2. 吉普 */
function infantry(g, M) {
  const WR = 0.34;
  const WY = WR;
  for (const sg of [-1, 1]) {
    wheel(g, M, WR, 0.14, [sg * 0.60, WY, 0.62]);
    wheel(g, M, WR, 0.14, [sg * 0.60, WY, -0.58]);
  }
  // 底盘
  add(g, rbox(1.06, 0.14, 1.86, 0.04), M.armorDark, [0, WY + 0.14, 0]);
  // 车身下半
  add(g, rbox(1.14, 0.30, 1.94, 0.06), M.armor, [0, WY + 0.34, 0]);
  // 引擎盖（前段略低）
  add(g, rbox(1.06, 0.18, 0.62, 0.05), M.armorLight, [0, WY + 0.54, 0.62]);
  // 前格栅 + 大灯
  add(g, rbox(0.96, 0.20, 0.06, 0.02), M.steelDark, [0, WY + 0.46, 0.94]);
  ventGrill(g, M.steel, 5, 0.86, 0.13, 0.03, [0, WY + 0.46, 0.955], 0.055, 'Y');
  headlight(g, M, -0.36, WY + 0.56, 0.95);
  headlight(g, M, 0.36, WY + 0.56, 0.95);
  // 前保险杠
  add(g, rbox(1.16, 0.09, 0.09, 0.03), M.steel, [0, WY + 0.24, 0.98]);

  // 座舱（敞开）
  add(g, rbox(0.94, 0.16, 0.72, 0.04), M.armorDark, [0, WY + 0.56, -0.20]);
  // 挡风玻璃（前倾，玻璃材质是关键的高光点）
  const ws = add(g, rbox(0.88, 0.30, 0.035, 0.01),
    M.glass || M.steelLight, [0, WY + 0.74, 0.26], [-22 * DEG, 0, 0]);
  // 两个座椅
  for (const sg of [-1, 1]) {
    add(g, rbox(0.32, 0.10, 0.30, 0.03), M.rubber, [sg * 0.24, WY + 0.66, -0.24]);
    add(g, rbox(0.32, 0.26, 0.07, 0.03), M.rubber, [sg * 0.24, WY + 0.78, -0.38]);
  }
  // 防滚架（灵魂特征：三根管，剪影立刻读得出来）
  for (const sg of [-1, 1]) {
    add(g, cylY(0.028, 0.42, 8), M.steelDark, [sg * 0.44, WY + 0.80, -0.28]);
  }
  add(g, cylX(0.028, 0.90, 8), M.steelDark, [0, WY + 1.00, -0.28]);
  // 车顶机枪位
  add(g, cylY(0.048, 0.16, 10), M.steelDark, [0, WY + 1.06, -0.28]);
  const mg = new THREE.Group();
  mg.position.set(0, WY + 1.14, -0.28);
  g.add(mg);
  add(mg, rbox(0.12, 0.10, 0.26, 0.02), M.steel, [0, 0, 0]);
  add(mg, cylZ(0.022, 0.42, 10), M.steelDark, [0, 0.01, 0.30]);
  add(mg, ringZ(0.030, 0.012, 10), M.brassDark, [0, 0.01, 0.44]);

  // 备胎
  add(g, cylZ(WR * 0.86, 0.10, 18), M.rubber, [0, WY + 0.42, -0.98]);
  add(g, cylZ(WR * 0.40, 0.12, 14), M.brass, [0, WY + 0.42, -0.99]);
  // 侧面踏板
  for (const sg of [-1, 1]) {
    add(g, rbox(0.09, 0.045, 0.70, 0.015), M.steelDark, [sg * 0.60, WY + 0.22, -0.18]);
  }
  return { muzzle: [0, WY + 1.15, 0.02], shells: 3 };
}

/* ================================================================ 3. 坦克 */
function commando(g, M) {
  const TH = 0.40;                     // 履带半高
  for (const sg of [-1, 1]) {
    const t = track(g, M, { len: 1.90, h: TH * 2, w: 0.26, plates: 30, roadWheels: 5 });
    t.position.set(sg * 0.58, TH, 0);
  }
  // 履带上方的挡泥板
  for (const sg of [-1, 1]) {
    add(g, rbox(0.34, 0.07, 2.02, 0.02), M.armor, [sg * 0.58, TH * 2 + 0.02, 0]);
  }

  // 车体：前倾的楔形（灵魂特征的一半）
  add(g, rbox(1.36, 0.30, 1.92, 0.05), M.armor, [0, TH * 2 + 0.16, 0]);
  /* 底盘：履带之间必须填实。否则从斜上方能直接透过车底看到背景，
     整辆车会读成「空心的」。厚度做到和履带下沿齐平。 */
  add(g, rbox(1.10, 0.42, 1.80, 0.05), M.armorDark, [0, TH * 0.62, 0]);
  const glacis = add(g, rbox(1.30, 0.34, 0.62, 0.04), M.armorLight,
    [0, TH * 2 + 0.28, 0.72], [-34 * DEG, 0, 0]);
  // 车体侧裙
  for (const sg of [-1, 1]) {
    add(g, rbox(0.05, 0.26, 1.76, 0.02), M.armorDark, [sg * 0.69, TH * 2 + 0.14, 0]);
  }
  // 后甲板格栅
  ventGrill(g, M.steelDark, 4, 0.90, 0.03, 0.10, [0, TH * 2 + 0.32, -0.72], 0.13, 'Z');

  // 炮塔：楔形块（比车体窄，前后不对称）
  const TY = TH * 2 + 0.34;
  add(g, rbox(1.02, 0.34, 1.20, 0.07), M.armor, [0, TY + 0.17, -0.06]);
  // 炮塔前脸斜面
  add(g, rbox(0.94, 0.30, 0.36, 0.05), M.armorLight, [0, TY + 0.20, 0.44], [-28 * DEG, 0, 0]);
  // 炮塔顶
  add(g, rbox(0.80, 0.05, 0.96, 0.02), M.armorLight, [0, TY + 0.35, -0.08]);
  // 车长舱盖 + 舱盖环
  add(g, cylY(0.17, 0.06, 18), M.armorDark, [0.22, TY + 0.38, -0.20]);
  add(g, cylY(0.13, 0.05, 18), M.steelDark, [0.22, TY + 0.42, -0.20]);
  boltRing(g, M.brassDark, 6, 0.15, 0.020, 0.028, [0.22, TY + 0.36, -0.20], 'Y');
  // 机枪
  add(g, cylZ(0.022, 0.34, 8), M.steelDark, [-0.24, TY + 0.40, 0.14]);
  // 侧裙装甲块
  for (const sg of [-1, 1]) {
    add(g, rbox(0.06, 0.20, 0.86, 0.02), M.armorDark, [sg * 0.50, TY + 0.16, 0.02]);
  }
  // 主炮
  buildBarrel(g, M, { z0: 0.58, len: 1.30, r: 0.072, seg: 3, brakeR: 1.7 })
    .position.y = TY + 0.20;

  // 备用履带板挂在炮塔侧面（老坦克的经典细节）
  for (let i = 0; i < 3; i++) {
    add(g, rbox(0.03, 0.16, 0.115, 0.008), M.track,
      [-0.52, TY + 0.18, 0.10 - i * 0.13]);
  }
  return { muzzle: [0, TY + 0.20, 1.92], shells: 1 };
}

/* ================================================================ 4. 卡车 */
function truck(g, M) {
  const WR = 0.36;
  const WY = WR;
  // 三轴六轮
  for (const sg of [-1, 1]) {
    wheel(g, M, WR, 0.15, [sg * 0.62, WY, 0.78]);
    wheel(g, M, WR, 0.15, [sg * 0.62, WY, -0.30]);
    wheel(g, M, WR, 0.15, [sg * 0.62, WY, -0.74]);
  }
  // 车架
  add(g, rbox(1.10, 0.12, 2.44, 0.03), M.armorDark, [0, WY + 0.10, 0]);

  /* ---- 驾驶室 ---- */
  add(g, rbox(1.16, 0.52, 0.78, 0.07), M.armor, [0, WY + 0.42, 0.72]);
  // 引擎盖
  add(g, rbox(1.10, 0.20, 0.30, 0.04), M.armorLight, [0, WY + 0.32, 1.20]);
  // 风挡
  add(g, rbox(1.00, 0.26, 0.04, 0.01), M.glass || M.steelLight, [0, WY + 0.68, 1.06], [-14 * DEG, 0, 0]);
  // 侧窗
  for (const sg of [-1, 1]) {
    add(g, rbox(0.04, 0.20, 0.34, 0.01), M.glass || M.steelLight, [sg * 0.585, WY + 0.66, 0.74]);
  }
  // 格栅 + 大灯 + 保险杠
  add(g, rbox(0.96, 0.22, 0.05, 0.02), M.steelDark, [0, WY + 0.30, 1.36]);
  ventGrill(g, M.steel, 4, 0.84, 0.14, 0.025, [0, WY + 0.30, 1.375], 0.062, 'Y');
  headlight(g, M, -0.38, WY + 0.42, 1.36);
  headlight(g, M, 0.38, WY + 0.42, 1.36);
  add(g, rbox(1.18, 0.10, 0.10, 0.03), M.steel, [0, WY + 0.14, 1.38]);
  // 排气管（竖在驾驶室后面，剪影辨识点）
  add(g, cylY(0.045, 0.86, 12), M.steelDark, [0.56, WY + 0.72, 0.30]);
  add(g, cylY(0.055, 0.05, 12), M.brassDark, [0.56, WY + 1.16, 0.30]);

  /* ---- 货厢（灵魂特征：帆布拱顶）---- */
  const BZ = -0.66;
  add(g, rbox(1.12, 0.10, 0.14, 0.03), M.armorDark, [0, WY + 0.26, 0.26]);   // 前挡板
  // 底板
  add(g, rbox(1.14, 0.08, 1.30, 0.02), M.armor, [0, WY + 0.22, BZ]);
  // 侧板
  for (const sg of [-1, 1]) {
    add(g, rbox(0.05, 0.34, 1.30, 0.02), M.armor, [sg * 0.56, WY + 0.40, BZ]);
  }
  // 帆布罩：大倒角盒 = 圆顶货厢（比半圆柱稳，任何角度都不会露出内侧）
  add(g, rbox(1.10, 0.54, 1.26, 0.24), M.armorLight, [0, WY + 0.50, BZ]);
  // 帆布压条
  for (let i = 0; i < 4; i++) {
    add(g, rbox(1.06, 0.035, 0.035, 0.012), M.armorDark,
      [0, WY + 0.74, BZ - 0.46 + i * 0.30]);
  }
  // 后挡板
  add(g, rbox(1.14, 0.34, 0.05, 0.02), M.armorDark, [0, WY + 0.40, BZ - 0.66]);
  return { muzzle: [0, WY + 0.62, 1.44], shells: 1 };
}

/* ================================================================ 5. 直升机 */
function heli(g, M) {
  const BODY_Y = 0.62;
  // 起落橇（贴地）
  for (const sg of [-1, 1]) {
    add(g, cylZ(0.030, 1.42, 10), M.steelDark, [sg * 0.42, 0.05, 0.02]);
    for (const zz of [0.44, -0.42]) {
      add(g, cylY(0.026, 0.20, 8), M.steelDark, [sg * 0.42, 0.16, zz]);
    }
  }
  add(g, cylX(0.026, 0.86, 8), M.steelDark, [0, 0.15, 0.44]);
  add(g, cylX(0.026, 0.86, 8), M.steelDark, [0, 0.15, -0.42]);

  // 机身：水滴形（前圆后收）。做大一点，整机才不像根棍子
  const fus = new THREE.SphereGeometry(0.40, 22, 16);
  fus.scale(1.0, 0.94, 1.72);
  add(g, fus, M.armor, [0, BODY_Y, 0.06]);
  // 机腹
  add(g, rbox(0.52, 0.20, 1.16, 0.06), M.armorDark, [0, BODY_Y - 0.28, 0.06]);
  // 座舱玻璃（前脸大块，是整机最亮的地方）
  const cg = new THREE.SphereGeometry(0.30, 20, 14, 0, TAU, 0, Math.PI * 0.62);
  cg.scale(1.0, 0.88, 1.30);
  add(g, cg, M.glass || M.steelLight, [0, BODY_Y + 0.02, 0.40]);
  // 座舱框（两条竖筋）
  for (const sg of [-1, 1]) {
    add(g, rbox(0.022, 0.30, 0.026, 0.008), M.steelDark, [sg * 0.10, BODY_Y + 0.16, 0.56], [-24 * DEG, 0, 0]);
  }
  // 尾梁
  add(g, rbox(0.16, 0.16, 1.30, 0.05), M.armor, [0, BODY_Y + 0.06, -1.20]);
  // 垂尾 + 平尾
  tiltFin(g, M, 0.05, 0.40, 0.34, [0, BODY_Y + 0.22, -1.76], 0, -14 * DEG);
  add(g, rbox(0.52, 0.035, 0.20, 0.012), M.armor, [0, BODY_Y + 0.10, -1.62]);
  // 尾桨
  const tr = new THREE.Group();
  tr.position.set(0.10, BODY_Y + 0.22, -1.80);
  g.add(tr);
  for (let i = 0; i < 2; i++) {
    add(tr, rbox(0.012, 0.30, 0.045, 0.006), M.steelDark, [0, 0, 0], [0, 0, i * Math.PI / 2]);
  }

  // 短翼 + 火箭巢
  for (const sg of [-1, 1]) {
    add(g, rbox(0.46, 0.055, 0.26, 0.02), M.armor, [sg * 0.36, BODY_Y + 0.02, 0.14]);
    const pod = add(g, cylX(0.085, 0.26, 14), M.armorDark, [sg * 0.60, BODY_Y - 0.06, 0.14]);
    for (let i = 0; i < 3; i++) {
      add(g, cylX(0.020, 0.03, 8), M.bore, [sg * 0.72, BODY_Y - 0.06 + (i - 1) * 0.045, 0.14]);
    }
  }
  // 主旋翼轴 + 桨毂
  const MY = BODY_Y + 0.40;
  add(g, cylY(0.045, 0.16, 12), M.steelDark, [0, MY, 0.02]);
  add(g, cylY(0.10, 0.07, 14), M.steel, [0, MY + 0.10, 0.02]);
  // 5 叶主旋翼（设计稿硬要求：5 叶、浅灰）
  const rotor = new THREE.Group();
  rotor.position.set(0, MY + 0.14, 0.02);
  g.add(rotor);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const blade = add(rotor, rbox(0.075, 0.012, 1.02, 0.006), M.steelLight,
      [Math.sin(a) * 0.54, 0, Math.cos(a) * 0.54], [0, a, 0]);
    blade.rotation.x = 3 * DEG;         // 一点桨距，边缘才有明暗变化
  }
  add(g, new THREE.SphereGeometry(0.032, 10, 8), M.glow || M.warn, [0, MY + 0.16, 0.02]);
  return { muzzle: [0, BODY_Y - 0.16, 0.60], shells: 2, rotor };
}

/* ================================================================ 6. 轰炸机 */
function bomber(g, M) {
  const BY = 0.86;
  // 机身：细长纺锤
  const fus = new THREE.SphereGeometry(0.30, 22, 16);
  fus.scale(0.88, 0.86, 2.55);
  add(g, fus, M.armor, [0, BY, 0]);
  // 机头玻璃
  const ng = new THREE.SphereGeometry(0.24, 18, 12, 0, TAU, 0, Math.PI * 0.55);
  ng.scale(0.90, 0.84, 1.30);
  add(g, ng, M.glass || M.steelLight, [0, BY + 0.06, 0.56]);
  // 背脊
  add(g, rbox(0.30, 0.10, 1.60, 0.04), M.armorLight, [0, BY + 0.22, -0.10]);

  // 后掠翼（灵魂特征）
  for (const sg of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(sg * 0.24, BY - 0.02, -0.02);
    wing.rotation.y = sg * 16 * DEG;      // 后掠
    g.add(wing);
    const wg = rbox(1.30, 0.055, 0.46, 0.02);
    add(wing, wg, M.armor, [sg * 0.64, 0, 0]);
    // 翼根整流
    add(wing, rbox(0.34, 0.10, 0.52, 0.04), M.armorDark, [sg * 0.10, 0, 0]);
    // 翼尖上反
    add(wing, rbox(0.26, 0.045, 0.40, 0.015), M.armorLight,
      [sg * 1.24, 0.04, 0], [0, 0, sg * 8 * DEG]);
    // 发动机短舱（双发）
    const nac = new THREE.Group();
    nac.position.set(sg * 0.62, -0.09, 0.12);
    wing.add(nac);
    add(nac, cylZ(0.115, 0.62, 16), M.armorDark, [0, 0, 0]);
    add(nac, cylZ(0.098, 0.06, 16), M.steelDark, [0, 0, 0.34]);
    add(nac, cylZ(0.070, 0.05, 14), M.bore, [0, 0, 0.37]);
    for (let i = 0; i < 3; i++) {
      add(nac, ringZ(0.118, 0.014, 16), M.steel, [0, 0, -0.20 + i * 0.18]);
    }
  }
  // 垂尾 + 平尾
  tiltFin(g, M, 0.06, 0.56, 0.42, [0, BY + 0.34, -1.10], 0, -18 * DEG);
  add(g, rbox(0.86, 0.04, 0.26, 0.015), M.armor, [0, BY + 0.10, -1.18]);
  // 翼下挂架 + 炸弹
  for (const sg of [-1, 1]) {
    add(g, rbox(0.05, 0.06, 0.22, 0.01), M.steelDark, [sg * 0.70, BY - 0.10, 0.02]);
    const bomb = new THREE.SphereGeometry(0.075, 14, 10);
    bomb.scale(1, 1, 2.1);
    add(g, bomb, M.accent, [sg * 0.70, BY - 0.16, 0.02]);
  }
  // 起落橇（简化：三个小支柱）
  for (const [x, z] of [[0, 0.52], [-0.34, -0.30], [0.34, -0.30]]) {
    add(g, cylY(0.028, 0.30, 8), M.steelDark, [x, BY - 0.34, z]);
    add(g, new THREE.SphereGeometry(0.055, 10, 8), M.rubber, [x, BY - 0.48, z]);
  }
  return { muzzle: [0, BY - 0.10, 0.30], shells: 4 };
}

/* ================================================================ 7. BOSS */
function boss(g, M) {
  const TH = 0.52;
  // 四条履带（灵魂特征之一：比坦克多一倍，视觉体量直接翻倍）
  for (const sg of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const t = track(g, M, { len: 1.30, h: TH * 2, w: 0.30, plates: 24, roadWheels: 3 });
      t.position.set(sg * 0.86, TH, dz * 0.62);
    }
  }
  // 主车体
  add(g, rbox(1.86, 0.42, 2.36, 0.07), M.armor, [0, TH * 2 + 0.22, 0]);
  // 底盘（四条履带之间填实，否则会透光成空心）
  add(g, rbox(1.56, 0.50, 2.20, 0.06), M.armorDark, [0, TH * 0.66, 0]);
  // 前部撞角（楔形）
  add(g, rbox(1.60, 0.46, 0.60, 0.05), M.armorLight, [0, TH * 2 + 0.30, 1.06], [-30 * DEG, 0, 0]);
  // 侧面重装甲块
  for (const sg of [-1, 1]) {
    add(g, rbox(0.09, 0.34, 2.00, 0.02), M.armorDark, [sg * 0.96, TH * 2 + 0.22, 0]);
    for (let i = 0; i < 3; i++) {
      add(g, rbox(0.06, 0.22, 0.34, 0.02), M.armor,
        [sg * 1.02, TH * 2 + 0.22, -0.62 + i * 0.62]);
    }
  }
  // 顶部装甲台
  const TY = TH * 2 + 0.46;
  add(g, rbox(1.46, 0.10, 1.90, 0.03), M.armorLight, [0, TY + 0.05, -0.04]);

  // 双主炮塔（灵魂特征之二）
  for (const sg of [-1, 1]) {
    const tx = sg * 0.42;
    add(g, rbox(0.62, 0.34, 0.78, 0.06), M.armor, [tx, TY + 0.26, 0.34]);
    add(g, rbox(0.52, 0.26, 0.30, 0.04), M.armorLight, [tx, TY + 0.30, 0.66], [-24 * DEG, 0, 0]);
    add(g, rbox(0.46, 0.05, 0.58, 0.02), M.armorLight, [tx, TY + 0.44, 0.30]);
    const bar = buildBarrel(g, M, { z0: 0.96, len: 1.10, r: 0.078, seg: 3, brakeR: 1.8 });
    bar.position.set(tx, TY + 0.28, 0);
    // 炮塔环
    add(g, ringY(0.30, 0.030, 24), M.brassDark, [tx, TY + 0.11, 0.34]);
  }
  // 后方防空塔
  add(g, cylY(0.24, 0.20, 20), M.armor, [0, TY + 0.16, -0.78]);
  add(g, rbox(0.34, 0.22, 0.34, 0.04), M.armorDark, [0, TY + 0.36, -0.78]);
  for (const sg of [-1, 1]) {
    add(g, cylZ(0.026, 0.44, 8), M.steelDark, [sg * 0.08, TY + 0.40, -0.60]);
  }
  // 能量核心（发光，锁第一眼）
  add(g, new THREE.SphereGeometry(0.13, 18, 12), M.glow || M.warn, [0, TY + 0.30, -0.30]);
  add(g, ringY(0.20, 0.020, 24), M.steel, [0, TY + 0.30, -0.30]);
  // 天线阵
  for (const sg of [-1, 1]) {
    add(g, cylY(0.020, 0.66, 8, 0.012), M.steelDark, [sg * 0.62, TY + 0.40, -0.92], [0.08, 0, sg * 0.08]);
    add(g, new THREE.SphereGeometry(0.038, 10, 8), M.glow || M.warn, [sg * 0.62, TY + 0.74, -0.95]);
  }
  // 前灯阵
  for (const sg of [-1, 1]) {
    headlight(g, M, sg * 0.62, TH * 2 + 0.30, 1.18);
  }
  return { muzzle: [0, TY + 0.28, 2.10], shells: 2 };
}

/* ---------------------------------------------------------------- 组装 */
const BUILDERS = { runner, infantry, commando, truck, heli, bomber, boss };

export function buildEnemy(key, M) {
  const root = new THREE.Group();
  const yaw = new THREE.Group();
  root.add(yaw);
  const out = BUILDERS[key](yaw, M);
  return { root, yaw, spec: out, level: 0, key };
}
