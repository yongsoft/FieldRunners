/* ============================================================
   r3d/world.js — 场景编排

   把「游戏模拟」映射成「3D 画面」：
     game.towers      → 独立 Group（要转炮塔、抬炮管、后坐）
     game.enemies     → 按 kind 实例化（几十个敌人也只是一个 kind 的开销）
     game.projectiles → 曳光 / 导弹 / 炮弹 / 黏胶
     game.particles   → 发光片 / 烟片（位置直接读 2D 模拟，不重复算物理）
     game.beams       → 抖动管

   相机数学见 core.js：世界 (x, 高度, y/K) 投回画布就是 (x, y)。
   ============================================================ */
import * as THREE from 'three';
import { createScene, K, VIEW_W, VIEW_H, COS_T, CFG } from './core.js';
import { Terrain } from './terrain.js';
import { buildTower, towerMaterials, TOWER_PAL } from './towers.js';
import { buildEnemy, enemyMaterials, ENEMY_PAL } from './vehicles.js';
import { FX } from './fx.js';
import { contactShadow } from './tex.js';
import { cylX, box, torus } from './geo.js';

const AIR_LIFT = 26;          // 空中单位悬停高度（画布 px）
const ENEMY_CAP = 64;         // 每种敌人最多同时 64 个（超过就复用/丢弃）
const WHEEL_CAP = 320;

export class World {
  constructor() {
    this.ready = false;
    this.broken = false;
    this.healthy = false;
    this.zeroProbes = 0;
    this.probeTick = 0;
    this.time = 0;
    this.units = 0;

    this.towerTpl = new Map();
    this.towers = new Map();       // game tower → 实例
    this.enemyInst = new Map();    // kind → [{mesh}]
    this.enemyDefs = new Map();
    this.rotorInst = new Map();    // kind+idx → {mesh, spec}
    this.wheelPools = [];
    this.seenProj = new WeakSet();
    this.projMap = new Map();      // game projectile → {kind, mesh}
  }

  /* ---------------------------------------------------------------- 初始化 */

  init(canvas) {
    try {
      this.ctx = createScene(canvas);
    } catch (e) {
      console.warn('[r3d] 渲染器创建失败：', e);
      return false;
    }
    const { renderer, scene, camera, envTex } = this.ctx;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.envTex = envTex;

    this.ctx.envTex = envTex;
    this.fx = new FX(this.ctx);

    this.towerMats = towerMaterials(this.ctx);
    this.enemyMats = enemyMaterials(this.ctx);

    this._initWheelPool();
    this._initEnemyInstances();
    this._initProjectilePools();
    this._initContactShadows();

    this.ready = true;
    return true;
  }

