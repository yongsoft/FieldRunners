/* ============================================================
   bake-tower.js —— Blender 3D 烘焙炮塔的运行时

   6 座塔 × 3 级 × 48 朝向，每座塔一个独立 JS（可并行加载）。
   和旧的 bake-data.js 不同：这里**不做中间离屏画布**，
   直接把图集格子 drawImage 到主画布（source-rect），省 48×18 张画布。

   投影已对齐：烘焙时模型绕 Z 转 -rot，与 art.js 的 pt() 同一套
   （推导见 tools/bake/tower/run.py 顶部注释）。
   ============================================================ */
(function () {
  const D = (typeof window !== 'undefined' && window.BAKE_TOWER) || {};
  const imgs = {};
  let pend = 0, ok = 0;

  for (const k in D) {
    pend++;
    const im = new Image();
    im.onload = () => { ok++; if (--pend === 0) done(); };
    im.onerror = () => { if (--pend === 0) done(); };
    im.src = D[k].atlas;
    imgs[k] = im;
  }
  let _ready = false;
  const _p = [];
  let _resolve;
  const promise = new Promise(r => { _resolve = r; });
  function done() { _ready = true; _resolve(); }

  /* ?bake=0 整体关掉，回退程序化 —— A/B 用 */
  const ON = !/[?&]bake=0(?:&|$)/.test(
    (typeof location !== 'undefined' ? location.search : '') || '');

  const BakeT = {
    enabled: ON,
    ready() { return promise; },
    get loaded() { return _ready; },
    get count() { return ok; },
    has(key, lv) {
      const d = D[key];
      return ON && _ready && !!d && !!imgs[key] && (lv | 0) < d.meta.levels;
    },
    meta(key) { return D[key] ? D[key].meta : null; },

    /* 朝向 → 图集格子。rot 与 art.js 的 buildTop 同一约定。 */
    cell(key, lv, rot) {
      const d = D[key];
      if (!d) return null;
      const m = d.meta;
      let b = Math.round(rot / (Math.PI * 2) * m.headings) % m.headings;
      if (b < 0) b += m.headings;
      const perLv = m.headings / m.cols;
      const idx = lv * perLv + Math.floor(b / m.cols);
      const c = b % m.cols;
      return {
        img: imgs[key],
        sx: c * m.cellW,
        sy: idx * m.cellH,
        w: m.cellW,
        h: m.cellH,
        /* 原点（台面中心）在格子里的位置 —— 绘制时用它对齐 */
        ox: m.ox,
        oy: m.oy,
      };
    },

    /* 一次画完，调用方只管 rotate 之后的世界坐标 */
    draw(x, key, lv, rot, dy) {
      const c2 = this.cell(key, lv, rot);
      if (!c2) return false;
      x.drawImage(c2.img, c2.sx, c2.sy, c2.w, c2.h,
        -c2.ox, -c2.oy + (dy || 0), c2.w, c2.h);
      return true;
    },
  };

  if (typeof window !== 'undefined') window.BakeT = BakeT;
})();
