# 惊蛰 — original 12-gauge pump shotgun, walnut furniture. Blender: +Y forward, +Z up, +X right. Bore axis z=0.
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())
setup_scene('W_jingzhe')
M = mats()
S, W, RB, BR = M['steel'], M['wood'], M['rubber'], M['brass']
BL = pmat('m_blued', (0.12, 0.13, 0.15), 1.0, 0.3, rough_var=0.08, wear=0.7, wear_col=(0.62, 0.62, 0.64), bump=0.06)
MT = 0.0  # bore axis

# ---------------- receiver (rounded top, flat sides)
rc = [(-0.0185, -0.036), (0.0185, -0.036), (0.0185, 0.018), (0.0155, 0.026), (0.009, 0.0305), (-0.009, 0.0305), (-0.0155, 0.026), (-0.0185, 0.018)]
recv = front('receiver', rc, 0.215, BL, y=-0.1, bev=0)
cut(recv, box('c_eport', (0.012, 0.062, 0.022), (0.0155, 0.038, 0.004), cutter=True))
cut(recv, box('c_lport', (0.026, 0.07, 0.03), (0, 0.06, -0.04), cutter=True))
# grooved sighting top + side scallop lines
gl = [bm_box((0.0012, 0.19, 0.0012), (dx, 0.005, 0.0308)) for dx in (-0.004, 0.0, 0.004)]
gl += [bm_box((0.0016, 0.17, 0.0012), (sx * 0.0186, 0.005, -0.016)) for sx in (-1, 1)]
gl += [bm_box((0.0016, 0.12, 0.022), (sx * 0.0186, -0.005, -0.012)) for sx in (-1, 1)]
cut(recv, merge_bm('c_grv', gl, cutter=True))
for sx in (-1, 1):
    prof('rpanel', [(-0.064, -0.023), (0.052, -0.023), (0.052, -0.001), (-0.064, -0.001)], 0.0012, BL, x=sx * 0.0181, bev=0.0004)
bevel(recv, 0.0012, 2)
# trigger plate / guard group
tp = prof('tplate', [(-0.1, -0.034), (0.02, -0.034), (0.02, -0.044), (-0.01, -0.046), (-0.06, -0.046), (-0.1, -0.042)], 0.032, BL, bev=0.0012)
tg = prof('tguard', [(-0.07, -0.044), (0.008, -0.044), (0.008, -0.05), (0.0, -0.07), (-0.058, -0.07), (-0.074, -0.06)], 0.011, BL, bev=0)
cut(tg, prof('c_tg', [(-0.058, -0.04), (0.0, -0.04), (-0.006, -0.064), (-0.054, -0.064)], 0.03, cutter=True))
bevel(tg, 0.0014, 2)
prof('trigger', [(-0.03, -0.045), (-0.021, -0.045), (-0.022, -0.052), (-0.028, -0.061), (-0.035, -0.065), (-0.037, -0.063), (-0.03, -0.055), (-0.029, -0.05)], 0.0065, S, grp='trigger', bev=0.0008)
cyl('safety', 0.0045, 0.04, (0, -0.064, -0.04), mat=S, axis='X', segs=16, bev=0.0006)
for (py, pz) in ((-0.085, -0.03), (0.0, -0.03)):
    cyl('pin', 0.0026, 0.0395, (0, py, pz), mat=S, axis='X', segs=14, bev=0.0004)
prof('sliderel', [(-0.012, -0.035), (0.004, -0.035), (0.004, -0.039), (-0.012, -0.041)], 0.003, S, x=-0.019, bev=0.0005)
# ghost-ring rear sight with protective ears
GZ = 0.047
box('gr_base', (0.026, 0.028, 0.006), (0, -0.075, 0.033), BL, bev=0.0012)
for sx in (-1, 1):
    prof('gr_ear', [(-0.085, 0.034), (-0.066, 0.034), (-0.068, 0.054), (-0.078, 0.057)], 0.004, BL, x=sx * 0.0105, bev=0.0007)