  /** 车轮池：全局一套，所有载具的车轮共用一个 draw call */
  _initWheelPool() {
    const env = this.envTex;
    const parts = [
      /* 轮胎（圆柱，半径 1 宽度 1，靠实例缩放适配每种车） */
      { geo: cylX(1, 1, 1, 14), mat: new THREE.MeshStandardMaterial({
        color: '#1b1d20', metalness: 0.02, roughness: 0.94, envMap: env, envMapIntensity: 0.25,
      }) },
      /* 轮毂 */
      { geo: cylX(0.60, 0.60, 1.06, 12), mat: new THREE.MeshStandardMaterial({
        color: '#5b636b', metalness: 0.85, roughness: 0.42, envMap: env, envMapIntensity: 0.9,
      }) },
      /* 黄铜轴心 */
      { geo: cylX(0.22, 0.22, 1.14, 8), mat: new THREE.MeshStandardMaterial({
        color: '#b8903c', metalness: 0.95, roughness: 0.32, envMap: env, envMapIntensity: 1.1,
      }) },
    ];
    for (const p of parts) {
      const mesh = new THREE.InstancedMesh(p.geo, p.mat, WHEEL_CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      this.wheelPools.push(mesh);
    }
  }

  /** 每种敌人的车身实例化网格 */
  _initEnemyInstances() {
    for (const kind in ENEMY_PAL) {
      const def = buildEnemy(kind, this.ctx, this.enemyMats);
      this.enemyDefs.set(kind, def);
      const list = [];
      for (const p of def.parts) {
        const mesh = new THREE.InstancedMesh(p.geo, p.mat, ENEMY_CAP);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.count = 0;
        const colors = new Float32Array(ENEMY_CAP * 3).fill(1);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(mesh);
        list.push(mesh);
      }
      this.enemyInst.set(kind, list);

      /* 旋翼：每种敌人每个旋翼一个实例化网格 */
      def.rotors.forEach((r, i) => {
        const blades = this._bladeGeo(r.n, r.axis === 'z');
        const mat = new THREE.MeshStandardMaterial({
          color: '#22262a', metalness: 0.4, roughness: 0.55,
          envMap: this.envTex, envMapIntensity: 0.6,
          transparent: true, opacity: 0.72, depthWrite: false,
        });
        const mesh = new THREE.InstancedMesh(blades, mat, ENEMY_CAP);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.scene.add(mesh);
        this.rotorInst.set(kind + ':' + i, { mesh, spec: r });
      });
    }
  }

  /** 单位旋翼桨叶（半径 1，靠实例缩放） */
  _bladeGeo(n, inXY) {
    const geos = [];
    for (let i = 0; i < n; i++) {
      const g = new THREE.BoxGeometry(1, 0.035, 0.10);
      g.translate(0.52, 0, 0);
      if (inXY) g.rotateZ((i / n) * Math.PI * 2);
      else g.rotateY((i / n) * Math.PI * 2);
      geos.push(g);
    }
    /* 桨毂 */
    const hub = inXY ? cylX(0.06, 0.06, 0.06, 8) : new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8);
    geos.push(hub);

    const pos = [], norm = [], uv = [];
    for (const g of geos) {
      const gg = g.index ? g.toNonIndexed() : g;
      pos.push(...gg.attributes.position.array);
      norm.push(...(gg.attributes.normal ? gg.attributes.normal.array : new Array(gg.attributes.position.count * 3).fill(0)));
      uv.push(...(gg.attributes.uv ? gg.attributes.uv.array : new Array(gg.attributes.position.count * 2).fill(0)));
      if (gg !== g) gg.dispose();
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return out;
  }

  _initProjectilePools() {
    /* 抛射物统一用独立实例化网格（数量很少，逐帧从 game.projectiles 重建） */
    const mk = (geo, mat, cap) => {
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    this.projList = [];
    this.projMesh = {
      missile: mk(this._missileGeo(), new THREE.MeshStandardMaterial({
        color: '#c9d2da', metalness: 0.75, roughness: 0.32, envMap: this.envTex,
        emissive: '#2a0a04', emissiveIntensity: 1.0,
      }), 64),
      shell: mk(this._shellGeo(), new THREE.MeshStandardMaterial({
        color: '#b6bfc7', metalness: 0.8, roughness: 0.3, envMap: this.envTex,
        emissive: '#ff6a18', emissiveIntensity: 1.3,
      }), 32),
      goo: mk(new THREE.SphereGeometry(2.6, 12, 8), new THREE.MeshStandardMaterial({
        color: '#8ce04a', metalness: 0.1, roughness: 0.22,
        emissive: '#4ea010', emissiveIntensity: 1.2, envMap: this.envTex,
      }), 32),
    };
  }

  _missileGeo() {
    const g1 = new THREE.CylinderGeometry(1.7, 1.7, 13, 10);
    g1.rotateX(Math.PI / 2);
    const g2 = new THREE.ConeGeometry(1.7, 3.6, 10);
    g2.rotateX(Math.PI / 2); g2.translate(0, 0, 8.3);
    const g3 = new THREE.CylinderGeometry(1.75, 1.75, 1.2, 10);
    g3.rotateX(Math.PI / 2); g3.translate(0, 0, -6.4);
    const parts = [g1, g2, g3];
    for (let i = 0; i < 4; i++) {
      const f = new THREE.BoxGeometry(0.4, 4.6, 4.2);
      f.rotateZ((i / 4) * Math.PI * 2);
      f.translate(0, 0, -5);
      parts.push(f);
    }
    return this._concat(parts);
  }

  _shellGeo() {
    const g1 = new THREE.CylinderGeometry(1.6, 1.6, 6.5, 8);
    g1.rotateX(Math.PI / 2);
    const g2 = new THREE.ConeGeometry(1.6, 3.2, 8);
    g2.rotateX(Math.PI / 2); g2.translate(0, 0, 4.6);
    return this._concat([g1, g2]);
  }

  _concat(list) {
    const pos = [], norm = [], uv = [];
    for (const g of list) {
      const gg = g.index ? g.toNonIndexed() : g;
      pos.push(...gg.attributes.position.array);
      norm.push(...(gg.attributes.normal ? gg.attributes.normal.array : new Array(gg.attributes.position.count * 3).fill(0)));
      uv.push(...(gg.attributes.uv ? gg.attributes.uv.array : new Array(gg.attributes.position.count * 2).fill(0)));
      if (gg !== g) gg.dispose();
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return out;
  }

  /**
   * 接触阴影：贴在每个单位脚下的软暗斑。
   *
   * shadow map 只有 2048，覆盖 1500 世界单位，一个纹素 0.7px ——
   * 单位与地面之间的"贴地感"抓不住，脚底会显得飘。
   * 一层 24 位的软暗斑成本几乎为零，却是"物体真的坐在地上"的关键。
   */
  _initContactShadows() {
    const tex = contactShadow();
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: true,
      toneMapped: false, color: 0x000000, opacity: 0.85,
    });
    this.contact = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, 160);
    this.contact.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.contact.count = 0;
    this.contact.frustumCulled = false;
    this.contact.renderOrder = 1;
    this.scene.add(this.contact);
    this._contactQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  }

