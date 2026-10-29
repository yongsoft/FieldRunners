/* ============================================================
   r3d/vehicles.js — 7 种敌军载具

   和炮塔同一套造型语言：三段式体块、全倒角、特征件伸出轮廓。
   但敌人是**俯视 sprite 的 3D 化**，所以重心比炮塔低、轮廓更扁，
   车头方向 = +Z，原点在着地面中心。

   关键结构决定：这里**不直接产出 Mesh**，只产出
        parts:  [{ geo, mat }]        车身（已按材质合并好）
        wheels: [{ x,y,z,r,w }]       车轮（交给全局实例化车轮池）
        rotors: [{ x,y,z,r,n }]       旋翼（交给旋翼池）
   原因：后期一波能到 50 个敌人，逐个 Mesh 会产生上千 draw call。
   车身按 kind 做 InstancedMesh、车轮/旋翼做全局池之后，
   几十个敌人的开销基本等于 7 个。
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import {
  rbox, box, cyl, cylZ, cylX, sphere, dome, cone, torus, ringFlat, tubeBetween, Kit, DEG,
} from './geo.js';
import { makeMaterials } from './core.js';

export const ENEMY_PAL = {
  runner: {
    armor: '#5c6055', armorDark: '#2b3129', armorLight: '#9d9567',
    accent: '#4e4630', glass: '#7fd4e8', glow: '#ff8a3a',
  },
  infantry: {
    armor: '#52582d', armorDark: '#2b3327', armorLight: '#99a169',
    accent: '#59614f', glass: '#8fe0f0', glow: '#ffd24a',
  },
  commando: {
    armor: '#57542e', armorDark: '#2f3225', armorLight: '#9c9765',
    accent: '#5b5e4d', glass: '#9fd8e8', glow: '#ffb347',
  },
  truck: {
    armor: '#546030', armorDark: '#2b3228', armorLight: '#a2ab67',
    accent: '#565d4c', glass: '#9fe2f0', glow: '#ffd24a',
  },
  heli: {
    armor: '#60695b', armorDark: '#2d352f', armorLight: '#9aa596',
    accent: '#4e574e', glass: '#a8e6f4', glow: '#ff7a3a',
  },
  bomber: {
    armor: '#909c61', armorDark: '#48512f', armorLight: '#c2cb93',
    accent: '#6b7350', glass: '#b7ecf8', glow: '#ff5a2a',
  },
  boss: {
    armor: '#5d6355', armorDark: '#272b26', armorLight: '#9aa08f',
    accent: '#474d43', glass: '#9fd8e8', glow: '#ff4a2a',
  },
};

/** 车轮记录 */
function wheel(arr, x, y, z, r, w) { arr.push({ x, y, z, r, w }); }

/* ================================================================ 摩托 */

