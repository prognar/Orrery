"""ORRERY · GALAXY — Blender build script for the Network view.

The home network drawn as a barred spiral galaxy held in a brass astrolabe:
  * the main router is the galactic core; each AiMesh node is a satellite galaxy with its own beacon
  * every client is a star; its distance from its node is its signal strength, read off the rete's dBm rings
  * 5 GHz / 2.4 GHz clients ride different spiral arms; wired clients sit in the bulge

Run with Blender's Python module:   GALAXY_OUT=out_galaxy/ python build_galaxy.py
Outputs:
  galaxy.glb       nodes: Rete (brass astrolabe engraved in dBm), Beacon (router, child BeaconLamp), Alidade
  galaxy_disk.png  RGBA top-down spiral disk (gas, dust lanes, HII knots), baked from Blender noise fields
  galaxy_sky.jpg   2:1 equirect nebula backdrop, baked from Blender noise on a sphere (seamless)

Layout contract with static/galaxy3d.js:
  dBm → radius:  r = 1.6 + (-dBm - 30) * 0.16   (-40 → 3.2 … -80 → 9.6, limb at 11.6)
  Blender Z-up; glTF exporter converts to Y-up. Disk plane is z=0.
"""
import bpy, bmesh, math, os, time
import numpy as np
from mathutils import Vector, Matrix

