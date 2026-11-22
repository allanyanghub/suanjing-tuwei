# First-person gloved hand (right, gripping a vertical cylinder) + forearm sleeve + accent wrist band.
# Blender: +Y forward, +Z up, +X right. Hand origin = centre of gripped cylinder; grip axis = +Z.
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())
setup_scene('W_arms')

GL = pmat('m_glove', (0.028, 0.029, 0.025), 0.0, 0.8, rough_var=0.08, wear=0.25, wear_col=(0.09, 0.09, 0.085), wear_metal=0.0,
          bump=0.35, bump_scale=2500, stipple=0.12, stipple_scale=1800)
PAD = pmat('m_pad', (0.06, 0.058, 0.052), 0.0, 0.55, rough_var=0.06, wear=0.2, wear_col=(0.06, 0.06, 0.06), wear_metal=0.0, bump=0.12)
SL = pmat('m_sleeve', (0.09, 0.085, 0.06), 0.0, 0.9, rough_var=0.05, wear=0.0, bump=0.6, bump_scale=3500, stipple=0.15, stipple_scale=2600)
# camo: noise -> constant ramp feeding the base colour mix
_nt = SL.node_tree
_mix = next(n for n in _nt.nodes if n.bl_idname == 'ShaderNodeMix' and n.blend_type == 'MULTIPLY')
_tc = next(n for n in _nt.nodes if n.bl_idname == 'ShaderNodeTexCoord')
_cn = _nt.nodes.new('ShaderNodeTexNoise'); _cn.inputs['Scale'].default_value = 28.0; _cn.inputs['Detail'].default_value = 3.0; _cn.inputs['Roughness'].default_value = 0.6
_nt.links.new(_tc.outputs['Object'], _cn.inputs['Vector'])
_cr = _nt.nodes.new('ShaderNodeValToRGB'); _cr.color_ramp.interpolation = 'CONSTANT'
_e = _cr.color_ramp.elements
_e[0].position = 0.0; _e[0].color = (0.11, 0.1, 0.068, 1)
_e[1].position = 0.47; _e[1].color = (0.055, 0.062, 0.035, 1)
_x = _cr.color_ramp.elements.new(0.56); _x.color = (0.075, 0.05, 0.03, 1)
_x2 = _cr.color_ramp.elements.new(0.64); _x2.color = (0.12, 0.11, 0.075, 1)
_nt.links.new(_cn.outputs['Fac'], _cr.inputs['Fac'])
_nt.links.new(_cr.outputs['Color'], sid(_mix.inputs, 'A_Color'))
STR = pmat('m_strap', (0.03, 0.03, 0.03), 0.0, 0.7, rough_var=0.05, wear=0.15, wear_col=(0.07, 0.07, 0.07), wear_metal=0.0, bump=0.6, bump_scale=4000)
BAND = pmat('m_band', (0.5, 0.5, 0.5), 0.0, 0.45, rough_var=0.05, wear=0.0, bump=0.05)


def seg(name, a, b, ra, rb, mat, grp='hand', n=14, caps=True):
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    pts = []
    if caps:
        for i in range(4):
            t = R(90 - 22.5 * i)
            pts.append((ra * math.cos(t), -ra * math.sin(t) * 0.9 + 0.0))
    pts = [(0.0, -ra * 0.9)] + [(ra * math.sin(R(30 * i)), -ra * 0.9 * math.cos(R(30 * i))) for i in range(1, 4)] + \
          [(rb * math.sin(R(90 + 30 * i)), L - rb * 0.9 * math.cos(R(90 + 30 * i))) for i in range(0, 3)] + [(0.0, L + rb * 0.9)]
    ob = lathe(name, pts, n, mat=mat, grp=grp)
    q = Vector((0, 1, 0)).rotation_difference(d.normalized())
    ob.data.transform(Matrix.Translation(a) @ q.to_matrix().to_4x4())
    return ob


def chain(name, pts, radii, mat, grp='hand'):
    obs = []
    for i in range(len(pts) - 1):
        obs.append(seg(f'{name}{i}', pts[i], pts[i + 1], radii[i], radii[i + 1], mat, grp))
    return obs


def ell(a, b, z, th):
    t = R(th)
    return Vector((a * math.cos(t), b * math.sin(t), z))


# ---- fingers wrap the grip (ellipse semi-axes in X / Y, finger centreline)
FA, FB = 0.026, 0.034
fingers = {
    'middle': (0.004, 0.0088, 1.0),
    'ring': (-0.016, 0.0084, 0.95),
    'pinky': (-0.034, 0.0075, 0.82),
}
for k, (z, r, s) in fingers.items():
    mcp = Vector((0.034, -0.006, z + 0.002))
    p1 = ell(FA, FB, z, 55)
    p2 = ell(FA, FB, z - 0.001, 112 if s > 0.9 else 105)
    tip = ell(FA * 0.96, FB * 0.92, z - 0.002, 148 if s > 0.9 else 138)
    chain(k, [mcp, p1, p2, tip], [r * 1.05, r, r * 0.92, r * 0.85], GL)
    # knuckle pad on proximal phalanx (outside)
    seg(k + '_pad', mcp.lerp(p1, 0.3) + Vector((0.005, 0.003, 0)), mcp.lerp(p1, 0.75) + Vector((0.004, 0.006, 0)), r * 0.75, r * 0.7, PAD)
