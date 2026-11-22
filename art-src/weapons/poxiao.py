# 破晓 — original large-frame .44-class double-action revolver, stainless + black rubber. Blender: +Y fwd, +Z up, bore z=0.
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())
setup_scene('W_poxiao')
M = mats()
X = extra_mats()
SS = pmat('m_stainless', (0.5, 0.5, 0.51), 1.0, 0.3, rough_var=0.08, wear=0.0, bump=0.25, bump_scale=2400)
DK = M['steel']
RB = pmat('m_grub', (0.025, 0.025, 0.026), 0.0, 0.78, rough_var=0.05, wear=0.2, wear_col=(0.06, 0.06, 0.06), wear_metal=0.0, bump=0.12, stipple=0.5, stipple_scale=1100)
BR = M['brass']
CZ = -0.0135          # cylinder axis height
CY0, CY1 = -0.004, 0.042

# ---------------- frame
fp = [(0.054, 0.012), (0.054, -0.03), (0.046, -0.04), (-0.028, -0.04), (-0.04, -0.05), (-0.058, -0.047), (-0.064, -0.025),
      (-0.058, 0.004), (-0.046, 0.016), (0.046, 0.016), (0.054, 0.014)]
frame = prof('frame', fp, 0.038, SS, bev=0)
cut(frame, box('c_win', (0.06, CY1 - CY0 + 0.003, 0.05), (0, (CY0 + CY1) / 2, CZ + 0.0005), cutter=True))
cut(frame, box('c_ham', (0.0105, 0.03, 0.04), (0, -0.05, 0.012), cutter=True))
# side plate outline + frame flats
pl = [bm_box((0.0012, 0.05, 0.0009), (sx * 0.019, -0.022, -0.034)) for sx in (-1, 1)]
pl += [bm_box((0.0012, 0.0009, 0.045), (sx * 0.019, -0.002, -0.014)) for sx in (-1, 1)]
cut(frame, merge_bm('c_plate', pl, cutter=True))
bevel(frame, 0.0014, 2)
# top strap rib + rear sight
picat = prof('topstrap', [(-0.044, 0.016), (0.046, 0.016), (0.046, 0.019), (-0.04, 0.019)], 0.014, SS, bev=0.0008)
rs = front('rsight', [(-0.009, 0.018), (0.009, 0.018), (0.009, 0.026), (0.0022, 0.026), (0.0022, 0.0215), (-0.0022, 0.0215), (-0.0022, 0.026), (-0.009, 0.026)],
           0.012, DK, y=-0.036, bev=0.0005)
cyl('rs_screw', 0.0018, 0.004, (0.009, -0.03, 0.022), mat=DK, axis='X', segs=12)
# screws on side plate
for (py, pz) in ((-0.035, -0.026), (-0.008, -0.034), (0.03, -0.036)):
    cyl('screw', 0.0028, 0.04, (0, py, pz), mat=DK, axis='X', segs=16, bev=0.0004)
# cylinder release latch (left)
prof('latch', [(-0.024, -0.012), (-0.01, -0.012), (-0.008, -0.004), (-0.026, -0.004)], 0.004, DK, x=-0.0205, bev=0.0008)
gl = [bm_box((0.002, 0.0012, 0.006), (-0.0225, -0.022 + i * 0.0025, -0.008)) for i in range(6)]
merge_bm('latch_grooves', gl, DK)

