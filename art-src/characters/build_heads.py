# 三名特工的人头（在 Blender 5.x 内执行，需已安装并启用 MPFB 2.0.18）：
#   ns = {}; exec(open('/Users/Mac012/CODE/奥数通关游戏/art-src/characters/build_heads.py').read(), ns); ns['build']('ling')
# 面部几何全部来自 MPFB 的 MakeHuman 基础网格 + 官方形变目标（CC0）；眼球为 MakeHuman 官方 high-poly eyes（CC0）。
# 皮肤由 MPFB 的程序化分层皮肤材质烘焙；眉毛 / 胡茬 / 短发在烘焙后的贴图上按位置图绘制；
# 圆的发髻与零的短发体积为简单外壳网格。导出 public/assets/characters/head_<id>.glb：
# 节点 mixamorigHead__head / __eyes / __hair，顶点位于 Head 骨骼局部空间（与 kit_<id>.glb 同约定）。
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector, Matrix

exec(open('/Users/Mac012/CODE/奥数通关游戏/art-src/characters/kit_lib.py').read())

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

EYES = '/Users/Mac012/CODE/奥数通关游戏/art-src/characters/mh_eyes/high-poly/high-poly.mhclo'
TEX = 1024

# ---------------------------------------------------------------- 每名特工的人设
SPEC = {
    # 零：清瘦、轮廓分明的年轻男性，短发后掠
    'ling': dict(
        macro=dict(gender=1.0, age=0.47, muscle=0.62, weight=0.38, proportions=0.6, height=0.55,
                   race=dict(asian=0.75, caucasian=0.2, african=0.05)),
        targets={'head-oval': 0.5, 'head-fat-decr': 0.6, 'head-scale-horiz-decr': 0.25,
                 'chin-prominent-incr': 0.35, 'chin-width-decr': 0.35, 'chin-height-incr': 0.2,
                 'cheek-bones-incr': 0.5, 'cheek-volume-decr': 0.5,
                 'nose-scale-vert-incr': 0.25, 'nose-point-width-decr': 0.4, 'nose-width1-decr': 0.2,
                 'eyebrows-angle-up': 0.4, 'eyes': 0.0},
        skin=(0.88, 0.64, 0.5), lips=(0.66, 0.36, 0.30), hair=(0.035, 0.03, 0.028), brow=0.9,
        iris=(0.32, 0.20, 0.10), style='swept', stubble=0.0, brow_th=1.0, locks=False, tone=(0.76, 0.57, 0.45)),
    # 圆：圆脸的年轻女性，低发髻
    'yuan': dict(
        macro=dict(gender=0.0, age=0.44, muscle=0.5, weight=0.5, proportions=0.6, height=0.45,
                   race=dict(asian=0.85, caucasian=0.15, african=0.0)),
        targets={'head-round': 0.6, 'head-fat-incr': 0.15, 'chin-prominent-decr': 0.2, 'chin-width-incr': 0.1,
                 'cheek-volume-incr': 0.4, 'nose-scale-horiz-decr': 0.2, 'nose-scale-vert-decr': 0.15,
                 'nose-point-up': 0.25, 'mouth-scale-horiz-decr': 0.1, 'eyes': 0.0},
        skin=(0.95, 0.74, 0.62), lips=(0.8, 0.3, 0.34), hair=(0.025, 0.02, 0.022), brow=0.62,
        iris=(0.22, 0.13, 0.07), style='bun', stubble=0.0, brow_th=0.5, locks=True, tone=(0.83, 0.64, 0.53)),
    # 衡：方下巴、宽脸、更壮实的男性，寸头 + 短胡
    'heng': dict(
        macro=dict(gender=1.0, age=0.56, muscle=0.8, weight=0.62, proportions=0.5, height=0.6,
                   race=dict(asian=0.35, caucasian=0.15, african=0.5)),
        targets={'head-square': 0.7, 'head-fat-incr': 0.25, 'head-scale-horiz-incr': 0.2,
                 'chin-width-incr': 0.6, 'chin-bones-incr': 0.6, 'chin-prominent-incr': 0.2,
                 'nose-width1-incr': 0.35, 'nose-volume-incr': 0.3, 'nose-scale-horiz-incr': 0.2,
                 'eyebrows-trans-down': 0.3, 'eyes': 0.0},
        skin=(0.64, 0.43, 0.31), lips=(0.42, 0.24, 0.21), hair=(0.02, 0.018, 0.017), brow=1.0,
        iris=(0.15, 0.09, 0.05), style='buzz', stubble=0.55, brow_th=1.15, locks=False, tone=(0.56, 0.39, 0.28)),
}


