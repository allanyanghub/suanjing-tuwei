# 雨燕 SMG — original compact 9mm SMG. Blender: +Y forward, +Z up, +X right. Bore axis z=0.
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())
setup_scene('W_yuyan')
M = mats()
A, S, P, G, RB, C = M['alu'], M['steel'], M['poly'], M['grip'], M['rubber'], M['cera']

# ---------------- upper receiver (cross-section extruded along Y)
up_pts = [(-0.0165, -0.019), (0.0165, -0.019), (0.0165, 0.016), (0.0115, 0.0215), (-0.0115, 0.0215), (-0.0165, 0.016)]
upper = front('upper', up_pts, 0.245, A, y=-0.11, bev=0)
# ejection port pocket (right side)
cut(upper, box('c_port', (0.014, 0.046, 0.019), (0.0135, 0.022, 0.0035), cutter=True))
# charging slot (left side)
cut(upper, box('c_chs', (0.008, 0.1, 0.0055), (-0.0175, 0.075, 0.0055), cutter=True))
# side flutes / panel lines (both sides)
fl = []
for sx in (-1, 1):
    fl.append(bm_box((0.003, 0.07, 0.0028), (sx * 0.0168, -0.062, 0.0085)))
    fl.append(bm_box((0.0016, 0.235, 0.0012), (sx * 0.0168, 0.012, -0.0105)))
    fl.append(bm_box((0.0016, 0.0012, 0.03), (sx * 0.0168, -0.022, 0.0)))
cut(upper, merge_bm('c_flutes', fl, cutter=True))
bevel(upper, 0.0011, 2)
picatinny('rail_up', -0.105, 0.132, 0.0305, A, zbase=0.0205)

# forward assist-ish bolt release pad on left, rear end plate
box('endplate', (0.035, 0.006, 0.042), (0, -0.112, 0.0005), A, bev=0.0012)
cyl('endbtn', 0.0055, 0.006, (0.0, -0.117, -0.004), mat=S, bev=0.0006, segs=20)

# ---------------- lower receiver (side profile)
lo_pts = [(-0.098, -0.019), (0.092, -0.019), (0.092, -0.032), (0.094, -0.084), (0.098, -0.092), (0.03, -0.092),
          (0.034, -0.084), (0.032, -0.05), (-0.036, -0.05), (-0.06, -0.047), (-0.098, -0.035)]
lower = prof('lower', lo_pts, 0.0335, P, bev=0)
# magwell hole
cut(lower, box('c_well', (0.0235, 0.038, 0.09), (0, 0.0625, -0.07), cutter=True))
# flare inner chamfer: slightly larger at bottom
cut(lower, box('c_well2', (0.027, 0.046, 0.01), (0, 0.0635, -0.093), rot=(0, 0, 0), cutter=True))
# texture panel recess on magwell sides
rec = [bm_box((0.002, 0.04, 0.026), (sx * 0.0168, 0.063, -0.062)) for sx in (-1, 1)]
cut(lower, merge_bm('c_rec', rec, cutter=True))
bevel(lower, 0.0012, 2)
# ribs inside recess
ribs = []
for sx in (-1, 1):
    for i in range(5):
        ribs.append(bm_box((0.0014, 0.0022, 0.022), (sx * 0.0162, 0.047 + i * 0.008, -0.062)))
merge_bm('wellribs', ribs, P)

# raised side bosses around fire-control area
for sx in (-1, 1):
    prof('boss', [(-0.075, -0.021), (0.02, -0.021), (0.026, -0.03), (0.022, -0.046), (-0.03, -0.046), (-0.06, -0.042), (-0.075, -0.034)], 0.002, P, x=sx * 0.0172, bev=0.0006)
# pins (through lower), with heads both sides
for (py, pz) in ((-0.085, -0.027), (0.08, -0.027), (0.004, -0.03), (-0.02, -0.03)):
    cyl('pin', 0.0024, 0.0385, (0, py, pz), mat=S, axis='X', segs=14, bev=0.0004)
# mag release (right) + bolt catch (left)
box('magrel', (0.004, 0.009, 0.009), (0.0178, 0.026, -0.04), S, bev=0.0012)
prof('boltcatch', [(0.018, -0.024), (0.03, -0.024), (0.032, -0.03), (0.02, -0.042), (0.016, -0.038)], 0.003, S, x=-0.0182, bev=0.0006)
# safety selector (both sides)
for sx in (-1, 1):
    cyl('selhub', 0.0055, 0.003, (sx * 0.0183, -0.04, -0.03), mat=S, axis='X', segs=20, bev=0.0005)
    prof('selpad', [(-0.042, -0.027), (-0.024, -0.024), (-0.022, -0.028), (-0.04, -0.033)], 0.0025, S, x=sx * 0.0195, bev=0.0005)

