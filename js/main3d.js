/* ============================================================
   main3d.js — 引导与主循环（真 3D 版）

   画面分三层：
     1. #game    2D —— 3D 模式下只剩底部 HUD 木栏（pass 4）
     2. #gl3d    WebGL —— 地形 / 炮塔 / 敌人 / 弹道 / 特效，全部 3D
     3. #gameTop 2D —— 血条 / 飘字 / 建造预览 / 射程圈

   任何一环失败都不影响可玩：
   - WebGL 不可用 / 初始化异常 / 上下文丢失 / 像素自检不通过
     → 整体退回纯 2D（js/main.js 那套：地形和单位都画在 Canvas 2D 上）
   - file:// 打开时 ES module 被 CORS 拦掉 → index.html 的兜底脚本加载 main.js
   ============================================================ */
window.__boot3d = true;

let World = null;
try {
  ({ World } = await import('./r3d/world.js'));
} catch (e) {
  console.warn('[r3d] 模块加载失败，回退 2D：', e);
}

const cGame = document.getElementById('game');
const cTop = document.getElementById('gameTop');
const xGame = cGame.getContext('2d');
const xTop = cTop.getContext('2d');

let dpr = 1;
let demoGame = null;
let use3D = false;
let world = null;
let fallbackNotice = false;

function resize2D() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const c of [cGame, cTop]) {
    c.width = Math.round(CANVAS_W * dpr);
    c.height = Math.round(CANVAS_H * dpr);
    c.style.width = CANVAS_W + 'px';
    c.style.height = CANVAS_H + 'px';
  }
}

/* 画布定位兜底：样式表被缓存成旧版时 #gl3d 会掉回文档流被 #game 盖住 */
(function lockLayout() {
  const rules = {
    game: 'position:absolute;left:0;top:0;width:1280px;height:720px;display:block;cursor:crosshair',
    gameTop: 'position:absolute;left:0;top:0;width:1280px;height:720px;display:block;pointer-events:none',
    /* 3D 只覆盖场地（576px），底部 144px 留给 2D 木栏 */
    gl3d: 'position:absolute;left:0;top:0;width:1280px;height:576px;display:block;pointer-events:none;background:transparent',
  };
  for (const id in rules) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('style', rules[id]);
  }
})();

function ensureDemo() {
  const want = UI.selMode.map;
  if (!demoGame || demoGame.map.key !== want) {
    demoGame = new Game({ map: want, mode: UI.selMode.mode, diff: UI.selMode.diff });
    demoGame.state = 'idle';
  }
  return demoGame;
}

function showNotice(msg) {
  if (fallbackNotice) return;
  fallbackNotice = true;
  const d = document.createElement('div');
  d.textContent = '⚠ ' + msg;
  d.setAttribute('style',
    'position:fixed;left:12px;bottom:12px;z-index:9999;padding:7px 12px;border-radius:8px;' +
    'background:rgba(60,30,0,.86);color:#ffd24a;font:600 12px/1.3 "PingFang SC",sans-serif;' +
    'border:1px solid #8a4f04;pointer-events:none');
  document.body.appendChild(d);
}

/* 2D 单位绘制（仅在回退时使用） */
function drawUnits2D(list, t) {
  const ents = [];
  for (const it of list) {
    if (it.kind === 'tower') ents.push({ y: it.o.y, o: it.o, k: 0 });
    else ents.push({ y: it.o.y, o: it.o, k: 1 });
  }
  ents.sort((a, b) => a.y - b.y);
  for (const it of ents) {
    if (it.k === 0) Art.drawTower(xTop, it.o, t);
    else Art.drawEnemy(xTop, it.o, t);
  }
}

/* ---------------------------------------------------------------- 启动 */

UI.init();
UI.fit();
resize2D();

const FORCE_2D = /[?&]gl=0(?:&|$)/.test(location.search);

