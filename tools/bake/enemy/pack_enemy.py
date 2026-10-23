# -*- coding: utf-8 -*-
"""
pack_enemy.py —— 把 runner / infantry 的烘焙图处理后打包成图集。

和第一版的关键差别（第一版敌人出来是一团黑）：
  1. GLB 自带的 1x1 地板片在 27° 掠射角下只剩一条 <0.99 的半透明细线，
     第一版把它算进了并集 bbox → 整帧被当成内容，模型只占画面 1/4。
     现在用「alpha >= SOLID_A 的最大连通块」锁死模型本体，地板直接丢掉。
  2. 模型单独裁出来放大到目标宽度（runner 66px / infantry 60px，
     对齐程序化版的实测尺寸），不再 704→176 一刀切。
  3. 描边改成「真正的外环」：先按 alpha 膨胀出一圈再上墨，
     不再把所有非实心像素（含半透明边）都染成墨色 —— 那是黑边的来源。
  4. 加了调色（提暗部 / 提饱和 / 轻对比），否则 PBR 烘出来的载具在
     卡通地面上偏灰发闷。

输出 fieldrunners/js/bake-enemy-data.js
"""
import base64, io, json, math, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('BAKE_WORK', os.path.join(HERE, 'out'))
DST = os.path.join(WORK, 'enemy_final')
os.makedirs(DST, exist_ok=True)

REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

KINDS = ['runner', 'infantry']
HEADINGS = 20

# 实心判定：EEVEE 的 film_transparent 下模型本体 alpha≈1
SOLID_A = 0.985
KEEP_DILATE = 4          # 源图像素：保留模型周围几像素的半透明边
MARGIN = 2               # 裁切外扩

# 目标宽度（**2 倍**分辨率，绘制时再降采样）。
# 设计稿实测 edge 密度 56~59%，而 64px 宽的精灵只有 15~18% ——
# 原因就是内容像素太少，画到屏幕上被拉糊。按 2x 烘，绘制时 drawImage 缩一半，
# dpr=2 的屏幕正好 1:1，细节才留得住。
TARGET_W = {'runner': 140, 'infantry': 128}

INK = np.array([0.114, 0.141, 0.071], np.float32)   # #1d2412 深橄榄（不用纯黑）
OUTLINE_PX = float(os.environ.get('PK_OUTLINE', '1.0'))
# 设计稿实测（归一化到 200px 高）：描边/暗部占 18~25% 的像素。
# 1.0px 在 60px 宽的载具上只有 5.9% —— 太细，形体没有轮廓，看起来是「一团」。
OUTLINE_A = 0.35         # 剪影阈值取 0.35 而不是 0.5：
                         # 把抗锯齿的半透明边算进剪影，描边会凭空粗一圈。
SUPER = 3                # 描边在 3 倍尺寸上做，再降采样，边缘更干净
PAD = 3                  # 格子四周留白（最终像素）

# 暗部提升 + 饱和度：设计稿是厚涂卡通，暗部有颜色不是灰。
# 用纯灰抬暗部会把载具洗白（实测 sat 0.19 vs 设计稿 0.39），
# 所以 lift 要弱、且往「带色」的方向抬。
LIFT_TARGET = 0.30
LIFT_STRENGTH = float(os.environ.get('PK_LIFT', '0.0'))
LIFT_COL = np.array([0.26, 0.24, 0.30], np.float32)   # 偏冷紫的暗部

# 逐载具饱和度：设计稿 moto 0.374 / jeep 0.391，两者接近；
# 但 PBR 烘出来 moto 0.43（已经够）、jeep 只有 0.25（军绿被洗成灰）。
# 用同一个系数会让摩托过艳、吉普仍然发灰，所以分开乘。
SAT_MUL = float(os.environ.get('PK_SAT', '1.0'))
SAT_PER_KIND = {'runner': 1.15, 'infantry': 2.6}

QUANT = int(os.environ.get('PK_QUANT', '128'))


def dilate(mask, r):
    m = mask.copy()
    for _ in range(r):
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
        m[:1, :] = False
        m[-1:, :] = False
        m[:, :1] = False
        m[:, -1:] = False
    return m