  _syncContactShadows(game) {
    const list = [];
    for (const tw of game.towers) list.push({ x: tw.x, z: tw.y / K, s: 78 });
    for (const e of game.enemies) {
      /* 空中单位不投影贴地暗斑（但它们的地面投影在真实阴影里已经有了） */
      if (e.air) continue;
      list.push({ x: e.x, z: e.y / K, s: e.radius * 6.4 });
    }
    const n = Math.min(list.length, 160);
    this.contact.count = n;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const o = list[i];
      m.compose(
        new THREE.Vector3(o.x, 0.55, o.z),
        this._contactQ,
        new THREE.Vector3(o.s, o.s, 1),
      );
      this.contact.setMatrixAt(i, m);
    }
    this.contact.instanceMatrix.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- 地形 */

  setMap(map) {
    if (this.terrain) {
      if (this.terrain.map.key === map.key) return;
      this.terrain.dispose();
    }
    this.terrain = new Terrain(this.ctx, map);
  }

  /* ---------------------------------------------------------------- 每帧同步 */

  sync(game, t, dt) {
    if (!this.ready) return;
    this.time = t;

    if (!this.terrain || this.terrain.map.key !== game.map.key) this.setMap(game.map);

    this._syncTowers(game, t, dt);
    this._syncEnemies(game, t, dt);
    this._syncProjectiles(game, dt);
    this._syncContactShadows(game);
    this._syncParticles(game);
    this.fx.drawBeams(game.beams || [], t);
  }