function runner(M) {
  const kit = new Kit();
  const wheels = [], rotors = [];
  const WR = 7.2;                 // 轮半径

  /* 车架：一根低矮的梁 */
  kit.add(rbox(7.5, 4.0, 26, 1.2), M.armorDark, [0, 10.5, 0]);
  /* 油箱（前倾的鼓包） */
  kit.add(rbox(9.5, 6.5, 11, 2.2), M.armor, [0, 14.2, 2], [0.12, 0, 0]);
  kit.add(rbox(6.5, 2.0, 8, 0.8), M.armorLight, [0, 17.6, 2.2]);
  /* 座垫 */
  kit.add(rbox(7.5, 2.4, 9, 1.0), M.accent, [0, 14.0, -6.5]);
  /* 尾部货箱 */
  kit.add(rbox(9, 6, 7, 1.4), M.armor, [0, 13.5, -13]);
  kit.add(box(9.4, 0.8, 7.4), M.armorDark, [0, 16.4, -13]);
  /* 排气管 */
  kit.put(tubeBetween([3.4, 8.5, -4], [3.4, 10.5, -14], 1.0, 6), M.steelDark);
  kit.add(cylZ(1.2, 1.2, 2.4, 8), M.steel, [3.4, 10.5, -15]);
  /* 前叉 */
  for (const sx of [-1, 1]) {
    kit.put(tubeBetween([sx * 3.0, 15.5, 8], [sx * 3.0, WR, 16], 0.85, 6), M.steelLight);
  }
  /* 车把 + 大灯 */
  kit.add(cylX(0.7, 0.7, 12, 6), M.steelDark, [0, 18.2, 9.5]);
  kit.add(cylZ(2.6, 2.4, 2.2, 10), M.armorDark, [0, 17.0, 11.4]);
  kit.add(cylZ(2.0, 2.0, 0.8, 10), M.glass, [0, 17.0, 12.6]);
  /* 挡泥板 */
  kit.add(rbox(7, 1.2, 10, 0.6), M.armor, [0, WR + 5.2, 15.5], [0.3, 0, 0]);

  /* ---- 骑手 ---- */
  /* 腿 */
  for (const sx of [-1, 1]) {
    kit.add(rbox(3.6, 9, 8, 1.4), M.accent, [sx * 4.2, 15.5, -3.5], [0.55, 0, 0]);
    kit.add(rbox(3.4, 3.4, 4.5, 1.0), M.armorDark, [sx * 4.2, 11.4, -1.2]);
  }
  /* 躯干（前倾） */
  kit.add(rbox(11, 13, 8, 3.0), M.armor, [0, 22.6, -2.2], [0.30, 0, 0]);
  /* 背包 */
  kit.add(rbox(9, 9, 5, 2.0), M.accent, [0, 23.4, -8.4], [0.30, 0, 0]);
  /* 手臂伸向车把 */
  for (const sx of [-1, 1]) {
    kit.put(tubeBetween([sx * 5.4, 26.5, -1.5], [sx * 4.2, 19.6, 9.0], 1.9, 6), M.armor);
  }
  /* 头盔 */
  kit.add(dome(5.2, 14, 8, Math.PI * 0.62), M.armorLight, [0, 30.4, 0.4]);
  kit.add(cyl(5.0, 5.0, 1.4, 14), M.armorDark, [0, 29.4, 0.4]);
  /* 护目镜 */
  kit.add(rbox(8.5, 3.2, 2.2, 1.0), M.glass, [0, 29.9, 4.6], [0.15, 0, 0]);

  wheel(wheels, 0, WR, 16, WR, 4.2);
  wheel(wheels, 0, WR, -15, WR + 0.6, 5.0);

  return { parts: kit, wheels, rotors, len: 34 };
}

/* ================================================================ 吉普 */