# ---------------- trigger guard
tg = prof('tguard', [(-0.046, -0.049), (0.034, -0.049), (0.034, -0.058), (0.028, -0.074), (-0.034, -0.074), (-0.048, -0.064)], 0.011, P, bev=0)
cut(tg, prof('c_tg', [(-0.032, -0.045), (0.028, -0.045), (0.024, -0.068), (-0.03, -0.068)], 0.03, cutter=True))
bevel(tg, 0.0015, 2)

# trigger (pivot at top)
trig = prof('trigger', [(0.0, -0.047), (0.009, -0.047), (0.0085, -0.054), (0.003, -0.063), (-0.004, -0.067), (-0.006, -0.0655), (0.0005, -0.058), (0.002, -0.052)], 0.0062, S, grp='trigger', bev=0.0008)

# ---------------- pistol grip (loft along raked axis)
ang = R(16)
ax = Vector((0, -math.sin(ang), -math.cos(ang)))
fwd = Vector((0, math.cos(ang), -math.sin(ang)))
top = Vector((0, -0.044, -0.043))
gp = rrect(1.0, 1.0, 0.42, 5)
frames = []
# (t along axis, width, depth, forward offset)
prof_g = [(0.0, 0.029, 0.046, 0.0), (0.012, 0.03, 0.047, 0.0), (0.03, 0.031, 0.045, -0.002), (0.045, 0.032, 0.047, 0.001),
          (0.06, 0.031, 0.044, -0.0015), (0.075, 0.032, 0.047, 0.001), (0.09, 0.032, 0.048, 0.0), (0.103, 0.031, 0.048, 0.0)]
for (t, w, d, fo) in prof_g:
    o = top + ax * t + fwd * fo
    frames.append((o, (1, 0, 0), fwd, w, d))
grip = loft('pgrip', frames, gp, G)
subsurf(grip, 1)
# beavertail
prof('beaver', [(-0.098, -0.034), (-0.06, -0.047), (-0.064, -0.058), (-0.078, -0.054), (-0.1, -0.042)], 0.03, P, bev=0.003)
# grip cap
lc = top + ax * 0.104
cp = loft('gcap', [(lc, (1, 0, 0), fwd, 0.0325, 0.049), (lc + ax * 0.006, (1, 0, 0), fwd, 0.03, 0.046)], gp, P, bev=0.0008)

# ---------------- handguard (octagon tube)
hg = lathe('handguard', [(0.0245, 0.13), (0.0245, 0.285), (0.0205, 0.285), (0.0205, 0.13)], 8, rot=(0, R(22.5), 0), mat=C, closed=True)
sl = []
for k in range(8):
    a = R(45 * k)
    if k == 6:  # top (rail)
        continue
    for i in range(3):
        y = 0.152 + i * 0.044
        m = Matrix.Rotation(a, 4, 'Y') @ T((0.024, y, 0), (0, 0, 0), (0.012, 0.032, 0.0072))
        b = bmesh.new(); bmesh.ops.create_cube(b, size=1.0); bmesh.ops.transform(b, matrix=m, verts=b.verts)
        sl.append(b)
cut(hg, merge_bm('c_slots', sl, cutter=True))
bevel(hg, 0.0009, 2)
picatinny('rail_hg', 0.138, 0.284, 0.0305, C, zbase=0.019)
lathe('hgcap', [(0.0255, 0.283), (0.0255, 0.291), (0.024, 0.293), (0.0105, 0.293), (0.0105, 0.283)], 8, rot=(0, R(22.5), 0), mat=C, bev=0.0006)
# barrel nut ring at receiver front
cyl('bnut', 0.0215, 0.012, (0, 0.13, 0), mat=S, segs=28, bev=0.0008)

