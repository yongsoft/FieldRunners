# -*- coding: utf-8 -*-
"""
bake_enemy.py —— 敌人单位烘焙（runner / infantry）

投影对齐 art.js 的 buildVehicle：
    GROUND_K = 0.46  →  俯角 27.386°
    模型前方 = +X，上方 = +Z，相机在 -Y 侧
    camera position = (0, -D·COS_T, D·SIN_T)
    image.x = world X    image.y = -Y·SIN_T + Z·COS_T

每个模型烘 20 朝向，输出到 <WORK>/bake_<key>/h<NN>.png。
用 PBR + 太阳光而不是 Emission，保留模型的体积感。
"""
import bpy, math, os, sys, json
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('BAKE_WORK', os.path.join(HERE, 'out'))

GROUND_K = 0.46
THETA = math.asin(GROUND_K)
COS_T = math.cos(THETA)
SIN_T = GROUND_K

HEADINGS = 20
SS = 4
CELL = 176
CV_HI = CELL * SS
DIST = 12.0

KEY = sys.argv[-2]
GLB = sys.argv[-1]
OUT = os.path.join(WORK, f'bake_{KEY}')
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = CV_HI
scene.render.resolution_y = CV_HI
scene.render.film_transparent = True

# 删除背景球（部分 GLB 会带一个 Icosphere 作为环境/背景）
ico = scene.objects.get('Icosphere')
if ico:
    bpy.data.objects.remove(ico, do_unlink=True)

# 按松散部件分离并删除大面积地板/背景片
for o in list(scene.objects):
    if o.type != 'MESH':
        continue
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')

FLOOR_AREA_THRESH = 0.5
for o in list(scene.objects):
    if o.type != 'MESH':
        continue
    bb = o.bound_box
    dx = max(v[0] for v in bb) - min(v[0] for v in bb)
    dy = max(v[1] for v in bb) - min(v[1] for v in bb)
    if dx * dy > FLOOR_AREA_THRESH:
        print(f'Remove floor-like {o.name} area={dx*dy:.3f}')
        bpy.data.objects.remove(o, do_unlink=True)

# 把剩余部件合并成一个对象，方便统一旋转
meshes = [o for o in scene.objects if o.type == 'MESH']
if not meshes:
    raise RuntimeError('No mesh left after floor removal')
if len(meshes) > 1:
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    mesh = bpy.context.active_object
else:
    mesh = meshes[0]

armature = next((o for o in scene.objects if o.type == 'ARMATURE'), None)

base_img = None
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image is not None:
            base_img = n.image
            break
    if base_img is not None:
        break
assert base_img is not None