function infantry(M) {
  const kit = new Kit();
  const wheels = [], rotors = [];
  const WR = 8.2;

  /* 底盘 */
  kit.add(rbox(24, 4.5, 42, 1.6), M.armorDark, [0, 8.5, 0]);
  /* 车身：前低后高 */
  kit.add(rbox(25, 9, 30, 2.4), M.armor, [0, 14.5, -2]);
  kit.add(rbox(23, 7, 11, 2.0), M.armor, [0, 13.4, 14.5]);
  /* 引擎盖 */
  kit.add(rbox(21, 2.0, 12, 1.0), M.armorLight, [0, 18.2, 13]);
  /* 侧裙 */
  for (const sx of [-1, 1]) {
    kit.add(rbox(1.6, 4.5, 26, 0.6), M.armorDark, [sx * 12.4, 11.5, -1]);
  }
  /* 前保险杠 + 绞盘 */
  kit.add(rbox(26, 3.4, 3.0, 1.2), M.steelDark, [0, 10.2, 21]);
  kit.add(cylX(2.6, 2.6, 8, 10), M.steel, [0, 13.0, 20.4]);
  /* 大灯 */
  for (const sx of [-1, 1]) {
    kit.add(cylZ(2.2, 2.2, 1.6, 10), M.steelDark, [sx * 7.5, 15.5, 19.6]);
    kit.add(cylZ(1.7, 1.7, 0.7, 10), M.glass, [sx * 7.5, 15.5, 20.6]);
  }
  /* 挡风玻璃（前倾） */
  kit.add(rbox(20, 10, 1.4, 0.6), M.glass, [0, 21.5, 8], [-0.38, 0, 0]);
  kit.add(rbox(21, 1.4, 2.0, 0.5), M.steelDark, [0, 26.0, 6.6]);
  /* 防滚架 */
  for (const sx of [-1, 1]) {
    kit.put(tubeBetween([sx * 10, 18.5, 2], [sx * 10, 30.0, -4], 1.1, 6), M.steelDark);
    kit.put(tubeBetween([sx * 10, 30.0, -4], [sx * 10, 29.0, -16], 1.1, 6), M.steelDark);
  }
  kit.add(cylX(1.1, 1.1, 21, 6), M.steelDark, [0, 30.0, -4]);
  kit.add(cylX(1.1, 1.1, 21, 6), M.steelDark, [0, 29.0, -16]);

  /* 车顶机枪位 */
  kit.add(cyl(4.2, 4.8, 2.4, 10), M.steelDark, [0, 30.6, -6]);
  kit.add(cyl(2.0, 2.0, 2.0, 8), M.steel, [0, 32.4, -6]);
  kit.add(rbox(3.0, 3.0, 12, 1.0), M.steelDark, [0, 33.0, 0]);
  kit.add(cylZ(0.9, 0.9, 7, 6), M.steelLight, [0, 33.0, 7.5]);
  /* 弹箱 */
  kit.add(rbox(5, 4, 5, 1.0), M.accent, [4.5, 31.5, -8]);

  /* 后部货架 + 备胎 */
  kit.add(rbox(22, 8, 8, 1.6), M.armor, [0, 17.5, -18]);
  kit.add(cylX(WR * 0.8, WR * 0.8, 3.6, 14), M.rubber, [0, 18.5, -21.5], [0, 0, 0]);
  /* 天线 */
  kit.put(tubeBetween([10, 18, -16], [11, 40, -18], 0.4, 4), M.steelDark);

  wheel(wheels, -11.8, WR, 13.5, WR, 5.0);
  wheel(wheels, 11.8, WR, 13.5, WR, 5.0);
  wheel(wheels, -11.8, WR, -13.5, WR, 5.0);
  wheel(wheels, 11.8, WR, -13.5, WR, 5.0);

  return { parts: kit, wheels, rotors, len: 44 };
}

/* ================================================================ 坦克 */