TDIR = '/Users/Mac012/Library/Application Support/Blender/5.3/extensions/user_default/mpfb/data/targets'
_TIDX = {}


def target_path(name):
    if not _TIDX:
        for root, _d, files in os.walk(TDIR):
            for f in files:
                if f.endswith('.target.gz'):
                    _TIDX[f[:-10]] = os.path.join(root, f)
    return _TIDX.get(name)


def make_human(agent):
    sp = SPEC[agent]
    sc = bpy.data.scenes.get('HEAD_TMP')
    if sc is None:
        sc = bpy.data.scenes.new('HEAD_TMP')
    bpy.context.window.scene = sc
    for o in list(sc.objects):
        if o.name.startswith('Human'):
            bpy.data.objects.remove(o, do_unlink=True)
    md = TargetService.get_default_macro_info_dict()
    for k, v in sp['macro'].items():
        md[k] = v
    h = HumanService.create_human(mask_helpers=True, detailed_helpers=False, extra_vertex_groups=True,
                                  feet_on_ground=True, scale=0.1, macro_detail_dict=md)
    missing = []
    for t, v in sp['targets'].items():
        if t == 'eyes' or v == 0:
            continue
        names = [t] if target_path(t) else ['l-' + t, 'r-' + t]
        for n in names:
            path = target_path(n)
            if not path:
                missing.append(n)
                continue
            TargetService.load_target(h, path, weight=v, name=n)
    eyes = HumanService.add_mhclo_asset(EYES, h, asset_type='Eyes', subdiv_levels=0, material_type='MAKESKIN',
                                        set_up_rigging=False, interpolate_weights=False, import_subrig=False, import_weights=False)
    return h, eyes, missing


# ---------------------------------------------------------------- 截取头颈并对位到 soldier 的头部
HEAD_TOP = 1.80     # three 坐标（未缩放 soldier 绑定姿态）：头顶，略低于头盔内壁
EAR_Z = 0.03         # 双耳中点的 z（与头盔中心 HC 对齐）
NECK_LEN = 0.268     # 从头顶往下保留的高度（含 4~5cm 脖子，藏进领口）


def _evaluated_copy(ob, name):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.name = name
    return me


def extract(agent, h, eyes):
    col = bpy.data.collections.get('HEADS') or bpy.data.collections.new('HEADS')
    sc = bpy.context.window.scene
    if col.name not in [c.name for c in sc.collection.children]:
        sc.collection.children.link(col)
    for o in list(col.objects):
        if o.name.startswith(agent + ':'):
            bpy.data.objects.remove(o, do_unlink=True)
    me = _evaluated_copy(h, f'{agent}:head')
    bm = bmesh.new()
    bm.from_mesh(me)
    dl = bm.verts.layers.deform.verify()
    gi = {vg.name: vg.index for vg in h.vertex_groups}
    head_verts = [v for v in bm.verts if v.co.z > 1.2 and abs(v.co.x) < 0.15]
    top = max(v.co.z for v in head_verts)
    ears = [v.co for v in bm.verts if v[dl].get(gi['ears'], 0) > 0.5]
    lips = [v.co.copy() for v in bm.verts if v[dl].get(gi['lips'], 0) > 0.5]
    ec = sum(ears, Vector()) / max(1, len(ears))
    cut = top - NECK_LEN
    neck_z = top - 0.215
    kill = [f for f in bm.faces if min(v.co.z for v in f.verts) < cut or max(abs(v.co.x) for v in f.verts) > 0.16
            or (min(v.co.z for v in f.verts) < neck_z and max(abs(v.co.x) for v in f.verts) > 0.075)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # 旋转 180°（MakeHuman 朝 -Y → soldier 朝 +Y），平移对位
    rot = Matrix.Rotation(math.pi, 4, 'Z')
    ecr = rot @ ec
    T = Matrix.Translation(Vector((-ecr.x, -EAR_Z - ecr.y, HEAD_TOP - top))) @ rot
    bm.transform(T)
    bm.to_mesh(me)
    bm.free()
    head = bpy.data.objects.new(f'{agent}:head', me)
    col.objects.link(head)
    if lips:
        lc = T @ (sum(lips, Vector()) / len(lips))
        lw = max(abs((T @ v).x) for v in lips)
        head['lips'] = (lc.x, lc.y, lc.z, lw)
    eme = _evaluated_copy(eyes, f'{agent}:eyes')
    eme.transform(T)
    eo = bpy.data.objects.new(f'{agent}:eyes', eme)
    col.objects.link(eo)
    tris = sum(len(p.vertices) - 2 for p in me.polygons) + sum(len(p.vertices) - 2 for p in eme.polygons)
    return head, eo, tris, T



# ---------------------------------------------------------------- 烘焙与绘制
def _img(name, size, data=False, flt=False, alpha=False):
    im = bpy.data.images.get(name)
    if im:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=flt)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return im


