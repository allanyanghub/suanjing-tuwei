# 北辰 — original 7.62 designated-marksman rifle (semi/burst), 2.5x prism optic. Blender: +Y forward, +Z up, +X right. Bore axis z=0.
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())
setup_scene('W_beichen')
M = mats()
A, S, P, RB = M['alu'], M['steel'], M['poly'], M['rubber']
F, FG = M['cera'], M['grip']
X = extra_mats()
RT = 0.0355  # rail top

# ---------------- upper receiver
up_pts = [(-0.0155, -0.012), (0.0155, -0.012), (0.0155, 0.019), (0.0115, 0.0245), (-0.0115, 0.0245), (-0.0155, 0.019)]
upper = front('upper', up_pts, 0.232, A, y=-0.122, bev=0)
cut(upper, box('c_port', (0.012, 0.058, 0.016), (0.0135, 0.008, 0.004), cutter=True))
cut(upper, box('c_chs', (0.008, 0.11, 0.0055), (-0.0165, 0.05, 0.006), cutter=True))
fl = []
for sx in (-1, 1):
    fl.append(bm_box((0.0016, 0.21, 0.0012), (sx * 0.0158, -0.012, -0.0075)))
    fl.append(bm_box((0.0016, 0.0012, 0.03), (sx * 0.0158, -0.06, 0.006)))
    fl.append(bm_box((0.003, 0.05, 0.003), (sx * 0.0158, -0.09, 0.012)))
cut(upper, merge_bm('c_fl', fl, cutter=True))
bevel(upper, 0.001, 2)
picatinny('rail_up', -0.118, 0.108, RT, A, zbase=0.022)
# brass deflector + forward assist style bump (right rear)
lathe('deflect', [(0.0, -0.075), (0.007, -0.072), (0.008, -0.06), (0.006, -0.05), (0.0, -0.048)], 16, loc=(0.0155, 0, 0.012), mat=A, bev=0.0005, axis='Y')
# dust cover (hinged, folded open below port)
prof('dustcover', [(-0.021, -0.0095), (0.037, -0.0095), (0.037, -0.0125), (-0.021, -0.0125)], 0.0018, S, x=0.0168, bev=0.0004)
cyl('dc_hinge', 0.0016, 0.06, (0.0165, 0.008, -0.0115), mat=S, segs=10)

# ---------------- lower receiver
lo_pts = [(-0.11, -0.012), (0.075, -0.012), (0.075, -0.024), (0.078, -0.07), (0.083, -0.079), (0.003, -0.079),
          (0.007, -0.07), (0.005, -0.042), (-0.048, -0.042), (-0.07, -0.038), (-0.11, -0.03)]
lower = prof('lower', lo_pts, 0.031, A, bev=0)
cut(lower, box('c_well', (0.023, 0.064, 0.09), (0, 0.04, -0.06), cutter=True))
cut(lower, box('c_well2', (0.026, 0.07, 0.008), (0, 0.04, -0.08), cutter=True))
rec = [bm_box((0.002, 0.05, 0.024), (sx * 0.0156, 0.04, -0.052)) for sx in (-1, 1)]
cut(lower, merge_bm('c_rec', rec, cutter=True))
bevel(lower, 0.0012, 2)
for sx in (-1, 1):
    prof('boss', [(-0.098, -0.014), (0.0, -0.014), (0.004, -0.022), (0.002, -0.04), (-0.05, -0.04), (-0.072, -0.036), (-0.098, -0.028)], 0.0018, A, x=sx * 0.0162, bev=0.0005)
for (py, pz) in ((-0.1, -0.019), (0.066, -0.019), (-0.016, -0.026), (-0.034, -0.026)):
    cyl('pin', 0.0024, 0.0362, (0, py, pz), mat=S, axis='X', segs=14, bev=0.0004)
box('magrel', (0.004, 0.01, 0.01), (0.0168, 0.0, -0.032), S, bev=0.0012)
prof('boltcatch', [(-0.004, -0.016), (0.008, -0.016), (0.01, -0.022), (-0.002, -0.034), (-0.006, -0.03)], 0.003, S, x=-0.0172, bev=0.0006)
for sx in (-1, 1):
    cyl('selhub', 0.0055, 0.003, (sx * 0.0172, -0.055, -0.022), mat=S, axis='X', segs=20, bev=0.0005)
    prof('selpad', [(-0.058, -0.019), (-0.038, -0.016), (-0.036, -0.02), (-0.056, -0.025)], 0.0025, S, x=sx * 0.0184, bev=0.0005)