# ---------------- barrel + flash hider
cyl('barrel', 0.0078, 0.2, (0, 0.2, 0), mat=S, segs=24, bore=0.0046)
lathe('locknut', [(0.0105, 0.293), (0.0118, 0.296), (0.0118, 0.305), (0.0105, 0.308), (0.0078, 0.308), (0.0078, 0.293)], 6, mat=S, closed=True, bev=0.0006)
fh = lathe('flashhider', [(0.0105, 0.308), (0.0108, 0.312), (0.011, 0.36), (0.0098, 0.362), (0.0068, 0.362), (0.0062, 0.35), (0.0046, 0.338), (0.0046, 0.308)], 28, mat=S, closed=True)
pr = []
for k in range(3):
    a = R(120 * k + 90)
    m = Matrix.Rotation(a, 4, 'Y') @ T((0, 0.348, 0.011), (0, 0, 0), (0.0032, 0.03, 0.012))
    b = bmesh.new(); bmesh.ops.create_cube(b, size=1.0); bmesh.ops.transform(b, matrix=m, verts=b.verts); pr.append(b)
cut(fh, merge_bm('c_prong', pr, cutter=True))
bevel(fh, 0.0005, 1, angle=40)

# ---------------- charging handle (left, forward)
ch = []
cyl('chstem', 0.0026, 0.014, (-0.0225, 0.112, 0.0055), mat=S, axis='X', segs=12)
lathe('chknob', [(0.0, -0.036), (0.0052, -0.0355), (0.006, -0.032), (0.006, -0.0275), (0.0045, -0.026), (0.0, -0.026)], 18, loc=(0, 0.112, 0.0055), axis='X', mat=P, bev=0.0004)

# ---------------- reflex sight (open frame)
yb, zr = 0.0, 0.0305
box('rd_base', (0.026, 0.034, 0.0065), (0, yb + 0.012, zr + 0.003), A, bev=0.0012)
box('rd_clamp', (0.006, 0.02, 0.012), (0.0135, yb + 0.012, zr - 0.002), A, bev=0.0012)
cyl('rd_screw', 0.0032, 0.004, (0.0175, yb + 0.012, zr - 0.002), mat=S, axis='X', segs=16, bev=0.0004)
frame = front('rd_frame', rrect(0.03, 0.025, 0.005, 4, 0, zr + 0.0185), 0.008, A, y=yb + 0.018, bev=0)
cut(frame, front('c_win', rrect(0.0245, 0.0195, 0.003, 4, 0, zr + 0.019), 0.03, y=yb + 0.005, cutter=True))
# hood slope to rear
prof('rd_hood', [(yb + 0.018, zr + 0.0065), (yb + 0.026, zr + 0.0065), (yb + 0.026, zr + 0.009), (yb + 0.018, zr + 0.009)], 0.03, A, bev=0.001)
bevel(frame, 0.0009, 2)
box('rd_led', (0.008, 0.006, 0.004), (0, yb - 0.001, zr + 0.0083), A, bev=0.001)
cyl('rd_btn', 0.0022, 0.003, (-0.0145, yb + 0.004, zr + 0.004), mat=RB, axis='X', segs=12)
cyl('rd_btn2', 0.0022, 0.003, (-0.0145, yb + 0.012, zr + 0.004), mat=RB, axis='X', segs=12)
box('rd_glass', (0.025, 0.0012, 0.02), (0, yb + 0.022, zr + 0.019), M['glass'], rot=(R(-4), 0, 0))
# rear flip-up iron sight (folded)
box('rs_base', (0.02, 0.016, 0.006), (0, -0.09, zr + 0.003), A, bev=0.001)
prof('rs_leaf', [(-0.098, zr + 0.006), (-0.08, zr + 0.006), (-0.083, zr + 0.011), (-0.096, zr + 0.011)], 0.016, A, bev=0.0008)
# front flip-up (folded) at handguard end
box('fs_base', (0.02, 0.016, 0.006), (0, 0.27, zr + 0.003), A, bev=0.001)
prof('fs_leaf', [(0.262, zr + 0.006), (0.282, zr + 0.006), (0.279, zr + 0.01), (0.265, zr + 0.01)], 0.014, A, bev=0.0008)

# ---------------- stock: collapsible twin-rod
for sx in (-1, 1):
    cyl('rod', 0.0042, 0.105, (sx * 0.0115, -0.163, -0.006), mat=S, segs=16, bev=0.0004)
    cyl('rodcap', 0.0052, 0.008, (sx * 0.0115, -0.118, -0.006), mat=P, segs=16, bev=0.0006)
box('stockblock', (0.036, 0.014, 0.026), (0, -0.115, -0.006), P, bev=0.002)
# butt: tapered polymer frame (front profile loft) + rubber pad
bf = []
for (y, w, h, zc) in ((-0.205, 0.03, 0.05, -0.01), (-0.214, 0.036, 0.09, -0.02), (-0.226, 0.038, 0.11, -0.025)):
    bf.append(((0, y, zc), (1, 0, 0), (0, 0, 1), w, h))