# ---------------- barrel, full underlug, vent rib, front sight
cyl('barrel', 0.0112, 0.124, (0, 0.11, 0), mat=SS, segs=32, bore=0.0056)
ul = front('underlug', rrect(0.021, 0.026, 0.009, 5, 0, -0.016), 0.122, SS, y=0.05, bev=0)
cut(ul, cyl('c_ulb', 0.0112, 0.2, (0, 0.11, 0), axis='Y', segs=24, cutter=True))
bevel(ul, 0.0015, 2)
lathe('crown', [(0.0112, 0.172), (0.0116, 0.174), (0.0112, 0.176), (0.0056, 0.176), (0.0056, 0.172)], 32, mat=SS, closed=True)
rib = box('rib', (0.012, 0.122, 0.006), (0, 0.111, 0.0125), SS, bev=0)
vents = [bm_box((0.02, 0.008, 0.004), (0, 0.06 + i * 0.016, 0.0125)) for i in range(7)]
cut(rib, merge_bm('c_vent', vents, cutter=True))
bevel(rib, 0.0007, 2)
fs = prof('fsight', [(0.152, 0.0155), (0.166, 0.0155), (0.166, 0.0175), (0.158, 0.0215), (0.154, 0.0215)], 0.0035, DK, bev=0.0004)
box('fs_insert', (0.0037, 0.003, 0.0025), (0, 0.1555, 0.0195), pmat('m_red', (0.6, 0.03, 0.02), 0.0, 0.3, wear=0.0, bump=0.0), bev=0.0004)
# ---------------- cylinder (group 'cylinder', origin = cylinder axis): fluted, chambers, crane, ejector rod
cy = cyl('cyl_body', 0.021, CY1 - CY0, (0, (CY0 + CY1) / 2, CZ), mat=SS, segs=48, grp='cylinder')
fl = []
ch = []
for k in range(6):
    a = R(60 * k + 90)
    fa = a + R(30)
    fl.append(bm_cyl(0.0042, 0.028, (0.0215 * math.cos(fa), (CY0 + CY1) / 2 + 0.004, CZ + 0.0215 * math.sin(fa)), axis='Y', segs=12))
    ch.append(bm_cyl(0.0058, 0.014, (0.0135 * math.cos(a), CY1, CZ + 0.0135 * math.sin(a)), axis='Y', segs=16))
cut(cy, merge_bm('c_flutes', fl, cutter=True))
cut(cy, merge_bm('c_ch', ch, cutter=True))
cut(cy, cyl('c_ctr', 0.0035, 0.02, (0, CY1, CZ), axis='Y', segs=12, cutter=True))
bevel(cy, 0.0009, 2)
for k in range(6):
    a = R(60 * k + 90)
    lathe('bullet', [(0.0, 0.0), (0.0054, 0.0), (0.0054, 0.002), (0.004, 0.006), (0.0015, 0.0085), (0.0, 0.009)], 12,
          loc=(0.0135 * math.cos(a), CY1 - 0.011, CZ + 0.0135 * math.sin(a)), mat=M['brass'], grp='cylinder')
cyl('ejrod', 0.0026, 0.068, (0, CY1 + 0.034, CZ), mat=SS, segs=14, grp='cylinder')
cyl('ejknob', 0.0034, 0.008, (0, CY1 + 0.064, CZ), mat=SS, segs=14, grp='cylinder', bev=0.0005)
front('crane', [(-0.004, CZ - 0.004), (0.004, CZ - 0.004), (-0.006, -0.038), (-0.012, -0.038)], 0.006, SS, y=CY1 + 0.001, grp='cylinder', bev=0.0006)
cyl('crane_arm', 0.0028, 0.05, (-0.009, (CY0 + CY1) / 2 + 0.004, -0.036), mat=SS, segs=14, grp='cylinder')

