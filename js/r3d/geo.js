/* ============================================================
   r3d/geo.js — 建模图元库

   约定：**1 世界单位 = 1 画布像素**。
   炮塔基座半径约 34、整塔高 60~78；车辆长约 46、宽 26。
   直接按屏幕尺寸建模，省掉一层缩放常数，也便于对着原 2D 美术调比例。

   所有图元都返回 BufferGeometry（未做变换），由 Kit 负责摆位与合并。
   ============================================================ */
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

/* ---------------------------------------------------------------- 图元 */

/** 倒角盒。90° 硬边在 PBR 下必然死黑，倒角才能接住高光。 */
export function rbox(w, h, d, r = 1.2, seg = 2) {
  const rr = Math.min(r, Math.min(w, h, d) * 0.49);
  return new RoundedBoxGeometry(w, h, d, seg, rr);
}

export function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

/** 沿 Y 轴的圆柱（rt = 顶部半径，rb = 底部半径） */
export function cyl(rt, rb, h, seg = 16, open = false) {
  return new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
}

/** 沿 Z 轴的圆柱（炮管、车轴） */
export function cylZ(rt, rb, len, seg = 16) {
  const g = new THREE.CylinderGeometry(rt, rb, len, seg, 1, false);
  g.rotateX(Math.PI / 2);
  return g;
}

/** 沿 X 轴的圆柱（横置罐体） */
export function cylX(rt, rb, len, seg = 16) {
  const g = new THREE.CylinderGeometry(rt, rb, len, seg, 1, false);
  g.rotateZ(Math.PI / 2);
  return g;
}

export function sphere(r, seg = 16, ring = 12) {
  return new THREE.SphereGeometry(r, seg, ring);
}

/** 半球（穹顶、座舱盖） */
export function dome(r, seg = 16, ring = 8, phi = Math.PI * 0.5) {
  return new THREE.SphereGeometry(r, seg, ring, 0, Math.PI * 2, 0, phi);
}

export function cone(r, h, seg = 12) { return new THREE.ConeGeometry(r, h, seg, 1); }

export function torus(r, tube, seg = 20, ring = 8, arc = Math.PI * 2) {
  return new THREE.TorusGeometry(r, tube, ring, seg, arc);
}

export function ringFlat(rIn, rOut, seg = 28) {
  return new THREE.RingGeometry(rIn, rOut, seg);
}

/** 旋转体：给一组 [半径, 高度] 剖面点，绕 Y 转一圈 */
export function lathe(profile, seg = 20) {
  return new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), seg);
}

/** 平面（地面贴片、阴影贴片） */
export function plane(w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * 由一串点挤出的棱柱（崖壁、基地台）。
 * points 是画布坐标 [[x, y], ...]，内部映射到 x / (y/K)。
 */
export function prism(points, height, K) {
  const shape = new THREE.Shape();
  points.forEach((p, i) => {
    const X = p[0], Y = p[1] / K;
    if (i === 0) shape.moveTo(X, Y); else shape.lineTo(X, Y);
  });
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 4 });
  /* ExtrudeGeometry 沿 +Z 挤出；转成沿 Y 向上 */
  g.rotateX(-Math.PI / 2);
  return g;
}

/** 同上的「只有顶盖」版本（台面、水面） */
export function cap(points, K) {
  const shape = new THREE.Shape();
  points.forEach((p, i) => {
    const X = p[0], Y = p[1] / K;
    if (i === 0) shape.moveTo(X, Y); else shape.lineTo(X, Y);
  });
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape, 4);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * 两点之间的管（电缆、支撑杆、炮管）。
 * 返回的几何已经摆好位置，直接 add。
 */
export function tubeBetween(a, b, r, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(B, A);
  const len = d.length() || 0.001;
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  m.setPosition(A.clone().add(B).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

/** 沿折线的软管（用连续圆环扫掠太慢，这里退化成多段直管） */
export function hose(pts, r, seg = 6) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push(tubeBetween(pts[i], pts[i + 1], r, seg));
  return out;
}

/* ---------------------------------------------------------------- Kit */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function xform(pos, rot, scl) {
  _v.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0);
  if (rot) { _e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0); _q.setFromEuler(_e); }
  else _q.identity();
  if (scl) _s.set(scl[0], scl[1], scl[2]);
  else _s.set(1, 1, 1);
  _m.compose(_v, _q, _s);
  return _m;
}

/** mergeGeometries 要求属性集合 + 有无 index 完全一致，先归一化 */
function norm(g) {
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
}

/**
 * 收集零件 → 按材质合并 → 一个 Group。
 * 好处：一座搭 100 个零件也只有十几个 draw call，且外观完全不变。
 */
export class Kit {
  constructor() {
    this.buckets = new Map();
    this.count = 0;
  }

  /** 直接放入已摆好位置的几何 */
  put(geo, mat) {
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(norm(geo));
    this.count++;
    return this;
  }

  /** 图元 + 变换 */
  add(geo, mat, pos, rot, scl) {
    const g = geo.clone();
    g.applyMatrix4(xform(pos, rot, scl));
    return this.put(g, mat);
  }

  /** 一排螺栓（设计稿里最典型的小零件，成本极低但极提质感） */
  bolts(center, radius, n, r = 1.1, h = 0.7, mat, axis = 'y', start = 0) {
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2;
      const g = cyl(r, r, h, 6);
      if (axis === 'y') {
        this.add(g, mat, [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius]);
      } else if (axis === 'x') {
        const gg = cyl(r, r, h, 6); gg.rotateZ(Math.PI / 2);
        this.add(gg, mat, [center[0], center[1] + Math.sin(a) * radius, center[2] + Math.cos(a) * radius]);
      } else {
        const gg = cyl(r, r, h, 6); gg.rotateX(Math.PI / 2);
        this.add(gg, mat, [center[0] + Math.sin(a) * radius, center[1] + Math.cos(a) * radius, center[2]]);
      }
    }
    return this;
  }

  /** 散热格栅：一排骨片 */
  grille(center, w, h, n, depth, mat, rot) {
    const step = h / n;
    for (let i = 0; i < n; i++) {
      this.add(box(w, step * 0.52, depth), mat,
        [center[0], center[1] - h / 2 + step * (i + 0.5), center[2]], rot);
    }
    return this;
  }

  /** 表面凸起的装甲板（每块四周带倒角，边缘能吃到高光） */
  plate(w, h, d, mat, pos, rot) {
    return this.add(rbox(w, h, d, Math.min(1.0, d * 0.45)), mat, pos, rot);
  }

  /** 合并成一个 Group。材质没变，外观与逐件添加一致。 */
  group(name = 'kit') {
    const g = new THREE.Group();
    g.name = name;
    for (const [mat, geos] of this.buckets) {
      if (!geos.length) continue;
      let merged = null;
      try { merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false); }
      catch (e) { merged = null; }
      if (!merged) {
        for (const gg of geos) g.add(new THREE.Mesh(gg, mat));
        continue;
      }
      g.add(new THREE.Mesh(merged, mat));
      if (geos.length > 1) geos.forEach(x => x.dispose());
    }
    g.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    return g;
  }
}

/* ---------------------------------------------------------------- 杂项 */

/** 让所有 mesh 投/接阴影 */
export function shadowify(root) {
  root.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return root;
}

/** 统计网格数与三角面（自检用） */
export function stats(root) {
  let meshes = 0, tris = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return { meshes, tris: Math.round(tris) };
}

export const DEG = Math.PI / 180;
