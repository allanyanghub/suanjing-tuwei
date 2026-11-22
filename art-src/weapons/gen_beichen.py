s = open('changgeng.py').read()


def cutsec(s, start, end, new):
    a = s.index(start)
    b = s.index(end, a)
    return s[:a] + new + s[b:]


s = s.replace("# 长庚 — original 5.56 assault rifle.", "# 北辰 — original 7.62 designated-marksman rifle (semi/burst), 2.5x prism optic.")
s = s.replace("setup_scene('W_changgeng')", "setup_scene('W_beichen')")
s = s.replace("F, FG = M['fde'], M['fde_grip']", "F, FG = M['cera'], M['grip']\nX = extra_mats()")
s = cutsec(s, "# ---------------- buffer tube + stock", "# ---------------- handguard", '''# ---------------- fixed skeleton stock with adjustable cheek riser
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

''')
s = s.replace("hg = front('handguard', hg_pts, 0.325, A, y=0.108, bev=0)", "hg = front('handguard', hg_pts, 0.415, F, y=0.108, bev=0)")
s = s.replace("for i in range(5):\n    y = 0.135 + i * 0.058", "for i in range(6):\n    y = 0.135 + i * 0.062")
s = s.replace("for i in range(3):\n    for sx in (-1, 1):\n        a = R(45 * sx)", "for i in range(4):\n    for sx in (-1, 1):\n        a = R(45 * sx)")
s = s.replace("picatinny('rail_hg', 0.112, 0.432, RT, A, zbase=0.019)", "picatinny('rail_hg', 0.112, 0.522, RT, A, zbase=0.019)")
s = cutsec(s, "# handstop (angled) under handguard", "# ---------------- barrel + muzzle brake", '''# front QD + barricade stop under handguard
cyl('qd2', 0.006, 0.006, (-0.0245, 0.505, -0.004), mat=S, axis='X', segs=18, bev=0.0005)
prof('handstop', [(0.4, -0.028), (0.43, -0.028), (0.428, -0.036), (0.404, -0.036)], 0.02, FG, bev=0.002)

''')
s = s.replace("cyl('barrel', 0.0088, 0.4, (0, 0.3, 0), mat=S, segs=24, bore=0.003)", "cyl('barrel', 0.0098, 0.5, (0, 0.35, 0), mat=S, segs=28, bore=0.0035)")
s = s.replace("lathe('crush', [(0.0105, 0.493), (0.0112, 0.497), (0.0112, 0.502), (0.0105, 0.504), (0.0088, 0.504), (0.0088, 0.493)]",
              "lathe('crush', [(0.0115, 0.593), (0.0122, 0.597), (0.0122, 0.602), (0.0115, 0.604), (0.0098, 0.604), (0.0098, 0.593)]")
s = s.replace("mb = lathe('brake', [(0.0108, 0.504), (0.0112, 0.508), (0.0112, 0.562), (0.0102, 0.565), (0.0045, 0.565), (0.0045, 0.504)]",
              "mb = lathe('brake', [(0.0118, 0.604), (0.0124, 0.608), (0.0124, 0.672), (0.0112, 0.675), (0.005, 0.675), (0.005, 0.604)]")
s = s.replace("    ports.append(bm_box((0.04, 0.006, 0.0085), (0, 0.519 + i * 0.013, 0.0)))", "    ports.append(bm_box((0.04, 0.007, 0.009), (0, 0.621 + i * 0.016, 0.0)))")
s = s.replace("    ports.append(bm_box((0.0045, 0.004, 0.02), (-0.004 + i * 0.008, 0.545, 0.012)))", "    ports.append(bm_box((0.0045, 0.004, 0.02), (-0.004 + i * 0.008, 0.66, 0.013)))")
s = cutsec(s, "# ---------------- holographic sight", "# ---------------- bolt carrier visible in port", open('beichen_optic.txt').read())
s = cutsec(s, "mf = []\nN = 9", "magb = loft(", '''mf = []
N = 4
for i in range(N + 1):
    t = i / N
    o = Vector((0, 0.04 + 0.008 * t, -0.02 - t * 0.13))
    mf.append((o, (1, 0, 0), (0, 1, 0.06), 0.0235, 0.066 if i else 0.064))
''')
s = s.replace("magb = loft('mag_body', mf, rrect(1.0, 1.0, 0.18, 4), F, grp='magazine')", "magb = loft('mag_body', mf, rrect(1.0, 1.0, 0.18, 4), M['poly'], grp='magazine')")
s = s.replace("for k in range(5, N):", "for k in range(2, N):")
s = s.replace("merge_bm('mag_ribs', rib, F, grp='magazine')", "merge_bm('mag_ribs', rib, M['poly'], grp='magazine')")
s = s.replace("rrect(1.0, 1.0, 0.3, 4), F, grp='magazine', bev=0.0012)", "rrect(1.0, 1.0, 0.3, 4), M['poly'], grp='magazine', bev=0.0012)")
s = s.replace("'muzzle': (0, 0.565, 0),", "'muzzle': (0, 0.675, 0),")
s = s.replace("'grip_l': (0, 0.25, -0.004),", "'grip_l': (0, 0.3, -0.004),")
s = s.replace("'sight': (0, yb + 0.05, RT + 0.0255),", "'sight': (0, yb - 0.08, OZ),\n    'scope_front': (0, yb + 0.103, OZ),")
s = s.replace("finish_gun('changgeng',", "finish_gun('beichen',").replace("export_glb('changgeng', root)", "export_glb('beichen', root)")
open('beichen.py', 'w').write(s)
print('ok')