  _syncTowers(game, t, dt) {
    const alive = new Set();
    for (const tw of game.towers) {
      alive.add(tw);
      let inst = this.towers.get(tw);
      const lv = Math.max(0, Math.min(2, tw.level | 0));
      if (!inst || inst.level !== lv) {
        if (inst) this.scene.remove(inst.root);
        const id = tw.key + ':' + lv;
        let tpl = this.towerTpl.get(id);
        if (!tpl) {
          const built = buildTower(tw.key, lv, this.ctx, this.towerMats);
          tpl = built;
          this.towerTpl.set(id, tpl);
        }
        const root = tpl.root.clone(true);
        root.name = 'tw:' + tw.key;
        const yaw = root.getObjectByName('yaw');
        inst = {
          root, yaw, level: lv, key: tw.key,
          spin: root.getObjectByName('spin'),
          spin2: root.getObjectByName('spin2'),
          pitch: root.getObjectByName('pitch'),
          rack: root.getObjectByName('rack'),
          orb: root.getObjectByName('orb'),
          focus: root.getObjectByName('focus'),
          pilot: root.getObjectByName('pilot'),
          radar: root.getObjectByName('radar'),
          anim: tpl.specs.anim,
          spinAngle: 0,
          recoilSmooth: 0,
        };
        this.scene.add(root);
        this.towers.set(tw, inst);
      }

      /* 位置 */
      inst.root.position.set(tw.x, 0, tw.y / K);

      /* 朝向：屏幕角 a ↔ 模型 +Z 绕 Y 转 π/2 − a */
      const a = tw.aim || 0;
      inst.yaw.rotation.y = Math.PI / 2 - a;

      /* 后坐：沿 -Z 推开一点（在 yaw 局部空间里 = 炮口反方向） */
      const rec = tw.recoil || 0;
      inst.recoilSmooth += (rec - inst.recoilSmooth) * Math.min(1, dt * 22);
      inst.yaw.position.z = -inst.recoilSmooth * 9;

      /* 建造动画 */
      const sp = tw.spawnT === undefined ? 1 : Math.min(1, tw.spawnT);
      const k = sp < 1 ? 0.42 + 0.58 * (1 - Math.pow(1 - sp, 3)) : 1;
      inst.root.scale.setScalar(k);
      if (sp < 1) inst.root.scale.y *= 1 + Math.sin(sp * Math.PI) * 0.10;

      /* 转管：开火时高速自转，之后缓降到怠速 */
      const want = tw.spin > 0.1 ? 26 : 1.6;
      inst.spinAngle += want * dt;
      if (inst.spin) inst.spin.rotation.z = inst.spinAngle;
      if (inst.spin2) inst.spin2.rotation.z = -inst.spinAngle * 1.5;
      if (tw.spin > 0.1) tw.spin = Math.max(0, tw.spin - dt * 2.2);

      /* 迫击炮仰角：随目标距离微调（近处更陡，看起来像在算弹道） */
      if (inst.pitch) {
        const tgt = tw.target;
        let ang = -26 * Math.PI / 180;
        if (tgt) {
          const d = Math.hypot(tgt.x - tw.x, tgt.y - tw.y);
          ang = -clampf(38 - d * 0.075, 14, 46) * Math.PI / 180;
        }
        inst.pitch.rotation.x += (ang - inst.pitch.rotation.x) * Math.min(1, dt * 3.5);
      }

      /* 雷达 / 球体脉动 / 引火苗抖动 */
      if (inst.radar) inst.radar.rotation.y += dt * 1.15;
      for (const an of inst.anim) {
        const o = an.obj;
        if (!o) continue;
        if (an.kind === 'pulse') {
          const s = an.base + Math.sin(t * an.speed) * an.amp;
          o.scale.setScalar(s);
        } else if (an.kind === 'flicker') {
          const s = an.base + (Math.sin(t * an.speed) * 0.5 + Math.sin(t * an.speed * 2.7) * 0.5) * an.amp;
          o.scale.setScalar(Math.max(0.2, s));
        }
      }
    }

    for (const [tw, inst] of this.towers) {
      if (!alive.has(tw)) {
        this.scene.remove(inst.root);
        this.towers.delete(tw);
      }
    }
    this.units = this.towers.size;
  }

