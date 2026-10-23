# -*- coding: utf-8 -*-
"""
lib.py —— 炮塔 3D 建模图元库（Blender）

坐标约定（与游戏 art.js 的 pt() 严格一致）：
    模型前方 = +X (u)，右方 = -Y（因为相机在 -Y，v 正向朝屏幕里）
    上方 = +Z (w)，z=0 = 基座台面
    相机：正交，仰角 asin(0.46) = 27.386°，位于 (0, -D·cosθ, +D·sinθ)

着色：赛璐璐 4 档（顶 / 正 / 侧 / 底），颜色取自设计稿实测的逐塔调色板。
    分档用**零件自身法线**而不是世界光照 —— 世界光照在 45° 朝向时
    两个可见侧面会落到同一档，炮体就糊成一块。
"""
import math

import bpy

TAU = math.tau

# ---------------------------------------------------------------- 场景
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.filter_size = 1.0
    try:
        sc.eevee.taa_render_samples = 32
    except Exception:
        pass
    # 阴影必须开 —— 设计稿的暗部就是零件之间的投影
    for attr, val in (('use_shadows', True), ('use_shadow_jitter_viewport', True),
                      ('use_gtao', True), ('gtao_distance', 3.0)):
        try:
            setattr(sc.eevee, attr, val)
        except Exception:
            pass

    # ---- 光照：主光在屏幕左上前方，另加环境光提亮暗部
    world = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
    sc.world = world
    world.use_nodes = True
    wn = world.node_tree
    for n in list(wn.nodes):
        wn.nodes.remove(n)
    bg = wn.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (0.62, 0.66, 0.70, 1.0)
    bg.inputs['Strength'].default_value = 0.55
    wo = wn.nodes.new('ShaderNodeOutputWorld')
    wn.links.new(bg.outputs['Background'], wo.inputs['Surface'])

    sun_d = bpy.data.lights.new('Sun', type='SUN')
    sun_d.energy = 3.1
    sun_d.angle = math.radians(9)
    try:
        sun_d.use_shadow = True
    except Exception:
        pass
    sun = bpy.data.objects.new('Sun', sun_d)
    sc.collection.objects.link(sun)
    # 从屏幕左上打过来（+X 右、-Y 朝相机、+Z 上）
    sun.rotation_euler = (math.radians(50), 0, math.radians(-52))

    fill_d = bpy.data.lights.new('Fill', type='SUN')
    fill_d.energy = 0.85
    fill_d.angle = math.radians(25)
    fill = bpy.data.objects.new('Fill', fill_d)
    sc.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(66), 0, math.radians(128))
    return sc


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex2lin(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


# ---------------------------------------------------------------- 材质
# 光向：屏幕左上前方（相机在 -Y，屏幕右 = +X）。
# 用真实光向 N·L 分 5 档，而不是「朝向权重」——
# 俯视相机几乎看不到朝下的面，用权重法暗部只有 5%，而设计稿有 16~24%。
# 设计稿的暗部本来画的就是「背光侧」，不是底面。
LIGHT = (-0.46, -0.62, 0.64)
# 5 档的切割点（作用在 remap 后的 v = (N·L+1)/2 ∈ [0,1]）。
# v 的实际取值：顶面 0.82 / 正面(-Y) 0.81 / 左面(-X) 0.73 / 右面 0.27 / 背面 0.19。
BAND_STOPS_5 = [(0.00, 'dark'), (0.34, 'body2'), (0.64, 'body'),
                (0.76, 'lit'), (0.90, 'hi')]
# 顶面判定：Nz 超过这个值就直接进 hi 档（设计稿的顶面都是一块暖奶白）
TOP_NZ = 0.45


def _shade(lin, k):
    return tuple(min(1.0, max(0.0, c * k)) for c in lin)


def bands_from_color(col):
    """单色 → 5 档（给小零件用）。亮度按 0.42 / 0.72 / 1.0 / 1.28 / 往奶白混。"""
    lin = hex2lin(col)
    cream = (1.0, 0.98, 0.82)
    hi = tuple(lin[i] * 0.55 + cream[i] * 0.45 for i in range(3))
    return dict(dark=_shade(lin, 0.42), body2=_shade(lin, 0.72),
                body=lin, lit=_shade(lin, 1.26), hi=hi)


def part_material(name, hexcol):
    """漫反射材质 —— **故意不做赛璐璐**。

    赛璐璐（自发光 + 法线分档）在这里行不通：俯视相机只能看到朝上/朝前的面，
    这些面全是「受光面」，暗部只剩 5%；而设计稿有 16~24% 的暗部。
    设计稿的暗部画的是**零件之间的投影和缝隙遮蔽**，那必须靠真实光照才有。

    所以：这里渲真实光照（太阳 + 环境光 + 阴影），
    再由 post.py 按亮度分层平涂——这样既拿到遮蔽关系，又保住硬边色块感。
    """
    lin = hex2lin(hexcol)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (*lin, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.88
    bsdf.inputs['Metallic'].default_value = 0.0
    for k in ('Specular IOR Level', 'Specular'):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.18
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


# ---------------------------------------------------------------- 图元
class Part:
    """一个零件：obj + 名称，方便调试与按需隐藏。"""

    def __init__(self, obj):
        self.o = obj
        self.name = obj.name

    def __repr__(self):
        return '<Part %s>' % self.name


def _finish(o, name, mat, parent):
    o.name = name
    if mat is not None:
        o.data.materials.append(mat)
    if parent is not None:
        o.parent = parent
    return Part(o)


def box(name, sx, sy, sz, loc, rot=(0, 0, 0), mat=None, bevel=0.8, seg=2, parent=None):
    """倒角盒 —— 赛璐璐风里 90° 硬边会显塑料，倒角才像金属装甲。"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = seg
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(35)
        m.harden_normals = True
    bpy.ops.object.shade_flat()
    return _finish(o, name, mat, parent)


def cyl(name, r, h, loc, rot=(0, 0, 0), mat=None, verts=28, bevel=0.0, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h,
                                        location=loc, rotation=rot)
    o = bpy.context.object
    if bevel > 0:
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = 2
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(30)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(30))
    return _finish(o, name, mat, parent)


def cone(name, r1, r2, h, loc, rot=(0, 0, 0), mat=None, verts=24, parent=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h,
                                    location=loc, rotation=rot)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(30))
    return _finish(bpy.context.object, name, mat, parent)


def torus(name, R, r, loc, rot=(0, 0, 0), mat=None, maj=32, minr=10, parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r,
                                     major_segments=maj, minor_segments=minr,
                                     location=loc, rotation=rot)
    bpy.ops.object.shade_smooth()
    return _finish(bpy.context.object, name, mat, parent)


def sph(name, r, loc, mat=None, seg=20, ring=12, scale=None, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring,
                                        radius=r, location=loc)
    o = bpy.context.object
    if scale:
        o.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    return _finish(o, name, mat, parent)


# ---------------------------------------------------------------- 细节组合
def bolt_ring(prefix, n, R, r, h, center, axis='X', mat=None, parent=None):
    """一圈螺栓 —— 设计稿里每个圆盖/法兰边缘都有，是最廉价的「工业感」。"""
    out = []
    for i in range(n):
        a = i / n * TAU + 0.35
        if axis == 'X':
            loc = (center[0], center[1] + math.sin(a) * R, center[2] + math.cos(a) * R)
            rot = (0, math.pi / 2, 0)
        elif axis == 'Y':
            loc = (center[0] + math.cos(a) * R, center[1], center[2] + math.sin(a) * R)
            rot = (math.pi / 2, 0, 0)
        else:
            loc = (center[0] + math.cos(a) * R, center[1] + math.sin(a) * R, center[2])
            rot = (0, 0, 0)
        out.append(cyl('%s%d' % (prefix, i), r, h, loc, rot=rot, mat=mat,
                       verts=8, parent=parent))
    return out


def vent(prefix, n, sx, sy, sz, loc, gap, axis='Z', mat=None, parent=None):
    """散热格栅：一排细条。比画贴图便宜，而且真 3D 会有遮挡关系。"""
    out = []
    for i in range(n):
        if axis == 'Z':
            l = (loc[0], loc[1] + (i - (n - 1) / 2) * gap, loc[2])
        else:
            l = (loc[0] + (i - (n - 1) / 2) * gap, loc[1], loc[2])
        out.append(box('%s%d' % (prefix, i), sx, sy, sz, l, mat=mat,
                       bevel=0.25, parent=parent))
    return out


def barrel(prefix, u0, u1, v, w, r0, r1, mat_body, mat_muzzle,
           rings=(), parent=None, verts=16):
    """炮管：主体锥形 + 炮口帽 + 若干箍环。方向沿 +X（前）。"""
    L = u1 - u0
    out = []
    out.append(cone('%s_tube' % prefix, r0, r1, L, ((u0 + u1) / 2, v, w),
                    rot=(0, math.pi / 2, 0), mat=mat_body, verts=verts,
                    parent=parent))
    out.append(cyl('%s_muz' % prefix, r1 * 1.22, 1.2, (u1 + 0.5, v, w),
                   rot=(0, math.pi / 2, 0), mat=mat_muzzle, verts=verts,
                   parent=parent))
    for i, (uu, rr) in enumerate(rings):
        out.append(cyl('%s_ring%d' % (prefix, i), rr, 1.1, (uu, v, w),
                       rot=(0, math.pi / 2, 0), mat=mat_muzzle, verts=verts,
                       parent=parent))
    return out


# ---------------------------------------------------------------- 用后即弃
def join_group(parts, name):
    """把一组零件合成一个对象 —— 减 draw call，也让修改变得整体。"""
    objs = [p.o for p in parts]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    return o