# index finger: along the frame into the trigger guard
idx = [Vector((0.034, -0.004, 0.024)), Vector((0.03, 0.028, 0.029)), Vector((0.017, 0.05, 0.028)), Vector((0.006, 0.064, 0.022))]
chain('index', idx, [0.0092, 0.0088, 0.0082, 0.0075], GL)
seg('index_pad', idx[0].lerp(idx[1], 0.25) + Vector((0.005, 0, 0.002)), idx[0].lerp(idx[1], 0.75) + Vector((0.005, 0, 0.002)), 0.0068, 0.0065, PAD)

# ---- palm + back of hand (loft from wrist to knuckle line)
W = Vector((0.016, -0.085, -0.008))
frames = []
for (t, w, th) in ((0.0, 0.056, 0.038), (0.3, 0.07, 0.04), (0.65, 0.08, 0.036), (1.0, 0.078, 0.026)):
    c = W.lerp(Vector((0.03, -0.012, -0.004)), t)
    ax = (Vector((0.03, -0.012, -0.004)) - W).normalized()
    up = Vector((0, 0, 1))
    nrm = ax.cross(up).normalized()  # thickness direction
    frames.append((c, (0, 0, 1), nrm, w, th))
palm = loft('palm', frames, rrect(1.0, 1.0, 0.45, 5), GL, grp='hand')
subsurf(palm, 1)
# back-of-hand knuckle guard (moulded rubber)
kg = loft('kguard', [(Vector((0.046, -0.022, -0.004)), (0, 0, 1), (1, 0.25, 0), 0.07, 0.007),
                     (Vector((0.043, -0.04, -0.006)), (0, 0, 1), (1, 0.2, 0), 0.066, 0.008),
                     (Vector((0.04, -0.058, -0.008)), (0, 0, 1), (1, 0.15, 0), 0.05, 0.006)], rrect(1.0, 1.0, 0.45, 4), PAD, grp='hand')
subsurf(kg, 1)
# thumb: web at rear-top of grip, wraps the left side
th = [Vector((0.006, -0.06, 0.012)), Vector((-0.008, -0.036, 0.032)), Vector((-0.024, -0.008, 0.036)), Vector((-0.028, 0.018, 0.036)), Vector((-0.026, 0.036, 0.034))]
chain('thumb', th, [0.018, 0.0125, 0.0105, 0.0095, 0.0085], GL)
seg('web', Vector((0.026, -0.03, 0.012)), Vector((-0.004, -0.04, 0.028)), 0.016, 0.013, GL)
# palm heel fill
seg('heel', Vector((0.0, -0.075, -0.01)), Vector((0.006, -0.04, -0.028)), 0.02, 0.016, GL)
# glove seam strap across back of hand

# ---- forearm (separate object, origin at wrist W, extends toward -Y)
fw = W
gfr = []
for (t, w, h) in ((-0.012, 0.05, 0.04), (0.01, 0.056, 0.044), (0.035, 0.062, 0.05), (0.06, 0.064, 0.052), (0.085, 0.066, 0.054)):
    gfr.append((fw + Vector((0.002, -t, 0)), (1, 0, 0), (0, 0, 1), w, h))
g = loft('gauntlet', gfr, rrect(1.0, 1.0, 0.5, 5), GL, grp='forearm')
subsurf(g, 1)
loft('cuffstrap', [(fw + Vector((0.002, -0.036, 0)), (1, 0, 0), (0, 0, 1), 0.066, 0.054), (fw + Vector((0.002, -0.058, 0)), (1, 0, 0), (0, 0, 1), 0.068, 0.056)],
     rrect(1.0, 1.0, 0.5, 5), STR, grp='forearm', bev=0.0015)
box('cufftab', (0.012, 0.024, 0.03), (0.035, -0.047 + fw.y, fw.z + 0.006), STR, grp='forearm', bev=0.003)
# sleeve with bunched folds near cuff
sfr = []
import random
random.seed(3)
for i in range(14):
    t = 0.075 + i * 0.018
    base_w = 0.072 + t * 0.06
    bulge = (0.007 if i % 2 == 0 else -0.002) * (1.0 - i / 14.0)
    sfr.append((fw + Vector((0.002 + random.uniform(-0.002, 0.002), -t, random.uniform(-0.002, 0.002))), (1, 0, 0), (0, 0.15 * (i % 3 - 1), 1), base_w + bulge, base_w * 0.8 + bulge))
sl = loft('sleeve', sfr, rrect(1.0, 1.0, 0.5, 6), SL, grp='forearm')
subsurf(sl, 1)
# accent wrist band (above cuff, under sleeve edge)
loft('band', [(fw + Vector((0.002, -0.062, 0)), (1, 0, 0), (0, 0, 1), 0.069, 0.057), (fw + Vector((0.002, -0.072, 0)), (1, 0, 0), (0, 0, 1), 0.07, 0.058)],
     rrect(1.0, 1.0, 0.5, 5), BAND, grp='band', bev=0.0015)

for o in CTX['col'].objects:
    if o.get('grp') == 'hand' and o.type == 'MESH' and not any(m.type == 'SUBSURF' for m in o.modifiers):
        pass
print('ok', len(CTX['col'].objects))

if globals().get('FINISH'):
    BAND['baked'] = False
    out = finalize(['hand', 'forearm', 'band'], [])
    set_origin(out['forearm'], W)
    set_origin(out['band'], W)
    objs = list(out.values())
    select(objs)
    bpy.ops.object.material_slot_remove_unused()
    uv_all(objs)
    bake_gun('arms', objs, size=2048)
    root = bpy.data.objects.new('arms', None)
    CTX['col'].objects.link(root)
    for o in objs:
        o.parent = root
    e = empty('wrist', W)
    e.parent = root
    print('tris', tri_count(objs), {k: tri_count([v]) for k, v in out.items()})
    print(export_glb('arms', root))
