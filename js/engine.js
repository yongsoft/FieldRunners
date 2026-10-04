/* ============================================================
   engine.js — 核心玩法引擎
   原作精髓：炮塔可自由摆放，敌人自动绕行 —— 用「流场寻路」实现
   ============================================================ */

const DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
const DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

/* 声像：按声源在战场上的横向位置做左右定位（-1 左 .. 1 右）。
   乘 0.85 留一点余量，避免极端声道听起来"跳出画面"。 */
function panOf(x) {
  return clamp(((x / FIELD_W) * 2 - 1) * 0.85, -1, 1);
}

/* ------------------------------------------------------------
   伪 3D：炮塔/敌人是斜视画的，所以「地面上量出来的偏移」
   （炮口位置、发射箱错位、后座位移）也必须走同一套压缩，
   否则炮口焰会飘到炮管外面。GROUND_K 与 art.js 共用一份。
   注意：**投射物的速度方向不投影** —— 弹道走的是俯视世界坐标，
   投影速度会让子弹打不到目标。
   ------------------------------------------------------------ */
const GK = (typeof Art !== 'undefined' && Art.GROUND_K) || 0.72;
/* 地面偏移的 x / y 分量 */
function gxOff(ang, d) { return Math.cos(ang) * d; }
function gyOff(ang, d) { return Math.sin(ang) * d * GK; }

