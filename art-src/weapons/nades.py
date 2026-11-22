# Throwables: 霹雳 frag (pili), 烟雾弹 (yanwu), 闪光弹 (shanguang). Blender +Z up (glTF +Y), lever on the +Y side (glTF -Z, "front").
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())


def fuze(top_z, body_r_at, S, LV, PN):
    """Common fuze: housing, striker cap, spoon (lever) and pull ring (pin). Returns marks."""
    lathe('fz_base', [(0.0, top_z - 0.004), (0.0125, top_z - 0.004), (0.0125, top_z + 0.004), (0.0105, top_z + 0.006), (0.0, top_z + 0.006)], 20, axis='Z', mat=S, bev=0.0005)
    lathe('fz_body', [(0.0, top_z + 0.006), (0.0095, top_z + 0.006), (0.0095, top_z + 0.022), (0.0075, top_z + 0.026), (0.0, top_z + 0.027)], 20, axis='Z', mat=S, bev=0.0005)
    # lever ears (hinge) on the fuze, +Y side
    for sx in (-1, 1):
        box('fz_ear', (0.0018, 0.008, 0.01), (sx * 0.0068, 0.008, top_z + 0.018), S, bev=0.0005)
    # spoon: hooks over the top then runs down the +Y side following the body
    pts = [(0.0, -0.002, top_z + 0.0285), (0.0, 0.006, top_z + 0.0285), (0.0, 0.0115, top_z + 0.024)]
    for i in range(9):
        z = top_z + 0.016 - i * 0.012
        pts.append((0.0, body_r_at(z) + 0.0028, z))
    frames = []
    for i, p in enumerate(pts):
        a = Vector(pts[max(0, i - 1)]); b = Vector(pts[min(len(pts) - 1, i + 1)])
        t = (b - a).normalized()
        nrm = Vector((1, 0, 0)).cross(t).normalized()
        w = 0.014 if i > 2 else 0.012
        frames.append((p, (1, 0, 0), nrm, w, 0.0016))
    lv = loft('lever', frames, rrect(1.0, 1.0, 0.3, 2), LV, grp='lever')
    bevel(lv, 0.0004, 1)
    # pin: through the ears along X, with clip and pull ring on +X side
    cyl('pin', 0.0012, 0.026, (0.004, 0.008, top_z + 0.018), mat=PN, axis='X', segs=10, grp='pin')
    torus('pin_ring', 0.011, 0.0013, (0.026, 0.008, top_z + 0.012), (0, R(90), 0), PN, segs=24, n=8, grp='pin')
    loft('pin_bend', [((0.016, 0.008, top_z + 0.018), (0, 1, 0), (0, 0, 1), 0.0026, 0.0026), ((0.019, 0.008, top_z + 0.0225), (0, 1, 0), (0, 0, 1), 0.0026, 0.0026)],
         rrect(1.0, 1.0, 0.5, 2), PN, grp='pin')
    return {'pin_pivot': (0.004, 0.008, top_z + 0.018), 'lever_pivot': (0.0, 0.008, top_z + 0.018), 'ring': (0.037, 0.008, top_z + 0.012), 'fuze_top': (0, 0, top_z + 0.027)}