def _px(im):
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)


def _set_px(im, arr):
    im.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())
    im.update()


def _smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def eye_centers(eo):
    vs = [v.co for v in eo.data.vertices]
    L = [v for v in vs if v.x > 0]
    R = [v for v in vs if v.x <= 0]
    cl = sum(L, Vector()) / len(L)
    cr = sum(R, Vector()) / len(R)
    return cl, cr


def bake(agent, head, eo):
    sp = SPEC[agent]
    sc = bpy.context.window.scene
    try:
        sc.render.engine = 'CYCLES'
    except TypeError as e:
        print(e)
    sc.cycles.samples = 8
    try:
        sc.cycles.device = 'GPU'
    except Exception:
        pass
    me = head.data
    # 皮肤材质（MPFB 分层程序化皮肤）按人设上色
    src = me.materials[0]
    m = src.copy()
    m.name = f'{agent}:skinsrc'
    me.materials.clear()
    me.materials.append(m)
    nt = m.node_tree
    cg = nt.nodes.get('colorgroup')
    def setin(node, name, val):
        if node and name in node.inputs:
            node.inputs[name].default_value = val
    sk = (*sp['skin'], 1.0)
    setin(cg, 'SkinColor', sk); setin(cg, 'SkinOverride', 1.0)
    setin(cg, 'LipsColor', (*sp['lips'], 1.0)); setin(cg, 'LipsOverride', 1.0)
    setin(cg, 'EyelidColor', (sp['skin'][0] * 0.55, sp['skin'][1] * 0.45, sp['skin'][2] * 0.42, 1)); setin(cg, 'EyelidOverride', 0.6)
    for gname in ('facegroup', 'earsgroup', 'bodygroup'):
        g = nt.nodes.get(gname)
        setin(g, 'SkinColor', sk)
    # 次表面散射会把颜色从“漫反射颜色”通道里拿走：烘焙前关掉
    for n in nt.nodes:
        if n.type == 'GROUP':
            for k in ('SSSWeight', 'SSSStrength'):
                setin(n, k, 0.0)
    # 烘焙用 UV
    orig = me.uv_layers[0]
    if 'bake' not in me.uv_layers:
        me.uv_layers.new(name='bake')
    for o in sc.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = head
    head.select_set(True)
    me.uv_layers.active = me.uv_layers['bake']
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.006, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    orig.active_render = True
    me.uv_layers.active = me.uv_layers['bake']
    imgs = {}
    node = nt.nodes.new('ShaderNodeTexImage')
    nt.nodes.active = node
    sc.render.bake.margin = 12
    sc.render.bake.use_clear = True
    for kind, data, flt in (('DIFFUSE', False, False), ('ROUGHNESS', True, False), ('NORMAL', True, False)):
        im = _img(f'{agent}_bake_{kind.lower()}', TEX, data=data, flt=flt)
        node.image = im
        kw = dict(type=kind, margin=12, use_clear=True)
        if kind == 'DIFFUSE':
            kw['pass_filter'] = {'COLOR'}
        if kind == 'NORMAL':
            kw['normal_space'] = 'TANGENT'
        bpy.ops.object.bake(**kw)
        imgs[kind] = im
    nt.nodes.remove(node)
    # 位置图：用发光材质烘焙几何位置（浮点）
    pm = bpy.data.materials.get('_posbake') or bpy.data.materials.new('_posbake')
    pm.use_nodes = True
    pn = pm.node_tree
    pn.nodes.clear()
    geo = pn.nodes.new('ShaderNodeNewGeometry')
    em = pn.nodes.new('ShaderNodeEmission')
    outn = pn.nodes.new('ShaderNodeOutputMaterial')
    pn.links.new(geo.outputs['Position'], em.inputs['Color'])
    pn.links.new(em.outputs['Emission'], outn.inputs['Surface'])
    ti = pn.nodes.new('ShaderNodeTexImage')
    im = _img(f'{agent}_bake_position', TEX, data=True, flt=True)
    ti.image = im
    pn.nodes.active = ti
    me.materials[0] = pm
    bpy.ops.object.bake(type='EMIT', margin=12, use_clear=True)
    me.materials[0] = m
    imgs['POSITION'] = im
    return imgs