OUT = os.path.abspath(os.environ.get("GALAXY_OUT", "out_galaxy"))
DISK = int(os.environ.get("GALAXY_DISK", "1024"))
SKY_W = int(os.environ.get("GALAXY_SKY", "2048"))
os.makedirs(OUT, exist_ok=True)
T0 = time.time()
def log(*a): print(f"[galaxy {time.time()-T0:6.1f}s]", *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 4
coll = scene.collection
TAU = math.tau
R_OF = lambda dbm: 1.6 + (-dbm - 30) * 0.16
LIMB = 11.6

# ---------------------------------------------------------------- materials
def material(name, color, metal, rough, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    if emit:
        k = "Emission Color" if "Emission Color" in p.inputs else "Emission"
        p.inputs[k].default_value = (*emit, 1)
        if "Emission Strength" in p.inputs: p.inputs["Emission Strength"].default_value = strength
    return m

M = {
    "brass":  material("Brass",       (0.80, 0.55, 0.25), 1.0, 0.30),
    "polish": material("BrassPolish", (0.92, 0.68, 0.33), 1.0, 0.18),
    "bronze": material("Bronze",      (0.36, 0.24, 0.12), 1.0, 0.46),
    "ebony":  material("Ebony",       (0.035, 0.026, 0.022), 0.0, 0.34),
    "lamp":   material("Lamp",        (1.0, 0.8, 0.45), 0.0, 0.4, emit=(1.0, 0.75, 0.4), strength=4.0),
}

def obj_from_bm(name, bm, mat_names):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for mn in mat_names: me.materials.append(M[mn])
    o = bpy.data.objects.new(name, me); coll.objects.link(o)
    return o

def select_only(objs, active=None):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]

def join(name, objs):
    select_only(objs); bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = name; o.data.name = name
    return o

def set_mat(o, mn):
    o.data.materials.clear(); o.data.materials.append(M[mn]); return o

def band(name, r_in, r_out, z0, z1, mn, seg=256):
    bm = bmesh.new()
    def ring(r, z): return [bm.verts.new((r * math.cos(TAU * i / seg), r * math.sin(TAU * i / seg), z)) for i in range(seg)]
    ot, it, ob, ib = ring(r_out, z1), ring(r_in, z1), ring(r_out, z0), ring(r_in, z0)
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((it[i], ot[i], ot[j], it[j])); bm.faces.new((ib[j], ob[j], ob[i], ib[i]))
        bm.faces.new((ot[i], ob[i], ob[j], ot[j])); bm.faces.new((it[j], ib[j], ib[i], it[i]))
    return obj_from_bm(name, bm, [mn])

def boxes(name, specs, mn):
    bm = bmesh.new()
    for c, (sx, sy, sz), rz in specs:
        mat = Matrix.Translation(c) @ Matrix.Rotation(rz, 4, "Z")
        vs = [bm.verts.new(mat @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
        for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            bm.faces.new([vs[i] for i in f])
    return obj_from_bm(name, bm, [mn])

def text_mesh(body, size, extrude, loc, rot_z, mn, align="CENTER"):
    cu = bpy.data.curves.new("t_" + body, "FONT")
    cu.body = body; cu.size = size; cu.extrude = extrude
    cu.align_x = align; cu.align_y = "CENTER"; cu.resolution_u = 3
    t = bpy.data.objects.new("t_" + body, cu); coll.objects.link(t)
    t.location = loc; t.rotation_euler = (0, 0, rot_z)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(t.evaluated_get(dg)); me.transform(t.matrix_world)
    bpy.data.objects.remove(t)
    o = bpy.data.objects.new("txt_" + body, me); coll.objects.link(o); me.materials.append(M[mn])
    return o

def cyl_between(a, b, r, mn, seg=12):
    a, b = Vector(a), Vector(b); d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=seg, location=(a + b) / 2)
    o = bpy.context.object; o.rotation_mode = "QUATERNION"; o.rotation_quaternion = d.to_track_quat("Z", "Y")
    return set_mat(o, mn)

# ---------------------------------------------------------------- the rete: brass astrolabe engraved in dBm
log("modelling the rete")
parts = [band("limb", LIMB, LIMB + 0.55, -0.06, 0.06, "brass"),
         band("limb_in", LIMB - 0.12, LIMB, -0.03, 0.03, "polish")]
ticks = []
for i in range(144):                                  # degree ticks round the limb
    a = TAU * i / 144; L = 0.42 if i % 12 == 0 else 0.24 if i % 4 == 0 else 0.13
    rm = LIMB + 0.55 - L / 2 - 0.02
    ticks.append((Vector((rm * math.cos(a), rm * math.sin(a), 0.075)), (L, 0.035 if i % 12 else 0.06, 0.03), a))
parts.append(boxes("limb_ticks", ticks, "polish"))
for dbm in (-40, -50, -60, -70, -80):                 # signal graduations, each a fine engraved ring
    r = R_OF(dbm)
    parts.append(band(f"g{dbm}", r - 0.025, r + 0.025, -0.012, 0.012, "brass" if dbm % 20 else "polish", seg=192))
parts.append(band("bulge_ring", 1.15, 1.2, -0.012, 0.012, "bronze", seg=96))   # wired clients live inside this
# alidade: the radial rule that carries the numerals
spokes = [(Vector(((LIMB - 0.1) / 2 * math.cos(a), (LIMB - 0.1) / 2 * math.sin(a), 0)), (LIMB - 0.1, 0.07, 0.03), a)
          for a in (0, TAU / 3, 2 * TAU / 3)]
parts.append(boxes("spokes", spokes, "bronze"))
for dbm in (-40, -50, -60, -70, -80):
    r = R_OF(dbm)
    parts.append(text_mesh(f"{dbm}", 0.34, 0.012, (r, -0.26, 0.04), 0, "polish"))
parts.append(text_mesh("dBm", 0.26, 0.012, (R_OF(-85), -0.26, 0.04), 0, "brass"))
parts.append(text_mesh("WIRED", 0.2, 0.01, (0, -1.42, 0.03), 0, "bronze"))
for k, word in enumerate(("PROGNETWORK", "AIMESH", "2.4 · 5 GHZ")):    # engraved round the limb
    a = TAU * (0.125 + k / 3)
    parts.append(text_mesh(word, 0.28, 0.01, ((LIMB + 0.28) * math.cos(a), (LIMB + 0.28) * math.sin(a), 0.07), a - math.pi / 2, "ebony"))
rete = join("Rete", parts)
for p in rete.data.polygons: p.use_smooth = False

# ---------------------------------------------------------------- the beacon: an AiMesh router as a brass lantern
log("modelling the beacon")
b = []
bpy.ops.mesh.primitive_cylinder_add(radius=0.62, depth=0.08, vertices=64, location=(0, 0, 0.04)); b.append(set_mat(bpy.context.object, "bronze"))
bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=0.04, vertices=64, location=(0, 0, 0.1)); b.append(set_mat(bpy.context.object, "polish"))
body = boxes("body", [(Vector((0, 0, 0.26)), (0.86, 0.56, 0.22), 0)], "ebony"); b.append(body)
b.append(boxes("trim", [(Vector((0, 0.285, 0.26)), (0.8, 0.02, 0.05), 0), (Vector((0, -0.285, 0.26)), (0.8, 0.02, 0.05), 0)], "polish"))
for sx in (-1, 1):                                      # four splayed antennas, like the RT-AC3100
    for sy in (-1, 1):
        base = (sx * 0.34, sy * 0.2, 0.34); tip = (sx * 0.58, sy * 0.42, 1.2)
        b.append(cyl_between(base, tip, 0.03, "brass", 10))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.05, segments=12, ring_count=6, location=tip); b.append(set_mat(bpy.context.object, "polish"))
