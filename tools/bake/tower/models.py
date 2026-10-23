# -*- coding: utf-8 -*-
"""
models.py —— 6 座炮塔的真 3D 模型（逐塔独立配色，取自设计稿实测）

坐标：+X = 炮口方向，+Z = 上，z=0 = 基座台面，相机在 -Y 侧。
每一座都遵循设计稿的通用结构：
    台面 → 方墩（抬高的底座） → 主炮体 → 特征部件（舱盖/弹箱/线圈/喷管/天线）
等级递进必须体现在**轮廓**上（更高、更宽、管/排/环更多），
否则摆在一起分不出谁是谁。

配色来源：assets/sprites/*_t_lvl1.png 的精确取色
（见 tools/bake/tower/README 的分析表）。
"""
import math

from lib import (TAU, bolt_ring, box, barrel, cone, cyl, sph, torus, vent)

# ---------------------------------------------------------------- 逐塔调色板
# body=车体主色 body2=次色 dark=暗部 lit=受光面 hi=高光 accent=点缀
PAL = {
    'gatling': dict(body='#50582b', body2='#5c6256', dark='#303823',
                    lit='#939a66', hi='#cbcb9b', accent='#6f7a4a',
                    glow='#ffd24a', rim='#c94a2e'),
    'mortar': dict(body='#5d6558', body2='#52552c', dark='#313724',
                   lit='#8c916c', hi='#cbcb9c', accent='#4a5138',
                   glow='#ffd24a', rim='#c94a2e'),
    'missile': dict(body='#5b6259', body2='#515030', dark='#2f3728',
                    lit='#8f8f6d', hi='#cbca9f', accent='#36494d',
                    glow='#ff6a3c', rim='#c94a2e'),
    'tesla': dict(body='#254f5f', body2='#546561', dark='#16303a',
                  lit='#749793', hi='#b5d0c5', accent='#97a8a4',
                  glow='#a6e2ef', rim='#7fd4e8'),
    'flame': dict(body='#585a29', body2='#32371a', dark='#2b3018',
                  lit='#979b5e', hi='#cecc9b', accent='#686953',
                  glow='#ff9a2e', rim='#c94a2e'),
    'goo': dict(body='#5b665c', body2='#4c532d', dark='#2f3828',
                lit='#9ba79f', hi='#c5c6a0', accent='#384427',
                glow='#8ef05a', rim='#4c7a2e'),
}

BRASS, BRASSD = '#cfa844', '#8a6d24'
STEEL, STEELD, STEELL = '#6b7378', '#3e464b', '#a8b0b4'
INK = '#1a1e12'

# 共通：基座台面（设计稿实测 D 簇 = #99996a 卡其，不是灰！）
PLATFORM_TOP = '#9a9a6a'
PLATFORM_WALL = '#4d5348'
PLATFORM_RIM = '#3a3f34'


class M:
    """材质工厂：按调色板键名懒加载材质。

    主色（body / body2）走 **4 档平涂**：
        朝下 → dark      侧面 → body      正/背面 → body2      顶面 → lit
    这正好复刻设计稿的「暗部 + 主色 + 次色 + 受光面」四层，
    剩下的第 5 个色（暖奶白 hi）由零件级别的 'hi' 材质补。
    """

    def __init__(self, palette):
        self.p = palette
        self._c = {}

    def __call__(self, key):
        if key in self._c:
            return self._c[key]
        p = self.p
        col = {
            'body': p['body'], 'body2': p['body2'], 'dark': p['dark'],
            'lit': p['lit'], 'hi': p['hi'], 'accent': p['accent'],
            'glow': p['glow'], 'rim': p['rim'],
            'brass': BRASS, 'brassD': BRASSD,
            'steel': STEEL, 'steelD': STEELD, 'steelL': STEELL,
            'ink': INK,
        }[key]
        from lib import part_material
        m = part_material('m_%s_%s_%s' % (p['body'].strip('#'), key,
                                          p['glow'].strip('#') if key == 'glow' else ''),
                          col)
        self._c[key] = m
        return m