def paint(agent, head, eo, imgs):
    """在烘焙结果上绘制眉毛、头发（发际线内）、胡茬，输出最终 albedo / ORM / normal。"""
    sp = SPEC[agent]
    col = _px(imgs['DIFFUSE'])[:, :, :3].copy()
    rough = _px(imgs['ROUGHNESS'])[:, :, 0].copy()
    nrm = _px(imgs['NORMAL'])[:, :, :3].copy()
    pos = _px(imgs['POSITION'])[:, :, :3]
    valid = np.abs(pos).sum(-1) > 1e-4
    X, Y, Z = pos[..., 0], pos[..., 1], pos[..., 2]   # Blender 坐标：x 右(角色左)、+Y 前方、Z 上
    cl, cr = eye_centers(eo)
    ez = (cl.z + cr.z) / 2
    ey = (cl.y + cr.y) / 2
    ex = abs(cl.x - cr.x) / 2
    rng = np.random.default_rng(len(agent) * 7 + 3)
    H, W = col.shape[:2]
    # 肤色校正：面部区域均值对齐到目标肤色（保留明暗与细节）
    face = valid & (Z < ez + 0.05) & (Z > ez - 0.1) & (Y > ey - 0.06)
    mean = col[face].mean(0)
    col = col * (np.array(sp['tone'], np.float32) / np.maximum(mean, 1e-3))[None, None, :]
    # 发丝噪声：沿 z 拉长的细噪声
    def strands(sx, sz):
        n = rng.standard_normal((H, W)).astype(np.float32)
        k = np.ones(9, np.float32) / 9
        n = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 0, n)
        return np.clip(0.5 + n * 0.9, 0, 1)
    hair_n = strands(1, 6)
    hc = np.array(sp['hair'], np.float32)
    # ---- 头发（发际线）：按水平方位角插值发际线高度
    theta = np.arctan2(X, Y)                 # 0 = 正前方
    c = np.cos(theta)
    front_line = ez + 0.072
    side_line = ez + 0.03
    back_line = ez - 0.085
    line = np.where(c > 0, side_line + (front_line - side_line) * c ** 1.5, side_line + (back_line - side_line) * (-c) ** 0.8)
    # 耳朵周围留空
    ear = np.exp(-(((np.abs(X) - 0.075) / 0.018) ** 2 + ((Z - (ez - 0.012)) / 0.03) ** 2 + ((Y - (ey - 0.085)) / 0.035) ** 2))
    hairm = _smooth(Z - line, -0.004, 0.006) * (1 - _smooth(ear, 0.25, 0.6)) * valid
    if sp['locks']:
        lock = _smooth(np.abs(X), 0.056, 0.066) * _smooth(Z, ez - 0.075, ez - 0.055) * (Z < line + 0.02) \
            * _smooth(Y, ey - 0.075, ey - 0.06) * (1 - _smooth(Y, ey - 0.035, ey - 0.025))
        hairm = np.maximum(hairm, lock * valid)
    if sp['style'] == 'buzz':
        a = hairm * (0.72 + 0.22 * hair_n)
    else:
        a = hairm * (0.88 + 0.12 * hair_n)
    col = col * (1 - a[..., None]) + (hc * (0.75 + 0.5 * hair_n[..., None])) * a[..., None]
    rough = rough * (1 - hairm) + 0.62 * hairm
    # ---- 眉毛
    brow = np.zeros_like(X)
    for s in (1, -1):
        u = (s * X - (ex - 0.022)) / 0.045                # 0 = 眉头，1 = 眉尾
        zc = ez + 0.021 + 0.0065 * np.sin(np.clip(u, 0, 1) * math.pi * 0.9)
        th = (0.0042 * (1 - 0.55 * np.clip(u, 0, 1)) + 0.0008) * sp['brow_th']
        m = _smooth(u, -0.08, 0.06) * (1 - _smooth(u, 0.92, 1.05)) * np.exp(-((Z - zc) / th) ** 2) * (Y > ey - 0.035)
        brow = np.maximum(brow, m)
    brow = brow * valid * sp['brow'] * (0.55 + 0.45 * hair_n)
    col = col * (1 - brow[..., None]) + hc * brow[..., None]
    # 上睫毛线（细眼线），让眼睛在远处也读得出
    lash = np.zeros_like(X)
    for c in (cl, cr):
        dx = (X - c.x) / 0.0145
        zc = c.z + 0.0075 * np.sqrt(np.clip(1 - dx ** 2, 0, 1)) - 0.0005
        lash = np.maximum(lash, np.exp(-((Z - zc) / (0.0011 if sp['brow_th'] >= 0.9 else 0.0016)) ** 2) * (np.abs(dx) < 1.08) * (Y > c.y - 0.004))
    # 唇色
    if 'lips' in head.keys():
        lx, ly, lz, lw = head['lips']
        lipm = np.exp(-((X / (lw * 0.95)) ** 2 + ((Z - lz) / 0.0085) ** 4)) * (Y > ly - 0.02) * valid
        lc = np.array(sp['lips'], np.float32)
        k = 0.42 if sp['locks'] else 0.2
        col = col * (1 - (lipm * k)[..., None]) + (col * lc * 1.35) * (lipm * k)[..., None]
    lash = lash * valid * (0.85 if sp['brow_th'] >= 0.9 else 1.0)
    col = col * (1 - lash[..., None]) + hc * 0.6 * lash[..., None]
    # ---- 胡茬（衡）：鼻下到下巴、沿下颌到鬓角
    if sp['stubble'] > 0:
        mouth_z = ez - 0.07
        chin_z = ez - 0.118
        jaw = _smooth(Z, chin_z - 0.028, chin_z - 0.012) * (1 - _smooth(Z, mouth_z + 0.012, mouth_z + 0.02))
        side = (1 - _smooth(np.abs(X), 0.045, 0.06)) * (Y > ey - 0.06)
        lips = np.exp(-((X / 0.026) ** 2 + ((Z - mouth_z) / 0.0105) ** 2))
        st = jaw * side * (1 - _smooth(lips, 0.3, 0.7)) * valid
        dots = (rng.random((H, W)) > 0.45).astype(np.float32)
        st = st * sp['stubble'] * (0.5 + 0.3 * dots)
        col = col * (1 - st[..., None]) + hc * st[..., None]
    # 输出
    final = _img(f'head_{agent}_col', TEX)
    out = np.ones((H, W, 4), np.float32)
    out[..., :3] = np.clip(col, 0, 1)
    _set_px(final, out)
    orm = _img(f'head_{agent}_orm', TEX, data=True)
    o = np.ones((H, W, 4), np.float32)
    o[..., 1] = np.clip(rough * 1.2 + 0.18, 0.5, 0.92)
    o[..., 2] = 0.0
    _set_px(orm, o)
    nim = _img(f'head_{agent}_nrm', TEX, data=True)
    n = np.ones((H, W, 4), np.float32)
    n[..., :3] = nrm
    _set_px(nim, n)
    return final, orm, nim, hairm


