/* ============================================================
   main.js — 引导与主循环
   ============================================================ */
(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let demoGame = null;

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(CANVAS_W * dpr);
    canvas.height = Math.round(CANVAS_H * dpr);
    canvas.style.width = CANVAS_W + 'px';
    canvas.style.height = CANVAS_H + 'px';
  }

  function ensureDemo() {
    const want = UI.selMode.map;
    if (!demoGame || demoGame.map.key !== want) {
      demoGame = new Game({ map: want, mode: UI.selMode.mode, diff: UI.selMode.diff });
      demoGame.state = 'idle';
    }
    return demoGame;
  }

  UI.init();
  UI.fit();
  resizeCanvas();
  window.addEventListener('resize', () => { UI.fit(); resizeCanvas(); });
  window.addEventListener('orientationchange', () => { UI.fit(); resizeCanvas(); });

  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.06) dt = 0.06;           // 掉帧保护
    const wallT = now / 1000;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const g = UI.game;
    if (g) {
      g.update(dt);
      g.render(ctx, wallT);
    } else {
      const d = ensureDemo();
      d.render(ctx, wallT);
    }
    UI.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