class Game {
  constructor(opts) {
    this.map = MAPS.find(m => m.key === opts.map) || MAPS[0];
    this.mode = opts.mode || 'classic';           // classic | extended | endless
    this.diff = DIFFICULTIES[opts.diff] || DIFFICULTIES.normal;
    this.maxRounds = this.mode === 'endless' ? Infinity : CLASSIC_ROUNDS;
    this.towerPool = this.mode === 'classic' ? CLASSIC_TOWERS : TOWER_ORDER;

    this.money = this.diff.money;
    this.lives = this.diff.lives;
    this.score = 0;
    this.round = 0;
    this.state = 'ready';          // ready | round | gameover | victory
    this.speed = 1;
    this.paused = false;
    this.time = 0;
    this.shake = 0;
    this.shakeX = 0; this.shakeY = 0;

    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.floaters = [];
    this.beams = [];

    this.grid = new Array(COLS * ROWS).fill(null);
    this.blocked = new Uint8Array(PC * PR);
    this.fields = [];

    /* 地形：不可通行的格子（河 / 高地 / 房屋 / 基地）预先烘到一张细网格上，
       之后每次 rebuildBlocked 都以它为底，再叠加炮塔的占位。 */
    this.tileGrid = parseTerrain(this.map);
    this.baseBlocked = new Uint8Array(PC * PR);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = TILE_LIST[this.tileGrid[r * COLS + c]];
      if (!t.block) continue;
      const c0 = (c * CELL / PF) | 0, c1 = (((c + 1) * CELL) / PF | 0) - 1;
      const r0 = (r * CELL / PF) | 0, r1 = (((r + 1) * CELL) / PF | 0) - 1;
      for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) this.baseBlocked[rr * PC + cc] = 1;
    }

    this.spawnQueue = [];
    this.roundTimer = 0;
    this.nextRoundT = 0;
    this.spawnedAll = false;
    this.kills = 0; this.leaks = 0;
    this.roundBannerT = 0;
    this.hoverCell = null;
    this.selected = null;          // 选中的炮塔
    this.pendingKey = null;        // 待建造的炮塔类型

    this.events = { onRound: null, onGameOver: null, onVictory: null, onLeak: null, onBuild: null, onDeny: null, onKill: null };

    // 地形缓存：先铺地面，再压地形，最后撒装饰物（顺序反了会把植被盖掉）
    this.ground = Art.buildGround(this.map);
    const deco = Art.cv(FIELD_W, CANVAS_H);
    deco.x.drawImage(this.ground, 0, 0);
    Art.drawTerrain(deco.x, this.map);
    Art.drawDecor(deco.x, this.map);
    this.groundWithDecor = deco.c;

    this.rebuildBlocked();
    this.rebuildFields();
  }

  /* 世界坐标 -> 地形定义 */
  tileAt(x, y) {
    if (x < 0 || y < 0 || x >= FIELD_W || y >= FIELD_H) return TILE_LIST[0];
    return TILE_LIST[this.tileGrid[((y / CELL) | 0) * COLS + ((x / CELL) | 0)]];
  }
  cellTile(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return TILE_LIST[0];
    return TILE_LIST[this.tileGrid[r * COLS + c]];
  }
  /* 敌人走过某点时的速度倍率（浅滩涉水会明显变慢；空军不受地形影响） */
  terrainSpeed(x, y) { return this.tileAt(x, y).speed || 1; }

  /* ============================================================
     网格 / 流场
     ============================================================ */
  cellOf(x, y) {
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return -1;
    return r * COLS + c;
  }
  isBlockedWorld(x, y) {
    if (x < 0 || y < 0 || x >= FIELD_W || y >= FIELD_H) return false;
    const c = (x / PF) | 0, r = (y / PF) | 0;
    return this.blocked[r * PC + c] === 1;
  }

  rebuildBlocked() {
    // 先铺地形阻挡（河 / 高地 / 房屋 / 基地），再叠加炮塔
    this.blocked.set(this.baseBlocked);
    for (const tw of this.towers) {
      const c0 = clamp(((tw.x - INFLATE) / PF) | 0, 0, PC - 1);
      const c1 = clamp(((tw.x + INFLATE) / PF) | 0, 0, PC - 1);
      const r0 = clamp(((tw.y - INFLATE) / PF) | 0, 0, PR - 1);
      const r1 = clamp(((tw.y + INFLATE) / PF) | 0, 0, PR - 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.blocked[r * PC + c] = 1;
    }
  }

  // 以各出口为源做 8 向 BFS（切比雪夫距离），得到流场
  bfsField(exit) {
    const d = new Float32Array(PC * PR).fill(Infinity);
    const q = [];
    const ex = cellCX(exit.c), ey = cellCY(exit.r);

    // 目标区 = 距离出口最近的 24 个可通行细格
    // （出口常在场地之外，用固定半径会取不到任何格子）
    const cand = [];
    for (let r = 0; r < PR; r++) for (let c = 0; c < PC; c++) {
      if (this.blocked[r * PC + c]) continue;
      const x = c * PF + PF / 2, y = r * PF + PF / 2;
      cand.push({ i: r * PC + c, d: dist2(x, y, ex, ey) });
    }
    if (!cand.length) return d;
    cand.sort((a, b) => a.d - b.d);
    const goals = cand.slice(0, 24);
    for (const g of goals) { d[g.i] = 0; q.push(g.i); }

    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const cc = cur % PC, cr = (cur / PC) | 0, base = d[cur];
      for (let k = 0; k < 8; k++) {
        const nc = cc + DX8[k], nr = cr + DY8[k];
        if (nc < 0 || nr < 0 || nc >= PC || nr >= PR) continue;
        const ni = nr * PC + nc;
        if (this.blocked[ni]) continue;
        if (k >= 4 && (this.blocked[cr * PC + nc] || this.blocked[nr * PC + cc])) continue; // 防切角
        if (base + 1 < d[ni] - 1e-6) { d[ni] = base + 1; q.push(ni); }
      }
    }
    return d;
  }

  rebuildFields() { this.fields = this.map.exits.map(ex => this.bfsField(ex)); }

  // 出生点在场外，需要在场地边缘找一格可通行的入口。
  // 校验与实际寻路必须用同一套规则，否则会出现「校验通过但敌人卡死」。
  spawnEntry(spawn) {
    const c0 = clamp(Math.round(spawn.c), 0, COLS - 1);
    const r0 = clamp(Math.round(spawn.r), 0, ROWS - 1);
    const d = this.fields[spawn.exit];
    let best = null, bestD = Infinity;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const c = c0 + dc, r = r0 + dr;
      if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
      const x = cellCX(c), y = cellCY(r);
      if (this.isBlockedWorld(x, y)) continue;
      const fi = ((y / PF) | 0) * PC + ((x / PF) | 0);
      if (!isFinite(d[fi])) continue;
      const dd = dc * dc + dr * dr;
      if (dd < bestD) { bestD = dd; best = { x, y, c, r }; }
    }
    return best;
  }

  // 每个出生点都能进场，且场上每个活着的敌人都还能走到基地
  pathsValid() {
    for (const s of this.map.spawns) if (!this.spawnEntry(s)) return false;
    for (const e of this.enemies) {
      if (e.dead || e.air) continue;
      const c = clamp((e.x / PF) | 0, 0, PC - 1), r = clamp((e.y / PF) | 0, 0, PR - 1);
      const d = this.fields[e.exit];
      let ok = false;
      for (let dr = -1; dr <= 1 && !ok; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= PC || rr >= PR) continue;
        if (isFinite(d[rr * PC + cc])) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }

  losClear(x0, y0, x1, y1) {
    const d = dist(x0, y0, x1, y1);
    const n = Math.max(2, Math.ceil(d / 7));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.isBlockedWorld(lerp(x0, x1, t), lerp(y0, y1, t))) return false;
    }
    return true;
  }

  // 由流场回溯出一条路径，再做拉绳平滑
  flowPath(x, y, exitIdx) {
    const d = this.fields[exitIdx];
    if (!d) return [{ x, y }];
    let c = clamp((x / PF) | 0, 0, PC - 1), r = clamp((y / PF) | 0, 0, PR - 1);
    if (this.blocked[r * PC + c] || !isFinite(d[r * PC + c])) {
      // 出生点在场外、或身边被新建炮塔挡住时，就近找一格可达格作为起点
      let found = false, bestD = Infinity, bc = c, br = r;
      let losD = Infinity, lc = -1, lr = -1;
      for (let dr = -16; dr <= 16; dr++) for (let dc = -16; dc <= 16; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= PC || rr >= PR) continue;
        if (this.blocked[rr * PC + cc] || !isFinite(d[rr * PC + cc])) continue;
        const dd = dc * dc + dr * dr;
        if (dd < bestD) { bestD = dd; bc = cc; br = rr; found = true; }
        if (dd < losD && this.losClear(x, y, cc * PF + PF / 2, rr * PF + PF / 2)) {
          losD = dd; lc = cc; lr = rr;
        }
      }
      if (lc >= 0) { bc = lc; br = lr; found = true; }   // 优先选视线通畅的
      if (!found) {
        // 理论上不会发生（建造时已校验）；兜底直线走向出口，避免敌人永久卡死
        const ex = this.map.exits[exitIdx];
        return [{ x, y }, { x: cellCX(ex.c), y: cellCY(ex.r) }];
      }
      c = bc; r = br;
    }
    const raw = [{ x, y }];
    let guard = 0;
    while (d[r * PC + c] > 0 && guard++ < 4000) {
      raw.push({ x: c * PF + PF / 2, y: r * PF + PF / 2 });
      let best = d[r * PC + c], bc = -1, br = -1;
      for (let k = 0; k < 8; k++) {
        const nc = c + DX8[k], nr = r + DY8[k];
        if (nc < 0 || nr < 0 || nc >= PC || nr >= PR) continue;
        if (this.blocked[nr * PC + nc]) continue;
        if (k >= 4 && (this.blocked[r * PC + nc] || this.blocked[nr * PC + c])) continue;
        const v = d[nr * PC + nc];
        if (v < best - 1e-6) { best = v; bc = nc; br = nr; }
      }
      if (bc < 0) break;
      c = bc; r = br;
    }
    const ex = this.map.exits[exitIdx];
    raw.push({ x: cellCX(ex.c), y: cellCY(ex.r) });

    // 拉绳平滑
    const out = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !this.losClear(raw[i].x, raw[i].y, raw[j].x, raw[j].y)) j--;
      out.push(raw[j]); i = j;
    }
    return out;
  }

  /* ============================================================
     建造
     ============================================================ */
  canPlace(c, r, key) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return '超出范围';
    if (this.grid[r * COLS + c]) return '此处已有炮塔';
    const tile = this.cellTile(c, r);
    if (!tile.build) return tile.deny || '这里不能建造';
    const cost = TOWERS[key].cost;
    if (this.money < cost) return '金钱不足';
    const x = cellCX(c), y = cellCY(r);
    /* 敌人占位判定 —— 必须是「敌人身体真的压到了这一格」。
       旧写法用 dist(格子中心, 敌人) < 50 的圆形判定，敌人站在隔壁格、
       身体根本没碰到本格时也会把本格判死，玩家看到的就是
       「这条路上明明没敌人，却建不了塔」。实测这类假拒绝占全部占位拒绝的 10~19%。
       现在改成 64x64 方格与敌人圆形身体做真实相交，并且跳过：
         · 空中单位（直升机 / 轰炸机从头顶飞过不该挡住地面施工）
         · 已阵亡但还没被移出数组的单位 */
    for (const e of this.enemies) {
      if (e.dead || e.air) continue;
      const reach = CELL / 2 + e.radius;
      if (Math.abs(e.x - x) < reach && Math.abs(e.y - y) < reach) return '敌人占据了位置';
    }
    return null;
  }

  placeTower(c, r, key) {
    const reason = this.canPlace(c, r, key);
    if (reason) { this.events.onDeny && this.events.onDeny(reason); return false; }
    const tile = this.cellTile(c, r);
    const tw = {
      key, level: 0, c, r, x: cellCX(c), y: cellCY(r),
      aim: -Math.PI / 2, cd: 0, recoil: 0, spawnT: 0,
      target: null, spin: 0, mode: 'first', firing: false, flash: 0, invested: TOWERS[key].cost,
      /* 高地加成：站在高地上的炮塔伤害更高（见 refreshStats） */
      dmgMul: tile.dmgMul || 1, onHill: tile.key === 'hill', tile: tile.key
    };
    this.refreshStats(tw);
    const prev = this.towers.length;
    this.towers.push(tw);
    this.grid[r * COLS + c] = tw;
    this.rebuildBlocked();
    const old = this.fields;
    this.rebuildFields();
    if (!this.pathsValid()) {           // 不能把路彻底堵死
      this.towers.pop();
      this.grid[r * COLS + c] = null;
      this.rebuildBlocked(); this.fields = old;
      this.events.onDeny && this.events.onDeny('不能封死敌人的路线');
      return false;
    }
    this.money -= TOWERS[key].cost;
    this.refreshPaths();
    this.burst(tw.x, tw.y, 14, '#ffe9a8', 90, 0.45, 2.4);
    Sfx.build(panOf(tw.x));
    this.events.onBuild && this.events.onBuild(tw);
    return true;
  }

  /* 炮塔当前等级的实际数值。站在高地上时 dmg / dps / burn 按 dmgMul 放大；
     平地直接复用原始表（不额外分配对象），只有高地塔才生成一份副本。 */
  refreshStats(tw) {
    const base = TOWERS[tw.key].levels[tw.level];
    const mul = tw.dmgMul || 1;
    if (mul === 1) { tw.L = base; return; }
    const r1 = v => Math.round(v * mul * 10) / 10;
    const o = Object.assign({}, base);
    if (o.dmg != null) o.dmg = r1(o.dmg);
    if (o.dps != null) o.dps = r1(o.dps);
    if (o.burn != null) o.burn = r1(o.burn);
    tw.L = o;
  }

  upgradeTower(tw) {
    if (tw.level >= 2) return false;
    const cost = upgradeCost(tw.key, tw.level);
    if (this.money < cost) { this.events.onDeny && this.events.onDeny('金钱不足'); return false; }
    this.money -= cost;
    tw.invested += cost;
    tw.level++;
    this.refreshStats(tw);
    tw.spawnT = 0;
    this.burst(tw.x, tw.y, 22, '#b6ff6a', 130, 0.6, 3);
    Sfx.upgrade(panOf(tw.x));
    return true;
  }

  sellTower(tw) {
    const v = sellValue(tw);
    this.money += v;
    this.towers.splice(this.towers.indexOf(tw), 1);
    this.grid[tw.r * COLS + tw.c] = null;
    if (this.selected === tw) this.selected = null;
    this.rebuildBlocked(); this.rebuildFields(); this.refreshPaths();
    this.floaters.push({ x: tw.x, y: tw.y - 14, text: '+$' + v, life: 1.1, max: 1.1, col: '#ffd24a', vy: -34 });
    Sfx.sell(panOf(tw.x));
    return true;
  }

  refreshPaths() {
    for (const e of this.enemies) if (!e.air) this.assignPath(e);
  }

  /* ============================================================
     敌人生成
     ============================================================ */
  startRound() {
    if (this.state === 'gameover' || this.state === 'victory') return;
    this.round++;
    this.roundTimer = 0;
    this.spawnedAll = false;
    this.spawnQueue = [];
    const comp = waveComp(this.round);
    comp.forEach(g => {
      for (let i = 0; i < g.count; i++) {
        this.spawnQueue.push({
          t: (g.delay || 0) + i * g.gap + rand(0, 0.14),
          type: g.type,
          spawn: randInt(0, this.map.spawns.length - 1)
        });
      }
    });
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this.state = 'round';
    this.roundBannerT = 2.6;
    Sfx.roundStart();
    this.events.onRound && this.events.onRound(this.round);
  }

  spawnEnemy(typeKey, spawnIdx) {
    const def = ENEMIES[typeKey];
    const sp = this.map.spawns[spawnIdx % this.map.spawns.length];
    const hpMul = waveHpMul(this.round) * this.diff.hpMul;
    const e = {
      key: typeKey, art: def.art, air: def.air,
      maxHp: Math.round(def.hp * hpMul), hp: 0,
      speed: def.speed * (0.94 + Math.random() * 0.12),
      armor: def.armor, radius: def.radius,
      reward: Math.round(def.reward * waveRewardMul(this.round) * this.diff.rewardMul),
      score: def.score,
      x: cellCX(sp.c), y: cellCY(sp.r), angle: 0,
      anim: Math.random() * 4, hitFlash: 0, seed: Math.random() * 10,
      slowT: 0, slowF: 0, burnT: 0, burnDps: 0,
      path: [], pi: 0, prog: 0, lat: rand(-9, 9), exit: sp.exit, dead: false
    };
    e.hp = e.maxHp;
    if (def.air) {
      const ex = this.map.exits[sp.exit];
      e.path = [{ x: cellCX(sp.c), y: cellCY(sp.r) }, { x: cellCX(ex.c), y: cellCY(ex.r) }];
      e.angle = Math.atan2(e.path[1].y - e.path[0].y, e.path[1].x - e.path[0].x);
    } else {
      this.assignPath(e);
    }
    this.enemies.push(e);
    return e;
  }

  assignPath(e) {
    const p = this.flowPath(e.x, e.y, e.exit);
    // 施加横向偏移，避免完全重叠
    if (e.lat && p.length > 1) {
      const q = p.map((pt, i) => {
        if (i === 0 || i === p.length - 1) return pt;
        const a = p[i - 1], b = p[i + 1] || p[i];
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
        const ox = pt.x - dy / L * e.lat, oy = pt.y + dx / L * e.lat;
        return this.isBlockedWorld(ox, oy) ? pt : { x: ox, y: oy };
      });
      e.path = q;
    } else e.path = p;
    e.pi = 0;
  }

  /* ============================================================
     伤害
     ============================================================ */
  damage(e, raw, opts) {
    if (e.dead) return;
    opts = opts || {};
    let dmg = opts.dot
      ? raw * (14 / (14 + e.armor))
      : Math.max(raw * 0.08, raw - e.armor);
    e.hp -= dmg;
    // 只有较重的打击才明显闪白，否则机枪连射会把敌人糊成白块
    if (!opts.silent) e.hitFlash = Math.min(1, e.hitFlash + (raw >= 18 ? 0.85 : 0.2));
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    this.money += e.reward;
    this.score += e.score;
    this.kills++;
    this.floaters.push({ x: e.x, y: e.y - 16, text: '+$' + e.reward, life: 0.9, max: 0.9, col: '#ffd24a', vy: -40 });
    const n = e.radius > 14 ? 26 : 14;
    this.burst(e.x, e.y, n, '#ffb020', 150, 0.55, e.radius * 0.32);
    this.burst(e.x, e.y, Math.round(n * 0.6), '#fff0a0', 210, 0.3, e.radius * 0.2);
    this.smoke(e.x, e.y, 4);
    Sfx.boom(e.radius / 11, panOf(e.x));
    this.shake = Math.min(this.shake + e.radius * 0.09, 9);
    if (this.selected === e) this.selected = null;
    this.events.onKill && this.events.onKill(e);
  }

  leakEnemy(e) {
    e.dead = true;
    this.lives--;
    this.leaks++;
    this.score = Math.max(0, this.score - 25);
    Sfx.leak(panOf(e.x));
    this.shake = 14;
    this.events.onLeak && this.events.onLeak(e);
    if (this.lives <= 0) {
      this.lives = 0;
      this.state = 'gameover';
      Sfx.gameOver();
      this.events.onGameOver && this.events.onGameOver();
    }
  }

  /* ============================================================
     粒子
     ============================================================ */
  burst(x, y, n, col, spd, life, size, blend) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = spd * (0.35 + Math.random() * 0.75);
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life, max: life, size: size * (0.6 + Math.random() * 0.8),
        col, drag: 0.9, grav: 40, type: 'spark', blend
      });
    }
  }

  smoke(x, y, n, col, scale) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x, y, vx: Math.cos(a) * 26, vy: Math.sin(a) * 26 - 22,
        life: 0.9 + Math.random() * 0.6, max: 1.5, size: (7 + Math.random() * 9) * (scale || 1),
        col: col || 'rgba(70,64,58,', drag: 0.92, grav: -14, type: 'smoke'
      });
    }
  }

  ring(x, y, r, col, life) {
    this.particles.push({ x, y, vx: 0, vy: 0, life, max: life, size: r, col, type: 'ring', drag: 1, grav: 0 });
  }

  /* 叠加混合的短命亮斑：枪口焰、爆炸核心、命中闪光都用它 */
  flash(x, y, r, life, col) {
    this.particles.push({
      x, y, vx: 0, vy: 0, life, max: life, size: r,
      col: col || 'rgba(255,232,160,', drag: 1, grav: 0, type: 'flash', blend: 'lighter'
    });
  }

  /* 炮口冲击：星形亮斑 + 火星 + 一缕硝烟（一次开火打一发） */
  muzzle(x, y, ang, s) {
    s = s || 1;
    const mx = x + gxOff(ang, 7 * s), my = y + gyOff(ang, 7 * s);
    this.particles.push({
      x: mx, y: my, vx: 0, vy: 0, life: 0.12, max: 0.12,
      size: 8 * s, ang, col: 'rgba(255,226,140,', drag: 1, grav: 0, type: 'muzzle', blend: 'lighter'
    });
    for (let i = 0; i < 3; i++) {
      const a = ang + rand(-0.55, 0.55), v = rand(130, 280) * s;
      this.particles.push({
        x: mx, y: my, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: rand(0.10, 0.20), max: 0.2, size: rand(1.6, 3.0) * s,
        col: '#ffe9a0', drag: 0.86, grav: 20, type: 'spark', blend: 'lighter'
      });
    }
    this.particles.push({
      x: mx, y: my, vx: Math.cos(ang) * 34, vy: Math.sin(ang) * 34 - 8,
      life: 0.34, max: 0.34, size: 4.5 * s, col: 'rgba(176,166,154,',
      drag: 0.9, grav: -10, type: 'smoke'
    });
  }

  /* 地面焦痕（爆炸后短暂残留） */
  scorch(x, y, r, life) {
    this.particles.push({
      x, y, vx: 0, vy: 0, life: life || 0.8, max: life || 0.8,
      size: r, col: 'rgba(38,26,14,', drag: 1, grav: 0, type: 'scorch'
    });
  }

  /* ============================================================
     更新
     ============================================================ */
  update(dtRaw) {
    if (this.paused || this.state === 'gameover' || this.state === 'victory') { this.updateFx(dtRaw); return; }
    const dt = dtRaw * this.speed;
    this.time += dt;
    if (this.roundBannerT > 0) this.roundBannerT -= dt;

    // 生成
    if (this.state === 'round') {
      this.roundTimer += dt;
      while (this.spawnQueue.length && this.spawnQueue[0].t <= this.roundTimer) {
        const s = this.spawnQueue.shift();
        this.spawnEnemy(s.type, s.spawn);
      }
      if (!this.spawnQueue.length) this.spawnedAll = true;
      if (this.spawnedAll && this.enemies.length === 0) this.endRound();
    } else if (this.state === 'ready' || this.state === 'intermission') {
      // 波次间隙倒计时（受暂停与加速影响，不依赖 setTimeout）
      this.nextRoundT -= dt;
      if (this.nextRoundT <= 0) this.startRound();
    }

    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.updateEnemies(dt);
    this.updateFx(dt);
  }

  updateFx(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      if (p.type !== 'ring') {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += p.grav * dt;
        p.vx *= Math.pow(p.drag, dt * 60); p.vy *= Math.pow(p.drag, dt * 60);
      }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt; f.y += f.vy * dt; f.vy *= Math.pow(0.93, dt * 60);
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].life -= dt;
      if (this.beams[i].life <= 0) this.beams.splice(i, 1);
    }
    for (const tw of this.towers) {
      if (tw.spawnT < 1) tw.spawnT = Math.min(1, tw.spawnT + dt * 3.2);
      if (tw.recoil > 0) tw.recoil = Math.max(0, tw.recoil - dt * 6);
      if (tw.flash > 0) tw.flash = Math.max(0, tw.flash - dt * 8);
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 26);
      const a = Math.random() * Math.PI * 2;
      this.shakeX = Math.cos(a) * this.shake; this.shakeY = Math.sin(a) * this.shake;
    } else { this.shakeX = this.shakeY = 0; }
  }

  endRound() {
    const bonus = roundBonus(this.round) + Math.round(this.diff.rewardMul * 10);
    this.money += bonus;
    this.score += this.round * 100;
    if (this.round >= this.maxRounds) {
      this.state = 'victory';
      Sfx.victory();
      this.events.onVictory && this.events.onVictory();
      return;
    }
    this.state = 'intermission';
    this.nextRoundT = 1.5;
    this.floaters.push({ x: FIELD_W / 2, y: FIELD_H / 2 + 40, text: 'ROUND CLEAR  +$' + bonus, life: 1.8, max: 1.8, col: '#b6ff6a', vy: -22, big: true });
    Sfx.coin();
  }

  /* ---------- 目标选择 ---------- */
  pickTarget(tw, range, needAirOk, arc) {
    let best = null, bestScore = -Infinity;
    const r2 = range * range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.air && !TOWERS[tw.key].hitsAir) continue;
      const d2 = dist2(e.x, e.y, tw.x, tw.y);
      if (d2 > r2) continue;
      if (arc != null) {
        let da = Math.abs(((Math.atan2(e.y - tw.y, e.x - tw.x) - tw.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (da > arc) continue;
      }
      let s;
      if (tw.mode === 'first') s = e.prog;
      else if (tw.mode === 'last') s = -e.prog;
      else if (tw.mode === 'strong') s = e.hp;
      else s = -d2;
      if (s > bestScore) { bestScore = s; best = e; }
    }
    return best;
  }

  updateTowers(dt) {
    for (const tw of this.towers) {
      const L = tw.L || TOWERS[tw.key].levels[tw.level];
      const range = L.range;

      if (tw.key === 'flame') {
        const tgt = this.pickTarget(tw, range, false, null);
        tw.firing = false;
        if (tgt) {
          const want = Math.atan2(tgt.y - tw.y, tgt.x - tw.x);
          tw.aim = angLerp(tw.aim, want, 1 - Math.exp(-16 * dt));
          tw.firing = true;
          let hitAny = false;
          for (const e of this.enemies) {
            if (e.dead || e.air) continue;
            const d = dist(e.x, e.y, tw.x, tw.y);
            if (d > range + e.radius) continue;
            let da = Math.abs(((Math.atan2(e.y - tw.y, e.x - tw.x) - tw.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (da > L.arc + 0.16) continue;
            this.damage(e, L.dps * dt, { dot: true, silent: true });
            e.burnT = 1.6; e.burnDps = Math.max(e.burnDps, L.burn);
            hitAny = true;
          }
          if (hitAny) {
            if (Math.random() < dt * 22) this.flameParticles(tw, L, dt);
            if (Math.random() < dt * 7) Sfx.flame(panOf(tw.x));
          }
        }
        continue;
      }

      tw.cd -= dt;
      if (tw.cd > 0) continue;
      const tgt = this.pickTarget(tw, range, true, null);
      if (!tgt) continue;
      const want = Math.atan2(tgt.y - tw.y, tgt.x - tw.x);
      tw.aim = angLerp(tw.aim, want, 1 - Math.exp(-13 * dt));
      let da = Math.abs(((want - tw.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da > 0.24) { tw.cd = 0.02; continue; }   // 等转到位
      this.fire(tw, L, tgt);
      tw.cd = 1 / L.rate;
      tw.recoil = 1;
      tw.flash = 1;
    }

    // 灼烧
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.burnT > 0) {
        e.burnT -= dt;
        this.damage(e, e.burnDps * dt, { dot: true, silent: true });
        if (Math.random() < dt * 14) this.particles.push({
          x: e.x + rand(-6, 6), y: e.y + rand(-6, 6), vx: rand(-12, 12), vy: -34,
          life: 0.34, max: 0.34, size: 3.4, col: '#ff9a2e', drag: 0.93, grav: -30, type: 'spark'
        });
      } else e.burnDps = 0;
    }
  }

  flameParticles(tw, L, dt) {
    for (let i = 0; i < 3; i++) {
      const a = tw.aim + rand(-L.arc * 0.75, L.arc * 0.75);
      const v = rand(210, 340);
      this.particles.push({
        x: tw.x + gxOff(tw.aim, 28), y: tw.y + gyOff(tw.aim, 28) - 4,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: rand(0.16, 0.3), max: 0.3, size: rand(6, 12),
        col: Math.random() > 0.5 ? '#ffb020' : '#ff6a1a', drag: 0.86, grav: -20, type: 'fire'
      });
    }
  }

  fire(tw, L, tgt) {
    const k = tw.key;
    const ang = tw.aim;
    if (k === 'gatling') {
      const nb = L.bullets || 1, sp = L.spread || 0;
      for (let i = 0; i < nb; i++) {
        const a = ang + rand(-sp, sp);
        this.projectiles.push({
          type: 'bullet', x: tw.x + gxOff(ang, 24), y: tw.y + gyOff(ang, 24) - 5,
          vx: Math.cos(a) * 780, vy: Math.sin(a) * 780, dmg: L.dmg, life: 0.9,
          target: tgt, speed: 780, col: '#ffe066', trail: true
        });
      }
      this.muzzle(tw.x + gxOff(ang, 24), tw.y + gyOff(ang, 24) - 5, ang, 0.75);
      tw.spin = 1;
      Sfx.gatling(panOf(tw.x));
    } else if (k === 'goo') {
      const px = tw.x + gxOff(ang, 16), py = tw.y + gyOff(ang, 16) - 5;
      this.projectiles.push({
        type: 'goo', x: px, y: py,
        vx: Math.cos(ang) * 260, vy: Math.sin(ang) * 260, dmg: L.dmg, life: 1.4,
        target: tgt, speed: 260, splash: L.splash, slow: L.slow, slowDur: L.slowDur, arcH: 1, seed: Math.random() * 100
      });
      this.flash(px, py, 7, 0.12, 'rgba(180,255,110,');
      for (let i = 0; i < 3; i++) {
        this.particles.push({
          x: px, y: py, vx: Math.cos(ang) * rand(40, 90), vy: Math.sin(ang) * rand(40, 90) - 20,
          life: rand(0.2, 0.4), max: 0.4, size: rand(2.6, 4.6), col: '#8ce04a', drag: 0.88, grav: 90, type: 'goo'
        });
      }
      Sfx.gooShot(panOf(tw.x));
    } else if (k === 'missile') {
      const n = L.missiles;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 14;
        this.projectiles.push({
          type: 'missile', x: tw.x + gxOff(ang + Math.PI / 2, off), y: tw.y + gyOff(ang + Math.PI / 2, off) - 6,
          vx: Math.cos(ang) * 150, vy: Math.sin(ang) * 150, dmg: L.dmg, life: 3.2,
          target: tgt, speed: 320, splash: L.splash, ang: ang, turn: 6.2, seed: Math.random() * 100
        });
      }
      // 发射箱尾焰 + 后喷烟
      this.muzzle(tw.x + gxOff(ang, 22), tw.y + gyOff(ang, 22) - 6, ang, 1.15);
      this.flash(tw.x - gxOff(ang, 10), tw.y - gyOff(ang, 10) - 6, 11, 0.16, 'rgba(255,200,120,');
      this.smoke(tw.x + gxOff(ang, 10), tw.y + gyOff(ang, 10) - 6, 3, 'rgba(190,182,172,', 0.9);
      Sfx.missile(panOf(tw.x));
    } else if (k === 'tesla') {
      let cur = tgt, dmg = L.dmg, src = { x: tw.x, y: tw.y - 6 };
      const hit = new Set();
      for (let c = 0; c <= L.chain; c++) {
        if (!cur) break;
        this.beams.push({ x0: src.x, y0: src.y, x1: cur.x, y1: cur.y, life: 0.14, max: 0.14, seed: Math.random() * 100 });
        this.damage(cur, dmg);
        hit.add(cur);
        this.burst(cur.x, cur.y, 4, '#bfeaff', 110, 0.24, 2);
        this.flash(cur.x, cur.y, 9, 0.12, 'rgba(180,225,255,');
        src = { x: cur.x, y: cur.y };
        dmg *= L.falloff;
        let nb = null, bd = 110 * 110;
        for (const e of this.enemies) {
          if (e.dead || hit.has(e)) continue;
          if (e.air && !TOWERS[k].hitsAir) continue;
          const d2 = dist2(e.x, e.y, cur.x, cur.y);
          if (d2 < bd) { bd = d2; nb = e; }
        }
        cur = nb;
      }
      // 球体放电的起手光
      this.flash(tw.x, tw.y - 6, 13, 0.14, 'rgba(170,220,255,');
      Sfx.tesla(panOf(tw.x));
    } else if (k === 'mortar') {
      // 预判落点
      const d = dist(tgt.x, tgt.y, tw.x, tw.y);
      const tof = clamp(d / 420, 0.35, 0.95);
      const px = tgt.x + Math.cos(tgt.angle) * tgt.speed * tof * 0.55;
      const py = tgt.y + Math.sin(tgt.angle) * tgt.speed * tof * 0.55;
      this.projectiles.push({
        type: 'shell', x: tw.x, y: tw.y - 8, tx: px, ty: py, sx: tw.x, sy: tw.y - 8,
        t: 0, tof, dmg: L.dmg, life: 2.2, splash: L.splash, maxH: 96, seed: Math.random() * 100,
        pang: Math.atan2(py - (tw.y - 8), px - tw.x)
      });
      // 开炮：炮口焰 + 扬尘 + 落点预警圈
      this.muzzle(tw.x + gxOff(ang, 34), tw.y + gyOff(ang, 34) - 10, ang, 1.4);
      this.smoke(tw.x + gxOff(ang, 20), tw.y + gyOff(ang, 20) - 8, 5, 'rgba(180,170,158,', 1.1);
      this.ring(px, py, L.splash * 0.9, 'rgba(255,140,60,0.55)', Math.max(0.25, tof));
      Sfx.mortarFire(panOf(tw.x));
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      let done = false;

      if (p.type === 'shell') {
        p.t += dt;
        const k = p.t / p.tof;
        const nx = lerp(p.sx, p.tx, k), ny = lerp(p.sy, p.ty, k);
        // 记录朝向，渲染时让弹体沿弹道倾斜
        const dx = nx - p.x, dy = ny - p.y;
        if (dx * dx + dy * dy > 0.01) p.pang = Math.atan2(dy, dx);
        p.x = nx; p.y = ny;
        p.h = Math.sin(clamp(k, 0, 1) * Math.PI) * p.maxH;
        // 弹道拖烟
        if (Math.random() < dt * 26) {
          this.particles.push({
            x: p.x, y: p.y - p.h, vx: rand(-9, 9), vy: rand(-16, -2),
            life: 0.55, max: 0.55, size: rand(2.6, 5.2), col: 'rgba(156,148,138,',
            drag: 0.9, grav: -18, type: 'smoke'
          });
        }
        if (k >= 1) { this.explode(p.tx, p.ty, p.splash, p.dmg, 1.0); done = true; }
      } else {
        if (p.target && !p.target.dead) {
          if (p.type === 'missile') {
            const want = Math.atan2(p.target.y - p.y, p.target.x - p.x);
            p.ang = angLerp(p.ang, want, 1 - Math.exp(-p.turn * dt));
            p.vx = Math.cos(p.ang) * p.speed; p.vy = Math.sin(p.ang) * p.speed;
          } else {
            const want = Math.atan2(p.target.y - p.y, p.target.x - p.x);
            const cur = Math.atan2(p.vy, p.vx);
            const na = angLerp(cur, want, 1 - Math.exp(-9 * dt));
            p.vx = Math.cos(na) * p.speed; p.vy = Math.sin(na) * p.speed;
          }
        }
        p.x += p.vx * dt; p.y += p.vy * dt;

        if (p.type === 'missile') {
          // 尾喷口位置（沿飞行反方向回退一点）
          const ex = p.x - Math.cos(p.ang) * 10, ey = p.y - Math.sin(p.ang) * 10;
          if (Math.random() < dt * 72) {
            this.particles.push({
              x: ex, y: ey,
              vx: rand(-12, 12) - Math.cos(p.ang) * 22, vy: rand(-12, 12) - Math.sin(p.ang) * 22,
              life: 0.5, max: 0.5, size: rand(2.6, 5.0), col: 'rgba(158,148,138,',
              drag: 0.9, grav: -20, type: 'smoke'
            });
          }
          if (Math.random() < dt * 46) {
            this.particles.push({
              x: ex, y: ey, vx: rand(-32, 32), vy: rand(-32, 32),
              life: rand(0.12, 0.24), max: 0.24, size: rand(1.4, 2.7),
              col: '#ffcf6a', drag: 0.85, grav: 30, type: 'spark', blend: 'lighter'
            });
          }
        }
        if (p.type === 'goo' && Math.random() < dt * 30) {
          this.particles.push({
            x: p.x, y: p.y, vx: rand(-10, 10), vy: rand(-6, 14),
            life: 0.36, max: 0.36, size: rand(2.4, 4.6), col: '#8ce04a',
            drag: 0.9, grav: 40, type: 'goo'
          });
        }

        // 命中
        const hitR = p.type === 'bullet' ? 13 : 15;
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (e.air && !TOWERS.gatling.hitsAir && p.type === 'bullet') { /* bullet 来自机枪塔，可打空 */ }
          if (dist2(e.x, e.y, p.x, p.y) < (hitR + e.radius) * (hitR + e.radius)) {
            if (p.splash) this.explode(p.x, p.y, p.splash, p.dmg, p.type === 'goo' ? 0.3 : 1);
            else this.damage(e, p.dmg);
            if (p.type === 'missile') { this.burst(p.x, p.y, 8, '#ffcf5a', 130, 0.3, 2.4); Sfx.boom(0.55, panOf(p.x)); }
            if (p.type === 'goo') this.gooSplat(p.x, p.y, p.splash);
            if (p.type === 'bullet') this.burst(p.x, p.y, 2, '#ffe066', 90, 0.16, 1.6);
            done = true; break;
          }
        }
        if (p.type === 'bullet' && (p.x < -20 || p.x > FIELD_W + 20 || p.y < -20 || p.y > FIELD_H + 20)) done = true;
      }
      if (done || p.life <= 0) {
        if (p.life <= 0 && p.type === 'shell') this.explode(p.x, p.y, p.splash, p.dmg, 1);
        this.projectiles.splice(i, 1);
      }
    }
  }

  gooSplat(x, y, r) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r;
      this.particles.push({
        x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
        vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: rand(0.5, 0.9), max: 0.9,
        size: rand(4, 9), col: '#7ed321', drag: 0.86, grav: 40, type: 'goo'
      });
    }
    this.ring(x, y, r, 'rgba(126,211,33,0.75)', 0.4);
    this.ring(x, y, r * 1.45, 'rgba(200,255,140,0.42)', 0.5);
    this.flash(x, y, r * 0.7, 0.12, 'rgba(180,255,110,');
    // 地面上的黏胶痕迹
    this.scorch(x, y, r * 0.8, 0.9);
  }

  explode(x, y, radius, dmg, sfxScale) {
    const R = Math.max(9, radius);
    // 冲击环（两圈）+ 核心闪光
    this.ring(x, y, R, 'rgba(255,180,60,0.85)', 0.34);
    this.ring(x, y, R * 1.55, 'rgba(255,244,208,0.42)', 0.48);
    this.flash(x, y, R * 1.2, 0.15, 'rgba(255,238,182,');
    // 火球 / 亮芯 / 火星
    this.burst(x, y, Math.round(R * 0.34), '#ffb020', 220, 0.42, 3.4);
    this.burst(x, y, Math.round(R * 0.2), '#fff3a8', 280, 0.24, 2.4, 'lighter');
    this.burst(x, y, Math.round(R * 0.24), '#ffd24a', 360, 0.58, 1.9, 'lighter');
    // 烟尘 + 地面焦痕
    this.smoke(x, y, Math.round(R * 0.12));
    this.scorch(x, y, R * 0.8, 0.7);
    Sfx.boom(sfxScale, panOf(x));
    this.shake = Math.min(this.shake + radius * 0.06, 7);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, x, y);
      if (d < radius + e.radius) {
        const f = clamp(1 - (d - e.radius) / radius, 0.35, 1);
        this.damage(e, dmg * f);
      }
    }
  }

  updateEnemies(dt) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) { this.enemies.splice(i, 1); continue; }

      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowF = 0; }
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 6.5);

      /* 地形影响行军速度：浅滩涉水明显变慢（空军不受地形影响）。
         变慢的地方正是敌人扎堆的地方 —— 也就是最该摆炮塔的位置。 */
      const terr = e.air ? 1 : this.terrainSpeed(e.x, e.y);
      const spd = e.speed * (1 - e.slowF) * terr;
      e.anim += dt * (spd / 30);

      // 沿路径推进
      let move = spd * dt;
      while (move > 0 && e.pi < e.path.length - 1) {
        const a = e.path[e.pi], b = e.path[e.pi + 1];
        const d = dist(a.x, a.y, b.x, b.y);
        if (d < 0.001) { e.pi++; continue; }
        const seg = Math.min(move, d - (e.segT || 0));
        if (seg <= 0) { e.pi++; e.segT = 0; continue; }
        const t = ((e.segT || 0) + seg) / d;
        e.x = lerp(a.x, b.x, t); e.y = lerp(a.y, b.y, t);
        e.prog += seg;
        e.segT = (e.segT || 0) + seg;
        move -= seg;
        const want = Math.atan2(b.y - a.y, b.x - a.x);
        e.angle = angLerp(e.angle, want, 1 - Math.exp(-14 * dt));
        if (e.segT >= d - 0.01) { e.pi++; e.segT = 0; }
      }

      // 抵达基地
      if (e.pi >= e.path.length - 1) {
        const last = e.path[e.path.length - 1];
        if (dist(e.x, e.y, last.x, last.y) < 12) {
          this.leakEnemy(e);
          this.enemies.splice(i, 1);
          continue;
        }
      }
      if (e.x < -260 || e.x > FIELD_W + 260 || e.y < -260 || e.y > FIELD_H + 260) {
        e.dead = true; this.enemies.splice(i, 1); continue;
      }
    }
  }

  /* ============================================================
     渲染
     ============================================================ */
  render(x, t) {
    x.save();
    x.translate(this.shakeX, this.shakeY);

    x.drawImage(this.groundWithDecor, 0, 0);

    // 出生点标记
    for (const s of this.map.spawns) {
      const sx = cellCX(s.c), sy = cellCY(s.r);
      x.save(); x.globalAlpha = 0.5 + Math.sin(t * 3) * 0.16;
      x.fillStyle = '#c1272d';
      x.beginPath(); x.moveTo(sx, sy - 9); x.lineTo(sx + 11, sy); x.lineTo(sx, sy + 9); x.lineTo(sx - 11, sy); x.closePath(); x.fill();
      x.restore();
    }

    Art.drawBaseWall(x, this.map, t);

    // 建造预览
    if (this.hoverCell) this.drawGhost(x);

    // 选中炮塔范围
    if (this.selected) this.drawRange(x, this.selected);

    // 炮塔与敌人统一按 y 排序，保证前后遮挡关系正确
    const ents = [];
    for (const tw of this.towers) ents.push({ y: tw.y, o: tw, k: 0 });
    for (const e of this.enemies) ents.push({ y: e.y, o: e, k: 1 });
    ents.sort((a, b) => a.y - b.y);
    for (const it of ents) {
      if (it.k === 0) Art.drawTower(x, it.o, t); else Art.drawEnemy(x, it.o, t);
    }
    const es = this.enemies;

    // 血条
    for (const e of es) {
      if (e.hp >= e.maxHp - 0.5) continue;
      const w = Math.max(20, e.radius * 2.4), h = 4.6;
      const bx = e.x - w / 2, by = e.y - e.radius - (e.air ? 24 : 15);
      x.fillStyle = 'rgba(20,14,8,0.75)';
      Art.roundRect(x, bx - 1.4, by - 1.4, w + 2.8, h + 2.8, 3); x.fill();
      const f = clamp(e.hp / e.maxHp, 0, 1);
      const g = x.createLinearGradient(0, by, 0, by + h);
      if (f > 0.5) { g.addColorStop(0, '#c8ff7a'); g.addColorStop(1, '#4e9c12'); }
      else if (f > 0.25) { g.addColorStop(0, '#ffe066'); g.addColorStop(1, '#d78f0a'); }
      else { g.addColorStop(0, '#ff9d9d'); g.addColorStop(1, '#c1272d'); }
      x.fillStyle = g;
      Art.roundRect(x, bx, by, w * f, h, 2.2); x.fill();
    }

    // 光束
    for (const b of this.beams) {
      const a = b.life / b.max;
      x.save(); x.globalAlpha = a;
      // 每 1/24 秒换一次抖动种子 -> 闪电闪烁感
      const R = Art.mulberry32(b.seed + Math.floor(t * 24));
      // 预生成抖动折线，三层描边复用同一条路径（外发光 / 中间层 / 白色核心）
      const pts = [{ x: b.x0, y: b.y0 }];
      const segs = 7;
      for (let i = 1; i < segs; i++) {
        const tt = i / segs;
        pts.push({ x: lerp(b.x0, b.x1, tt) + (R() - 0.5) * 20, y: lerp(b.y0, b.y1, tt) + (R() - 0.5) * 20 });
      }
      pts.push({ x: b.x1, y: b.y1 });
      const passes = [
        ['rgba(90,170,255,0.30)', 17],
        ['rgba(120,200,255,0.60)', 8],
        ['#ffffff', 3.2]
      ];
      x.lineJoin = 'round'; x.lineCap = 'round';
      for (const [col, w] of passes) {
        x.strokeStyle = col; x.lineWidth = w;
        x.beginPath(); x.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) x.lineTo(pts[i].x, pts[i].y);
        x.stroke();
      }
      // 击中点辉光
      x.globalCompositeOperation = 'lighter';
      x.fillStyle = 'rgba(180,225,255,' + (0.5 * a).toFixed(2) + ')';
      Art.ell(x, b.x1, b.y1, 13 * a + 4, 13 * a + 4); x.fill();
      x.restore();
    }

    // 抛射物
    for (const p of this.projectiles) {
      if (p.type === 'shell') {
        const yy = p.y - p.h;
        const alt = clamp(p.h / (p.maxH || 96), 0, 1);
        x.save();
        // 落点预警环（脉动，方便判断炮弹何时砸下）
        x.globalAlpha = 0.24 + Math.sin(t * 20) * 0.10;
        x.strokeStyle = '#ff9a3c'; x.lineWidth = 1.8;
        Art.ell(x, p.tx, p.ty, 11, 7); x.stroke();
        x.globalAlpha = 1;
        // 地面投影：越高越小越淡
        x.globalAlpha = 0.34 * (1 - alt * 0.62);
        x.fillStyle = '#000';
        const shs = 1 - alt * 0.42;
        Art.ell(x, p.x, p.y, 7.4 * shs, 3.6 * shs); x.fill();
        x.globalAlpha = 1;
        // 弹体
        x.translate(p.x, yy);
        x.rotate(p.pang == null ? -Math.PI / 2 : p.pang);
        x.globalCompositeOperation = 'lighter';
        x.fillStyle = 'rgba(255,168,60,0.45)'; Art.ell(x, -11, 0, 8, 3.4); x.fill();
        x.fillStyle = 'rgba(255,236,170,0.75)'; Art.ell(x, -8.5, 0, 4.4, 2.2); x.fill();
        x.globalCompositeOperation = 'source-over';
        // 尾翼
        x.fillStyle = '#3a444e';
        x.beginPath(); x.moveTo(-8, -3.4); x.lineTo(-12.8, -7.2); x.lineTo(-8, -1.2); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(-8, 3.4); x.lineTo(-12.8, 7.2); x.lineTo(-8, 1.2); x.closePath(); x.fill();
        // 弹身
        Art.roundRect(x, -8, -3.4, 17, 6.8, 3.4);
        x.fillStyle = Art.vgrad(x, -3.4, 3.4, [[0, '#cfd8e0'], [0.4, '#5c6874'], [1, '#1d252c']]); x.fill();
        Art.ink(x, 1.8, '#141a20');
        // 高光 + 红环
        x.fillStyle = 'rgba(255,255,255,0.45)'; Art.roundRect(x, -5.5, -2.4, 12, 1.4, 0.7); x.fill();
        x.fillStyle = '#c1272d'; Art.roundRect(x, 2.6, -3.6, 2.4, 7.2, 1.0); x.fill();
        // 尖头
        x.fillStyle = '#e0392a';
        x.beginPath(); x.moveTo(9, -3.6); x.quadraticCurveTo(16.5, 0, 9, 3.6); x.closePath(); x.fill();
        Art.ink(x, 1.4, '#7a1b0e');
        x.fillStyle = 'rgba(255,255,255,0.5)';
        x.beginPath(); x.moveTo(9.4, -2.4); x.quadraticCurveTo(12.4, -1.0, 11.8, 0.4); x.lineTo(9.4, 0.4); x.closePath(); x.fill();
        x.restore();
      } else if (p.type === 'bullet') {
        const a = Math.atan2(p.vy, p.vx);
        x.save(); x.translate(p.x, p.y); x.rotate(a);
        x.globalCompositeOperation = 'lighter';
        // 渐隐拖尾
        const tg = x.createLinearGradient(-28, 0, 2, 0);
        tg.addColorStop(0, 'rgba(255,180,40,0)');
        tg.addColorStop(0.5, 'rgba(255,206,80,0.30)');
        tg.addColorStop(1, 'rgba(255,246,190,0.85)');
        x.fillStyle = tg;
        Art.roundRect(x, -28, -2.0, 30, 4.0, 2.0); x.fill();
        // 弹头
        x.fillStyle = '#fff6c8'; Art.ell(x, 0, 0, 3.6, 2.3); x.fill();
        x.fillStyle = '#ffffff'; Art.ell(x, 0.8, 0, 1.5, 1.1); x.fill();
        x.restore();
      } else if (p.type === 'missile') {
        x.save(); x.translate(p.x, p.y); x.rotate(p.ang);
        // 尾焰（多层，叠加混合）
        const fl = 0.72 + Math.random() * 0.55;
        x.globalCompositeOperation = 'lighter';
        x.fillStyle = 'rgba(255,140,40,0.45)'; Art.ell(x, -13, 0, 10 * fl, 4.6 * fl); x.fill();
        x.fillStyle = 'rgba(255,214,110,0.80)'; Art.ell(x, -10, 0, 6.0 * fl, 2.9 * fl); x.fill();
        x.fillStyle = 'rgba(255,255,225,0.95)'; Art.ell(x, -8.5, 0, 2.8 * fl, 1.9 * fl); x.fill();
        x.globalCompositeOperation = 'source-over';
        // 尾翼
        x.fillStyle = '#3a444e';
        x.beginPath(); x.moveTo(-6, -3.2); x.lineTo(-11.5, -6.6); x.lineTo(-6, -1.0); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(-6, 3.2); x.lineTo(-11.5, 6.6); x.lineTo(-6, 1.0); x.closePath(); x.fill();
        // 弹身
        Art.roundRect(x, -8, -3.2, 16, 6.4, 3.2);
        x.fillStyle = Art.vgrad(x, -3.2, 3.2, [[0, '#eef2f6'], [0.4, '#98a3ad'], [1, '#48525c']]); x.fill();
        Art.ink(x, 1.5, '#20262c');
        // 高光 / 环带
        x.fillStyle = 'rgba(255,255,255,0.6)'; Art.roundRect(x, -6, -2.5, 11, 1.4, 0.7); x.fill();
        x.fillStyle = '#c1272d'; Art.roundRect(x, 2.4, -3.4, 2.3, 6.8, 1.0); x.fill();
        // 弹头
        x.fillStyle = '#e0392a';
        x.beginPath(); x.moveTo(8, -3.4); x.quadraticCurveTo(14.8, 0, 8, 3.4); x.closePath(); x.fill();
        Art.ink(x, 1.4, '#7a1b0e');
        x.fillStyle = 'rgba(255,255,255,0.55)';
        x.beginPath(); x.moveTo(8.4, -2.2); x.quadraticCurveTo(11.2, -0.9, 10.6, 0.4); x.lineTo(8.4, 0.4); x.closePath(); x.fill();
        x.restore();
      } else if (p.type === 'goo') {
        const wob = 1 + Math.sin(t * 26 + (p.seed || 0)) * 0.10;
        x.save(); x.translate(p.x, p.y); x.rotate(Math.atan2(p.vy, p.vx));
        x.globalAlpha = 0.9;
        x.fillStyle = 'rgba(126,211,33,0.32)'; Art.ell(x, -8, 0, 7.5, 4.6); x.fill();
        x.fillStyle = '#7ed321';
        Art.ell(x, 0, 0, 6.6 * wob, 5.8 / wob); x.fill();
        Art.ink(x, 1.7, '#26530a');
        x.fillStyle = 'rgba(255,255,255,0.68)'; Art.ell(x, -1.8, -1.8, 2.3, 1.7); x.fill();
        x.restore();
      }
    }

    // 粒子
    for (const p of this.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.type === 'ring') {
        x.save(); x.globalAlpha = a * 0.9;
        x.strokeStyle = p.col; x.lineWidth = 3 + 5 * a;
        const rr = p.size * (1.35 - a * 0.55);
        Art.ell(x, p.x, p.y, rr, rr * 0.72); x.stroke();
        x.restore();
        continue;
      }
      x.save();
      if (p.blend) x.globalCompositeOperation = p.blend;
      if (p.type === 'scorch') {
        // 地面焦痕 / 黏胶残迹
        x.globalAlpha = a * 0.30;
        x.fillStyle = p.col + (a * 0.45).toFixed(2) + ')';
        Art.ell(x, p.x, p.y, p.size * (1.05 - a * 0.2), p.size * (0.70 - a * 0.14)); x.fill();
      } else if (p.type === 'flash') {
        // 叠加混合的冲击亮斑
        x.globalAlpha = a * a;
        x.fillStyle = p.col + (0.85 * a).toFixed(2) + ')';
        const fr = p.size * (0.45 + a * 0.95);
        Art.ell(x, p.x, p.y, fr, fr * 0.86); x.fill();
      } else if (p.type === 'muzzle') {
        // 星形枪口焰
        x.globalAlpha = a;
        x.translate(p.x, p.y); x.rotate(p.ang || 0);
        const ml = p.size * (0.55 + a * 0.95), mw = p.size * 0.44 * (0.35 + a * 0.65);
        x.fillStyle = p.col + (0.9 * a).toFixed(2) + ')';
        x.beginPath();
        x.moveTo(ml, 0);
        x.lineTo(mw, -mw * 1.25);
        x.lineTo(0, -mw * 0.45);
        x.lineTo(-mw * 0.85, -mw * 1.55);
        x.lineTo(-mw * 0.45, 0);
        x.lineTo(-mw * 0.85, mw * 1.55);
        x.lineTo(0, mw * 0.45);
        x.lineTo(mw, mw * 1.25);
        x.closePath(); x.fill();
      } else if (p.type === 'smoke') {
        x.globalAlpha = a * 0.34;
        x.fillStyle = p.col + (a * 0.5).toFixed(2) + ')';
        Art.ell(x, p.x, p.y, p.size * (1.6 - a * 0.6), p.size * (1.6 - a * 0.6)); x.fill();
      } else if (p.type === 'fire') {
        x.globalAlpha = a;
        x.fillStyle = p.col;
        Art.ell(x, p.x, p.y, p.size * a * 1.1, p.size * a * 1.1); x.fill();
      } else if (p.type === 'goo') {
        x.globalAlpha = a * 0.9;
        x.fillStyle = p.col; Art.ell(x, p.x, p.y, p.size * a, p.size * a * 0.8); x.fill();
      } else {
        x.globalAlpha = a;
        x.fillStyle = p.col;
        Art.ell(x, p.x, p.y, p.size * a, p.size * a); x.fill();
      }
      x.restore();
    }

    // 飘字
    for (const f of this.floaters) {
      const a = clamp(f.life / f.max, 0, 1);
      x.save();
      x.globalAlpha = a > 0.25 ? 1 : a / 0.25;
      x.font = (f.big ? 'bold 30px ' : 'bold 17px ') + "Impact, 'Arial Black', 'PingFang SC', sans-serif";
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineWidth = f.big ? 6 : 4; x.strokeStyle = 'rgba(40,22,6,0.95)'; x.lineJoin = 'round';
      x.strokeText(f.text, f.x, f.y);
      x.fillStyle = f.col;
      x.fillText(f.text, f.x, f.y);
      x.restore();
    }

    x.restore();

    // 顶栏与底栏之间的渐隐（让 UI 更清晰）
    const tg = x.createLinearGradient(0, 0, 0, 108);
    tg.addColorStop(0, 'rgba(20,12,4,0.42)'); tg.addColorStop(1, 'rgba(20,12,4,0)');
    x.fillStyle = tg; x.fillRect(0, 0, CANVAS_W, 108);
    const bg = x.createLinearGradient(0, APRON_Y - 56, 0, CANVAS_H);
    bg.addColorStop(0, 'rgba(18,12,6,0)'); bg.addColorStop(0.45, 'rgba(18,12,6,0.55)'); bg.addColorStop(1, 'rgba(14,9,4,0.86)');
    x.fillStyle = bg; x.fillRect(0, APRON_Y - 56, CANVAS_W, CANVAS_H - APRON_Y + 56);

    if (this.state === 'ready' || this.state === 'intermission') this.drawNextHint(x, t);
  }

  drawNextHint(x, t) {
    const label = this.round === 0 ? '准备布防 · 第 1 波即将到来' : '第 ' + (this.round + 1) + ' 波即将到来';
    x.save();
    x.globalAlpha = 0.55 + Math.sin(t * 3) * 0.2;
    x.font = "bold 22px 'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 5; x.strokeStyle = 'rgba(30,16,4,0.9)'; x.lineJoin = 'round';
    x.strokeText(label, CANVAS_W / 2, APRON_Y - 28);
    x.fillStyle = '#ffe9a8';
    x.fillText(label, CANVAS_W / 2, APRON_Y - 28);
    x.restore();
  }

  drawRange(x, tw) {
    const L = TOWERS[tw.key].levels[tw.level];
    x.save();
    x.globalAlpha = 0.14; x.fillStyle = '#ffffff';
    Art.ell(x, tw.x, tw.y, L.range, L.range * 0.78); x.fill();
    x.globalAlpha = 0.6; x.strokeStyle = '#ffffff'; x.lineWidth = 2;
    x.setLineDash([9, 7]); x.lineDashOffset = -this.time * 30;
    Art.ell(x, tw.x, tw.y, L.range, L.range * 0.78); x.stroke();
    x.setLineDash([]);
    if (tw.key === 'flame') {
      x.globalAlpha = 0.22; x.fillStyle = '#ff8c1a';
      x.beginPath(); x.moveTo(tw.x, tw.y);
      x.arc(tw.x, tw.y, L.range, tw.aim - L.arc, tw.aim + L.arc); x.closePath(); x.fill();
    }
    // 选中光圈
    x.globalAlpha = 0.85; x.strokeStyle = '#ffd24a'; x.lineWidth = 3;
    Art.ell(x, tw.x, tw.y + 8, 30 + Math.sin(this.time * 5) * 2, 13); x.stroke();
    x.restore();
  }

  drawGhost(x) {
    const c = this.hoverCell.c, r = this.hoverCell.r;
    const key = this.pendingKey;
    const cx = cellCX(c), cy = cellCY(r);
    const reason = key ? this.canPlace(c, r, key) : null;
    x.save();
    // 格子高亮
    const ok = key && !reason;
    x.globalAlpha = 0.28;
    x.fillStyle = ok ? '#b6ff6a' : '#ff6a6a';
    Art.roundRect(x, c * CELL + 3, r * CELL + 3, CELL - 6, CELL - 6, 8); x.fill();
    x.globalAlpha = 0.9; x.lineWidth = 3;
    x.strokeStyle = ok ? '#dfffb0' : '#ffb0b0';
    Art.roundRect(x, c * CELL + 3, r * CELL + 3, CELL - 6, CELL - 6, 8); x.stroke();

    if (key) {
      const L = TOWERS[key].levels[0];
      x.globalAlpha = ok ? 0.16 : 0.09;
      x.fillStyle = ok ? '#ffffff' : '#ff9a9a';
      Art.ell(x, cx, cy, L.range, L.range * 0.78); x.fill();
      x.globalAlpha = ok ? 0.55 : 0.3;
      x.strokeStyle = ok ? '#ffffff' : '#ff9a9a'; x.lineWidth = 2;
      x.setLineDash([8, 7]); Art.ell(x, cx, cy, L.range, L.range * 0.78); x.stroke();
      x.setLineDash([]);

      // 幽灵炮塔
      const sp = Art.getTowerSprite(key, 0);
      x.globalAlpha = ok ? 0.85 : 0.4;
      x.drawImage(sp.base, cx - 48, cy - 48);
      /* 3/4 炮塔顶：朝向固定一个好看的角度，偏移由 art.js 给出 */
      x.drawImage(Art.getTopProj(key, 0, -0.4), cx + Art.TOP_OX, cy + Art.TOP_OY);
    }
    x.restore();
  }

  /* ---------- 供 UI 查询 ---------- */
  get roundLabel() {
    if (this.state === 'gameover') return 'GAME OVER';
    if (this.state === 'victory') return 'VICTORY';
    return 'ROUND ' + Math.max(1, this.round);
  }
  get remainingEnemies() { return this.enemies.length + this.spawnQueue.length; }
}