cage = [cyl_between((0.13 * math.cos(a), 0.13 * math.sin(a), 0.37), (0.13 * math.cos(a), 0.13 * math.sin(a), 0.68), 0.015, "brass", 6) for a in np.linspace(0, TAU, 6, endpoint=False)]
b += cage
bpy.ops.mesh.primitive_cone_add(radius1=0.19, radius2=0.04, depth=0.14, vertices=24, location=(0, 0, 0.75)); b.append(set_mat(bpy.context.object, "polish"))
beacon = join("Beacon", b)
for p in beacon.data.polygons: p.use_smooth = True
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.11, segments=24, ring_count=12, location=(0, 0, 0.52))
lamp = set_mat(bpy.context.object, "lamp"); lamp.name = "BeaconLamp"; lamp.data.name = "BeaconLamp"
lamp.parent = beacon
beacon.location = (0, 0, -60)                           # parked off-stage; the browser clones it per node

# ---------------------------------------------------------------- noise fields (Blender procedural textures)
def bake_raw(o, w, h, build):
    m = bpy.data.materials.new("raw_" + o.name)
    try: m.use_nodes = True
    except Exception: pass
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(build(nt), em.inputs["Color"]); nt.links.new(em.outputs[0], out.inputs[0])
    im = bpy.data.images.new("raw", w, h, float_buffer=True); im.colorspace_settings.name = "Non-Color"
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = im; nt.nodes.active = tn
    o.data.materials.clear(); o.data.materials.append(m)
    select_only([o]); bpy.ops.object.bake(type="EMIT", margin=2)
    a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
    o.data.materials.clear(); bpy.data.materials.remove(m); bpy.data.images.remove(im)
    return a.reshape(h, w, 4)

def save_png(arr, path):
    h, w = arr.shape[:2]
    im = bpy.data.images.new("out", w, h, alpha=True); im.colorspace_settings.name = "sRGB"
    im.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())
    im.filepath_raw = path; im.file_format = "PNG"; im.save(); bpy.data.images.remove(im)

def save_jpg(arr, path, q=90):
    h, w = arr.shape[:2]
    im = bpy.data.images.new("outj", w, h, alpha=False); im.colorspace_settings.name = "sRGB"
    im.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())
    scene.render.image_settings.quality = q
    im.filepath_raw = path; im.file_format = "JPEG"; im.save(); bpy.data.images.remove(im)

def fields(nt, coord_out, specs):
    """specs: three (kind, scale, detail, roughness) → combined into RGB."""
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for ch, (kind, sc, det, rough) in zip(("Red", "Green", "Blue"), specs):
        if kind == "noise":
            n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = sc
            n.inputs["Detail"].default_value = det; n.inputs["Roughness"].default_value = rough
            try: n.noise_dimensions = "3D"
            except Exception: pass
            nt.links.new(coord_out, n.inputs["Vector"]); nt.links.new(n.outputs["Fac"], comb.inputs[ch])
        else:
            v = nt.nodes.new("ShaderNodeTexVoronoi"); v.inputs["Scale"].default_value = sc
            try: v.feature = "F1"; v.distance = "EUCLIDEAN"
            except Exception: pass
            nt.links.new(coord_out, v.inputs["Vector"]); nt.links.new(v.outputs["Distance"], comb.inputs[ch])
    return comb.outputs[0]

def obj_coord(nt):
    tc = nt.nodes.new("ShaderNodeTexCoord"); return tc.outputs["Object"]

ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))