if (!FORCE_2D && World) {
  try {
    world = new World();
    use3D = world.init(document.getElementById('gl3d'));
  } catch (e) {
    console.warn('[r3d] 初始化失败，回退 2D：', e);
    use3D = false;
  }
}
if (!use3D) {
  const el = document.getElementById('gl3d');
  if (el) el.style.display = 'none';
  if (!FORCE_2D && World) showNotice('3D 初始化失败，已回退 2D 画面');
}

window.addEventListener('resize', () => { UI.fit(); resize2D(); });
window.addEventListener('orientationchange', () => { UI.fit(); resize2D(); });

/* 上下文丢失 → 立即回退 */
if (use3D) {
  document.getElementById('gl3d').addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    use3D = false;
    if (window.__game3d) window.__game3d.forced2D = true;
    document.getElementById('gl3d').style.display = 'none';
    showNotice('WebGL 上下文丢失，已回退 2D 画面');
  }, false);
}

let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.06) dt = 0.06;
  const wallT = now / 1000;

  const g = UI.game || ensureDemo();
  if (UI.game) g.update(dt);

  /* 3D 是否真的可用 */
  let gl = use3D;
  if (gl && (!world || !world.ready || world.broken)) {
    gl = false;
    use3D = false;
    document.getElementById('gl3d').style.display = 'none';
    showNotice('3D 渲染异常，已回退 2D 画面');
  }
  g.fx3d = gl;

  /* ---- 1. 底层 2D ---- */
  xGame.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (gl) {
    g.render(xGame, wallT, 4);            // 只画底部木栏
  } else {
    xGame.clearRect(0, 0, CANVAS_W, CANVAS_H);
    g.render(xGame, wallT, 0);            // 完整 2D 地形
  }

  /* ---- 2. WebGL ---- */
  if (gl) {
    try {
      world.sync(g, wallT, dt);
      world.render(g, wallT);
    } catch (e) {
      console.warn('[r3d] 渲染出错，回退 2D：', e);
      use3D = false;
      gl = false;
      g.fx3d = false;
      document.getElementById('gl3d').style.display = 'none';
      showNotice('3D 渲染出错，已回退 2D 画面');
    }
  }

  /* ---- 3. 覆盖层 2D ---- */
  xTop.setTransform(dpr, 0, 0, dpr, 0, 0);
  xTop.clearRect(0, 0, CANVAS_W, CANVAS_H);
  xTop.save();
  xTop.translate(g.shakeX, g.shakeY);

  if (gl) {
    /* 建造预览 + 射程圈画在单位之上 —— 这是操作反馈，必须永远可见 */
    if (g.hoverCell) g.drawGhost(xTop);
    if (g.selected && g.selected.level !== undefined) g.drawRange(xTop, g.selected);
  } else {
    const list = [];
    for (const tw of g.towers) list.push({ kind: 'tower', o: tw });
    for (const e of g.enemies) list.push({ kind: 'enemy', o: e });
    if (list.length) drawUnits2D(list, wallT);
    g.render(xTop, wallT, 0);   // 地形（上层补画，避免与下层重复时闪）
    if (g.hoverCell) g.drawGhost(xTop);
    if (g.selected && g.selected.level !== undefined) g.drawRange(xTop, g.selected);
  }
  xTop.restore();

  /* 血条 / 飘字（两种模式都要） */
  g.render(xTop, wallT, 1);

  UI.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------------------------------------------------------------- 调试 */

window.__game3d = {
  forced2D: false,
  get gl() {
    return {
      ok: use3D,
      ready: world ? world.ready : false,
      broken: world ? world.broken : false,
      healthy: world ? world.healthy : false,
      units: world ? world.units : 0,
      towers: world ? world.towers.size : 0,
      calls: world && world.ctx && world.ctx.post.sceneStats ? world.ctx.post.sceneStats.calls : 0,
      tris: world && world.ctx && world.ctx.post.sceneStats ? world.ctx.post.sceneStats.tris : 0,
    };
  },
  get world() { return world; },
};

window.World3D = () => world;