def eye_texture(agent):
    """官方眼球贴图（CC0）按人设重新着色虹膜，缩到 512。"""
    sp = SPEC[agent]
    src = bpy.data.images.load(os.path.join(os.path.dirname(EYES), '..', 'materials', 'brown_eye.png'), check_existing=True)
    a = _px(src).copy()
    rgb = a[..., :3]
    mx = rgb.max(-1); mn = rgb.min(-1)
    sat = (mx - mn) / (mx + 1e-4)
    iris = _smooth(sat, 0.35, 0.6) * (rgb[..., 0] > rgb[..., 2])
    lum = rgb.mean(-1, keepdims=True)
    tint = np.array(sp['iris'], np.float32) / max(1e-3, max(sp['iris']))
    newc = lum * tint * 1.6
    a[..., :3] = rgb * (1 - iris[..., None]) + newc * iris[..., None]
    out = _img(f'head_{agent}_eye', 1024, alpha=True)
    _set_px(out, a)
    out.scale(512, 512)
    return out


def principled(name, col=None, orm=None, nrm=None, rough=0.5, blend=False):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Roughness'].default_value = rough
    if col:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = col
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        if blend:
            nt.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
            m.surface_render_method = 'BLENDED'
    if orm:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = orm
        sp = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs[1], b.inputs['Roughness'])
        nt.links.new(sp.outputs[2], b.inputs['Metallic'])
    if nrm:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = nrm
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m