# ---------------------------------------------------------------- 共用构件
def pedestal(m, lv, w=19.5, d=23.0, h=8.5, x=-3.0):
    """方墩：所有塔都坐在一块抬高的方块上（设计稿通用结构）。"""
    out = []
    s = 1.0 + 0.06 * lv
    out.append(box('ped', w * s, d * s, h, (x, 0, h / 2), mat=m('body'),
                   bevel=2.2))
    # 墩身上沿的一道压边
    out.append(box('ped_rim', w * s + 1.2, d * s + 1.2, 1.6, (x, 0, h - 0.4),
                   mat=m('dark'), bevel=0.6))
    # 四个角螺栓
    for i in range(4):
        sx = -1 if i % 2 else 1
        sy = -1 if i < 2 else 1
        out.append(cyl('ped_b%d' % i, 1.15, 0.9,
                       (x + sx * (w * s / 2 - 2.2), sy * (d * s / 2 - 2.4), h + 0.2),
                       verts=8, mat=m('brassD')))
    return out


def hull(m, x0, x1, y0, y1, z0, z1, bevel=3.2):
    """主炮体 + 顶盖 + 顶面装甲板 + 高光条。"""
    out = []
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    sx, sy, sz = x1 - x0, y1 - y0, z1 - z0
    out.append(box('hull', sx, sy, sz, (cx, cy, (z0 + z1) / 2), mat=m('body'),
                   bevel=bevel))
    # 顶盖（比主体内缩一点，形成「装甲盖板」层次）
    out.append(box('roof', sx * 0.90, sy * 0.90, 1.7, (cx, cy, z1 + 0.2),
                   mat=m('lit'), bevel=0.7))
    # 顶面中间一块更亮的板
    out.append(box('roof_i', sx * 0.62, sy * 0.62, 0.8, (cx, cy, z1 + 1.3),
                   mat=m('hi'), bevel=0.4))
    # 侧面装甲裙板（左右各一，露出投影层次）
    for sy2 in (-1, 1):
        out.append(box('skirt%d' % (sy2 > 0), sx * 0.72, 1.5, sz * 0.42,
                       (cx - sx * 0.04, sy2 * (sy / 2 + 0.55), z0 + sz * 0.40),
                       mat=m('body2'), bevel=0.7))
    return out


def hazard(m, x, y, z, w, h, n=4):
    """警示条纹：设计稿里在炮口附近，一小段黄黑斜纹。"""
    out = []
    for i in range(n):
        out.append(box('hz%d' % i, w, 1.0, h,
                       (x, y, z + (i - (n - 1) / 2) * 1.6), mat=m('brass'),
                       bevel=0.2))
    return out


