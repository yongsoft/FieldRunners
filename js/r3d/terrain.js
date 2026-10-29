/* ============================================================
   r3d/terrain.js — 3D 地形

   坐标约定：canvasX → world.x，canvasY → world.z（= y / K），高度 → world.y。
   所以整张地图在 3D 里就是一块 1280 × 1252 的地面（Z 被拉长 1/0.46）。

   河流和台地不是「一格一格的方块」：先把格子并集抽成轮廓折线，
   再做等距重采样 + Chaikin 平滑 + 沿法线叠正弦扰动，
   得到自然曲线，然后用 ShapeUtils 三角化 → 有厚度、有崖壁的 3D 体。
   这套「有机化」算法是从 2D 版本沿用下来的，保证 3D 与旧美术形状一致。
   ============================================================ */
import * as THREE from 'three';
import {
  K, VIEW_W, VIEW_H, cz, makeMaterials,
} from './core.js';
import { groundMaps, waterNormal, metalRoughness, contactShadow } from './tex.js';
import { rbox, cyl, box, tubeBetween, sphere, torus, cone, plane, DEG } from './geo.js';

const CELL = 64;
const COLS = 20;
const ROWS = 9;

/* ---------------------------------------------------------------- 有机轮廓 */

function keySetOf(cells) {
  return new Set(cells.map(p => p[0] + ',' + p[1]));
}

