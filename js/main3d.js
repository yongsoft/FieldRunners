/* ============================================================
   main3d.js — 引导与主循环（三层绘制）

   绘制顺序：
      1. #game    （2D）地形 / 基地 / 建造预览 / 射程圈     render(x, t, 0)
      2. #gl3d    （WebGL）炮塔与敌人                        GL3D.sync + render
      3. #gameTop （2D）血条 / 光束 / 弹道 / 飘字            render(x, t, 1)

   这三层都在 #app 里，跟着同一个 transform:scale 缩放，所以对位天然一致。
   ============================================================ */
/* three.js 是 ES module。本文件也是 module，所以用顶层 await 把它加载完再初始化；
   加载失败（文件缺失 / 浏览器不支持 WebGL）时整个 3D 层优雅降级到 2D 单位渲染，
   游戏照样能玩。 */
window.__boot3d = true;      // 给 index.html 里的 file:// 兜底脚本用：模块起来了就别再启 2D 入口
let GL3D;
try {
  GL3D = (await import('./gl3d.js')).default;
} catch (e) {
  console.warn('[gl3d] 模块加载失败，回退 2D：', e);
  GL3D = { ready: false, init: () => false, sync() {}, render() {}, clear() {}, count: 0 };
}

const cGame = document.getElementById('game');
const cTop = document.getElementById('gameTop');
const xGame = cGame.getContext('2d');
const xTop = cTop.getContext('2d');

let dpr = 1;
let demoGame = null;
let glOK = false;

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const c of [cGame, cTop]) {
    c.width = Math.round(CANVAS_W * dpr);
    c.height = Math.round(CANVAS_H * dpr);
    c.style.width = CANVAS_W + 'px';
    c.style.height = CANVAS_H + 'px';
  }
  // WebGL 画布由 renderer.setSize 负责（含 pixelRatio）
}

function ensureDemo() {
  const want = UI.selMode.map;
  if (!demoGame || demoGame.map.key !== want) {
    demoGame = new Game({ map: want, mode: UI.selMode.mode, diff: UI.selMode.diff });
    demoGame.state = 'idle';
    if (GL3D.ready) GL3D.clear();
  }
  return demoGame;
}

UI.init();
UI.fit();
resizeCanvas();

/* ?gl=0 关掉 3D，回退到原来的 2D 单位渲染 —— A/B 对比和应急用 */
const FORCE_2D = /[?&]gl=0(?:&|$)/.test(location.search);
try {
  glOK = FORCE_2D ? false : GL3D.init();
} catch (e) {
  console.warn('[gl3d] 初始化失败，回退到 2D 单位渲染：', e);
  glOK = false;
}
if (FORCE_2D) {
  document.getElementById('gl3d').style.display = 'none';
}

/* 画布定位兜底：样式表被缓存成旧版时 #gl3d 会掉回文档流被 #game 盖住，
   表现就是「地图正常、炮塔看不见」。这里在运行时再写一遍，绝不吃缓存。 */
(function lockCanvasLayout() {
  const rules = {
    game: 'position:absolute;inset:0;width:1280px;height:720px;display:block;cursor:crosshair',
    gl3d: 'position:absolute;inset:0;width:1280px;height:720px;display:block;pointer-events:none;background:transparent',
    gameTop: 'position:absolute;inset:0;width:1280px;height:720px;display:block;pointer-events:none',
  };
  for (const id in rules) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('style', rules[id]);
  }
})();
if (FORCE_2D) {
  document.getElementById('gl3d').style.display = 'none';
}

/* 回退提示：只在真的降级时出现，帮用户一眼知道当前在跑哪条渲染路径 */
let noteShown = false;
function showFallbackNote(msg) {
  if (noteShown) return;
  noteShown = true;
  const d = document.createElement('div');
  d.textContent = '⚠ ' + msg + '（刷新页面可重试）';
  d.setAttribute('style',
    'position:fixed;left:12px;bottom:12px;z-index:9999;padding:7px 12px;border-radius:8px;' +
    'background:rgba(60,30,0,.86);color:#ffd24a;font:600 12px/1.3 "PingFang SC",sans-serif;' +
    'border:1px solid #8a4f04;pointer-events:none');
  document.body.appendChild(d);
}

