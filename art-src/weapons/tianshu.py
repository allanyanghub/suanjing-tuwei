# 天枢 — Poly Haven "Bolt Action Rifle 7.62" (CC0), normalised to engine conventions
exec(open('/private/tmp/claude-502/-Users-Mac012-CODE-------/c28bb583-8185-47f1-80c4-1e93718733dd/scratchpad/art-guns/blib.py').read())
setup_scene('W_tianshu')
bpy.ops.import_scene.gltf(filepath=SCR + '/ph/bolt_action_rifle_7_62_1k/bolt_action_rifle_7_62_1k.gltf')
bpy.context.view_layer.update()
O = bpy.data.objects
bpy.data.objects.remove(O['bolt_action_rifle_7_62_bolt_b'], do_unlink=True)
ren = {'bolt_action_rifle_7_62': 'body', 'bolt_action_rifle_7_62_scope': 'scope', 'bolt_action_rifle_7_62_wrap': 'wrap',
       'bolt_action_rifle_7_62_bolt_a': 'bolt', 'bolt_action_rifle_7_62_bullet_54mm': 'rounds',
       'bolt_action_rifle_7_62_trigger': 'trigger'}
objs = []
for k, v in ren.items():
    o = O[k]
    o.name = v
    o.data.name = v
    objs.append(o)
    for c in list(o.users_collection):
        c.objects.unlink(o)
    CTX['col'].objects.link(o)
bpy.context.view_layer.update()


def vw(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


bv = vw(O['body'])
xmax = max(v.x for v in bv)
fr = [v for v in bv if v.x > xmax - 0.003]
mz = (max(v.z for v in fr) + min(v.z for v in fr)) / 2
my = (max(v.y for v in fr) + min(v.y for v in fr)) / 2
scv = vw(O['scope'])
sxmin = min(v.x for v in scv)
rear = [v for v in scv if v.x < sxmin + 0.004]
sz = (max(v.z for v in rear) + min(v.z for v in rear)) / 2
sy = (max(v.y for v in rear) + min(v.y for v in rear)) / 2
print('muzzle', xmax, my, mz, 'scope rear', sxmin, sy, sz)
# bolt pivot on bore axis
blv = vw(O['bolt'])
bx = sum(v.x for v in blv) / len(blv)
rot = Matrix.Rotation(R(90), 4, 'Z')
for o in objs:
    o.matrix_world = rot @ o.matrix_world
P = lambda x, y, z: tuple(rot @ Vector((x, y, z)))
marks = {
    'muzzle': P(xmax, my, mz),
    'grip_r': P(-0.345, 0.0, -0.032),
    'grip_l': P(-0.03, 0.0, -0.02),
    'sight': P(sxmin + 0.01, sy, sz),
    'eject': P(-0.2, -0.02, mz + 0.01),
    'magwell': P(-0.2, 0.0, -0.05),
}
bpy.context.view_layer.update()
set_origin(O['bolt'], P(bx, my, mz))
# join scope + wrap + rounds into body (static)
body = join([O['body'], O['scope'], O['wrap'], O['rounds']], 'body')
objs = [body, O['bolt'], O['trigger']]
for o in objs:
    for s in o.material_slots:
        if s.material and s.material.blend_method != 'BLEND':
            s.material.use_backface_culling = True
print(marks)
gm = glass_mat('m_scope_glass', (0.02, 0.04, 0.06), 0.35)
for o in objs:
    for s in o.material_slots:
        if s.material and s.material.blend_method == 'BLEND' or (s.material and 'glass' in s.material.name):
            s.material = gm
use_reencoded()
# main rifle textures at 2k (seen large in first person); scope/wrap atlas stays 1k
for base in ('diff', 'arm', 'nor_gl'):
    im = bpy.data.images.get(f'bolt_action_rifle_7_62_{base}_1k')
    if im:
        n = bpy.data.images.load(os.path.join(SCR, 'ph_re', f'bolt_action_rifle_7_62_{base}_2k.jpg'))
        n.colorspace_settings.name = im.colorspace_settings.name
        im.user_remap(n)
        bpy.data.images.remove(im)
        n.name = f'bolt_action_rifle_7_62_{base}_2k'
g = Vector(marks['grip_r'])
root = bpy.data.objects.new('tianshu', None)
CTX['col'].objects.link(root)
for o in objs:
    o.location = o.location - g
    o.parent = root
for k, v in marks.items():
    e = empty(k, Vector(v) - g)
    e.parent = root
print('tris', tri_count(objs))
if globals().get('FINISH'):
    print(export_glb('tianshu', root))