function commando(M) {
  const kit = new Kit();
  const wheels = [], rotors = [];
  const TH = 6.5;                 // 履带半高模数

  /* 履带：两条长长的圆角盒子外壳 */
  for (const sx of [-1, 1]) {
    const tx = sx * 15.5;
    /* 履带主体 */
    kit.add(rbox(9, 15, 46, 4.0), M.armorDark, [tx, 9.5, 0]);
    /* 履带板：上下一排小凸起，模拟链节 */
    for (let i = 0; i < 9; i++) {
      kit.add(box(9.6, 1.6, 3.4), M.steelDark, [tx, 17.4, -20 + i * 5]);
      kit.add(box(9.6, 1.6, 3.4), M.steelDark, [tx, 1.6, -20 + i * 5]);
    }
    /* 负重轮（会转，用实例化） */
    for (let i = 0; i < 4; i++) {
      wheel(wheels, tx, 9.5, -15 + i * 10, 6.2, 4.4);
    }
    /* 主动轮 / 诱导轮 */
    wheel(wheels, tx, 9.5, 21, 5.4, 4.2);
    wheel(wheels, tx, 9.5, -21, 5.4, 4.2);
    /* 侧裙装甲 */
    kit.add(rbox(1.8, 7, 34, 0.8), M.armor, [tx + sx * 4.4, 16.5, 0]);
  }

  /* 底盘（填满履带之间，不能是空心的） */
  kit.add(rbox(30, 9, 44, 2.0), M.armorDark, [0, 9, 0]);

  /* 车体：楔形前倾 */
  kit.add(rbox(32, 9, 42, 2.6), M.armor, [0, 17, 0]);
  kit.add(rbox(30, 6, 14, 2.0), M.armor, [0, 22, 15], [0.18, 0, 0]);
  /* 首上装甲板 */
  kit.add(rbox(30, 2.0, 13, 1.0), M.armorLight, [0, 21.2, 14], [0.30, 0, 0]);
  /* 尾部散热格栅 */
  kit.add(rbox(22, 6, 3, 1.0), M.steelDark, [0, 19, -21]);
  for (let i = 0; i < 6; i++) {
    kit.add(box(20, 1.0, 0.8), M.armorDark, [0, 16.6 + i * 1.2, -21.4]);
  }
  /* 工具箱 */
  kit.add(rbox(10, 5, 14, 1.4), M.accent, [10.5, 22, -12]);
  kit.add(rbox(8, 4, 8, 1.0), M.accent, [-11, 21.5, -13]);

  /* ---- 炮塔（楔形，会转） ---- */
  const turret = new THREE.Group();
  turret.position.set(0, 24, -2);
  const tk = new Kit();
  tk.add(rbox(22, 11, 24, 2.6), M.armor, [0, 5, 0]);
  /* 楔形前脸 */
  tk.add(rbox(20, 9, 10, 2.0), M.armorLight, [0, 5.5, 13], [0.24, 0, 0]);
  /* 顶盖 + 舱盖 */
  tk.add(cyl(4.6, 4.6, 1.6, 12), M.armorDark, [-4, 11.4, -2]);
  tk.add(cyl(3.4, 3.4, 1.2, 10), M.steelDark, [-4, 12.4, -2]);
  /* 车长机枪 */
  tk.add(cyl(1.6, 1.8, 2.0, 8), M.steelDark, [6.5, 11.6, -2]);
  tk.add(rbox(1.6, 1.6, 9, 0.6), M.steelDark, [6.5, 12.4, 2]);
  /* 烟幕弹发射器 */
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      tk.add(cyl(1.0, 1.0, 3.2, 6), M.steelDark,
        [sx * 8, 10.4, 6 + i * 3.2], [Math.PI / 2, 0, sx * 0.2]);
    }
  }
  turret.add(tk.group('turret'));

  /* 主炮（可俯仰） */
  const gun = new THREE.Group();
  gun.position.set(0, 6, 12);
  const gk = new Kit();
  gk.add(cylZ(2.4, 2.6, 30, 12), M.steelDark, [0, 0, 15]);
  gk.add(cylZ(2.0, 2.0, 26, 10), M.steel, [0, 0, 17]);
  /* 炮口制退器 */
  gk.add(cylZ(3.2, 3.2, 5, 10), M.steelDark, [0, 0, 31]);
  gk.add(cylZ(2.4, 2.4, 1.2, 10), M.bore, [0, 0, 33.4]);
  gk.add(cylZ(3.6, 3.6, 1.4, 10), M.steel, [0, 0, 26]);
  /* 炮盾 */
  gk.add(rbox(9, 8, 4, 1.6), M.armor, [0, 0, 2]);
  gun.add(gk.group('gun'));
  turret.add(gun);

  /* 天线 */
  kit.put(tubeBetween([-11, 26, -8], [-13, 44, -12], 0.35, 4), M.steelDark);

  return { parts: kit, wheels, rotors, turret, gun, len: 46 };
}

/* ================================================================ 卡车 */