butt = loft('buttframe', bf, rrect(1.0, 1.0, 0.3, 4), P)
cut(butt, box('c_btw', (0.06, 0.012, 0.03), (0, -0.218, -0.035), cutter=True))
bevel(butt, 0.0015, 2)
pad = loft('buttpad', [((0, -0.226, -0.025), (1, 0, 0), (0, 0, 1), 0.039, 0.112), ((0, -0.24, -0.025), (1, 0, 0), (0, 0, 1), 0.039, 0.114),
                       ((0, -0.243, -0.025), (1, 0, 0), (0, 0, 1), 0.035, 0.108)], rrect(1.0, 1.0, 0.35, 4), RB)
grooves = [bm_box((0.05, 0.016, 0.0012), (0, -0.236, -0.07 + i * 0.006)) for i in range(16)]
cut(pad, merge_bm('c_padg', grooves, cutter=True))
bevel(pad, 0.0008, 1)
# lock lever on stock block
prof('stocklever', [(-0.124, -0.022), (-0.108, -0.022), (-0.106, -0.027), (-0.126, -0.027)], 0.03, S, bev=0.0008)
# sling QD socket + loop on rear left
cyl('qd', 0.006, 0.004, (-0.019, -0.1, -0.008), mat=S, axis='X', segs=20, bev=0.0005)
torus('sling', 0.0085, 0.0018, (-0.022, -0.1, -0.016), (0, R(0), R(90)), S, segs=18, n=8)

# ---------------- bolt (visible in port)
bolt = box('bolt', (0.009, 0.044, 0.016), (0.0105, 0.022, 0.0035), S, grp='bolt', bev=0.0008)
box('extractor', (0.003, 0.014, 0.004), (0.0152, 0.034, 0.0075), S, grp='bolt', bev=0.0006)
# dust shield lip around port
prof('portlip', [(-0.002, -0.0075), (0.046, -0.0075), (0.046, -0.0095), (-0.002, -0.0095)], 0.0025, A, x=0.0172, bev=0.0004)

# ---------------- magazine (straight double-stack), origin at top centre
mg = rrect(1.0, 1.0, 0.25, 4)
mag_frames = []
for (z, w, d) in ((-0.026, 0.0215, 0.033), (-0.05, 0.022, 0.034), (-0.2, 0.022, 0.034)):
    mag_frames.append(((0, 0.0625, z), (1, 0, 0), (0, 1, 0), w, d))
magb = loft('mag_body', mag_frames, mg, S, grp='magazine')
# ribs + witness holes (cut)
wh = [bm_cyl(0.0018, 0.01, (0, 0.05, -0.07 - i * 0.025), axis='X', segs=10) for i in range(5)]
cut(magb, merge_bm('c_wh', wh, cutter=True))
bevel(magb, 0.0007, 2)
for sx in (-1, 1):
    box('mag_rib', (0.0016, 0.006, 0.14), (sx * 0.011, 0.066, -0.13), S, grp='magazine', bev=0.0006)
# baseplate
prof('mag_base', [(0.042, -0.198), (0.083, -0.198), (0.086, -0.205), (0.083, -0.214), (0.044, -0.214), (0.041, -0.206)], 0.027, P, grp='magazine', bev=0.0014)
# top cartridge
lathe('cart', [(0.0, 0.0), (0.0045, 0.0), (0.0048, 0.002), (0.0048, 0.019), (0.0044, 0.021), (0.0034, 0.026), (0.0015, 0.029), (0.0, 0.0295)], 14,
      loc=(0.0, 0.05, -0.024), mat=M['brass'], grp='magazine', rot=(R(-4), 0, 0))
# feed lips
for sx in (-1, 1):
    box('lip', (0.002, 0.026, 0.004), (sx * 0.0065, 0.062, -0.0255), S, grp='magazine', bev=0.0005)

# ---------------- empties
gr_top = top + ax * 0.045
marks = {
    'muzzle': (0, 0.362, 0),
    'grip_r': tuple(gr_top),
    'grip_l': (0, 0.22, -0.002),
    'sight': (0, 0.022, zr + 0.019),
    'eject': (0.018, 0.022, 0.004),
    'magwell': (0, 0.0625, -0.03),
}
print('built', len(CTX['col'].objects))

if globals().get('FINISH'):
    root, out = finish_gun('yuyan', marks, {'magazine': marks['magwell'], 'trigger': (0, 0.0045, -0.047)}, size=2048)
    print(export_glb('yuyan', root))