# trigger guard (integral, flared)
tg = prof('tguard', [(-0.056, -0.041), (0.006, -0.041), (0.006, -0.05), (0.0, -0.066), (-0.048, -0.066), (-0.06, -0.058)], 0.012, A, bev=0)
cut(tg, prof('c_tg', [(-0.046, -0.037), (0.0, -0.037), (-0.004, -0.06), (-0.044, -0.06)], 0.03, cutter=True))
bevel(tg, 0.0015, 2)
trig = prof('trigger', [(-0.024, -0.039), (-0.015, -0.039), (-0.0155, -0.046), (-0.021, -0.055), (-0.028, -0.059), (-0.03, -0.0575), (-0.0235, -0.05), (-0.022, -0.044)], 0.006, S, grp='trigger', bev=0.0008)

# ---------------- pistol grip (FDE, raked 20 deg)
ang = R(20)
ax = Vector((0, -math.sin(ang), -math.cos(ang)))
fwd = Vector((0, math.cos(ang), -math.sin(ang)))
top = Vector((0, -0.07, -0.036))
gp = rrect(1.0, 1.0, 0.42, 5)
frames = []
for (t, w, d, fo) in [(0.0, 0.028, 0.048, 0.0), (0.012, 0.029, 0.048, 0.0), (0.03, 0.03, 0.046, -0.0015), (0.046, 0.031, 0.048, 0.001),
                      (0.062, 0.031, 0.046, -0.001), (0.078, 0.032, 0.049, 0.0015), (0.095, 0.032, 0.05, 0.0), (0.108, 0.031, 0.05, 0.0)]:
    frames.append((top + ax * t + fwd * fo, (1, 0, 0), fwd, w, d))
grip = loft('pgrip', frames, gp, FG)
subsurf(grip, 1)
prof('beaver', [(-0.11, -0.028), (-0.075, -0.04), (-0.08, -0.05), (-0.095, -0.047), (-0.113, -0.036)], 0.028, FG, bev=0.003)
lc = top + ax * 0.109
loft('gcap', [(lc, (1, 0, 0), fwd, 0.0325, 0.052), (lc + ax * 0.006, (1, 0, 0), fwd, 0.03, 0.049)], gp, F, bev=0.0008)

# ---------------- fixed skeleton stock with adjustable cheek riser
lathe('endplate', [(0.0175, -0.13), (0.021, -0.13), (0.021, -0.134), (0.0175, -0.134)], 24, loc=(0, 0, -0.004), mat=S, closed=True, bev=0.0004)
sk = prof('stock', [(-0.126, 0.02), (-0.36, 0.024), (-0.372, 0.03), (-0.372, -0.11), (-0.36, -0.115), (-0.3, -0.09), (-0.2, -0.05), (-0.126, -0.03)], 0.036, F, bev=0)
cut(sk, prof('c_sk1', [(-0.15, 0.008), (-0.34, 0.01), (-0.34, -0.005), (-0.15, -0.012)], 0.08, cutter=True))
cut(sk, prof('c_sk2', [(-0.2, -0.032), (-0.34, -0.02), (-0.348, -0.095), (-0.31, -0.08)], 0.08, cutter=True))
bevel(sk, 0.0022, 2)
prof('cheek', [(-0.2, 0.036), (-0.335, 0.038), (-0.34, 0.03), (-0.33, 0.026), (-0.205, 0.025)], 0.03, F, bev=0.003)
for py in (-0.23, -0.3):
    cyl('cheekpost', 0.0035, 0.012, (0, py, 0.024), mat=S, axis='Z', segs=12)
    cyl('cheekknob', 0.005, 0.006, (0.018, py, 0.02), mat=P, axis='X', segs=14, bev=0.0006)