def finalize(agent, head, eo, fin, orm, nim, hairm):
    """换成最终材质、只保留烘焙 UV，并按发型加头发外壳。"""
    sp = SPEC[agent]
    me = head.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers[0].name = 'UVMap'
    me.uv_layers[0].active_render = True
    me.uv_layers.active = me.uv_layers[0]
    skin = principled(f'head_skin_{agent}', fin, orm, nim)
    me.materials.clear(); me.materials.append(skin)
    eye = principled(f'head_eye_{agent}', eye_texture(agent), rough=0.08)
    eo.data.materials.clear(); eo.data.materials.append(eye)
    # 去掉透明角膜层（贴图右下角的圆），眼球本身用低粗糙度得到角膜高光，避免实时渲染的透明排序问题
    bm = bmesh.new(); bm.from_mesh(eo.data)
    uvl = bm.loops.layers.uv.active
    kill = []
    for f in bm.faces:
        u = sum(l[uvl].uv.x for l in f.loops) / len(f.loops)
        v = sum(l[uvl].uv.y for l in f.loops) / len(f.loops)
        if u > 0.85 and v < 0.15:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(eo.data); bm.free()
    hair = None
    if sp['style'] in ('swept', 'bun'):
        H, W = hairm.shape
        r, c = np.unravel_index(int(np.argmax(hairm)), hairm.shape)
        hair = hair_shell(agent, head, eo, skin, ((c + 0.5) / W, (r + 0.5) / H))
    return skin, eye, hair


