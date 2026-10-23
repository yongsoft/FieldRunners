# -*- coding: utf-8 -*-
"""
calibrate_enemy.py —— 用设计稿的统计指标反解 pack_enemy.py 的参数。

做法：跑不同参数 → 解出图集里 infantry/runner 的格子 → 归一化到 200px 高 →
与 assets/sprites/jeep_e_g1.png / moto_e_g1.png 的同一组指标比距离。

指标含义（与 compare.py 一致）：
  colors 色彩丰富度 / edge 结构密度 / ink 描边占比 / sat 饱和度 / lum_sd 明暗层次
"""
import itertools
import json
import os
import subprocess
import sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT_JS = '/tmp/bl/calib/enemy-data.js'
os.makedirs('/tmp/bl/calib', exist_ok=True)

REFS = {'infantry': os.path.join(REPO, 'assets/sprites/jeep_e_g1.png'),
        'runner': os.path.join(REPO, 'assets/sprites/moto_e_g1.png')}


def trim_to_h(im, H=200):
    a = np.asarray(im.convert('RGBA'))
    ys, xs = np.nonzero(a[..., 3] > 12)
    if len(xs) == 0:
        return None
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    w = max(1, int(round(im.width * H / im.height)))
    return im.resize((w, H), Image.LANCZOS)


def metrics(im):
    if im is None:
        return None
    a = np.asarray(im).astype(np.float32)
    rgb = a[..., :3]
    al = a[..., 3] / 255.0
    solid = al > 0.5
    n = int(solid.sum())
    if n == 0:
        return None
    q = (rgb[solid] // 8).astype(np.int32)
    colors = len(np.unique(q[:, 0] * 1024 + q[:, 1] * 32 + q[:, 2]))

    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32) * al
    gx = np.zeros_like(lum); gy = np.zeros_like(lum)
    gx[:, 1:-1] = lum[:, 2:] - lum[:, :-2]
    gy[1:-1, :] = lum[2:, :] - lum[:-2, :]
    edge = float((np.hypot(gx, gy) > 24).sum()) / n

    vals = rgb[solid]
    l = vals @ np.array([0.299, 0.587, 0.114], np.float32)
    mx = vals.max(axis=1); mn = vals.min(axis=1)
    sat = float(((mx - mn) / np.maximum(mx, 1e-3)).mean())
    return {'colors': colors, 'edge': edge * 100,
            'ink': float((l < 40).mean() * 100),
            'sat': sat, 'lum_sd': float(l.std()),
            'lum_mean': float(l.mean())}


def extract_cell(atlas_png, kind, b, meta):
    im = Image.open(atlas_png).convert('RGBA')
    off = meta['kindOffset'][kind]
    idx = off + b
    cw, ch = meta['cellW'], meta['cellH']
    c = idx % meta['cols']; r = idx // meta['cols']
    return im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))


def parse_meta(js):
    """BAKE_ENEMY_META 是 JS 对象字面量（键不带引号、末尾有逗号），
    不是 JSON，所以按字段逐个抽。"""
    blk = js.split('const BAKE_ENEMY_META = ')[1].split('};')[0]
    def num(key):
        import re
        return int(re.search(key + r':\s*(\d+)', blk).group(1))
    import re
    ko = {m.group(1): int(m.group(2)) for m in
          re.finditer(r'"(\w+)":\s*(\d+)', blk.split('kindOffset:')[1])}
    return {'cols': num('cols'), 'rows': num('rows'),
            'cellW': num('cellW'), 'cellH': num('cellH'),
            'kindOffset': ko}


def run(outline, sat, lift, quant):
    env = dict(os.environ)
    env.update(PK_OUTLINE=str(outline), PK_SAT=str(sat),
               PK_LIFT=str(lift), PK_QUANT=str(quant), PK_OUT_JS=OUT_JS)
    p = subprocess.run([sys.executable, os.path.join(HERE, 'pack_enemy.py')],
                       env=env, capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stdout[-800:], p.stderr[-800:])
        raise SystemExit('pack failed')
    js = open(OUT_JS).read()
    meta = parse_meta(js)
    atlas = os.path.join(HERE, 'out', 'enemy_final', 'enemy_atlas.png')
    return meta, atlas


REFS_M = {k: metrics(trim_to_h(Image.open(v))) for k, v in REFS.items()}
print('设计稿指标:')
for k, m in REFS_M.items():
    print('  %-9s colors=%4d edge=%5.1f ink=%5.1f sat=%.3f sd=%5.1f' %
          (k, m['colors'], m['edge'], m['ink'], m['sat'], m['lum_sd']))

GRID = list(itertools.product([1.2, 1.6, 2.0], [1.2, 1.5], [0.0], [128]))
print('\n%-22s %s' % ('params', 'distance / 指标'))
best = None
for outline, sat, lift, quant in GRID:
    meta, atlas = run(outline, sat, lift, quant)
    row = []
    d = 0.0
    for kind in ('infantry', 'runner'):
        m = metrics(trim_to_h(extract_cell(atlas, kind, 0, meta)))
        if m is None:
            d = 9e9; break
        ref = REFS_M[kind]
        # 归一化距离：每项按设计稿值归一，权重按「越能代表丑」给
        dd = (abs(m['colors'] - ref['colors']) / ref['colors'] * 1.0 +
              abs(m['edge'] - ref['edge']) / ref['edge'] * 1.2 +
              abs(m['ink'] - ref['ink']) / ref['ink'] * 1.5 +
              abs(m['sat'] - ref['sat']) / ref['sat'] * 2.0 +
              abs(m['lum_sd'] - ref['lum_sd']) / ref['lum_sd'] * 1.0)
        d += dd
        row.append('%s c=%4d e=%5.1f ink=%4.1f s=%.2f sd=%4.1f' %
                   (kind[:3], m['colors'], m['edge'], m['ink'], m['sat'], m['lum_sd']))
    tag = 'out=%.1f sat=%.2f' % (outline, sat)
    print('%-22s d=%6.3f  %s' % (tag, d, ' | '.join(row)))
    if best is None or d < best[0]:
        best = (d, outline, sat, lift, quant)

print('\nBEST', best)
