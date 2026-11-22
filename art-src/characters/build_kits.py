# 三名特工的装备套件（在 Blender 内执行）：
#   ns = {}; exec(open('/Users/Mac012/CODE/奥数通关游戏/art-src/characters/build_kits.py').read(), ns); ns['build']('ling')
# 依赖同目录 kit_lib.py。导出 public/assets/characters/kit_<id>.glb。
import math
exec(open('/Users/Mac012/CODE/奥数通关游戏/art-src/characters/kit_lib.py').read())

# 原 soldier 头盔头部包络（three 坐标，未缩放）：中心约 (0, 1.69, 0.03)，半宽 0.094，前 -0.10，后 0.13，顶 1.83。
# 未来替换成真人头时，头中心 ≈ 1.60（未缩放）→ 引擎内 1.66 m，同一尺寸的开面头盔可以通用。
HC = (0.0, 1.695, 0.025)

# 图集调色板：(rgb, roughness, metal, pattern)，顺序见 kit_lib.CELLS
PAL = {
    'ling': [((0.10, 0.11, 0.12), 0.42, 0.0, 'grain'), ((0.20, 0.22, 0.24), 0.85, 0.0, 'weave'),
             ((0.12, 0.13, 0.14), 0.9, 0.0, 'webbing'), ((0.30, 0.31, 0.33), 0.35, 0.9, 'grain'),
             ((0.05, 0.05, 0.05), 0.75, 0.0, 'grain'), ((0.78, 0.80, 0.82), 0.45, 0.0, 'grain'),
             ((0.85, 0.85, 0.85), 0.95, 0.0, 'knit'), ((0.30, 0.25, 0.20), 0.7, 0.0, 'grain'),
             ((0.08, 0.08, 0.09), 0.3, 0.2, 'carbon'), ((0.15, 0.4, 0.5), 0.2, 0.0, 'screen'),
             ((0.22, 0.24, 0.26), 0.85, 0.0, 'camo'), ((0.45, 0.47, 0.50), 0.45, 0.0, 'grain')],
    'yuan': [((0.12, 0.11, 0.14), 0.4, 0.0, 'grain'), ((0.24, 0.22, 0.27), 0.85, 0.0, 'weave'),
             ((0.14, 0.13, 0.16), 0.9, 0.0, 'webbing'), ((0.32, 0.32, 0.35), 0.3, 0.9, 'grain'),
             ((0.05, 0.05, 0.06), 0.75, 0.0, 'grain'), ((0.78, 0.78, 0.82), 0.45, 0.0, 'grain'),
             ((0.85, 0.85, 0.85), 0.95, 0.0, 'knit'), ((0.28, 0.24, 0.26), 0.7, 0.0, 'grain'),
             ((0.08, 0.08, 0.10), 0.3, 0.2, 'carbon'), ((0.25, 0.2, 0.55), 0.15, 0.0, 'screen'),
             ((0.26, 0.24, 0.30), 0.85, 0.0, 'camo'), ((0.50, 0.50, 0.55), 0.45, 0.0, 'grain')],
    'heng': [((0.16, 0.17, 0.13), 0.5, 0.0, 'grain'), ((0.33, 0.31, 0.24), 0.85, 0.0, 'weave'),
             ((0.20, 0.19, 0.15), 0.9, 0.0, 'webbing'), ((0.30, 0.30, 0.30), 0.4, 0.85, 'grain'),
             ((0.06, 0.06, 0.05), 0.8, 0.0, 'grain'), ((0.80, 0.80, 0.78), 0.5, 0.0, 'grain'),
             ((0.85, 0.85, 0.85), 0.95, 0.0, 'knit'), ((0.35, 0.28, 0.20), 0.7, 0.0, 'grain'),
             ((0.09, 0.09, 0.08), 0.3, 0.2, 'carbon'), ((0.2, 0.45, 0.3), 0.2, 0.0, 'screen'),
             ((0.32, 0.31, 0.25), 0.85, 0.0, 'camo'), ((0.52, 0.52, 0.48), 0.5, 0.0, 'grain')],
}
POLY, NYLON, WEB, METAL, RUBBER, CERAMIC, KNIT, SUEDE, CARBON, SCREEN, CAMO, POLYL = range(12)


