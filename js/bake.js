/* ============================================================
   bake.js —— Blender 正交烘焙贴图的运行时。

   只做两件事：
     1. 把 bake-data.js 里的 base64 解成 Image（不引任何依赖）
     2. 提供「朝向 → 图集格」的换算

   真正的绘制在 art.js 的 drawTower 里（见那里的 bake 分支）。
   烘焙链见 tools/bake/：Blender 正交相机仰角 27.386°（= asin(GROUND_K)），
   赛璐璐着色 → 粗黑描边 → 48 朝向图集。
   ============================================================ */
(function () {
  const M = (typeof BAKE_META !== 'undefined') ? BAKE_META : null;
  const D = (typeof BAKE_DATA !== 'undefined') ? BAKE_DATA : null;
  const EM = (typeof BAKE_ENEMY_META !== 'undefined') ? BAKE_ENEMY_META : null;
  const ED = (typeof BAKE_ENEMY_DATA !== 'undefined') ? BAKE_ENEMY_DATA : null;

  let _base = null, _top = null, _enemyAtlas = null;
  let _ready = false, _resolve = null;
  const _p = new Promise(r => { _resolve = r; });

  function load(src) {
    return new Promise(res => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  }

  const loads = [];
  if (D && M) loads.push(load(D.base), load(D.top));
  if (ED && EM) loads.push(load(ED.atlas));

  if (loads.length) {
    Promise.all(loads).then(pair => {
      let i = 0;
      if (D && M) { _base = pair[i++]; _top = pair[i++]; }
      if (ED && EM) { _enemyAtlas = pair[i++]; }
      _ready = true; _resolve();
    });
  } else {
    _ready = true; _resolve();
  }

  /* ?bake=0 可以整体关掉烘焙贴图，回退到程序化伪 3D —— 方便 A/B 对比 */
  const on = !/[?&]bake=0(?:&|$)/.test(
    (typeof location !== 'undefined' ? location.search : '') || '');

  const Bake = {
    enabled: on,
    ready() { return _p; },
    get loaded() { return _ready; },
    get base() { return _base; },
    get top() { return _top; },
    meta: M,

    /* 目前只烘了机枪塔 1 级；其余塔种继续走程序化路径 */
    has(key, lv) {
      return key === 'gatling' && (lv || 0) === 0 && _ready && !!_top && !!_base;
    },

    /* 敌人烘焙查询 */
    hasEnemy(key) {
      return _ready && !!_enemyAtlas && !!EM && EM.kinds.includes(key);
    },
    get enemyAtlas() { return _enemyAtlas; },
    enemyMeta: EM,

    /* 朝向 → 桶（与 art.js 的 TOP_BUCKETS / EBUCKETS 同一套取整） */
    bucket(rot, buckets) {
      let b = Math.round(rot / (Math.PI * 2) * buckets) % buckets;
      if (b < 0) b += buckets;
      return b;
    },
    /* 桶 → 图集里那一格的左上角 */
    cellRect(b) {
      const c = b % M.cols, r = (b / M.cols) | 0;
      return [c * M.cellW, r * M.cellH];
    },
    /* 敌人桶 → 图集格左上角 */
    enemyCellRect(key, b) {
      const off = EM.kindOffset[key] || 0;
      const idx = off + b;
      const c = idx % EM.cols, r = (idx / EM.cols) | 0;
      return [c * EM.cellW, r * EM.cellH];
    },
  };

  if (typeof window !== 'undefined') window.Bake = Bake;
})();