def keep_components(mask, min_ratio=0.02, min_abs=40):
    """只保留足够大的连通块：地板片在掠射角下会碎成一堆孤立小点，
    直接按 alpha 阈值取会把这些点一起带进来（图集上那些散落的黑点）。"""
    from collections import deque
    ys, xs = np.nonzero(mask)
    coords = set(zip(ys.tolist(), xs.tolist()))
    visited = set()
    comps = []
    for start in coords:
        if start in visited:
            continue
        q = deque([start])
        visited.add(start)
        comp = []
        while q:
            y, x = q.popleft()
            comp.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    n = (y + dy, x + dx)
                    if n in coords and n not in visited:
                        visited.add(n)
                        q.append(n)
        comps.append(comp)
    if not comps:
        return mask
    comps.sort(key=len, reverse=True)
    thresh = max(min_abs, int(len(comps[0]) * min_ratio))
    out = np.zeros_like(mask)
    kept = 0
    for c in comps:
        if len(c) < thresh:
            break
        for y, x in c:
            out[y, x] = True
        kept += 1
    print(f'    components: {len(comps)} -> keep {kept} (thresh {thresh})')
    return out


def resize_rgba(arr, size):
    """预乘 alpha 后再缩放，避免透明区的黑色渗进边缘（黑边的主要来源之一）。"""
    pm = arr.copy()
    pm[..., :3] *= pm[..., 3:4]
    chans = []
    for i in range(4):
        im = Image.fromarray(pm[..., i].astype(np.float32), 'F')
        chans.append(np.asarray(im.resize(size, Image.LANCZOS), dtype=np.float32))
    out = np.stack(chans, -1)
    al = np.clip(out[..., 3], 0.0, 1.0)
    rgb = out[..., :3] / np.maximum(al[..., None], 1e-5)
    return np.concatenate([np.clip(rgb, 0, 1), al[..., None]], -1)


def lift_shadows(rgb):
    """把近黑像素往「带色的暗部」抬一点，保住轮胎/底盘的形体。
    抬向灰会把载具洗白，所以用偏冷的暗紫。"""
    lum = rgb.mean(axis=2, keepdims=True)
    w = np.clip((LIFT_TARGET - lum) / LIFT_TARGET, 0, 1) * LIFT_STRENGTH
    return rgb + (LIFT_COL - rgb) * w


def grade(rgb, gamma=0.78, sat=1.0):
    """提饱和 + 轻对比，往设计稿的厚涂卡通靠。
    设计稿实测 sat≈0.39；烘焙出来的 PBR 偏灰，所以要显式补饱和。"""
    g = np.power(np.clip(rgb, 0, 1), gamma)
    lum = g @ np.array([0.299, 0.587, 0.114], np.float32)
    g = np.clip(lum[..., None] + (g - lum[..., None]) * sat, 0, 1)
    return np.clip(0.5 + (g - 0.5) * 1.10, 0, 1)


def auto_gamma(rgb, core, target=0.43, lo=0.60, hi=1.0):
    """按模型自身平均亮度反算 gamma，让两种载具在游戏里亮度一致
    （PBR 烘出来的摩托偏亮、吉普偏暗，用同一个 gamma 会一明一暗）。"""
    m = float(np.clip(rgb[core].mean(), 0.02, 0.98))
    g = math.log(target) / math.log(m)
    return float(min(hi, max(lo, g)))


def load(path):
    im = Image.open(path).convert('RGBA')
    return np.asarray(im).astype(np.float32) / 255.0


# ---------- 1. 逐帧载入、剔地板、求并集 bbox ----------
raw = {}
for kind in KINDS:
    frames = []
    x0 = y0 = 10 ** 9
    x1 = y1 = -10 ** 9
    for h in range(HEADINGS):
        a = load(os.path.join(WORK, f'bake_{kind}', f'h{h:02d}.png'))
        core = keep_components(a[..., 3] >= SOLID_A)
        ys, xs = np.nonzero(core)
        if len(xs) == 0:
            raise RuntimeError(f'{kind} h{h:02d}: 没有实心像素')
        x0 = min(x0, xs.min()); x1 = max(x1, xs.max())
        y0 = min(y0, ys.min()); y1 = max(y1, ys.max())
        keep = dilate(core, KEEP_DILATE)
        b = a.copy()
        b[..., 3] *= keep          # 地板细线丢掉
        frames.append(b)
    raw[kind] = (frames, (x0, y0, x1, y1))
    print(f'{kind}: union bbox x {x0}..{x1}  y {y0}..{y1}  '
          f'({x1-x0+1}x{y1-y0+1})')

# ---------- 2. 统一格子尺寸 ----------
sizes = {}
for kind in KINDS:
    bx0, by0, bx1, by1 = raw[kind][1]
    bw = bx1 - bx0 + 1
    bh = by1 - by0 + 1
    tw = TARGET_W[kind]
    th = int(round(tw * bh / bw))
    sizes[kind] = (tw, th)
    print(f'{kind}: scaled {tw}x{th}  (aspect {bh/bw:.3f})')