def torso_n(p):
    """躯干外法线（用于贴身带子）"""
    return (p[0] * 0.6, max(0.0, p[1] - 1.5) * 6.0, p[2] - 0.04)


def radial(cx, cz):
    return lambda p: (p[0] - cx, 0.0, p[2] - cz)


def ring_pts(c, rx, rz, y, n=24, wob=0.0, k=0, phase=0.0, ywob=0.0):
    pts = []
    for i in range(n + 1):
        th = 2 * math.pi * i / n
        r = 1 + wob * math.sin(k * th + phase)
        pts.append((c[0] + math.cos(th) * rx * r, y + ywob * math.sin(k * th + phase * 1.3), c[2] + math.sin(th) * rz * r))
    return pts


def arc_plate(p, x0, x1, cy, cz, r0, r1, a0, a1, thick=0.014, mat='kit_plate', cell=None, nx=4, na=14, droop=0.0):
    """绕 X 轴的弧形甲片（肩甲叶片等）：角度从 +Y 起算，正角朝前（-Z）。"""
    cell = CERAMIC if cell is None else cell
    verts, faces = [], []
    for side, dr in ((0, 0.0), (1, -thick)):
        for i in range(nx + 1):
            t = i / nx
            x = x0 + (x1 - x0) * t
            r = r0 + (r1 - r0) * t + dr
            for j in range(na + 1):
                a = math.radians(a0 + (a1 - a0) * j / na)
                verts.append((x, cy + r * math.cos(a) - droop * t, cz - r * math.sin(a)))
    W = na + 1
    off = (nx + 1) * W
    for i in range(nx):
        for j in range(na):
            a, b, c, d = i * W + j, (i + 1) * W + j, (i + 1) * W + j + 1, i * W + j + 1
            faces.append((a, b, c, d))
            faces.append((off + d, off + c, off + b, off + a))
    for i in range(nx):  # 两侧边
        faces.append((i * W, off + i * W, off + (i + 1) * W, (i + 1) * W))
        faces.append(((i + 1) * W + na, off + (i + 1) * W + na, off + i * W + na, i * W + na))
    for j in range(na):  # 两端边
        faces.append((j, j + 1, off + j + 1, off + j))
        faces.append((nx * W + j + 1, nx * W + j, off + nx * W + j, off + nx * W + j + 1))
    p.mesh(verts, faces, mat=mat, cell=cell)


def open_helmet(p, rad, brow=1.735, side_cut=1.66, back_cut=1.6, front_z=-0.035, cell=POLY, mat='kit_main'):
    """开面头盔壳：前脸开口（brow 以下、z<front_z），两侧在 side_cut 以下开出耳位。"""
    def keep(x, y, z):
        if y < back_cut:
            return False
        if z < front_z and y < brow:
            return False
        if abs(x) > 0.05 and y < side_cut and z < 0.075:
            return False
        return True
    p.shell(HC, rad, keep, thick=0.011, mat=mat, cell=cell, seg=48, rings=28)


def collar(p, y, rx, rz, tube, folds=7, mat='kit_main', cell=KNIT, cz=0.045):
    """领口/围脖：一圈有褶皱的管。"""
    n = 40
    pts = ring_pts((0, 0, cz), rx, rz, y, n=n, wob=0.05, k=folds, ywob=0.008)
    p.tube_path(pts, tube, mat=mat, cell=cell, seg=10, flat=0.75, cap=False, nrm=radial(0, cz))


