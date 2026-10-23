# -*- coding: utf-8 -*-
"""
post.py —— 烘焙后处理：加粗黑描边 → 降采样 → 拼图集。
描边在超采样分辨率上做（外扩 = 1x 的 OUTLINE 像素），再盒式降采样，
这样描边宽度和抗锯齿都受控。

描边宽度分两档：基座 1.7（和 towerBase 的 ink 2.8/2.6 对应），
炮体 1.15（buildTop 的零件描边多在 1.7~1.9，但枪管只有 1.0，
统一取 1.15，否则细枪管会被描边吃掉）。
"""
import numpy as np, os, json
from PIL import Image

WORK = os.environ.get('BAKE_WORK', '/tmp/bl')
META = json.load(open(os.path.join(WORK, 'platform.json')))
SS = META.get('ss', 4)
HEADINGS = META.get('headings', 48)
TT = META.get('tt', 1.38)
PLATFORM_H = META.get('baseH', META.get('platformH'))

BASE_CV, TOP_CV = 96, 192
OUTLINE_BASE = 1.70
OUTLINE_TOP = 1.65
SRC = os.path.join(WORK, 'out')
DST = os.path.join(WORK, 'final')
INK = np.array([0.075, 0.095, 0.072], np.float32)   # ≈ #131815，和 art.js 的 INK 同色系
os.makedirs(DST, exist_ok=True)

# art.js 的基座常量
CY_TOP = 35.0 * 0.39 * 0.28          # 3.822
GROUND_Y = CY_TOP + 35.0 * 0.26      # 12.922
COS_T = (1.0 - 0.46 ** 2) ** 0.5


def dilate(mask, r):
    m = mask.copy()
    for _ in range(r):
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    m[:1, :] = False
    m[-1:, :] = False
    m[:, :1] = False
    m[:, -1:] = False
    return m


def process(path, target, outline, keep_dir=None, keep_name=None):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(np.float32) / 255.0
    alpha = a[..., 3]
    solid = alpha > 0.5
    ring = dilate(solid, int(round(outline * SS))) & ~solid
    out_a = np.where(ring, 1.0, alpha)
    rgb = np.where(solid[..., None], a[..., :3], INK)

    pm = rgb * out_a[..., None]
    h = a.shape[0]
    pm = pm.reshape(h // SS, SS, h // SS, SS, 3).mean(axis=(1, 3))
    al = out_a.reshape(h // SS, SS, h // SS, SS).mean(axis=(1, 3))
    rgb1 = np.divide(pm, np.maximum(al, 1e-6)[..., None])

    out = np.concatenate([np.clip(rgb1, 0, 1), np.clip(al, 0, 1)[..., None]], axis=2)
    img = Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')
    assert img.size == (target, target), (img.size, target)
    if keep_dir:
        img.save(os.path.join(keep_dir, keep_name))
    return img


# ---- 基座 ----
base = process(os.path.join(SRC, 'base.png'), BASE_CV, OUTLINE_BASE, DST, 'base.png')

# ---- 炮体各朝向 ----
tops = []
for i in range(HEADINGS):
    tops.append(process(os.path.join(SRC, 'top_%03d.png' % i), TOP_CV, OUTLINE_TOP))

# ---- 拼图集：8 列 × 6 行 ----
cols, rows = 8, 6
sheet = Image.new('RGBA', (cols * TOP_CV, rows * TOP_CV), (0, 0, 0, 0))
for i, im in enumerate(tops):
    sheet.paste(im, ((i % cols) * TOP_CV, (i // cols) * TOP_CV), im)
sheet.save(os.path.join(DST, 'top_sheet.png'))

# 炮体画布原点(84,124) = 模型 z=0 = 基座台面中心 → 相对塔中心就是 CY_TOP
PLATFORM_Y = round(CY_TOP, 3)

json.dump({
    'headings': HEADINGS, 'cols': cols, 'rows': rows,
    'cell': TOP_CV, 'originX': 84, 'originY': 124,
    'baseCell': BASE_CV, 'baseOriginX': 48, 'baseOriginY': 48,
    'groundY': GROUND_Y,          # 基座画布原点(48,48) 落在塔中心下方这么多 px
    'platformY': PLATFORM_Y,      # 炮体画布原点(84,124) 落在塔中心下方这么多 px
    'tt': TT,
    'outlineBase': OUTLINE_BASE, 'outlineTop': OUTLINE_TOP,
}, open(os.path.join(DST, 'meta.json'), 'w'), indent=1)

# ---- 报告 ----
for nm, im in (('base', base), ('top_sheet', sheet)):
    a = np.asarray(im)
    print('%-10s %s  alpha>0: %d' % (nm, im.size, int((a[..., 3] > 8).sum())))
a = np.asarray(tops[0])
ys, xs = np.nonzero(a[..., 3] > 8)
print('top[0] bbox x %d..%d  y %d..%d   (origin 84,124)' % (xs.min(), xs.max(), ys.min(), ys.max()))
print('groundY=%.3f  platformY=%.3f  (期望 12.922 / 3.822)' % (GROUND_Y, PLATFORM_Y))
print('DST =', DST)