# ---------------------------------------------------------------- the disk
log(f"baking galaxy disk fields ({DISK}px)")
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, -80)); plane = bpy.context.object
F = bake_raw(plane, DISK, DISK, lambda nt: fields(nt, obj_coord(nt), [("noise", 3.2, 12, 0.62), ("voronoi", 26, 0, 0), ("noise", 18, 6, 0.5)]))
N, K, Fi = F[..., 0], F[..., 1], F[..., 2]
yy, xx = np.mgrid[0:DISK, 0:DISK].astype(np.float32)
x = (xx + 0.5) / DISK * 2 - 1; y = (yy + 0.5) / DISK * 2 - 1
r = np.sqrt(x * x + y * y); th = np.arctan2(y, x)
warp = (N - 0.5) * 0.9                                   # noise bends the arms so they aren't textbook-perfect
phase = 2 * th - 5.2 * np.log(r + 0.03) + warp
arm = (0.5 + 0.5 * np.cos(phase)) ** 3
lane = (0.5 + 0.5 * np.cos(phase + 0.62)) ** 10           # dust lanes trail the arms
bar = np.exp(-((x * np.cos(0.5) + y * np.sin(0.5)) / 0.32) ** 2 - ((-x * np.sin(0.5) + y * np.cos(0.5)) / 0.085) ** 2)
env = np.exp(-r * 2.4) * (1 - ss(0.78, 1.0, r))
bulge = np.exp(-(r / 0.09) ** 2) * 1.6 + np.exp(-r / 0.2) * 0.45 + bar * 0.7
gas = arm * (0.3 + 1.1 * N) * env * 1.5 + (0.12 + 0.25 * Fi) * env * 0.5
knots = ss(0.16, 0.0, K) * arm * env * ss(0.12, 0.3, r) * 2.2      # HII regions: hot pink clumps on the arms
dust = lane * 0.75 * ss(0.06, 0.25, r) * (0.6 + 0.6 * N)
I = (gas + bulge) * (1 - dust) + knots
t = ss(0.04, 0.55, r)[..., None]
core_c = np.array([1.0, 0.84, 0.58]); arm_c = np.array([0.52, 0.62, 1.0]); hii_c = np.array([1.0, 0.45, 0.7])
col = core_c * (1 - t) + arm_c * t
kn = np.clip(knots / (I + 1e-4), 0, 1)[..., None]
col = col * (1 - kn) + hii_c * kn
A = np.clip(I * 1.3, 0, 1) ** 0.85
disk = np.dstack([np.clip(col, 0, 1), A]).astype(np.float32)
save_png(disk, os.path.join(OUT, "galaxy_disk.png"))
bpy.data.objects.remove(plane)

# ---------------------------------------------------------------- the sky
log(f"baking nebula backdrop ({SKY_W}x{SKY_W // 2})")
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=128, ring_count=64, location=(0, 0, -100)); sph = bpy.context.object
G = bake_raw(sph, SKY_W, SKY_W // 2, lambda nt: fields(nt, obj_coord(nt), [("noise", 1.6, 14, 0.66), ("noise", 4.5, 10, 0.58), ("noise", 0.8, 4, 0.5)]))
n1, n2, n3 = G[..., 0], G[..., 1], G[..., 2]
h, w = n1.shape
lat = (np.arange(h, dtype=np.float32)[:, None] + 0.5) / h * np.pi - np.pi / 2   # -pi/2 … pi/2
band_ = np.exp(-((lat - 0.35 * np.sin(np.linspace(0, TAU, w))[None, :] * 0.4) / 0.32) ** 2)  # a tilted milky band
cloud = ss(0.45, 0.85, n1) * (0.35 + band_ * 0.9)
wisp = ss(0.5, 0.8, n2) * cloud
hue = n3[..., None]
violet = np.array([0.20, 0.10, 0.34]); teal = np.array([0.05, 0.22, 0.26]); ember = np.array([0.32, 0.12, 0.05])
neb = violet * (1 - hue) + teal * hue
neb = neb * (1 - ss(0.6, 0.9, n3)[..., None]) + ember * ss(0.6, 0.9, n3)[..., None]
sky = np.array([0.006, 0.008, 0.014]) + neb * (cloud * 0.5 + wisp * 0.8)[..., None] + band_[..., None] * np.array([0.02, 0.018, 0.024])
sky = np.dstack([np.clip(sky, 0, 1), np.ones((h, w))]).astype(np.float32)
save_jpg(sky, os.path.join(OUT, "galaxy_sky.jpg"), 90)
bpy.data.objects.remove(sph)

# ---------------------------------------------------------------- export
log("exporting glTF")
for o in list(coll.objects):
    if o.name not in ("Rete", "Beacon", "BeaconLamp"):
        bpy.data.objects.remove(o)
path = os.path.join(OUT, "galaxy.glb")
bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_extras=True, export_yup=True,
                          export_apply=True, export_texcoords=False, export_normals=True,
                          export_materials="EXPORT", export_cameras=False, export_lights=False)
log("done:", {f: os.path.getsize(os.path.join(OUT, f)) for f in sorted(os.listdir(OUT))})