# ================================================================ 1. 加特林
def build_gatling(m, lv):
    """加特林：厚方炮体 + 左侧大圆舱盖 + 多管枪簇 + 黄铜弹链。"""
    out = []
    out += pedestal(m, lv)
    BW = 22.5 + 1.6 * lv
    BH = 20.0 + 2.6 * lv
    out += hull(m, -15.0, -15.0 + BW, -BW / 2, BW / 2, 8.5, 8.5 + BH)
    zc = 8.5 + BH * 0.52

    # 左侧大圆舱盖（设计稿最显眼的特征）
    for i, (r, dx, mat) in enumerate([
            (7.6, 0.0, 'steel'), (7.6, 1.4, 'steelL'),
            (4.9, 2.4, 'steelD'), (2.1, 3.1, 'rim')]):
        out.append(cyl('hatch%d' % i, r, 1.6, (-5.4, -(BW / 2 + dx + 0.4), zc),
                       rot=(math.pi / 2, 0, 0), verts=28,
                       mat=m(mat), bevel=0.25))
    out += bolt_ring('hbolt', 8, 5.9, 0.85, 1.3,
                     (-5.4, -(BW / 2 + 3.9), zc), axis='Y', mat=m('brassD'))
    # 舱盖中心红点
    out.append(cyl('hatch_led', 1.15, 1.2, (-5.4, -(BW / 2 + 4.3), zc),
                   rot=(math.pi / 2, 0, 0), verts=14, mat=m('rim')))

    # 顶部红色警示灯
    out.append(cyl('warn', 3.4, 1.7, (-9.5, 0, 8.5 + BH + 0.6), verts=20,
                   mat=m('rim'), bevel=0.3))
    out.append(cyl('warn2', 2.0, 1.4, (-9.5, 0, 8.5 + BH + 1.9), verts=16,
                   mat=m('glow')))
    out += bolt_ring('wbolt', 6, 2.9, 0.6, 0.9, (-9.5, 0, 8.5 + BH + 0.4),
                     axis='Z', mat=m('brassD'))

    # 前段炮座 + 枪管簇
    out.append(box('mount', 6.0, BW * 0.72, BH * 0.66,
                   (-15.0 + BW + 1.6, 0, 8.5 + BH * 0.56),
                   mat=m('body'), bevel=2.4))
    NB = [4, 6, 8][lv]
    RAD = [4.3, 5.4, 6.9][lv]
    EXT = [8.2, 10.2, 12.0][lv]
    WY = 8.5 + BH * 0.56
    U0 = -15.0 + BW + 4.0
    U1 = U0 + EXT
    # 散热套筒（2 级起）
    if lv >= 1:
        out.append(cyl('shroud', RAD + 1.9, EXT * 0.42, (U0 + EXT * 0.22, 0, WY),
                       rot=(0, math.pi / 2, 0), verts=24, mat=m('steelD')))
        out += vent('shv', 5, 0.9, 1.4, RAD + 2.2,
                    (U0 + EXT * 0.10, 0, WY + RAD + 1.6), 1.5, axis='X',
                    mat=m('dark'))
    order = sorted(range(NB), key=lambda i: math.cos(i / NB * TAU))
    for i in order:
        a = i / NB * TAU
        v = math.sin(a) * RAD
        w = WY + math.cos(a) * RAD * 0.94
        # 管身用中灰、炮口用亮钢，中间的轴心用墨黑 ——
        # 三档拉开对比，62px 下才数得清是「几根管」而不是一坨金属
        out += barrel('b%d' % i, U0, U1, v, w, 1.85, 1.65,
                      m('steel'), m('steelL'))
    # 枪管簇中心的轴心
    out.append(cyl('hub', RAD * 0.54, EXT * 0.72, (U0 + EXT * 0.36, 0, WY),
                   rot=(0, math.pi / 2, 0), verts=18, mat=m('ink')))

    # 黄铜弹链：从侧面拱到炮座（设计稿的识别特征）
    for i in range(6):
        t = i / 5.0
        out.append(box('belt%d' % i, 2.0, 2.2, 1.5,
                       (-9.0 + t * 9.0, -(BW / 2 + 0.9),
                        zc - 3.0 + math.sin(t * math.pi) * 2.6),
                       rot=(0, 0, t * 0.3), mat=m('brass'), bevel=0.3))
    # 前脸指示灯
    out.append(cyl('eye', 2.5, 1.5, (-15.0 + BW + 4.6, 0, 8.5 + BH * 0.18),
                   rot=(0, math.pi / 2, 0), verts=18, mat=m('glow')))
    # 天线
    out.append(cyl('mast', 0.65, 7.5, (-13.6, BW / 2 - 2.0, 8.5 + BH + 3.2),
                   verts=8, mat=m('steelD')))
    out.append(sph('tip', 1.25, (-13.6, BW / 2 - 2.0, 8.5 + BH + 7.2),
                   mat=m('glow'), seg=12, ring=8))
    return out