pad = prof('buttpad', [(-0.372, 0.032), (-0.386, 0.033), (-0.388, -0.04), (-0.386, -0.116), (-0.372, -0.114)], 0.042, RB, bev=0.003)
grooves = [bm_box((0.05, 0.02, 0.0012), (0, -0.382, -0.11 + i * 0.006)) for i in range(24)]
cut(pad, merge_bm('c_padg', grooves, cutter=True))
prof('rear_grip', [(-0.29, -0.088), (-0.315, -0.098), (-0.318, -0.112), (-0.29, -0.1)], 0.022, P, bev=0.002)
cyl('qd', 0.006, 0.006, (-0.019, -0.14, 0.0), mat=S, axis='X', segs=18, bev=0.0005)
torus('sling', 0.009, 0.0018, (-0.024, -0.14, -0.009), (0, 0, R(90)), S, segs=18, n=8)

# ---------------- handguard (rounded square, M-LOK)
hg_pts = rrect(0.044, 0.05, 0.012, 5, 0, -0.004)
hg = front('handguard', hg_pts, 0.415, F, y=0.108, bev=0)
cut(hg, front('c_hgbore', rrect(0.036, 0.042, 0.009, 5, 0, -0.004), 0.4, y=0.05, cutter=True))
sl = []
for i in range(6):
    y = 0.135 + i * 0.062
    for sx in (-1, 1):
        sl.append(bm_box((0.02, 0.032, 0.0075), (sx * 0.022, y, -0.006)))
        sl.append(bm_box((0.02, 0.032, 0.0075), (sx * 0.022, y + 0.0, -0.006)))
    sl.append(bm_box((0.0075, 0.032, 0.02), (0, y, -0.03)))
for i in range(4):
    for sx in (-1, 1):
        a = R(45 * sx)
        m = T((sx * 0.017, 0.16 + i * 0.09, -0.023), (0, a, 0), (0.016, 0.03, 0.006))
        b = bmesh.new(); bmesh.ops.create_cube(b, size=1.0); bmesh.ops.transform(b, matrix=m, verts=b.verts); sl.append(b)
cut(hg, merge_bm('c_mlok', sl, cutter=True))
bevel(hg, 0.0009, 2)
picatinny('rail_hg', 0.112, 0.522, RT, A, zbase=0.019)
# barrel nut / handguard clamp screws
for i in range(2):
    for sx in (-1, 1):
        cyl('hgscrew', 0.0022, 0.003, (sx * 0.0225, 0.118 + i * 0.012, -0.022), mat=S, axis='X', segs=12, bev=0.0004)
# front QD + barricade stop under handguard
cyl('qd2', 0.006, 0.006, (-0.0245, 0.505, -0.004), mat=S, axis='X', segs=18, bev=0.0005)
prof('handstop', [(0.4, -0.028), (0.43, -0.028), (0.428, -0.036), (0.404, -0.036)], 0.02, FG, bev=0.002)

# ---------------- barrel + muzzle brake
cyl('barrel', 0.0098, 0.5, (0, 0.35, 0), mat=S, segs=28, bore=0.0035)
lathe('crush', [(0.0115, 0.593), (0.0122, 0.597), (0.0122, 0.602), (0.0115, 0.604), (0.0098, 0.604), (0.0098, 0.593)], 6, mat=S, closed=True, bev=0.0004)
mb = lathe('brake', [(0.0118, 0.604), (0.0124, 0.608), (0.0124, 0.672), (0.0112, 0.675), (0.005, 0.675), (0.005, 0.604)], 28, mat=S, closed=True)
ports = []
for i in range(3):
    ports.append(bm_box((0.04, 0.007, 0.009), (0, 0.621 + i * 0.016, 0.0)))
for i in range(2):
    ports.append(bm_box((0.0045, 0.004, 0.02), (-0.004 + i * 0.008, 0.66, 0.013)))
cut(mb, merge_bm('c_ports', ports, cutter=True))
bevel(mb, 0.0005, 1, angle=40)

# ---------------- charging handle (left)
cyl('chstem', 0.0026, 0.012, (-0.021, 0.098, 0.006), mat=S, axis='X', segs=12)
lathe('chknob', [(0.0, -0.034), (0.0055, -0.0335), (0.0062, -0.03), (0.0062, -0.0255), (0.0045, -0.0245), (0.0, -0.0245)], 18, loc=(0, 0.098, 0.006), axis='X', mat=P, bev=0.0004)