/* 2D 版单位绘制（回退路径 / 个别建模失败的补画） */
function drawUnits2D(list, t) {
  const ents = [];
  for (const it of list) {
    if (it.kind === 'tower') ents.push({ y: it.o.y, o: it.o, k: 0 });
  }
  for (const it of list) {
    if (it.kind === 'enemy') ents.push({ y: it.o.y, o: it.o, k: 1 });
  }
  ents.sort((a, b) => a.y - b.y);
  for (const it of ents) {
    if (it.k === 0) Art.drawTower(xTop, it.o, t);
    else Art.drawEnemy(xTop, it.o, t);
  }
}

window.addEventListener('resize', () => { UI.fit(); resizeCanvas(); });
window.addEventListener('orientationchange', () => { UI.fit(); resizeCanvas(); });

let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.06) dt = 0.06;
  const wallT = now / 1000;

  const g = UI.game || ensureDemo();
  if (UI.game) g.update(dt);

  // ---- 1. 地形层
  xGame.setTransform(dpr, 0, 0, dpr, 0, 0);
  xGame.clearRect(0, 0, CANVAS_W, CANVAS_H);
  g.render(xGame, wallT, 0);

  // ---- 2. 3D 单位层
  let used3D = false;
  if (glOK && GL3D.ready && !GL3D.broken) {
    try {
      GL3D.sync(g, wallT, dt);
      GL3D.render(g);
      used3D = true;
    } catch (e) {
      // 3D 层的任何异常都不许拖垮主循环
      glOK = false;
      console.warn('[gl3d] 渲染出错，回退 2D：', e);
      showFallbackNote('3D 渲染出错，已回退 2D 单位');
      document.getElementById('gl3d').style.display = 'none';
    }
  } else if (glOK && GL3D.broken) {
    glOK = false;
    showFallbackNote('WebGL 画布无输出，已回退 2D 单位');
    document.getElementById('gl3d').style.display = 'none';
  }

  xTop.setTransform(dpr, 0, 0, dpr, 0, 0);
  xTop.clearRect(0, 0, CANVAS_W, CANVAS_H);

  if (used3D) {
    /* 个别单位建模失败（3D 里没有它）时，用 2D 补画，不能让它凭空消失 */
    const fu = GL3D.failedUnits();
    if (fu.length) {
      const list = [];
      for (const o of fu) {
        if (o.key && o.c !== undefined) list.push({ kind: 'tower', o });
        else list.push({ kind: 'enemy', o });
      }
      xTop.save();
      xTop.translate(g.shakeX, g.shakeY);
      drawUnits2D(list, wallT);
      xTop.restore();
    }
  } else if (g.towers.length || g.enemies.length) {
    // 回退：单位用 2D 画到上层（地形层已经画完了，把单位补在上层）
    const list = [];
    for (const tw of g.towers) list.push({ kind: 'tower', o: tw });
    for (const e of g.enemies) list.push({ kind: 'enemy', o: e });
    xTop.save();
    xTop.translate(g.shakeX, g.shakeY);
    drawUnits2D(list, wallT);
    xTop.restore();
  }
  g.render(xTop, wallT, 1);

  UI.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* 调试接口 */
window.__game3d = {
  get gl() {
    return {
      ok: glOK, ready: GL3D.ready, units: GL3D.count,
      broken: GL3D.broken, healthy: GL3D.healthy,
      failed: GL3D.failedUnits ? GL3D.failedUnits().length : 0,
    };
  },
  GL3D,
};

/* 暴露给测试脚本 */
window.GL3D = GL3D;