function truck(M) {
  const kit = new Kit();
  const wheels = [], rotors = [];
  const WR = 8.6;

  /* 大梁 */
  kit.add(rbox(26, 4, 54, 1.4), M.armorDark, [0, 9, 0]);

  /* 驾驶室 */
  kit.add(rbox(26, 15, 18, 2.6), M.armor, [0, 18.5, 18]);
  kit.add(rbox(24, 2.4, 14, 1.0), M.armorLight, [0, 26.4, 18]);
  /* 风挡 */
  kit.add(rbox(21, 9, 1.4, 0.6), M.glass, [0, 22.5, 27], [-0.18, 0, 0]);
  /* 格栅 */
  kit.add(rbox(22, 9, 2.0, 0.8), M.steelDark, [0, 15, 27.2]);
  for (let i = 0; i < 5; i++) {
    kit.add(box(20, 1.0, 0.8), M.steel, [0, 11.5 + i * 1.8, 28.2]);
  }
  /* 保险杠 */
  kit.add(rbox(27, 3.6, 3, 1.2), M.steelDark, [0, 10, 29]);
  /* 大灯 */
  for (const sx of [-1, 1]) {
    kit.add(cylZ(2.4, 2.4, 1.4, 10), M.steelDark, [sx * 9, 13.5, 28.4]);
    kit.add(cylZ(1.8, 1.8, 0.6, 10), M.glass, [sx * 9, 13.5, 29.2]);
  }
  /* 排气管竖在驾驶室后 */
  kit.add(cyl(1.8, 1.8, 20, 8), M.steelDark, [11.5, 24, 8]);
  kit.add(cyl(2.2, 2.2, 2.4, 8), M.steel, [11.5, 34.4, 8]);

  /* ---- 货厢：帆布篷（半圆筒） ---- */
  kit.add(rbox(28, 3, 34, 1.4), M.armor, [0, 12, -12]);
  /* 半圆柱 → 沿 Z 放倒，弧面朝上 */
  const cv = new THREE.CylinderGeometry(13, 13, 32, 16, 1, false, 0, Math.PI);
  cv.rotateX(Math.PI / 2);
  cv.rotateZ(Math.PI / 2);
  kit.add(cv, M.accent, [0, 16, -12], null, [1, 0.86, 1]);
  /* 篷布骨架 */
  for (let i = 0; i < 4; i++) {
    const rib = torus(13.2, 0.6, 14, 5, Math.PI);
    kit.add(rib, M.armorDark, [0, 16, -26 + i * 9.5], [0, Math.PI / 2, 0], [1, 0.86, 1]);
  }
  /* 尾板 */
  kit.add(rbox(26, 11, 2.4, 1.0), M.armorDark, [0, 16, -29]);
  kit.add(box(24, 1.2, 0.8), M.steelDark, [0, 12.5, -29.6]);
  /* 备胎 */
  kit.add(cylX(WR * 0.78, WR * 0.78, 3.4, 14), M.rubber, [0, 14, -30.5]);

  wheel(wheels, -12.5, WR, 18, WR, 5.4);
  wheel(wheels, 12.5, WR, 18, WR, 5.4);
  wheel(wheels, -12.5, WR, -8, WR, 5.4);
  wheel(wheels, 12.5, WR, -8, WR, 5.4);
  wheel(wheels, -12.5, WR, -19, WR, 5.4);
  wheel(wheels, 12.5, WR, -19, WR, 5.4);

  return { parts: kit, wheels, rotors, len: 56 };
}

/* ================================================================ 直升机 */