# ============================================================================ 零：轻装突击
def kit_ling():
    H = 'mixamorigHead'
    h = Piece(H, 'helmet')
    # 高切口轻型防撞盔
    open_helmet(h, (0.124, 0.142, 0.142), brow=1.758, side_cut=1.69, back_cut=1.63)
    for sx in (-1, 1):
        # 侧导轨 + 队伍色条
        h.box((0.012, 0.022, 0.11), M((sx * 0.126, 1.708, 0.03), (0, 0, sx * 0.12)), cell=METAL)
        h.box((0.004, 0.008, 0.10), M((sx * 0.133, 1.708, 0.03), (0, 0, sx * 0.12)), mat='kit_team')
    # 后部配重块 + 短天线
    h.box((0.07, 0.04, 0.025), M((0, 1.69, 0.165), (-0.25, 0, 0)), cell=POLY)
    h.cyl(0.012, 0.012, 0.03, look_m((-0.085, 1.76, 0.1), (0, 1, 0)), cell=RUBBER, seg=10)
    h.cyl(0.0035, 0.002, 0.16, look_m((-0.09, 1.84, 0.125), (-0.15, 1, 0.45)), cell=RUBBER, seg=6)
    # 护目镜（推到额头上）
    h.tube_path(ring_pts((0, 0, 0.03), 0.128, 0.138, 1.755, n=28)[14:29], 0.009, cell=WEB, seg=6, flat=0.6, cap=True)
    h.box((0.17, 0.035, 0.03), M((0, 1.775, -0.112), (0.5, 0, 0)), mat='kit_glass', cell=POLY)
    h.finish()
    # 耳机（头戴式通讯）
    e = Piece(H, 'headset')
    for sx in (-1, 1):
        e.cyl(0.042, 0.04, 0.03, look_m((sx * 0.128, 1.64, 0.035), (sx, 0, 0)), cell=RUBBER, seg=18)
        e.cyl(0.03, 0.026, 0.012, look_m((sx * 0.146, 1.64, 0.035), (sx, 0, 0)), mat='kit_team', seg=14)
    e.finish()

    # 围巾（挂在 Spine2，随躯干）
    s = Piece('mixamorigSpine2', 'scarf')
    s.bevel = 0
    collar(s, 1.53, 0.125, 0.118, 0.048, folds=7, mat='kit_agent', cell=KNIT, cz=0.05)
    collar(s, 1.565, 0.106, 0.1, 0.036, folds=5, mat='kit_agent', cell=KNIT, cz=0.05)
    s.finish()
    for i, sx in enumerate((-1, 1)):
        t = Piece('mixamorigSpine2', f'tail_{"lr"[i]}')
        t.bevel = 0
        x = sx * 0.035
        pts = [(x, 1.53, 0.165), (x * 1.2, 1.47, 0.24), (x * 1.5, 1.38, 0.258), (x * 1.8, 1.27, 0.258), (x * 2.0, 1.16 + i * 0.05, 0.252), (x * 2.1, 1.07 + i * 0.07, 0.248)]
        t.tube_path(pts, 0.04 - i * 0.006, mat='kit_agent', cell=KNIT, seg=8, flat=0.2, nrm=lambda p: (0, 0.2, 1))
        t.finish()

    # 极简胸挂
    c = Piece('mixamorigSpine2', 'chestrig')
    c.box((0.25, 0.12, 0.022), M((0, 1.315, -0.158), (0.08, 0, 0)), cell=NYLON)
    for k in (-1, 0, 1):
        c.box((0.068, 0.10, 0.032), M((k * 0.078, 1.305, -0.183), (0.08, 0, 0)), cell=NYLON)
        c.box((0.07, 0.022, 0.036), M((k * 0.078, 1.36, -0.185), (0.08, 0, 0)), cell=WEB)
    for sx in (-1, 1):
        c.tube_path([(sx * 0.11, 1.37, -0.158), (sx * 0.12, 1.47, -0.14), (sx * 0.12, 1.55, -0.1), (sx * 0.12, 1.592, -0.02), (sx * 0.12, 1.59, 0.1), (sx * 0.115, 1.5, 0.215), (sx * 0.11, 1.42, 0.228)], 0.02, cell=WEB, seg=6, flat=0.22, nrm=torso_n)
    c.finish()

    # 右腿枪套
    g = Piece('mixamorigRightUpLeg', 'holster')
    g.box((0.045, 0.19, 0.11), M((0.212, 0.79, -0.01), (0, 0, 0.05)), cell=POLY)
    g.box((0.05, 0.05, 0.08), M((0.215, 0.9, -0.02), (0, 0, 0.05)), cell=NYLON)
    for y in (0.86, 0.72):
        g.tube_path(ring_pts((0.137, 0, -0.012), 0.075, 0.12, y, n=20), 0.016, cell=WEB, seg=6, flat=0.25, cap=False, nrm=radial(0.137, -0.012))
    g.finish()

    # 轻型护膝
    for side, sx in (('Left', -1), ('Right', 1)):
        k = Piece(f'mixamorig{side}Leg', 'kneepad')
        k.shell((sx * 0.099, 0.565, -0.025), (0.072, 0.075, 0.11), lambda x, y, z: z < -0.075, thick=0.012, cell=POLY, seg=24, rings=16)
        k.tube_path(ring_pts((sx * 0.099, 0, -0.025), 0.07, 0.1, 0.52, n=18), 0.012, cell=WEB, seg=6, flat=0.3, cap=False, nrm=radial(sx * 0.099, -0.025))
        k.finish()
        # 半指手套护腕
        w = Piece(f'mixamorig{side}ForeArm', 'cuff')
        w.cyl(0.064, 0.06, 0.05, look_m((sx * 0.652, 1.479, 0.075), (sx, 0, 0)), cell=NYLON, seg=18)
        w.cyl(0.066, 0.066, 0.012, look_m((sx * 0.632, 1.479, 0.075), (sx, 0, 0)), mat='kit_team', seg=18)
        w.finish()