# ---------------- 2.5x prism optic with etched reticle
OZ = RT + 0.034     # optic axis height
yb = 0.0
box('op_base', (0.03, 0.07, 0.008), (0, yb + 0.02, RT + 0.004), A, bev=0.0012)
for py in (yb - 0.002, yb + 0.042):
    box('op_clamp', (0.006, 0.014, 0.012), (0.0165, py, RT - 0.002), A, bev=0.0012)
    cyl('op_knob', 0.0045, 0.007, (0.022, py, RT - 0.002), mat=S, axis='X', segs=16, bev=0.0005)
body = front('op_body', rrect(0.04, 0.036, 0.008, 5, 0, OZ), 0.07, A, y=yb - 0.015, bev=0)
cut(body, merge_bm('c_opflat', [bm_box((0.004, 0.05, 0.014), (sx * 0.0205, yb + 0.02, OZ + 0.004)) for sx in (-1, 1)], cutter=True))
cut(body, cyl('c_opbore', 0.0145, 0.2, (0, yb, OZ), axis='Y', segs=32, cutter=True))
bevel(body, 0.0012, 2)
box('op_neck', (0.026, 0.05, 0.012), (0, yb + 0.02, RT + 0.012), A, bev=0.002)
lathe('op_obj', [(0.0145, yb + 0.055), (0.019, yb + 0.07), (0.0205, yb + 0.1), (0.019, yb + 0.103), (0.0165, yb + 0.103), (0.0165, yb + 0.095), (0.0145, yb + 0.06)],
      40, loc=(0, 0, OZ), mat=A, closed=True, bev=0.0006)
cyl('op_objglass', 0.0166, 0.002, (0, yb + 0.096, OZ), mat=M['glass'], segs=36)
lathe('op_eye', [(0.0145, yb - 0.015), (0.0165, yb - 0.025), (0.0175, yb - 0.05), (0.0185, yb - 0.06), (0.0175, yb - 0.064), (0.0145, yb - 0.064)],
      40, loc=(0, 0, OZ), mat=A, closed=True, bev=0.0006)
lathe('op_cup', [(0.0185, yb - 0.064), (0.0195, yb - 0.066), (0.0195, yb - 0.078), (0.0175, yb - 0.08), (0.0155, yb - 0.08), (0.0155, yb - 0.066)],
      40, loc=(0, 0, OZ), mat=RB, closed=True)
kr = lathe('op_ring', [(0.0172, yb - 0.04), (0.0188, yb - 0.04), (0.0188, yb - 0.028), (0.0172, yb - 0.028)], 40, loc=(0, 0, OZ), mat=A, closed=True)
kn = [bm_box((0.002, 0.014, 0.002), (0.0189 * math.cos(R(a)), yb - 0.034, OZ + 0.0189 * math.sin(R(a))), (0, R(-a + 90), 0)) for a in range(0, 360, 15)]
cut(kr, merge_bm('c_opk', kn, cutter=True))
cyl('op_turret_t', 0.009, 0.01, (0, yb + 0.02, OZ + 0.023), mat=A, axis='Z', segs=28, bev=0.0008)
cyl('op_turret_r', 0.009, 0.01, (0.025, yb + 0.02, OZ), mat=A, axis='X', segs=28, bev=0.0008)
cyl('op_illum', 0.0105, 0.012, (-0.026, yb + 0.02, OZ), mat=A, axis='X', segs=28, bev=0.0008)
for k in range(12):
    a = R(30 * k)
    box('op_tick', (0.0008, 0.0012, 0.003), (0.009 * math.cos(a), yb + 0.02 + 0.009 * math.sin(a), OZ + 0.028), S)
cyl('op_eyeglass', 0.0146, 0.002, (0, yb - 0.063, OZ), mat=M['glass'], segs=36)
# etched reticle in the eyepiece focal plane: horizontal bars, lower post, BDC stadia, chevron
RET = pmat('m_ret', (0.01, 0.01, 0.01), 0.0, 0.5, wear=0.0, bump=0.0)
ry = yb - 0.045
for (w, h, x, z) in ((0.011, 0.00045, -0.0085, 0.0), (0.011, 0.00045, 0.0085, 0.0), (0.00045, 0.011, 0.0, -0.0085)):
    box('reticle', (w, 0.0003, h), (x, ry, OZ + z), RET)
