# 夜莺 — original cheap stamped-steel machine pistol, magazine in the grip, side-folding wire stock. +Y fwd, +Z up, bore z=0.
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())
setup_scene('W_yeying')
M = mats()
X = extra_mats()
ST = M['parker']   # stamped, parkerised steel
S, P, G = M['steel'], M['poly'], M['grip']
SZ = 0.034         # sight line

# ---------------- stamped receiver (rounded box) with pressed ribs & weld seam
rc = rrect(0.034, 0.046, 0.007, 4, 0, 0.0)
recv = front('receiver', rc, 0.185, ST, y=-0.085, bev=0)
cut(recv, box('c_eport', (0.012, 0.03, 0.014), (0.0145, 0.03, 0.006), cutter=True))
cut(recv, box('c_cslot', (0.006, 0.09, 0.012), (0, 0.025, 0.022), cutter=True))
bevel(recv, 0.0012, 2)
for sx in (-1, 1):
    for zz in (0.012, -0.012):
        box('rib', (0.002, 0.13, 0.0035), (sx * 0.0175, 0.0, zz), ST, bev=0.0009)
    box('seam', (0.0006, 0.17, 0.0012), (sx * 0.017, 0.007, -0.0225), S, bev=0)
# end caps
front('rearcap', rrect(0.036, 0.048, 0.008, 4, 0, 0.0), 0.006, ST, y=-0.091, bev=0.0012)
front('frontcap', rrect(0.036, 0.048, 0.008, 4, 0, 0.0), 0.006, ST, y=0.1, bev=0.0012)
cyl('takedown', 0.0045, 0.006, (0, -0.094, 0.006), mat=S, segs=16, bev=0.0005)
# rivets
for py in (-0.07, -0.03, 0.02, 0.07):
    for sx in (-1, 1):
        lathe('rivet', [(0.0, 0.0), (0.0018, 0.0), (0.0016, 0.0008), (0.0, 0.0011)], 10, loc=(sx * 0.0168, py, 0.0), rot=(0, 0, R(-90 * sx)), mat=S)
# cocking knob (top)
cyl('ck_stem', 0.0025, 0.012, (0, 0.055, 0.026), mat=S, axis='Z', segs=12)
lathe('ck_knob', [(0.0, 0.0), (0.006, 0.0), (0.0065, 0.003), (0.006, 0.006), (0.0, 0.0065)], 18, loc=(0, 0.055, 0.03), axis='Z', mat=P, bev=0.0004)
# bolt (visible in port)
box('bolt', (0.008, 0.028, 0.012), (0.0105, 0.03, 0.005), S, grp='bolt', bev=0.0008)

# ---------------- barrel + threaded muzzle + barrel nut
cyl('bnut', 0.0125, 0.012, (0, 0.112, 0), mat=ST, segs=6, bev=0.0008)
cyl('barrel', 0.0075, 0.05, (0, 0.14, 0), mat=S, segs=24, bore=0.0046)
for i in range(6):
    lathe('thread', tube_ring_pts(0.0076, 0.0006, 6), 24, loc=(0, 0.158 + i * 0.0016, 0), mat=S, closed=True)
lathe('crown', [(0.0078, 0.165), (0.008, 0.167), (0.0046, 0.167), (0.0046, 0.165)], 24, mat=S, closed=True)

# ---------------- sights: front post with ears, rear flip peep
box('fs_base', (0.014, 0.01, 0.006), (0, 0.092, 0.026), ST, bev=0.0008)
for sx in (-1, 1):
    prof('fs_ear', [(0.088, 0.028), (0.096, 0.028), (0.095, 0.038), (0.089, 0.038)], 0.0018, ST, x=sx * 0.0065, bev=0.0004)
prof('fs_post', [(0.0905, 0.028), (0.0935, 0.028), (0.0935, SZ), (0.0905, SZ)], 0.0022, ST, bev=0.0003)
box('rs_base', (0.016, 0.012, 0.005), (0, -0.07, 0.0255), ST, bev=0.0008)
rsp = front('rs_leaf', rrect(0.014, 0.014, 0.003, 3, 0, SZ), 0.003, ST, y=-0.072, bev=0)
cut(rsp, cyl('c_peep', 0.0017, 0.02, (0, -0.07, SZ), axis='Y', segs=14, cutter=True))
bevel(rsp, 0.0005, 1)

# ---------------- lower: grip with magazine well (polymer shells), big trigger guard, front hand strap
ang = R(8)
ax = Vector((0, -math.sin(ang), -math.cos(ang)))
fwd = Vector((0, math.cos(ang), -math.sin(ang)))
top = Vector((0, -0.01, -0.022))
frames = []
for (t, w, d, fo) in [(0.0, 0.034, 0.048, 0.0), (0.02, 0.035, 0.048, 0.0), (0.05, 0.035, 0.046, 0.0), (0.08, 0.035, 0.047, 0.0), (0.1, 0.034, 0.047, 0.0)]:
    frames.append((top + ax * t + fwd * fo, (1, 0, 0), fwd, w, d))
grip = loft('grip', frames, rrect(1.0, 1.0, 0.35, 4), G)
cut(grip, loft('c_well', [(top + ax * 0.06, (1, 0, 0), fwd, 0.0235, 0.034), (top + ax * 0.12, (1, 0, 0), fwd, 0.0235, 0.034)], rrect(1.0, 1.0, 0.2, 3)))
for o in CTX['col'].objects:
    if o.name.startswith('c_well'):
        for c in list(o.users_collection): c.objects.unlink(o)
        CTX['cut'].objects.link(o); o.display_type = 'WIRE'; o.hide_render = True
