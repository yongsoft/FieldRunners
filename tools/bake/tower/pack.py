# -*- coding: utf-8 -*-
"""
pack.py —— 炮塔序列帧 → 描边 → 降采样 → 图集 → base64 JS

关键决策（对着设计稿的数字定的）：
1. **描边**：设计稿近黑占 26~36%。用「膨胀剪影 + 只填外环」而不是给每个面描边，
   否则内部接缝全变黑线（敌人那边踩过这个坑）。
2. **降采样到 1x**：384 渲染 → 192 逻辑画布。设计稿画在 150px 上，
   而游戏里塔只有 ~62px，1x 已是实际所需；2x 只是为了让边缘抗锯齿更好。
3. **逐塔一个 JS**：6 个文件可以并行加载，主 HTML 不被单文件拖住。
4. **所有朝向共用一个裁剪框**：逐帧裁剪会让塔在转向时「呼吸」。

输出：
    js/bake-tower-<key>.js   { atlas: base64, meta }
"""
import base64
import io
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('BAKE_WORK', os.path.join(HERE, 'out'))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
DST = os.path.join(WORK, 'tower_final')
os.makedirs(DST, exist_ok=True)

KEYS = ['gatling', 'mortar', 'missile', 'tesla', 'flame', 'goo']
LEVELS = 3
HEADINGS = 48
RES = 384          # 渲染分辨率
OUT_RES = 192      # 画布等效分辨率（1x）
K = OUT_RES / RES  # 0.5

# 描边（在 384 上做，值大一点；缩一半后落到 1x 是 ~1.1px）
OUTLINE = float(os.environ.get('TW_OUTLINE', '4.4'))
OUTLINE_A = 0.30
INK = np.array([0.075, 0.088, 0.055], np.float32)   # 设计稿描边 #191e11

QUANT = int(os.environ.get('TW_QUANT', '112'))
PAD = 2


def dilate(m, r):
    o = m.copy()
    for _ in range(r):
        o = (o | np.roll(o, 1, 0) | np.roll(o, -1, 0)
             | np.roll(o, 1, 1) | np.roll(o, -1, 1))
        o[:1, :] = False
        o[-1:, :] = False
        o[:, :1] = False
        o[:, -1:] = False
    return o


def pre_resize(arr, size):
    """预乘 alpha 缩放，避免透明区的黑色渗进边缘。"""
    pm = arr.copy()
    pm[..., :3] *= pm[..., 3:4]
    ch = []
    for i in range(4):
        im = Image.fromarray(pm[..., i].astype(np.float32), 'F')
        ch.append(np.asarray(im.resize(size, Image.LANCZOS), dtype=np.float32))
    out = np.stack(ch, -1)
    al = np.clip(out[..., 3], 0, 1)
    rgb = out[..., :3] / np.maximum(al[..., None], 1e-5)
    return np.concatenate([np.clip(rgb, 0, 1), al[..., None]], -1)


# 5 阶的目标亮度（取自设计稿实测的 5 个平涂色的 L 值）
BAND_L = np.array([0.20, 0.32, 0.39, 0.60, 0.84], np.float32)
# 5 阶的目标占比（累计分位）。设计稿表面（去掉描边）大致是
# 暗 30% / 主色 26% / 次色 20% / 受光 13% / 高光 11%。
# 用「分位数归一」而不是固定阈值：圆柱体和方块体的受光面积差很多，
# 固定阈值会让火焰塔（大圆罐）52% 掉进暗部、而机枪塔只有 25%。
BAND_Q = np.array([0.28, 0.53, 0.72, 0.83, 1.00], np.float32)


def posterize(a):
    """按亮度分层平涂（保留色相），分位归一。

    为什么要这一步：真实光照才有零件之间的投影/缝隙遮蔽（设计稿暗部的来源），
    但真实光照是连续渐变，不像手绘的硬边色块。
    这里把亮度的分位数切成 5 段、每段吸附到一个固定的目标亮度，
    既保住遮蔽关系，又得到 5 色平涂 —— 而且每座塔的明暗结构一致。
    """
    rgb = a[..., :3]
    al = a[..., 3]
    L = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    solid = al > 0.5
    out = a.copy()
    if solid.sum() < 32:
        return out
    qs = np.quantile(L[solid], BAND_Q)
    # 每段 → 目标亮度
    idx = np.zeros_like(L, dtype=np.int32)
    for i in range(len(qs) - 1):
        idx[L > qs[i]] = i + 1
    newL = BAND_L[np.clip(idx, 0, len(BAND_L) - 1)]
    scale = newL / np.maximum(L, 1e-3)
    # 只动实心像素，边缘保持原样（避免半透明边被拉出黑圈）
    edge = solid
    out[..., :3][edge] = np.clip(rgb[edge] * scale[edge, None], 0, 1)
    return out


