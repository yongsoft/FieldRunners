/* ============================================================
   FIELDRUNNERS · 坚守阵地 复刻版
   config.js — 全局常量 / 炮塔 / 敌人 / 地图 / 波次
   ============================================================ */

/* ---------- 画布与网格 ---------- */
const CANVAS_W = 1280;
const CANVAS_H = 720;

const CELL = 64;                 // 建造格边长
const COLS = 20;                 // 横向格数  -> 1280
const ROWS = 9;                  // 纵向格数  -> 576
const FIELD_W = COLS * CELL;     // 1280
const FIELD_H = ROWS * CELL;     // 576
const APRON_Y = FIELD_H;         // 底栏起始 y
const APRON_H = CANVAS_H - FIELD_H; // 144

const PF = 16;                   // 寻路细网格
const PC = FIELD_W / PF;         // 80
const PR = FIELD_H / PF;         // 36

const TOWER_BLOCK_HALF = 32;     // 炮塔占格半宽
const ENEMY_RADIUS = 10;         // 敌人碰撞半径
const INFLATE = TOWER_BLOCK_HALF + ENEMY_RADIUS; // 42 膨胀半宽

const MAX_LIVES = 20;
const CLASSIC_ROUNDS = 100;

/* ---------- 工具 ---------- */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const dist2 = (x0, y0, x1, y1) => { const dx = x1 - x0, dy = y1 - y0; return dx * dx + dy * dy; };
const dist = (x0, y0, x1, y1) => Math.sqrt(dist2(x0, y0, x1, y1));
const angLerp = (a, b, t) => { let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; return a + d * t; };
const cellCX = c => c * CELL + CELL / 2;
const cellCY = r => r * CELL + CELL / 2;

/* ============================================================
   炮塔定义
   与原作一致：机枪塔$5 / 胶水塔$10 / 导弹塔$20 / 火焰塔$50 /
               电磁塔$70 / 迫击炮$120   —— 每种可升级两次，威力翻倍
   ============================================================ */
/* 数值设计原则（与原作一致）：
   每次升级威力约翻倍，升级花费约等于建造价 -> 各级「性价比」基本持平。
   便宜的塔单体 DPS/$ 略高但怕装甲；昂贵的塔靠射程 / 溅射 / 连锁 / 减速取胜。 */
const TOWERS = {
  gatling: {
    key: 'gatling', name: '机枪塔', en: 'Gatling', cost: 5, color: '#e8452c', color2: '#8c1f10',
    desc: '高射速单体伤害，弹雨压制，对空有效。',
    hitsAir: true, kind: 'bullet',
    levels: [
      { dmg: 4, rate: 5.0, range: 92, up: 0 },   //  20 dps  $5
      { dmg: 7, rate: 6.5, range: 102, up: 9 },   //  46 dps  $14
      { dmg: 12, rate: 8.0, range: 112, up: 18 }   //  96 dps  $32
    ]
  },
  goo: {
    key: 'goo', name: '胶水塔', en: 'Goo', cost: 10, color: '#7ed321', color2: '#2f6b06',
    desc: '喷射黏胶，大幅减速目标，为其他炮塔争取输出时间。',
    hitsAir: true, kind: 'goo',
    levels: [
      { dmg: 4, rate: 1.6, range: 98, up: 0, slow: 0.42, slowDur: 2.2, splash: 22 },
      { dmg: 9, rate: 1.9, range: 110, up: 16, slow: 0.56, slowDur: 2.6, splash: 30 },
      { dmg: 18, rate: 2.2, range: 122, up: 32, slow: 0.70, slowDur: 3.0, splash: 40 }
    ]
  },
  missile: {
    key: 'missile', name: '导弹塔', en: 'Missile', cost: 20, color: '#5b9f3f', color2: '#a8241a',
    desc: '发射追踪导弹，中等伤害并造成范围爆炸，对空有效。',
    hitsAir: true, kind: 'missile',
    levels: [
      { dmg: 30, rate: 0.90, range: 152, up: 0, splash: 28, missiles: 1 },   //  27 dps  $20
      { dmg: 62, rate: 1.10, range: 172, up: 32, splash: 34, missiles: 1 },   //  68 dps  $52
      { dmg: 78, rate: 1.30, range: 194, up: 64, splash: 46, missiles: 2 }    // 203 dps  $116
    ]
  },
  flame: {
    key: 'flame', name: '火焰塔', en: 'Flame', cost: 50, color: '#ff8c1a', color2: '#b3250a',
    desc: '近距离持续喷射烈焰，秒伤极高并附加灼烧，仅对地面。',
    hitsAir: false, kind: 'flame',
    levels: [
      { dps: 80, range: 80, arc: 0.34, up: 0, burn: 10 },    //  80 dps  $50
      { dps: 175, range: 92, arc: 0.38, up: 80, burn: 22 },    // 175 dps  $130
      { dps: 330, range: 104, arc: 0.42, up: 160, burn: 42 }    // 330 dps  $290
    ]
  },
  tesla: {
    key: 'tesla', name: '电磁塔', en: 'Tesla', cost: 70, color: '#5ad2ff', color2: '#1b4fb8',
    desc: '释放连锁闪电，瞬间命中并可弹射多个目标，对空有效。',
    hitsAir: true, kind: 'tesla',
    levels: [
      { dmg: 55, rate: 1.10, range: 122, up: 0, chain: 2, falloff: 0.72 },   //  60 dps  $70
      { dmg: 110, rate: 1.30, range: 138, up: 112, chain: 3, falloff: 0.78 },   // 143 dps  $182
      { dmg: 220, rate: 1.50, range: 154, up: 224, chain: 4, falloff: 0.84 }    // 330 dps  $406
    ]
  },
  mortar: {
    key: 'mortar', name: '迫击炮', en: 'Mortar', cost: 120, color: '#2f6f8f', color2: '#0d2c46',
    desc: '超远射程曲射炮，落点大范围溅射，专治密集地面部队。',
    hitsAir: false, kind: 'shell',
    levels: [
      { dmg: 110, rate: 0.45, range: 232, up: 0, splash: 50, minRange: 70 },  //  50 dps  $120
      { dmg: 220, rate: 0.55, range: 262, up: 192, splash: 58, minRange: 70 },  // 121 dps  $312
      { dmg: 430, rate: 0.66, range: 292, up: 384, splash: 68, minRange: 70 }   // 284 dps  $696
    ]
  }
};
const TOWER_ORDER = ['gatling', 'goo', 'missile', 'flame', 'tesla', 'mortar'];
// 经典模式只开放原作四塔；扩展模式追加火焰塔与迫击炮
const CLASSIC_TOWERS = ['gatling', 'goo', 'missile', 'tesla'];

