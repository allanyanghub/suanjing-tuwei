# Blender helper library for weapon modelling (exec'd inside Blender)
import bpy, bmesh, math, os
from mathutils import Vector, Matrix, Euler

R = math.radians
SCR = '/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns'
CTX = {'col': None, 'cut': None, 'scene': None}


def setup_scene(name):
    """New scene for a gun (never touches user scenes)."""
    sc = bpy.data.scenes.new(name + '_tmp')
    bpy.context.window.scene = sc
    for old in [s for s in bpy.data.scenes if s.name.startswith('W_') and s != sc]:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        for c in list(old.collection.children):
            bpy.data.collections.remove(c)
        bpy.data.scenes.remove(old)
    bpy.data.orphans_purge(do_recursive=True)
    sc.name = name
    try:
        sc.render.engine = 'CYCLES'
    except TypeError as e:
        print('engine', e)
    sc.cycles.device = 'GPU'
    sc.cycles.samples = 16
    sc.unit_settings.scale_length = 1.0
    col = bpy.data.collections.new(name + '_parts')
    sc.collection.children.link(col)
    cut = bpy.data.collections.new(name + '_cutters')
    sc.collection.children.link(cut)
    cut.hide_render = True
    CTX.update(col=col, cut=cut, scene=sc)
    # world / light for previews
    w = bpy.data.worlds.get('W_preview') or bpy.data.worlds.new('W_preview')
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = (0.5, 0.52, 0.55, 1)
    bg.inputs[1].default_value = 0.9
    sc.world = w
    for i, (loc, e) in enumerate([((1.5, -1.5, 1.8), 600), ((-2, 1, 1), 250), ((0, 2, -1), 120)]):
        ld = bpy.data.lights.new(f'{name}_L{i}', 'AREA')
        ld.energy = e
        ld.size = 1.5
        lo = bpy.data.objects.new(f'{name}_L{i}', ld)
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.collection.objects.link(lo)
    return sc


def _link(name, bm, mat=None, cutter=False, grp='body'):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    (CTX['cut'] if cutter else CTX['col']).objects.link(ob)
    if cutter:
        ob.display_type = 'WIRE'
        ob.hide_render = True
    if mat:
        me.materials.append(mat)
    ob['grp'] = grp
    return ob


def _fix_normals(bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def T(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))


def box(name, size, loc=(0, 0, 0), mat=None, rot=(0, 0, 0), cutter=False, grp='body', bev=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=T(loc, rot, size), verts=bm.verts)
    ob = _link(name, bm, mat, cutter, grp)
    if bev and not cutter:
        bevel(ob, bev)
    return ob


def prof(name, pts, width, mat=None, x=0.0, cutter=False, grp='body', bev=0.0012, seg=2):
    """Side profile pts=(y forward, z up) extruded along X, centred at x."""
    bm = bmesh.new()
    vs = [bm.verts.new((x - width / 2, y, z)) for (y, z) in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(width, 0, 0), verts=nv)
    _fix_normals(bm)
    ob = _link(name, bm, mat, cutter, grp)
    if bev and not cutter:
        bevel(ob, bev, seg)
    return ob