# ================================================================ 2. 迫击炮
def build_mortar(m, lv):
    """迫击炮：大圆盘底座 + 粗长炮管上仰 + 红箍 + 液压杆。"""
    out = []
    out += pedestal(m, lv, w=18.0, d=20.0)
    # 回转盘（大圆盘，设计稿最显眼）
    R = 11.5 + 1.2 * lv
    out.append(cyl('turn', R, 3.0, (-2.0, 0, 10.0), verts=32, mat=m('body2'),
                   bevel=0.4))
    out.append(cyl('turn2', R * 0.82, 1.4, (-2.0, 0, 12.0), verts=32,
                   mat=m('lit'), bevel=0.3))
    out += bolt_ring('tbolt', 10, R * 0.88, 0.8, 1.0, (-2.0, 0, 12.4),
                     axis='Z', mat=m('brassD'))
    # 炮架
    out.append(box('cradle', 14.0, 13.0, 7.0, (-2.0, 0, 15.0), mat=m('body'),
                   bevel=2.0))
    # 炮管：上仰 26°，越长越粗
    L = 20.0 + 3.0 * lv
    R0 = 3.4 + 0.4 * lv
    ang = math.radians(26)
    cx = -2.0
    cz = 16.5
    midx = cx + math.cos(ang) * L / 2
    midz = cz + math.sin(ang) * L / 2
    out.append(cone('tube', R0 * 1.25, R0, L, (midx, 0, midz),
                    rot=(0, math.pi / 2 - ang, 0), mat=m('steelD'), verts=20))
    # 红箍（近距离）
    for i, t in enumerate((0.30, 0.44)):
        out.append(cyl('band%d' % i, R0 * 1.18, 1.5,
                       (cx + math.cos(ang) * L * t, 0, cz + math.sin(ang) * L * t),
                       rot=(0, math.pi / 2 - ang, 0), verts=20, mat=m('rim')))
    # 炮口帽 + 内膛
    mx = cx + math.cos(ang) * L
    mz = cz + math.sin(ang) * L
    out.append(cyl('muzzle', R0 * 1.22, 2.2, (mx, 0, mz),
                   rot=(0, math.pi / 2 - ang, 0), verts=20, mat=m('steel')))
    out.append(cyl('bore', R0 * 0.72, 1.4, (mx + 0.6, 0, mz + 0.3),
                   rot=(0, math.pi / 2 - ang, 0), verts=18, mat=m('ink')))
    # 液压杆（两侧）
    for sy in (-1, 1):
        out.append(cyl('hyd%d' % (sy > 0), 1.3, 8.0,
                       (-6.5, sy * 6.4, 14.0), rot=(0, math.radians(58), 0),
                       verts=12, mat=m('steelL')))
        out.append(cyl('hydc%d' % (sy > 0), 1.9, 9.0,
                       (-8.6, sy * 6.4, 12.4), rot=(0, math.radians(58), 0),
                       verts=12, mat=m('body2')))
    # 弹盘（左侧）
    out.append(cyl('mag', 5.2, 3.4, (-2.0, -11.0, 14.4),
                   rot=(math.pi / 2, 0, 0), verts=24, mat=m('accent')))
    out += bolt_ring('mbolt', 6, 3.9, 0.7, 0.9, (-2.0, -12.9, 14.4),
                     axis='Y', mat=m('brassD'))
    # 3 级：加装侧装甲板 + 观瞄
    if lv >= 2:
        out.append(box('armor', 12.0, 1.6, 8.0, (-4.0, 8.2, 13.0),
                       mat=m('body'), bevel=0.8))
        out.append(cyl('scope', 2.0, 5.0, (-1.0, 7.0, 20.0),
                       rot=(0, math.radians(70), 0), verts=16, mat=m('steelD')))
        out.append(cyl('scopeg', 1.5, 1.0, (1.0, 7.0, 22.2),
                       rot=(0, math.radians(70), 0), verts=14, mat=m('glow')))
    return out