def hair_shell(agent, head, eo, skin, hair_uv):
    """发际线以内的头皮面复制一层，沿法线外推（发际线处渐薄到 0），共用皮肤贴图；圆另加低发髻。"""
    sp = SPEC[agent]
    cl, cr = eye_centers(eo)
    ez = (cl.z + cr.z) / 2
    bm = bmesh.new()
    bm.from_mesh(head.data)
    bm.normal_update()
    ey = (cl.y + cr.y) / 2
    def mask(co):
        th = math.atan2(co.x, co.y)
        c = math.cos(th)
        line = (ez + 0.03 + (0.042) * c ** 1.5) if c > 0 else (ez + 0.03 + (-0.115) * (-c) ** 0.8)
        m = max(0.0, min(1.0, (co.z - line) / 0.02))
        if sp.get('locks') and abs(co.x) > 0.062 and ez - 0.06 < co.z and ey - 0.07 < co.y < ey - 0.032:
            m = max(m, 0.75)
        return m
    keep = [f for f in bm.faces if min(mask(v.co) for v in f.verts) > 0.55]
    kill = [f for f in bm.faces if f not in set(keep)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.normal_update()
    for v in bm.verts:
        m = mask(v.co)
        t = 0.009 if sp['style'] == 'swept' else 0.008
        if sp['style'] == 'swept':
            # 前额上方更蓬、向后梳
            t += 0.008 * max(0.0, math.cos(math.atan2(v.co.x, v.co.y))) * max(0.0, (v.co.z - ez - 0.06) / 0.05)
        v.co = v.co + v.normal * t * min(1.0, max(0.0, (m - 0.55) / 0.45) ** 0.6 + 0.15)
    if sp['style'] == 'bun':
        # 低发髻：枕骨下方一个压扁的球
        ys = [v.co.y for v in bm.verts]
        back = min(ys)
        r = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=1.0)
        for v in r['verts']:
            v.co = Vector((v.co.x * 0.045, back + 0.012 + v.co.y * 0.038, ez - 0.045 + v.co.z * 0.036))
        uvl = bm.loops.layers.uv.active
        sv = set(r['verts'])
        for f in bm.faces:
            if f.verts[0] in sv:
                for l in f.loops:
                    l[uvl].uv = hair_uv
    me = bpy.data.meshes.new(f'{agent}:hair')
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(skin)
    ob = bpy.data.objects.new(f'{agent}:hair', me)
    head.users_collection[0].objects.link(ob)
    return ob


def build(agent, export=False):
    from bl_ext.user_default.mpfb.services.humanservice import HumanService as HS
    h, eyes, missing = make_human(agent)
    HS.set_character_skin(None, h, skin_type='LAYERED')
    head, eo, tris, T = extract(agent, h, eyes)
    head.data.materials.clear()
    for m in h.data.materials:
        head.data.materials.append(m)
    imgs = bake(agent, head, eo)
    fin, orm, nim, hairm = paint(agent, head, eo, imgs)
    skin, eye, hair = finalize(agent, head, eo, fin, orm, nim, hairm)
    for o in list(bpy.context.window.scene.objects):
        if o.name.startswith('Human'):
            bpy.data.objects.remove(o, do_unlink=True)
    for k in ('DIFFUSE', 'ROUGHNESS', 'NORMAL', 'POSITION'):
        bpy.data.images.remove(imgs[k])
    tris = sum(len(p.vertices) - 2 for o in (head, eo, hair) if o for p in o.data.polygons)
    res = {'agent': agent, 'tris': tris, 'missing': missing}
    if export:
        res['export'] = export_head(agent, head, eo, hair)
    return res



def export_head(agent, head, eo, hair):
    """按套件约定导出：mixamorigHead__head / __eyes / __hair，头骨局部空间。"""
    sc = bpy.context.window.scene
    col = bpy.data.collections.get(f'HEXP_{agent}')
    if col:
        for o in list(col.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    else:
        col = bpy.data.collections.new(f'HEXP_{agent}')
        sc.collection.children.link(col)
    B3C = C3B.inverted()
    for src, piece in ((head, 'head'), (eo, 'eyes'), (hair, 'hair')):
        if src is None:
            continue
        me = src.data.copy()
        me.transform(B3C)          # Blender 坐标 → three 坐标（物体位移不计入）
        ob = bpy.data.objects.new(f'{agent}:exp_{piece}', me)
        ob.matrix_world = C3B
        ob['bone'] = 'mixamorigHead'
        ob['export_name'] = f'mixamorigHead__{piece}'
        col.objects.link(ob)
    CTX.update(col=col, scene=sc, kit=agent)
    for im in (bpy.data.images.get(f'head_{agent}_col'), bpy.data.images.get(f'head_{agent}_orm'),
               bpy.data.images.get(f'head_{agent}_nrm'), bpy.data.images.get(f'head_{agent}_eye')):
        if im and not im.packed_file:
            im.pack()
    r = export_kit(agent, os.path.join(OUT, f'head_{agent}.glb'))
    for o in list(col.objects):
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.meshes.remove(me)
    bpy.data.collections.remove(col)
    return r