pbr = bpy.data.materials.new('PBR')
pbr.use_nodes = True
nt = pbr.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
tex_n = nt.nodes.new('ShaderNodeTexImage')
tex_n.image = base_img
bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
bsdf.inputs['Roughness'].default_value = 0.75
bsdf.inputs['Metallic'].default_value = 0.0
out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(tex_n.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
mesh.data.materials.clear()
mesh.data.materials.append(pbr)

# 世界背景给一点环境光，避免暗部死黑（film_transparent 仍然保证背景透明）
world = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
wnt = world.node_tree
for n in list(wnt.nodes):
    wnt.nodes.remove(n)
wbg = wnt.nodes.new('ShaderNodeBackground')
wbg.inputs['Color'].default_value = (0.55, 0.58, 0.62, 1.0)
wbg.inputs['Strength'].default_value = 1.0
wout = wnt.nodes.new('ShaderNodeOutputWorld')
wnt.links.new(wbg.outputs['Background'], wout.inputs['Surface'])

# 主光：太阳光给模型体积感（Emission 会平掉所有明暗）
light_data = bpy.data.lights.new('Sun', type='SUN')
light_data.energy = 4.5
light_data.angle = math.radians(12)
light_obj = bpy.data.objects.new('Sun', light_data)
scene.collection.objects.link(light_obj)
light_obj.rotation_euler = (math.radians(48), 0, math.radians(38))

# 补光：从另一侧打一盏弱光，把阴影里的细节提出来
fill_data = bpy.data.lights.new('Fill', type='SUN')
fill_data.energy = 1.6
fill_data.angle = math.radians(30)
fill_obj = bpy.data.objects.new('Fill', fill_data)
scene.collection.objects.link(fill_obj)
fill_obj.rotation_euler = (math.radians(60), 0, math.radians(-120))

mins = [1e9]*3; maxs_v = [-1e9]*3
for c in mesh.bound_box:
    w = mesh.matrix_world @ Vector(c)
    for i in range(3):
        mins[i] = min(mins[i], w[i])
        maxs_v[i] = max(maxs_v[i], w[i])
cx, cy, cz = (mins[0]+maxs_v[0])/2, (mins[1]+maxs_v[1])/2, (mins[2]+maxs_v[2])/2
print(f'world bbox: x[{mins[0]:.3f},{maxs_v[0]:.3f}] y[{mins[1]:.3f},{maxs_v[1]:.3f}] z[{mins[2]:.3f},{maxs_v[2]:.3f}]')
span_xy = max(maxs_v[0]-mins[0], maxs_v[1]-mins[1])

# ---- 关键：glTF 导入的物体默认 rotation_mode='QUATERNION'，
#      直接写 rotation_euler 会被静默忽略（20 个朝向烘成同一张图）。
#      mesh 是 armature 的子物体，父子各转一次等于转两倍，所以只转根节点。
ROOT = armature if (armature is not None and mesh.parent is armature) else mesh
for o in (mesh, armature):
    if o is not None:
        o.rotation_mode = 'XYZ'
print(f'rotate root = {ROOT.name} ({ROOT.type}), mesh.parent = '
      f'{mesh.parent.name if mesh.parent else None}')

# 只平移根节点：父子一起平移会把位移量叠加两次（模型飘在半空）
dz = -mins[2]
dx = -cx
dy = -cy
ROOT.location += Vector((dx, dy, dz))
bpy.context.view_layer.update()

mins = [1e9]*3; maxs_v = [-1e9]*3
for c in mesh.bound_box:
    w = mesh.matrix_world @ Vector(c)
    for i in range(3):
        mins[i] = min(mins[i], w[i])
        maxs_v[i] = max(maxs_v[i], w[i])
print(f'after  bbox: z_min={mins[2]:.3f} z_max={maxs_v[2]:.3f}  xy span={span_xy:.3f}')

cam_data = bpy.data.cameras.new('C')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = span_xy * 1.10
cam = bpy.data.objects.new('C', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
h = (maxs_v[2] - mins[2]) * 0.45
cam.location = (0, -DIST * COS_T, DIST * SIN_T)
cam.rotation_euler = (math.atan2(DIST * COS_T, DIST * SIN_T - h), 0, 0)


def reset_pose():
    if armature is None:
        return
    bpy.context.view_layer.objects.active = armature
    if armature.mode != 'POSE':
        bpy.ops.object.mode_set(mode='POSE')
    for pb in armature.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()


meta = {'key': KEY, 'glb': GLB,
        'headings': HEADINGS, 'cell': CELL, 'src_cell': CV_HI,
        'bbox_after_translate': dict(
            x=[mins[0], maxs_v[0]], y=[mins[1], maxs_v[1]], z=[mins[2], maxs_v[2]],
        ),
        'files': []}

reset_pose()
for head in range(HEADINGS):
    # 游戏里 angle r → 屏幕方向 (cos r, sin r)，y 向下；
    # Blender 里绕 Z 转 θ → 屏幕方向 (cos θ, -sin θ)，
    # 所以 θ = -r。符号写反的话朝向会镜像（左转显示成右转）。
    rot = -head / HEADINGS * 2 * math.pi
    ROOT.rotation_euler = (0, 0, rot)
    bpy.context.view_layer.update()

    scene.render.filepath = os.path.join(OUT, f'h{head:02d}.png')
    bpy.ops.render.render(write_still=True)
    meta['files'].append(os.path.basename(scene.render.filepath))

with open(os.path.join(OUT, 'meta.json'), 'w') as f:
    json.dump(meta, f, indent=2, ensure_ascii=False)

print(f'\nbaked {HEADINGS} headings -> {OUT}')