lathe('gr_ring', tube_ring_pts(0.0045, 0.0016, 8), 22, loc=(0, -0.076, GZ), rot=(0, 0, 0), mat=BL, closed=True)
box('gr_post', (0.004, 0.004, 0.008), (0, -0.076, 0.039), BL, bev=0.0008)
# side saddle shell carrier (left) with 4 shells
box('saddle', (0.004, 0.11, 0.032), (-0.0205, 0.02, -0.004), M['poly'], bev=0.0015)
for i in range(4):
    yy = -0.025 + i * 0.03
    cyl('sad_shell', 0.0092, 0.05, (-0.032, yy, -0.004 + 0.002), mat=M['hull'], axis='Z', segs=18, bev=0.0006)
    cyl('sad_rim', 0.0098, 0.004, (-0.032, yy, -0.004 - 0.025), mat=BR, axis='Z', segs=18, bev=0.0006)

# ---------------- barrel + vent rib + front sight
cyl('barrel', 0.0118, 0.47, (0, 0.35, 0), mat=BL, segs=28, bore=0.0093)
lathe('muzzlecrown', [(0.0125, 0.578), (0.0125, 0.586), (0.0118, 0.588), (0.0093, 0.588), (0.0093, 0.578)], 28, mat=BL, closed=True, bev=0.0004)
box('rib', (0.008, 0.45, 0.0022), (0, 0.355, 0.0155), BL, bev=0.0006)
posts = [bm_box((0.004, 0.006, 0.004), (0, 0.14 + i * 0.045, 0.0128)) for i in range(10)]
merge_bm('ribposts', posts, BL)
prof('fsight', [(0.565, 0.016), (0.582, 0.016), (0.58, GZ - 0.002), (0.572, GZ - 0.002)], 0.0035, BL, bev=0.0006)
lathe('bead', [(0.0, -0.0022), (0.0018, -0.0016), (0.0022, 0.0), (0.0018, 0.0016), (0.0, 0.0022)], 12, loc=(0, 0.576, GZ), mat=BR, axis='Z')
# magazine tube + cap + barrel clamp
cyl('magtube', 0.0118, 0.39, (0, 0.31, -0.0255), mat=BL, segs=24)
lathe('magcap', [(0.0, 0.505), (0.0118, 0.505), (0.0128, 0.507), (0.0128, 0.528), (0.011, 0.532), (0.0, 0.533)], 24, loc=(0, 0, -0.0255), mat=BL, bev=0.0004)
kn = [bm_box((0.002, 0.018, 0.002), (0.0128 * math.cos(R(a)), 0.517, -0.0255 + 0.0128 * math.sin(R(a))), (0, R(-a + 90), 0)) for a in range(0, 360, 20)]
cut(bpy.data.objects['magcap'], merge_bm('c_knurl', kn, cutter=True))
clamp = front('bclamp', [(-0.0145, -0.04), (0.0145, -0.04), (0.0145, 0.004), (0.01, 0.0135), (-0.01, 0.0135), (-0.0145, 0.004)], 0.016, BL, y=0.47, bev=0.0012)
cyl('clampscrew', 0.003, 0.034, (0, 0.478, -0.012), mat=S, axis='X', segs=14, bev=0.0004)
torus('swivel', 0.008, 0.0016, (0, 0.52, -0.042), (0, 0, 0), S, segs=18, n=8)

# ---------------- pump (walnut forend with grooves) + action bars
pf = []
for (y, w, h, zc) in ((0.165, 0.038, 0.044, -0.024), (0.172, 0.043, 0.05, -0.023), (0.34, 0.043, 0.05, -0.023), (0.347, 0.038, 0.044, -0.024)):
    pf.append(((0, y, zc), (1, 0, 0), (0, 0, 1), w, h))
