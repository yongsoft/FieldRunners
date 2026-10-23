# -*- coding: utf-8 -*-
"""
pack.py —— 把 48 张朝向帧重新打包成紧凑图集，并生成可直接被 index.html 加载的
js/bake-data.js（base64 内嵌，保持「零依赖、双击即玩」）。

紧凑格的尺寸/原点由所有朝向的**联合包围盒自动算出**，不再手写常数：
    originX ≥ 需要往左伸出的量,  CELL_W ≥ 左右伸出量之和  （纵向同理）
"""
import base64, io, json, math, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('BAKE_WORK', '/tmp/bl')                 # 中间产物目录（不入库）
REPO = os.environ.get('FR_REPO', os.path.abspath(os.path.join(HERE, '..', '..')))
FIN = os.path.join(WORK, 'final')
META = json.load(open(os.path.join(FIN, 'meta.json')))
HEADINGS = META['headings']
SRC_COLS = META['cols']
SRC_CELL = META['cell']
SRC_OX, SRC_OY = META['originX'], META['originY']

src = Image.open(os.path.join(FIN, 'top_sheet.png'))

# ---------- 1. 联合包围盒 ----------
# 注意：包围盒要按「格内局部坐标」算 —— 每格的 (0,0) 就是画布左上角，
# 所有朝向共用同一套画布坐标，不能把 cx/cy 加回去（那是图集里的位置）。
x0 = y0 = 10 ** 9
x1 = y1 = -10 ** 9
for i in range(HEADINGS):
    cx, cy = (i % SRC_COLS) * SRC_CELL, (i // SRC_COLS) * SRC_CELL
    cell = np.asarray(src.crop((cx, cy, cx + SRC_CELL, cy + SRC_CELL)))
    ys, xs = np.nonzero(cell[..., 3] > 8)
    x0 = min(x0, xs.min()); x1 = max(x1, xs.max())
    y0 = min(y0, ys.min()); y1 = max(y1, ys.max())
needL, needR = SRC_OX - x0, x1 - SRC_OX
needU, needD = SRC_OY - y0, y1 - SRC_OY
print('union bbox 1x: x %d..%d  y %d..%d  (origin %d,%d)' % (x0, x1, y0, y1, SRC_OX, SRC_OY))
print('  extents L%d R%d U%d D%d' % (needL, needR, needU, needD))

ALIGN = 8
ORIGIN_X = int(math.ceil(needL / ALIGN) * ALIGN)
ORIGIN_Y = int(math.ceil(needU / ALIGN) * ALIGN)
CELL_W = int(math.ceil((ORIGIN_X + needR) / ALIGN) * ALIGN)
CELL_H = int(math.ceil((ORIGIN_Y + needD) / ALIGN) * ALIGN)
assert ORIGIN_X >= needL and CELL_W - ORIGIN_X >= needR
assert ORIGIN_Y >= needU and CELL_H - ORIGIN_Y >= needD
CROP_X = SRC_OX - ORIGIN_X
CROP_Y = SRC_OY - ORIGIN_Y
assert CROP_X >= 0 and CROP_Y >= 0
assert CROP_X + CELL_W <= SRC_CELL and CROP_Y + CELL_H <= SRC_CELL, 'cell 超出 192 画布'
COLS, ROWS = SRC_COLS, (HEADINGS + SRC_COLS - 1) // SRC_COLS
QUANT = 128          # 调色板量化色数（0 = 不量化，直接 RGBA）
print('  cell %dx%d  origin (%d,%d)' % (CELL_W, CELL_H, ORIGIN_X, ORIGIN_Y))

atlas = Image.new('RGBA', (COLS * CELL_W, ROWS * CELL_H), (0, 0, 0, 0))
for i in range(HEADINGS):
    cx, cy = (i % SRC_COLS) * SRC_CELL, (i // SRC_COLS) * SRC_CELL
    cell = src.crop((cx + CROP_X, cy + CROP_Y, cx + CROP_X + CELL_W, cy + CROP_Y + CELL_H))
    atlas.paste(cell, ((i % COLS) * CELL_W, (i // COLS) * CELL_H), cell)
atlas.save(os.path.join(FIN, 'atlas_top.png'))

base = Image.open(os.path.join(FIN, 'base.png'))


def b64(im, colors=QUANT):
    """调色板量化后再 base64。

    赛璐璐着色天然只有几十种颜色，量化到 128 色几乎无损
    （实测 mean|Δ| 1.7 / 255，边缘的 39 级 alpha 全部保留），
    但图集能从 225KB 掉到 47KB —— 5 倍。内联进 HTML 后这点非常关键：
    6 塔 × 3 级全烘也就 ~1MB，而不是 5MB。"""
    buf = io.BytesIO()
    if colors:
        im = im.quantize(colors=colors, method=Image.FASTOCTREE, dither=Image.NONE)
    im.save(buf, 'PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode('ascii')


GROUND_Y = META['groundY']
PLATFORM_Y = META['platformY']

js = []
js.append('/* ============================================================')
js.append('   bake-data.js —— Blender 正交烘焙的炮塔贴图（自动生成，勿手改）')
js.append('')
js.append('   生成链：tools/bake/bake.py（Blender 4.5，正交相机仰角 27.386° = asin(0.46)，')
js.append('          几何法线赛璐璐着色）→ post.py（粗黑描边 + 盒式降采样）→ pack.py')
js.append('   图集布局：%d 列 × %d 行，%d 个朝向（每 %.1f° 一档，与 art.js 的 TOP_BUCKETS 一致）'
          % (COLS, ROWS, HEADINGS, 360.0 / HEADINGS))
js.append('   炮体原点（绕竖轴的旋转轴 = 基座台面中心）在格内 (%d, %d)' % (ORIGIN_X, ORIGIN_Y))
js.append('   ============================================================ */')
js.append('const BAKE_DATA = {')
js.append('  base: "data:image/png;base64,' + b64(base) + '",')
js.append('  top: "data:image/png;base64,' + b64(atlas) + '",')
js.append('};')
js.append('const BAKE_META = {')
js.append('  headings: %d, cols: %d, rows: %d,' % (HEADINGS, COLS, ROWS))
js.append('  cellW: %d, cellH: %d, originX: %d, originY: %d,' % (CELL_W, CELL_H, ORIGIN_X, ORIGIN_Y))
js.append('  baseCell: %d, baseOriginX: %d, baseOriginY: %d,' % (META['baseCell'], META['baseOriginX'], META['baseOriginY']))
js.append('  groundY: %.3f,     // 基座画布原点(48,48) → 塔中心下方 %.3f px = BASE_CY_TOP + BASE_RIM_H'
          % (GROUND_Y, GROUND_Y))
js.append('  platformY: %.3f,   // 炮体画布原点 → 塔中心下方 %.3f px = BASE_CY_TOP（基座台面中心）'
          % (PLATFORM_Y, PLATFORM_Y))
js.append('  scale: %.2f,        // 炮体画布的像素 / 世界单位（= art.js 的 TT）' % META['tt'])
js.append('};')

out = os.path.join(REPO, 'js', 'bake-data.js')
open(out, 'w').write('\n'.join(js) + '\n')
print('atlas', atlas.size, '->', os.path.getsize(os.path.join(FIN, 'atlas_top.png')) // 1024, 'KB')
print('wrote', out, os.path.getsize(out) // 1024, 'KB')