# ---------------- hammer (origin = pivot), trigger (pivot), trigger guard
hp = [(-0.04, -0.01), (-0.032, -0.004), (-0.034, 0.008), (-0.05, 0.02), (-0.064, 0.024), (-0.066, 0.018), (-0.054, 0.01), (-0.05, -0.008)]
ham = prof('hammer', hp, 0.009, DK, grp='hammer', bev=0.0008)
spur = [bm_box((0.0105, 0.0012, 0.003), (0, -0.058 - i * 0.0022, 0.0215 + i * 0.0002), (R(-30), 0, 0)) for i in range(4)]
cut(ham, merge_bm('c_spur', spur, cutter=True))
tg = prof('tguard', [(-0.034, -0.04), (0.02, -0.04), (0.02, -0.048), (0.012, -0.07), (-0.026, -0.072), (-0.036, -0.06)], 0.011, SS, bev=0)
cut(tg, prof('c_tg', [(-0.028, -0.036), (0.014, -0.036), (0.008, -0.064), (-0.024, -0.066)], 0.03, cutter=True))
bevel(tg, 0.0015, 2)
prof('trigger', [(-0.004, -0.041), (0.005, -0.041), (0.004, -0.05), (-0.002, -0.06), (-0.009, -0.064), (-0.011, -0.062), (-0.004, -0.054), (-0.003, -0.048)],
     0.008, DK, grp='trigger', bev=0.0008)

# ---------------- rubber grip with finger grooves (raked)
ang = R(14)
ax = Vector((0, -math.sin(ang), -math.cos(ang)))
fwd = Vector((0, math.cos(ang), -math.sin(ang)))
top = Vector((0, -0.048, -0.042))
frames = []
for (t, w, d, fo) in [(-0.006, 0.03, 0.044, 0.0), (0.008, 0.033, 0.05, 0.0), (0.026, 0.035, 0.05, -0.004), (0.042, 0.036, 0.054, 0.002),
                      (0.058, 0.036, 0.05, -0.003), (0.074, 0.036, 0.054, 0.002), (0.092, 0.035, 0.054, 0.0), (0.106, 0.033, 0.05, 0.0), (0.112, 0.029, 0.044, 0.0)]:
    frames.append((top + ax * t + fwd * (fo - 0.004), (1, 0, 0), fwd, w, d))
g = loft('grip', frames, rrect(1.0, 1.0, 0.42, 5), RB)
subsurf(g, 1)
cyl('grip_screw', 0.0032, 0.038, tuple(top + ax * 0.05), mat=SS, axis='X', segs=16, bev=0.0004)

# ---------------- speedloader (group 'magazine'): parked behind the cylinder axis, hide unless reloading
SY = -0.05
cyl('sl_body', 0.0175, 0.012, (0, SY, CZ), mat=M['poly'], segs=32, grp='magazine', bev=0.001)
lathe('sl_knob', [(0.0, SY - 0.022), (0.009, SY - 0.022), (0.0105, SY - 0.017), (0.0085, SY - 0.006), (0.0, SY - 0.006)], 20, loc=(0, 0, CZ), mat=M['grip'], grp='magazine')
for k in range(6):
    a = R(60 * k + 90)
    lathe('sl_round', [(0.0, 0.0), (0.0062, 0.0), (0.0062, 0.0015), (0.0057, 0.0015), (0.0057, 0.03), (0.0045, 0.035), (0.0018, 0.039), (0.0, 0.04)], 14,
          loc=(0.0135 * math.cos(a), SY + 0.006, CZ + 0.0135 * math.sin(a)), mat=M['brass'], grp='magazine')

gr = top + ax * 0.048
marks = {
    'muzzle': (0, 0.176, 0),
    'grip_r': tuple(gr),
    'grip_l': tuple(gr + Vector((-0.024, 0.012, -0.004))),
    'sight': (0, -0.036, 0.0215),
    'eject': (-0.03, 0.01, -0.04),
    'cyl_axis': (0, (CY0 + CY1) / 2, CZ),
    'crane_pivot': (-0.009, (CY0 + CY1) / 2, -0.036),
    'magwell': (0, CY0, CZ),
}
print('built', len(CTX['col'].objects))
if globals().get('FINISH'):
    root, out = finish_gun('poxiao', marks, {'cylinder': marks['cyl_axis'], 'hammer': (0, -0.045, -0.006), 'trigger': (0, 0.0, -0.041),
                                             'magazine': (0, SY, CZ)}, size=2048)
    print(export_glb('poxiao', root))