def front(name, pts, depth, mat=None, y=0.0, cutter=False, grp='body', bev=0.001, seg=2, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Front profile pts=(x, z) extruded along Y from y to y+depth."""
    bm = bmesh.new()
    vs = [bm.verts.new((px, y, pz)) for (px, pz) in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, depth, 0), verts=nv)
    bmesh.ops.transform(bm, matrix=T(loc, rot), verts=bm.verts)
    _fix_normals(bm)
    ob = _link(name, bm, mat, cutter, grp)
    if bev and not cutter:
        bevel(ob, bev, seg)
    return ob


def rrect(w, h, r, n=4, cx=0.0, cy=0.0):
    """Rounded rectangle points (x, y) CCW."""
    r = min(r, w / 2 - 1e-5, h / 2 - 1e-5)
    pts = []
    for (qx, qy, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = R(a0 + 90 * i / n)
            pts.append((cx + qx + r * math.cos(a), cy + qy + r * math.sin(a)))
    return pts


def lathe(name, pts, segs=24, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, closed=False, cutter=False, grp='body', bev=0.0, seg=2, axis='Y'):
    """Revolve profile pts=(radius, along) around local Y (default). closed: profile loop closed (tube)."""
    bm = bmesh.new()
    rings = []
    for (rad, a) in pts:
        if rad <= 1e-6:
            rings.append([bm.verts.new((0, a, 0))])
            continue
        ring = []
        for i in range(segs):
            t = 2 * math.pi * i / segs
            ring.append(bm.verts.new((rad * math.cos(t), a, rad * math.sin(t))))
        rings.append(ring)
    pairs = list(zip(rings[:-1], rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    for ra, rb in pairs:
        if len(ra) == 1 and len(rb) == 1:
            continue
        if len(ra) == 1:
            for i in range(segs):
                bm.faces.new((ra[0], rb[i], rb[(i + 1) % segs]))
        elif len(rb) == 1:
            for i in range(segs):
                bm.faces.new((ra[i], ra[(i + 1) % segs], rb[0]))
        else:
            for i in range(segs):
                bm.faces.new((ra[i], ra[(i + 1) % segs], rb[(i + 1) % segs], rb[i]))
    if not closed:
        for ring in (rings[0], rings[-1]):
            if len(ring) > 2:
                bm.faces.new(ring)
    m = T(loc, rot)
    if axis == 'Z':
        m = m @ Matrix.Rotation(R(90), 4, 'X')
    elif axis == 'X':
        m = m @ Matrix.Rotation(R(-90), 4, 'Z')
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    _fix_normals(bm)
    ob = _link(name, bm, mat, cutter, grp)
    if bev and not cutter:
        bevel(ob, bev, seg)
    return ob


def cyl(name, r, length, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, segs=24, r2=None, cutter=False, grp='body', bev=0.0, axis='Y', bore=0.0):
    """Cylinder along axis centred at loc."""
    r2 = r if r2 is None else r2
    if bore > 0:
        pts = [(r, -length / 2), (r2, length / 2), (bore, length / 2), (bore, -length / 2)]
        return lathe(name, pts, segs, loc, rot, mat, closed=True, cutter=cutter, grp=grp, bev=bev, axis=axis)
    return lathe(name, [(0, -length / 2), (r, -length / 2), (r2, length / 2), (0, length / 2)], segs, loc, rot, mat, cutter=cutter, grp=grp, bev=bev, axis=axis)


def loft(name, frames, prof_pts, mat=None, grp='body', bev=0.0, cap=True):
    """frames: list of (origin, xaxis, yaxis, sx, sy); prof_pts: unit-ish (x,y) loop scaled by sx, sy."""
    bm = bmesh.new()
    rings = []
    for (o, xa, ya, sx, sy) in frames:
        o, xa, ya = Vector(o), Vector(xa).normalized(), Vector(ya).normalized()
        rings.append([bm.verts.new(o + xa * (px * sx) + ya * (py * sy)) for (px, py) in prof_pts])
    n = len(prof_pts)
    for ra, rb in zip(rings[:-1], rings[1:]):
        for i in range(n):
            bm.faces.new((ra[i], ra[(i + 1) % n], rb[(i + 1) % n], rb[i]))
    if cap:
        bm.faces.new(rings[0])
        bm.faces.new(rings[-1])
    _fix_normals(bm)
    ob = _link(name, bm, mat, False, grp)
    if bev:
        bevel(ob, bev)
    return ob


def merge_bm(name, parts, mat=None, grp='body', cutter=False):
    """parts: list of (builder returning bmesh) -> one object. Use for arrays of small parts."""
    bm = bmesh.new()
    for p in parts:
        tmp = bpy.data.meshes.new('tmp')
        p.to_mesh(tmp)
        p.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    return _link(name, bm, mat, cutter, grp)


def bm_box(size, loc=(0, 0, 0), rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=T(loc, rot, size), verts=bm.verts)
    return bm


def bm_cyl(r, length, loc=(0, 0, 0), rot=(0, 0, 0), segs=12, axis='Y'):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=length)
    m = T(loc, rot)
    if axis == 'Y':
        m = m @ Matrix.Rotation(R(90), 4, 'X')
    elif axis == 'X':
        m = m @ Matrix.Rotation(R(90), 4, 'Y')
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def bevel(ob, w, seg=2, angle=32, clamp=True):
    m = ob.modifiers.new('bev', 'BEVEL')
    m.width = w
    m.segments = seg
    m.limit_method = 'ANGLE'
    m.angle_limit = R(angle)
    m.use_clamp_overlap = clamp
    m.miter_outer = 'MITER_ARC'
    return m


def cut(ob, cutter, op='DIFFERENCE'):
    """Boolean placed BEFORE any bevel modifier."""
    m = ob.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.solver = 'EXACT'
    m.object = cutter
    m.use_self = True
    m.use_hole_tolerant = True
    # move to before bevel
    idx = [i for i, mm in enumerate(ob.modifiers) if mm.type == 'BEVEL']
    if idx:
        with bpy.context.temp_override(object=ob):
            bpy.ops.object.modifier_move_to_index(modifier=m.name, index=idx[0])
    return m


def subsurf(ob, lv=1):
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = lv
    m.render_levels = lv
    return m


def apply_all(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    for ob in objs:
        if ob.type != 'MESH' or not ob.modifiers:
            continue
        eo = ob.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(eo, preserve_all_data_layers=True, depsgraph=dg)
        old = ob.data
        ob.modifiers.clear()
        ob.data = me
        if old.users == 0:
            bpy.data.meshes.remove(old)


def shade(ob, ang=34):
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=R(ang))
    except Exception:
        with bpy.context.temp_override(object=ob, selected_editable_objects=[ob], active_object=ob):
            bpy.ops.object.shade_smooth_by_angle(angle=R(ang))
    m = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
    m.keep_sharp = True
    m.weight = 50


def join(objs, name):
    objs = [o for o in objs if o.type == 'MESH']
    if not objs:
        return None
    a = objs[0]
    if len(objs) > 1:
        select(objs)
        bpy.ops.object.join()
    a.name = name
    a.data.name = name
    return a


def clear_cutters():
    for ob in list(CTX['cut'].objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.02
    e.location = loc
    CTX['col'].objects.link(e)
    if parent:
        e.parent = parent
    return e


def finalize(groups, empties):
    """Apply modifiers, join by grp, shade + weighted normals, apply again.
    groups: list of group names; parts tagged ob['grp']. Returns dict name->obj"""
    parts = [o for o in CTX['col'].objects if o.type == 'MESH']
    apply_all(parts)
    clear_cutters()
    out = {}
    bygrp = {g: [o for o in parts if o.get('grp') == g] for g in groups}
    for g in groups:
        objs = bygrp[g]
        if objs:
            out[g] = join(objs, g)
    for ob in out.values():
        shade(ob)
    apply_all(list(out.values()))
    return out


# ---------------------------------------------------------------- materials

def sid(coll, ident):
    return next(x for x in coll if x.identifier == ident)


def _sock(node, name):
    for s in node.inputs:
        if s.name == name or s.identifier == name:
            return s
    raise KeyError(name)


def pmat(name, base, metal=0.0, rough=0.5, rough_var=0.12, wear=0.0, wear_col=(0.42, 0.42, 0.42), wear_metal=1.0,
         bump=0.15, bump_scale=900.0, blotch=0.06, stipple=0.0, stipple_scale=700.0, wood=False, wood2=None, coat=0.0,
         edge_r=0.0012, spec=0.5):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED')
    tc = N.new('ShaderNodeTexCoord')
    # big blotchy variation
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 35.0; nz.inputs['Detail'].default_value = 6.0
    L.new(tc.outputs['Object'], nz.inputs['Vector'])
    # fine noise for micro bump
    fn = N.new('ShaderNodeTexNoise'); fn.inputs['Scale'].default_value = bump_scale; fn.inputs['Detail'].default_value = 3.0
    L.new(tc.outputs['Object'], fn.inputs['Vector'])
    # edge mask via bevel normal
    bv = N.new('ShaderNodeBevel'); bv.inputs['Radius'].default_value = edge_r; bv.samples = 8
    geo = N.new('ShaderNodeNewGeometry')
    dot = N.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
    L.new(bv.outputs['Normal'], dot.inputs[0]); L.new(geo.outputs['Normal'], dot.inputs[1])
    edge = N.new('ShaderNodeMapRange'); edge.inputs['From Min'].default_value = 0.995; edge.inputs['From Max'].default_value = 0.93
    L.new(dot.outputs['Value'], edge.inputs['Value'])
    # break edge with noise
    wn = N.new('ShaderNodeTexNoise'); wn.inputs['Scale'].default_value = 60.0; wn.inputs['Detail'].default_value = 8.0
    L.new(tc.outputs['Object'], wn.inputs['Vector'])
    wm = N.new('ShaderNodeMath'); wm.operation = 'MULTIPLY'
    L.new(edge.outputs['Result'], wm.inputs[0]); L.new(wn.outputs['Fac'], wm.inputs[1])
    wr = N.new('ShaderNodeMapRange'); wr.inputs['From Min'].default_value = 0.4; wr.inputs['From Max'].default_value = 0.56
    wr.inputs['To Max'].default_value = wear
    L.new(wm.outputs['Value'], wr.inputs['Value'])
    wearf = wr.outputs['Result']
    # base colour
    if wood:
        mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (240.0, 7.0, 240.0)
        L.new(tc.outputs['Object'], mp.inputs['Vector'])
        gn = N.new('ShaderNodeTexNoise'); gn.inputs['Scale'].default_value = 1.0; gn.inputs['Detail'].default_value = 9.0
        gn.inputs['Roughness'].default_value = 0.62; gn.inputs['Distortion'].default_value = 0.6
        L.new(mp.outputs['Vector'], gn.inputs['Vector'])
        wv = N.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'Z'
        wv.inputs['Scale'].default_value = 2.0; wv.inputs['Distortion'].default_value = 7.0; wv.inputs['Detail'].default_value = 3.0
        mp2 = N.new('ShaderNodeMapping'); mp2.inputs['Scale'].default_value = (6.0, 0.6, 9.0)
        L.new(tc.outputs['Object'], mp2.inputs['Vector']); L.new(mp2.outputs['Vector'], wv.inputs['Vector'])
        mx = N.new('ShaderNodeMath'); mx.operation = 'MULTIPLY_ADD'; mx.inputs[1].default_value = 0.22
        L.new(wv.outputs['Fac'], mx.inputs[0]); L.new(gn.outputs['Fac'], mx.inputs[2])
        ramp = N.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.35
        ramp.color_ramp.elements[0].color = (*(wood2 or tuple(c * 0.45 for c in base)), 1)
        ramp.color_ramp.elements[1].position = 0.85
        ramp.color_ramp.elements[1].color = (*base, 1)
        L.new(mx.outputs['Value'], ramp.inputs['Fac'])
        tone = N.new('ShaderNodeMix'); tone.data_type = 'RGBA'; tone.blend_type = 'MULTIPLY'
        tone.inputs['Factor'].default_value = 0.35
        L.new(ramp.outputs['Color'], sid(tone.inputs, 'A_Color')); L.new(nz.outputs['Color'], sid(tone.inputs, 'B_Color'))
        col0 = sid(tone.outputs, 'Result_Color')
        bwood = N.new('ShaderNodeBump'); bwood.inputs['Strength'].default_value = 0.05; bwood.inputs['Distance'].default_value = 0.0003
        L.new(gn.outputs['Fac'], bwood.inputs['Height'])
    else:
        mixb = N.new('ShaderNodeMix'); mixb.data_type = 'RGBA'; mixb.blend_type = 'MULTIPLY'
        mixb.inputs['Factor'].default_value = blotch
        sid(mixb.inputs, 'A_Color').default_value = (*base, 1)
        L.new(nz.outputs['Color'], sid(mixb.inputs, 'B_Color'))
        col0 = sid(mixb.outputs, 'Result_Color')
        bwood = None
    mixw = N.new('ShaderNodeMix'); mixw.data_type = 'RGBA'
    L.new(wearf, mixw.inputs['Factor']); L.new(col0, sid(mixw.inputs, 'A_Color')); sid(mixw.inputs, 'B_Color').default_value = (*wear_col, 1)
    L.new(sid(mixw.outputs, 'Result_Color'), _sock(bsdf, 'Base Color'))
    # metallic
    mm = N.new('ShaderNodeMapRange'); mm.inputs['To Min'].default_value = metal; mm.inputs['To Max'].default_value = wear_metal
    L.new(wearf, mm.inputs['Value'])
    L.new(mm.outputs['Result'], _sock(bsdf, 'Metallic'))
    # roughness = rough + var*(noise-0.5) - wear*0.25
    rv = N.new('ShaderNodeMapRange'); rv.inputs['To Min'].default_value = rough - rough_var; rv.inputs['To Max'].default_value = rough + rough_var
    L.new(nz.outputs['Fac'], rv.inputs['Value'])
    rw = N.new('ShaderNodeMath'); rw.operation = 'MULTIPLY_ADD'; rw.inputs[1].default_value = -0.22
    L.new(wearf, rw.inputs[0]); L.new(rv.outputs['Result'], rw.inputs[2])
    rc = N.new('ShaderNodeClamp'); rc.inputs['Min'].default_value = 0.08
    L.new(rw.outputs['Value'], rc.inputs['Value'])
    L.new(rc.outputs['Result'], _sock(bsdf, 'Roughness'))
    # bump: fine noise (+ stipple voronoi)
    b1 = N.new('ShaderNodeBump'); b1.inputs['Strength'].default_value = bump; b1.inputs['Distance'].default_value = 0.0002
    L.new(fn.outputs['Fac'], b1.inputs['Height'])
    last = b1
    if stipple > 0:
        vo = N.new('ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = stipple_scale
        L.new(tc.outputs['Object'], vo.inputs['Vector'])
        b2 = N.new('ShaderNodeBump'); b2.inputs['Strength'].default_value = stipple; b2.inputs['Distance'].default_value = 0.0004
        L.new(vo.outputs['Distance'], b2.inputs['Height']); L.new(b1.outputs['Normal'], b2.inputs['Normal'])
        last = b2
    if bwood:
        L.new(last.outputs['Normal'], bwood.inputs['Normal'])
        last = bwood
    L.new(last.outputs['Normal'], _sock(bsdf, 'Normal'))
    if coat:
        _sock(bsdf, 'Coat Weight').default_value = coat
    m['baked'] = True
    return m


def glass_mat(name, col=(0.05, 0.1, 0.12), alpha=0.25):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    _sock(b, 'Base Color').default_value = (*col, 1)
    _sock(b, 'Roughness').default_value = 0.03
    _sock(b, 'Metallic').default_value = 0.0
    _sock(b, 'Alpha').default_value = alpha
    try:
        m.surface_render_method = 'BLENDED'
    except Exception:
        pass
    m['baked'] = False
    m.use_backface_culling = False
    return m


# ---------------------------------------------------------------- UV + bake

def uv_all(objs, margin=0.003):
    objs = [o for o in objs if o.type == 'MESH']
    for o in objs:
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
    select(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=R(55), island_margin=margin, scale_to_bounds=False, correct_aspect=True)
    bpy.ops.uv.select_all(action='SELECT')
    try:
        bpy.ops.uv.pack_islands(margin=margin, rotate=True, shape_method='CONCAVE')
    except TypeError:
        bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def select(objs):
    vl = bpy.context.view_layer
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    vl.objects.active = objs[0]


def _img(name, size, data):
    im = bpy.data.images.get(name)
    if im:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return im


def bake_gun(gid, objs, size=2048, ao_samples=48):
    """Bake every baked material on objs into one atlas; replace with single PBR material."""
    import numpy as np
    sc = bpy.context.scene
    objs = [o for o in objs if o.type == 'MESH']
    mats = []
    for o in objs:
        for s in o.material_slots:
            if s.material and s.material.get('baked') and s.material not in mats:
                mats.append(s.material)
    imgs = {k: _img(f'{gid}_{k}', size, k != 'col') for k in ('col', 'rough', 'metal', 'nrm', 'ao')}
    # add image node (active) to every baked material
    tex_nodes = {}
    for m in mats:
        tn = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex_nodes[m.name] = tn
        m.node_tree.nodes.active = tn
    # non-baked (glass) materials: give them a dummy image node too so bake doesn't fail
    dummy = _img(f'{gid}_dummy', 8, True)
    extra = []
    for o in objs:
        for s in o.material_slots:
            m = s.material
            if m and not m.get('baked'):
                if m.name not in tex_nodes:
                    tn = m.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = dummy
                    m.node_tree.nodes.active = tn
                    tex_nodes[m.name] = tn
                    extra.append(m)
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    sel = dict(active_object=objs[0], object=objs[0], selected_objects=objs, selected_editable_objects=objs)

    def run(kind, img, **kw):
        for m in mats:
            tex_nodes[m.name].image = img
            m.node_tree.nodes.active = tex_nodes[m.name]
        select(objs)
        bpy.ops.object.bake(type=kind, margin=6, use_clear=True, **kw)

    def emit_pass(sock_name, img):
        saved = []
        for m in mats:
            nt = m.node_tree
            b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
            em = nt.nodes.new('ShaderNodeEmission')
            s = _sock(b, sock_name)
            if s.is_linked:
                nt.links.new(s.links[0].from_socket, em.inputs['Color'])
            else:
                v = s.default_value
                em.inputs['Color'].default_value = (v[0], v[1], v[2], 1) if hasattr(v, '__len__') else (v, v, v, 1)
            prev = out.inputs['Surface'].links[0].from_socket
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
            saved.append((nt, out, prev, em))
        run('EMIT', img)
        for nt, out, prev, em in saved:
            nt.links.new(prev, out.inputs['Surface'])
            nt.nodes.remove(em)

    sc.cycles.samples = 1
    emit_pass('Base Color', imgs['col'])
    emit_pass('Roughness', imgs['rough'])
    emit_pass('Metallic', imgs['metal'])
    sc.cycles.samples = 4
    run('NORMAL', imgs['nrm'], normal_space='TANGENT')
    sc.cycles.samples = ao_samples
    run('AO', imgs['ao'])
    # combine ORM, multiply a little AO into colour
    px = lambda im: np.array(im.pixels[:], dtype=np.float32).reshape(size, size, 4)
    ao = px(imgs['ao'])[:, :, 0]
    ro = px(imgs['rough'])[:, :, 0]
    me = px(imgs['metal'])[:, :, 0]
    orm = _img(f'{gid}_orm', size, True)
    a = np.ones((size, size, 4), np.float32)
    a[:, :, 0] = ao; a[:, :, 1] = ro; a[:, :, 2] = me
    orm.pixels[:] = a.ravel()
    col = px(imgs['col'])
    k = (0.72 + 0.28 * ao)[:, :, None]
    col[:, :, :3] *= k  # sRGB-space multiply: fine for subtle cavity darkening
    imgs['col'].pixels[:] = col.ravel()
    d = os.path.join(SCR, 'bake', gid)
    os.makedirs(d, exist_ok=True)
    for key, im in (('col', imgs['col']), ('orm', orm), ('nrm', imgs['nrm'])):
        im.filepath_raw = os.path.join(d, f'{gid}_{key}.png')
        im.file_format = 'PNG'
        im.save()
    # final material
    fm = bpy.data.materials.get(gid + '_mat')
    if fm:
        bpy.data.materials.remove(fm)
    fm = bpy.data.materials.new(gid + '_mat')
    fm.use_nodes = True
    nt = fm.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = imgs['col']
    to = nt.nodes.new('ShaderNodeTexImage'); to.image = orm
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = imgs['nrm']
    sp = nt.nodes.new('ShaderNodeSeparateColor')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tc.outputs['Color'], _sock(b, 'Base Color'))
    nt.links.new(to.outputs['Color'], sp.inputs[0])
    nt.links.new(sp.outputs[1], _sock(b, 'Roughness'))
    nt.links.new(sp.outputs[2], _sock(b, 'Metallic'))
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], _sock(b, 'Normal'))
    # occlusion via glTF Material Output group
    grp = bpy.data.node_groups.get('glTF Material Output')
    if grp is None:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = grp
    nt.links.new(sp.outputs[0], gn.inputs[0])
    fm['baked'] = False
    fm.use_backface_culling = True
    # swap
    for o in objs:
        for s in o.material_slots:
            if s.material in mats:
                s.material = fm
        # merge duplicate slots
        uniq = []
        for s in o.material_slots:
            if s.material not in uniq:
                uniq.append(s.material)
        if len(uniq) < len(o.material_slots):
            remap = [uniq.index(s.material) for s in o.material_slots]
            idx = [remap[p.material_index] for p in o.data.polygons]
            o.data.materials.clear()
            for mm in uniq:
                o.data.materials.append(mm)
            for p, i in zip(o.data.polygons, idx):
                p.material_index = i
    for m in extra:
        m.node_tree.nodes.remove(tex_nodes[m.name])
    return fm


def tri_count(objs):
    n = 0
    for o in objs:
        if o.type == 'MESH':
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n


def export_glb(gid, root):
    path = os.path.join('/Users/Mac012/CODE/奥数通关游戏/public/assets/weapons', gid + '.glb')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    objs = [root] + list(root.children_recursive)
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_image_format='JPEG', export_jpeg_quality=86, export_extras=False,
                              export_lights=False, export_cameras=False, export_animations=False, use_active_scene=True)
    bpy.data.libraries.write(os.path.join(SCR, gid + '.blend'), {bpy.context.scene}, fake_user=True)
    return path, os.path.getsize(path)


def set_origin(ob, pt):
    pt = Vector(pt)
    d = pt - ob.matrix_world.translation
    ob.data.transform(Matrix.Translation(-d))
    ob.location = ob.location + d


def mats():
    M = {}
    M['alu'] = pmat('m_alu', (0.06, 0.061, 0.066), 0.35, 0.42, rough_var=0.1, wear=0.6, wear_col=(0.6, 0.6, 0.62), bump=0.08)
    M['steel'] = pmat('m_steel', (0.2, 0.2, 0.21), 1.0, 0.38, rough_var=0.1, wear=0.6, wear_col=(0.65, 0.65, 0.67), bump=0.1)
    M['parker'] = pmat('m_parker', (0.05, 0.05, 0.05), 0.7, 0.62, rough_var=0.08, wear=0.6, wear_col=(0.5, 0.5, 0.52), bump=0.35, bump_scale=1600)
    M['poly'] = pmat('m_poly', (0.045, 0.045, 0.048), 0.0, 0.6, rough_var=0.08, wear=0.5, wear_col=(0.07, 0.07, 0.072), wear_metal=0.0, bump=0.12)
    M['grip'] = pmat('m_grip', (0.045, 0.045, 0.048), 0.0, 0.7, rough_var=0.06, wear=0.4, wear_col=(0.08, 0.08, 0.08), wear_metal=0.0, bump=0.1, stipple=0.45, stipple_scale=900)
    M['rubber'] = pmat('m_rubber', (0.018, 0.018, 0.018), 0.0, 0.85, rough_var=0.05, wear=0.0, bump=0.2, stipple=0.2, stipple_scale=1400)
    M['cera'] = pmat('m_cera', (0.1, 0.105, 0.11), 0.15, 0.55, rough_var=0.08, wear=0.55, wear_col=(0.55, 0.55, 0.57), bump=0.12)
    M['fde'] = pmat('m_fde', (0.33, 0.24, 0.14), 0.0, 0.62, rough_var=0.08, wear=0.5, wear_col=(0.45, 0.36, 0.24), wear_metal=0.0, bump=0.12)
    M['fde_grip'] = pmat('m_fde_grip', (0.33, 0.24, 0.14), 0.0, 0.72, rough_var=0.06, wear=0.3, wear_col=(0.45, 0.36, 0.24), wear_metal=0.0, bump=0.1, stipple=0.45, stipple_scale=900)
    M['wood'] = pmat('m_wood', (0.16, 0.07, 0.03), 0.0, 0.36, rough_var=0.08, wear=0.45, wear_col=(0.26, 0.14, 0.07), wear_metal=0.0, bump=0.03, wood=True, wood2=(0.045, 0.018, 0.008), coat=0.3)
    M['brass'] = pmat('m_brass', (0.78, 0.52, 0.2), 1.0, 0.28, rough_var=0.1, wear=0.0, bump=0.03)
    M['hull'] = pmat('m_hull', (0.32, 0.025, 0.02), 0.0, 0.45, rough_var=0.08, wear=0.0, bump=0.08)
    M['glass'] = glass_mat('m_glass', (0.06, 0.12, 0.1), 0.22)
    M['lens'] = pmat('m_lens', (0.01, 0.015, 0.03), 0.0, 0.05, rough_var=0.02, wear=0.0, bump=0.0, spec=1.0)
    return M


def rail_bm(y0, y1, ztop, xw=0.0212):
    """Picatinny rail as list of bmesh (base dovetail + teeth)."""
    out = []
    # dovetail cross-section (x,z)
    h = 0.0094
    b = ztop - h
    pts = [(-0.0105, b), (0.0105, b), (0.0105, b + 0.0025), (0.0075, b + 0.0045), (xw / 2, b + 0.0065), (xw / 2, ztop - 0.003),
           (xw / 2 - 0.0012, ztop - 0.003 + 0.0012) ]
    return pts


def tube_ring_pts(R0, r0, n=10):
    return [(R0 + r0 * math.cos(2 * math.pi * i / n), r0 * math.sin(2 * math.pi * i / n)) for i in range(n)]


def torus(name, R0, r0, loc, rot, mat, segs=16, n=8, grp='body'):
    return lathe(name, tube_ring_pts(R0, r0, n), segs, loc, rot, mat, closed=True, grp=grp)


def picatinny(name, y0, y1, ztop, mat, grp='body', zbase=None, w=0.0212):
    """Picatinny rail with slots every 10mm. Rail spans y0..y1, top surface at ztop."""
    zb = ztop - 0.0094 if zbase is None else zbase
    pts = [(-0.0105, zb), (0.0105, zb), (0.0105, ztop - 0.0065), (w / 2 - 0.0025, ztop - 0.0042), (w / 2, ztop - 0.0042),
           (w / 2, ztop - 0.0015), (w / 2 - 0.0015, ztop), (-w / 2 + 0.0015, ztop), (-w / 2, ztop - 0.0015), (-w / 2, ztop - 0.0042),
           (-w / 2 + 0.0025, ztop - 0.0042), (-0.0105, ztop - 0.0065)]
    ob = front(name, pts, y1 - y0, mat, y=y0, grp=grp, bev=0)
    parts = []
    y = y0 + 0.0045
    while y + 0.0053 < y1 - 0.002:
        parts.append(bm_box((w + 0.01, 0.0053, 0.0062), (0, y + 0.00265, ztop + 0.0002)))
        y += 0.01
    if parts:
        c = merge_bm(name + '_cut', parts, cutter=True)
        cut(ob, c)
    bevel(ob, 0.0004, 1, angle=40)
    return ob


GROUPS = ['body', 'magazine', 'bolt', 'slide', 'trigger', 'pump', 'shell', 'hammer', 'cylinder', 'bipod', 'cover', 'pin', 'lever', 'stock']


def finish_gun(gid, marks, origins, size=2048, bake=True, decimate=None):
    """marks: empties (world pts before shift; must include grip_r). origins: group -> pivot pt."""
    out = finalize(GROUPS, [])
    for g, pt in origins.items():
        if g in out:
            set_origin(out[g], pt)
    for g, r in (decimate or {}).items():
        if g in out:
            dm = out[g].modifiers.new('dec', 'DECIMATE')
            dm.ratio = r
            dm.use_collapse_triangulate = True
    if decimate:
        apply_all(list(out.values()))
    objs = list(out.values())
    for o in objs:
        o.data.validate(clean_customdata=False)
    # drop empty material slots
    select(objs)
    bpy.ops.object.material_slot_remove_unused()
    if bake:
        uv_all(objs)
        bake_gun(gid, objs, size=size)
    g = Vector(marks['grip_r'])
    root = bpy.data.objects.new(gid, None)
    root.empty_display_size = 0.05
    CTX['col'].objects.link(root)
    for o in objs:
        o.location = o.location - g
        o.parent = root
    for k, v in marks.items():
        e = empty(k, Vector(v) - g)
        e.parent = root
    print(gid, 'tris', tri_count(objs), {k: tri_count([v]) for k, v in out.items()})
    return root, out


def use_reencoded():
    for im in list(bpy.data.images):
        b = os.path.basename(bpy.path.abspath(im.filepath)) or im.name
        if not b.lower().endswith('.jpg'):
            b = im.name if im.name.lower().endswith('.jpg') else im.name + '.jpg'
        alt = os.path.join(SCR, 'ph_re', b)
        if os.path.exists(alt):
            n = bpy.data.images.load(alt)
            n.colorspace_settings.name = im.colorspace_settings.name
            im.user_remap(n)
            bpy.data.images.remove(im)
            n.name = b.rsplit('.', 1)[0]
            print('reencoded', b)


def ring_loft(name, rings, mat=None, grp='body', cap=True, mat_idx=None):
    """rings: list of lists of 3D points (same count). mat_idx(i_ring, j_seg) -> material slot index or None."""
    bm = bmesh.new()
    vr = [[bm.verts.new(Vector(p)) for p in r] for r in rings]
    n = len(rings[0])
    for i in range(len(vr) - 1):
        a, b = vr[i], vr[i + 1]
        for j in range(n):
            f = bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
            if mat_idx:
                k = mat_idx(i, j)
                if k:
                    f.material_index = k
    if cap:
        bm.faces.new(vr[0])
        bm.faces.new(vr[-1])
    _fix_normals(bm)
    return _link(name, bm, mat, False, grp)


def extra_mats():
    M = {}
    M['coat'] = pmat('m_coat', (0.035, 0.036, 0.038), 0.55, 0.5, rough_var=0.08, wear=0.7, wear_col=(0.55, 0.55, 0.57), bump=0.15, bump_scale=1400)
    M['bare'] = pmat('m_bare', (0.55, 0.55, 0.56), 1.0, 0.22, rough_var=0.06, wear=0.0, bump=0.05, bump_scale=3000)
    M['micarta'] = pmat('m_micarta', (0.075, 0.08, 0.05), 0.0, 0.62, rough_var=0.1, wear=0.4, wear_col=(0.13, 0.13, 0.09), wear_metal=0.0, bump=0.2, stipple=0.35, stipple_scale=1300)
    M['olive'] = pmat('m_olive', (0.07, 0.08, 0.045), 0.1, 0.55, rough_var=0.08, wear=0.6, wear_col=(0.45, 0.45, 0.42), wear_metal=1.0, bump=0.15)
    M['grey_can'] = pmat('m_can', (0.16, 0.165, 0.17), 0.2, 0.5, rough_var=0.1, wear=0.6, wear_col=(0.6, 0.6, 0.6), wear_metal=1.0, bump=0.1)
    M['band_y'] = pmat('m_band_y', (0.55, 0.38, 0.03), 0.0, 0.45, rough_var=0.06, wear=0.5, wear_col=(0.4, 0.4, 0.4), wear_metal=1.0, bump=0.05)
    M['band_w'] = pmat('m_band_w', (0.6, 0.6, 0.58), 0.0, 0.45, rough_var=0.06, wear=0.4, wear_col=(0.35, 0.35, 0.35), wear_metal=1.0, bump=0.05)
    M['alu_bright'] = pmat('m_alub', (0.45, 0.46, 0.47), 1.0, 0.35, rough_var=0.1, wear=0.0, bump=0.08)
    M['bronze'] = pmat('m_bronze', (0.12, 0.1, 0.07), 0.6, 0.45, rough_var=0.08, wear=0.6, wear_col=(0.5, 0.45, 0.35), bump=0.1)
    return M