// levels[i].up = 升到「第 i+2 级」的花费；建造价见 cost
function upgradeCost(key, level) { // level: 当前等级 0..2 -> 升到下一级的花费
  const L = TOWERS[key].levels;
  if (level >= L.length - 1) return 0;
  return L[level + 1].up;
}
function sellValue(t) {
  let invested = t.invested;
  if (invested == null) {
    invested = TOWERS[t.key].cost;
    for (let i = 1; i <= t.level; i++) invested += TOWERS[t.key].levels[i].up;
  }
  return Math.floor(invested * 0.7);
}

/* ============================================================
   敌人定义（陆空结合）
   ============================================================ */
const ENEMIES = {
  infantry: { key: 'infantry', name: '侦察吉普', hp: 42, speed: 44, reward: 5, armor: 0, radius: 10, air: false, score: 10, art: 'infantry' },
  runner: { key: 'runner', name: '摩托兵', hp: 56, speed: 84, reward: 7, armor: 0, radius: 11, air: false, score: 14, art: 'runner' },
  commando: { key: 'commando', name: '轻型坦克', hp: 128, speed: 48, reward: 11, armor: 2, radius: 11, air: false, score: 22, art: 'commando' },
  truck: { key: 'truck', name: '装甲卡车', hp: 340, speed: 33, reward: 22, armor: 5, radius: 14, air: false, score: 45, art: 'truck' },
  heli: { key: 'heli', name: '武装直升机', hp: 105, speed: 66, reward: 13, armor: 1, radius: 13, air: true, score: 28, art: 'heli' },
  bomber: { key: 'bomber', name: '轰炸机', hp: 250, speed: 58, reward: 26, armor: 3, radius: 15, air: true, score: 52, art: 'bomber' },
  boss: { key: 'boss', name: '重装指挥车', hp: 2600, speed: 27, reward: 160, armor: 9, radius: 20, air: false, score: 400, art: 'boss' }
};

/* ============================================================
   难度
   ============================================================ */
const DIFFICULTIES = {
  easy: { key: 'easy', name: '简单', money: 170, lives: 20, hpMul: 0.82, rewardMul: 1.15 },
  normal: { key: 'normal', name: '普通', money: 130, lives: 20, hpMul: 1.00, rewardMul: 1.00 },
  hard: { key: 'hard', name: '高手', money: 100, lives: 20, hpMul: 1.28, rewardMul: 0.90 }
};

/* ============================================================
   地形  ——  河流 / 浅滩 / 高地 / 房屋 / 基地
   地图用 9 行 x 20 列的字符画描述，见各图的 terrain 字段：
     . 平地     ~ 河流（不可通行、不可建造）
     = 浅滩     ^ 高地（不可通行，但可建造且炮塔伤害加成）
     # 房屋     B 基地（不可通行、不可建造）
   ============================================================ */
