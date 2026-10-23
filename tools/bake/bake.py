# -*- coding: utf-8 -*-
"""
bake.py —— 用 Blender 把低模炮塔烘成「多朝向序列帧」，供 Canvas 2D 游戏使用。

投影严格对齐 fieldrunners/js/art.js：
    GROUND_K = 0.46 = sin(俯角)   → 俯角 27.386°
    世界映射：模型前方 = +X，上方 = +Z，相机在 -Y 侧俯视
    → 屏幕 x = 世界 X，屏幕 y(向上) = 世界 Y·sinθ + 世界 Z·cosθ
    游戏 pt() 的 (u,v,w) 与 Blender 的对应：X = u, Y = -v, Z = w

画布约定（与 art.js 的 getTowerSprite / buildTop 一致）：
    基座 96×96，1 单位 = 1px，原点在画布正中 (48,48) → 相机瞄准模型原点。
    炮体 192×192，1 单位 = TT(1.38)px，但**原点在 (84,124) 而不是画布中心 (96,96)**
      → 相机要瞄在一个偏移点上，使模型原点落在 (84,124)：
        Tx = (96-84)/TT = 12/TT
        Tz = (124-96)/(TT·cosθ) = 28/(TT·cosθ)
    炮体组的 z=0 就是基座台面（和 buildTop 的 w=0 一致）。

着色 = 「几何法线 · 光照方向 → 三档常值 ColorRamp」+ 可选的按物体局部轴的渐变。
档宽是对着 art.js 的 bodyGrad/topGrad 量出来的：侧面 / 正面 / 顶面 在线性空间
大约是 0.33 : 0.54 : 1.0（art.js 用 OL.d/OL.m/OL.l 三个色，比例就是这么多）。

渲染完由 post.py（描边+降采样）→ pack.py（紧凑图集 + 内联 base64）消费。
环境变量：
    BAKE_HEADINGS=6   只烘 6 个朝向（快速预览用，默认 48）
    BAKE_SAMPLES=8    采样数（默认 16）
    BAKE_DEBUG=1      只打印每个零件的世界包围盒并逐个渲染，然后退出
"""
import bpy, os, math, time, json

WORK = os.environ.get('BAKE_WORK', '/tmp/bl')   # 中间产物目录（不入库）
OUT = os.path.join(WORK, 'out')
os.makedirs(OUT, exist_ok=True)

GROUND_K = 0.46
THETA = math.asin(GROUND_K)          # 27.386°
SIN_T, COS_T = GROUND_K, math.cos(THETA)     # 0.46 / 0.88782

HEADINGS = int(os.environ.get('BAKE_HEADINGS', '48'))
SAMPLES = int(os.environ.get('BAKE_SAMPLES', '16'))
SS = 4                               # 超采样倍率
BASE_CV, TOP_CV = 96, 192
TT = 1.38

# art.js 的基座常量：RX=35, RY=RX*0.39, CY_TOP=RY*0.28, RIM_H=RX*0.26
BASE_RY = 35.0 * 0.39                # 13.65
CY_TOP = BASE_RY * 0.28              # 3.822  台面圆心（塔中心下方）
RIM_H = 35.0 * 0.26                  # 9.1    外壁在屏幕上的高度
# → 基座总高（世界单位）= RIM_H / cosθ，烘出来正好 9.1px
# 基座单独一套俯角：art.js 的台面椭圆比是 BASE_RY/BASE_RX = 0.39，
# 而炮塔地面偏移用的是 GROUND_K = 0.46 —— 原画本来就不一致，
# 基座照 0.39 烘，台面才不会比程序化版本「胖一圈」。
BASE_K = 0.39
BASE_COS = math.sqrt(1.0 - BASE_K * BASE_K)   # 0.9208
H_BASE = RIM_H / BASE_COS                     # 9.883

BASE_T = (0.0, 0.0, 0.0)
TOP_T = (12.0 / TT, 0.0, 28.0 / (TT * COS_T))

# 屏幕左上前方的光；X/Y 分量的比例决定「正面」和「侧面」落在不同档
LIGHT = (-0.46, -0.22, 0.858)
BANDS = (0.30, 0.52, 1.0)            # 侧 / 正 / 顶（线性空间的比例）