def process(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(np.float32) / 255.0
    a = posterize(a)
    mask = a[..., 3] > OUTLINE_A
    ring = dilate(mask, int(round(OUTLINE))) & ~mask
    a[ring, :3] = INK
    a[ring, 3] = 1.0
    return pre_resize(a, (OUT_RES, OUT_RES))


def b64(im, colors=QUANT):
    buf = io.BytesIO()
    if colors:
        im = im.quantize(colors=colors, method=Image.FASTOCTREE, dither=Image.NONE)
    im.save(buf, 'PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode('ascii')


# ---------------------------------------------------------------- 先算出共用裁剪框
stats = {}
for key in KEYS:
    x0 = y0 = 10 ** 9
    x1 = y1 = -10 ** 9
    for lv in range(LEVELS):
        for h in range(HEADINGS):
            p = os.path.join(WORK, 'tower', '%s_lv%d' % (key, lv), 'h%03d.png' % h)
            im = process(p)
            m = im[..., 3] > 0.12
            ys, xs = np.nonzero(m)
            if len(xs) == 0:
                continue
            x0 = min(x0, xs.min()); x1 = max(x1, xs.max())
            y0 = min(y0, ys.min()); y1 = max(y1, ys.max())
    stats[key] = (int(x0), int(y0), int(x1), int(y1))
    print('%-8s content bbox x %3d..%3d  y %3d..%3d  (%dx%d)'
          % (key, x0, x1, y0, y1, x1 - x0 + 1, y1 - y0 + 1))

CW = max(v[2] - v[0] + 1 for v in stats.values()) + PAD * 2
CH = max(v[3] - v[1] + 1 for v in stats.values()) + PAD * 2
CW += CW % 2
CH += CH % 2
print('cell %dx%d' % (CW, CH))

COLS = 8
ROWS = (HEADINGS // COLS) * LEVELS

for key in KEYS:
    bx0, by0, _, _ = stats[key]
    # 原点像素：游戏里塔的「台面中心」在 (84,124) 的 1x 画布上
    ox = int(84 - (bx0 - PAD))
    oy = int(124 - (by0 - PAD))
    atlas = Image.new('RGBA', (COLS * CW, ROWS * CH), (0, 0, 0, 0))
    for lv in range(LEVELS):
        for h in range(HEADINGS):
            p = os.path.join(WORK, 'tower', '%s_lv%d' % (key, lv), 'h%03d.png' % h)
            im = process(p)
            cell = np.zeros((CH, CW, 4), np.float32)
            src = im[max(0, by0 - PAD):by0 - PAD + CH, max(0, bx0 - PAD):bx0 - PAD + CW]
            cell[:src.shape[0], :src.shape[1]] = src
            u8 = (np.clip(cell, 0, 1) * 255 + 0.5).astype(np.uint8)
            r = lv * (HEADINGS // COLS) + h // COLS
            c = h % COLS
            atlas.paste(Image.fromarray(u8, 'RGBA'), (c * CW, r * CH))

    atlas.save(os.path.join(DST, '%s_atlas.png' % key))

    js = []
    js.append('/* bake-tower-%s.js —— Blender 3D 烘焙炮塔（自动生成，勿手改）' % key)
    js.append('   6 塔 × 3 级 × %d 朝向，正交 27.386°，赛璐璐 4 档' % HEADINGS)
    js.append('   生成：tools/bake/tower/run.py + pack.py */')
    js.append('window.BAKE_TOWER = window.BAKE_TOWER || {};')
    js.append('window.BAKE_TOWER["%s"] = {' % key)
    js.append('  atlas: "data:image/png;base64,%s",' % b64(atlas))
    js.append('  meta: %s' % json.dumps(dict(
        key=key, levels=LEVELS, headings=HEADINGS, cols=COLS,
        cellW=CW, cellH=CH, ox=ox, oy=oy, canvas=OUT_RES)))
    js.append('};')
    out = os.path.join(REPO, 'js', 'bake-tower-%s.js' % key)
    open(out, 'w').write('\n'.join(js) + '\n')
    print('  wrote %s  %dKB' % (os.path.basename(out), os.path.getsize(out) // 1024))

# 预览：把一行的 8 个朝向放大贴到草地上，肉眼/字符图都好看
for key in KEYS[:1]:
    a = Image.open(os.path.join(DST, '%s_atlas.png' % key)).convert('RGBA')
    prev = Image.new('RGBA', (COLS * CW * 3, (HEADINGS // COLS) * CH * 3), (100, 138, 66, 255))
    prev.alpha_composite(a.resize((a.width * 3, a.height * 3), Image.NEAREST))
    prev.convert('RGB').save(os.path.join(DST, 'preview_%s.png' % key))
print('done')