function heli(M) {
  const kit = new Kit();
  const wheels = [], rotors = [];
  const BY = 26;                  // 机身中心高度

  /* 机身：水滴形（前圆后收） */
  const fus = sphere(11, 20, 14);
  fus.scale(1.0, 0.92, 2.0);
  kit.add(fus, M.armor, [0, BY, 2]);
  /* 机腹 */
  kit.add(rbox(13, 5, 26, 2.4), M.armorDark, [0, BY - 8, 2]);
  /* 尾梁 */
  kit.add(cylZ(3.2, 5.6, 34, 10), M.armor, [0, BY + 2, -30], [-0.10, 0, 0]);
  /* 垂尾 */
  kit.add(rbox(1.8, 13, 8, 1.2), M.armor, [0, BY + 8, -46], [0, 0, 0]);
  /* 平尾 */
  kit.add(rbox(20, 1.4, 6, 0.7), M.armor, [0, BY + 5, -42]);

  /* 座舱盖 */
  const can = sphere(9.4, 18, 12, Math.PI * 0.62);
  can.scale(1.0, 0.85, 1.5);
  kit.add(can, M.glass, [0, BY + 4.5, 10]);
  /* 座舱框架 */
  for (const sx of [-1, 1]) {
    kit.put(tubeBetween([sx * 8.6, BY - 2, 8], [sx * 4.2, BY + 11, 12], 0.7, 5), M.steelDark);
  }
  /* 机鼻 */
  kit.add(sphere(6.4, 14, 10), M.armorLight, [0, BY - 1, 18], null, [1, 0.8, 0.9]);
  /* 下颌机炮 */
  kit.add(cyl(1.6, 1.6, 2.4, 8), M.steelDark, [0, BY - 7.5, 14]);
  kit.add(rbox(1.4, 1.4, 9, 0.5), M.steelDark, [0, BY - 8.5, 18]);

  /* 短翼 + 火箭巢 */
  for (const sx of [-1, 1]) {
    kit.add(rbox(13, 2.2, 8, 0.8), M.armor, [sx * 13, BY + 1, 3]);
    kit.add(cylZ(3.4, 3.4, 9, 10), M.armorDark, [sx * 18, BY - 1, 4]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      kit.add(cylZ(1.1, 1.1, 1.0, 8), M.bore,
        [sx * 18 + Math.cos(a) * 1.8, BY - 1 + Math.sin(a) * 1.8, 8.6]);
    }
  }

  /* 起落橇 */
  for (const sx of [-1, 1]) {
    kit.put(tubeBetween([sx * 7.5, 3, 12], [sx * 7.5, 3, -14], 0.9, 6), M.steelDark);
    kit.put(tubeBetween([sx * 7.5, 3, 12], [sx * 7.5, 3, -14], 0.9, 6), M.steelDark);
    for (const zz of [8, -8]) {
      kit.put(tubeBetween([sx * 7.5, 3, zz], [sx * 5.5, BY - 7, zz], 0.85, 5), M.steelDark);
    }
  }
  kit.add(cylX(0.8, 0.8, 16, 6), M.steelDark, [0, 3, 8]);
  kit.add(cylX(0.8, 0.8, 16, 6), M.steelDark, [0, 3, -8]);

  /* 主旋翼：桨毂 */
  kit.add(cyl(3.4, 4.2, 3.4, 10), M.steelDark, [0, BY + 13, 2]);
  kit.add(cyl(1.2, 1.2, 6, 8), M.steel, [0, BY + 16, 2]);

  rotors.push({ x: 0, y: BY + 18, z: 2, r: 30, n: 5 });
  rotors.push({ x: 0.9, y: BY + 8, z: -46, r: 7.5, n: 3, axis: 'z' });

  return { parts: kit, wheels, rotors, len: 52, air: true };
}

/* ================================================================ 轰炸机 */

