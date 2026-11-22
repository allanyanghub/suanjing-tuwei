# 奔雷 — original belt-fed light machine gun with 100-round box, heavy QC barrel, heat shield, folded bipod. +Y fwd, +Z up, bore z=0.
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())
setup_scene('W_benlei')
M = mats()
X = extra_mats()
ST, S, A, P, G, RB = M['parker'], M['steel'], M['alu'], M['poly'], M['grip'], M['rubber']
OD = X['olive']
SZ = 0.064     # sight line

# ---------------- receiver (stamped box) with rivets, ribs, bottom ejection port
rp = [(-0.026, -0.032), (0.026, -0.032), (0.026, 0.036), (0.022, 0.042), (-0.022, 0.042), (-0.026, 0.036)]
recv = front('receiver', rp, 0.26, ST, y=-0.14, bev=0)
cut(recv, box('c_ejport', (0.02, 0.06, 0.02), (0, 0.03, -0.034), cutter=True))
cut(recv, box('c_feed', (0.02, 0.06, 0.03), (-0.026, 0.0, 0.016), cutter=True))     # left feed opening
cut(recv, box('c_chs', (0.008, 0.14, 0.008), (0.026, 0.03, 0.004), cutter=True))    # charging slot right
rr = []
for sx in (-1, 1):
    rr.append(bm_box((0.0016, 0.23, 0.0012), (sx * 0.026, -0.01, -0.016)))
    rr.append(bm_box((0.0016, 0.0012, 0.05), (sx * 0.026, -0.1, 0.0)))
cut(recv, merge_bm('c_lines', rr, cutter=True))
bevel(recv, 0.0014, 2)
for py in (-0.12, -0.08, -0.04, 0.06, 0.1):
    for sx in (-1, 1):
        for pz in (-0.024, 0.03):
            lathe('rivet', [(0.0, 0.0), (0.0022, 0.0), (0.0019, 0.001), (0.0, 0.0014)], 10, loc=(sx * 0.0258, py, pz), rot=(0, 0, R(-90 * sx)), mat=S)
# feed tray lips (left)
for pz in (0.003, 0.03):
    box('feedlip', (0.012, 0.064, 0.003), (-0.031, 0.0, pz), S, bev=0.0006)
# trunnion block + barrel lock
front('trunnion', rrect(0.056, 0.07, 0.006, 4, 0, 0.004), 0.03, ST, y=0.12, bev=0.0015)
lathe('barrelnut', [(0.016, 0.15), (0.019, 0.152), (0.019, 0.164), (0.016, 0.166), (0.012, 0.166), (0.012, 0.15)], 8, mat=S, closed=True, bev=0.0006)
# charging handle (right, folding)
cyl('ch_stem', 0.003, 0.016, (0.034, 0.08, 0.004), mat=S, axis='X', segs=12)
box('ch_handle', (0.008, 0.014, 0.03), (0.044, 0.08, 0.004), S, bev=0.002)

# ---------------- feed cover (group 'cover', hinge at the rear top), rail + rear leaf sight on top
cv = prof('cover_body', [(-0.07, 0.042), (0.11, 0.042), (0.115, 0.046), (0.11, 0.054), (-0.06, 0.054), (-0.072, 0.049)], 0.054, ST, grp='cover', bev=0)
cut(cv, merge_bm('c_cvl', [bm_box((0.06, 0.0012, 0.004), (0, -0.02 + i * 0.04, 0.054)) for i in range(4)], cutter=True))
bevel(cv, 0.0014, 2)
picatinny('cover_rail', -0.055, 0.095, 0.0605, A, grp='cover', zbase=0.053)
for o in CTX['col'].objects:
    if o.name.startswith('cover_rail'):
        o['grp'] = 'cover'
cyl('cover_hinge', 0.004, 0.058, (0, -0.07, 0.046), mat=S, axis='X', segs=14, grp='cover')
box('cover_latch', (0.03, 0.008, 0.006), (0, 0.112, 0.05), S, grp='cover', bev=0.0015)
# rear aperture sight on the cover rail
box('rs_base', (0.022, 0.02, 0.006), (0, -0.03, 0.0635), A, grp='cover', bev=0.001)
rsl = front('rs_leaf', rrect(0.02, 0.016, 0.003, 3, 0, SZ + 0.002), 0.004, A, y=-0.032, grp='cover', bev=0)
cut(rsl, cyl('c_rsap', 0.002, 0.02, (0, -0.03, SZ), axis='Y', segs=14, cutter=True))
bevel(rsl, 0.0005, 1)

