# -*- coding: utf-8 -*-
"""
run.py —— 把 6 座塔 × 3 级 × 48 朝向烘成序列帧。

用法：
    blender --background --python run.py -- [--only gatling] [--lv 0] [--headings 48]

投影（与 art.js 严格一致）：
    GROUND_K = 0.46 = sin(俯角) → θ = 27.386°
    屏幕 x   = 世界 X
    屏幕 y向上 = 世界 Y·sinθ + 世界 Z·cosθ
    相机在 (0, -D·cosθ, +D·sinθ)，正交。

画布：384×384（= 游戏里 192 逻辑像素的 2 倍采样），
      模型原点（台面中心）落在这张图的 (168, 248)。
      与 art.js 的关系：drawImage(384 图 → 192 逻辑框) 即 2x 超采样。
"""
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import lib  # noqa: E402
import models  # noqa: E402

WORK = os.environ.get('BAKE_WORK', os.path.join(HERE, 'out'))
os.makedirs(WORK, exist_ok=True)

GROUND_K = 0.46
THETA = math.asin(GROUND_K)
SIN_T, COS_T = GROUND_K, math.cos(THETA)

RES = 384                     # 渲染分辨率（逻辑 192 的 2 倍）
S = RES / 192.0 * 1.38        # 每世界单位多少像素（= TT * 2）
OX, OY = 84 * 2, 124 * 2      # 模型原点在这张 384 图上的像素位置
HEADINGS = 48
SS = 2                        # 已含在上面：384 = 192*2

# ---- 参数
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = None
LV_ONLY = None
for i, a in enumerate(argv):
    if a == '--only':
        ONLY = argv[i + 1]
    elif a == '--lv':
        LV_ONLY = int(argv[i + 1])
    elif a == '--headings':
        HEADINGS = int(argv[i + 1])


def aim_camera(target, ortho_scale):
    """正交相机：目标点必然落在画面正中。"""
    D = 900.0
    cam = bpy.context.scene.camera
    cam.location = (target[0], target[1] - D * COS_T, target[2] + D * SIN_T)
    d = Vector(target) - Vector(cam.location)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = ortho_scale


def target_for_origin_pixel(px, py, res):
    """求「让世界原点落在像素 (px,py)」所需的相机瞄准点。

    px = res/2 - t.x*S        → t.x = (res/2 - px)/S
    py = res/2 + sy_t*S       → sy_t = (py - res/2)/S，且 sy_t = t.z*cosθ
    """
    tx = (res / 2.0 - px) / S
    tz = (py - res / 2.0) / S / COS_T
    return (tx, 0.0, tz)


# ---------------------------------------------------------------- 基座
def build_base():
    """台面：设计稿实测「卡其面 #9a9a6a + 暗石墙 + 深色压边」，不是灰。"""
    from lib import part_material, box, cyl
    parts = []
    m_top = part_material('p_top', models.PLATFORM_TOP)
    m_wall = part_material('p_wall', models.PLATFORM_WALL)
    m_rim = part_material('p_rim', models.PLATFORM_RIM)
    m_br = part_material('p_brass', '#b89440')
    RX = 35.0
    H = 9.9
    parts.append(cyl('wall', RX, H - 0.9, (0, 0, (H - 0.9) / 2), verts=48,
                     mat=m_wall))
    parts.append(cyl('plate', RX - 2.2, 1.0, (0, 0, H - 0.5), verts=48,
                     mat=m_top, bevel=0.3))
    # 外沿压边
    parts.append(cyl('rim', RX + 0.3, 1.5, (0, 0, H - 1.15), verts=48,
                     mat=m_rim))
    # 底部黄铜箍
    parts.append(cyl('band', RX + 0.4, 1.7, (0, 0, 1.3), verts=48, mat=m_br))
    # 台面分割线：12 道浅槽
    for i in range(12):
        a = i / 12.0 * math.tau
        parts.append(box('seg%d' % i, (RX - 3.0) * 0.92, 0.9, 0.5,
                         (math.cos(a) * (RX - 2.2) / 2, math.sin(a) * (RX - 2.2) / 2,
                          H + 0.05),
                         rot=(0, 0, a), mat=m_rim, bevel=0.15))
    # 一圈螺栓
    for i in range(16):
        a = i / 16.0 * math.tau
        parts.append(cyl('pb%d' % i, 1.0, 0.7,
                         (math.cos(a) * (RX - 4.2), math.sin(a) * (RX - 4.2), H + 0.2),
                         verts=8, mat=m_br))
    return parts


# ---------------------------------------------------------------- 主流程
scene = lib.reset_scene()
scene.render.resolution_x = RES
scene.render.resolution_y = RES

bpy.ops.object.camera_add()
cam = bpy.context.object
cam.data.type = 'ORTHO'
cam.data.clip_end = 5000
scene.camera = cam

target = target_for_origin_pixel(OX, OY, RES)
aim_camera(target, RES / S)

# ---- 基座（只一张，不转）
if ONLY is None:
    bparts = build_base()
    t0 = time.time()
    scene.render.filepath = os.path.join(WORK, 'base.png')
    bpy.ops.render.render(write_still=True)
    print('[bake] base %.1fs' % (time.time() - t0))

# ---- 逐塔
COMBOS = []
for key in models.BUILDERS:
    for lv in (0, 1, 2):
        COMBOS.append((key, lv))

total0 = time.time()
for key, lv in COMBOS:
    if ONLY and key != ONLY:
        continue
    if LV_ONLY is not None and lv != LV_ONLY:
        continue
    outdir = os.path.join(WORK, 'tower', '%s_lv%d' % (key, lv))
    os.makedirs(outdir, exist_ok=True)

    # 清掉上一轮
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)

    parts = models.build(key, lv)
    root = bpy.data.objects.new('root', None)
    scene.collection.objects.link(root)
    for p in parts:
        p.o.parent = root
        p.o.matrix_parent_inverse = root.matrix_world.inverted()

    t0 = time.time()
    for i in range(HEADINGS):
        root.rotation_euler = (0, 0, -i / HEADINGS * math.tau)
        bpy.context.view_layer.update()
        scene.render.filepath = os.path.join(outdir, 'h%03d.png' % i)
        bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    print('[bake] %-8s lv%d  parts=%2d  %d headings  %.1fs'
          % (key, lv + 1, len(parts), HEADINGS, dt))

    # 记录包围盒，供打包时确定原点
    bb = []
    for p in parts:
        bb += [p.o.matrix_world @ Vector(c) for c in p.o.bound_box]
    xs = [p.x for p in bb]; ys = [p.y for p in bb]; zs = [p.z for p in bb]
    json.dump(dict(key=key, lv=lv, parts=len(parts), headings=HEADINGS,
                   res=RES, scale=S, ox=OX, oy=OY,
                   bbox=dict(x=[min(xs), max(xs)], y=[min(ys), max(ys)],
                             z=[min(zs), max(zs)])),
              open(os.path.join(outdir, 'meta.json'), 'w'), indent=1)

print('[bake] all done %.1fs  -> %s' % (time.time() - total0, WORK))
