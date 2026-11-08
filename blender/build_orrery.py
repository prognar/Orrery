"""ORRERY — Blender build script.

Models the brass instrument, bakes ambient occlusion + procedural planet textures with Cycles,
and exports a single glTF binary that the browser scene (static/orrery3d.js) drives with live data.

Run with Blender's Python module:   ORRERY_OUT=out/ python build_orrery.py
or inside Blender:                   blender -b -P build_orrery.py

Units: 1 = ~1 dm. Blender is Z-up; the glTF exporter converts to Y-up.
Layout contract with orrery3d.js:
  orbit radii 3.6 / 6.2 / 8.8 · orbital plane z=0 · arm collars at z = -0.9 / -1.35 / -1.8
  nodes: Base (static, AO), Scale (rotates, AO), Gear0..3 (extras.speed), TplVM, TplLXC, TplMoon, PlexWorld, PlexRing
  side files: world_data.png (R height, G roughness), world_cities.png (R light, G settle order 0..1), world_clouds.png
"""
import bpy, bmesh, math, os, time
from mathutils import Vector, Matrix

OUT = os.path.abspath(os.environ.get("ORRERY_OUT", "out"))
SAMPLES = int(os.environ.get("ORRERY_SAMPLES", "48"))
AO_RES = int(os.environ.get("ORRERY_AO_RES", "1024"))
os.makedirs(OUT, exist_ok=True)
T0 = time.time()
def log(*a): print(f"[orrery {time.time()-T0:6.1f}s]", *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
coll = scene.collection
TAU = math.tau

# ---------------------------------------------------------------- materials
def material(name, color, metal, rough, coat=0.0):
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    if coat and "Coat Weight" in p.inputs:
        p.inputs["Coat Weight"].default_value = coat
    return m

M = {
    "brass":  material("Brass",       (0.80, 0.55, 0.25), 1.0, 0.28),
    "polish": material("BrassPolish", (0.92, 0.68, 0.33), 1.0, 0.18),
    "bronze": material("Bronze",      (0.36, 0.24, 0.12), 1.0, 0.46),
    "ebony":  material("Ebony",       (0.035, 0.026, 0.022), 0.0, 0.34, coat=0.6),
    "steel":  material("Steel",       (0.62, 0.62, 0.64), 1.0, 0.24),
}

def obj_from_bm(name, bm, mat_names):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for mn in mat_names: me.materials.append(M[mn])
    o = bpy.data.objects.new(name, me); coll.objects.link(o)
    for p in me.polygons: p.use_smooth = True
    return o

def select_only(objs, active=None):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]

def join(name, objs):
    select_only(objs)
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name; o.data.name = name
    return o

def set_mat(o, mn):
    o.data.materials.clear(); o.data.materials.append(M[mn]); return o

def smooth(o, angle=40):
    for p in o.data.polygons: p.use_smooth = True
    try:
        select_only([o]); bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
    except Exception:
        pass
    return o

# ---------------------------------------------------------------- primitives
def cyl(r, z0, z1, mn, seg=48, x=0, y=0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=z1 - z0, vertices=seg, location=(x, y, (z0 + z1) / 2))
    return set_mat(bpy.context.object, mn)

def cone(r0, r1, z0, z1, mn, seg=48):
    bpy.ops.mesh.primitive_cone_add(radius1=r0, radius2=r1, depth=z1 - z0, vertices=seg, location=(0, 0, (z0 + z1) / 2))
    return set_mat(bpy.context.object, mn)

def torus(R, r, z, mn, seg=96, mseg=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=mseg,
                                     location=(0, 0, z), rotation=rot)
    return set_mat(bpy.context.object, mn)