# ================================================================ 3. 导弹
def build_missile(m, lv):
    """导弹：左右两台并列倾斜发射箱 + 弹体 + 雷达盘。"""
    out = []
    out += pedestal(m, lv, w=18.0, d=22.0)
    out += hull(m, -14.0, -1.0, -10.5, 10.5, 8.5, 8.5 + 15.0 + 2.2 * lv,
                bevel=2.4)
    z0 = 8.5 + 15.0 + 2.2 * lv
    # 摇架
    out.append(box('gimbal', 7.0, 8.0, 5.0, (-6.0, 0, z0 + 2.0), mat=m('body2'),
                   bevel=1.4))
    ROWS = [2, 3, 4][lv]
    PIT = 0.30
    U0, U1 = 0.0, 17.0
    W0 = z0 + 3.4
    WH = 2.4 + ROWS * 2.9
    for si, (vA, vB) in enumerate([(-11.6, -1.7), (1.7, 11.6)]):
        wA1 = W0 + (U1 - U0) * PIT
        # 底板
        out.append(box('box%d_floor' % si, U1 - U0, vB - vA, 1.2,
                       ((U0 + U1) / 2, (vA + vB) / 2, W0 + (U1 - U0) * PIT / 2),
                       rot=(0, -PIT, 0), mat=m('dark'), bevel=0.4))
        # 两侧壁
        for sv in (-1, 1):
            vv = vA if sv < 0 else vB
            out.append(box('box%d_w%d' % (si, sv > 0), U1 - U0, 1.5, WH,
                           ((U0 + U1) / 2, vv, W0 + WH / 2 + (U1 - U0) * PIT / 2),
                           rot=(0, -PIT, 0),
                           mat=m('body') if sv < 0 else m('body2'), bevel=0.5))
        # 后壁
        out.append(box('box%d_back' % si, 1.5, vB - vA, WH,
                       (U0, (vA + vB) / 2, W0 + WH / 2), mat=m('dark'),
                       bevel=0.4))
        # 弹体：ROWS 排 × 3 发
        for r in range(ROWS):
            wb = W0 + 1.6 + r * 2.9
            for i in range(3):
                vp = vA + (vB - vA) * (i + 0.5) / 3
                uu0, uu1 = U0 + 2.2, U1 + 2.6
                wa = wb + (uu0 - U0) * PIT
                wc = wb + (uu1 - U0) * PIT
                out.append(cyl('msl%d_%d_%d' % (si, r, i), 1.75, uu1 - uu0 - 3.4,
                               ((uu0 + uu1) / 2 - 1.2, vp, (wa + wc) / 2),
                               rot=(0, math.pi / 2 - PIT * 0.9, 0),
                               verts=14, mat=m('lit')))
                out.append(cone('nose%d_%d_%d' % (si, r, i), 1.62, 0.35, 3.6,
                                (uu1 - 1.9, vp, wc - 0.4),
                                rot=(0, math.pi / 2 - PIT * 0.9, 0),
                                verts=14, mat=m('rim')))
    # 外侧钢面板 + 螺栓
    out.append(box('plate', 10.0, 1.3, 6.4, (-1.0, -11.9, z0 + 5.2),
                   mat=m('steelD'), bevel=0.6))
    out += bolt_ring('pbolt', 4, 2.4, 0.9, 0.9, (-1.0, -12.7, z0 + 5.2),
                     axis='Y', mat=m('brassD'))
    # 雷达盘（2 级起，右侧）
    if lv >= 1:
        out.append(cyl('rpost', 0.9, 6.0, (-3.0, 11.2, z0 + 2.0), verts=10,
                       mat=m('steelD')))
        out.append(sph('dish', 5.0, (-3.0, 11.2, z0 + 6.4), mat=m('lit'),
                       seg=20, ring=12, scale=(1.0, 0.30, 1.0)))
        out.append(sph('dishin', 3.6, (-3.0, 11.0, z0 + 6.7), mat=m('steelL'),
                       seg=18, ring=10, scale=(1.0, 0.22, 1.0)))
        out.append(cyl('dishhub', 1.0, 1.6, (-3.0, 11.2, z0 + 7.4), verts=10,
                       mat=m('brass')))
    # 3 级：侧裙装甲 + 观瞄镜
    if lv >= 2:
        out.append(box('skirt2', 11.0, 1.4, 5.0, (6.0, -12.9, z0 + 4.0),
                       mat=m('body'), bevel=0.7))
        out.append(cyl('sight', 2.6, 3.0, (18.0, 0, W0 + 4.0),
                       rot=(0, math.pi / 2, 0), verts=16, mat=m('steelD')))
        out.append(cyl('sightg', 1.8, 1.0, (19.6, 0, W0 + 4.0),
                       rot=(0, math.pi / 2, 0), verts=14, mat=m('glow')))
    return out