CELL_W = max(sizes[k][0] for k in KINDS) + PAD * 2
CELL_H = max(sizes[k][1] for k in KINDS) + PAD * 2
CELL_W += CELL_W % 2
CELL_H += CELL_H % 2
print(f'cell {CELL_W}x{CELL_H}')

# ---------- 3. 逐帧裁切 / 放大 / 调色 / 描边 / 缩到目标 ----------
cells = {}
origins = {}
for kind in KINDS:
    frames, (bx0, by0, bx1, by1) = raw[kind]
    tw, th = sizes[kind]
    big_w, big_h = tw * SUPER, th * SUPER
    # 格子内模型左上角（居中，底部对齐）
    ox = (CELL_W - tw) // 2
    oy = CELL_H - PAD - th
    origins[kind] = [ox + tw // 2, oy + th]     # 锚点 = 底部中心（地面着地点）

    out_cells = []
    g = auto_gamma(lift_shadows(frames[0][..., :3]), frames[0][..., 3] >= 0.5)
    print(f'    auto gamma = {g:.3f}')
    for h in range(HEADINGS):
        a = frames[h]
        sub = a[max(0, by0 - MARGIN):by1 + MARGIN + 1,
                max(0, bx0 - MARGIN):bx1 + MARGIN + 1]
        img = resize_rgba(sub, (big_w, big_h))
        img[..., :3] = grade(lift_shadows(img[..., :3]), g,
                             SAT_MUL * SAT_PER_KIND.get(kind, 1.0))
        # 外环描边
        solid = img[..., 3] > OUTLINE_A
        ring = dilate(solid, int(round(OUTLINE_PX * SUPER))) & ~solid
        img[ring, :3] = INK
        img[ring, 3] = 1.0
        img = resize_rgba(img, (tw, th))

        cell = np.zeros((CELL_H, CELL_W, 4), np.float32)
        cell[oy:oy + th, ox:ox + tw] = img
        out_cells.append(cell)
    cells[kind] = out_cells
    print(f'{kind}: cell content {tw}x{th} at ({ox},{oy})  origin {origins[kind]}')

# ---------- 4. 拼图集 ----------
COLS = 10
ROWS = (len(KINDS) * HEADINGS + COLS - 1) // COLS
atlas = Image.new('RGBA', (COLS * CELL_W, ROWS * CELL_H), (0, 0, 0, 0))
idx = 0
kind_offset = {}
for kind in KINDS:
    kind_offset[kind] = idx
    for cell in cells[kind]:
        u8 = (np.clip(cell, 0, 1) * 255 + 0.5).astype(np.uint8)
        im = Image.fromarray(u8, 'RGBA')
        atlas.paste(im, ((idx % COLS) * CELL_W, (idx // COLS) * CELL_H))
        idx += 1
atlas.save(os.path.join(DST, 'enemy_atlas.png'))
print('atlas', atlas.size)

# 预览图：放大 3 倍贴到灰底，方便肉眼验收
prev = atlas.resize((atlas.width * 3, atlas.height * 3), Image.NEAREST)
bgp = Image.new('RGBA', prev.size, (92, 128, 62, 255))
bgp.alpha_composite(prev)
bgp.convert('RGB').save(os.path.join(DST, 'atlas_preview.png'))


def b64(im, colors=QUANT):
    buf = io.BytesIO()
    if colors:
        im = im.quantize(colors=colors, method=Image.FASTOCTREE, dither=Image.NONE)
    im.save(buf, 'PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode('ascii')


js = []
js.append('/* ============================================================')
js.append('   bake-enemy-data.js —— Blender 烘焙敌人贴图（自动生成，勿手改）')
js.append('   模型：runner.glb（摩托兵）, infantry.glb（吉普步兵）')
js.append('   生成脚本：tools/bake/enemy/pack_enemy.py')
js.append('   ============================================================ */')
js.append('const BAKE_ENEMY_DATA = {')
js.append('  atlas: "data:image/png;base64,' + b64(atlas) + '",')
js.append('};')
js.append('const BAKE_ENEMY_META = {')
js.append('  kinds: ' + json.dumps(KINDS) + ',')
js.append('  headings: %d, cols: %d, rows: %d,' % (HEADINGS, COLS, ROWS))
js.append('  cellW: %d, cellH: %d,' % (CELL_W, CELL_H))
js.append('  epX: 88, epY: 128,')
js.append('  origin: ' + json.dumps(origins) + ',')
js.append('  kindOffset: ' + json.dumps(kind_offset) + ',')
js.append('};')

out = os.environ.get('PK_OUT_JS') or os.path.join(REPO, 'js', 'bake-enemy-data.js')
open(out, 'w').write('\n'.join(js) + '\n')
print('wrote', out, os.path.getsize(out) // 1024, 'KB')