const TILE = {
  '.': { key: 'plain', name: '平地', build: true, walk: true, speed: 1.00, block: false, dmgMul: 1 },
  '~': { key: 'river', name: '河流', build: false, walk: false, speed: 0, block: true, deny: '河上不能建造' },
  '=': { key: 'ford', name: '浅滩', build: false, walk: true, speed: 0.55, block: false, deny: '浅滩上不能建造' },
  '^': { key: 'hill', name: '高地', build: true, walk: false, speed: 0, block: true, dmgMul: 1.35 },
  '#': { key: 'house', name: '房屋', build: false, walk: false, speed: 0, block: true, deny: '房屋上不能建造' },
  'B': { key: 'base', name: '基地', build: false, walk: false, speed: 0, block: true, deny: '这里是基地，不能建造' }
};
const TILE_CHARS = ['.', '~', '=', '^', '#', 'B'];
const TILE_LIST = TILE_CHARS.map(ch => TILE[ch]);
const TILE_INDEX = {}; TILE_CHARS.forEach((ch, i) => { TILE_INDEX[ch] = i; });

const HILL_DMG_MUL = TILE['^'].dmgMul;   // 高地对炮塔的伤害加成
const FORD_SPEED_MUL = TILE['='].speed;  // 浅滩对敌人的减速

/* 把字符画解析成 COLS*ROWS 的地形索引表（缺行/缺列一律按平地处理） */
function parseTerrain(map) {
  const g = new Uint8Array(COLS * ROWS);
  const art = map.terrain || [];
  for (let r = 0; r < ROWS; r++) {
    const line = art[r] || '';
    for (let c = 0; c < COLS; c++) {
      const i = TILE_INDEX[line[c]];
      g[r * COLS + c] = i === undefined ? 0 : i;
    }
  }
  return g;
}

/* ============================================================
   地图  ——  8 张原作地图中复刻 4 张最具代表性的
   spawns: 出生点(格坐标, 允许越界) / exits: 基地出口
   难度递进：草原/荒漠 只有单一入口，靠河流把敌人逼上固定路线；
             十字路口加高地；霜寒之地再加房屋。
   ============================================================ */
const MAPS = [
  {
    key: 'grasslands', name: '草原', en: 'Grasslands', theme: 'grass',
    tip: '单一入口。一条大河纵贯全图，中段水面骤然变宽 —— 唯一的一处浅滩在上游，敌人只能从那里涉水而过。',
    lvl: 1, lv: '入门',
    spawns: [{ c: -1.4, r: 4, exit: 0 }],
    exits: [{ c: COLS + 0.4, r: 4 }],
    decor: 'trees',
    /* 只有一个渡口（row 2）。
       为什么不再放第二个？单一入口 + 单一出口的地图上，流场只会解出唯一一条路线，
       另一个「对称」的渡口永远没人走 —— 玩家在那儿造的塔一发子弹都打不出去。
       所以改成：河流中段（row 3~5）加宽成 4 格，把左岸逼到 col 6 结束，
       敌人从 row 4 进场后必须先爬到 row 2 才能过河 —— 唯一渡口必然在必经之路上。 */
    terrain: [
      '.........~~.........',
      '.........~~.........',
      '.........==.........',
      '.......~~~~.........',
      '.......~~~~.........',
      '.......~~~~.........',
      '.........~~.........',
      '.........~~.........',
      '.........~~.........'
    ],
    seed: 1337
  },
  {
    key: 'drylands', name: '荒漠', en: 'Drylands', theme: 'desert',
    tip: '单一入口。两条沙河把地图切成三段，浅滩一上一下错开，敌人被迫走出之字形路线。',
    lvl: 2, lv: '普通',
    spawns: [{ c: -1.4, r: 4, exit: 0 }],
    exits: [{ c: COLS + 0.4, r: 4 }],
    decor: 'desert',
    terrain: [
      '....~~........~~....',
      '....~~........~~....',
      '....==........~~....',
      '....~~........~~....',
      '....~~........~~....',
      '....~~........~~....',
      '....~~........==....',
      '....~~........~~....',
      '....~~........~~....'
    ],
    seed: 24601
  },
  {
    key: 'crossroads', name: '十字路口', en: 'Crossroads', theme: 'grass',
    tip: '两条河道十字交汇，两条来路各只有一处浅滩；场上散布高地，站在高地上的炮塔伤害 +35%。',
    lvl: 3, lv: '进阶',
    spawns: [{ c: -1.4, r: 2, exit: 0 }, { c: 14, r: -1.4, exit: 1 }],
    exits: [{ c: COLS + 0.4, r: 2 }, { c: 14, r: ROWS + 0.4 }],
    decor: 'crossroads',
    terrain: [
      '...^^....~~.^^......',
      '...^^....~~.^^......',
      '.........==.........',
      '.........~~.........',
      '.........~~.........',
      '.........~~~~~=~~~~~',
      '.........~~~~~=~~~~~',
      '......^^.~~.......^^',
      '......^^.~~.......^^'
    ],
    seed: 90210
  },
  {
    key: 'frostbite', name: '霜寒之地', en: 'Frostbite', theme: 'snow',
    tip: '三面夹击，全部汇聚中央基地。一道高地长墙横贯全图，三路敌人只能先跑到地图两端才能下城；两侧冰河各只有一处渡口 —— 最难的一张图。',
    lvl: 4, lv: '困难',
    spawns: [{ c: -1.4, r: 0, exit: 0 }, { c: COLS + 1.4, r: 0, exit: 0 }, { c: 9, r: -1.4, exit: 0 }],
    exits: [{ c: 9.5, r: 4.5 }],
    decor: 'snow',
    /* 基地在正中央，所以「正上方出生」天然只有 4 格路（实测 382px / 9.3 秒就走完，
       炮塔根本来不及输出）。修法是加一道横贯全图的高地长墙（row 1, col 2~17）：
       顶行 row 0 变成一条走廊，三路敌人都得先横穿到 col 0~1 或 col 18~19 才能下来，
       中路出生点的路程因此从 382px 涨到 ~1200px。
       下面 row 7 再补一道对称长墙，把中央基地围成一个「城」；
       两侧冰河（col 2~3 / 14~15）各留一个渡口（row 4）作为进城口。
       高地可建造 —— 城墙本身就是玩家最好的火力平台，这是这张图给玩家的补偿。 */
    terrain: [
      '....................',
      '..^^^^^^^^^^^^^^^^..',
      '..~~..##....##~~....',
      '..~~..........~~....',
      '..==.....BB...==....',
      '..~~.....BB...~~....',
      '..~~..##....##~~....',
      '..^^^^^^^^^^^^^^^^..',
      '....................'
    ],
    seed: 4242
  }
];