function bomber(M) {
  const kit = new Kit();
  const wheels = [], rotors = [];
  const BY = 30;

  /* 机身：细长纺锤 */
  const fus = sphere(9, 20, 14);
  fus.scale(1.0, 0.95, 3.4);
  kit.add(fus, M.armor, [0, BY, 0]);
  /* 机鼻玻璃 */
  const nose = dome(8.4, 16, 10, Math.PI * 0.55);
  nose.scale(1, 0.95, 1.1);
  kit.add(nose, M.glass, [0, BY + 1, 24], [-1.1, 0, 0]);
  /* 机背隆起 */
  kit.add(rbox(11, 5, 26, 2.4), M.armorLight, [0, BY + 7, -2]);

  /* 后掠翼（左右各一，用压扁的盒子 + 旋转做后掠） */
  for (const sx of [-1, 1]) {
    const wing = rbox(40, 1.8, 16, 1.2);
    kit.add(wing, M.armor, [sx * 24, BY - 1, -2], [0, sx * -0.34, 0]);
    /* 翼尖小翼 */
    kit.add(rbox(1.6, 6, 6, 0.8), M.armorDark, [sx * 43, BY + 1, -10], [0, sx * -0.34, 0]);
    /* 发动机短舱（一翼两台） */
    for (const dx of [16, 30]) {
      kit.add(cylZ(4.0, 4.4, 14, 12), M.armorDark, [sx * dx, BY - 3, 2]);
      /* 进气口 */
      kit.add(cylZ(3.8, 3.8, 1.2, 12), M.bore, [sx * dx, BY - 3, 9.4]);
      /* 尾喷 */
      kit.add(cylZ(3.2, 3.4, 2.4, 12), M.steelDark, [sx * dx, BY - 3, -5.4]);
      kit.add(cylZ(2.6, 2.6, 0.8, 12), M.glow, [sx * dx, BY - 3, -6.6]);
      /* 螺旋桨 */
      rotors.push({ x: sx * dx, y: BY - 3, z: 10.6, r: 9.5, n: 3 });
    }
  }

  /* 尾翼 */
  kit.add(rbox(1.6, 14, 9, 1.0), M.armor, [0, BY + 9, -30]);
  kit.add(rbox(16, 1.4, 6, 0.7), M.armor, [0, BY + 3, -31]);

  /* 弹舱 */
  kit.add(rbox(12, 4, 18, 1.4), M.armorDark, [0, BY - 7, -2]);

  return { parts: kit, wheels, rotors, len: 60, air: true };
}

/* ================================================================ BOSS */

function boss(M) {
  const kit = new Kit();
  const wheels = [], rotors = [];

  /* 四条履带 */
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tx = sx * 26, tz = sz * 20;
      kit.add(rbox(12, 17, 26, 4.5), M.armorDark, [tx, 10.5, tz]);
      for (let i = 0; i < 6; i++) {
        kit.add(box(12.6, 1.8, 3.2), M.steelDark, [tx, 19.4, tz - 10 + i * 4]);
        kit.add(box(12.6, 1.8, 3.2), M.steelDark, [tx, 1.8, tz - 10 + i * 4]);
      }
      for (let i = 0; i < 3; i++) {
        wheel(wheels, tx, 10.5, tz - 8 + i * 8, 6.4, 5.0);
      }
    }
  }

  /* 主车体：厚重的装甲盒 */
  kit.add(rbox(52, 16, 58, 3.4), M.armorDark, [0, 12, 0]);
  kit.add(rbox(54, 12, 54, 3.0), M.armor, [0, 24, 0]);
  /* 首上斜装甲 */
  kit.add(rbox(48, 10, 16, 2.6), M.armorLight, [0, 27, 26], [0.34, 0, 0]);
  /* 侧面装甲裙板（分块，露出接缝） */
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      kit.add(rbox(2.6, 12, 14, 1.0), M.armorDark, [sx * 27.4, 22, -18 + i * 18]);
    }
  }
  /* 尾部排气 */
  for (const sx of [-1, 1]) {
    kit.add(cylZ(4.2, 4.6, 6, 10), M.steelDark, [sx * 16, 20, -30]);
    kit.add(cylZ(3.4, 3.4, 1.0, 10), M.glow, [sx * 16, 20, -33]);
  }

  /* ---- 双主炮塔 ---- */
  const turret = new THREE.Group();
  turret.position.set(0, 30, 4);
  const tk = new Kit();
  tk.add(rbox(40, 13, 36, 3.0), M.armor, [0, 6.5, 0]);
  tk.add(rbox(34, 4, 26, 1.6), M.armorLight, [0, 13.4, 0]);
  /* 两根主炮 */
  const guns = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * 10, 7, 18);
    const gk = new Kit();
    gk.add(cylZ(2.8, 3.0, 34, 12), M.steelDark, [0, 0, 17]);
    gk.add(cylZ(2.2, 2.2, 30, 10), M.steel, [0, 0, 19]);
    gk.add(cylZ(3.8, 3.8, 5.4, 10), M.steelDark, [0, 0, 35]);
    gk.add(cylZ(2.8, 2.8, 1.2, 10), M.bore, [0, 0, 37.8]);
    g.add(gk.group('g'));
    turret.add(g);
    guns.push(g);
  }
  /* 导弹巢（炮塔两侧） */
  for (const sx of [-1, 1]) {
    tk.add(rbox(10, 12, 16, 1.6), M.armorDark, [sx * 24, 6, -2]);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        tk.add(cylZ(1.9, 1.9, 2.0, 8), M.bore,
          [sx * 24 + (j - 0.5) * 4, 2 + i * 4, 6.4]);
      }
    }
  }
  /* 雷达 */
  const radar = new THREE.Group();
  radar.position.set(0, 15, -14);
  const rk = new Kit();
  rk.add(cyl(1.4, 1.4, 6, 8), M.steelDark, [0, -3, 0]);
  const dg = sphere(9, 18, 10);
  dg.scale(1, 0.28, 1);
  rk.add(dg, M.steelLight, [0, 0, 0], [0.6, 0, 0]);
  rk.add(sphere(1.4, 8, 6), M.glow, [0, 4, 3]);
  radar.add(rk.group('radar'));
  turret.add(radar);

  turret.add(tk.group('boss-turret'));

  return { parts: kit, wheels, rotors, turret, guns, radar, len: 66 };
}