# ============================================================================ 圆：控场（科技装备）
def kit_yuan():
    H = 'mixamorigHead'
    h = Piece(H, 'helmet')
    open_helmet(h, (0.126, 0.146, 0.146), brow=1.758, side_cut=1.55, back_cut=1.6)
    # 盔沿导轨 + 队伍色条
    for sx in (-1, 1):
        h.box((0.012, 0.024, 0.12), M((sx * 0.128, 1.70, 0.03), (0, 0, sx * 0.1)), cell=METAL)
        h.box((0.004, 0.008, 0.11), M((sx * 0.135, 1.70, 0.03), (0, 0, sx * 0.1)), mat='kit_team')
    # 左侧通讯舱
    h.box((0.04, 0.07, 0.10), M((-0.15, 1.67, 0.035)), cell=POLY)
    h.box((0.006, 0.05, 0.07), M((-0.172, 1.67, 0.035)), mat='kit_agent', cell=SCREEN)
    h.cyl(0.004, 0.003, 0.09, look_m((-0.155, 1.745, 0.07), (0, 1, 0.3)), cell=RUBBER, seg=6)
    h.finish()
    # 翻起的多目光学阵列（额前）
    o = Piece(H, 'optics')
    o.box((0.05, 0.03, 0.04), M((0, 1.775, -0.118), (0.4, 0, 0)), cell=METAL)
    o.box((0.16, 0.022, 0.05), M((0, 1.80, -0.125), (0.9, 0, 0)), cell=POLY)
    for i, x in enumerate((-0.054, -0.018, 0.018, 0.054)):
        d = (0, 0.8, -0.6)
        base = Vector((x, 1.815, -0.112))
        o.cyl(0.016, 0.017, 0.06, look_m(base + Vector(d) * 0.03, d), cell=POLY, seg=14)
        o.cyl(0.013, 0.013, 0.004, look_m(base + Vector(d) * 0.061, d), mat='kit_glass', seg=14)
    o.finish()
    # 耳罩 + 麦克风吊杆
    e = Piece(H, 'headset')
    for sx in (-1, 1):
        e.cyl(0.044, 0.042, 0.032, look_m((sx * 0.13, 1.635, 0.035), (sx, 0, 0)), cell=RUBBER, seg=18)
    e.tube_path([(0.142, 1.628, 0.005), (0.135, 1.605, -0.06), (0.10, 1.59, -0.115), (0.045, 1.585, -0.138)], 0.0045, cell=RUBBER, seg=6)
    e.cyl(0.011, 0.011, 0.025, look_m((0.035, 1.585, -0.14), (-1, 0, -0.2)), mat='kit_team', seg=10)
    e.finish()
    # 围脖
    n = Piece('mixamorigSpine2', 'gaiter')
    n.bevel = 0
    collar(n, 1.538, 0.118, 0.112, 0.042, folds=9, mat='kit_agent', cell=KNIT, cz=0.05)
    collar(n, 1.568, 0.102, 0.098, 0.03, folds=6, mat='kit_agent', cell=KNIT, cz=0.05)
    n.finish()
    # 背负发射筒 + 折叠天线
    b = Piece('mixamorigSpine2', 'launcher')
    b.box((0.22, 0.26, 0.06), M((0, 1.33, 0.255)), cell=NYLON)
    d = Vector((0.45, 1, 0.0)).normalized()
    c0 = Vector((-0.01, 1.36, 0.322))
    b.cyl(0.045, 0.045, 0.62, look_m(c0, d), cell=POLY, seg=20)
    for k in (-1, 1):
        b.cyl(0.052, 0.05, 0.05, look_m(c0 + d * k * 0.3, d), cell=METAL, seg=20)
    b.cyl(0.048, 0.048, 0.05, look_m(c0 + d * 0.06, d), mat='kit_team', seg=20)
    for k in (-0.12, 0.12):
        b.tube_path([c0 + d * k + Vector((0, 0, -0.05)), c0 + d * k + Vector((0, 0, -0.01))], 0.012, cell=WEB, seg=6)
    for i, x in enumerate((0.125, 0.14, 0.155)):
        b.cyl(0.006, 0.006, 0.36 - i * 0.04, look_m((x, 1.38 + i * 0.02, 0.272), (0, 1, 0)), cell=METAL, seg=8)
    b.cyl(0.012, 0.01, 0.03, look_m((0.14, 1.585, 0.272), (0, 1, 0)), mat='kit_agent', cell=SCREEN, seg=10)
    b.finish()
    # 胸前斜挎弹药带（罐）
    w = Piece('mixamorigSpine1', 'bandolier')
    front = [(0.13, 1.595, -0.04), (0.11, 1.52, -0.14), (0.04, 1.42, -0.165), (-0.05, 1.31, -0.158), (-0.13, 1.2, -0.17), (-0.2, 1.1, -0.17), (-0.235, 1.07, -0.06)]
    back = [(-0.235, 1.08, 0.08), (-0.14, 1.2, 0.2), (-0.02, 1.33, 0.235), (0.09, 1.47, 0.225), (0.13, 1.58, 0.12), (0.13, 1.6, 0.02), (0.13, 1.595, -0.04)]
    w.tube_path(front + back, 0.026, cell=WEB, seg=6, flat=0.2, nrm=torso_n, cap=False)
    for i in range(5):
        t = 0.18 + i * 0.13
        a = Vector(front[1]).lerp(Vector(front[4]), t)
        dd = (Vector(front[4]) - Vector(front[1])).normalized()
        a = a + Vector((0, 0, -0.03))
        w.cyl(0.019, 0.019, 0.062, look_m(a, dd), cell=METAL, seg=12)
        w.cyl(0.02, 0.02, 0.012, look_m(a + dd * 0.035, dd), mat='kit_agent', cell=POLYL, seg=12)
    w.finish()
    # 左前臂战术平板
    for side, sx in (('Left', -1), ('Right', 1)):
        f = Piece(f'mixamorig{side}ForeArm', 'cuff' if sx > 0 else 'tablet')
        if sx < 0:
            f.box((0.14, 0.018, 0.085), M((-0.565, 1.548, 0.075)), cell=POLY)
            f.box((0.11, 0.004, 0.06), M((-0.565, 1.558, 0.075)), mat='kit_agent', cell=SCREEN)
            for x in (-0.515, -0.615):
                pts = [(x, 1.479 + math.cos(2 * math.pi * i / 16) * 0.068, 0.075 + math.sin(2 * math.pi * i / 16) * 0.068) for i in range(17)]
                f.tube_path(pts, 0.01, cell=WEB, seg=6, flat=0.3, cap=False, nrm=lambda p: (0, p[1] - 1.479, p[2] - 0.075))
        else:
            f.cyl(0.064, 0.06, 0.04, look_m((0.652, 1.479, 0.075), (1, 0, 0)), cell=NYLON, seg=18)
            f.cyl(0.066, 0.066, 0.01, look_m((0.635, 1.479, 0.075), (1, 0, 0)), mat='kit_team', seg=18)
        f.finish()
    # 腰间工具包
    u = Piece('mixamorigHips', 'pouches')
    for (x, z, ry) in ((-0.235, 0.0, 1.57), (0.235, 0.03, -1.57), (-0.13, 0.2, 0.5), (0.13, 0.2, -0.5), (0.2, -0.13, -2.3)):
        u.box((0.075, 0.09, 0.05), M((x, 1.1, z), (0, ry, 0)), cell=NYLON)
        u.box((0.078, 0.025, 0.055), M((x, 1.15, z), (0, ry, 0)), cell=WEB)
    u.finish()