# ---------------- heavy barrel, quick-change carry handle, perforated heat shield, flash hider
cyl('barrel', 0.0125, 0.5, (0, 0.415, 0), mat=S, segs=32, bore=0.0039)
flute = [bm_box((0.003, 0.15, 0.003), (0.0125 * math.cos(R(a)), 0.45, 0.0125 * math.sin(R(a))), (0, R(-a + 90), 0)) for a in range(0, 360, 45)]
cut(bpy.data.objects['barrel'], merge_bm('c_bflute', flute, cutter=True))
hs = lathe('heatshield', [(0.019, 0.17), (0.019, 0.43), (0.0165, 0.43), (0.0165, 0.17)], 36, mat=ST, closed=True)
cut(hs, box('c_hshalf', (0.06, 0.4, 0.04), (0, 0.3, -0.02), cutter=True))
holes = [bm_cyl(0.0032, 0.05, (0.0185 * math.cos(R(a)), 0.19 + i * 0.022, 0.0185 * math.sin(R(a))), segs=10, axis='Z', rot=(0, R(90 - a), 0))
         for i in range(11) for a in (40, 90, 140)]
cut(hs, merge_bm('c_hsh', holes, cutter=True))
bevel(hs, 0.0006, 1)
for py in (0.18, 0.42):
    lathe('hs_clamp', tube_ring_pts(0.0195, 0.0022, 6), 32, loc=(0, py, 0), mat=ST, closed=True)
# carry handle (arch) on the barrel
cyl('ch_base', 0.0155, 0.03, (0, 0.21, 0), mat=ST, segs=24, bev=0.0006)
arch = []
for i in range(13):
    t = i / 12
    a = math.pi * t
    yy = 0.15 + 0.12 * t
    zz = 0.018 + math.sin(a) * 0.045 + 0.006
    dy, dz = 0.12, 0.045 * math.pi * math.cos(a)
    ln = math.hypot(dy, dz)
    arch.append(((0, yy, zz), (1, 0, 0), (0, -dz / ln, dy / ln), 0.017, 0.013))
loft('carry_handle', arch, rrect(1.0, 1.0, 0.4, 4), P)
box('ch_post', (0.012, 0.012, 0.018), (0, 0.15, 0.022), ST, bev=0.002)
box('ch_post2', (0.012, 0.012, 0.018), (0, 0.27, 0.022), ST, bev=0.002)
fh = lathe('flashhider', [(0.014, 0.665), (0.0145, 0.67), (0.017, 0.735), (0.0155, 0.738), (0.0105, 0.738), (0.0105, 0.67), (0.0039, 0.665)], 32, mat=S, closed=True)
cut(fh, merge_bm('c_fhs', [bm_box((0.004, 0.05, 0.05), (0, 0.718, 0), (0, R(a), 0)) for a in (0, 60, 120)], cutter=True))
bevel(fh, 0.0005, 1, angle=40)
# front sight tower
prof('fs_tower', [(0.6, 0.012), (0.625, 0.012), (0.622, 0.05), (0.603, 0.05)], 0.014, ST, bev=0.0012)
prof('fs_post', [(0.61, 0.05), (0.615, 0.05), (0.615, SZ), (0.61, SZ)], 0.0025, ST, bev=0.0003)
for sx in (-1, 1):
    prof('fs_ear', [(0.604, 0.05), (0.621, 0.05), (0.619, SZ + 0.004), (0.606, SZ + 0.004)], 0.002, ST, x=sx * 0.008, bev=0.0004)
cyl('fs_collar', 0.0145, 0.03, (0, 0.6125, 0), mat=ST, segs=24, bev=0.0008)

# ---------------- gas tube + gas block, polymer lower handguard with rail
cyl('gastube', 0.0085, 0.33, (0, 0.31, -0.03), mat=S, segs=20)
box('gasblock', (0.03, 0.04, 0.05), (0, 0.48, -0.015), ST, bev=0.003)
cyl('gas_reg', 0.007, 0.036, (0.0, 0.48, -0.03), mat=S, axis='X', segs=16, bev=0.0006)
hgd = front('handguard', rrect(0.05, 0.04, 0.012, 5, 0, -0.03), 0.17, P, y=0.15, bev=0)
cut(hgd, merge_bm('c_hgsl', [bm_box((0.06, 0.03, 0.006), (0, 0.18 + i * 0.045, -0.024)) for i in range(3)], cutter=True))
bevel(hgd, 0.0015, 2)
picatinny('rail_bot', 0.16, 0.31, -0.05 + 0.0094, A, zbase=-0.052)

