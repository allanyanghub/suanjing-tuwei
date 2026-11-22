# 寸芒 — original tactical combat knife. Blender: +Y = blade direction, +Z = spine, edge toward -Z.
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())
setup_scene('W_cunmang')
M = mats()
X = extra_mats()
CO, BA, MI, S = X['coat'], X['bare'], X['micarta'], M['steel']

# ---------------- blade: lofted sections (flat grind with a bare-steel edge bevel)
W = 0.0046      # spine thickness
L0, L1 = 0.006, 0.176   # blade from guard to tip
rings = []
N = 26
for i in range(N + 1):
    t = i / N
    y = L0 + (L1 - L0) * t
    # spine (top) line: straight, then clip down from 70%
    zt = 0.012 if t < 0.68 else 0.012 - (t - 0.68) / 0.32 * 0.0135
    # edge (bottom) line: straight belly, sweeping up to the tip
    if t < 0.55:
        zb = -0.021
    else:
        u = (t - 0.55) / 0.45
        zb = -0.021 + (1 - math.cos(u * math.pi / 2)) * 0.0195 + u * u * 0.0
    if i == N:
        zt = zb = -0.0015
    h = zt - zb
    zg = zb + h * 0.42          # grind line
    ze = zb + 0.0028            # secondary (edge) bevel line
    w = W * (1 - t ** 4 * 0.85) if i < N else 0.0004
    pts = [(-w / 2, y, zt), (-w / 2, y, zg), (-0.0006 * (1 - t * 0.5), y, ze), (-0.00012, y, zb),
           (0.00012, y, zb), (0.0006 * (1 - t * 0.5), y, ze), (w / 2, y, zg), (w / 2, y, zt)]
    rings.append(pts)
# faces j: 0 left flat(top->grind), 1 left grind, 2 left edge bevel, 3 bottom, 4 right edge bevel, 5 right grind, 6 right flat, 7 spine
blade = ring_loft('blade', rings, CO, mat_idx=lambda i, j: 1 if j in (2, 3, 4) else None)
blade.data.materials.append(BA)
# fuller (both sides) + spine jimping
cut_parts = [bm_cyl(0.0024, 0.075, (sx * 0.0039, 0.062, 0.0035), axis='Y', segs=12) for sx in (-1, 1)]
cut(blade, merge_bm('c_fuller', cut_parts, cutter=True))
jimp = [bm_box((0.01, 0.0016, 0.0016), (0, 0.016 + i * 0.0032, 0.0128), (R(45), 0, 0)) for i in range(7)]
cut(blade, merge_bm('c_jimp', jimp, cutter=True))
# serrations on the rear of the edge
ser = [bm_cyl(0.0021, 0.01, (0, 0.016 + i * 0.0052, -0.0218), axis='X', segs=12) for i in range(7)]
cut(blade, merge_bm('c_ser', ser, cutter=True))
bevel(blade, 0.0003, 1, angle=40)
# ricasso stamp line (subtle) — a thin groove
cut(blade, box('c_ric', (0.01, 0.0008, 0.02), (0, 0.011, -0.004), cutter=True))

# ---------------- guard (single lower quillon + small upper)
gp = [(-0.006, 0.0225), (0.006, 0.0225), (0.0075, 0.012), (0.0075, -0.028), (0.006, -0.036), (-0.006, -0.036), (-0.0075, -0.028), (-0.0075, 0.012)]
front('guard', gp, 0.006, S, y=0.0, bev=0.0012)
# ---------------- tang (exposed spine/belly strip) with lanyard hole
tp = [(0.001, 0.013), (-0.04, 0.0135), (-0.075, 0.0125), (-0.115, 0.012), (-0.128, 0.006), (-0.13, -0.004), (-0.126, -0.014),
      (-0.11, -0.022), (-0.09, -0.024), (-0.075, -0.02), (-0.06, -0.024), (-0.045, -0.02), (-0.03, -0.024), (-0.012, -0.023), (0.001, -0.021)]
tang = prof('tang', tp, 0.0046, CO, bev=0)
cut(tang, cyl('c_lan', 0.0035, 0.03, (0, -0.121, -0.003), axis='X', segs=18, cutter=True))
bevel(tang, 0.0006, 2)
# ---------------- micarta scales (contoured, finger grooves), both sides
for sx in (-1, 1):
    sp = [(-0.002, 0.0115), (-0.04, 0.012), (-0.075, 0.011), (-0.108, 0.0105), (-0.112, 0.003), (-0.11, -0.013), (-0.09, -0.0225),
          (-0.075, -0.0185), (-0.06, -0.0225), (-0.045, -0.0185), (-0.03, -0.0225), (-0.012, -0.0215), (-0.002, -0.019)]
    sc = prof('scale', sp, 0.0072, MI, x=sx * (0.0023 + 0.0036), bev=0)
    bevel(sc, 0.0026, 3, angle=30)
    # scale bolts
    for py in (-0.025, -0.088):
        cyl('bolt', 0.0032, 0.0012, (sx * 0.0095, py, -0.004), mat=BA, axis='X', segs=16, bev=0.0003)
        cyl('boltdrv', 0.0015, 0.0013, (sx * 0.0099, py, -0.004), mat=S, axis='X', segs=6)
# lanyard eyelet tube
lathe('eyelet', tube_ring_pts(0.0037, 0.0007, 8), 18, loc=(0, -0.121, -0.003), axis='X', mat=BA, closed=True)

marks = {
    'grip_r': (0, -0.058, -0.004),
    'tip': (0, 0.176, -0.0015),
    'edge_mid': (0, 0.09, -0.021),
    'guard': (0, 0.003, -0.004),
}
print('built', len(CTX['col'].objects))
if globals().get('FINISH'):
    root, out = finish_gun('cunmang', marks, {}, size=2048)
    print(export_glb('cunmang', root))