  _syncEnemies(game, t, dt) {
    const counts = new Map();
    const wheelItems = [];
    const rotorCount = new Map();

    const posM = new THREE.Matrix4();
    const yawQ = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const tmp = new THREE.Matrix4();
    const c = new THREE.Color();

    for (const e of game.enemies) {
      const kind = e.art;
      const def = this.enemyDefs.get(kind);
      if (!def) continue;

      const list = this.enemyInst.get(kind);
      const n = counts.get(kind) || 0;
      if (n >= ENEMY_CAP) continue;

      const lift = e.air ? (AIR_LIFT + Math.sin(t * 2.4 + e.seed) * 3.0) / COS_T : 0;
      const bob = e.air ? 0 : Math.sin(t * 9 + e.seed * 3) * 0.35;

      const px = e.x;
      const py = lift + bob;
      const pz = e.y / K;
      const yaw = Math.PI / 2 - (e.angle || 0);

      posM.compose(
        new THREE.Vector3(px, py, pz),
        yawQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        one,
      );

      /* 受击闪白：靠 instanceColor 提亮 diffuse（不改材质，不影响同类） */
      const flash = e.hitFlash > 0.02 ? Math.min(1, e.hitFlash * 1.6) : 0;
      if (flash > 0) c.setRGB(1 + flash * 1.5, 1 + flash * 1.35, 1 + flash * 1.1);
      else c.setRGB(1, 1, 1);

      for (const mesh of list) {
        mesh.setMatrixAt(n, posM);
        mesh.setColorAt(n, c);
      }
      counts.set(kind, n + 1);

      /* 车轮 */
      if (def.wheels.length) {
        const dist = (e.speed || 0) * dt;
        for (const w of def.wheels) {
          const ang = dist / Math.max(2, w.r) * (e.speed > 0 ? 1 : 0);
          e.__wheelAcc = (e.__wheelAcc || 0) + ang;
          wheelItems.push({ px, py, pz, yaw, w, spin: e.__wheelAcc });
        }
      }

      /* 旋翼 */
      def.rotors.forEach((r, i) => {
        const key = kind + ':' + i;
        const rec = this.rotorInst.get(key);
        if (!rec) return;
        const idx = rotorCount.get(key) || 0;
        if (idx >= ENEMY_CAP) return;
        rec.mesh.setMatrixAt(idx, this._rotorMatrix(px, py, pz, yaw, r, t + e.seed));
        rotorCount.set(key, idx + 1);
      });
    }

    /* 写回数量 */
    for (const [kind, list] of this.enemyInst) {
      const n = Math.min(counts.get(kind) || 0, ENEMY_CAP);
      for (const mesh of list) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    for (const [key, rec] of this.rotorInst) {
      rec.mesh.count = Math.min(rotorCount.get(key) || 0, ENEMY_CAP);
      rec.mesh.instanceMatrix.needsUpdate = true;
    }

    /* 车轮：三组材质共用同一批实例矩阵 */
    const wn = Math.min(wheelItems.length, WHEEL_CAP);
    for (const mesh of this.wheelPools) {
      mesh.count = wn;
      for (let i = 0; i < wn; i++) {
        const it = wheelItems[i];
        /* 车身变换 × 车轮局部变换（含自转） */
        tmp.compose(
          new THREE.Vector3(it.w.x, it.w.y, it.w.z),
          yawQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), it.spin),
          new THREE.Vector3(it.w.w, it.w.r, it.w.r),
        );
        posM.compose(
          new THREE.Vector3(it.px, it.py, it.pz),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw),
          new THREE.Vector3(1, 1, 1),
        );
        posM.multiply(tmp);
        mesh.setMatrixAt(i, posM);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.units = this.towers.size + game.enemies.length;
  }

  _rotorMatrix(px, py, pz, yaw, r, t) {
    const m = new THREE.Matrix4();
    const inner = new THREE.Matrix4();
    const ang = t * (r.axis === 'z' ? 26 : 22);
    const q = new THREE.Quaternion();
    if (r.axis === 'z') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang);
    else q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    inner.compose(
      new THREE.Vector3(r.x, r.y, r.z),
      q,
      new THREE.Vector3(r.r, r.r, r.r),
    );
    m.compose(
      new THREE.Vector3(px, py, pz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(1, 1, 1),
    );
    m.multiply(inner);
    return m;
  }

  _syncProjectiles(game, dt) {
    const groups = { missile: [], shell: [], goo: [] };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();

    for (const p of game.projectiles) {
      if (p.type === 'bullet') {
        /* 曳光：从当前位置沿速度回溯一小段 */
        const a = new THREE.Vector3(p.x - p.vx * 0.022, 9, (p.y - p.vy * 0.022) / K);
        const b = new THREE.Vector3(p.x, 9, p.y / K);
        this.fx.addTracer(a, b, 5.5, 1.0, 0.80, 0.42, 0.055);
        continue;
      }
      if (p.type === 'missile') {
        const ang = Math.atan2(p.vy, p.vx);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - ang);
        m.compose(new THREE.Vector3(p.x, 14, p.y / K), q, new THREE.Vector3(1, 1, 1));
        groups.missile.push(m.clone());
        /* 尾焰 */
        this.fx.addGlow(p.x - Math.cos(ang) * 12, 14, (p.y - Math.sin(ang) * 12) / K,
          12, 1.0, 0.62, 0.24, 0.06, { grow: -8 });
        this.fx.addSmoke(p.x - Math.cos(ang) * 16, 14, (p.y - Math.sin(ang) * 16) / K,
          7, 0.5, { vx: -Math.cos(ang) * 8, vy: 6, vz: -Math.sin(ang) * 8 });
        continue;
      }
      if (p.type === 'shell') {
        const h = (p.h || 0) + 6;
        const ang = p.pang == null ? 0 : p.pang;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - ang);
        m.compose(new THREE.Vector3(p.x, h, p.y / K), q, new THREE.Vector3(1, 1, 1));
        groups.shell.push(m.clone());
        this.fx.addGlow(p.x, h, p.y / K, 9, 1.0, 0.55, 0.2, 0.05);
        continue;
      }
      if (p.type === 'goo') {
        m.compose(new THREE.Vector3(p.x, 12, p.y / K), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        groups.goo.push(m.clone());
        this.fx.addGlow(p.x, 12, p.y / K, 7, 0.55, 1.0, 0.35, 0.05);
        continue;
      }
    }