# ------------------------------------------------------------------ 颜色
def s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex2lin(h):
    h = h.lstrip('#')
    return tuple(s2l(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def _mixrgb(nt):
    """Blender 4.x 里 ShaderNodeMixRGB 是 legacy，优先用 ShaderNodeMix(RGBA)。
    注意 ShaderNodeMix 的同名 socket 有好几个（Float/Vector/Color/Rotation），
    必须按**索引**取 —— inputs['A'] 拿到的是 Float 那个，接上 Color 会静默出错。"""
    try:
        n = nt.nodes.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = 'MULTIPLY'
        return n, n.inputs[0], n.inputs[6], n.inputs[7], n.outputs[2]
    except Exception:
        n = nt.nodes.new('ShaderNodeMixRGB')
        n.blend_type = 'MULTIPLY'
        return n, n.inputs['Fac'], n.inputs['Color1'], n.inputs['Color2'], n.outputs['Color']


def cel_mat(name, hexcol, bands=BANDS, grads=(), light=LIGHT,
            mode='axis', axis_w=(0.54, 0.33, 1.0)):
    """三段赛璐璐。两种分档方式：

    mode='axis'（默认，给方块用）—— 按**零件自己的轴**分档：
        f = |N·x|·0.54 + |N·y|·0.33 + max(N·z, 0)·1.0
      顶面 → 1.00、朝前/后的面 → 0.54、朝左/右的面 → 0.33。
      这正是 art.js 的做法（box() 固定给顶面 OL.l、U 面 OL.m、V 面 OL.d，
      和光从哪来无关）。用世界光照分档的话，朝向 45° 时两个可见侧面会落到
      同一档，炮体就糊成一块 —— 这是最早那版「偏灰偏平」的真正原因。
    mode='light'（给基座大圆柱用）—— 世界空间 N·L 分档，圆柱才有左右明暗。

    grads = [('Z', [(pos, mul), ...]), ...]：再乘几层按物体局部轴的明暗，
    用来做 art.js bodyGrad（下暗上亮）/ topGrad（前暗后亮）那两套渐变。"""
    base = hex2lin(hexcol)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emit = nt.nodes.new('ShaderNodeEmission')
    emit.inputs['Strength'].default_value = 1.0
    geo = nt.nodes.new('ShaderNodeNewGeometry')

    def m(op, a=None, b=None, av=None, bv=None):
        n = nt.nodes.new('ShaderNodeMath')
        n.operation = op
        if a is not None:
            nt.links.new(a, n.inputs[0])
        if av is not None:
            n.inputs[0].default_value = av
        if b is not None:
            nt.links.new(b, n.inputs[1])
        if bv is not None:
            n.inputs[1].default_value = bv
        return n.outputs[0]

    if mode == 'axis':
        vt = nt.nodes.new('ShaderNodeVectorTransform')
        vt.vector_type = 'NORMAL'
        vt.convert_from = 'WORLD'
        vt.convert_to = 'OBJECT'
        nt.links.new(geo.outputs['Normal'], vt.inputs['Vector'])
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(vt.outputs['Vector'], sep.inputs[0])
        fx = m('MULTIPLY', m('ABSOLUTE', sep.outputs['X']), bv=axis_w[0])
        fy = m('MULTIPLY', m('ABSOLUTE', sep.outputs['Y']), bv=axis_w[1])
        fz = m('MULTIPLY', m('MAXIMUM', sep.outputs['Z'], bv=0.0), bv=axis_w[2])
        fac = m('ADD', m('ADD', fx, fy), fz)
        thr = (0.44, 0.77)
    else:
        dot = nt.nodes.new('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        dot.inputs[1].default_value = light
        rng = nt.nodes.new('ShaderNodeMapRange')
        rng.inputs['From Min'].default_value = -1.0
        rng.inputs['From Max'].default_value = 1.0
        rng.inputs['To Min'].default_value = 0.0
        rng.inputs['To Max'].default_value = 1.0
        rng.clamp = True
        nt.links.new(geo.outputs['Normal'], dot.inputs[0])
        nt.links.new(dot.outputs['Value'], rng.inputs['Value'])
        fac = rng.outputs['Result']
        thr = (0.50, 0.76)

    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.interpolation = 'CONSTANT'
    cr.elements[0].position = 0.0
    cr.elements[0].color = tuple(min(1.0, c * bands[0]) for c in base) + (1.0,)
    cr.elements[1].position = thr[0]
    cr.elements[1].color = tuple(min(1.0, c * bands[1]) for c in base) + (1.0,)
    e3 = cr.elements.new(thr[1])
    e3.color = tuple(min(1.0, c * bands[2]) for c in base) + (1.0,)
    nt.links.new(fac, ramp.inputs['Fac'])

    cur = ramp.outputs['Color']
    if grads:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        gsep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['Generated'], gsep.inputs[0])
        for axis, stops in grads:
            gr = nt.nodes.new('ShaderNodeValToRGB')
            gc = gr.color_ramp
            gc.interpolation = 'CONSTANT'
            gc.elements[0].position = stops[0][0]
            gc.elements[0].color = (stops[0][1],) * 3 + (1.0,)
            gc.elements[1].position = stops[1][0]
            gc.elements[1].color = (stops[1][1],) * 3 + (1.0,)
            for pos, mul in stops[2:]:
                el = gc.elements.new(pos)
                el.color = (mul,) * 3 + (1.0,)
            nt.links.new(gsep.outputs[axis], gr.inputs['Fac'])
            mix, f_s, a_s, b_s, o_s = _mixrgb(nt)
            f_s.default_value = 1.0
            nt.links.new(cur, a_s)
            nt.links.new(gr.outputs['Color'], b_s)
            cur = o_s
    nt.links.new(cur, emit.inputs['Color'])
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


# ------------------------------------------------------------------ 场景重置
bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    bpy.ops.preferences.addon_enable(module='cycles')
except Exception as e:
    print('[bake] enable cycles:', e)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 0
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'

# ------------------------------------------------------------------ 调色板
# 直接抄 art.js gatling 的 OL / ST / RD / BR 四组色，bands 再往下压两档。
LIGHTS = (0.55, 0.80, 1.0)           # 自发光零件（指示灯）不要压太暗
FLAT = (0.80, 0.92, 1.0)             # 很小的零件，别来回闪
PAL = {
    'oliveL': '#9fb365', 'olive': '#8fa458', 'oliveD': '#71833f', 'oliveX': '#4e5c2a',
    'steelL': '#c2cad0', 'steel': '#8f9aa2', 'steelD': '#5a646c', 'steelX': '#333c43',
    'brass': '#cfa844', 'brassD': '#8a6d24',
    'red': '#d0402c', 'redL': '#f07a5e', 'redD': '#8d2013',
    'green': '#8ff04a', 'amber': '#ffc94a', 'rust': '#a05a38',
    'stone': '#c2c8bf', 'concL': '#d6d0be', 'concD': '#cbc7b8', 'dark': '#2a2e26',
}
# art.js bodyGrad: [0,-0.36] [0.22,-0.05] [0.60,+0.24] [1,+0.04] → 下暗上亮
BODY_GRAD = [('Z', [(0.0, 0.66), (0.30, 0.92), (0.70, 1.18), (0.95, 1.02)])]
# art.js topGrad: 顶面靠后亮、靠前暗（受天光）→ Blender 里「远」是 +Y
TOP_GRAD = [('Y', [(0.0, 0.84), (0.55, 1.00), (0.95, 1.10)])]

MAT = {
    'oliveL': cel_mat('m_oliveL', PAL['oliveL'], grads=BODY_GRAD + TOP_GRAD),
    'olive':  cel_mat('m_olive', PAL['olive'], grads=BODY_GRAD),
    'oliveD': cel_mat('m_oliveD', PAL['oliveD']),
    'oliveX': cel_mat('m_oliveX', PAL['oliveX'], bands=(0.42, 0.62, 1.0)),
    'steelL': cel_mat('m_steelL', PAL['steelL'], bands=(0.42, 0.62, 1.0)),
    'steel':  cel_mat('m_steel', PAL['steel'], grads=BODY_GRAD),
    'steelD': cel_mat('m_steelD', PAL['steelD'], grads=BODY_GRAD),
    'steelX': cel_mat('m_steelX', PAL['steelX'], bands=(0.45, 0.66, 1.0)),
    'brass':  cel_mat('m_brass', PAL['brass'], bands=(0.40, 0.62, 1.0)),
    'brassD': cel_mat('m_brassD', PAL['brassD'], bands=(0.48, 0.70, 1.0)),
    'red':    cel_mat('m_red', PAL['red'], bands=(0.44, 0.66, 1.0)),
    'redL':   cel_mat('m_redL', PAL['redL'], bands=(0.52, 0.76, 1.0)),
    'redD':   cel_mat('m_redD', PAL['redD'], bands=(0.60, 0.80, 1.0)),
    'green':  cel_mat('m_green', PAL['green'], bands=LIGHTS),
    'amber':  cel_mat('m_amber', PAL['amber'], bands=LIGHTS),
    'rust':   cel_mat('m_rust', PAL['rust'], bands=(0.50, 0.72, 1.0)),
    # 基座外壁：大圆柱，走世界光照分档（左右明暗）+ 竖向渐变（上亮下暗），
    # 合起来就是 art.js 那套石板灰
    'stone':  cel_mat('m_stone', PAL['stone'], bands=(0.40, 0.62, 1.0), mode='light',
                      grads=[('Z', [(0.0, 0.36), (0.30, 0.70), (0.78, 1.0)])]),
    'concL':  cel_mat('m_concL', PAL['concL'], bands=(0.60, 0.82, 1.0),
                      grads=[('Y', [(0.0, 0.74), (0.50, 0.94), (0.92, 1.02)])]),
    'concD':  cel_mat('m_concD', PAL['concD'], bands=(0.70, 0.88, 1.0)),
    'dark':   cel_mat('m_dark', PAL['dark'], bands=FLAT),
}
BASE_OBJS, TOP_OBJS = [], []


def _smooth(angle=35):
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
    except Exception:
        bpy.ops.object.shade_smooth()


def cyl(name, r, h, loc, rot=(0, 0, 0), verts=24, mat='steel', group=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h,
                                        location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(MAT[mat])
    _smooth()
    if group is not None:
        group.append(o)
    return o


def box(name, sx, sy, sz, loc, rot=(0, 0, 0), mat='oliveL', bevel=0.0, group=None):
    # primitive_cube_add(size=1) 的棱长就是 1（顶点在 ±0.5），所以直接乘 sx
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = 2
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(40)
    o.data.materials.append(MAT[mat])
    try:
        bpy.ops.object.shade_flat()
    except Exception:
        pass
    if group is not None:
        group.append(o)
    return o


def sph(name, r, loc, mat='brass', group=None, seg=16, ring=10, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=r, location=loc)
    o = bpy.context.object
    o.name = name
    if scale:
        o.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(MAT[mat])
    _smooth()
    if group is not None:
        group.append(o)
    return o


# ================================================================== 基座（不旋转）
# art.js 的基座是「一只圆柱 + 顶面比外壁小 2.2」：外壁 RX=35、台面 RX-2.2=32.8。
# 直接给整圆柱换个顶面材质会多出一圈亮环（台面伸到 35，而深橄榄楔形板只到 31.7），
# 所以拆成两段：外壁圆柱到 H_BASE-0.8，上面扣一只 r=32.8 的浅灰盘。
drum = cyl('b_wall', 35.0, H_BASE - 0.8, (0, 0, (H_BASE - 0.8) / 2),
           verts=48, mat='stone', group=BASE_OBJS)
cyl('b_plate', 32.8, 0.8, (0, 0, H_BASE - 0.4), verts=48, mat='concL', group=BASE_OBJS)
# 底部黄铜箍
cyl('b_band', 35.4, 1.6, (0, 0, 1.15), verts=48, mat='brassD', group=BASE_OBJS)
# 台面外圈：一圈深橄榄楔形装甲板（设计稿台面最显眼的一圈）
# art.js 是 7 段半径 29.4、线宽 7 的椭圆弧 → 覆盖 r 25.9~32.9，一直顶到台面边缘
for i in range(7):
    a = i / 7.0 * math.tau + 0.30
    box('b_wedge%d' % i, 7.0, 14.2, 1.2,
        (math.cos(a) * 29.4, math.sin(a) * 29.4, H_BASE + 0.6),
        rot=(0, 0, a + math.pi / 2), mat='oliveX', bevel=0.5, group=BASE_OBJS)

# 正前方（朝向相机 = Blender -Y）：深色灯座 + 绿色指示灯
box('b_housing', 11.2, 4.4, 8.6, (0, -34.6, 6.2), mat='steelX', bevel=1.4, group=BASE_OBJS)
sph('b_lampG', 3.05, (0, -36.7, 6.7), mat='green', group=BASE_OBJS, seg=14, ring=10,
    scale=(1.0, 0.60, 1.0))
sph('b_rivet', 1.1, (0, -36.2, 1.7), mat='brassD', group=BASE_OBJS, seg=10, ring=7)

# 左前方 1~3 颗等级灯（slotA = [2.02, 2.30, 2.58]，屏幕坐标 → Blender 方位角取负）
LAMP_MAT = ['green', 'dark', 'dark']     # lv0：只亮第一颗
for i in range(3):
    a = -[2.02, 2.30, 2.58][i]
    sph('b_lvl%d' % i, 2.3,
        (math.cos(a) * 34.0, math.sin(a) * 34.0, H_BASE - 4.72),
        mat=LAMP_MAT[i], group=BASE_OBJS, seg=12, ring=8)

# ================================================================== 炮体（绕 Z 轴旋转，z=0 = 台面）
UOFF = -5.2                                   # 与 art.js gatling 的 UOFF 一致


def T(x):
    return x + UOFF


# 方形底座
box('t_ped', 19.0, 23.0, 8.5, (T(-3.5), 0, 4.25), mat='oliveL', bevel=2.4, group=TOP_OBJS)
# 炮体主块（比台座还高，最关键的一条比例）
box('t_body', 24.0, 24.0, 20.5, (T(-4.0), 0, 18.75), mat='oliveL', bevel=3.6, group=TOP_OBJS)
# 顶盖 + 散热格栅
box('t_roof', 21.5, 21.5, 1.8, (T(-4.0), 0, 29.9), mat='oliveD', bevel=0.7, group=TOP_OBJS)
for i in range(3):
    box('t_vent%d' % i, 11.0, 1.5, 1.1, (T(-4.0), -6.4 + i * 6.4, 31.0), mat='oliveX', group=TOP_OBJS)
# 顶盖四角螺栓
for i in range(4):
    sx = -1 if i % 2 else 1
    sy = -1 if i < 2 else 1
    cyl('t_bolt%d' % i, 1.05, 0.7, (T(-4.0) + sx * 8.6, sy * 8.6, 31.0), verts=8,
        mat='steelD', group=TOP_OBJS)

# 左侧大圆舱盖（设计稿最显眼的特征；游戏 v 为负 → Blender +Y）
cyl('t_hatch', 7.4, 6.2, (T(-5.0), 15.1, 19.5), rot=(math.pi / 2, 0, 0), verts=26,
    mat='steel', group=TOP_OBJS)
cyl('t_hatchcap', 7.4, 1.5, (T(-5.0), 18.9, 19.5), rot=(math.pi / 2, 0, 0), verts=26,
    mat='steelL', group=TOP_OBJS)
cyl('t_hatchmid', 4.8, 1.5, (T(-5.0), 19.3, 19.5), rot=(math.pi / 2, 0, 0), verts=22,
    mat='steelD', group=TOP_OBJS)
cyl('t_hatchhub', 2.0, 1.5, (T(-5.0), 19.6, 19.5), rot=(math.pi / 2, 0, 0), verts=16,
    mat='rust', group=TOP_OBJS)
# 舱盖一圈螺栓
for i in range(8):
    a = i / 8.0 * math.tau + 0.4
    cyl('t_hbolt%d' % i, 0.85, 1.2,
        (T(-5.0) + math.cos(a) * 6.0, 19.0, 19.5 + math.sin(a) * 6.0),
        rot=(math.pi / 2, 0, 0), verts=8, mat='brassD', group=TOP_OBJS)

# 顶部红色警示灯
cyl('t_warn', 3.3, 1.5, (T(-9.5), 0, 29.9), verts=20, mat='red', group=TOP_OBJS)
cyl('t_warn2', 2.0, 1.5, (T(-9.5), 0, 31.3), verts=16, mat='redL', group=TOP_OBJS)

# 前段炮座
box('t_mount', 4.5, 16.8, 13.5, (T(10.25), 0, 17.75), mat='oliveL', bevel=2.6, group=TOP_OBJS)

# 4 根枪管（绕 u 轴均布在 (v,w) 平面里）+ 炮口帽
WY, RAD, NB = 19.5, 4.2, 4
U0, U1, RBAR = 12.6, 20.1, 1.95
for i in range(NB):
    a = i / NB * math.tau
    v = math.sin(a) * RAD
    w = WY + math.cos(a) * RAD * 0.94
    cyl('t_barrel%d' % i, RBAR, U1 - U0, (T((U0 + U1) / 2), -v, w),
        rot=(0, math.pi / 2, 0), verts=12, mat='steelD', group=TOP_OBJS)
    cyl('t_bcap%d' % i, 1.8, 1.3, (T(U1 + 0.65), -v, w),
        rot=(0, math.pi / 2, 0), verts=12, mat='steelX', group=TOP_OBJS)

# 前脸绿色指示灯
cyl('t_eye', 2.6, 1.6, (T(12.7), 0, 13.4), rot=(0, math.pi / 2, 0), verts=18,
    mat='green', group=TOP_OBJS)

# 短天线（3D 才有的细节，不改变主体剪影）
cyl('t_mast', 0.7, 7.0, (T(-13.5), 7.5, 33.5), verts=8, mat='steelD', group=TOP_OBJS)
sph('t_tip', 1.3, (T(-13.5), 7.5, 37.4), mat='amber', group=TOP_OBJS, seg=10, ring=7)

# ================================================================== 相机
bpy.ops.object.camera_add()
cam = bpy.context.object
scene.camera = cam
cam.data.type = 'ORTHO'
cam.data.clip_end = 5000


def aim_camera(target, ortho_scale, sin_t=None, cos_t=None):
    """正交相机停在 (0, -D·cosθ, +D·sinθ) 方向，看向 target。
    正交下 target 必然落在画面正中 —— 所以 target 就是「画布中心对应的世界点」。
    ortho_scale = 画布边长 / TT → 1 世界单位 = TT 像素。"""
    from mathutils import Vector
    st = SIN_T if sin_t is None else sin_t
    ct = COS_T if cos_t is None else cos_t
    D = 900.0
    cam.location = (target[0], target[1] - D * ct, target[2] + D * st)
    d = Vector(target) - Vector(cam.location)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = ortho_scale


def show(group):
    for o in BASE_OBJS + TOP_OBJS:
        o.hide_render = o not in group


def render_to(path, res):
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------ 调试：逐零件
if os.environ.get('BAKE_DEBUG'):
    from mathutils import Vector as _V
    DBG = os.path.join(os.path.dirname(OUT), 'dbg')
    os.makedirs(DBG, exist_ok=True)
    aim_camera(TOP_T, TOP_CV / TT)
    for o in TOP_OBJS:
        bb = [o.matrix_world @ _V(c) for c in o.bound_box]
        xs = [p.x for p in bb]; ys = [p.y for p in bb]; zs = [p.z for p in bb]
        print('[dbg] %-14s X %7.2f..%7.2f  Y %7.2f..%7.2f  Z %7.2f..%7.2f' %
              (o.name, min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))
    for o in TOP_OBJS:
        show([o])
        render_to(os.path.join(DBG, 'one_%s.png' % o.name), 192)
    print('[dbg] wrote per-part images to', DBG)
    raise SystemExit(0)

# ------------------------------------------------------------------ 渲染基座
t0 = time.time()
show(BASE_OBJS)
aim_camera(BASE_T, BASE_CV, BASE_K, BASE_COS)                   # 原点 → 画布 (48,48)
render_to(os.path.join(OUT, 'base.png'), BASE_CV * SS)
print('[bake] base done %.1fs' % (time.time() - t0))

# ------------------------------------------------------------------ 渲染炮体各朝向
show(TOP_OBJS)
aim_camera(TOP_T, TOP_CV / TT)                # 原点 → 画布 (84,124)
# 相机固定不动，转模型 → 各朝向共用一套世界空间光照
# 游戏里 pt() 对局部 (u,v) 做 +rot 旋转，对应 Blender 绕 Z 转 -rot
root = bpy.data.objects.new('turret_root', None)
scene.collection.objects.link(root)
for o in TOP_OBJS:
    o.parent = root
    o.matrix_parent_inverse = root.matrix_world.inverted()

t1 = time.time()
for i in range(HEADINGS):
    root.rotation_euler = (0, 0, -i / HEADINGS * math.tau)
    bpy.context.view_layer.update()
    render_to(os.path.join(OUT, 'top_%03d.png' % i), TOP_CV * SS)
print('[bake] %d headings done %.1fs (%.2fs each)' %
      (HEADINGS, time.time() - t1, (time.time() - t1) / HEADINGS))
json.dump({'headings': HEADINGS, 'ss': SS, 'tt': TT, 'baseH': H_BASE},
          open(os.path.join(os.path.dirname(OUT), 'platform.json'), 'w'))
print('[bake] OUT =', OUT)
