/* ============================================================
   r3d/fx.js — 3D 特效

   设计原则：**3D 特效只是 2D 模拟的一个视图**。
   游戏引擎里已经有 particles / projectiles / beams 的物理，也有
   burst() / muzzle() / smoke() 这些发射器；这里不再重写一套物理，
   只把这些对象映射成 3D 里的发光片、曳光条、飞行体、闪电管。

   实现上用实例化：几千个火花也只是几个 draw call。
   广告牌（billboard）矩阵按相机右/上向量构造，正交相机下开销为零。
   ============================================================ */
import * as THREE from 'three';
import { glowSprite, smokeSprite, scorchSprite, contactShadow } from './tex.js';
import { K } from './core.js';
import { cyl, cylZ, cone, sphere } from './geo.js';

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/* ---------------------------------------------------------------- 广告牌池 */

class BillboardPool {
  /**
   * @param additive true → 加法混合（发光）；false → 正常混合（烟）
   */
  constructor(scene, tex, cap, additive) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 18;
    /* 逐实例颜色 */
    const colors = new Float32Array(cap * 3).fill(1);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.cap = cap;
    this.items = [];
  }

  push(o) {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push(o);
  }

  /** 更新矩阵 + 颜色；billboard 用相机右/上向量 */
  flush(right, up) {
    const n = Math.min(this.items.length, this.cap);
    this.mesh.count = n;
    for (let i = 0; i < n; i++) {
      const o = this.items[i];
      const s = o.size;
      _s.set(s, s, 1);
      _m.makeBasis(right, up, _v.set(0, 0, 1));
      _m.scale(_s);
      _m.setPosition(o.x, o.y, o.z);
      this.mesh.setMatrixAt(i, _m);
      const a = o.alpha;
      _c.setRGB(o.r * a, o.g * a, o.b * a);
      this.mesh.setColorAt(i, _c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/* ---------------------------------------------------------------- 通用实例池 */

class InstPool {
  constructor(scene, geo, mat, cap) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.cap = cap;
    this.items = [];
  }
  push(o) {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push(o);
  }
  flush() {
    const n = Math.min(this.items.length, this.cap);
    this.mesh.count = n;
    for (let i = 0; i < n; i++) {
      const o = this.items[i];
      _m.compose(o.pos, o.quat, o.scl);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ================================================================ FX */

export class FX {
  constructor(ctx) {
    this.ctx = ctx;
    const scene = ctx.scene;
    this.scene = scene;

    this.glow = new BillboardPool(scene, glowSprite(), 900, true);
    this.smoke = new BillboardPool(scene, smokeSprite(), 320, false);
    this.tracer = new BillboardPool(scene, glowSprite(), 400, true);

    /* 地面焦痕 / 黏胶残迹 */
    const decalMat = new THREE.MeshBasicMaterial({
      map: scorchSprite(), transparent: true, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide,
    });
    this.decals = new InstPool(scene, new THREE.PlaneGeometry(1, 1), decalMat, 64);
    /* 让贴片平铺在地面上 */
    this._decalQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

    /* 弹壳（黄铜小圆柱） */
    this.casings = new InstPool(scene,
      cylZ(0.55, 0.55, 2.2, 6),
      new THREE.MeshStandardMaterial({ color: '#c39237', metalness: 0.95, roughness: 0.3, envMap: ctx.envTex }),
      80);

    /* 导弹弹体 */
    const missileGeo = (() => {
      const g1 = cylZ(1.6, 1.6, 13, 10);
      const g2 = cone(1.6, 3.4, 10);
      g2.rotateX(Math.PI / 2);
      g2.translate(0, 0, 8.2);
      /* 尾翼 */
      const fins = [];
      for (let i = 0; i < 4; i++) {
        const f = new THREE.BoxGeometry(0.5, 4.2, 4);
        f.rotateZ(Math.PI / 2);
        f.rotateZ((i / 4) * Math.PI * 2);
        f.translate(0, 0, -5);
        fins.push(f);
      }
      return mergeSimple([g1, g2, ...fins]);
    })();
    this.missiles = new InstPool(scene, missileGeo,
      new THREE.MeshStandardMaterial({
        color: '#cfd6dd', metalness: 0.7, roughness: 0.35,
        envMap: ctx.envTex, emissive: '#3a1206', emissiveIntensity: 0.6,
      }), 60);

    /* 迫击炮弹 */
    this.shells = new InstPool(scene, mergeSimple([
      cylZ(1.5, 1.5, 7, 8),
      (() => { const c2 = cone(1.5, 3, 8); c2.rotateX(Math.PI / 2); c2.translate(0, 0, 4.6); return c2; })(),
    ]), new THREE.MeshStandardMaterial({
      color: '#b9c2ca', metalness: 0.8, roughness: 0.3, envMap: ctx.envTex,
      emissive: '#ff5a10', emissiveIntensity: 0.9,
    }), 30);

    /* 黏胶弹 */
    this.goos = new InstPool(scene, sphere(2.2, 12, 8), new THREE.MeshStandardMaterial({
      color: '#8ce04a', metalness: 0.1, roughness: 0.25,
      emissive: '#4ea010', emissiveIntensity: 0.9, envMap: ctx.envTex,
    }), 24);

    /* 闪电：几条管子，每帧重建顶点 */
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xbfeaff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.beamGeo = new THREE.BufferGeometry();
    this.beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 3 * 64), 3));
    this.beamMesh = new THREE.Mesh(this.beamGeo, this.beamMat);
    this.beamMesh.frustumCulled = false;
    this.beamMesh.count = 0;
    scene.add(this.beamMesh);

    /* 炮口闪光用的真实点光源：只留 3 个，轮流用 */
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffcf8a, 0, 220, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ light: l, t: 0, max: 1, peak: 0 });
    }
    this.lightIdx = 0;

    /* 爆炸用的临时高光球（加法），池化在 glow 里做，这里只管光 */
    this.time = 0;
  }

  /* ------------------------------------------------------------ 低层 */

  /** 世界坐标下拉满屏的光斑 */
  addGlow(x, y, z, size, r, g, b, life, {
    vx = 0, vy = 0, vz = 0, grav = 0, drag = 0, fade = 1, grow = 0,
  } = {}) {
    this.glow.push({
      x, y, z, vx, vy, vz, grav, drag, grow,
      size, size0: size, r, g, b, alpha: fade, fade,
      life, max: life,
    });
  }

  addSmoke(x, y, z, size, life, { vx = 0, vy = 0, vz = 0, r = 0.62, g = 0.60, b = 0.56 } = {}) {
    this.smoke.push({
      x, y, z, vx, vy, vz, grav: 6, drag: 0.4, grow: 1.5,
      size, size0: size, r, g, b, alpha: 0.55, fade: 0.55, life, max: life,
    });
  }

  /** 曳光条：从 p0 指向 p1，长度即速度方向的拉丝 */
  addTracer(p0, p1, w, r, g, b, life = 0.075) {
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.tracer.push({
      x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, z: (p0.z + p1.z) / 2,
      vx: 0, vy: 0, vz: 0, grav: 0, drag: 0, grow: 0,
      size: w, r, g, b, alpha: 1, fade: 1, life, max: life,
      len, dir: { x: dx / len, y: dy / len, z: dz / len },
    });
  }

  addDecal(x, z, size, life, r = 0.06, g = 0.055, b = 0.05) {
    this.decals.push({
      pos: new THREE.Vector3(x, 0.6, z),
      quat: this._decalQuat,
      scl: new THREE.Vector3(size, size, 1),
      life, max: life, size0: size, r, g, b,
    });
  }

  addCasing(pos, dir, speed) {
    this.casings.push({
      pos: pos.clone(), quat: _q.clone(),
      v: dir.clone().multiplyScalar(speed),
      spin: new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30),
      scl: new THREE.Vector3(1, 1, 1), life: 1.1, max: 1.1,
    });
  }

  /** 炮口焰：光斑 + 点光 + 烟 */
  muzzle(pos, dir, scale = 1, tint = [1.0, 0.86, 0.55]) {
    const s = 34 * scale;
    this.addGlow(pos.x, pos.y, pos.z, s, tint[0], tint[1], tint[2], 0.10, { grow: 22 });
    this.addGlow(pos.x, pos.y, pos.z, s * 0.45, 1, 1, 1, 0.07, { grow: 6 });
    /* 前向的锥状焰 */
    for (let i = 0; i < 3; i++) {
      const t = 0.4 + i * 0.35;
      this.addGlow(
        pos.x + dir.x * 9 * t, pos.y + dir.y * 9 * t, pos.z + dir.z * 9 * t,
        s * (0.55 - i * 0.12), 1, 0.72, 0.34, 0.09, { grow: 10 });
    }
    this.flashLight(pos, 5.2 * scale, 0.09);
  }

  flashLight(pos, power, dur) {
    const slot = this.lights[this.lightIdx++ % this.lights.length];
    slot.light.position.copy(pos);
    slot.t = dur; slot.max = dur; slot.peak = power;
  }

  /** 爆炸：闪 + 冲击环 + 火花 + 烟 + 焦痕 */
  explosion(pos, radius, kind = 'boom') {
    const big = radius / 26;
    /* 核心闪光 */
    this.addGlow(pos.x, pos.y, pos.z, radius * 2.6, 1.0, 0.90, 0.62, 0.16, { grow: radius * 2.2 });
    this.addGlow(pos.x, pos.y, pos.z, radius * 1.3, 1.0, 0.98, 0.88, 0.24, { grow: radius });
    /* 火花 */
    const nsp = Math.round(10 + radius * 0.5);
    for (let i = 0; i < nsp; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * 1.1;
      const sp = 90 + Math.random() * 210;
      this.addGlow(pos.x, pos.y, pos.z,
        3.2 + Math.random() * 4.2,
        1, 0.62 + Math.random() * 0.3, 0.20,
        0.30 + Math.random() * 0.34,
        {
          vx: Math.cos(a) * Math.cos(el) * sp,
          vy: Math.sin(el) * sp,
          vz: Math.sin(a) * Math.cos(el) * sp,
          grav: 320, drag: 1.2, grow: -2.6,
        });
    }
    /* 烟 */
    for (let i = 0; i < 4 + Math.round(radius * 0.12); i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * radius * 0.6;
      this.addSmoke(
        pos.x + Math.cos(a) * rr, pos.y + Math.random() * radius * 0.4, pos.z + Math.sin(a) * rr,
        radius * (0.9 + Math.random() * 0.9), 0.6 + Math.random() * 0.5,
        { vx: Math.cos(a) * 22, vy: 26 + Math.random() * 26, vz: Math.sin(a) * 22 });
    }
    /* 地面焦痕 */
    if (pos.y < radius * 1.4) {
      this.addDecal(pos.x, pos.z, radius * 2.0, 6.5, 0.05, 0.045, 0.04);
    }
    this.flashLight(new THREE.Vector3(pos.x, pos.y + 6, pos.z), 6 * big + 3, 0.22);
  }

  /** 落点预警圈（迫击炮） */
  impactRing(x, z, radius, dur) {
    this.decals.push({
      pos: new THREE.Vector3(x, 0.7, z),
      quat: this._decalQuat,
      scl: new THREE.Vector3(radius * 2, radius * 2, 1),
      life: dur, max: dur, size0: radius * 2,
      r: 1.0, g: 0.45, b: 0.15, ring: true,
    });
  }

  /* ------------------------------------------------------------ 外部驱动的粒子
     游戏引擎已经算好了 2D 粒子的位置与寿命，这里只负责"投影成 3D 片"。
     这类粒子每帧被清空重建（ext=true），不做积分，避免两套物理打架。 */

  clearExternal() {
    for (let i = this.glow.items.length - 1; i >= 0; i--) {
      if (this.glow.items[i].ext) this.glow.items.splice(i, 1);
    }
    for (let i = this.smoke.items.length - 1; i >= 0; i--) {
      if (this.smoke.items[i].ext) this.smoke.items.splice(i, 1);
    }
  }

  extGlow(x, y, z, size, alpha, col) {
    if (alpha <= 0.01) return;
    this.glow.push({
      ext: true, x, y, z, vx: 0, vy: 0, vz: 0, grav: 0, drag: 0, grow: 0,
      size, size0: size, r: col.r, g: col.g, b: col.b,
      alpha, fade: alpha, life: 1, max: 1,
    });
  }

  extSmoke(x, y, z, size, alpha, col) {
    if (alpha <= 0.01) return;
    this.smoke.push({
      ext: true, x, y, z, vx: 0, vy: 0, vz: 0, grav: 0, drag: 0, grow: 0,
      size, size0: size,
      r: col.r * 0.9 + 0.1, g: col.g * 0.9 + 0.1, b: col.b * 0.9 + 0.1,
      alpha: alpha * 0.5, fade: alpha * 0.5, life: 1, max: 1,
    });
  }

  /* ------------------------------------------------------------ 每帧 */

  update(dt, camera) {
    this.time += dt;

    /* 相机右/上向量（广告牌用） */
    const e = camera.matrixWorld.elements;
    const right = _v2.set(e[0], e[1], e[2]).normalize().clone();
    const up = new THREE.Vector3(e[4], e[5], e[6]).normalize();

    /* ---- 发光片 ---- */
    for (let i = this.glow.items.length - 1; i >= 0; i--) {
      const o = this.glow.items[i];
      o.life -= dt;
      if (o.life <= 0) { this.glow.items.splice(i, 1); continue; }
      if (o.ext) continue;                       // 外部粒子：位置由模拟决定
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      o.vy -= o.grav * dt;
      if (o.drag) {
        const k = Math.max(0, 1 - o.drag * dt);
        o.vx *= k; o.vy *= k; o.vz *= k;
      }
      o.size += o.grow * dt;
      const t = o.life / o.max;
      o.alpha = o.fade * (t > 0.7 ? 1 : t / 0.7);
    }
    this.glow.flush(right, up);

    /* ---- 烟 ---- */
    for (let i = this.smoke.items.length - 1; i >= 0; i--) {
      const o = this.smoke.items[i];
      o.life -= dt;
      if (o.life <= 0) { this.smoke.items.splice(i, 1); continue; }
      if (o.ext) continue;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      o.vy -= o.grav * dt;
      const k = Math.max(0, 1 - o.drag * dt);
      o.vx *= k; o.vy *= k; o.vz *= k;
      o.size += o.grow * dt * 10;
      const t = o.life / o.max;
      o.alpha = o.fade * Math.min(1, t * 2.2);
    }
    this.smoke.flush(right, up);

    /* ---- 曳光：用四元数把平面转到速度方向 ---- */
    for (let i = this.tracer.items.length - 1; i >= 0; i--) {
      const o = this.tracer.items[i];
      o.life -= dt;
      if (o.life <= 0) { this.tracer.items.splice(i, 1); continue; }
      const t = o.life / o.max;
      o.alpha = t;
      o.size = o.size * (0.55 + 0.45 * t);
    }
    {
      const mesh = this.tracer.mesh;
      const items = this.tracer.items;
      const n = Math.min(items.length, this.tracer.cap);
      mesh.count = n;
      const dir = new THREE.Vector3();
      const upv = new THREE.Vector3(0, 1, 0);
      const xAxis = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const o = items[i];
        dir.set(o.dir.x, o.dir.y, o.dir.z).normalize();
        xAxis.crossVectors(dir, upv).normalize();
        if (xAxis.lengthSq() < 0.01) xAxis.set(1, 0, 0);
        const yAxis = new THREE.Vector3().crossVectors(xAxis, dir).normalize();
        /* 拉长的光条：沿飞行方向的长度 = 速度相关，宽 = size */
        _s.set(o.size * 0.55, o.len * 0.5, 1);
        _m.makeBasis(xAxis, dir, yAxis);
        _m.scale(_s);
        _m.setPosition(o.x, o.y, o.z);
        mesh.setMatrixAt(i, _m);
        _c.setRGB(o.r * o.alpha, o.g * o.alpha, o.b * o.alpha);
        mesh.setColorAt(i, _c);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    /* ---- 焦痕 / 预警圈 ---- */
    for (let i = this.decals.items.length - 1; i >= 0; i--) {
      const o = this.decals.items[i];
      o.life -= dt;
      if (o.life <= 0) { this.decals.items.splice(i, 1); continue; }
      const t = o.life / o.max;
      /* 预警圈在脉动；焦痕缓慢缩小消失 */
      if (o.ring) {
        const pulse = 1 + Math.sin(this.time * 16) * 0.05;
        o.scl.set(o.size0 * pulse, o.size0 * pulse, 1);
      } else if (t < 0.35) {
        const k = t / 0.35;
        o.scl.set(o.size0 * k, o.size0 * k, 1);
      }
    }
    this.decals.flush();

    /* ---- 弹壳 ---- */
    for (let i = this.casings.items.length - 1; i >= 0; i--) {
      const o = this.casings.items[i];
      o.life -= dt;
      if (o.life <= 0) { this.casings.items.splice(i, 1); continue; }
      o.v.y -= 420 * dt;
      o.pos.addScaledVector(o.v, dt);
      if (o.pos.y < 1.2) { o.pos.y = 1.2; o.v.y *= -0.42; o.v.x *= 0.7; o.v.z *= 0.7; }
      _q.setFromEuler(new THREE.Euler(o.spin.x * (1.1 - o.life), o.spin.y * (1.1 - o.life), o.spin.z * (1.1 - o.life)));
      o.quat.copy(_q);
      const k = Math.min(1, o.life / 0.3);
      o.scl.set(k, k, k);
    }
    this.casings.flush();

    /* ---- 飞行体 ---- */
    this._flushFlying(this.missiles, dt);
    this._flushFlying(this.shells, dt);
    this._flushFlying(this.goos, dt);

    /* ---- 点光衰减 ---- */
    for (const s of this.lights) {
      if (s.t > 0) {
        s.t -= dt;
        const k = Math.max(0, s.t / s.max);
        s.light.intensity = s.peak * k * k;
      } else if (s.light.intensity !== 0) {
        s.light.intensity = 0;
      }
    }
  }

  _flushFlying(pool, dt) {
    for (let i = pool.items.length - 1; i >= 0; i--) {
      const o = pool.items[i];
      if (o.dead) { pool.items.splice(i, 1); continue; }
      o.life -= dt;
      if (o.life <= 0) { pool.items.splice(i, 1); continue; }
    }
    pool.flush();
  }

  /* ------------------------------------------------------------ 闪电 */

  /**
   * 把 game.beams 画成抖动的管子。
   * 每帧重建顶点：只有 1~2 条，开销可忽略。
   */
  drawBeams(beams, t) {
    const pos = this.beamGeo.attributes.position;
    let vi = 0;
    const MAXV = pos.count;
    const SEG = 12;

    for (const b of beams) {
      if (vi + SEG * 3 + 3 > MAXV) break;
      const x0 = b.x0, y0 = 8, z0 = b.y0 / K;
      const x1 = b.x1, y1 = 8, z1 = b.y1 / K;
      /* 每帧变化的抖动种子 */
      const seed = b.seed + Math.floor(t * 30);
      let px = x0, py = y0, pz = z0;
      for (let s = 1; s <= SEG; s++) {
        const u = s / SEG;
        const jitter = (s === SEG) ? 0 : (Math.sin(seed * 12.9 + s * 4.7) * 6.5 + Math.cos(seed * 7.3 + s * 2.1) * 4.0) * Math.sin(u * Math.PI);
        const cx = x0 + (x1 - x0) * u + jitter * 0.7;
        const cy = y0 + (y1 - y0) * u + jitter * 0.9;
        const cz2 = z0 + (z1 - z0) * u + jitter * 0.7;
        /* 一个面向相机的三角带片段（两条三角形） */
        const w = 1.6;
        pos.setXYZ(vi++, px, py + w, pz);
        pos.setXYZ(vi++, cx, cy + w, cz2);
        pos.setXYZ(vi++, cx, cy - w, cz2);
        pos.setXYZ(vi++, px, py + w, pz);
        pos.setXYZ(vi++, cx, cy - w, cz2);
        pos.setXYZ(vi++, px, py - w, pz);
        px = cx; py = cy; pz = cz2;
      }
    }
    pos.needsUpdate = true;
    this.beamGeo.setDrawRange(0, vi);
    this.beamMesh.visible = vi > 0;
  }

  /* 供 world 用的飞行体登记 */
  spawnMissile(pos, quat, life) {
    this.missiles.push({
      pos: pos.clone(), quat: quat.clone(),
      scl: new THREE.Vector3(1, 1, 1), life, max: life,
    });
  }
  spawnShell(pos, quat, life) {
    this.shells.push({
      pos: pos.clone(), quat: quat.clone(),
      scl: new THREE.Vector3(1, 1, 1), life, max: life,
    });
  }
  spawnGoo(pos, life) {
    this.goos.push({
      pos: pos.clone(), quat: new THREE.Quaternion(),
      scl: new THREE.Vector3(1, 1, 1), life, max: life,
    });
  }
}

/* 简易几何合并（只需要 position/normal/uv） */
function mergeSimple(list) {
  const pos = [], norm = [], uv = [];
  for (const g of list) {
    const gg = g.index ? g.toNonIndexed() : g;
    pos.push(...gg.attributes.position.array);
    if (gg.attributes.normal) norm.push(...gg.attributes.normal.array);
    if (gg.attributes.uv) uv.push(...gg.attributes.uv.array);
    else for (let i = 0; i < gg.attributes.position.count * 2; i++) uv.push(0);
    if (gg !== g) gg.dispose();
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
