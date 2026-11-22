# 角色装备建模工具库（在 Blender 5.x 内 exec 执行）
# 约定：
#   * 建模坐标 = three.js 世界坐标（米，x 右 / y 上 / z 后，角色朝 -Z），对应未缩放的 soldier.glb 绑定姿态（T-pose）。
#     物体 matrix_world = C3B，只为在 Blender 里叠在导入的人体模型上显示。
#   * 导出时每个部件的顶点变换到所挂骨骼的局部空间（glTF 节点空间，含 Character 节点的 0.01 缩放），
#     物体为单位变换，节点名 <骨骼名>__<部件>，引擎直接作为骨骼子节点、单位变换挂上即可。
#   * 材质名约定：kit_main（图集） / kit_plate（引擎按队伍改色的装甲板，同图集） / kit_team（队伍色）
#     / kit_agent（特工色） / kit_glass（镜片/护目镜）。
import bpy, bmesh, math, json, struct, os
import numpy as np
from mathutils import Matrix, Vector, Quaternion, Euler

GLB = '/Users/Mac012/CODE/奥数通关游戏/public/assets/characters/soldier.glb'
OUT = '/Users/Mac012/CODE/奥数通关游戏/public/assets/characters'
SRC = '/Users/Mac012/CODE/奥数通关游戏/art-src/characters'
R = math.radians
# three (x,y,z) -> blender (x,-z,y)
C3B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
CTX = {'col': None, 'scene': None, 'mats': {}, 'kit': None}


# ---------------------------------------------------------------- 骨骼绑定姿态
def bone_rest():
    """glTF 节点链的世界矩阵（three 坐标），键为 three 里的骨骼名（去掉冒号）。"""
    with open(GLB, 'rb') as f:
        b = f.read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    nodes = j['nodes']
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parent[c] = i

    def local(nd):
        t = nd.get('translation', [0, 0, 0])
        r = nd.get('rotation', [0, 0, 0, 1])
        s = nd.get('scale', [1, 1, 1])
        return Matrix.LocRotScale(Vector(t), Quaternion((r[3], r[0], r[1], r[2])), Vector(s))

    cache = {}

    def world(i):
        if i in cache:
            return cache[i]
        m = local(nodes[i])
        if i in parent:
            m = world(parent[i]) @ m
        cache[i] = m
        return m

    return {nd['name'].replace(':', ''): world(i) for i, nd in enumerate(nodes)}


BONES = bone_rest()


def bpos(name):
    return BONES[name].to_translation()


# ---------------------------------------------------------------- 场景
def setup(kit):
    name = f'KIT_{kit}'
    sc = bpy.data.scenes.get('KIT_TMP')
    if sc is None:
        sc = bpy.data.scenes.new('KIT_TMP')
        bpy.context.window.scene = sc
        bpy.ops.import_scene.gltf(filepath=GLB)
    bpy.context.window.scene = sc
    old = bpy.data.collections.get(name)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(old)
    col = bpy.data.collections.new(name)
    sc.collection.children.link(col)
    CTX.update(col=col, scene=sc, kit=kit, mats={})
    for other in sc.collection.children:
        if other.name.startswith('KIT_') and other != col:
            other.hide_viewport = True
            other.hide_render = True
    return col


# ---------------------------------------------------------------- 图集贴图（程序生成）
CELL = 256
ATLAS = 1024
# 图集格子：0 聚合物 1 尼龙布 2 织带 3 枪灰金属 4 橡胶 5 陶瓷装甲（浅，引擎按队伍改色）6 针织布 7 皮革/麂皮
#           8 碳纤维 9 屏幕/电路 10 迷彩布 11 浅灰聚合物
CELLS = 12


