# 启明 — Poly Haven "Service Pistol" (CC0), normalised to engine conventions
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())
setup_scene('W_qiming')
bpy.ops.import_scene.gltf(filepath=SCR + '/ph/service_pistol_2k/service_pistol_2k.gltf')
sc = bpy.context.scene
O = bpy.data.objects
for n in ['service_pistol_pistol_b', 'service_pistol_slide_b', 'service_pistol_hammer_b', 'service_pistol_trigger_b',
          'service_pistol_magazine_empty', 'service_pistol_bullet']:
    bpy.data.objects.remove(O[n], do_unlink=True)
O['service_pistol_magazine_loaded'].location = (0, 0, 0)
bpy.context.view_layer.update()
ren = {'service_pistol_pistol_a': 'body', 'service_pistol_slide_a': 'slide', 'service_pistol_magazine_loaded': 'magazine',
       'service_pistol_hammer_a': 'hammer', 'service_pistol_trigger_a': 'trigger'}
objs = []
for k, v in ren.items():
    o = O[k]
    o.name = v
    o.data.name = v
    objs.append(o)
    if o.users_collection and CTX['col'] not in o.users_collection:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        CTX['col'].objects.link(o)


def verts_world(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


body = O['body']
bv = verts_world(body)
sv = verts_world(O['slide'])
xmax = max(v.x for v in bv)
front = [v for v in bv if v.x > xmax - 0.002]
mz = (max(v.z for v in front) + min(v.z for v in front)) / 2
my = (max(v.y for v in front) + min(v.y for v in front)) / 2
allv = bv + sv
rear_top = max(v.z for v in allv if -0.018 < v.x < 0.004)
front_top = max(v.z for v in allv if 0.155 < v.x < 0.172)
print('muzzle', xmax, my, mz, 'rear sight', rear_top, 'front sight', front_top)
mv = verts_world(O['magazine'])
mtop = max(v.z for v in mv)
mcx = sum(v.x for v in mv) / len(mv)
# rotate everything: old +X (barrel) -> +Y
rot = Matrix.Rotation(R(90), 4, 'Z')
for o in objs:
    o.matrix_world = rot @ o.matrix_world
P = lambda x, y, z: tuple(rot @ Vector((x, y, z)))
sight_z = rear_top - 0.0015
marks = {
    'muzzle': P(xmax, my, mz),
    'grip_r': P(-0.021, 0.0, 0.004),
    'grip_l': P(-0.012, 0.022, -0.004),
    'sight': P(-0.03, my, sight_z),
    'eject': P(0.035, -0.012, 0.072),
    'magwell': P(mcx, 0, mtop),
    'front_sight': P(0.165, my, front_top),
}
set_origin(O['magazine'], marks['magwell'])
print(marks)
use_reencoded()
for o in objs:
    for s in o.material_slots:
        if s.material:
            s.material.use_backface_culling = True
g = Vector(marks['grip_r'])
root = bpy.data.objects.new('qiming', None)
CTX['col'].objects.link(root)
for o in objs:
    o.location = o.location - g
    o.parent = root
for k, v in marks.items():
    e = empty(k, Vector(v) - g)
    e.parent = root
print('tris', tri_count(objs))
if globals().get('FINISH'):
    print(export_glb('qiming', root))