def sphere(r, loc, mn, seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=seg // 2, location=loc)
    return set_mat(bpy.context.object, mn)

def tube(name, pts, r, mn, seg=10, closed=False):
    """Sweep a circle along a polyline (parallel-transport frames)."""
    bm = bmesh.new()
    pts = [Vector(p) for p in pts]
    n = len(pts)
    tang = []
    for i in range(n):
        a = pts[(i - 1) % n] if (closed or i > 0) else pts[i]
        b = pts[(i + 1) % n] if (closed or i < n - 1) else pts[i]
        tang.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tang[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = tang[0].cross(ref).normalized()
    rings = []
    for i in range(n):
        if i:
            nrm = (nrm - tang[i] * nrm.dot(tang[i])).normalized()
        bi = tang[i].cross(nrm)
        rings.append([bm.verts.new(pts[i] + (nrm * math.cos(a) + bi * math.sin(a)) * r)
                      for a in (TAU * k / seg for k in range(seg))])
    last = n if closed else n - 1
    for i in range(last):
        A, B = rings[i], rings[(i + 1) % n]
        for k in range(seg):
            bm.faces.new((A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]))
    if not closed:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    return obj_from_bm(name, bm, [mn])

def band(name, r_in, r_out, z0, z1, mn, seg=192):
    """Flat annulus with thickness."""
    bm = bmesh.new()
    def ring(r, z): return [bm.verts.new((r * math.cos(TAU * i / seg), r * math.sin(TAU * i / seg), z)) for i in range(seg)]
    ot, it, ob, ib = ring(r_out, z1), ring(r_in, z1), ring(r_out, z0), ring(r_in, z0)
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((it[i], ot[i], ot[j], it[j]))   # top
        bm.faces.new((ib[j], ob[j], ob[i], ib[i]))   # bottom
        bm.faces.new((ot[i], ob[i], ob[j], ot[j]))   # outer wall
        bm.faces.new((it[j], ib[j], ib[i], it[i]))   # inner wall
    o = obj_from_bm(name, bm, [mn])
    for p in o.data.polygons: p.use_smooth = False
    return o

def boxes(name, specs, mn):
    """specs: (center Vector, (sx,sy,sz), rot_z)"""
    bm = bmesh.new()
    for c, (sx, sy, sz), rz in specs:
        mat = Matrix.Translation(c) @ Matrix.Rotation(rz, 4, "Z")
        vs = [bm.verts.new(mat @ Vector((x * sx / 2, y * sy / 2, z * sz / 2)))
              for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
        for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            bm.faces.new([vs[i] for i in f])
    o = obj_from_bm(name, bm, [mn])
    for p in o.data.polygons: p.use_smooth = False
    return o

def text_mesh(body, size, extrude, loc, rot_z, mn):
    cu = bpy.data.curves.new("t_" + body, "FONT")
    cu.body = body; cu.size = size; cu.extrude = extrude
    cu.align_x = "CENTER"; cu.align_y = "CENTER"; cu.resolution_u = 4
    t = bpy.data.objects.new("t_" + body, cu); coll.objects.link(t)
    t.location = loc; t.rotation_euler = (0, 0, rot_z)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(t.evaluated_get(dg))
    me.transform(t.matrix_world)
    bpy.data.objects.remove(t)
    o = bpy.data.objects.new("txt_" + body, me); coll.objects.link(o)
    me.materials.append(M[mn])
    return o

def gear(name, teeth, r_pitch, thick, hole, loc, speed, mn="brass"):
    m = 2 * r_pitch / teeth
    r_tip, r_root = r_pitch + m * 0.9, r_pitch - m * 1.1
    bm = bmesh.new()
    prof = []
    for i in range(teeth):
        a = TAU * i / teeth
        for da, r in ((-0.55, r_root), (-0.27, r_tip), (0.27, r_tip), (0.55, r_root)):
            prof.append((a + da * math.pi / teeth, r))
    N = len(prof)
    z0, z1 = -thick / 2, thick / 2
    def v(a, r, z): return bm.verts.new((r * math.cos(a), r * math.sin(a), z))
    ot = [v(a, r, z1) for a, r in prof]; ob = [v(a, r, z0) for a, r in prof]
    it = [v(a, hole, z1) for a, _ in prof]; ib = [v(a, hole, z0) for a, _ in prof]
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((it[i], ot[i], ot[j], it[j])); bm.faces.new((ib[j], ob[j], ob[i], ib[i]))
        bm.faces.new((ot[i], ob[i], ob[j], ot[j])); bm.faces.new((it[j], ib[j], ib[i], it[i]))
    # spokes: raised rim + hub ring give a cut-out wheel look
    o = obj_from_bm(name, bm, [mn])
    for p in o.data.polygons: p.use_smooth = False
    rim = torus(r_root - m * 0.6, thick * 0.55, 0, mn, seg=teeth * 4, mseg=8)
    hub = torus(hole + thick * 0.9, thick * 0.6, 0, mn, seg=32, mseg=8)
    spokes = boxes(name + "_sp", [(Vector(((r_root * 0.5 + hole * 0.5) * math.cos(TAU * k / 5),
                                           (r_root * 0.5 + hole * 0.5) * math.sin(TAU * k / 5), 0)),
                                   (r_root - hole - m, thick * 0.9, thick * 1.1), TAU * k / 5) for k in range(5)], mn)
    g = join(name, [o, rim, hub, spokes])
    g.location = loc
    g["speed"] = speed
    return g

# ---------------------------------------------------------------- Base (static)
log("modelling base")
parts = []
parts.append(cyl(7.2, -6.6, -6.0, "ebony", seg=128))                    # plinth
parts.append(torus(7.2, 0.07, -6.0, "polish", seg=160))                 # top trim
parts.append(torus(7.25, 0.09, -6.6, "brass", seg=160))                 # bottom trim
parts.append(cyl(5.2, -6.0, -5.92, "bronze", seg=96))                   # inset disc
parts.append(cone(1.6, 0.55, -5.92, -5.0, "bronze", seg=64))            # foot flare
parts.append(torus(1.2, 0.08, -5.45, "polish", seg=64))
parts.append(cyl(0.34, -5.0, -0.8, "brass", seg=40))                    # column
for z in (-0.9, -1.35, -1.8):                                           # arm collars
    parts.append(torus(0.44, 0.09, z, "polish", seg=40, mseg=10))
parts.append(cyl(4.4, -3.25, -3.12, "bronze", seg=96))                  # movement plate
parts.append(torus(4.4, 0.06, -3.12, "polish", seg=128))
for k in range(3):                                                      # plate pillars
    a = TAU * k / 3 + 0.4
    parts.append(cyl(0.09, -5.92, -3.25, "brass", seg=16, x=3.8 * math.cos(a), y=3.8 * math.sin(a)))
# struts: plinth -> scale ring underside
for k in range(3):
    a = TAU * k / 3 + math.pi / 2
    pts = []
    for i in range(33):
        t = i / 32
        r = (1 - t) ** 2 * 6.7 + 2 * (1 - t) * t * 11.6 + t * t * 10.45
        z = (1 - t) ** 2 * -6.0 + 2 * (1 - t) * t * -5.4 + t * t * -0.14
        pts.append((r * math.cos(a), r * math.sin(a), z))
    parts.append(tube(f"strut{k}", pts, 0.11, "bronze", seg=12))
    parts.append(sphere(0.2, pts[0], "polish", seg=16))
# meridian half-ring standing on the scale ring, with finial
rot = Matrix.Rotation(math.radians(28), 3, "Z")
mer = [rot @ Vector((10.5 * math.cos(th), 0, 0.06 + 10.5 * math.sin(th))) for th in (math.pi * i / 96 for i in range(97))]
parts.append(tube("meridian", mer, 0.075, "brass", seg=12))
parts.append(sphere(0.26, rot @ Vector((0, 0, 10.62)), "polish", seg=24))
parts.append(cone(0.12, 0.0, 10.8, 11.4, "polish", seg=16))
for s in (-1, 1):
    parts.append(sphere(0.17, rot @ Vector((s * 10.5, 0, 0.1)), "polish", seg=16))
# ecliptic ring, tilted 23.4°
tilt = Matrix.Rotation(math.radians(28), 3, "Z") @ Matrix.Rotation(math.radians(23.4), 3, "X")
ecl = [tilt @ Vector((11.6 * math.cos(TAU * i / 160), 11.6 * math.sin(TAU * i / 160), 0)) for i in range(160)]
parts.append(tube("ecliptic", ecl, 0.05, "brass", seg=10, closed=True))
base = join("Base", parts)
smooth(base)

# ---------------------------------------------------------------- Gears (rotate in JS)
log("modelling gears")
g0 = gear("Gear0", 32, 1.55, 0.13, 0.36, (0, 0, -2.6), 1.0)
gears_spec = [("Gear1", 18, 0.87, 35, -2.6, -32 / 18),
              ("Gear3", 22, 1.07, 165, -2.6, -32 / 22)]
for nm, n, rp, ang, z, sp in gears_spec:
    d = 1.55 + rp
    gear(nm, n, rp, 0.13, 0.12, (d * math.cos(math.radians(ang)), d * math.sin(math.radians(ang)), z), sp)
d1 = 1.55 + 0.87
c1 = Vector((d1 * math.cos(math.radians(35)), d1 * math.sin(math.radians(35)), -2.82))
d2 = 0.87 + 1.2
c2 = c1 + Vector((d2 * math.cos(math.radians(-20)), d2 * math.sin(math.radians(-20)), 0))
gear("Gear2", 26, 1.2, 0.11, 0.12, tuple(c2), 32 / 26)   # meshes with Gear1, one level lower
# arbors for satellite gears (static, into Base would break join order — keep separate static node)
arb = [cyl(0.06, -3.12, -2.45, "steel", seg=12, x=o.location.x, y=o.location.y)
       for o in (bpy.data.objects[n] for n in ("Gear1", "Gear2", "Gear3"))]
arbors = join("Arbors", arb)

# ---------------------------------------------------------------- Scale ring (rotates slowly in JS)
log("modelling scale ring")
sc = [band("ring", 9.95, 11.0, -0.14, 0.06, "bronze")]
sc.append(torus(11.0, 0.05, -0.04, "polish", seg=192, mseg=8))
sc.append(torus(9.95, 0.04, -0.04, "polish", seg=192, mseg=8))
ticks = []
for i in range(180):
    a = TAU * i / 180
    L = 0.32 if i % 15 == 0 else 0.2 if i % 5 == 0 else 0.11
    r = 10.95 - L / 2
    ticks.append((Vector((r * math.cos(a), r * math.sin(a), 0.075)), (L, 0.035, 0.03), a))
sc.append(boxes("ticks", ticks, "polish"))
ROMAN = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"]
for i, s in enumerate(ROMAN):
    a = math.pi / 2 - TAU * i / 12
    sc.append(text_mesh(s, 0.42, 0.018, (10.36 * math.cos(a), 10.36 * math.sin(a), 0.08), a - math.pi / 2, "polish"))
scale_ring = join("Scale", sc)

# ---------------------------------------------------------------- textures (Cycles bakes)
def img(name, w, h, alpha=False):
    i = bpy.data.images.new(name, w, h, alpha=alpha); return i

def uv_unwrap(o, margin=0.004):
    select_only([o])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")

def bake_ao(o, res, path):
    log(f"baking AO for {o.name} ({res}px, {SAMPLES} spp)")
    uv_unwrap(o)
    im = img("ao_" + o.name, res, res)
    temps = []
    for m in o.data.materials:
        n = m.node_tree.nodes.new("ShaderNodeTexImage"); n.image = im
        m.node_tree.nodes.active = n; temps.append((m, n))
    select_only([o])
    bpy.ops.object.bake(type="AO", margin=6, use_clear=True)
    im.filepath_raw = path; im.file_format = "JPEG"
    scene.render.image_settings.quality = 88
    im.save()
    for m, n in temps: m.node_tree.nodes.remove(n)
    log("  ->", os.path.basename(path))

def procedural_bake(o, res_w, res_h, build, path, fmt="JPEG"):
    """build(nt) -> output socket of a color; baked as emission into an image."""
    m = bpy.data.materials.new("bake_" + o.name)
    try: m.use_nodes = True
    except Exception: pass
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(build(nt), em.inputs["Color"]); nt.links.new(em.outputs[0], out.inputs[0])
    im = img("tex_" + o.name, res_w, res_h)
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = im; nt.nodes.active = tn
    o.data.materials.clear(); o.data.materials.append(m)
    select_only([o])
    bpy.ops.object.bake(type="EMIT", margin=4)
    im.filepath_raw = path; im.file_format = fmt; im.save()
    o.data.materials.clear(); bpy.data.materials.remove(m)
    return im

def ramp(nt, fac_socket, stops):
    r = nt.nodes.new("ShaderNodeValToRGB")
    el = r.color_ramp.elements
    while len(el) > 2: el.remove(el[-1])
    el[0].position, el[0].color = stops[0][0], (*stops[0][1], 1)
    el[1].position, el[1].color = stops[-1][0], (*stops[-1][1], 1)
    for p, c in stops[1:-1]:
        e = el.new(p); e.color = (*c, 1)
    nt.links.new(fac_socket, r.inputs["Fac"])
    return r.outputs["Color"]

def hexc(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def textured_template(name, build, res, metal, rough, emit_strength=0.0):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=64, ring_count=32, location=(0, 0, -40))
    o = bpy.context.object; o.name = name; o.data.name = name
    for p in o.data.polygons: p.use_smooth = True
    path = os.path.join(OUT, f"_{name}.jpg")
    im = procedural_bake(o, res * 2, res, build, path)
    m = bpy.data.materials.new("mat_" + name)
    try: m.use_nodes = True
    except Exception: pass
    p = m.node_tree.nodes.get("Principled BSDF")
    t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = im
    m.node_tree.links.new(t.outputs["Color"], p.inputs["Base Color"])
    p.inputs["Metallic"].default_value = metal; p.inputs["Roughness"].default_value = rough
    o.data.materials.append(m)
    return o

def gas_bands(nt):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 8; noise.inputs["Roughness"].default_value = 0.6
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    wave = nt.nodes.new("ShaderNodeTexWave"); wave.wave_type = "BANDS"; wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = 1.7; wave.inputs["Distortion"].default_value = 2.4
    wave.inputs["Detail"].default_value = 4
    mix = nt.nodes.new("ShaderNodeVectorMath"); mix.operation = "ADD"
    sc = nt.nodes.new("ShaderNodeVectorMath"); sc.operation = "SCALE"; sc.inputs["Scale"].default_value = 0.05
    nt.links.new(noise.outputs["Color"], sc.inputs[0])
    nt.links.new(tc.outputs["Object"], mix.inputs[0]); nt.links.new(sc.outputs[0], mix.inputs[1])
    nt.links.new(mix.outputs[0], wave.inputs["Vector"])
    bands = ramp(nt, wave.outputs["Fac"], [(0.0, hexc("#3b2d62")), (0.3, hexc("#5b4a8f")), (0.5, hexc("#7a66b5")),
                                            (0.68, hexc("#a493d6")), (0.85, hexc("#c4b6ea")), (1.0, hexc("#6a5aa0"))])
    # a gold storm, because it's the far planet
    storm_v = nt.nodes.new("ShaderNodeMapping"); storm_v.inputs["Location"].default_value = (-0.6, 0.75, 0.25)
    storm_v.inputs["Scale"].default_value = (2.2, 2.2, 4.5)
    nt.links.new(tc.outputs["Object"], storm_v.inputs["Vector"])
    grad = nt.nodes.new("ShaderNodeTexGradient"); grad.gradient_type = "SPHERICAL"
    nt.links.new(storm_v.outputs[0], grad.inputs["Vector"])
    storm = ramp(nt, grad.outputs["Fac"], [(0.0, (0, 0, 0)), (0.25, (0, 0, 0)), (0.6, (1, 1, 1)), (1.0, (1, 1, 1))])
    m = nt.nodes.new("ShaderNodeMix"); m.data_type = "RGBA"; m.blend_type = "MIX"
    nt.links.new(storm, m.inputs["Factor"]); nt.links.new(bands, m.inputs[6])
    m.inputs[7].default_value = (*hexc("#c9a45c"), 1)
    return m.outputs[2]

def verdigris(nt):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = 4.5
    n.inputs["Detail"].default_value = 10; n.inputs["Roughness"].default_value = 0.65
    nt.links.new(tc.outputs["Object"], n.inputs["Vector"])
    return ramp(nt, n.outputs["Fac"], [(0.3, hexc("#163a33")), (0.45, hexc("#2d6b5e")), (0.55, hexc("#5fb3a1")),
                                        (0.68, hexc("#a7dccd")), (0.78, hexc("#7a5a2c"))])

def hammered(nt):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    v = nt.nodes.new("ShaderNodeTexVoronoi"); v.inputs["Scale"].default_value = 9.0
    v.feature = "F1"
    nt.links.new(tc.outputs["Object"], v.inputs["Vector"])
    return ramp(nt, v.outputs["Distance"], [(0.0, hexc("#f6e3b4")), (0.35, hexc("#c9a45c")),
                                             (0.7, hexc("#8c6d38")), (1.0, hexc("#5e4724"))])

def cratered(nt):
    """Regolith moon: two voronoi crater layers (rims bright, floors dark) over fine noise."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    def crater_layer(scale):
        v = nt.nodes.new("ShaderNodeTexVoronoi"); v.inputs["Scale"].default_value = scale; v.feature = "F1"
        nt.links.new(tc.outputs["Object"], v.inputs["Vector"])
        return ramp(nt, v.outputs["Distance"], [(0.0, (0.3, 0.3, 0.3)), (0.17, (0.42, 0.42, 0.42)),
                                                 (0.21, (0.92, 0.92, 0.92)), (0.28, (0.66, 0.66, 0.66)), (1.0, (0.68, 0.68, 0.68))])
    big, small = crater_layer(2.4), crater_layer(7.0)
    n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = 18; n.inputs["Detail"].default_value = 12
    nt.links.new(tc.outputs["Object"], n.inputs["Vector"])
    m1 = nt.nodes.new("ShaderNodeMix"); m1.data_type = "RGBA"; m1.blend_type = "MULTIPLY"; m1.inputs["Factor"].default_value = 1.0
    nt.links.new(big, m1.inputs[6]); nt.links.new(small, m1.inputs[7])
    m2 = nt.nodes.new("ShaderNodeMix"); m2.data_type = "RGBA"; m2.blend_type = "OVERLAY"; m2.inputs["Factor"].default_value = 0.55
    nt.links.new(m1.outputs[2], m2.inputs[6]); nt.links.new(n.outputs["Color"], m2.inputs[7])
    tint = nt.nodes.new("ShaderNodeMix"); tint.data_type = "RGBA"; tint.blend_type = "MULTIPLY"; tint.inputs["Factor"].default_value = 1.0
    nt.links.new(m2.outputs[2], tint.inputs[6]); tint.inputs[7].default_value = (*hexc("#e8dcc0"), 1)
    return tint.outputs[2]

log("baking planet textures")
tvm = textured_template("TplVM", verdigris, 512, 0.25, 0.5)
tlx = textured_template("TplLXC", hammered, 512, 0.9, 0.32)
giant = textured_template("PlexGiant", gas_bands, 1024, 0.0, 0.62)
moon = textured_template("TplMoon", cratered, 512, 0.05, 0.9)
for o in (tvm, tlx, giant, moon): o.location = (0, 0, -40)

# ---------------------------------------------------------------- media server: an alien world, colonised as D: fills
# Every map below is derived from the same procedural fields, so colour, relief, cities and order line up exactly.
import numpy as np
WORLD_W = int(os.environ.get("ORRERY_WORLD_RES", "2048")); WORLD_H = WORLD_W // 2

def world_fields(nt):
    """-> dict of sockets: fac (continent noise), land 0..1, height 0..1, coast 0..1 (1 at shoreline), lat 0..1, moist."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = 1.45; n.inputs["Detail"].default_value = 12
    n.inputs["Roughness"].default_value = 0.56
    try: n.noise_dimensions = "4D"; n.inputs["W"].default_value = 3.7   # W = the "seed" of this world
    except Exception: pass
    nt.links.new(tc.outputs["Object"], n.inputs["Vector"])
    def mr(sock, a, b, c=0.0, d=1.0, clamp=True):
        m = nt.nodes.new("ShaderNodeMapRange"); m.clamp = clamp
        m.inputs["From Min"].default_value = a; m.inputs["From Max"].default_value = b
        m.inputs["To Min"].default_value = c; m.inputs["To Max"].default_value = d
        nt.links.new(sock, m.inputs["Value"]); return m.outputs["Result"]
    fac = n.outputs["Fac"]
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Object"], sep.inputs[0])
    absz = nt.nodes.new("ShaderNodeMath"); absz.operation = "ABSOLUTE"; nt.links.new(sep.outputs["Z"], absz.inputs[0])
    m2 = nt.nodes.new("ShaderNodeTexNoise"); m2.inputs["Scale"].default_value = 3.2; m2.inputs["Detail"].default_value = 6
    nt.links.new(tc.outputs["Object"], m2.inputs["Vector"])
    return {"fac": fac, "land": mr(fac, 0.495, 0.508), "height": mr(fac, 0.503, 0.74), "depth": mr(fac, 0.30, 0.503),
            "coast": mr(fac, 0.503, 0.56, 1.0, 0.0), "lat": absz.outputs[0], "moist": m2.outputs["Fac"], "tc": tc, "mr": mr}

def mix_rgb(nt, fac, a, b, mode="MIX"):
    m = nt.nodes.new("ShaderNodeMix"); m.data_type = "RGBA"; m.blend_type = mode
    if isinstance(fac, float): m.inputs["Factor"].default_value = fac
    else: nt.links.new(fac, m.inputs["Factor"])
    for i, s in ((6, a), (7, b)):
        if isinstance(s, tuple): m.inputs[i].default_value = (*s, 1)
        else: nt.links.new(s, m.inputs[i])
    return m.outputs[2]

def world_color(nt):
    F = world_fields(nt)
    ocean = ramp(nt, F["depth"], [(0.0, hexc("#071528")), (0.55, hexc("#0e3256")), (0.85, hexc("#14607a")), (1.0, hexc("#2b9a94"))])
    hi = ramp(nt, F["height"], [(0.0, hexc("#d9b77a")), (0.04, hexc("#a8603a")), (0.22, hexc("#7a4fa8")), (0.5, hexc("#9a5a3a")),
                                (0.75, hexc("#d2b07a")), (0.92, hexc("#e9dcc4")), (1.0, hexc("#f6f1e8"))])
    wet = ramp(nt, F["moist"], [(0.35, (0, 0, 0)), (0.6, (1, 1, 1))])
    forest = mix_rgb(nt, wet, hi, hexc("#4a2f7a"), "MIX")           # teal-violet jungles where it's wet
    forest = mix_rgb(nt, 0.6, hi, forest)
    land = mix_rgb(nt, F["land"], ocean, forest)
    ice = F["mr"](F["lat"], 0.955, 0.975)
    return mix_rgb(nt, ice, land, hexc("#dfeaf2"))

def world_height(nt):   # grey: land elevation (oceans flat)
    F = world_fields(nt)
    m = nt.nodes.new("ShaderNodeMath"); m.operation = "MULTIPLY"
    nt.links.new(F["height"], m.inputs[0]); nt.links.new(F["land"], m.inputs[1])
    c = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3): nt.links.new(m.outputs[0], c.inputs[i])
    return c.outputs[0]

def world_rough(nt):    # grey: glossy seas, matte land, satin ice
    F = world_fields(nt)
    r = F["mr"](F["land"], 0.0, 1.0, 0.14, 0.88)
    ice = F["mr"](F["lat"], 0.955, 0.975)
    m = nt.nodes.new("ShaderNodeMix"); m.data_type = "FLOAT"; nt.links.new(ice, m.inputs["Factor"])
    nt.links.new(r, m.inputs[2]); m.inputs[3].default_value = 0.45
    c = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3): nt.links.new(m.outputs[0], c.inputs[i])
    return c.outputs[0]

