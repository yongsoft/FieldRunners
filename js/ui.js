/* ============================================================
   ui.js — HUD / 菜单 / 输入
   ============================================================ */
const UI = (() => {
  const $ = id => document.getElementById(id);
  const el = {
    app: $('app'), canvas: $('game'), hud: $('hud'), overlay: $('overlay'),
    money: $('uiMoney'), score: $('uiScore'), round: $('uiRound'), wave: $('uiWave'), lives: $('uiLives'),
    moneyBox: document.querySelector('.hud-money'), livesBox: document.querySelector('.hud-lives'),
    towerBar: $('towerBar'), banner: $('banner'), toasts: $('toasts'),
    towerPanel: $('towerPanel'), hintBar: $('hintBar'),
    btnPause: $('btnPause'), btnFF: $('btnFF'), btnSettings: $('btnSettings')
  };
  let game = null, ctx = null;
  let lastMoney = -1, lastLives = -1, lastScore = -1, lastRound = -1, lastWave = -1;
  let pendingKey = null, hoverCell = null, dragging = false, dragMoved = false;
  let selMode = { map: 'grasslands', mode: 'classic', diff: 'normal' };
  let curScreen = 'scTitle';
  let overTimer = null;      // 结算界面的延迟句柄：开新局时必须清掉，否则会飘到下一局
  let soundOn = true;

  /* ---------------- 屏幕 ---------------- */
  function show(id) {
    curScreen = id;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === id));
    el.overlay.classList.toggle('show', !!id);
    el.overlay.classList.toggle('soft', id === 'scPause');
    el.hud.classList.toggle('menu-open', !!id);   // 菜单打开时隐藏战斗 HUD
    document.body.style.cursor = id ? 'default' : '';
    // 只有真正在打仗时才铺环境底噪；回到菜单/结算屏就收掉
    Sfx.ambience(!id);
  }
  function hideAll() {
    curScreen = null;
    // 注意：必须把各屏自己的 show 也摘掉，否则「再玩一次」后 scOver 仍留着 show，
    // 之后任何依赖 .screen.show 的判断（含暂停逻辑）都会认错当前界面。
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('show'));
    el.overlay.classList.remove('show');
    el.hud.classList.remove('menu-open');
  }

  /* ---------------- 地图预览 ---------------- */
  function mapPreview(map, w, h) {
    const c = document.createElement('canvas');
    c.width = w * 2; c.height = h * 2;
    const x = c.getContext('2d');
    const g = Art.buildGround(map);
    // 只取场地部分（地面画布现在延伸到了底栏区域）
    x.drawImage(g, 0, 0, FIELD_W, FIELD_H, 0, 0, c.width, c.height);
    x.save(); x.scale(c.width / FIELD_W, c.height / FIELD_H);
    Art.drawTerrain(x, map);
    Art.drawDecor(x, map);
    x.restore();
    return c;
  }

  function buildSelect() {
    const wrap = $('mapList'); wrap.innerHTML = '';
    MAPS.forEach(m => {
      const d = document.createElement('div');
      d.className = 'mapcard' + (m.key === selMode.map ? ' on' : '');
      d.dataset.map = m.key;
      const c = mapPreview(m, 212, 95);
      d.appendChild(c);
      const info = document.createElement('div');
      info.className = 'mi';
      info.innerHTML = `<div class="mt">${m.name}</div><div class="me">${m.en}</div><div class="md">${m.tip}</div>`;
      d.appendChild(info);
      const b = document.createElement('div');
      b.className = 'badge lv' + (m.lvl || 1);
      b.textContent = (m.lv || '') + ' · ' + m.spawns.length + ' 个入口';
      d.appendChild(b);
      d.addEventListener('click', () => {
        selMode.map = m.key;
        wrap.querySelectorAll('.mapcard').forEach(k => k.classList.toggle('on', k.dataset.map === m.key));
        Sfx.click();
      });
      wrap.appendChild(d);
    });
  }

  function segWire(id, key, onPick) {
    const box = $(id);
    box.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach(k => k.classList.remove('on'));
        b.classList.add('on');
        selMode[key] = b.dataset.v;
        Sfx.click();
        onPick && onPick(b.dataset.v);
      });
    });
  }

  const MODE_DESC = {
    classic: '经典模式：100 波，仅可用原作四塔（机枪 / 胶水 / 导弹 / 电磁）。',
    extended: '扩展模式：100 波，追加火焰塔与迫击炮，六塔全开。',
    endless: '无尽模式：波次无上限，敌军强度持续攀升，挑战最高分。'
  };
  const DIFF_DESC = {
    easy: '简单：初始 $170，敌军强度 82%，击杀收益 115%。',
    normal: '普通：初始 $130，敌军强度 100%，击杀收益 100%。',
    hard: '高手：初始 $100，敌军强度 128%，击杀收益 90%。'
  };

  /* ---------------- 炮塔栏 ---------------- */
  function buildBar() {
    el.towerBar.innerHTML = '';
    if (!game) return;
    game.towerPool.forEach((key, i) => {
      const def = TOWERS[key];
      const b = document.createElement('button');
      b.className = 'tbtn';
      b.dataset.key = key;
      b.title = `${def.name} · ${def.desc}`;
      const gem = document.createElement('span'); gem.className = 'gem';
      const c = Art.towerIcon(key, 66);
      const kb = document.createElement('span'); kb.className = 'kb'; kb.textContent = i + 1;
      const price = document.createElement('span'); price.className = 'price'; price.textContent = '$' + def.cost;
      b.append(gem, c, kb, price);

      b.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        Sfx.resume();
        if (game.money < def.cost) { Sfx.deny(); toast('金钱不足', true); return; }
        if (pendingKey === key) { setPending(null); return; }
        setPending(key);
        dragging = true; dragMoved = false;
        Sfx.click();
      });
      el.towerBar.appendChild(b);
    });
    refreshBar();
  }

  function setPending(k) {
    pendingKey = k;
    el.towerBar.querySelectorAll('.tbtn').forEach(b => b.classList.toggle('sel', b.dataset.key === k));
    el.canvas.style.cursor = k ? 'copy' : 'crosshair';
    if (k) {
      const d = TOWERS[k];
      el.hintBar.textContent = `${d.name} $${d.cost} · ${d.desc}`;
      el.hintBar.classList.remove('hide');
    } else if (game && game.towers.length) el.hintBar.classList.add('hide');
  }

  function refreshBar() {
    if (!game) return;
    el.towerBar.querySelectorAll('.tbtn').forEach(b => {
      const def = TOWERS[b.dataset.key];
      const poor = game.money < def.cost;
      b.classList.toggle('poor', poor);
    });
  }

  /* ---------------- HUD 刷新 ---------------- */
  function bump(node) { node.classList.add('bump'); setTimeout(() => node.classList.remove('bump'), 130); }

  function update() {
    if (!game) return;
    if (game.money !== lastMoney) {
      if (lastMoney >= 0 && game.money > lastMoney) bump(el.moneyBox);
      el.money.textContent = game.money; lastMoney = game.money; refreshBar(); refreshPanel();
    }
    if (game.lives !== lastLives) {
      el.lives.textContent = game.lives; lastLives = game.lives;
      el.livesBox.classList.toggle('low', game.lives <= 5);
    }
    if (game.score !== lastScore) { el.score.textContent = game.score.toLocaleString('en-US'); lastScore = game.score; }
    if (game.round !== lastRound) { el.round.textContent = game.roundLabel; lastRound = game.round; }
    const rem = game.remainingEnemies;
    if (rem !== lastWave) { el.wave.textContent = '剩余 ' + rem; lastWave = rem; }
    if (el.round.textContent !== game.roundLabel) el.round.textContent = game.roundLabel;
  }

  function showBanner(text, cls, ms) {
    el.banner.textContent = text;
    el.banner.className = 'banner show ' + (cls || '');
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => el.banner.classList.remove('show'), ms || 2200);
  }

  /* 提示条：同一条消息合并刷新，最多同时显示 3 条，避免刷屏挡住战场 */
  const liveToasts = new Map();
  function toast(msg, bad, key) {
    key = key || msg;
    const old = liveToasts.get(key);
    if (old) {
      old.el.textContent = msg;
      clearTimeout(old.t);
      old.t = setTimeout(() => drop(key), 1200);
      return;
    }
    const d = document.createElement('div');
    d.className = 'toast' + (bad ? ' bad' : '');
    d.textContent = msg;
    el.toasts.appendChild(d);
    const rec = { el: d, t: null };
    rec.t = setTimeout(() => drop(key), 1200);
    liveToasts.set(key, rec);
    while (liveToasts.size > 3) drop(liveToasts.keys().next().value);
  }
  function drop(key) {
    const rec = liveToasts.get(key);
    if (!rec) return;
    liveToasts.delete(key);
    clearTimeout(rec.t);
    const d = rec.el;
    d.style.transition = 'opacity .28s,transform .28s';
    d.style.opacity = '0'; d.style.transform = 'translateY(-10px)';
    setTimeout(() => d.remove(), 320);
  }

  let leakCount = 0, leakReset = null;
  function leakToast() {
    leakCount++;
    clearTimeout(leakReset);
    leakReset = setTimeout(() => { leakCount = 0; }, 1800);
    toast('敌人突破防线  -' + leakCount + ' 生命', true, 'leak');
  }

  let flashT = null;
  function flashRed() {
    let f = document.getElementById('flash');
    if (!f) {
      f = document.createElement('div'); f.id = 'flash';
      f.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;opacity:0;' +
        'background:radial-gradient(circle at 50% 50%,rgba(255,0,0,0) 48%,rgba(190,20,20,.55) 100%)';
      el.hud.appendChild(f);
    }
    clearTimeout(flashT);
    f.style.transition = 'none'; f.style.opacity = '0.9';
    requestAnimationFrame(() => { f.style.transition = 'opacity .55s'; f.style.opacity = '0'; });
  }

  /* ---------------- 炮塔面板 ---------------- */
  let panelTower = null;
  function fmtStats(tw) {
    const key = tw.key;
    // 用炮塔的实际数值（高地上的塔伤害已被加成），而不是原始表
    const L = tw.L || TOWERS[key].levels[tw.level];
    const mul = tw.dmgMul || 1;
    let nx = tw.level < 2 ? TOWERS[key].levels[tw.level + 1] : null;
    if (nx && mul !== 1) {
      nx = Object.assign({}, nx);
      if (nx.dmg != null) nx.dmg = Math.round(nx.dmg * mul * 10) / 10;
      if (nx.dps != null) nx.dps = Math.round(nx.dps * mul * 10) / 10;
      if (nx.burn != null) nx.burn = Math.round(nx.burn * mul * 10) / 10;
    }
    const row = (label, cur, next, unit) => {
      const s = `<div>${label}：<span>${cur}${unit || ''}</span>${next ? ` <span class="up">→ ${next}${unit || ''}</span>` : ''}</div>`;
      return s;
    };
    const out = [];
    if (key === 'gatling') {
      out.push(row('单发伤害', L.dmg, nx && nx.dmg));
      out.push(row('射速', L.rate.toFixed(1), nx && nx.rate.toFixed(1), ' 发/秒'));
      out.push(row('射程', L.range, nx && nx.range, ' px'));
      out.push(row('理论秒伤', Math.round(L.dmg * L.rate), nx && Math.round(nx.dmg * nx.rate)));
    } else if (key === 'goo') {
      out.push(row('伤害', L.dmg, nx && nx.dmg));
      out.push(row('减速', Math.round(L.slow * 100), nx && Math.round(nx.slow * 100), '%'));
      out.push(row('减速时长', L.slowDur.toFixed(1), nx && nx.slowDur.toFixed(1), ' 秒'));
      out.push(row('射程', L.range, nx && nx.range, ' px'));
    } else if (key === 'missile') {
      out.push(row('爆炸伤害', L.dmg, nx && nx.dmg));
      out.push(row('射速', L.rate.toFixed(2), nx && nx.rate.toFixed(2), ' 发/秒'));
      out.push(row('溅射半径', L.splash, nx && nx.splash, ' px'));
      out.push(row('射程', L.range, nx && nx.range, ' px'));
    } else if (key === 'flame') {
      out.push(row('每秒伤害', L.dps, nx && nx.dps));
      out.push(row('射程', L.range, nx && nx.range, ' px'));
      out.push(row('灼烧', L.burn, nx && nx.burn, ' 点/秒'));
      out.push(`<div>仅对<span>地面</span>单位有效</div>`);
    } else if (key === 'tesla') {
      out.push(row('单次伤害', L.dmg, nx && nx.dmg));
      out.push(row('射速', L.rate.toFixed(2), nx && nx.rate.toFixed(2), ' 发/秒'));
      out.push(row('连锁目标', L.chain, nx && nx.chain, ' 个'));
      out.push(row('射程', L.range, nx && nx.range, ' px'));
    } else if (key === 'mortar') {
      out.push(row('爆炸伤害', L.dmg, nx && nx.dmg));
      out.push(row('射速', L.rate.toFixed(2), nx && nx.rate.toFixed(2), ' 发/秒'));
      out.push(row('溅射半径', L.splash, nx && nx.splash, ' px'));
      out.push(row('射程', L.range, nx && nx.range, ' px'));
      out.push(`<div>仅对<span>地面</span>单位有效</div>`);
    }
    return out.join('');
  }

  const MODE_NAME = { first: '最前', last: '最后', strong: '最强', close: '最近' };

  function showPanel(tw) {
    panelTower = tw;
    const key = tw.key, def = TOWERS[key];
    const canUp = tw.level < 2, upCost = canUp ? upgradeCost(key, tw.level) : 0;
    const afford = canUp && game.money >= upCost;
    const sv = sellValue(tw);
    el.towerPanel.innerHTML = `
      <div class="tp-head">
        <div class="tp-name">${def.name}<div class="tp-lv">LV ${tw.level + 1}${'★'.repeat(tw.level)}</div></div>
      </div>
      ${tw.onHill ? `<div class="tp-terr">⛰ 建于高地 · 伤害 <b>+${Math.round((tw.dmgMul - 1) * 100)}%</b></div>` : ''}
      <div class="tp-stats">${fmtStats(tw)}</div>
      <div class="tp-modes">
        ${['first', 'close', 'strong', 'last'].map(m =>
          `<button data-m="${m}" class="${tw.mode === m ? 'on' : ''}">${MODE_NAME[m]}</button>`).join('')}
      </div>
      <div class="tp-btns">
        <button id="tpUp" ${canUp && afford ? '' : 'disabled'}>${canUp ? '升级 $' + upCost : '已满级'}</button>
        <button id="tpSell" class="sell">出售 $${sv}</button>
      </div>`;
    const icon = Art.towerIcon(key, 44);
    icon.style.width = '44px'; icon.style.height = '44px';
    el.towerPanel.querySelector('.tp-head').prepend(icon);
    el.towerPanel.classList.add('show');

    el.towerPanel.querySelectorAll('.tp-modes button').forEach(b => {
      b.addEventListener('click', () => {
        tw.mode = b.dataset.m;
        el.towerPanel.querySelectorAll('.tp-modes button').forEach(k => k.classList.toggle('on', k === b));
        Sfx.click();
      });
    });
    const up = el.towerPanel.querySelector('#tpUp');
    if (up && !up.disabled) up.addEventListener('click', () => {
      if (game.upgradeTower(tw)) showPanel(tw);
    });
    el.towerPanel.querySelector('#tpSell').addEventListener('click', () => {
      game.sellTower(tw); hidePanel();
    });
    positionPanel(tw);
  }
  // 只刷新按钮状态，不重建面板（重建会不断生成新的图标 canvas，浪费且会打断点击）
  function refreshPanel() {
    if (!panelTower || !el.towerPanel.classList.contains('show')) return;
    const tw = panelTower;
    const canUp = tw.level < 2;
    const upCost = canUp ? upgradeCost(tw.key, tw.level) : 0;
    const up = el.towerPanel.querySelector('#tpUp');
    const sell = el.towerPanel.querySelector('#tpSell');
    if (up) {
      up.disabled = !canUp || game.money < upCost;
      up.textContent = canUp ? '升级 $' + upCost : '已满级';
    }
    if (sell) sell.textContent = '出售 $' + sellValue(tw);
  }
  function hidePanel() { panelTower = null; el.towerPanel.classList.remove('show'); }

  function positionPanel(tw) {
    const w = 250, h = el.towerPanel.offsetHeight || 250;
    let left = tw.x - w / 2;
    let top = tw.y - h - 34;
    if (top < 96) top = tw.y + 40;
    if (top + h > APRON_Y - 10) top = Math.max(96, APRON_Y - h - 12);
    left = clamp(left, 10, CANVAS_W - w - 10);
    el.towerPanel.style.left = left + 'px';
    el.towerPanel.style.top = top + 'px';
  }

  /* ---------------- 输入 ---------------- */
  function toCanvas(ev) {
    const r = el.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * CANVAS_W, y: (ev.clientY - r.top) / r.height * CANVAS_H };
  }
  function inField(p) { return p.x >= 0 && p.y >= 0 && p.x < FIELD_W && p.y < FIELD_H; }

  function towerAt(p) {
    const c = Math.floor(p.x / CELL), r = Math.floor(p.y / CELL);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
    return game.grid[r * COLS + c];
  }

  function bindInput() {
    el.canvas.addEventListener('pointermove', ev => {
      const p = toCanvas(ev);
      if (inField(p)) {
        hoverCell = { c: Math.floor(p.x / CELL), r: Math.floor(p.y / CELL) };
      } else hoverCell = null;
      if (dragging) { dragMoved = true; game.hoverCell = hoverCell; game.pendingKey = pendingKey; }
      else { game.hoverCell = pendingKey ? hoverCell : null; game.pendingKey = pendingKey; }
      // 悬停时把「这一格是什么地形、能不能建、为什么不能建」直接写在提示条上
      if (pendingKey && hoverCell) {
        const def = TOWERS[pendingKey];
        const tile = game.cellTile(hoverCell.c, hoverCell.r);
        let tinfo = tile.name;
        if (tile.key === 'hill') tinfo += ' · 伤害 +' + Math.round((tile.dmgMul - 1) * 100) + '%';
        if (tile.key === 'ford') tinfo += ' · 敌人减速 ' + Math.round((1 - tile.speed) * 100) + '%';
        const why = game.canPlace(hoverCell.c, hoverCell.r, pendingKey);
        el.hintBar.classList.remove('hide');
        el.hintBar.textContent = `${def.name} $${def.cost} · ${tinfo} · ` + (why ? '✕ ' + why : '点击建造');
      } else if (pendingKey) {
        el.hintBar.classList.remove('hide');
        el.hintBar.textContent = TOWERS[pendingKey].name + ' $' + TOWERS[pendingKey].cost + ' · ' + TOWERS[pendingKey].desc;
      }
    });
    el.canvas.addEventListener('pointerleave', () => { hoverCell = null; game.hoverCell = null; });

    el.canvas.addEventListener('pointerdown', ev => {
      Sfx.resume();
      if (ev.button === 2) return;
      const p = toCanvas(ev);
      if (!inField(p)) return;
      const c = Math.floor(p.x / CELL), r = Math.floor(p.y / CELL);
      const occupied = game.grid[r * COLS + c];
      if (pendingKey && !occupied) {
        if (game.placeTower(c, r, pendingKey)) {
          if (game.money < TOWERS[pendingKey].cost) setPending(null);
        }
        return;
      }
      // 手里拿着炮塔却点到已有炮塔：放下手里的，改为查看这座塔
      if (occupied) {
        if (pendingKey) setPending(null);
        game.selected = occupied; showPanel(occupied); Sfx.click();
      } else {
        game.selected = null; hidePanel();
      }
    });

    el.canvas.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      if (pendingKey) setPending(null); else { game.selected = null; hidePanel(); }
    });

    window.addEventListener('pointerup', ev => {
      if (!dragging) return;
      dragging = false;
      const p = toCanvas(ev);
      if (dragMoved && inField(p)) {
        const c = Math.floor(p.x / CELL), r = Math.floor(p.y / CELL);
        if (pendingKey && game.placeTower(c, r, pendingKey)) {
          if (game.money < TOWERS[pendingKey].cost) setPending(null);
        }
      }
      dragMoved = false;
    });

    document.addEventListener('keydown', ev => {
      const k = (ev.key || '').toLowerCase();
      if (!game || curScreen) {
        // 暂停界面里空格 / Esc 都能直接继续
        if (curScreen === 'scPause' && (k === ' ' || ev.key === 'Escape')) { ev.preventDefault(); togglePause(); }
        return;
      }
      if (k >= '1' && k <= '9') {
        const idx = parseInt(k, 10) - 1;
        const key = game.towerPool[idx];
        if (key) {
          if (game.money < TOWERS[key].cost) { Sfx.deny(); toast('金钱不足', true); }
          else setPending(pendingKey === key ? null : key);
        }
      } else if (k === 'escape') { setPending(null); game.selected = null; hidePanel(); }
      else if (k === ' ') { ev.preventDefault(); togglePause(); }
      else if (k === 'f') { toggleFF(); }
      else if (k === 'u' && game.selected) { if (game.upgradeTower(game.selected)) showPanel(game.selected); }
      else if (k === 's' && game.selected) { game.sellTower(game.selected); hidePanel(); }
    });
  }

  /* ---------------- 暂停 / 加速 ---------------- */
  function togglePause() {
    if (!game) return;
    if (curScreen === 'scPause') { game.paused = false; hideAll(); el.banner.classList.remove('show'); el.btnPause.classList.remove('on'); }
    else if (!curScreen) {
      game.paused = true; show('scPause'); el.btnPause.classList.add('on');
      showBanner('PAUSED', 'paused', 99999);
    }
  }
  function toggleFF() {
    if (!game) return;
    game.speed = game.speed === 1 ? 2 : 1;
    el.btnFF.classList.toggle('on', game.speed === 2);
    toast(game.speed === 2 ? '加速 2×' : '恢复正常速度');
  }

  /* ---------------- 启动一局 ---------------- */
  function launch() {
    clearTimeout(overTimer); overTimer = null;   // 上一局的结算延迟不要飘到这一局
    Sfx.resume();
    game = new Game({ map: selMode.map, mode: selMode.mode, diff: selMode.diff });
    wireGame();
    buildBar();
    hideAll();
    Sfx.ambience(true);        // 开战：铺一层极轻的风声底噪
    lastMoney = lastLives = lastScore = lastRound = lastWave = -1;
    el.btnFF.classList.remove('on'); el.btnPause.classList.remove('on');
    el.hintBar.classList.remove('hide');
    el.hintBar.textContent = '选择下方炮塔，点击草地即可建造 · 敌人会自动绕行 · 高地建塔伤害 +35%';
    hidePanel(); setPending(null);
    showBanner('ROUND 1', '', 2400);
    game.nextRoundT = 2.4;      // 由引擎主循环倒计时，暂停/加速都能正确生效
    return game;
  }

  function wireGame() {
    game.events.onRound = n => { showBanner('ROUND ' + n, '', 2200); };
    game.events.onDeny = msg => { Sfx.deny(); toast(msg, true); };
    game.events.onLeak = e => { flashRed(); leakToast(); };
    game.events.onBuild = () => { el.hintBar.classList.add('hide'); };
    game.events.onGameOver = () => { clearTimeout(overTimer); overTimer = setTimeout(() => showOver(false), 900); };
    game.events.onVictory = () => { clearTimeout(overTimer); overTimer = setTimeout(() => showOver(true), 900); };
  }

  function showOver(win) {
    $('overTitle').textContent = win ? '阵地守住了！' : '阵地失守';
    $('overTitle').style.color = win ? '#b6ff6a' : '#ff9d9d';
    $('overStats').innerHTML =
      `战场：<b>${game.map.name}</b> &nbsp;·&nbsp; 模式：<b>${({ classic: '经典', extended: '扩展', endless: '无尽' })[game.mode]}</b><br>
       坚持到第 <b>${game.round}</b> 波 &nbsp;·&nbsp; 最终得分 <b>${game.score.toLocaleString('en-US')}</b><br>
       击杀 <b>${game.kills}</b> &nbsp;·&nbsp; 漏过 <b>${game.leaks}</b> &nbsp;·&nbsp; 剩余生命 <b>${game.lives}</b>`;
    show('scOver');
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    buildSelect();
    segWire('modeSeg', 'mode', v => { $('modeDesc').textContent = MODE_DESC[v]; });
    segWire('diffSeg', 'diff', v => { $('diffDesc').textContent = DIFF_DESC[v]; });
    $('modeDesc').textContent = MODE_DESC.classic;
    $('diffDesc').textContent = DIFF_DESC.normal;

    document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      Sfx.resume(); Sfx.click(); show(b.dataset.go);
    }));
    $('btnLaunch').addEventListener('click', () => { Sfx.resume(); Sfx.click(); launch(); });
    $('btnResume').addEventListener('click', togglePause);
    $('btnRetry').addEventListener('click', () => { Sfx.click(); launch(); });
    $('btnBackMenu').addEventListener('click', () => { Sfx.click(); show('scTitle'); });
    $('btnQuit').addEventListener('click', () => { Sfx.click(); game = null; show('scTitle'); });
    $('btnSound').addEventListener('click', () => {
      soundOn = !soundOn; Sfx.resume(); Sfx.setEnabled(soundOn);
      $('btnSound').textContent = '音效：' + (soundOn ? '开' : '关');
      if (soundOn) { Sfx.ambience(!curScreen); Sfx.click(); }
    });
    el.btnPause.addEventListener('click', () => { Sfx.resume(); Sfx.click(); togglePause(); });
    el.btnFF.addEventListener('click', () => { Sfx.resume(); Sfx.click(); toggleFF(); });
    el.btnSettings.addEventListener('click', () => { Sfx.resume(); Sfx.click(); togglePause(); });

    bindInput();
    show('scTitle');
  }

  function fit() {
    const s = Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H);
    el.app.style.transform = `translate(-50%,-50%) scale(${s})`;
  }

  return {
    init, fit, update, show, launch,
    get game() { return game; },
    get pendingKey() { return pendingKey; },
    get selMode() { return selMode; }
  };
})();
