/* ============================================================
   FIELDRUNNERS · sprites.js
   用设计稿裁出来的 PNG 当 炮塔底座 / 炮头 / 敌人。

   比起程序化重画：
   - 厚涂卡通 + 粗黑描边 + 橄榄塑料 + 橙色引擎光 ——
     这些都是设计稿最显眼的特征，程序化版本出不来。
   - 单帧朝向（设计稿是右视图）靠 ctx.rotate 旋转，
     位图旋转对 2D 手绘风 OK。

   缓存 + Promise：base64 解码完成后才让 Art 接管。
   ============================================================ */
(function () {
  const _imgCache = {};
  let _ready = false;
  let _readyResolve = null;
  const _readyPromise = new Promise(res => { _readyResolve = res; });

  /* 加载并缓存 25 张图 */
  const _keys = Object.keys(SPRITE_DATA);
  let _loaded = 0;
  for (const k of _keys) {
    const img = new Image();
    img.onload = () => { _loaded++; if (_loaded === _keys.length) { _ready = true; _readyResolve(); } };
    img.onerror = () => { _loaded++; if (_loaded === _keys.length) { _ready = true; _readyResolve(); } };
    img.src = SPRITE_DATA[k];
    _imgCache[k] = img;
  }
  /* 防御：0 张图时也要 resolve（防止永远卡住） */
  if (_keys.length === 0) { _ready = true; _readyResolve(); }

  const Sprites = {
    enabled: true,            // 渲染开关；Art.drawTower / drawEnemy 会检查
    ready() { return _readyPromise; },      // 函数：等待所有 sprite 解码完
    get loaded() { return _ready; },        // 属性：是否已经加载完

    /* 工具：拿原始尺寸 */
    size(k) {
      const im = _imgCache[k];
      return im && im.complete ? im.naturalWidth : 0;
    },

    /* —— 炮塔：底座 + 旋转炮头 —— */
    /* 基座 = 设计稿里那个不旋转的部分（圆石台 + 橄榄外壳 + 各种小灯）。
       每个塔等级有自己的底座，所以 3 张。
       scale = 想让炮弹落多大（默认 0.40 = 一个塔占 ~64px，
       即设计稿 160px 的 ~40%，刚好一格宽）。 */
    drawTowerBase(ctx, key, lv, cx, cy, scale = 0.40) {
      const im = _imgCache[`${key}_t_lvl${lv + 1}`];
      if (!im || !im.complete) return false;
      const w = im.naturalWidth * scale, h = im.naturalHeight * scale;
      ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
      return true;
    },
    /* 炮头 = 炮管/线圈/雷达/火焰喷嘴，本身要跟着 aim 旋转。
       设计稿里只画了「朝右」的炮头，所以接 ctx.rotate(rot) 直接转。
       scale 必须和 drawTowerBase 一致，否则底座和炮头尺寸对不上。 */
    drawTowerTop(ctx, key, lv, cx, cy, rot, scale = 0.40) {
      const im = _imgCache[`${key}_t_lvl${lv + 1}`];
      if (!im || !im.complete) return false;
      const w = im.naturalWidth * scale, h = im.naturalHeight * scale;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.drawImage(im, -w / 2, -h / 2, w, h);
      ctx.restore();
      return true;
    },

    /* —— 敌人：方向 = heading —— */
    drawEnemy(ctx, kind, cx, cy, heading) {
      /* enemy kind -> cropped key */
      const k = kind === 'infantry' ? 'jeep'
              : kind === 'runner'   ? 'moto'
              : kind === 'commando' ? 'tank'
              : kind === 'truck'    ? 'truck'
              : kind === 'heli'     ? 'heli'
              : kind === 'bomber'   ? 'bomber'
              : kind === 'boss'     ? 'boss' : null;
      if (!k) return false;
      const im = _imgCache[`${k}_e_${kind === 'heli' || kind === 'bomber' || kind === 'boss' ? 'g2' : 'g1'}`];
      if (!im || !im.complete) return false;
      /* 不同敌人的 sprite 自然宽度差很多（卡车 139 / 直升机 318 / 轰炸机 338），
         各自算一个 scale 让成品落进 ~50-80px 范围：
           - 地面载具 ~ 0.42（与塔同档）
           - 直升机   ~ 0.20（sprite 太宽，必须压扁一点）
           - 轰炸机   ~ 0.18（同上）
           - boss     ~ 0.26 */
      const scale =
        kind === 'heli'   ? 0.22 :
        kind === 'bomber' ? 0.18 :
        kind === 'boss'   ? 0.28 :
                        0.42;
      const w = im.naturalWidth * scale, h = im.naturalHeight * scale;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(heading || 0);
      ctx.drawImage(im, -w / 2, -h / 2, w, h);
      ctx.restore();
      return true;
    },

    /* —— 暴露原始 Image 给 Art.towerIcon —— */
    img(key) { return _imgCache[key] },
  };

  /* 暴露给 art.js 用的命名空间 */
  if (typeof window !== 'undefined') window.Sprites = Sprites;
  else this.Sprites = Sprites;
})();