def world_lights(nt):   # grey: settlement light sites — clustered on land, densest along coasts and rivers of moisture
    F = world_fields(nt)
    def dots(scale, size):
        v = nt.nodes.new("ShaderNodeTexVoronoi"); v.inputs["Scale"].default_value = scale; v.feature = "F1"
        try: v.inputs["Randomness"].default_value = 1.0
        except Exception: pass
        nt.links.new(F["tc"].outputs["Object"], v.inputs["Vector"])
        return F["mr"](v.outputs["Distance"], 0.0, size, 1.0, 0.0)
    big, small = dots(26, 0.24), dots(70, 0.3)
    add = nt.nodes.new("ShaderNodeMath"); add.operation = "MAXIMUM"; nt.links.new(big, add.inputs[0]); nt.links.new(small, add.inputs[1])
    pop = nt.nodes.new("ShaderNodeTexNoise"); pop.inputs["Scale"].default_value = 6; pop.inputs["Detail"].default_value = 4
    nt.links.new(F["tc"].outputs["Object"], pop.inputs["Vector"])
    habit = F["mr"](pop.outputs["Fac"], 0.36, 0.56)
    w = nt.nodes.new("ShaderNodeMath"); w.operation = "MULTIPLY"; nt.links.new(add.outputs[0], w.inputs[0]); nt.links.new(habit, w.inputs[1])
    w2 = nt.nodes.new("ShaderNodeMath"); w2.operation = "MULTIPLY"; nt.links.new(w.outputs[0], w2.inputs[0]); nt.links.new(F["land"], w2.inputs[1])
    noice = F["mr"](F["lat"], 0.93, 0.95, 1.0, 0.0)
    w3 = nt.nodes.new("ShaderNodeMath"); w3.operation = "MULTIPLY"; nt.links.new(w2.outputs[0], w3.inputs[0]); nt.links.new(noice, w3.inputs[1])
    c = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3): nt.links.new(w3.outputs[0], c.inputs[i])
    return c.outputs[0]