    for (const kind in groups) {
      const mesh = this.projMesh[kind];
      const arr = groups[kind];
      const n = Math.min(arr.length, mesh.instanceMatrix.count);
      mesh.count = n;
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, arr[i]);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** 2D 粒子 → 3D 发光片（位置直接读模拟，不重复算物理） */
  _syncParticles(game) {
    this.fx.clearExternal();
    const list = game.particles || [];
    for (const p of list) {
      const t = Math.max(0, p.life / (p.max || 1));
      const col = parseColor(p.col);
      const h = p.type === 'goo' ? 4 : (p.type === 'star' ? 10 : 7);
      if (p.type === 'smoke' || p.type === 'dust') {
        this.fx.extSmoke(p.x, h, p.y / K, (p.size || 3) * 4.2, t, col);
      } else {
        this.fx.extGlow(p.x, h, p.y / K, (p.size || 3) * 2.6, t, col);
      }
    }
  }

  /* ---------------------------------------------------------------- 渲染 */

  render(game, t) {
    if (!this.ready || this.broken) return;

    /* 镜头抖动：和 2D 层共用一个偏移量 */
    const sx = game ? (game.shakeX || 0) : 0;
    const sy = game ? (game.shakeY || 0) : 0;
    const tz = (VIEW_H / 2) / K;
    const tx = VIEW_W / 2 + sx;
    const tzz = tz + sy / K;
    this.camera.position.set(tx, 1800 * Math.sin(Math.asin(K)), tzz + 1800 * COS_T);
    this.camera.lookAt(tx, 0, tzz);
    this.camera.updateMatrixWorld();

    if (this.terrain) this.terrain.update(1 / 60, t);
    this.fx.update(1 / 60, this.camera);

    this.ctx.post.render(this.scene, this.camera, t);

    /* 健康自检：连续 25 次采样不到像素 → 判定 WebGL 没在真渲染 */
    if (!this.healthy && !this.broken && (this.probeTick++ & 7) === 0) this._probe();
  }

  _probe() {
    if (!this.towers.size) return;
    const inst = this.towers.values().next().value;
    const p = new THREE.Vector3(inst.root.position.x, 20, inst.root.position.z).project(this.camera);
    const x = Math.round((p.x * 0.5 + 0.5) * VIEW_W);
    const y = Math.round((-p.y * 0.5 + 0.5) * VIEW_H);
    const S = 24;
    const gl = this.renderer.getContext();
    const pr = this.renderer.getPixelRatio();
    const buf = new Uint8Array(S * S * 4);
    const cx = Math.round(x * pr) - S / 2;
    const cy = Math.round((VIEW_H - y) * pr) - S / 2;
    if (cx < 0 || cy < 0 || cx + S > gl.drawingBufferWidth || cy + S > gl.drawingBufferHeight) return;
    /* 从默认帧缓冲读（post 已经渲染到屏幕） */
    gl.readPixels(cx, cy, S, S, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let nz = 0;
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i] > 12 || buf[i + 1] > 12 || buf[i + 2] > 12) nz++;
    }
    if (nz > 12) { this.healthy = true; this.zeroProbes = 0; }
    else if (++this.zeroProbes >= 25) {
      this.broken = true;
      console.warn('[r3d] 连续采样不到像素，判定 WebGL 未真正出图 → 回退 2D');
    }
  }

  clear() {
    for (const [tw, inst] of this.towers) this.scene.remove(inst.root);
    this.towers.clear();
  }

  dispose() {
    if (this.terrain) this.terrain.dispose();
    this.clear();
  }
}

function clampf(v, a, b) { return v < a ? a : (v > b ? b : v); }

function parseColor(c) {
  if (!c) return { r: 1, g: 1, b: 1 };
  if (c[0] === '#') {
    const h = c.slice(1);
    const v = h.length === 3
      ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return { r: v[0] / 255, g: v[1] / 255, b: v[2] / 255 };
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map(Number);
    return { r: (p[0] || 0) / 255, g: (p[1] || 0) / 255, b: (p[2] || 0) / 255 };
  }
  return { r: 1, g: 1, b: 1 };
}
