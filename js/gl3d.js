/* ============================================================
   gl3d.js —— 把 3D 单位渲染进原游戏（WebGL 叠层）

   核心问题：游戏的伪 3D 投影是
       屏幕 x = 世界 X
       屏幕 y = 地面 y − 高度 · HZ        （HZ = 0.90）
       地面 y 方向被压了 K = 0.46 倍

   这个投影**正好等于**一台俯角 θ = asin(0.46) = 27.386° 的正交相机。
   所以只要把相机摆对，3D 模型就会落在 2D 世界的正确位置上，
   不需要任何手工对位常数。

   推导（相机 target 取画布中心 (W/2, 0, H/2/K)）：
       camera_up    = (0, cosθ, −sinθ)
       地面点 (px, 0, py/K)  →  cam_y = −(py − H/2)  →  画布 y = py   ✓
       高度 h                →  cam_y += h·cosθ      →  画布 y −= h·cosθ
   即：**世界 1 单位高 ≈ 0.888 画布像素**。

   分层：游戏原本一张画布按顺序画完「地形 → 单位 → 血条/弹道」。
   这里把单位抽出来交给 WebGL，所以 canvas 拆成三层：
       #game    (下) 地形 / 基地 / 预览 / 射程
       #gl3d    (中) 3D 单位
       #gameTop (上) 血条 / 光束 / 弹道 / 飘字
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { makeEnvCanvas } from './materials3d.js';
import { makeUnitMaterials } from './parts3d.js';
import { buildTower, TOWER_PAL } from './towers3d.js';
import { buildEnemy, ENEMY_PAL } from './enemies3d.js';

const K = 0.46;                                   // 地面压扁系数（= sinθ）
const THETA = Math.asin(K);
const COS_T = Math.cos(THETA);                    // 0.88782
const HZ = 0.90;                                  // 游戏里高度用的系数

/* 模型单位 → 画布像素。
   原 2D 美术：炮塔基座直径 70px、整塔约 62px 高；吉普约 55px 宽。
   本模型基座半径 1.52 → 23 倍正好 70px；敌人主力车宽约 2.0 → 27 倍约 54px。 */
const TOWER_S = 23.0;
const ENEMY_S = 27.0;
/* 游戏里高度共乘 HZ，而正交相机给的是 cosθ，补一个比值 */
const H_FIX = HZ / COS_T;

/* 空气单位悬停高度（画布 px），和 Art.drawEnemy 里的 -20 一致 */
const AIR_LIFT = 20;

