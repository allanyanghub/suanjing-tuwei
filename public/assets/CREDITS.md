> The project's own code and original assets are MIT-licensed (see `LICENSE` in the repository root). The third-party assets listed below keep their own licences.


## Characters

- `characters/soldier.glb` — "Soldier" rigged character with Idle / Walk / Run / TPose clips, taken unmodified from the three.js examples (`examples/models/gltf/Soldier.glb`, three.js r187, https://github.com/mrdoob/three.js). The model and its animations originate from Mixamo (Adobe); the rig uses Mixamo bone names. In-game team/agent colours are applied at runtime by shader recolouring (`src/render/character.ts`); the file itself is unchanged.
- `characters/kit_ling.glb`, `characters/kit_yuan.glb`, `characters/kit_heng.glb` — original per-agent gear kits (helmets, headsets, scarf/gaiters, chest rig, launcher, bandolier, plate carrier, pauldrons, etc.) modelled for this project in Blender 5.3 by script (`art-src/characters/build_kits.py` + `kit_lib.py`, scene in `art-src/characters/kits.blend`); procedurally generated textures. No third-party assets.
- `characters/head_ling.glb`, `characters/head_yuan.glb`, `characters/head_heng.glb`, `characters/portrait_*.png` — agent heads generated with **MPFB 2.0.18** (MakeHuman Plugin for Blender, add-on GPL-3.0; its base mesh and modelling targets are MakeHuman assets released under **CC0 1.0**) by `art-src/characters/build_heads.py` (scene in `heads.blend`). Eyes: MakeHuman official "high-poly" eyes and `brown_eye.png` (**CC0 1.0**, from github.com/makehumancommunity/makehuman, copy in `art-src/characters/mh_eyes/`), iris recoloured. Skin baked from MPFB's procedural skin shader; brows, hair, stubble and lip tint painted procedurally; hair volume is a simple shell. Portraits rendered in-engine.

## Environment

All environment assets are from [Poly Haven](https://polyhaven.com) and are licensed **CC0 1.0** (public domain). Downloaded directly from the Poly Haven API; some were post-processed (resized / re-encoded / decimated) as noted.

HDRIs (`hdri/`) — the 1k `.hdr` is used for image-based lighting (sun extracted into a directional light at load time); `*_sky.jpg` is the upper hemisphere of the 4k `.hdr` re-encoded (Reinhard-compressed, 4096×1152) as the visible sky.
- `qwantani_morning_puresky` — dawn theme (grade 3)
- `kloofendal_48d_partly_cloudy_puresky` — clear day theme (grade 4)
- `evening_road_01_puresky` — golden-hour theme (grade 5)
- `qwantani_moon_noon_puresky` — night theme (grade 6, graded to moonlight)

PBR textures (`textures/<id>/`, 1k JPG: diffuse, OpenGL normal, packed AO/rough/metal):
- `painted_plaster_wall` — plastered walls
- `brick_wall_09` — brick walls and building façades
- `concrete_wall_008` — copings, plinths, sills, quoins, roofs
- `granite_tile_04` — courtyard paving
- `brushed_concrete_03` — site pads, spawn zones, wall-base drainage strips
- `leafy_grass` — lawns around the campus
- `painted_metal_shutter` — roller doors, rooftop condenser units
- `plywood` — plywood shipping crates (high cover)

Models (`props/`, glTF → GLB, merged, decimated with meshoptimizer, textures resized to 512–1024 px):
- `wooden_crate_02` — stacked wooden crates (low cover)
- `industrial_wall_lamp` — wall-mounted bulkhead lamps
- `power_box_01` — wall-mounted electrical boxes (door closed)
- `street_lamp_01` — street lamps around the campus
- `island_tree_02` — only its leaf and bark textures are used (`island_tree_02_leaves_diff_512.jpg`, `island_tree_02_bark_diff_512.jpg`) to build lightweight card trees procedurally

## Weapons

`weapons/*.glb` — first-person and third-person firearms. All share one convention: origin at the right-hand grip, barrel along −Z, +Y up, metres; animated parts are separate nodes (`magazine`, `slide`, `bolt`, `pump`, `trigger`, `hammer`, `shell`) and locator nodes `muzzle`, `grip_l`, `sight`, `eject`, `magwell`.

- `qiming.glb` (启明, pistol) — Poly Haven **"Service Pistol"** by Mateusz Sadek, **CC0 1.0** (https://polyhaven.com/a/service_pistol). 2k textures re-encoded to JPEG q80; re-oriented, variant "b", empty magazine and loose round removed; parts renamed.
- `tianshu.glb` (天枢, sniper) — Poly Haven **"Bolt Action Rifle 7.62"** by Mateusz Sadek, **CC0 1.0** (https://polyhaven.com/a/bolt_action_rifle_7_62). Main textures 2k / scope-and-wrap atlas 1k, re-encoded to JPEG q80; re-oriented, open-bolt variant removed, scope glass replaced by a simple transparent material.
- `yuyan.glb` (雨燕, SMG), `jingzhe.glb` (惊蛰, pump shotgun), `changgeng.glb` (长庚, assault rifle), `arms.glb` (first-person gloves and sleeves) — original models made for this project in Blender (procedural Python modelling, PBR materials baked to 2048² base colour / ORM / normal). Same licence as the project. Sources: `art-src/weapons/`.
- `cunmang.glb` (寸芒, combat knife), `poxiao.glb` (破晓, heavy revolver), `yeying.glb` (夜莺, machine pistol), `beichen.glb` (北辰, marksman rifle with 2.5× prism optic), `benlei.glb` (奔雷, belt-fed light machine gun), `pili.glb` (霹雳, fragmentation grenade), `yanwu.glb` (烟雾弹, smoke canister), `shanguang.glb` (闪光弹, flashbang) — original models made for this project in Blender (procedural Python modelling, PBR materials baked to 2048² — throwables 1024² — base colour / ORM / normal). Same licence as the project. Sources: `art-src/weapons/`.