for k, dz in enumerate((-0.0022, -0.0042, -0.0062)):
    box('reticle', (0.0022 - k * 0.0004, 0.0003, 0.00035), (0, ry, OZ + dz), RET)
for sx in (-1, 1):
    box('reticle', (0.0019, 0.0003, 0.00045), (sx * 0.0007, ry, OZ - 0.0006), RET, rot=(0, R(40 * sx), 0))
# folded BUIS
box('rs_base', (0.02, 0.018, 0.006), (0, -0.1, RT + 0.003), A, bev=0.001)
prof('rs_leaf', [(-0.11, RT + 0.006), (-0.09, RT + 0.006), (-0.093, RT + 0.011), (-0.107, RT + 0.011)], 0.016, A, bev=0.0008)
box('fs_base', (0.02, 0.018, 0.006), (0, 0.505, RT + 0.003), A, bev=0.001)
prof('fs_leaf', [(0.496, RT + 0.006), (0.516, RT + 0.006), (0.513, RT + 0.01), (0.499, RT + 0.01)], 0.014, A, bev=0.0008)

# ---------------- bolt carrier visible in port
box('bcg', (0.009, 0.058, 0.015), (0.0098, 0.008, 0.004), S, grp='bolt', bev=0.0008)
cyl('bolthead', 0.0045, 0.008, (0.0098, 0.03, 0.002), mat=S, grp='bolt', segs=14)

# ---------------- magazine (curved polymer, FDE), origin at top centre
mf = []
N = 4
for i in range(N + 1):
    t = i / N
    o = Vector((0, 0.04 + 0.008 * t, -0.02 - t * 0.13))
    mf.append((o, (1, 0, 0), (0, 1, 0.06), 0.0235, 0.066 if i else 0.064))
magb = loft('mag_body', mf, rrect(1.0, 1.0, 0.18, 4), M['poly'], grp='magazine')
rib = []
for k in range(2, N):
    o, xa, ya, w, d = mf[k]
    for sx in (-1, 1):
        rib.append(bm_box((0.0016, 0.046, 0.0028), (sx * 0.0112, o.y, o.z), (math.atan2(ya[2], ya[1]), 0, 0)))
merge_bm('mag_ribs', rib, M['poly'], grp='magazine')
bevel(magb, 0.0009, 2)
o, xa, ya, w, d = mf[-1]
loft('mag_base', [(o, (1, 0, 0), ya, 0.026, 0.066), (o + Vector((0, 0.004, -0.009)), (1, 0, 0), ya, 0.025, 0.064)], rrect(1.0, 1.0, 0.3, 4), M['poly'], grp='magazine', bev=0.0012)
lathe('cart', [(0.0, 0.0), (0.0046, 0.0), (0.0048, 0.002), (0.0048, 0.034), (0.0042, 0.038), (0.003, 0.044), (0.0012, 0.054), (0.0, 0.056)], 14,
      loc=(-0.003, 0.012, -0.0205), mat=M['brass'], grp='magazine', rot=(R(-3), 0, 0))
for sx in (-1, 1):
    box('lip', (0.002, 0.04, 0.004), (sx * 0.0068, 0.032, -0.019), P, grp='magazine', bev=0.0005)

gr_top = top + ax * 0.045
marks = {
    'muzzle': (0, 0.675, 0),
    'grip_r': tuple(gr_top),
    'grip_l': (0, 0.3, -0.004),
    'sight': (0, yb - 0.08, OZ),
    'scope_front': (0, yb + 0.103, OZ),
    'eject': (0.018, 0.008, 0.004),
    'magwell': (0, 0.04, -0.02),
}
print('built', len(CTX['col'].objects))
if globals().get('FINISH'):
    root, out = finish_gun('beichen', marks, {'magazine': marks['magwell'], 'trigger': (0, -0.0195, -0.039)}, size=2048)
    print(export_glb('beichen', root))