function boundaryLoops(keySet) {
  const edges = new Map();
  const Kf = (px, py) => px + ',' + py;
  for (const k of keySet) {
    const p = k.split(','), c = +p[0], r = +p[1];
    const x0 = c * CELL, y0 = r * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
    if (!keySet.has(c + ',' + (r - 1))) edges.set(Kf(x0, y0), Kf(x1, y0));
    if (!keySet.has((c + 1) + ',' + r)) edges.set(Kf(x1, y0), Kf(x1, y1));
    if (!keySet.has(c + ',' + (r + 1))) edges.set(Kf(x1, y1), Kf(x0, y1));
    if (!keySet.has((c - 1) + ',' + r)) edges.set(Kf(x0, y1), Kf(x0, y0));
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

/* 沿外法线外扩 + 双层谐波扰动（单层会变成规则的扇贝边） */
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

function loopCycles(pts, wave) {
  let per = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    per += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return Math.max(3, Math.round(per / (wave || 240)));
}

function organicLoops(cells, step, iter) {
  return boundaryLoops(keySetOf(cells)).map(l => smoothLoop(l, step || 15, iter === undefined ? 2 : iter));
}

/* ---------------------------------------------------------------- 网格构造 */

function planarUV(g, scale, y = 0) {
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / scale;
    uv[i * 2 + 1] = pos.getZ(i) / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** 把 canvas 坐标的闭合折线三角化成水平面片 */
function flatPoly(pts, y, uvScale = 64) {
  const contour = pts.map(p => new THREE.Vector2(p[0], p[1] / K));
  let tris = [];
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
  const pos = [];
  for (const t of tris) {
    for (const idx of t) {
      const p = pts[idx];
      pos.push(p[0], y, p[1] / K);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return planarUV(g, uvScale);
}

/** 由闭合折线拉出的竖直侧壁（崖壁、河岸、基地墙） */
function wallPoly(pts, y0, y1, uvScale = 48) {
  const pos = [], uv = [];
  const n = pts.length;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const ax = a[0], az = a[1] / K, bx = b[0], bz = b[1] / K;
    /* 两个三角形 */
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz);
    pos.push(ax, y0, az, bx, y1, bz, ax, y1, az);
    const seg = Math.hypot(bx - ax, bz - az);
    uv.push(len / uvScale, 0, (len + seg) / uvScale, 0, (len + seg) / uvScale, (y1 - y0) / uvScale);
    uv.push(len / uvScale, 0, (len + seg) / uvScale, (y1 - y0) / uvScale, len / uvScale, (y1 - y0) / uvScale);
    len += seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** 沿折线的窄飘带（浪花、岸边亮边）—— 平铺在地面上 */
function ribbon(pts, y, wIn, wOut, uvScale = 40) {
  const pos = [], uv = [];
  const n = pts.length;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
    const nx = ty, ny = -tx;
    const i0 = [p[0] + nx * wIn, p[1] + ny * wIn];
    const i1 = [p[0] + nx * wOut, p[1] + ny * wOut];
    const j = (i + 1) % n;
    const q = pts[j], qa = pts[(j - 1 + n) % n], qb = pts[(j + 1) % n];
    let tx2 = qb[0] - qa[0], ty2 = qb[1] - qa[1];
    const L2 = Math.hypot(tx2, ty2) || 1; tx2 /= L2; ty2 /= L2;
    const nx2 = ty2, ny2 = -tx2;
    const j0 = [q[0] + nx2 * wIn, q[1] + ny2 * wIn];
    const j1 = [q[0] + nx2 * wOut, q[1] + ny2 * wOut];

    pos.push(i0[0], y, i0[1] / K, j0[0], y, j0[1] / K, j1[0], y, j1[1] / K);
    pos.push(i0[0], y, i0[1] / K, j1[0], y, j1[1] / K, i1[0], y, i1[1] / K);
    const seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
    uv.push(len / uvScale, 0, (len + seg) / uvScale, 0, (len + seg) / uvScale, 1);
    uv.push(len / uvScale, 0, (len + seg) / uvScale, 1, len / uvScale, 1);
    len += seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- 建造 */

const ROCK = { grass: '#6a6a58', desert: '#8a6c48', snow: '#6c7885' };
const TOP = { grass: '#5f8d2e', desert: '#a8874f', snow: '#9dafc0' };

export class Terrain {
  constructor(ctx, map) {
    this.ctx = ctx;
    this.map = map;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.water = null;
    this.tick = 0;
    this._build();
  }

  /** 每个格子对应的地形字符 */
  _tile(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return '.';
    const row = this.map.terrain[r];
    return row ? (row[c] || '.') : '.';
  }

  _cells(ch) {
    const out = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) if (this._tile(c, r) === ch) out.push([c, r]);
    }
    return out;
  }

  _build() {
    const { scene, envTex } = this.ctx;
    const theme = this.map.theme || 'grass';
    this.theme = theme;

    const gm = groundMaps(theme);
    /* 512px 贴图覆盖 512 世界单位 = 1 纹素 : 1 屏幕像素，细节最锐。
       之前用 2.5 倍重复（一个 tile 只覆盖 205 单位）会把细节全部 mip 掉。 */
    const rep = 1.0;
    for (const t of [gm.map, gm.normalMap, gm.roughnessMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rep, rep * 1.05);
    }

    const rough = metalRoughness();

    this.mat = {
      ground: new THREE.MeshStandardMaterial({
        map: gm.map, normalMap: gm.normalMap, roughnessMap: gm.roughnessMap,
        metalness: 0.02, roughness: 0.95, envMap: envTex, envMapIntensity: 0.20,
        color: 0xffffff,
      }),
      groundNormalScale: 1,
      rock: new THREE.MeshStandardMaterial({
        color: ROCK[theme] || ROCK.grass, metalness: 0.05, roughness: 0.92,
        envMap: envTex, envMapIntensity: 0.4, side: THREE.DoubleSide,
        flatShading: true,
      }),
      top: new THREE.MeshStandardMaterial({
        color: TOP[theme] || TOP.grass, metalness: 0.04, roughness: 0.86,
        envMap: envTex, envMapIntensity: 0.45, side: THREE.DoubleSide,
      }),
      grain: new THREE.MeshStandardMaterial({
        color: '#20242a', metalness: 0.1, roughness: 0.9,
        envMap: envTex, envMapIntensity: 0.3,
      }),
      wood: new THREE.MeshStandardMaterial({
        color: '#6b4a24', metalness: 0.05, roughness: 0.78,
        envMap: envTex, envMapIntensity: 0.3,
      }),
      stone: new THREE.MeshStandardMaterial({
        color: '#8d8b7e', metalness: 0.06, roughness: 0.88,
        envMap: envTex, envMapIntensity: 0.4, flatShading: true,
      }),
      plaster: new THREE.MeshStandardMaterial({
        color: '#c9b89a', metalness: 0.03, roughness: 0.82,
        envMap: envTex, envMapIntensity: 0.3,
      }),
      roof: new THREE.MeshStandardMaterial({
        color: '#8a3a24', metalness: 0.08, roughness: 0.62,
        envMap: envTex, envMapIntensity: 0.5, flatShading: true,
      }),
      gold: new THREE.MeshStandardMaterial({
        color: '#c9a13c', metalness: 0.95, roughness: 0.28,
        envMap: envTex, envMapIntensity: 1.2,
      }),
      flag: new THREE.MeshStandardMaterial({
        color: '#b3261e', metalness: 0.05, roughness: 0.7,
        envMap: envTex, envMapIntensity: 0.4, side: THREE.DoubleSide,
      }),
      glowRed: new THREE.MeshStandardMaterial({
        color: '#2a0806', emissive: '#ff3a26', emissiveIntensity: 2.6, roughness: 0.5,
      }),
    };

    this._ground();
    this._fieldEdge();
    this._river();
    this._hills();
    this._houses();
    this._base();
    this._decor();
    this._spawnMarks();

    scene.add(this.group);
  }

  /* ---- 地面 ---- */
  _ground() {
    const zc = cz(VIEW_H / 2);
    const g = plane(1460, 1520);
    planarUV(g, 512);
    const mesh = new THREE.Mesh(g, this.mat.ground);
    mesh.rotation.y = 0;
    mesh.position.set(VIEW_W / 2, 0, zc);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.ground = mesh;
  }

  /* ---- 场地边缘的石砌路缘：让地图看起来是「一块场地」而不是无限平面 ---- */
  _fieldEdge() {
    const h = 5, w = 7;
    const H = VIEW_H;
    const add = (x, z, sx, sz) => {
      const m = new THREE.Mesh(rbox(sx, h, sz, 1.6, 1), this.mat.stone);
      m.position.set(x, h / 2 - 1.5, cz(z));
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    };
    add(VIEW_W / 2, -w / 2 + 1, VIEW_W + w * 2, w);
    add(VIEW_W / 2, H + w / 2 - 1, VIEW_W + w * 2, w);
    add(-w / 2 + 1, H / 2, w, H);
    add(VIEW_W + w / 2 - 1, H / 2, w, H);
  }

  /* ---- 河流 + 浅滩 ---- */
  _river() {
    const riverCells = this._cells('~');
    const fordCells = this._cells('=');
    if (!riverCells.length && !fordCells.length) return;

    const all = riverCells.concat(fordCells);
    const loops = organicLoops(all, 15, 2);
    if (!loops.length) return;

    const waterN = waterNormal();
    waterN.wrapS = waterN.wrapT = THREE.RepeatWrapping;
    waterN.repeat.set(1 / 90, 1 / 90);

    const waterMat = new THREE.MeshStandardMaterial({
      color: '#123c4d',
      metalness: 0.10,
      roughness: 0.10,
      normalMap: waterN,
      normalScale: new THREE.Vector2(0.85, 0.85),
      transparent: true,
      opacity: 0.90,
      envMap: this.ctx.envTex,
      envMapIntensity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.water = waterMat;
    this.waterN = waterN;

    /* 河床：比水面低 7，深色，让水有"厚度" */
    const bedMat = new THREE.MeshStandardMaterial({
      color: '#1b2a24', metalness: 0.02, roughness: 0.95,
      envMap: this.ctx.envTex, envMapIntensity: 0.2, side: THREE.DoubleSide,
    });

    const bankMat = new THREE.MeshStandardMaterial({
      color: '#6e6244', metalness: 0.03, roughness: 0.94,
      envMap: this.ctx.envTex, envMapIntensity: 0.3, side: THREE.DoubleSide,
      flatShading: true,
    });

    for (const raw of loops) {
      const cyc = loopCycles(raw, 200);
      /* 三层同心：河床 → 水面 → 浪花 */
      const bed = organicPts(raw, 1.5, 2.2, cyc, 0.7);
      const wet = organicPts(raw, -1.1, 1.4, cyc, 1.9);

      this.group.add(new THREE.Mesh(flatPoly(bed, -7.5, 48), bedMat));

      /* 岸壁：从 -7.5 拉到 +3 */
      const wall = new THREE.Mesh(wallPoly(bed, -7.5, 3.2, 42), bankMat);
      wall.receiveShadow = true;
      this.group.add(wall);

      const surf = new THREE.Mesh(flatPoly(wet, 1.1, 90), waterMat);
      surf.renderOrder = 2;
      this.group.add(surf);

      /* 岸顶草沿：压一圈深色，遮住水面与地面的接缝 */
      const lipMat = new THREE.MeshStandardMaterial({
        color: '#4c5a2a', metalness: 0.03, roughness: 0.9,
        envMap: this.ctx.envTex, envMapIntensity: 0.3,
        side: THREE.DoubleSide, transparent: true, opacity: 0.9,
      });
      const lip = new THREE.Mesh(ribbon(organicPts(raw, 0.4, 0, 0), 3.4, 0, 3.2, 60), lipMat);
      this.group.add(lip);

      /* 浪花：贴着水面的白色窄带，加法混合 */
      const foamMat = new THREE.MeshBasicMaterial({
        color: 0xdff2ff, transparent: true, opacity: 0.30,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const foam = new THREE.Mesh(ribbon(organicPts(raw, -1.6, 1.4, cyc, 0.3), 1.35, 0, 3.6, 55), foamMat);
      foam.renderOrder = 3;
      this.group.add(foam);
      if (!this.foams) this.foams = [];
      this.foams.push(foamMat);
    }

    /* 浅滩：整体抬高一点、颜色更亮、粗糙度更低（能看见沙底） */
    if (fordCells.length) {
      const fl = organicLoops(fordCells, 14, 2);
      const fordMat = new THREE.MeshStandardMaterial({
        color: '#3f7f86', metalness: 0.08, roughness: 0.16,
        normalMap: waterN, normalScale: new THREE.Vector2(0.6, 0.6),
        transparent: true, opacity: 0.62,
        envMap: this.ctx.envTex, envMapIntensity: 1.0, side: THREE.DoubleSide, depthWrite: false,
      });
      for (const raw of fl) {
        const p = organicPts(raw, 0, 1.2, loopCycles(raw, 180), 2.2);
        const m = new THREE.Mesh(flatPoly(p, 1.6, 80), fordMat);
        m.renderOrder = 4;
        this.group.add(m);
      }
    }
  }

  /* ---- 高地 ---- */
  _hills() {
    const cells = this._cells('^');
    if (!cells.length) return;
    const loops = organicLoops(cells, 15, 2);
    const H = 22;

    for (const raw of loops) {
      const cyc = loopCycles(raw, 220);
      const base = organicPts(raw, 0.5, 2.4, cyc, 0.9);
      const top = organicPts(raw, -2.6, 1.6, cyc, 2.4);

      /* 崖壁 */
      const wall = new THREE.Mesh(wallPoly(base, -1, H, 40), this.mat.rock);
      wall.castShadow = true; wall.receiveShadow = true;
      this.group.add(wall);

      /* 崖顶草皮（略微缩进，露出石檐） */
      const capMesh = new THREE.Mesh(flatPoly(top, H + 0.35, 70), this.mat.top);
      capMesh.receiveShadow = true;
      capMesh.castShadow = true;
      this.group.add(capMesh);

      /* 石檐：崖顶一圈凸出的岩石，边缘能吃到高光，立体感主要来自这条 */
      const ledge = new THREE.Mesh(wallPoly(organicPts(raw, -0.6, 1.2, cyc, 2.4), H - 2.2, H + 0.5, 34), this.mat.rock);
      this.group.add(ledge);

      /* 崖顶草簇：沿轮廓撒一圈，柔化生硬的边界 */
      const grassGeo = this._tuftGeo();
      const count = Math.min(70, Math.floor(raw.length * 0.55));
      const inst = new THREE.InstancedMesh(grassGeo, this.mat.top, count);
      const mtx = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        const p = top[Math.floor((i / count) * top.length)];
        v.set(p[0] + (Math.random() - 0.5) * 8, H + 0.2, p[1] / K + (Math.random() - 0.5) * 8);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
        const sc = 0.7 + Math.random() * 0.7;
        s.set(sc, sc, sc);
        mtx.compose(v, q, s);
        inst.setMatrixAt(i, mtx);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = false; inst.receiveShadow = true;
      this.group.add(inst);
    }
  }

  /* ---- 房屋 ---- */
  _houses() {
    const cells = this._cells('#');
    if (!cells.length) return;

    /* 相邻的房屋并成一栋，而不是一格一间 —— 看起来才像村子 */
    const seen = new Set();
    for (const [c0, r0] of cells) {
      const k0 = c0 + ',' + r0;
      if (seen.has(k0)) continue;
      const stack = [[c0, r0]];
      const comp = [];
      while (stack.length) {
        const [c, r] = stack.pop();
        const kk = c + ',' + r;
        if (seen.has(kk) || this._tile(c, r) !== '#') continue;
        seen.add(kk);
        comp.push([c, r]);
        stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
      }
      if (!comp.length) continue;

      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [c, r] of comp) {
        x0 = Math.min(x0, c * CELL); y0 = Math.min(y0, r * CELL);
        x1 = Math.max(x1, (c + 1) * CELL); y1 = Math.max(y1, (r + 1) * CELL);
      }
      const w = x1 - x0, d = y1 - y0;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const shrink = 7;
      const W = w - shrink * 2, D = d - shrink * 2;

      const g = new THREE.Group();
      g.position.set(cx, 0, cz(cy));

      /* 石基 */
      const base = new THREE.Mesh(rbox(W + 6, 8, D + 6, 1.6), this.mat.stone);
      base.position.y = 2;
      base.castShadow = true; base.receiveShadow = true;
      g.add(base);

      /* 墙体 */
      const wallH = 24 + Math.min(10, (W + D) * 0.06);
      const body = new THREE.Mesh(rbox(W, wallH, D, 1.4), this.mat.plaster);
      body.position.y = 6 + wallH / 2;
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);

      /* 屋顶：两坡，用旋转 45° 的盒子做屋脊更省面数 */
      const roofH = 13;
      const roofGeo = new THREE.CylinderGeometry(0, Math.hypot(W, D) * 0.5, roofH, 4, 1);
      roofGeo.rotateY(Math.PI / 4);
      roofGeo.scale(1.06, 1, (D / W) * 1.06);
      const roof = new THREE.Mesh(roofGeo, this.mat.roof);
      roof.position.y = 6 + wallH + roofH / 2 - 1;
      roof.castShadow = true; roof.receiveShadow = true;
      g.add(roof);

      /* 木梁：屋角四根外露的柱子 */
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const beam = new THREE.Mesh(box(3.2, wallH + 2, 3.2), this.mat.wood);
        beam.position.set(sx * (W / 2 - 1), 6 + wallH / 2, sz * (D / 2 - 1));
        beam.castShadow = true;
        g.add(beam);
      }

      /* 窗：暖光，夜里也有生气 */
      const winMat = new THREE.MeshStandardMaterial({
        color: '#2a1a08', emissive: '#ffb45a', emissiveIntensity: 1.5, roughness: 0.5,
      });
      const nw = Math.max(1, Math.floor(W / 26));
      for (let i = 0; i < nw; i++) {
        const wx = -W / 2 + (W / (nw + 1)) * (i + 1);
        for (const sz of [-1, 1]) {
          const win = new THREE.Mesh(box(9, 11, 1.6), winMat);
          win.position.set(wx, 6 + wallH * 0.58, sz * (D / 2 + 0.2));
          g.add(win);
          const frame = new THREE.Mesh(box(11, 13, 1.0), this.mat.wood);
          frame.position.set(wx, 6 + wallH * 0.58, sz * (D / 2 + 0.9));
          g.add(frame);
        }
      }

      /* 烟囱 */
      if (W > 40) {
        const ch = new THREE.Mesh(box(8, 22, 8), this.mat.stone);
        ch.position.set(W * 0.28, 6 + wallH + 6, -D * 0.2);
        ch.castShadow = true;
        g.add(ch);
      }

      this.group.add(g);
    }
  }

  /* ---- 基地 ---- */
  _base() {
    const cells = this._cells('B');
    if (!cells.length) return;
    const loops = organicLoops(cells, 14, 2);
    if (!loops.length) return;

    const raw = loops[0];
    const cyc = loopCycles(raw, 200);
    const base = organicPts(raw, 1.0, 1.0, cyc, 1.1);
    const inner = organicPts(raw, -6, 0, cyc, 0);

    /* 平台 */
    const plat = new THREE.Mesh(wallPoly(base, -1, 16, 40), this.mat.stone);
    plat.castShadow = true; plat.receiveShadow = true;
    this.group.add(plat);
    const deck = new THREE.Mesh(flatPoly(inner, 16.4, 60), this.mat.stone);
    deck.receiveShadow = true;
    this.group.add(deck);

    /* 中心塔楼 */
    const cx = raw.reduce((s, p) => s + p[0], 0) / raw.length;
    const cy = raw.reduce((s, p) => s + p[1], 0) / raw.length;

    const tower = new THREE.Group();
    tower.position.set(cx, 16, cz(cy));

    const drum = new THREE.Mesh(cyl(26, 30, 46, 12), this.mat.stone);
    drum.position.y = 23;
    drum.castShadow = true; drum.receiveShadow = true;
    tower.add(drum);

    const band = new THREE.Mesh(cyl(31, 31, 4, 12), this.mat.gold);
    band.position.y = 40;
    tower.add(band);

    const roof = new THREE.Mesh(cone(34, 22, 12), this.mat.roof);
    roof.position.y = 57;
    roof.castShadow = true;
    tower.add(roof);

    /* 塔顶尖与旗帜 */
    const spire = new THREE.Mesh(cyl(0.9, 0.9, 18, 6), this.mat.gold);
    spire.position.y = 76;
    tower.add(spire);

    const flagGeo = new THREE.PlaneGeometry(22, 12, 8, 2);
    const fp = flagGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i);
      fp.setZ(i, Math.sin(x * 0.35) * 1.6);
    }
    flagGeo.computeVertexNormals();
    const flag = new THREE.Mesh(flagGeo, this.mat.flag);
    flag.position.set(11.5, 79, 0);
    tower.add(flag);
    this.flag = flag;

    /* 拱门：面向镜头 */
    const gate = new THREE.Mesh(rbox(26, 22, 6, 1.4), this.mat.wood);
    gate.position.set(0, 12, 30);
    tower.add(gate);

    /* 四个角楼 */
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const r = 40;
      const t = new THREE.Mesh(cyl(9, 11, 30, 8), this.mat.stone);
      t.position.set(Math.cos(a) * r, 30, Math.sin(a) * r);
      t.castShadow = true;
      tower.add(t);
      const c2 = new THREE.Mesh(cone(12, 12, 8), this.mat.roof);
      c2.position.set(Math.cos(a) * r, 51, Math.sin(a) * r);
      tower.add(c2);
    }

    this.group.add(tower);
    this.baseTower = tower;
  }

  /* ---- 草簇几何（被多处复用） ---- */
  _tuftGeo() {
    if (this._tuft) return this._tuft;
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const g = new THREE.PlaneGeometry(7, 10);
      g.translate(0, 5, 0);
      g.rotateY(a);
      parts.push(g);
    }
    /* 手工合并（只有 3 片，不值得引 mergeGeometries） */
    const pos = [], norm = [], uv = [];
    for (const p of parts) {
      const P = p.attributes.position.array, N = p.attributes.normal.array, U = p.attributes.uv.array;
      pos.push(...P); norm.push(...N); uv.push(...U);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this._tuft = g;
    return g;
  }

  /* ---- 装饰：树 / 石头 / 仙人掌 / 雪松 ---- */
  _decor() {
    const theme = this.theme;
    const spots = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this._tile(c, r) !== '.') continue;
        /* 只放在紧邻障碍物的格子上：既不挡视线，也不占玩家的建造决策空间 */
        const near = this._tile(c - 1, r) !== '.' || this._tile(c + 1, r) !== '.'
          || this._tile(c, r - 1) !== '.' || this._tile(c, r + 1) !== '.';
        if (!near) continue;
        if (Math.random() > 0.78) continue;
        const cx = c * CELL + CELL / 2 + (Math.random() - 0.5) * 30;
        const cy = r * CELL + CELL / 2 + (Math.random() - 0.5) * 30;
        spots.push([cx, cy]);
      }
    }

    /* 零星撒在空地上极小的草簇：提供尺度参照 */
    const tufts = [];
    for (let i = 0; i < 1100; i++) {
      const c = Math.floor(Math.random() * COLS), r = Math.floor(Math.random() * ROWS);
      if (this._tile(c, r) !== '.') continue;
      tufts.push([c * CELL + Math.random() * CELL, r * CELL + Math.random() * CELL]);
    }
    if (tufts.length) {
      const tuftMat = new THREE.MeshStandardMaterial({
        color: theme === 'snow' ? '#cfe0ee' : (theme === 'desert' ? '#a89050' : '#4e7a24'),
        metalness: 0.0, roughness: 0.92, side: THREE.DoubleSide,
        envMap: this.ctx.envTex, envMapIntensity: 0.3,
      });
      const g = this._tuftGeo();
      const inst = new THREE.InstancedMesh(g, tuftMat, tufts.length);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(),
        s = new THREE.Vector3(), v = new THREE.Vector3();
      tufts.forEach((p, i) => {
        v.set(p[0], 0, cz(p[1]));
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
        const sc = 0.55 + Math.random() * 0.75;
        s.set(sc, sc, sc);
        mtx.compose(v, q, s);
        inst.setMatrixAt(i, mtx);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.receiveShadow = true;
      this.group.add(inst);
    }

    /* 灌木：铺在**格子边缘**，中心留空给玩家看清可建造区域 */
    const bushes = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this._tile(c, r) !== '.') continue;
        if (Math.random() > 0.30) continue;
        const corner = Math.floor(Math.random() * 4);
        const ox = (corner & 1) ? 1 : -1;
        const oy = (corner & 2) ? 1 : -1;
        bushes.push([
          c * CELL + CELL / 2 + ox * (CELL * 0.36 + Math.random() * 6),
          r * CELL + CELL / 2 + oy * (CELL * 0.36 + Math.random() * 6),
        ]);
      }
    }
    if (bushes.length) {
      const bushMat = new THREE.MeshStandardMaterial({
        color: theme === 'snow' ? '#8fa6a0' : (theme === 'desert' ? '#6b7440' : '#2f5a1a'),
        metalness: 0.02, roughness: 0.88, envMap: this.ctx.envTex,
        envMapIntensity: 0.28, flatShading: true,
      });
      const bg = new THREE.IcosahedronGeometry(1, 0);
      const inst = new THREE.InstancedMesh(bg, bushMat, bushes.length);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(),
        sc3 = new THREE.Vector3(), v = new THREE.Vector3();
      bushes.forEach((p, i) => {
        v.set(p[0], 0, cz(p[1]));
        q.setFromEuler(new THREE.Euler(0, Math.random() * 6.28, 0));
        const sc = 5.5 + Math.random() * 5.0;
        sc3.set(sc, sc * (0.7 + Math.random() * 0.4), sc);
        mtx.compose(v, q, sc3);
        inst.setMatrixAt(i, mtx);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true; inst.receiveShadow = true;
      this.group.add(inst);
    }

    if (!spots.length) return;

    /* 树：树干 + 三层锥体（雪地换成深绿针叶） */
    const trunkMat = new THREE.MeshStandardMaterial({
      color: '#4a3520', metalness: 0.02, roughness: 0.9,
      envMap: this.ctx.envTex, envMapIntensity: 0.25,
    });
    const leafCol = theme === 'snow' ? '#2f4c2a' : (theme === 'desert' ? '#6d7a34' : '#3e6b1e');
    const leafMat = new THREE.MeshStandardMaterial({
      color: leafCol, metalness: 0.02, roughness: 0.86,
      envMap: this.ctx.envTex, envMapIntensity: 0.35, flatShading: true,
    });

    const trunkGeo = cyl(2.0, 3.0, 16, 6);
    const leafParts = [];
    for (let i = 0; i < 3; i++) {
      const r = 13 - i * 3.4;
      const h = 15 - i * 1.6;
      const c = new THREE.ConeGeometry(r, h, 7, 1);
      c.translate(0, 14 + i * 8.4, 0);
      leafParts.push(c);
    }
    const mergeLeaf = (() => {
      const pos = [], norm = [], uv = [];
      for (const p of leafParts) {
        pos.push(...p.attributes.position.array);
        norm.push(...p.attributes.normal.array);
        uv.push(...p.attributes.uv.array);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return g;
    })();

    const nT = spots.length;
    const iTrunk = new THREE.InstancedMesh(trunkGeo, trunkMat, nT);
    const iLeaf = new THREE.InstancedMesh(mergeLeaf, leafMat, nT);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(),
      s = new THREE.Vector3(), v = new THREE.Vector3();
    spots.forEach((p, i) => {
      v.set(p[0], 0, cz(p[1]));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
      const sc = 0.75 + Math.random() * 0.55;
      s.set(sc, sc, sc);
      mtx.compose(v, q, s);
      iTrunk.setMatrixAt(i, mtx);
      iLeaf.setMatrixAt(i, mtx);
    });
    iTrunk.instanceMatrix.needsUpdate = true;
    iLeaf.instanceMatrix.needsUpdate = true;
    iTrunk.castShadow = true; iTrunk.receiveShadow = true;
    iLeaf.castShadow = true; iLeaf.receiveShadow = true;
    this.group.add(iTrunk, iLeaf);

    /* 石头：贴着地面，给地面一点硬边 */
    const rockMat = new THREE.MeshStandardMaterial({
      color: theme === 'snow' ? '#9fb0be' : '#8b8375',
      metalness: 0.05, roughness: 0.9, envMap: this.ctx.envTex,
      envMapIntensity: 0.4, flatShading: true,
    });
    const nR = Math.min(46, Math.floor(nT * 0.5));
    const iRock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(5, 0), rockMat, Math.max(1, nR));
    for (let i = 0; i < nR; i++) {
      const p = spots[(i * 7) % nT];
      v.set(p[0] + (Math.random() - 0.5) * 26, 1.5, cz(p[1] + (Math.random() - 0.5) * 26));
      q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6.28, Math.random()));
      const sc = 0.5 + Math.random() * 0.9;
      s.set(sc, sc * 0.7, sc);
      mtx.compose(v, q, s);
      iRock.setMatrixAt(i, mtx);
    }
    iRock.instanceMatrix.needsUpdate = true;
    iRock.castShadow = true; iRock.receiveShadow = true;
    this.group.add(iRock);
  }

  /* ---- 出生点标记 ---- */
  _spawnMarks() {
    const mat = new THREE.MeshStandardMaterial({
      color: '#2a0805', emissive: '#ff2e1c', emissiveIntensity: 2.2, roughness: 0.6,
    });
    this.spawnMats = [];
    for (const s of this.map.spawns) {
      const x = s.c * CELL + CELL / 2;
      const y = s.r * CELL + CELL / 2;
      const g = new THREE.Group();
      g.position.set(x, 1.0, cz(y));
      const ring = new THREE.Mesh(new THREE.RingGeometry(11, 17, 28), mat);
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      const tri = new THREE.Mesh(new THREE.CircleGeometry(7, 3), mat);
      tri.rotation.x = -Math.PI / 2;
      tri.rotation.z = -Math.PI / 2;
      tri.position.y = 0.1;
      g.add(tri);
      this.group.add(g);
      this.spawnMats.push(mat);
    }
  }

  /* ---- 每帧 ---- */
  update(dt, t) {
    this.tick += dt;
    if (this.waterN) {
      /* 两轴不同速度 → 看起来像有流向的活水，而不是整体平移 */
      this.waterN.offset.x = (this.waterN.offset.x + dt * 0.014) % 1;
      this.waterN.offset.y = (this.waterN.offset.y - dt * 0.036) % 1;
    }
    if (this.foams) {
      const a = 0.20 + Math.sin(t * 1.6) * 0.08;
      for (const f of this.foams) f.opacity = a;
    }
    if (this.flag) {
      this.flag.rotation.z = Math.sin(t * 1.4) * 0.06;
    }
    if (this.spawnMats) {
      const e = 1.7 + Math.sin(t * 3.2) * 0.9;
      for (const m of this.spawnMats) m.emissiveIntensity = e;
    }
  }

  dispose() {
    this.group.traverse(o => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    });
    if (this.ctx.scene) this.ctx.scene.remove(this.group);
  }
}