def world_order(nt):    # grey: when a site is settled — coasts first, then inland, with regional jitter
    F = world_fields(nt)
    j = nt.nodes.new("ShaderNodeTexNoise"); j.inputs["Scale"].default_value = 2.2; j.inputs["Detail"].default_value = 3
    nt.links.new(F["tc"].outputs["Object"], j.inputs["Vector"])
    inland = F["mr"](F["fac"], 0.503, 0.74)
    m = nt.nodes.new("ShaderNodeMath"); m.operation = "MULTIPLY_ADD"
    nt.links.new(inland, m.inputs[0]); m.inputs[1].default_value = 0.65; nt.links.new(j.outputs["Fac"], m.inputs[2])
    c = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3): nt.links.new(m.outputs[0], c.inputs[i])
    return c.outputs[0]

def world_clouds(nt):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    warp = nt.nodes.new("ShaderNodeTexNoise"); warp.inputs["Scale"].default_value = 1.6; warp.inputs["Detail"].default_value = 3
    nt.links.new(tc.outputs["Object"], warp.inputs["Vector"])
    add = nt.nodes.new("ShaderNodeVectorMath"); add.operation = "ADD"
    nt.links.new(tc.outputs["Object"], add.inputs[0]); nt.links.new(warp.outputs["Color"], add.inputs[1])
    n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = 3.4; n.inputs["Detail"].default_value = 9
    n.inputs["Roughness"].default_value = 0.6
    nt.links.new(add.outputs[0], n.inputs["Vector"])
    return ramp(nt, n.outputs["Fac"], [(0.0, (0, 0, 0)), (0.5, (0, 0, 0)), (0.68, (0.8, 0.8, 0.8)), (0.85, (1, 1, 1))])