def stencil(text, size, z, r, mat, ang0=0.0):
    """Raised paint stencil wrapped around a cylinder of radius r (axis Z), centred at angle ang0 (from +Y)."""
    cu = bpy.data.curves.new('st_' + text, 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = 0.00025
    cu.resolution_u = 1
    o = bpy.data.objects.new('st_' + text, cu)
    CTX['col'].objects.link(o)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    bpy.data.objects.remove(o)
    bpy.data.curves.remove(cu)
    # wrap: text x -> angle, text y -> z
    for v in me.vertices:
        x, y, zz = v.co
        a = ang0 - x / r
        rr = r + 0.0003 + zz
        v.co = Vector((rr * math.sin(a), rr * math.cos(a), z + y))
    ob = bpy.data.objects.new('stencil', me)
    CTX['col'].objects.link(ob)
    me.materials.clear()
    me.materials.append(mat)
    ob['grp'] = 'body'
    return ob


def build(gid):
    setup_scene('W_' + gid)
    M = mats()
    X = extra_mats()
    S, PN = M['steel'], X['alu_bright']
    LV = pmat('m_spoon', (0.09, 0.095, 0.08), 0.6, 0.45, rough_var=0.08, wear=0.6, wear_col=(0.55, 0.55, 0.55), bump=0.1)
    if gid == 'pili':
        # egg-shaped body with fragmentation sleeve grooves
        prof_pts = []
        for i in range(25):
            t = i / 24
            z = 0.002 + t * 0.074
            rr = 0.029 * math.sin(math.pi * (0.06 + 0.88 * t)) ** 0.55
            prof_pts.append((max(rr, 0.006), z))
        body = lathe('body', [(0.0, 0.0)] + prof_pts + [(0.012, 0.078), (0.0, 0.078)], 28, axis='Z', mat=X['olive'])
        grooves = []
        for k in range(5):
            z = 0.016 + k * 0.012
            grooves.append(None)
        cuts = []
        for k in range(5):
            z = 0.016 + k * 0.011
            b = bmesh.new()
            bmesh.ops.create_cone(b, cap_ends=True, segments=48, radius1=0.031, radius2=0.031, depth=0.0016)
            bmesh.ops.transform(b, matrix=T((0, 0, z)), verts=b.verts)
            inner = bmesh.new()
            cuts.append(b)
        ring_cut = merge_bm('c_rings', cuts, cutter=True)
        # keep only the shell of the ring cutters: subtract a slightly smaller body later by intersect -> use thin tubes instead
        bpy.data.objects.remove(ring_cut, do_unlink=True)
        tubes = [lathe('c_rg', tube_ring_pts(0.0295 * math.sin(math.pi * (0.06 + 0.88 * ((0.016 + k * 0.011 - 0.002) / 0.074))) ** 0.55 + 0.0006, 0.0011, 6), 48,
                       loc=(0, 0, 0.016 + k * 0.011), axis='Z', closed=True, cutter=True) for k in range(0)]
        for tb in tubes:
            cut(body, tb)
        vg = [bm_box((0.0022, 0.07, 0.06), (0, 0, 0.04), (0, 0, R(22.5 * k))) for k in range(8)]
        vcut = merge_bm('c_vg', vg, cutter=True)
        # only cut the outer skin: intersect cutter with a shell by scaling: use a hollow tube cutter
        bpy.data.objects.remove(vcut, do_unlink=True)
        skin = [lathe('c_vs', [(0.0262, 0.012), (0.035, 0.012), (0.035, 0.068), (0.0262, 0.068)], 28, axis='Z', closed=True, cutter=True)]
        vslots = merge_bm('c_vslots', [bm_box((0.0022, 0.08, 0.052), (0, 0, 0.04), (0, 0, R(22.5 * k))) for k in range(8)], cutter=True)
        cut(skin[0], vslots, op='INTERSECT')
        cut(body, skin[0])
        bevel(body, 0.0005, 1, angle=40)
        stencil('HE-07', 0.007, 0.05, 0.0285, M['grip'] if False else X['band_y'], ang0=math.pi)
        lathe('band_y', [(0.0118, 0.0725), (0.0134, 0.0725), (0.0134, 0.0765), (0.0118, 0.0765)], 32, axis='Z', mat=X['band_y'], closed=True)
        marks = fuze(0.078, lambda z: 0.029 * max(0.2, math.sin(math.pi * (0.06 + 0.88 * min(1, max(0, (z - 0.002) / 0.074))))) ** 0.55, S, LV, PN)
        marks['grip_r'] = (0, 0, 0.042)
    elif gid == 'yanwu':
        R0, H = 0.031, 0.118
        body = lathe('body', [(0.0, 0.0), (0.028, 0.0), (R0, 0.003), (R0, H - 0.003), (0.028, H), (0.0, H)], 30, axis='Z', mat=X['grey_can'])
        ports = [bm_cyl(0.004, 0.02, (0.016 * math.cos(R(a)), 0.016 * math.sin(R(a)), H), segs=8, axis='Z') for a in range(0, 360, 60)]
        ports += [bm_cyl(0.0045, 0.02, (0.018 * math.cos(R(a)), 0.018 * math.sin(R(a)), 0.0), segs=8, axis='Z') for a in range(30, 360, 60)]
        cut(body, merge_bm('c_ports', ports, cutter=True))
        cut(body, merge_bm('c_seam', [], cutter=True)) if False else None
        rolled = [lathe('c_roll', tube_ring_pts(R0 + 0.0004, 0.0012, 6), 56, loc=(0, 0, z), axis='Z', closed=True, cutter=True) for z in (0.012, H - 0.012)]
        for rc in rolled:
            cut(body, rc)
        bevel(body, 0.0008, 2)
        lathe('band', [(R0 + 0.0002, 0.075), (R0 + 0.0006, 0.0755), (R0 + 0.0006, 0.093), (R0 + 0.0002, 0.0935), (R0 - 0.001, 0.0935), (R0 - 0.001, 0.075)], 30,
              axis='Z', mat=X['band_y'], closed=True)
        lathe('band2', [(R0 + 0.0002, 0.02), (R0 + 0.0005, 0.0203), (R0 + 0.0005, 0.024), (R0 + 0.0002, 0.0243), (R0 - 0.001, 0.0243), (R0 - 0.001, 0.02)], 30,
              axis='Z', mat=X['band_y'], closed=True)
        stencil('SMOKE', 0.011, 0.055, R0, X['band_w'], ang0=math.pi)
        stencil('GRN-12', 0.0055, 0.04, R0, X['band_w'], ang0=math.pi)
        marks = fuze(H, lambda z: R0, S, LV, PN)
        marks['grip_r'] = (0, 0, 0.06)
    else:  # shanguang
        R0, H = 0.026, 0.11
        body = lathe('body', [(0.0, 0.004), (0.022, 0.004), (R0, 0.008), (R0, H - 0.008), (0.022, H - 0.004), (0.0, H - 0.004)], 48, axis='Z', mat=M['steel'])
        holes = []
        for row in range(5):
            z = 0.022 + row * 0.017
            for k in range(8):
                a = R(45 * k + (22.5 if row % 2 else 0))
                holes.append(bm_cyl(0.0042, 0.02, (R0 * math.cos(a), R0 * math.sin(a), z), segs=12, axis='Z', rot=(0, 0, 0)))
        hl = []
        for row in range(5):
            z = 0.022 + row * 0.017
            for k in range(8):
                a = R(45 * k + (22.5 if row % 2 else 0))
                b = bmesh.new()
                bmesh.ops.create_cone(b, cap_ends=True, segments=12, radius1=0.0042, radius2=0.0042, depth=0.02)
                m = Matrix.Translation((R0 * math.cos(a), R0 * math.sin(a), z)) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(R(90), 4, 'Y')
                bmesh.ops.transform(b, matrix=m, verts=b.verts)
                hl.append(b)
        for b in holes:
            b.free()
        cut(body, merge_bm('c_holes', hl, cutter=True))
        cut(body, cyl('c_core', 0.021, 0.09, (0, 0, H / 2), axis='Z', segs=36, cutter=True))
        cyl('core', 0.0205, 0.088, (0, 0, H / 2), mat=X['band_w'], axis='Z', segs=36)
        for zc in (0.0, H - 0.008):
            lathe('cap', [(0.0, zc), (0.0255, zc), (0.027, zc + 0.002), (0.027, zc + 0.008), (0.0, zc + 0.008)], 28, axis='Z', mat=X['olive'], bev=0.0006)
        lathe('band_w', [(0.0271, 0.002), (0.0275, 0.002), (0.0275, 0.0055), (0.0271, 0.0055)], 28, axis='Z', mat=X['band_w'], closed=True)
        marks = fuze(H, lambda z: 0.027, S, LV, PN)
        marks['grip_r'] = (0, 0, 0.055)
    return marks


DEC = {'yanwu': 0.4}
for gid in GIDS:
    marks = build(gid)
    print(gid, 'built', len(CTX['col'].objects))
    if globals().get('FINISH'):
        root, out = finish_gun(gid, marks, {'pin': marks['pin_pivot'], 'lever': marks['lever_pivot']}, size=1024, decimate={'body': DEC.get(gid, 1.0)} if DEC.get(gid) else None)
        print(export_glb(gid, root))