/* ============================================================
   波次生成
   ============================================================ */
function waveComp(round) {
  const list = [];
  const add = (type, count, gap, delay) => { if (count > 0) list.push({ type, count: Math.round(count), gap, delay: delay || 0 }); };

  // 步兵：全程主力
  add('infantry', 4 + round * 0.85, 0.42);

  if (round >= 3) add('runner', 1 + (round - 2) * 0.5, 0.34, 2.2);
  if (round >= 6) add('heli', 1 + (round - 5) * 0.32, 0.9, 4.0);
  if (round >= 9) add('commando', 1 + (round - 8) * 0.42, 0.55, 3.0);
  if (round >= 14) add('truck', 1 + (round - 13) * 0.30, 1.1, 6.0);
  if (round >= 18) add('bomber', 1 + (round - 17) * 0.22, 1.4, 8.0);

  if (round % 10 === 0) add('boss', Math.floor(round / 20) + 1, 3.2, 5.0);

  // 上限保护
  list.forEach(g => { g.count = Math.min(g.count, 46); });
  return list;
}

/* 血量成长曲线 —— 反复试跑调过：
   早期（<=10 波）只涨到 2.5 倍，让多入口地图开局的「分兵压力」不至于劝退；
   后期用 1.6 次幂而不是 2.4 次幂，否则 100 波时血量 42 倍，
   远超玩家在有限格子里能堆出的火力上限（实测只能撑到 60 波左右）。
   现在强玩家（蛇形迷宫 + 六塔混编 + 全升级）能稳定打到 80+ 波。 */
function waveHpMul(round) {
  return 1 + (round - 1) * 0.12 + Math.floor(round / 10) * 0.30 + Math.pow(round / 30, 1.6);
}
function waveRewardMul(round) {
  return 1 + Math.min(round, 60) * 0.022;
}
function roundBonus(round) {
  return Math.round(22 + round * 3.4);
}

/* ============================================================
   调色板（统一美术风格：厚涂卡通 + 描边）
   ============================================================ */
const PAL = {
  outline: '#2a1a0e',
  gold: ['#fff3a8', '#ffd24a', '#e79a13', '#8a4f04'],
  domeLight: '#fbfdff', domeMid: '#cfd9e3', domeDark: '#7d8b9a',
  metal: ['#8d99a6', '#5c6874', '#333d47'],
  greenGem: ['#e8ffb0', '#a9e84f', '#57a417', '#2c6208'],
  heart: ['#ff9d9d', '#f0362f', '#a80f0c'],
  grass: ['#93cc45', '#74ad2a', '#578f16', '#a2d955'],
  sand: ['#e8c07a', '#d4a35c', '#b8843f', '#f0d29a'],
  snow: ['#f2f8ff', '#dbe9f7', '#bcd3ea', '#ffffff']
};

if (typeof module !== 'undefined') module.exports = { TOWERS, ENEMIES, MAPS };