# ================================================================ 4. 电磁
def build_tesla(m, lv):
    """电磁：钢鼓线圈 + 蓝色等离子球 + 环绕电缆。"""
    out = []
    out += pedestal(m, lv, w=18.0, d=18.0)
    R = 9.0 + 1.1 * lv
    # 钢鼓（线圈主体）
    ZH = 17.0 + 3.0 * lv
    out.append(cyl('drum', R, ZH, (-2.0, 0, 8.5 + ZH / 2), verts=32,
                   mat=m('body')))
    # 线圈环：一级 3 圈，逐级 +2
    NR = 3 + 2 * lv
    for i in range(NR):
        z = 10.6 + i * (ZH - 2.4) / max(NR - 1, 1)
        out.append(torus('coil%d' % i, R + 0.5, 1.05, (-2.0, 0, z), maj=32,
                         minr=8, mat=m('steelL' if i % 2 else 'steel')))
        out.append(cyl('coilp%d' % i, R + 0.2, 0.9, (-2.0, 0, z + 0.9),
                       verts=32, mat=m('accent')))
    # 鼓身竖条加强筋
    for i in range(8):
        a = i / 8 * TAU
        out.append(box('rib%d' % i, 1.3, 1.3, ZH * 0.86,
                       (-2.0 + math.cos(a) * (R + 0.1),
                        math.sin(a) * (R + 0.1), 8.5 + ZH / 2),
                       rot=(0, 0, a), mat=m('dark'), bevel=0.3))
    # 顶盖
    out.append(cyl('cap', R * 0.98, 1.8, (-2.0, 0, 8.5 + ZH + 0.6), verts=32,
                   mat=m('body2'), bevel=0.4))
    out += bolt_ring('cbolt', 10, R * 0.82, 0.9, 1.0, (-2.0, 0, 8.5 + ZH + 1.5),
                     axis='Z', mat=m('brassD'))
    # 等离子球（悬浮在一根短柱上）
    BZ = 8.5 + ZH + 6.4
    out.append(cyl('stem', 1.5, 4.0, (-2.0, 0, 8.5 + ZH + 3.1), verts=14,
                   mat=m('steelD')))
    out.append(sph('plasma', 5.4 + 0.5 * lv, (-2.0, 0, BZ), mat=m('glow'),
                   seg=24, ring=16))
    out.append(torus('halo', 6.6 + 0.5 * lv, 0.55, (-2.0, 0, BZ),
                     rot=(math.radians(18), 0, 0), maj=32, minr=6,
                     mat=m('hi')))
    # 环绕电缆：从鼓身绕到球（左右各 3 根）
    for i in range(3):
        a0 = -0.9 + i * 0.9
        out.append(torus('cable%d' % i, R + 1.6, 0.42,
                         (-2.0, 0, 12.0 + i * 4.2),
                         rot=(math.radians(74 + i * 6), 0, a0), maj=26, minr=5,
                         mat=m('steelD')))
    # 3 级：球外套一圈电极爪
    if lv >= 2:
        for i in range(6):
            a = i / 6 * TAU
            out.append(cone('claw%d' % i, 1.1, 0.3, 3.4,
                            (-2.0 + math.cos(a) * 6.9, math.sin(a) * 6.9, BZ + 1.2),
                            rot=(math.sin(a) * 0.5, -math.cos(a) * 0.5, 0),
                            verts=8, mat=m('steelL')))
    return out