gr = [bm_box((0.0012, 0.036, 0.002), tuple(top + ax * (0.02 + i * 0.006) + Vector((sx * 0.0176, 0, 0))), (-ang, 0, 0)) for i in range(10) for sx in (-1, 1)]
cut(grip, merge_bm('c_gr', gr, cutter=True))
bevel(grip, 0.0015, 2)
lc = top + ax * 0.1
loft('grip_heel', [(lc, (1, 0, 0), fwd, 0.036, 0.05), (lc + ax * 0.004, (1, 0, 0), fwd, 0.034, 0.048)], rrect(1.0, 1.0, 0.35, 4), ST, bev=0.0008)
box('magrel', (0.004, 0.008, 0.008), tuple(top + ax * 0.09 + Vector((0.0185, -0.012, 0))), S, bev=0.0012)
tg = prof('tguard', [(0.008, -0.022), (0.07, -0.022), (0.07, -0.03), (0.06, -0.052), (0.014, -0.054), (0.006, -0.046)], 0.011, ST, bev=0)
cut(tg, prof('c_tg', [(0.014, -0.018), (0.064, -0.018), (0.056, -0.047), (0.016, -0.048)], 0.03, cutter=True))
bevel(tg, 0.0015, 2)
prof('trigger', [(0.022, -0.023), (0.03, -0.023), (0.029, -0.031), (0.024, -0.04), (0.018, -0.044), (0.016, -0.042), (0.022, -0.035), (0.023, -0.029)],
     0.0065, S, grp='trigger', bev=0.0008)
# selector + safety
cyl('sel', 0.005, 0.004, (-0.0185, -0.025, -0.012), mat=S, axis='X', segs=18, bev=0.0005)
prof('sel_lever', [(-0.03, -0.01), (-0.016, -0.008), (-0.016, -0.012), (-0.03, -0.015)], 0.0025, S, x=-0.0205, bev=0.0005)
# front hand strap (loop) under barrel
hs = prof('handstrap', [(0.07, -0.022), (0.1, -0.022), (0.1, -0.026), (0.092, -0.042), (0.085, -0.042), (0.093, -0.027), (0.07, -0.027)], 0.012, ST, bev=0.0009)
# sling loop rear
torus('sling', 0.006, 0.0015, (0.0, -0.092, -0.018), (R(90), 0, 0), S, segs=16, n=6)

# ---------------- side-folding wire stock (group 'stock', origin = hinge)
HX = -0.022
for zz in (0.012, -0.012):
    cyl('st_rod', 0.0032, 0.16, (HX, -0.005, zz), mat=S, segs=12, grp='stock')
cyl('st_hinge', 0.006, 0.026, (HX, -0.087, 0.0), mat=ST, axis='Z', segs=16, grp='stock', bev=0.0006)
bp = prof('st_butt', [(0.074, 0.022), (0.084, 0.022), (0.086, -0.022), (0.076, -0.024)], 0.008, ST, x=HX, grp='stock', bev=0.0012)
box('st_pad', (0.008, 0.006, 0.05), (HX, 0.087, -0.001), M['rubber'], grp='stock', bev=0.0015)

# ---------------- magazine (straight, in the grip), origin at top
mtop = top + ax * 0.05
mbot = top + ax * 0.175
mf = [(mtop.lerp(mbot, t), (1, 0, 0), fwd, 0.0225, 0.033) for t in (0.0, 0.5, 1.0)]
mg = loft('mag_body', mf, rrect(1.0, 1.0, 0.25, 4), S, grp='magazine')
wh = [bm_cyl(0.0016, 0.03, tuple(mtop.lerp(mbot, 0.6 + i * 0.08) - fwd * 0.012), axis='X', segs=8) for i in range(4)]
cut(mg, merge_bm('c_wh', wh, cutter=True))
bevel(mg, 0.0007, 2)
loft('mag_base', [(mbot, (1, 0, 0), fwd, 0.026, 0.037), (mbot + ax * 0.008, (1, 0, 0), fwd, 0.025, 0.035)], rrect(1.0, 1.0, 0.3, 4), P, grp='magazine', bev=0.0012)
lathe('cart', [(0.0, 0.0), (0.0045, 0.0), (0.0048, 0.002), (0.0048, 0.019), (0.0044, 0.021), (0.0034, 0.026), (0.0015, 0.029), (0.0, 0.0295)], 12,
      loc=tuple(top + ax * 0.006 - fwd * 0.012), mat=M['brass'], grp='magazine', rot=(-ang, 0, 0))

marks = {
    'muzzle': (0, 0.167, 0),
    'grip_r': tuple(top + ax * 0.045),
    'grip_l': tuple(top + ax * 0.075 + Vector((-0.02, 0.02, 0))),
    'sight': (0, -0.07, SZ),
    'eject': (0.018, 0.03, 0.006),
    'magwell': tuple(mtop),
    'stock_hinge': (HX, -0.087, 0.0),
}
print('built', len(CTX['col'].objects))
if globals().get('FINISH'):
    root, out = finish_gun('yeying', marks, {'magazine': marks['magwell'], 'trigger': (0, 0.026, -0.023), 'stock': marks['stock_hinge']}, size=2048)
    print(export_glb('yeying', root))