# ============================================================================ 衡：守护（重装）
def kit_heng():
    H = 'mixamorigHead'
    h = Piece(H, 'helmet')
    open_helmet(h, (0.132, 0.15, 0.152), brow=1.752, side_cut=1.5, back_cut=1.585, front_z=-0.045)
    for sx in (-1, 1):
        # 护颊
        h.box((0.018, 0.10, 0.085), M((sx * 0.122, 1.615, -0.04), (0, -sx * 0.35, sx * 0.12)), mat='kit_plate', cell=CERAMIC)
        h.box((0.006, 0.08, 0.012), M((sx * 0.134, 1.615, -0.075), (0, -sx * 0.35, sx * 0.12)), mat='kit_team')
        # 面罩铰链
        h.cyl(0.018, 0.018, 0.016, look_m((sx * 0.14, 1.735, -0.01), (sx, 0, 0)), cell=METAL, seg=14)
    # 盔顶脊线
    arc_plate(h, -0.016, 0.016, HC[1], HC[2], 0.158, 0.158, -60, 75, thick=0.012, nx=1, na=16)
    h.finish()
    v = Piece(H, 'visor')
    v.bevel = 0
    v.shell((0, 1.695, 0.025), (0.146, 0.165, 0.167), lambda x, y, z: 1.74 < y < 1.845 and z < -0.01 and abs(x) < 0.15, thick=0.007, mat='kit_glass', cell=POLY, seg=40, rings=28)
    # 面罩框
    v.shell((0, 1.695, 0.025), (0.15, 0.169, 0.171), lambda x, y, z: (1.735 < y < 1.752 or 1.832 < y < 1.85) and z < -0.01 and abs(x) < 0.15, thick=0.01, mat='kit_main', cell=METAL, seg=40, rings=28)
    v.finish()
    # 护颈 + 围脖
    g = Piece('mixamorigSpine2', 'gorget')
    collar(g, 1.535, 0.118, 0.112, 0.036, folds=6, mat='kit_agent', cell=KNIT, cz=0.05)
    g.shell((0, 1.50, 0.05), (0.17, 0.11, 0.165), lambda x, y, z: 1.52 < y < 1.585 and z < 0.06, thick=0.014, mat='kit_plate', cell=CERAMIC, seg=40, rings=24)
    g.finish()
    # 防弹板背心（前后板 + 侧护）
    c = Piece('mixamorigSpine2', 'carrier')
    c.shell((0, 1.34, 0.035), (0.235, 0.24, 0.205), lambda x, y, z: z < -0.08 and 1.17 < y < 1.5 and abs(x) < 0.17, thick=0.03, mat='kit_plate', cell=CERAMIC, seg=36, rings=22)
    c.shell((0, 1.34, 0.035), (0.235, 0.24, 0.205), lambda x, y, z: z > 0.14 and 1.17 < y < 1.52 and abs(x) < 0.17, thick=0.03, mat='kit_plate', cell=CERAMIC, seg=36, rings=22)
    c.box((0.30, 0.03, 0.012), M((0, 1.43, -0.205), (0.25, 0, 0)), mat='kit_team')
    for sx in (-1, 1):
        c.tube_path([(sx * 0.15, 1.2, -0.17), (sx * 0.205, 1.22, -0.1), (sx * 0.222, 1.24, 0.03), (sx * 0.2, 1.25, 0.16), (sx * 0.15, 1.26, 0.215)], 0.03, cell=WEB, seg=6, flat=0.25, nrm=lambda p: (p[0], 0, p[2] - 0.03))
        c.tube_path([(sx * 0.13, 1.47, -0.17), (sx * 0.135, 1.56, -0.11), (sx * 0.135, 1.6, -0.01), (sx * 0.135, 1.59, 0.1), (sx * 0.13, 1.5, 0.2)], 0.035, cell=WEB, seg=6, flat=0.25, nrm=torso_n)
    # 前板上的弹匣包
    for k in (-1, 0, 1):
        c.box((0.07, 0.1, 0.04), M((k * 0.08, 1.24, -0.215), (0.1, 0, 0)), cell=NYLON)
    c.finish()
    # 医疗包（背部，等号标识）
    m = Piece('mixamorigSpine2', 'medpack')
    m.box((0.25, 0.26, 0.09), M((0, 1.33, 0.305)), cell=NYLON)
    m.box((0.25, 0.04, 0.095), M((0, 1.44, 0.307)), cell=WEB)
    m.box((0.11, 0.022, 0.006), M((0, 1.355, 0.352)), mat='kit_agent', cell=POLYL)
    m.box((0.11, 0.022, 0.006), M((0, 1.305, 0.352)), mat='kit_agent', cell=POLYL)
    m.finish()
    # 叠层肩甲
    for side, sx in (('Left', -1), ('Right', 1)):
        p = Piece(f'mixamorig{side}Arm', 'pauldron')
        # 三片叠层弧形肩甲（外侧在上、逐片收小），边缘一道队伍色
        for i, (xa, xb, ra, rb) in enumerate(((0.19, 0.30, 0.134, 0.136), (0.28, 0.36, 0.126, 0.124), (0.345, 0.41, 0.114, 0.11))):
            arc_plate(p, sx * xa, sx * xb, 1.481 - i * 0.004, 0.057, ra, rb, -70, 75, thick=0.016, droop=0.012)
        arc_plate(p, sx * 0.30, sx * 0.307, 1.481, 0.057, 0.139, 0.139, -60, 65, thick=0.006, mat='kit_team', nx=1)
        p.finish()
        # 护胯甲片
        t = Piece(f'mixamorig{side}UpLeg', 'tasset')
        t.shell((sx * 0.13, 0.95, 0.0), (0.105, 0.17, 0.125), lambda x, y, z: 0.79 < y < 1.03 and (x * sx > 0.17 or z < -0.08), thick=0.016, mat='kit_plate', cell=CERAMIC, seg=24, rings=14)
        t.finish()
        # 护膝 + 护胫
        k = Piece(f'mixamorig{side}Leg', 'greave')
        k.shell((sx * 0.099, 0.565, -0.025), (0.08, 0.085, 0.115), lambda x, y, z: z < -0.07, thick=0.016, mat='kit_plate', cell=CERAMIC, seg=22, rings=14)
        k.shell((sx * 0.1, 0.33, 0.02), (0.08, 0.2, 0.105), lambda x, y, z: z < -0.035 and 0.2 < y < 0.49, thick=0.014, mat='kit_plate', cell=CERAMIC, seg=22, rings=16)
        for y in (0.42, 0.25):
            k.tube_path(ring_pts((sx * 0.1, 0, 0.02), 0.075, 0.1, y, n=18), 0.012, cell=WEB, seg=6, flat=0.3, cap=False, nrm=radial(sx * 0.1, 0.02))
        k.finish()
        w = Piece(f'mixamorig{side}ForeArm', 'bracer')
        w.cyl(0.07, 0.066, 0.12, look_m((sx * 0.6, 1.479, 0.075), (sx, 0, 0)), mat='kit_plate', cell=CERAMIC, seg=18)
        w.finish()


def build(kit, export=True):
    setup(kit)
    make_materials(kit, build_atlas(kit, PAL[kit]))
    {'ling': kit_ling, 'yuan': globals().get('kit_yuan'), 'heng': globals().get('kit_heng')}[kit]()
    if export:
        return export_kit(kit)