pump = loft('pump_wood', pf, rrect(1.0, 1.0, 0.42, 6), W, grp='pump')
cut(pump, front('c_pbore', rrect(0.026, 0.05, 0.012, 6, 0, -0.016), 0.3, y=0.1, cutter=True))
rings = []
for i in range(9):
    yy = 0.19 + i * 0.017
    rings.append(lathe('c_ring', [(0.023, yy), (0.03, yy), (0.03, yy + 0.0045), (0.023, yy + 0.0045)], 24, loc=(0, 0, -0.023), closed=True, cutter=True))
for r in rings:
    cut(pump, r)
bevel(pump, 0.0012, 2)
for sx in (-1, 1):
    box('actionbar', (0.0025, 0.2, 0.006), (sx * 0.0135, 0.07, -0.026), S, grp='pump', bev=0.0005)

# ---------------- stock (walnut) + recoil pad
sf = []
for (y, w, zt, zb) in ((-0.098, 0.035, 0.026, -0.046), (-0.11, 0.033, 0.022, -0.048), (-0.122, 0.031, 0.019, -0.05), (-0.14, 0.03, 0.015, -0.053),
                       (-0.16, 0.03, 0.012, -0.058), (-0.19, 0.032, 0.01, -0.072), (-0.22, 0.034, 0.008, -0.088), (-0.26, 0.036, 0.0065, -0.102),
                       (-0.3, 0.038, 0.005, -0.116), (-0.34, 0.04, 0.004, -0.127), (-0.38, 0.041, 0.003, -0.136), (-0.42, 0.042, 0.0025, -0.145),
                       (-0.44, 0.042, 0.002, -0.15)):
    sf.append(((0, y, (zt + zb) / 2), (1, 0, 0), (0, 0, 1), w, zt - zb))
stock = loft('stock', sf, rrect(1.0, 1.0, 0.45, 6), W)
subsurf(stock, 2)
pad = loft('pad', [((0, -0.44, -0.074), (1, 0, 0), (0, 0, 1), 0.043, 0.154), ((0, -0.462, -0.0745), (1, 0, 0), (0, 0, 1), 0.044, 0.157),
                   ((0, -0.466, -0.0745), (1, 0, 0), (0, 0, 1), 0.039, 0.15)], rrect(1.0, 1.0, 0.45, 6), RB)
gr = [bm_box((0.06, 0.016, 0.0014), (0, -0.458, -0.145 + i * 0.0065)) for i in range(22)]
cut(pad, merge_bm('c_padg', gr, cutter=True))
bevel(pad, 0.001, 1)
box('padspacer', (0.043, 0.003, 0.154), (0, -0.4415, -0.074), M['poly'], bev=0.0008)
# stock sling swivel stud
cyl('stud', 0.004, 0.012, (0, -0.38, -0.136), mat=S, axis='Z', segs=12, bev=0.0005)
torus('swivel2', 0.008, 0.0016, (0, -0.38, -0.148), (0, 0, 0), S, segs=18, n=8)

# ---------------- bolt (visible in ejection port)
box('bolt_b', (0.009, 0.05, 0.016), (0.011, 0.038, 0.004), S, grp='bolt', bev=0.0008)
# ---------------- loose shell (reload animation), at loading port
cyl('shell_hull', 0.0092, 0.052, (0, 0.06, -0.06), mat=M['hull'], grp='shell', segs=18, bev=0.0006)
lathe('shell_rim', [(0.0, -0.0), (0.0098, 0.0), (0.0098, 0.003), (0.0093, 0.004), (0.0093, 0.014), (0.0, 0.014)], 18, loc=(0, 0.034 - 0.0, -0.06), mat=BR, grp='shell')

marks = {
    'muzzle': (0, 0.588, 0),
    'grip_r': (0, -0.15, -0.026),
    'grip_l': (0, 0.27, -0.022),
    'sight': (0, -0.076, GZ),
    'eject': (0.018, 0.04, 0.006),
    'magwell': (0, 0.06, -0.04),
}
print('built', len(CTX['col'].objects))
if globals().get('FINISH'):
    root, out = finish_gun('jingzhe', marks, {'trigger': (0, -0.0255, -0.045), 'shell': (0, 0.06, -0.06)}, size=2048)
    print(export_glb('jingzhe', root))