/* ================================================================ 装配 */

const BUILDERS = {
  runner, infantry, commando, truck, heli, bomber, boss,
};

/**
 * 建一种敌人。返回**已按材质合并、且所有子结构都烘进车身**的几何清单，
 * 由 world 按材质做 InstancedMesh（几十个敌人 ≈ 7 个的开销）。
 *
 * 为什么把炮塔/炮管也烘进车身：这个游戏里敌方载具不会瞄准，
 * 炮口永远朝车头。既然如此，让它们随车身一起做实例化，
 * 就能省掉一整套子节点的变换与 draw call。
 */
export function buildEnemy(kind, ctx, materials) {
  const M = materials[kind];
  const R = BUILDERS[kind](M);
  const kit = R.parts;

  /* 把会"动"但实际不动的子结构，按局部矩阵烘进车身 */
  const bake = (grp) => {
    if (!grp) return;
    grp.updateMatrixWorld(true);
    grp.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      /* o.matrixWorld 已经包含了相对 grp 根的变换链 */
      g.applyMatrix4(o.matrixWorld);
      kit.put(g, o.material);
    });
  };
  bake(R.turret);
  if (R.guns) R.guns.forEach(bake);

  /* 车身：按材质合并成若干几何 */
  const merged = [];
  for (const [mat, geos] of kit.buckets) {
    if (!geos.length) continue;
    let g = geos[0];
    if (geos.length > 1) {
      try {
        const mm = mergeMany(geos);
        if (mm) { geos.forEach(x => x.dispose()); g = mm; }
      } catch (e) { /* 保留首个 */ }
    }
    merged.push({ geo: g, mat });
  }

  return {
    kind,
    parts: merged,
    wheels: R.wheels,
    rotors: R.rotors,
    len: R.len,
    air: !!R.air,
  };
}

function mergeMany(list) {
  /* 复用 geo.js 里的归一化 + mergeGeometries */
  const norm = (g) => {
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (!g.index) {
      const n = g.attributes.position.count;
      const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    g.morphAttributes = {};
    g.clearGroups();
    return g;
  };
  return mergeGeometries(list.map(norm), false);
}

/** 单位材质（按 kind 缓存） */
export function enemyMaterials(ctx) {
  if (ctx.enemyMats) return ctx.enemyMats;
  const out = {};
  for (const k in ENEMY_PAL) out[k] = makeMaterials(ctx.envTex, ENEMY_PAL[k]);
  ctx.enemyMats = out;
  return out;
}