# ================================================================ 5. 火焰
def build_flame(m, lv):
    """火焰：燃料罐 + 粗橄榄喷管 + 引火苗。"""
    out = []
    out += pedestal(m, lv, w=19.0, d=20.0)
    # 卧式燃料罐（炮体其实就是一只大罐子）
    RL = 9.2 + 0.9 * lv
    LL = 22.0 + 2.0 * lv
    out.append(cyl('tank', RL, LL, (-4.0, 0, 8.5 + RL + 1.0),
                   rot=(0, math.pi / 2, 0), verts=30, mat=m('body')))
    # 罐两端圆头
    for sx in (-1, 1):
        out.append(sph('tcap%d' % (sx > 0), RL, (-4.0 + sx * LL / 2, 0, 8.5 + RL + 1.0),
                       mat=m('body2'), seg=22, ring=14, scale=(0.55, 1, 1)))
    # 两道箍带
    for i, t in enumerate((-0.28, 0.28)):
        out.append(torus('strap%d' % i, RL + 0.5, 1.0, (-4.0 + t * LL, 0, 8.5 + RL + 1.0),
                         rot=(0, math.pi / 2, 0), maj=28, minr=7, mat=m('dark')))
    # 罐顶装甲板 + 高光
    out.append(box('tankroof', LL * 0.7, RL * 1.3, 1.2, (-4.0, 0, 8.5 + RL * 2 + 1.0),
                   mat=m('lit'), bevel=0.5))
    # 喷管：粗、短、多重环
    U0 = -4.0 + LL / 2 + RL * 0.4
    LN = 9.5 + 2.2 * lv
    RB = 5.0 + 0.5 * lv
    WY = 8.5 + RL + 1.0
    out.append(cone('nozzle', RB * 1.12, RB * 0.86, LN, (U0 + LN / 2, 0, WY),
                    rot=(0, math.pi / 2, 0), verts=24, mat=m('body2')))
    for i in range(3):
        out.append(torus('nring%d' % i, RB * (1.06 - i * 0.03), 0.75,
                         (U0 + LN * (0.18 + i * 0.30), 0, WY),
                         rot=(0, math.pi / 2, 0), maj=24, minr=6, mat=m('dark')))
    # 喷口 + 引火苗
    out.append(cyl('mouth', RB * 0.88, 1.4, (U0 + LN + 0.4, 0, WY),
                   rot=(0, math.pi / 2, 0), verts=24, mat=m('ink')))
    out.append(sph('pilot', 1.6, (U0 + LN + 1.4, 0, WY), mat=m('glow'),
                   seg=14, ring=10, scale=(1.6, 1.0, 0.7)))
    # 增压罐（侧面小圆筒 ×2）
    for sy in (-1, 1):
        out.append(cyl('aux%d' % (sy > 0), 2.6, 10.0,
                       (-8.0, sy * (RL + 2.6), 8.5 + 3.4),
                       rot=(0, math.pi / 2, 0), verts=16, mat=m('steelD')))
        out.append(cyl('auxc%d' % (sy > 0), 1.5, 1.2,
                       (-8.0 + 5.0, sy * (RL + 2.6), 8.5 + 3.4),
                       rot=(0, math.pi / 2, 0), verts=12, mat=m('brass')))
    # 软管：从罐顶回到喷管
    for i in range(2):
        out.append(torus('hose%d' % i, 5.2, 0.62,
                         (-6.0 + i * 3.4, -(RL + 0.4), 8.5 + RL + 3.0),
                         rot=(math.radians(80), 0, 0), maj=24, minr=6,
                         mat=m('steelD')))
    # 3 级：侧装甲裙 + 额外喷口
    if lv >= 2:
        out.append(box('skirtf', LL * 0.62, 1.5, 5.0, (-4.0, -(RL + 1.2), 9.6),
                       mat=m('body'), bevel=0.7))
        out.append(cyl('nozzle2', RB * 0.55, LN * 0.7, (U0 + LN * 0.55, RB * 0.9, WY - 3.6),
                       rot=(0, math.pi / 2, 0), verts=16, mat=m('body2')))
    return out