def bake_raw(o, w, h, build, data=True):
    """Bake an emission network to an in-memory float image; returns (h, w, 4) numpy array."""
    m = bpy.data.materials.new("raw_" + o.name)
    try: m.use_nodes = True
    except Exception: pass
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(build(nt), em.inputs["Color"]); nt.links.new(em.outputs[0], out.inputs[0])
    im = bpy.data.images.new("raw", w, h, float_buffer=True)
    if data: im.colorspace_settings.name = "Non-Color"
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = im; nt.nodes.active = tn
    o.data.materials.clear(); o.data.materials.append(m)
    select_only([o]); bpy.ops.object.bake(type="EMIT", margin=2)
    a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
    o.data.materials.clear(); bpy.data.materials.remove(m); bpy.data.images.remove(im)
    return a.reshape(h, w, 4)

def save_png(arr, name, path):
    h, w = arr.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True); im.colorspace_settings.name = "Non-Color"
    im.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())
    im.filepath_raw = path; im.file_format = "PNG"; im.save(); bpy.data.images.remove(im)

log(f"generating media server world ({WORLD_W}x{WORLD_H})")
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=128, ring_count=64, location=(0, 0, -40))
world = bpy.context.object; world.name = "PlexWorld"; world.data.name = "PlexWorld"
for p in world.data.polygons: p.use_smooth = True
col_path = os.path.join(OUT, "_world_color.jpg")
col_img = procedural_bake(world, WORLD_W, WORLD_H, world_color, col_path)
hgt = bake_raw(world, WORLD_W // 2, WORLD_H // 2, world_height)[..., 0]
rgh = bake_raw(world, WORLD_W // 2, WORLD_H // 2, world_rough)[..., 0]
data = np.zeros((WORLD_H // 2, WORLD_W // 2, 4), np.float32); data[..., 0] = hgt; data[..., 1] = rgh; data[..., 3] = 1
save_png(data, "world_data", os.path.join(OUT, "world_data.png"))
lit = bake_raw(world, WORLD_W, WORLD_H, world_lights)[..., 0]
order = bake_raw(world, WORLD_W, WORLD_H, world_order)[..., 0]
# histogram-equalise settlement order over the sites, so "28% colonised" lights exactly 28% of settlements
sites = lit > 0.04
eq = np.ones_like(order)
idx = np.argsort(order[sites], kind="stable"); ranks = np.empty_like(idx); ranks[idx] = np.arange(idx.size)
eq[sites] = ranks / max(1, idx.size - 1)
cities = np.zeros((WORLD_H, WORLD_W, 4), np.float32); cities[..., 0] = np.clip(lit, 0, 1); cities[..., 1] = eq; cities[..., 3] = 1
save_png(cities, "world_cities", os.path.join(OUT, "world_cities.png"))
cl = bake_raw(world, WORLD_W, WORLD_H, world_clouds)[..., 0]
clouds = np.zeros((WORLD_H, WORLD_W, 4), np.float32); clouds[..., :3] = np.clip(cl, 0, 1)[..., None]; clouds[..., 3] = 1
save_png(clouds, "world_clouds", os.path.join(OUT, "world_clouds.png"))
log(f"  settlement sites: {int(sites.sum())} px ({sites.mean() * 100:.1f}% of map)")
wm = bpy.data.materials.new("mat_PlexWorld")
try: wm.use_nodes = True
except Exception: pass
p = wm.node_tree.nodes.get("Principled BSDF")
t = wm.node_tree.nodes.new("ShaderNodeTexImage"); t.image = col_img
wm.node_tree.links.new(t.outputs["Color"], p.inputs["Base Color"])
p.inputs["Metallic"].default_value = 0.0; p.inputs["Roughness"].default_value = 0.7
world.data.materials.clear(); world.data.materials.append(wm)
world.location = (0, 0, -40)

# ring for the giant: annulus with radial UVs + a computed RGBA band texture (Cassini-style gaps)
log("building plex ring")
bm = bmesh.new()
uvl = bm.loops.layers.uv.new()
R0, R1, SEG = 1.45, 2.55, 128
inner = [bm.verts.new((R0 * math.cos(TAU * i / SEG), R0 * math.sin(TAU * i / SEG), 0)) for i in range(SEG)]
outer = [bm.verts.new((R1 * math.cos(TAU * i / SEG), R1 * math.sin(TAU * i / SEG), 0)) for i in range(SEG)]
for i in range(SEG):
    j = (i + 1) % SEG
    f = bm.faces.new((inner[i], outer[i], outer[j], inner[j]))
    for loop in f.loops:
        loop[uvl].uv = (0.02 if loop.vert in inner else 0.98, 0.5)
ring = obj_from_bm("PlexRing", bm, ["brass"])
W = 512
ring_img = img("tex_ring", W, 4, alpha=True)
px = []
import random
random.seed(7)
gaps = [(0.42, 0.03), (0.63, 0.012), (0.83, 0.02)]
for y in range(4):
    for x in range(W):
        t = x / (W - 1)
        a = 0.85 * (0.5 + 0.5 * math.sin(t * 61) * math.sin(t * 17 + 1)) * (1 - abs(t - 0.5) * 1.1)
        a = max(0.05, min(0.95, a + random.uniform(-0.05, 0.05)))
        for g, w in gaps:
            if abs(t - g) < w: a *= 0.08
        if t < 0.03 or t > 0.97: a = 0
        c = (0.95, 0.82, 0.58) if (t * 23) % 2 < 1 else (0.82, 0.74, 0.92)
        px += [*c, a]
ring_img.pixels = px
ring_img.filepath_raw = os.path.join(OUT, "_ring.png"); ring_img.file_format = "PNG"; ring_img.save()
rm = bpy.data.materials.new("mat_PlexRing")
try: rm.use_nodes = True
except Exception: pass
p = rm.node_tree.nodes.get("Principled BSDF")
t = rm.node_tree.nodes.new("ShaderNodeTexImage"); t.image = ring_img
rm.node_tree.links.new(t.outputs["Color"], p.inputs["Base Color"])
rm.node_tree.links.new(t.outputs["Alpha"], p.inputs["Alpha"])
p.inputs["Metallic"].default_value = 0.3; p.inputs["Roughness"].default_value = 0.5
try: rm.surface_render_method = "BLENDED"
except Exception: rm.blend_method = "BLEND"
ring.data.materials.clear(); ring.data.materials.append(rm)
ring.location = (0, 0, -40)

# ---------------------------------------------------------------- AO bakes for the static/rotating brass
bake_ao(base, AO_RES, os.path.join(OUT, "ao_base.jpg"))
bake_ao(scale_ring, AO_RES, os.path.join(OUT, "ao_scale.jpg"))

# ---------------------------------------------------------------- export
log("exporting glTF")
for o in list(coll.objects):
    if o.type != "MESH": bpy.data.objects.remove(o)
path = os.path.join(OUT, "orrery.glb")
bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_extras=True, export_yup=True,
                          export_apply=True, export_image_format="AUTO", export_texcoords=True,
                          export_normals=True, export_materials="EXPORT", export_cameras=False, export_lights=False)
for f in os.listdir(OUT):
    if f.startswith("_"): os.remove(os.path.join(OUT, f))
log("done:", {f: os.path.getsize(os.path.join(OUT, f)) for f in sorted(os.listdir(OUT))})