def _noise(rng, h, w, scales):
    out = np.zeros((h, w), np.float32)
    for s, a in scales:
        g = rng.standard_normal((max(2, h // s), max(2, w // s))).astype(np.float32)
        # 双线性放大
        ys = np.linspace(0, g.shape[0] - 1, h)
        xs = np.linspace(0, g.shape[1] - 1, w)
        y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
        y1 = np.minimum(y0 + 1, g.shape[0] - 1); x1 = np.minimum(x0 + 1, g.shape[1] - 1)
        fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
        v = (g[y0][:, x0] * (1 - fx) + g[y0][:, x1] * fx) * (1 - fy) + (g[y1][:, x0] * (1 - fx) + g[y1][:, x1] * fx) * fy
        out += v * a
    return out


def build_atlas(kit, palette):
    """palette: 每格 (rgb 0..1, roughness, metal, pattern)。生成 basecolor / ORM / normal 三张图。"""
    rng = np.random.default_rng(hash(kit) & 0xffff)
    col = np.ones((ATLAS, ATLAS, 3), np.float32)
    orm = np.ones((ATLAS, ATLAS, 3), np.float32)
    hgt = np.zeros((ATLAS, ATLAS), np.float32)
    yy, xx = np.mgrid[0:CELL, 0:CELL].astype(np.float32)
    for i in range(16):
        # Blender 图像第 0 行在底部；UV 的格子 0 在左上
        cy, cx = (3 - i // 4) * CELL, (i % 4) * CELL
        rgb, rough, metal, pat = palette[i] if i < len(palette) else ((0.5, 0.5, 0.5), 0.6, 0.0, 'plain')
        n1 = _noise(rng, CELL, CELL, [(64, 0.5), (16, 0.3), (4, 0.2)])
        h = n1 * 0.03
        tone = 1.0 + n1 * 0.06
        if pat == 'weave':
            w = (np.sin(xx * math.pi / 2.0) * np.sin(yy * math.pi / 2.0))
            h = h + w * 0.5
            tone = tone + w * 0.05
        elif pat == 'webbing':
            s = np.sin(yy * math.pi / 3.0)
            h = h + s * 0.6
            tone = tone + s * 0.06 - (np.abs(((xx % 64) - 32)) < 2) * 0.15
        elif pat == 'knit':
            k = np.abs(np.sin(xx * math.pi / 4.0 + np.sin(yy * math.pi / 6.0) * 1.5))
            h = h + k * 0.7
            tone = tone + (k - 0.5) * 0.1
        elif pat == 'carbon':
            k = ((xx // 8 + yy // 8) % 2) * 2 - 1
            h = h + k * 0.2
            tone = tone + k * 0.05
        elif pat == 'screen':
            g = ((xx % 16) < 1) | ((yy % 16) < 1)
            tone = tone * 0.6 + g * 0.5
        elif pat == 'camo':
            c = _noise(rng, CELL, CELL, [(48, 1.0), (24, 0.5)])
            tone = tone * (0.82 + 0.3 * (c > 0.3) - 0.18 * (c < -0.4))
        elif pat == 'grain':
            h = h + _noise(rng, CELL, CELL, [(2, 0.04)])
        # 边缘磨损斑点（轻微）
        wear = _noise(rng, CELL, CELL, [(8, 1.0), (3, 0.5)]) > 1.7
        c = np.array(rgb, np.float32)[None, None, :] * tone[:, :, None]
        c = np.where(wear[:, :, None], c * 1.12 + 0.02, c)
        col[cy:cy + CELL, cx:cx + CELL] = np.clip(c, 0, 1)
        orm[cy:cy + CELL, cx:cx + CELL, 0] = 1.0
        orm[cy:cy + CELL, cx:cx + CELL, 1] = np.clip(rough + n1 * 0.05 - wear * 0.15, 0.05, 1)
        orm[cy:cy + CELL, cx:cx + CELL, 2] = metal
        hgt[cy:cy + CELL, cx:cx + CELL] = h
    # 高度 → 法线
    gy, gx = np.gradient(hgt)
    k = 1.2
    nx, ny, nz = -gx * k, gy * k, np.ones_like(hgt)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5

    def img(name, arr, srgb):
        im = bpy.data.images.get(name)
        if im:
            bpy.data.images.remove(im)
        im = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False)
        im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        rgba = np.ones((ATLAS, ATLAS, 4), np.float32)
        rgba[:, :, :3] = arr
        # Blender 图像原点在左下；UV 也以左下为原点，直接对应
        im.pixels.foreach_set(rgba.ravel())
        path = os.path.join(SRC, 'tex', f'{name}.png')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        im.filepath_raw = path
        im.file_format = 'PNG'
        im.save()
        im.pack()
        return im

    # basecolor 用线性存储前先转 sRGB（numpy 中的值视为 sRGB 显示值）
    return img(f'kit_{kit}_col', col, True), img(f'kit_{kit}_orm', orm, False), img(f'kit_{kit}_nrm', nrm, False)


def make_materials(kit, imgs):
    col, orm, nrm = imgs
    mats = {}

    def principled(name):
        m = bpy.data.materials.get(name)
        if m:
            bpy.data.materials.remove(m)
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        return m, bsdf

    for nm in ('kit_main', 'kit_plate', 'kit_agent'):
        m, bsdf = principled(f'{nm}_{kit}')
        nt = m.node_tree
        tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col
        to = nt.nodes.new('ShaderNodeTexImage'); to.image = orm
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nm_ = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(to.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs[1], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs[2], bsdf.inputs['Metallic'])
        nt.links.new(tn.outputs['Color'], nm_.inputs['Color'])
        nt.links.new(nm_.outputs['Normal'], bsdf.inputs['Normal'])
        mats[nm] = m
    for nm, rgb, rough, metal, alpha in (
        ('kit_team', (0.2, 0.75, 1.0), 0.5, 0.0, 1.0),
        ('kit_glass', (0.05, 0.07, 0.08), 0.08, 0.3, 0.55),
    ):
        m, bsdf = principled(f'{nm}_{kit}')
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if alpha < 1:
            bsdf.inputs['Alpha'].default_value = alpha
            m.surface_render_method = 'BLENDED'
        mats[nm] = m
    CTX['mats'] = mats
    return mats


# ---------------------------------------------------------------- UV（按面主法线盒投影到图集格子）
def uv_box(bm, cell, density=3.0):
    """density：每米多少个格子宽（3 => 一格覆盖约 33cm）。每个面平移到格内，避免越界。"""
    uvl = bm.loops.layers.uv.verify()
    cx, cy = (cell % 4) / 4.0, 1.0 - (cell // 4 + 1) / 4.0
    pad = 0.06
    for f in bm.faces:
        n = f.normal
        a = max(range(3), key=lambda i: abs(n[i]))
        u_i, v_i = [(1, 2), (0, 2), (0, 1)][a]
        pts = [(l.vert.co[u_i] * density, l.vert.co[v_i] * density) for l in f.loops]
        mu = math.floor(min(p[0] for p in pts)); mv = math.floor(min(p[1] for p in pts))
        for l, (u, v) in zip(f.loops, pts):
            uu = (u - mu) % 2.0
            vv = (v - mv) % 2.0
            uu = min(uu, 1.0); vv = min(vv, 1.0)
            l[uvl].uv = (cx + (pad + uu * (1 - 2 * pad)) / 4.0, cy + (pad + vv * (1 - 2 * pad)) / 4.0)


# ---------------------------------------------------------------- 几何体
def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.LocRotScale(Vector(loc), Euler(rot, 'XYZ'), Vector(scale))


def look_m(loc, direction, up=(0, 1, 0), scale=(1, 1, 1)):
    """局部 +Y 指向 direction 的变换（用于圆柱等沿 Y 的体）。"""
    d = Vector(direction).normalized()
    q = Vector((0, 1, 0)).rotation_difference(d)
    return Matrix.LocRotScale(Vector(loc), q, Vector(scale))


class Piece:
    """一个导出部件：多个子体合并到一个 bmesh，带材质槽。"""

    def __init__(self, bone, name):
        self.bone, self.name = bone, name
        self.bm = bmesh.new()
        self.mat_slots = []
        self.bevel = 0.004
        self.segments = 2

    def _slot(self, mat):
        if mat not in self.mat_slots:
            self.mat_slots.append(mat)
        return self.mat_slots.index(mat)

    def _add(self, tmp, mat, cell, density=3.0):
        tmp.normal_update()
        uv_box(tmp, cell, density)
        si = self._slot(mat)
        for f in tmp.faces:
            f.material_index = si
        me = bpy.data.meshes.new('_tmp')
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def box(self, size, mtx, mat='kit_main', cell=0, sub=0, density=3.0):
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1.0)
        bmesh.ops.scale(t, vec=Vector(size), verts=t.verts)
        if sub:
            bmesh.ops.subdivide_edges(t, edges=t.edges[:], cuts=sub, use_grid_fill=True)
        bmesh.ops.transform(t, matrix=mtx, verts=t.verts)
        self._add(t, mat, cell, density)
        return self

    def cyl(self, r1, r2, h, mtx, mat='kit_main', cell=3, seg=16, cap=True, density=3.0):
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
        # create_cone 沿 Z；转成沿 Y
        bmesh.ops.rotate(t, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 4, 'X'), verts=t.verts)
        bmesh.ops.transform(t, matrix=mtx, verts=t.verts)
        self._add(t, mat, cell, density)
        return self

    def mesh(self, verts, faces, mat='kit_main', cell=0, density=3.0):
        t = bmesh.new()
        vs = [t.verts.new(v) for v in verts]
        for f in faces:
            try:
                t.faces.new([vs[i] for i in f])
            except ValueError:
                pass
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        self._add(t, mat, cell, density)
        return self

    def shell(self, center, radii, keep, thick=0.008, mat='kit_main', cell=0, seg=40, rings=24, density=3.0):
        """椭球壳：keep(x,y,z)->bool 决定保留哪些面（按面中心），再加厚。"""
        t = bmesh.new()
        bmesh.ops.create_uvsphere(t, u_segments=seg, v_segments=rings, radius=1.0)
        for v in t.verts:
            v.co = Vector((v.co.x * radii[0] + center[0], v.co.z * radii[1] + center[1], -v.co.y * radii[2] + center[2]))
        kill = [f for f in t.faces if not keep(*f.calc_center_median())]
        bmesh.ops.delete(t, geom=kill, context='FACES')
        loose = [v for v in t.verts if not v.link_faces]
        bmesh.ops.delete(t, geom=loose, context='VERTS')
        t.normal_update()
        # 加厚（向内）
        res = bmesh.ops.solidify(t, geom=t.faces[:], thickness=thick)
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        self._add(t, mat, cell, density)
        return self

    def tube_path(self, pts, radius, mat='kit_main', cell=1, seg=8, flat=1.0, density=3.0, cap=True, nrm=None):
        """沿折线的管（截面椭圆，flat<1 压扁成带子；nrm(p) 给出压扁方向＝贴合表面的外法线）。"""
        t = bmesh.new()
        rings = []
        P = [Vector(p) for p in pts]
        for i, p in enumerate(P):
            d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
            if nrm is not None:
                nv = Vector(nrm(p))
                b = (nv - d * nv.dot(d)).normalized()
                a = d.cross(b).normalized()
            else:
                ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
                a = d.cross(ref).normalized()
                b = d.cross(a).normalized()
            ring = []
            for k in range(seg):
                th = 2 * math.pi * k / seg
                ring.append(t.verts.new(p + a * math.cos(th) * radius + b * math.sin(th) * radius * flat))
            rings.append(ring)
        for i in range(len(rings) - 1):
            for k in range(seg):
                t.faces.new([rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]])
        if cap:
            t.faces.new(rings[0][::-1]); t.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        self._add(t, mat, cell, density)
        return self

    def finish(self):
        name = f'{self.bone}__{self.name}'
        me = bpy.data.meshes.new(f'{CTX["kit"]}:{name}')
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for s in self.mat_slots:
            me.materials.append(CTX['mats'][s])
        ob = bpy.data.objects.new(f'{CTX["kit"]}:{name}', me)
        ob['export_name'] = name
        ob.matrix_world = C3B
        CTX['col'].objects.link(ob)
        ob['bone'] = self.bone
        if self.bevel > 0:
            bv = ob.modifiers.new('bevel', 'BEVEL')
            bv.width = self.bevel
            bv.segments = self.segments
            bv.limit_method = 'ANGLE'
            bv.angle_limit = R(35)
            bv.harden_normals = False
        wn = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
        wn.keep_sharp = True
        for p in me.polygons:
            p.use_smooth = True
        return ob


# ---------------------------------------------------------------- 导出
def export_kit(kit, path=None):
    col = CTX['col']
    sc = CTX['scene']
    path = path or os.path.join(OUT, f'kit_{kit}.glb')
    dg = bpy.context.evaluated_depsgraph_get()
    exp = bpy.data.collections.new(f'EXP_{kit}')
    sc.collection.children.link(exp)
    made = []
    tris = 0
    srcs = [ob for ob in col.objects if ob.type == 'MESH' and 'bone' in ob]
    names = [ob['export_name'] for ob in srcs]
    for ob, name in zip(srcs, names):
        ev = ob.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        inv = BONES[ob['bone']].inverted()
        me.transform(C3B @ inv)
        me.update()
        me.name = name
        o2 = bpy.data.objects.new(name, me)
        exp.objects.link(o2)
        made.append(o2)
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
    vl = bpy.context.view_layer
    vl.active_layer_collection = vl.layer_collection.children[exp.name]
    for o in sc.objects:
        o.select_set(False)
    for o in made:
        o.select_set(True)
    vl.objects.active = made[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_active_collection=True, use_selection=True,
                              use_active_scene=True,
                              export_apply=False, export_yup=True, export_image_format='JPEG', export_jpeg_quality=88,
                              export_materials='EXPORT', export_animations=False, export_skins=False,
                              export_morph=False, export_extras=False, export_cameras=False, export_lights=False)
    for o in made:
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.meshes.remove(me)
    bpy.data.collections.remove(exp)
    size = os.path.getsize(path)
    print(f'exported {path} tris={tris} size={size}')
    return tris, size
