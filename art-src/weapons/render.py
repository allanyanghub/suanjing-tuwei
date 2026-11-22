import bpy, os, math
from mathutils import Vector
SCR = '/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns'
RDIR = globals().get('RDIR', 'renders')
os.makedirs(SCR + '/' + RDIR, exist_ok=True)
VIEWS = {'34': Vector((0.75, -0.55, 0.38)), 'side': Vector((1.0, 0.0, 0.08)), 'fp': Vector((0.35, -0.9, 0.42))}
out = []
for gid in GIDS:
    with bpy.data.libraries.load(f'{SCR}/{gid}.blend') as (src, dst):
        dst.scenes = [f'W_{gid}']
    sc = dst.scenes[0]
    bpy.context.window.scene = sc
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = 32
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1400, 800
    sc.render.film_transparent = False
    meshes = [o for o in sc.objects if o.type == 'MESH']
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    ctr = (mn + mx) / 2
    size = (mx - mn).length
    cd = bpy.data.cameras.new('rcam')
    cd.lens = 50
    cam = bpy.data.objects.new('rcam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    for vn, d in VIEWS.items():
        d = d.normalized()
        cam.location = ctr + d * size * (1.9 if vn != 'fp' else 1.3)
        cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{SCR}/{RDIR}/{gid}_{vn}.png'
        bpy.ops.render.render(write_still=True, scene=sc.name)
        out.append(sc.render.filepath)
    for o in list(sc.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for c in list(sc.collection.children):
        bpy.data.collections.remove(c)
    bpy.data.scenes.remove(sc)
print(out)