# ---------------- bipod (group 'bipod', folded back under the handguard; origin at the hinge)
BY, BZ = 0.47, -0.045
box('bp_clamp', (0.034, 0.03, 0.016), (0, BY, BZ), ST, grp='bipod', bev=0.002)
cyl('bp_hinge', 0.005, 0.044, (0, BY - 0.006, BZ - 0.008), mat=S, axis='X', segs=14, grp='bipod')
for sx in (-1, 1):
    cyl('bp_leg', 0.0062, 0.15, (sx * 0.014, BY - 0.08, BZ - 0.01), mat=A, segs=16, grp='bipod', bev=0.0005)
    cyl('bp_inner', 0.0045, 0.06, (sx * 0.014, BY - 0.18, BZ - 0.01), mat=S, segs=14, grp='bipod')
    lathe('bp_foot', [(0.0, BY - 0.215), (0.009, BY - 0.21), (0.0105, BY - 0.205), (0.006, BY - 0.198), (0.0, BY - 0.198)], 16,
          loc=(sx * 0.014, 0, BZ - 0.01), mat=RB, grp='bipod')
    for k in range(5):
        cyl('bp_notch', 0.0065, 0.0015, (sx * 0.014, BY - 0.05 - k * 0.012, BZ - 0.01), mat=S, segs=16, grp='bipod')

# ---------------- pistol grip, trigger guard, trigger, selector
ang = R(18)
ax = Vector((0, -math.sin(ang), -math.cos(ang)))
fwd = Vector((0, math.cos(ang), -math.sin(ang)))
top = Vector((0, -0.07, -0.032))
frames = [(top + ax * t + fwd * fo, (1, 0, 0), fwd, w, d) for (t, w, d, fo) in
          [(0.0, 0.03, 0.05, 0.0), (0.02, 0.032, 0.05, 0.0), (0.04, 0.033, 0.048, -0.002), (0.06, 0.034, 0.05, 0.001), (0.08, 0.034, 0.05, 0.0), (0.105, 0.033, 0.05, 0.0)]]
g = loft('pgrip', frames, rrect(1.0, 1.0, 0.42, 5), G)
subsurf(g, 1)
loft('gcap', [(top + ax * 0.105, (1, 0, 0), fwd, 0.034, 0.052), (top + ax * 0.111, (1, 0, 0), fwd, 0.031, 0.049)], rrect(1.0, 1.0, 0.42, 5), P, bev=0.0008)
prof('trighousing', [(-0.12, -0.032), (0.02, -0.032), (0.02, -0.04), (-0.05, -0.044), (-0.12, -0.04)], 0.04, ST, bev=0.0015)
tg = prof('tguard', [(-0.06, -0.04), (0.02, -0.04), (0.02, -0.05), (0.01, -0.075), (-0.05, -0.078), (-0.064, -0.066)], 0.014, ST, bev=0)
cut(tg, prof('c_tg', [(-0.052, -0.036), (0.012, -0.036), (0.004, -0.07), (-0.048, -0.072)], 0.04, cutter=True))
bevel(tg, 0.0016, 2)
prof('trigger', [(-0.028, -0.041), (-0.018, -0.041), (-0.019, -0.05), (-0.025, -0.06), (-0.033, -0.065), (-0.035, -0.063), (-0.027, -0.054), (-0.026, -0.047)],
     0.008, S, grp='trigger', bev=0.0008)
for sx in (-1, 1):
    cyl('sel', 0.0055, 0.003, (sx * 0.0215, -0.085, -0.037), mat=S, axis='X', segs=18, bev=0.0005)
    prof('selpad', [(-0.09, -0.034), (-0.072, -0.032), (-0.071, -0.036), (-0.088, -0.04)], 0.0025, S, x=sx * 0.0225, bev=0.0005)