# ================================================================ 6. 胶水
def build_goo(m, lv):
    """胶水：40° 斜置碟形天线 + 绿色焦点球 + 罐体。"""
    out = []
    out += pedestal(m, lv, w=18.5, d=19.0)
    # 罐体（矮胖，因为主要视觉是天线）
    R = 9.5 + 1.0 * lv
    ZH = 12.0 + 2.0 * lv
    out.append(cyl('vat', R, ZH, (-3.5, 0, 8.5 + ZH / 2), verts=30,
                   mat=m('body')))
    out.append(cyl('vatcap', R * 0.94, 1.6, (-3.5, 0, 8.5 + ZH + 0.4), verts=30,
                   mat=m('body2'), bevel=0.4))
    out += bolt_ring('vbolt', 9, R * 0.78, 0.8, 1.0, (-3.5, 0, 8.5 + ZH + 1.2),
                     axis='Z', mat=m('brassD'))
    # 液位窗（侧面一条发光带）
    for i in range(4):
        out.append(box('gauge%d' % i, 1.8, 1.2, 2.0,
                       (-3.5 - 4.6 + i * 3.0, -(R + 0.5), 8.5 + ZH * 0.5),
                       mat=m('glow'), bevel=0.2))
    # 天线：碟 + 支臂，仰角 40°
    ang = math.radians(40)
    PX = -3.5
    PZ = 8.5 + ZH + 1.6
    ARM = 8.5 + 1.2 * lv
    tipx = PX + math.cos(ang) * ARM
    tipz = PZ + math.sin(ang) * ARM
    out.append(cyl('arm', 1.5, ARM, ((PX + tipx) / 2, 0, (PZ + tipz) / 2),
                   rot=(0, math.pi / 2 - ang, 0), verts=14, mat=m('steelD')))
    # 碟面（扁球）
    DR = 8.6 + 1.0 * lv
    out.append(sph('dish', DR, (tipx, 0, tipz), mat=m('lit'), seg=26, ring=16,
                   scale=(0.28, 1.0, 1.0)))
    out.append(sph('dishin', DR * 0.74, (tipx + 0.5, 0, tipz), mat=m('steelL'),
                   seg=22, ring=14, scale=(0.22, 1.0, 1.0)))
    # 焦点球 + 三根支撑
    FX = tipx + math.cos(ang) * (DR * 0.9)
    FZ = tipz + math.sin(ang) * (DR * 0.9)
    for i in range(3):
        a = i / 3 * TAU
        out.append(cyl('strt%d' % i, 0.34, DR * 1.05,
                       ((tipx + FX) / 2 + math.cos(a) * 1.2,
                        math.sin(a) * DR * 0.55, (tipz + FZ) / 2),
                       rot=(0, math.pi / 2 - ang, 0), verts=6, mat=m('steelD')))
    out.append(sph('focus', 3.0 + 0.4 * lv, (FX, 0, FZ), mat=m('glow'),
                   seg=20, ring=14))
    out.append(torus('fring', 3.9, 0.45, (FX, 0, FZ),
                     rot=(0, math.pi / 2 - ang, 0), maj=26, minr=6, mat=m('hi')))
    # 侧面软管（从罐体到碟背）
    for i in range(2):
        out.append(torus('ghose%d' % i, 4.6, 0.6,
                         (-1.0 + i * 2.4, -(R + 0.3), 8.5 + ZH * 0.85),
                         rot=(math.radians(76), 0, 0), maj=24, minr=6,
                         mat=m('steelD')))
    # 3 级：双层碟 + 副天线
    if lv >= 2:
        out.append(sph('subdish', DR * 0.5, (tipx - 1.6, 0, tipz + 1.2),
                       mat=m('body2'), seg=20, ring=12,
                       scale=(0.24, 1.0, 1.0)))
        out.append(cyl('subarm', 1.0, 7.0, (tipx - 5.2, 0, tipz + 3.0),
                       rot=(0, math.radians(52), 0), verts=10, mat=m('steelD')))
    return out


BUILDERS = {
    'gatling': build_gatling,
    'mortar': build_mortar,
    'missile': build_missile,
    'tesla': build_tesla,
    'flame': build_flame,
    'goo': build_goo,
}


def build(key, lv):
    m = M(PAL[key])
    return BUILDERS[key](m, lv)
