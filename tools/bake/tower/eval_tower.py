# -*- coding: utf-8 -*-
"""eval_tower.py —— 把烤出来的塔和设计稿用同一组指标比，并打印字符图。"""
import os
import sys
import numpy as np
from PIL import Image

REPO = '/Users/yong/WorkBuddy AI/2026-10-04-11-20-54'
DST = os.path.join(REPO, 'fieldrunners/tools/bake/tower/out/tower_final')
REF = os.path.join(REPO, 'fieldrunners/assets/sprites')

BUCKETS = [(0, 48, 'outline'), (48, 80, 'dark'), (80, 115, 'mid'),
           (115, 165, 'lit'), (165, 999, 'hi')]


def hist(im):
    a = np.asarray(im.convert('RGBA')).astype(np.float32)
    keep = a[..., 3] > 200
    if keep.sum() == 0:
        return None
    rgb = a[..., :3][keep]
    L = rgb @ np.array([0.299, 0.587, 0.114])
    n = len(L)
    out = {}
    for lo, hi, name in BUCKETS:
        out[name] = round(float(((L >= lo) & (L < hi)).sum()) * 100 / n, 1)
    out['_n'] = n
    out['_L'] = round(float(L.mean()), 1)
    return out


def extract(atlas_path, meta_cell, ox, oy, lv, b, cols, headings):
    im = Image.open(atlas_path).convert('RGBA')
    per = headings // cols
    idx = lv * per + b // cols
    c = b % cols
    cw, ch = meta_cell
    return im.crop((c * cw, idx * ch, (c + 1) * cw, (idx + 1) * ch))


def trim(im):
    a = np.asarray(im)
    ys, xs = np.nonzero(a[..., 3] > 12)
    if len(xs) == 0:
        return im
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


import json
import re

KEYS = ['gatling', 'mortar', 'missile', 'tesla', 'flame', 'goo']
print('%-9s %-8s %7s %7s %7s %7s %7s %7s' %
      ('tower', 'src', 'outline', 'dark', 'mid', 'lit', 'hi', 'L'))
print('-' * 68)
for key in KEYS:
    js = open(os.path.join(REPO, 'fieldrunners/js/bake-tower-%s.js' % key)).read()
    m = re.search(r'meta:\s*(\{.*?\})\s*,?\n', js, re.S)
    meta = json.loads(m.group(1))
    cell = (meta['cellW'], meta['cellH'])
    atlas = os.path.join(DST, '%s_atlas.png' % key)

    ref = trim(Image.open(os.path.join(REF, '%s_t_lvl1.png' % key)))
    h = hist(ref)
    print('%-9s %-8s %7.1f %7.1f %7.1f %7.1f %7.1f %7.1f' %
          (key, 'sheet', h['outline'], h['dark'], h['mid'], h['lit'], h['hi'], h['_L']))
    for b in (0, 12):
        im = trim(extract(atlas, cell, meta['ox'], meta['oy'], 0, b,
                          meta['cols'], meta['headings']))
        h2 = hist(im)
        print('%-9s %-8s %7.1f %7.1f %7.1f %7.1f %7.1f %7.1f' %
              ('', 'mine b%d' % b, h2['outline'], h2['dark'], h2['mid'],
               h2['lit'], h2['hi'], h2['_L']))
    print()