# ---------------- stock (fixed polymer) with folding shoulder rest + rear grip
sk = []
for (y, w, zt, zb) in ((-0.14, 0.044, 0.036, -0.03), (-0.16, 0.044, 0.034, -0.036), (-0.22, 0.044, 0.03, -0.06), (-0.3, 0.046, 0.028, -0.09),
                       (-0.37, 0.048, 0.03, -0.11), (-0.4, 0.048, 0.032, -0.118)):
    sk.append(((0, y, (zt + zb) / 2), (1, 0, 0), (0, 0, 1), w, zt - zb))
stock = loft('stock', sk, rrect(1.0, 1.0, 0.3, 5), P)
cut(stock, prof('c_skh', [(-0.2, -0.035), (-0.34, -0.06), (-0.36, -0.095), (-0.24, -0.06)], 0.08, cutter=True))
bevel(stock, 0.002, 2)
pad = prof('buttpad', [(-0.4, 0.032), (-0.414, 0.034), (-0.416, -0.04), (-0.414, -0.12), (-0.4, -0.118)], 0.05, RB, bev=0.003)
cut(pad, merge_bm('c_padg', [bm_box((0.06, 0.02, 0.0012), (0, -0.41, -0.115 + i * 0.006)) for i in range(25)], cutter=True))
# shoulder rest (folded down against the butt), hinge + strap plate
cyl('sr_hinge', 0.004, 0.05, (0, -0.414, 0.03), mat=S, axis='X', segs=12)
prof('shoulder_rest', [(-0.418, 0.03), (-0.424, 0.03), (-0.424, -0.03), (-0.418, -0.026)], 0.04, ST, bev=0.0015)
prof('rear_grip', [(-0.28, -0.085), (-0.31, -0.096), (-0.312, -0.112), (-0.28, -0.1)], 0.026, G, bev=0.002)
cyl('qd', 0.006, 0.006, (-0.025, -0.13, 0.0), mat=S, axis='X', segs=18, bev=0.0005)
torus('sling', 0.01, 0.002, (-0.03, -0.13, -0.01), (0, 0, R(90)), S, segs=18, n=8)

# ---------------- 100-round box magazine (group 'magazine') with belt segment rising into the feed tray
MY, MX = 0.0, -0.03
mb = front('mag_box', rrect(0.064, 0.11, 0.008, 4, MX, -0.105), 0.11, OD, y=MY - 0.055, bev=0)
cut(mb, merge_bm('c_mbr', [bm_box((0.003, 0.09, 0.08), (MX + sx * 0.032, MY, -0.11)) for sx in (-1, 1)], cutter=True))
bevel(mb, 0.0018, 2)
box('mag_lid', (0.068, 0.114, 0.008), (MX, MY, -0.05), OD, grp='magazine', bev=0.002)
box('mag_latch', (0.004, 0.02, 0.016), (MX - 0.034, MY, -0.06), S, grp='magazine', bev=0.001)
box('mag_window', (0.0012, 0.05, 0.014), (MX + 0.0325, MY, -0.08), M['glass'], grp='magazine')
mb['grp'] = 'magazine'
for i in range(6):
    t = i / 5
    by = MY - 0.01 + 0.002
    bx = MX + 0.018 - t * 0.012
    bz = -0.045 + t * 0.06
    lathe('belt_round', [(0.0, 0.0), (0.0048, 0.0), (0.0048, 0.002), (0.0046, 0.036), (0.0036, 0.042), (0.0016, 0.052), (0.0, 0.054)], 12,
          loc=(bx - 0.006, by - 0.025, bz), mat=M['brass'], grp='magazine')
    box('belt_link', (0.012, 0.03, 0.004), (bx - 0.006, by - 0.006, bz), S, grp='magazine', bev=0.0006)

gr = top + ax * 0.045
marks = {
    'muzzle': (0, 0.738, 0),
    'grip_r': tuple(gr),
    'grip_l': (0, 0.24, -0.026),
    'sight': (0, -0.03, SZ),
    'eject': (0, 0.03, -0.035),
    'magwell': (MX, MY, -0.05),
    'cover_hinge': (0, -0.07, 0.046),
    'bipod_hinge': (0, BY - 0.006, BZ - 0.008),
    'carry_handle': (0, 0.21, 0.07),
}
print('built', len(CTX['col'].objects))
if globals().get('FINISH'):
    root, out = finish_gun('benlei', marks, {'magazine': marks['magwell'], 'trigger': (0, -0.023, -0.041), 'cover': marks['cover_hinge'],
                                             'bipod': marks['bipod_hinge']}, size=2048)
    print(export_glb('benlei', root))