const GL3D = (() => {
  let renderer = null, scene = null, camera = null, canvas = null;
  let MATS = {};
  let ready = false;

  /* 单位实例表：game 对象 → { root, yaw, level, key, kind } */
  const units = new Map();
  const geoCache = new Map();      // 'tower:gatling:2' → { base, yaw, spec }

  /* 建模失败的单位：交回 2D 层补画，绝不让一个坏单位拖垮整帧 */
  const failed = new Set();
  const warned = new Set();

  /* WebGL「假装在跑」检测。
     实测过的真实故障：上下文创建成功、draw call 也有数字，
     但画布上一个像素都没有（GPU 进程被隔离 / 双显卡切换 / 软渲染被禁）。
     它不抛异常，只能真读像素判断。 */
  let healthy = false, broken = false, zeroProbes = 0, probeTick = 0;
  const PROBE_W = 26;
  const probeBuf = new Uint8Array(PROBE_W * PROBE_W * 4);

  /* ---------------------------------------------------------------- 初始化 */
  function init() {
    canvas = document.getElementById('gl3d');
    if (!canvas) return false;
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(CANVAS_W, CANVAS_H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearAlpha(0);
    // 上下文丢失（显存不足 / 驱动重置 / 标签页长时间后台）→ 直接回退 2D
    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      broken = true;
      console.warn('[gl3d] WebGL 上下文丢失 → 回退 2D 单位绘制');
    }, false);

    scene = new THREE.Scene();

    // 环境贴图：金属观感的全部来源
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envTex = new THREE.CanvasTexture(makeEnvCanvas());
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    const envRT = pmrem.fromEquirectangular(envTex);
    scene.environment = envRT.texture;
    envTex.dispose();

    for (const k in TOWER_PAL) MATS['t_' + k] = makeUnitMaterials(envRT.texture, TOWER_PAL[k]);
    for (const k in ENEMY_PAL) MATS['e_' + k] = makeUnitMaterials(envRT.texture, ENEMY_PAL[k]);

    /* ---- 正交相机：严格复刻游戏投影 ---- */
    const tz = (CANVAS_H / 2) / K;
    camera = new THREE.OrthographicCamera(
      -CANVAS_W / 2, CANVAS_W / 2, CANVAS_H / 2, -CANVAS_H / 2, 1, 9000);
    camera.position.set(CANVAS_W / 2, 2000 * Math.sin(THETA), tz + 2000 * Math.cos(THETA));
    camera.lookAt(CANVAS_W / 2, 0, tz);
    camera.updateProjectionMatrix();

    /* ---- 光照：与原 2D 美术的光向一致（左上前） ---- */
    const sun = new THREE.DirectionalLight(0xfff2d8, 3.4);
    sun.position.set(CANVAS_W / 2 - 260, 520, tz + 240);
    sun.target.position.set(CANVAS_W / 2, 0, tz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 2600;
    const sc = 420;
    sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
    sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
    sun.shadow.bias = -0.0016;
    sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);

    const fill = new THREE.DirectionalLight(0xa8c8ea, 0.85);
    fill.position.set(CANVAS_W / 2 + 320, 180, tz - 180);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xeaf4ff, 1.5);
    rim.position.set(CANVAS_W / 2 - 60, 240, tz - 420);
    scene.add(rim);

    scene.add(new THREE.HemisphereLight(0xb7d0dd, 0x2f2a1e, 0.55));

    ready = true;
    return true;
  }

  /* ---------------------------------------------------------------- 合批
     一座塔有 100+ 个 mesh，20 座塔就是 2000+ draw call，必定掉帧。
     这里把「同材质」的几何合并成一个，按材质分组 →
     每座塔只剩 ~12 个 draw call，外观一模一样。
     pivot=true 的子节点会被拆成独立的合批单元（会自己转的零件）。 */

  /* 归一化几何：mergeGeometries 要求所有几何的「属性集合」和「有无 index」完全一致，
     否则直接返回 null（然后我们就会退化成逐块添加，白合并）。
     混合 indexed / non-indexed 是最常见的原因 —— 统一补一个平凡索引即可。 */
  function normalizeGeo(g) {
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
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    g.morphAttributes = {};
    g.clearGroups();
    return g;
  }

  const mergeFail = { n: 0 };

  function flatten(root) {
    const out = new THREE.Group();
    root.updateMatrixWorld(true);
    const buckets = new Map();     // material → [geometry]
    const pivots = [];

    function walk(node, baseInv) {
      node.children.forEach((ch) => {
        if (ch.userData && ch.userData.pivot) { pivots.push(ch); return; }
        if (ch.isMesh) {
          const g = normalizeGeo(ch.geometry.clone());
          const m = new THREE.Matrix4().multiplyMatrices(baseInv, ch.matrixWorld);
          g.applyMatrix4(m);
          if (!buckets.has(ch.material)) buckets.set(ch.material, []);
          buckets.get(ch.material).push(g);
        }
        if (ch.children.length) walk(ch, baseInv);
      });
    }

    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    walk(root, inv);

    for (const [mat, geos] of buckets) {
      if (!geos.length) continue;
      let merged = null;
      try {
        merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      } catch (e) {
        merged = null;
      }
      if (!merged) {
        mergeFail.n++;
        for (const g of geos) {
          const m = new THREE.Mesh(g, mat);
          m.castShadow = true; m.receiveShadow = true;
          out.add(m);
        }
        continue;
      }
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      out.add(m);
      if (geos.length > 1) geos.forEach(g => g.dispose());
    }

    for (const p of pivots) {
      const sub = flatten(p);
      sub.position.copy(p.position);
      sub.quaternion.copy(p.quaternion);
      sub.userData.pivotNode = p;
      out.add(sub);
    }
    return out;
  }

  /* 取缓存模板（同类同级的单位共用几何） */
  function template(kind, key, lv) {    const id = kind + ':' + key + ':' + lv;
    if (geoCache.has(id)) return geoCache.get(id);
    const built = kind === 'tower'
      ? buildTower(key, lv, MATS['t_' + key])
      : buildEnemy(key, MATS['e_' + key]);
    const tpl = {
      base: kind === 'tower' ? flatten(built.base) : null,
      yaw: flatten(built.yaw),
      spec: built.spec,
      lights: (built.spec && built.spec.emitters) || null,
    };
    geoCache.set(id, tpl);
    return tpl;
  }

  /* ---------------------------------------------------------------- 单位实例 */
  function instantiate(kind, key, lv) {
    /* 等级夹紧：模型只有 3 级（0/1/2）。万一引擎传进 3，
       TIER_MUL[3] 会是 undefined → 缩放 NaN → 整个单位**渲染不出来也不报错**。
       这是「放上去看不见」最隐蔽的一种成因，直接在入口掐掉。 */
    lv = Math.max(0, Math.min(2, lv | 0));
    const tpl = template(kind, key, lv);
    const root = new THREE.Group();
    const s = kind === 'tower' ? TOWER_S : ENEMY_S;
    root.scale.setScalar(s);

    if (tpl.base) {
      const b = tpl.base.clone(true);
      root.add(b);
    }
    const yaw = tpl.yaw.clone(true);
    root.add(yaw);

    /* 材质必须逐实例复制：受击闪白是改 emissive，共享材质会让全场一起闪。
       合批之后每个实例本来就只有十几个 mesh，多复制几份材质的代价很小。 */
    const mats = [];
    root.traverse((o) => {
      if (!o.material) return;
      if (o.material.userData && o.material.userData.cloned) return;
      const c2 = o.material.clone();
      c2.userData.cloned = true;
      o.material = c2;
      mats.push(c2);
    });

    const inst = {
      root, yaw, kind, key, level: lv,
      pivots: [], mats, s, tpl, flash: 0,
    };
    yaw.traverse((o) => { if (o.userData && o.userData.pivotNode) inst.pivots.push(o); });
    return inst;
  }

  function dispose(inst) {
    // 只摘下来，**不要 dispose 几何** —— 实例的几何是模板 clone 出来的共享引用，
    // dispose 会把同类其它单位一起弄坏。
    scene.remove(inst.root);
    inst.root.traverse((o) => {
      if (o.material && o.material.userData && o.material.userData.cloned) {
        o.material.dispose();
      }
    });
  }

  /* ---------------------------------------------------------------- 每帧同步 */
  const _v = new THREE.Vector3();

  function sync(game, t, dt) {
    if (!ready || !game) return;

    const alive = new Set();

    /* ---- 炮塔 ---- */
    for (const tw of game.towers) {
      if (failed.has(tw)) continue;
      let inst = units.get(tw);
      const wantLv = Math.max(0, Math.min(2, tw.level | 0));
      if (!inst || inst.level !== wantLv) {
        if (inst) { dispose(inst); units.delete(tw); }
        try {
          inst = instantiate('tower', tw.key, tw.level);
        } catch (e) {
          failed.add(tw);
          if (!warned.has('t:' + tw.key)) {
            warned.add('t:' + tw.key);
            console.warn('[gl3d] 炮塔建模失败，改用 2D 绘制：', tw.key, tw.level, e);
          }
          continue;
        }
        units.set(tw, inst);
        scene.add(inst.root);
      }
      alive.add(tw);

      // 落地位置：画布 (x, y) → 世界 (x, 0, y/K)
      inst.root.position.set(tw.x, 0, tw.y / K);

      /* 朝向：游戏的 aim 是「屏幕角度」（0 = 朝右，π/2 = 朝下）。
         游戏 pt() 里 u(前) → 屏幕 +x、v(右) → 屏幕 +y·K，
         所以屏幕角度 a 对应的地面方向是 (cos a, sin a·K)，
         换算成世界 = (cos a, 0, sin a)。
         模型车头是 +Z，绕 Y 转 φ 后指向 (sin φ, 0, cos φ)，
         令其等于 (cos a, 0, sin a) 得 φ = π/2 − a。 */
      const a = tw.aim;
      inst.yaw.rotation.y = Math.PI / 2 - a;

      // 建造动画：从小长出来
      const sp = tw.spawnT === undefined ? 1 : Math.min(1, tw.spawnT);
      const k = sp < 1 ? 0.55 + 0.45 * (1 - Math.pow(1 - sp, 3)) : 1;
      inst.root.scale.setScalar(inst.s * k);
      if (sp < 1) inst.root.scale.y *= 1 + Math.sin(sp * Math.PI) * 0.06;

      // 后坐：沿炮口反方向（地面平面内）平移
      if (tw.recoil > 0.001) {
        const r = tw.recoil * 5 * inst.s * 0.30;
        inst.root.position.x -= Math.cos(a) * r;
        inst.root.position.z -= Math.sin(a) * r;
      }

      /* NaN 自检：位置/朝向出现非有限值时，Three.js 会静默画不出任何东西
         （矩阵是 NaN，顶点全被丢弃），既不报错也不在 renderer.info 里露馅。
         遇到就退场并交给 2D 补画，绝不能让它变成「隐形单位」。 */
      if (!isFinite(inst.root.position.x) || !isFinite(inst.root.position.z) ||
          !isFinite(inst.yaw.rotation.y) || !isFinite(inst.root.scale.x)) {
        dispose(inst); units.delete(tw); failed.add(tw); alive.delete(tw);
        console.warn('[gl3d] 炮塔变换出现 NaN，改用 2D 绘制：', tw.key, tw.level);
      }
    }

    /* ---- 敌人 ---- */
    for (const e of game.enemies) {
      if (failed.has(e)) continue;
      let inst = units.get(e);
      if (!inst) {
        try {
          inst = instantiate('enemy', e.art, 0);
        } catch (err) {
          failed.add(e);
          if (!warned.has('e:' + e.art)) {
            warned.add('e:' + e.art);
            console.warn('[gl3d] 敌人建模失败，改用 2D 绘制：', e.art, err);
          }
          continue;
        }
        units.set(e, inst);
        scene.add(inst.root);
      }
      alive.add(e);

      const lift = e.air ? (AIR_LIFT + Math.sin(t * 3 + e.seed) * 2.5) / COS_T : 0;
      inst.root.position.set(e.x, lift, e.y / K);

      // 朝向：车头 +Z ↔ 屏幕角度（同炮塔的换算）
      const a = e.angle;
      inst.yaw.rotation.y = Math.PI / 2 - a;

      // 空中单位轻微侧摆，读起来像在飞
      inst.yaw.rotation.z = e.air ? Math.sin(t * 2.2 + e.seed) * 0.06 : 0;

      /* 受击闪白：游戏里 e.hitFlash 会快速衰减，这里映射成自发光。
         阈值很低（0.02）是为了对上任 2D 版那种「一碰就亮一下」的手感。 */
      const k = e.hitFlash > 0.02 ? Math.min(1, e.hitFlash * 2.2) : 0;
      if (Math.abs(k - inst.flash) > 0.01) {
        inst.flash = k;
        for (const m of inst.mats) {
          if (!m.emissive) continue;
          m.emissive.setRGB(k * 0.95, k * 0.97, k * 0.95);
          m.emissiveIntensity = k > 0 ? 1.6 : 0;
        }
      }

      // 旋翼 / 自转枢轴
      if (inst.pivots.length) {
        const spd = e.air ? 22 : 4;
        for (const p of inst.pivots) p.rotation.y += dt * spd;
      }
    }

    /* ---- 清理消失的单位 ---- */
    for (const [obj, inst] of units) {
      if (!alive.has(obj)) {
        dispose(inst);
        units.delete(obj);
      }
    }
    if (failed.size) {
      const now = new Set();
      for (const tw of game.towers) now.add(tw);
      for (const e of game.enemies) now.add(e);
      for (const o of failed) if (!now.has(o)) failed.delete(o);
    }
  }

  const _pv = new THREE.Vector3();
  /* 世界点 → 画布像素（左上原点） */
  function projectPoint(px, h, py) {
    _pv.set(px, h, py / K).project(camera);
    return [(_pv.x * 0.5 + 0.5) * CANVAS_W, (-_pv.y * 0.5 + 0.5) * CANVAS_H];
  }

  /* 在某个单位的脚下读一小块像素：全透明说明这一帧一个像素都没画出来。
     连续 25 次都是空 → 判定 3D 层失效，交给 main3d 回退 2D 单位绘制。 */
  function probePixels() {
    if (healthy || broken || !units.size) return;
    const inst = units.values().next().value;
    const p = projectPoint(inst.root.position.x, 0, inst.root.position.z * K);
    const gl = renderer.getContext();
    const pr = renderer.getPixelRatio();
    const half = PROBE_W >> 1;
    const cx = Math.round(p[0] * pr) - half;
    // readPixels 的原点在左下，画布坐标原点在左上
    const cy = Math.round((CANVAS_H - p[1]) * pr) - half;
    if (cx < 0 || cy < 0 ||
        cx + PROBE_W > canvas.width || cy + PROBE_W > canvas.height) return;
    probeBuf.fill(0);
    gl.readPixels(cx, cy, PROBE_W, PROBE_W, gl.RGBA, gl.UNSIGNED_BYTE, probeBuf);
    let nz = 0;
    for (let i = 3; i < probeBuf.length; i += 4) if (probeBuf[i] > 10) nz++;
    if (nz > 4) { healthy = true; zeroProbes = 0; }
    else if (++zeroProbes >= 25) {
      broken = true;
      console.warn('[gl3d] 连续 25 次采样不到像素，判定 WebGL 失效 → 回退 2D 单位绘制');
    }
  }

  function render(game) {
    if (!ready || broken) return;
    // 镜头抖动跟着游戏走
    const sx = game ? (game.shakeX || 0) : 0;
    const sy = game ? (game.shakeY || 0) : 0;
    const tz = (CANVAS_H / 2) / K;
    const tgt = new THREE.Vector3(CANVAS_W / 2 + sx, 0, tz + sy / K);
    camera.position.set(tgt.x, 2000 * Math.sin(THETA), tgt.z + 2000 * Math.cos(THETA));
    camera.lookAt(tgt);
    renderer.render(scene, camera);
    // 前几十帧做一次健康检查（读像素很贵，确认健康后就不再读）
    if (!healthy && !broken && (probeTick++ & 7) === 0) probePixels();
  }

  return {
    init, sync, render,
    get ready() { return ready; },
    get count() { return units.size; },
    /* true = 实测画布上没有任何像素，3D 层不可用，调用方应回退 2D */
    get broken() { return broken; },
    get healthy() { return healthy; },
    /* 建模失败、需要调用方用 2D 补画的对象 */
    failedUnits() { return [...failed]; },
    scene: () => scene,
    camera: () => camera,
    renderer: () => renderer,
    get mergeFail() { return mergeFail.n; },
    /* 自检用：把一个世界点投到画布坐标，验证投影和 2D 世界一致。
       期望 proj(px, 0, py/K) ≈ [px, py]。 */
    proj(px, h, py) { return projectPoint(px, h, py); },
    clear() {
      for (const [, inst] of units) dispose(inst);
      units.clear();
      failed.clear();
    },
  };
})();

window.GL3D = GL3D;
export default GL3D;
