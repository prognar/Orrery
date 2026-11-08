// ORRERY · GALAXY — the home network as a spiral galaxy held in a Blender-built brass astrolabe.
//   core            = main router (its beacon lamp is the nucleus); jets = WAN ⇡ / ⇣
//   satellite galaxy = each AiMesh node, tethered by its ethernet backhaul
//   star            = online client · radius = signal (read off the rete's dBm rings) · arm = band · bulge = wired
//   brightness      = internet connections (5 min) · photons fly to the core and out the jet
//   halo dust       = known devices that are away
// Reads classic-script globals from index.html (S, C, esc, fmtUp, fmtBps).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// layout contract with blender/build_galaxy.py
const LIMB = 11.6, R_OF = dbm => 1.6 + (-dbm - 30) * 0.16;
const SAT_DIST = 25, SAT_SCALE = 0.56;
const COL = { g5: new THREE.Color('#a9c4ff'), g24: new THREE.Color('#ffc477'), wired: new THREE.Color('#fff0cf'), lab: new THREE.Color('#e7b85f'), guest: new THREE.Color('#c9a45c') };

function glowTexture(soft = 0.25) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(soft, 'rgba(255,255,255,.42)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function spikeTexture() {   // diffraction-spike star for the bright ones
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 30); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[128, 3], [3, 128]]) { const l = x.createLinearGradient(64 - w / 2, 64 - h / 2, 64 + w / 2, 64 + h / 2); l.addColorStop(0, 'rgba(255,255,255,0)'); l.addColorStop(.5, 'rgba(255,255,255,.7)'); l.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = l; x.fillRect(64 - w / 2, 64 - h / 2, w, h) }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0) / 4294967296 };
const label = (html, cls) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return new CSS2DObject(d) };
const devName = d => d.name || d.host || d.vendor || d.mac;
const conns = d => d.net ? d.net.o5 + d.net.i5 : 0;

export async function startGalaxy(host, status = () => {}) {
  const W = () => Math.max(1, host.clientWidth), H = () => Math.max(1, host.clientHeight);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); renderer.setSize(W(), H());
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  host.appendChild(renderer.domElement);
  const css = new CSS2DRenderer(); css.setSize(W(), H()); css.domElement.className = 'g3-labels'; host.appendChild(css.domElement);
  const tip = document.createElement('div'); tip.className = 'g3-tip'; host.appendChild(tip);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
  const camera = new THREE.PerspectiveCamera(38, W() / H(), 0.1, 900);
  camera.position.set(4, 21, 34);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(2, 0, -3); controls.enableDamping = true; controls.dampingFactor = 0.06;
  controls.minDistance = 6; controls.maxDistance = 110; controls.maxPolarAngle = 1.52;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.22;
  let idleAt = 0;
  controls.addEventListener('start', () => { controls.autoRotate = false; idleAt = performance.now() });
  controls.addEventListener('end', () => { idleAt = performance.now() });
  scene.add(new THREE.HemisphereLight('#d8c39a', '#05060a', 0.5));
  const key = new THREE.DirectionalLight('#ffe2b0', 1.5); key.position.set(-14, 24, 12); scene.add(key);
  const rim = new THREE.DirectionalLight('#8fb7ff', 0.8); rim.position.set(18, 6, -20); scene.add(rim);

  status('charting the galaxy…');
  const tl = new THREE.TextureLoader();
  const [gltf, diskTex, skyTex] = await Promise.all([
    new GLTFLoader().loadAsync('/galaxy.glb'),
    tl.loadAsync('/galaxy_disk.png'),
    tl.loadAsync('/galaxy_sky.jpg').catch(() => null),
  ]);
  diskTex.colorSpace = THREE.SRGBColorSpace; diskTex.anisotropy = 4;
  if (skyTex) { skyTex.mapping = THREE.EquirectangularReflectionMapping; skyTex.colorSpace = THREE.SRGBColorSpace; scene.background = skyTex; scene.backgroundIntensity = 1.6 }
  else scene.background = new THREE.Color('#05070b');
  const RETE = gltf.scene.getObjectByName('Rete'), BEACON = gltf.scene.getObjectByName('Beacon');
  BEACON.position.set(0, 0, 0);
  const glow = glowTexture(), spike = spikeTexture(), soft = glowTexture(0.08);

  { // distant field stars
    const n = 2600, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 300 + Math.random() * 200, s = Math.sqrt(1 - u * u);
      p.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3); const k = 0.5 + Math.random() * 0.5, w = Math.random();
      c.set([k, k * (0.9 + w * 0.1), k * (0.8 + w * 0.25)], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: true, map: soft })));
  }

  // ---------- galaxies (one per AiMesh node)
  const G = new Map();   // node name -> galaxy
  function makeGalaxy(node, idx, nSat) {
    const main = node.main, s = main ? 1 : SAT_SCALE;
    const root = new THREE.Group(); scene.add(root);
    if (!main) { const a = nSat === 1 ? 0.35 : -0.3 + (idx - 1) * (1.5 / (nSat - 1)); root.position.set(Math.cos(a) * SAT_DIST, -1.2 + idx * 1.1, -Math.sin(a) * SAT_DIST) }
    root.rotation.z = main ? 0.05 : (idx % 2 ? -0.12 : 0.1); root.rotation.x = main ? 0 : 0.08;
    const spin = new THREE.Group(); root.add(spin);           // disk + stars turn together
    const disk = new THREE.Mesh(new THREE.PlaneGeometry(2 * LIMB * s * 1.02, 2 * LIMB * s * 1.02),
      new THREE.MeshBasicMaterial({ map: diskTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: main ? 0.95 : 0.8, color: main ? '#ffffff' : '#d8e2ff', side: THREE.DoubleSide }));
    disk.rotation.x = -Math.PI / 2; disk.rotation.z = hash(node.mac) * 6.28; spin.add(disk);
    const rete = RETE.clone(); rete.scale.setScalar(s); rete.position.y = -0.18 * s; root.add(rete);
    const beacon = BEACON.clone(true); beacon.scale.setScalar(main ? 1.15 : 0.95); beacon.position.y = -0.1; root.add(beacon);
    const lampMesh = beacon.getObjectByName('BeaconLamp'); if (lampMesh) { lampMesh.material = lampMesh.material.clone(); lampMesh.material.emissiveIntensity = 6 }
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: main ? '#ffdca0' : '#ffe8c0', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    core.scale.setScalar(main ? 5.5 : 3.2); core.position.y = 0.55; root.add(core);
    const light = new THREE.PointLight('#ffcf80', main ? 14 : 6, main ? 18 : 9, 1.6); light.position.y = 1.4; root.add(light);
    const lab = label(`<b>${esc(node.name)}</b><span></span>`, 'g3-lab g3-node'); lab.position.y = main ? 2.4 : 1.7; root.add(lab);
    const g = { node, main, s, root, spin, disk, beacon, core, light, lab, stars: new Map(), pulse: 0 };
    if (main) {   // quasar jets: ⇡ upload (top), ⇣ download (bottom)
      // soft beam: bright, narrow at the nucleus, flaring and fading outward; edges feathered by view angle
      const jm = c => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uCol: { value: new THREE.Color(c) }, uOp: { value: 0 }, uT: { value: 0 } },
        vertexShader: `varying float vY; varying float vE; uniform float uT;
          void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.); vec3 n = normalize(normalMatrix * normal);
            vE = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 uCol; uniform float uOp; uniform float uT; varying float vY; varying float vE;
          void main(){ float along = pow(vY, 0.75);                          // uv.y = 1 at the nucleus end
            float knots = 0.75 + 0.25 * sin(vY * 40. - uT * 9.);
            float a = uOp * along * pow(vE, 1.4) * knots; gl_FragColor = vec4(uCol * a * 3.2, a); }` });
      const geo = new THREE.CylinderGeometry(0.22, 0.95, 1, 32, 1, true); geo.translate(0, -0.5, 0);   // top (nucleus) narrow
      g.jetUp = new THREE.Mesh(geo, jm('#ffb36b')); g.jetUp.rotation.x = Math.PI; g.jetUp.position.y = 0.6; root.add(g.jetUp);
      g.jetDn = new THREE.Mesh(geo, jm('#7fb4ff')); g.jetDn.position.y = -0.4; root.add(g.jetDn);
      g.jetLab = label('', 'g3-lab g3-jet'); g.jetLab.position.y = 9; root.add(g.jetLab);
    }
    G.set(node.name, g); return g;
  }

  // backhaul bridges (main ↔ satellites) with flowing motes
  const bridges = [];
  function makeBridge(a, b) {
    const pa = a.root.position.clone().add(new THREE.Vector3(0, 0.3, 0)), pb = b.root.position.clone().add(new THREE.Vector3(0, 0.3, 0));
    const mid = pa.clone().lerp(pb, 0.5).add(new THREE.Vector3(0, 4.5, 0));
    const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.025, 6, false), new THREE.MeshBasicMaterial({ color: '#c9a45c', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(tube); bridges.push({ curve, tube, to: b });
  }

  // ---------- stars
  const halo = new THREE.Group(); scene.add(halo);
  let haloSig = '';
  function starFor(g, d) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ffffff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.userData.dev = d.mac; g.spin.add(sp);
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: '#d14d5a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    sp.add(ring);
    return { sp, ring, d, pos: new THREE.Vector3(), tgt: new THREE.Vector3(), h: hash(d.mac), lab: null, guestOf: null, tw: Math.random() * 6.28 };
  }
  function placeTarget(st, g) {
    const d = st.d, s = g.s, h = st.h, h2 = hash(d.mac + 'y');
    if (d.conn === 'wifi') {
      const r = Math.min(LIMB - 0.4, R_OF(Math.max(-92, Math.min(-28, d.rssi ?? -70)))) * s;
      const rt = r / (LIMB * s);
      const arm = d.band === '5G' ? 0 : Math.PI;                       // two arms: 5 GHz and 2.4 GHz
      const th = arm + 2.6 * Math.log(Math.max(0.08, rt)) + (h - 0.5) * 0.7;
      st.tgt.set(Math.cos(th) * r, (h2 - 0.5) * 0.5 * s, Math.sin(th) * r);
    } else {
      const r = (0.35 + h * 0.8) * s, th = h2 * Math.PI * 2;            // bulge
      st.tgt.set(Math.cos(th) * r, (hash(d.mac + 'z') - 0.5) * 0.6 * s, Math.sin(th) * r);
    }
  }
  const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2(-9, -9);
  let hover = null, lastTs = 0, topSet = new Set();

  function sync() {
    const N = S.net; if (!N || !N.enabled || N.ts === lastTs) return; lastTs = N.ts;
    const nodes = N.nodes || [], sats = nodes.filter(n => !n.main);
    nodes.forEach((n, i) => { if (!G.has(n.name)) makeGalaxy(n, n.main ? 0 : sats.indexOf(n) + 1, sats.length) });
    const mainG = [...G.values()].find(g => g.main);
    if (mainG && !bridges.length) {
      for (const g of G.values()) if (!g.main) makeBridge(mainG, g);
      const box = new THREE.Box3(); for (const g of G.values()) box.expandByPoint(g.root.position.clone().addScalar(LIMB * g.s)).expandByPoint(g.root.position.clone().addScalar(-LIMB * g.s));
      const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
      const fit = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.aspect < 1 ? 1.0 : 0.6);
      controls.target.copy(c).setY(0); camera.position.copy(c).add(new THREE.Vector3(-0.12, 0.42, 0.9).normalize().multiplyScalar(fit));
    }
    const on = (N.devices || []).filter(d => d.online), seen = new Set();
    const prox = on.find(d => (N.hostIp && d.ip === N.hostIp) || /^(proxmox|pve)/i.test(d.name || ''));
    const ranked = on.filter(d => d.conn === 'wifi').sort((a, b) => conns(b) - conns(a)); topSet = new Set(ranked.slice(0, 4).filter(d => conns(d) >= 10).map(d => d.mac));
    if (prox) topSet.add(prox.mac);
    for (const d of on) {
      const g = G.get(d.node) || mainG; if (!g) continue;
      let st = g.stars.get(d.mac);
      if (!st) { for (const o of G.values()) if (o !== g && o.stars.has(d.mac)) { const old = o.stars.get(d.mac); o.spin.remove(old.sp); if (old.lab) old.sp.remove(old.lab); o.stars.delete(d.mac) }   // roamed
        st = starFor(g, d); g.stars.set(d.mac, st); placeTarget(st, g); st.pos.copy(st.tgt).multiplyScalar(1.6) }
      st.d = d; seen.add(d.mac); placeTarget(st, g);
      st.guestOf = d.guest && prox && prox.mac !== d.mac ? prox.mac : null;
      const c = d.conn === 'wired' ? (d.guest ? COL.guest : d === prox ? COL.lab : COL.wired) : d.band === '5G' ? COL.g5 : COL.g24;
      st.sp.material.color.copy(c);
      st.base = (d === prox ? 1.0 : d.guest ? 0.32 : 0.42) + Math.min(1.3, Math.log2(1 + conns(d)) * 0.16);
      st.sp.material.map = conns(d) >= 60 || d === prox ? spike : glow;
      const blk = d.dns && d.dns.q ? (d.dns.b || 0) / d.dns.q : 0; st.ring.material.opacity = blk > 0.15 ? Math.min(0.6, blk) : 0; st.ring.scale.setScalar(2.2);
      const want = topSet.has(d.mac);
      if (want && !st.lab) { st.lab = label('', 'g3-lab g3-star'); st.lab.center.set(0.5, 1.4); st.sp.add(st.lab) }
      if (!want && st.lab) { st.sp.remove(st.lab); st.lab.element.remove(); st.lab = null }
      if (st.lab) st.lab.element.innerHTML = d === prox ? `<b>⚙ ${esc(S.nodeName || 'proxmox')}</b><span>${on.filter(x => x.guest).length} guests</span>` : `<b>${esc(devName(d)).slice(0, 18)}</b>${conns(d) ? `<span>${conns(d)} conns</span>` : ''}`;
      if (st.lab) st.lab.center.set(0.5, d === prox ? -0.6 : 1.4);
    }
    for (const g of G.values()) for (const [m, st] of [...g.stars]) if (!seen.has(m)) { g.spin.remove(st.sp); if (st.lab) st.lab.element.remove(); g.stars.delete(m) }
    // halo of absent friends
    const off = (N.devices || []).filter(d => !d.online), hs = off.map(d => d.mac).join();
    if (hs !== haloSig && mainG) {
      haloSig = hs; halo.clear();
      const p = new Float32Array(off.length * 3);
      off.forEach((d, i) => { const h = hash(d.mac), r = LIMB + 0.9 + hash(d.mac + 'r') * 3, th = h * 6.283; p.set([Math.cos(th) * r, (hash(d.mac + 'y') - 0.5) * 2.2, Math.sin(th) * r], i * 3) });
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const pts = new THREE.Points(gg, new THREE.PointsMaterial({ size: 0.32, color: '#6e6a7c', map: soft, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      pts.userData.off = off; halo.add(pts); halo.position.copy(mainG.root.position);
    }
    for (const g of G.values()) {
      const n = (N.nodes || []).find(x => x.name === g.node.name) || g.node, cnt = g.stars.size;
      g.lab.element.lastChild.textContent = `${g.main ? 'router' : 'node'} · ${cnt} star${cnt === 1 ? '' : 's'}`;
    }
  }

  // ---------- photons: connection activity flies to the core, then out the jet
  const MAXP = 700, pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), parts = [];
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; scene.add(pts);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), cJet = new THREE.Color('#ffd08a'), cBh = new THREE.Color('#e7c27a');

  // ---------- composer
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.8, 0.55, 0.62); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const resize = () => { camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H()); css.setSize(W(), H()); composer.setSize(W(), H()) };
  new ResizeObserver(resize).observe(host);

  renderer.domElement.addEventListener('pointermove', e => { const r = renderer.domElement.getBoundingClientRect(); mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); tip.dataset.x = e.clientX - r.left; tip.dataset.y = e.clientY - r.top });
  renderer.domElement.addEventListener('pointerleave', () => { mouse.set(-9, -9); tip.style.display = 'none' });
  let downAt = 0; renderer.domElement.addEventListener('pointerdown', () => downAt = performance.now());
  renderer.domElement.addEventListener('click', () => {
    if (performance.now() - downAt > 300 || !hover) return;
    const d = hover.d; if (typeof window.netFocus === 'function') window.netFocus(d.ip || d.mac);
  });

  // ---------- frame
  let live = true, raf = 0, last = performance.now(), t = 0;
  function frame(now) {
    if (!live) return; raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    sync();
    if (!controls.autoRotate && performance.now() - idleAt > 20000) controls.autoRotate = true;
    const N = S.net || {}, wan = (N.router || {}).wan || {}, mainG = [...G.values()].find(g => g.main);
    for (const g of G.values()) {
      g.spin.rotation.y += dt * (g.main ? 0.035 : 0.05);
      g.pulse = Math.max(0, g.pulse - dt * 1.5);
      g.core.material.opacity = 0.75 + Math.sin(t * 1.7 + g.s) * 0.08 + g.pulse * 0.4;
      for (const st of g.stars.values()) {
        if (st.guestOf) {   // proxmox guests orbit their host star like moons
          const host = g.stars.get(st.guestOf);
          if (host) { const a = t * (0.6 + st.h * 0.8) + st.h * 6.28, r = 0.45 + st.h * 0.5; st.tgt.copy(host.pos).add(tmp.set(Math.cos(a) * r, Math.sin(a * 1.3) * 0.12, Math.sin(a) * r)) }
        }
        st.pos.lerp(st.tgt, Math.min(1, dt * (st.guestOf ? 6 : 1.2)));
        st.sp.position.copy(st.pos);
        const tw = 1 + Math.sin(t * (2 + st.h * 3) + st.tw) * 0.08, hv = hover === st ? 1.6 : 1;
        st.sp.scale.setScalar(st.base * tw * hv * (g.main ? 1 : 0.85));
        // emit photons in proportion to connection activity
        const rate = conns(st.d) / 300;
        if (rate && Math.random() < Math.min(0.6, rate * dt * 2.2) && parts.length < MAXP) {
          st.sp.getWorldPosition(tmp);
          parts.push({ from: tmp.clone(), g, k: 0, s: 0.5 + Math.random() * 0.4, c: st.sp.material.color.clone(), jet: !!(g.main || mainG), up: Math.random() < 0.55 });
        }
      }
    }
    // jets
    if (mainG && mainG.jetUp) {
      const ju = Math.min(1, Math.log10((wan.up || 0) + 1) / 7.5), jd = Math.min(1, Math.log10((wan.down || 0) + 1) / 7.5);
      const fl = 1 + Math.sin(t * 9) * 0.05;
      mainG.jetUp.scale.set(0.7 + ju * 0.9, 3 + ju * 14 * fl, 0.7 + ju * 0.9); mainG.jetUp.material.uniforms.uOp.value = 0.08 + ju * 0.55; mainG.jetUp.material.uniforms.uT.value = t;
      mainG.jetDn.scale.set(0.7 + jd * 0.9, 3 + jd * 14 * fl, 0.7 + jd * 0.9); mainG.jetDn.material.uniforms.uOp.value = 0.08 + jd * 0.55; mainG.jetDn.material.uniforms.uT.value = t + 1.7;
      mainG.jetLab.position.y = 4.5 + ju * 13;
      const jl = wan.down != null ? `<span>WAN ⇣ ${fmtBps(wan.down)} · ⇡ ${fmtBps(wan.up)}</span>` : '';
      if (mainG.jetLab.element.innerHTML !== jl) mainG.jetLab.element.innerHTML = jl;
      mainG.light.intensity = 12 + jd * 10;
    }
    // bridges: backhaul motes
    for (const b of bridges) if (Math.random() < 0.25 * dt * 10 && parts.length < MAXP) parts.push({ bridge: b, k: 0, s: 0.35 + Math.random() * 0.2, dir: Math.random() < 0.5 ? 1 : -1 });
    // particles → buffer
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.k += p.s * dt; if (p.k >= 1) { if (p.g && p.g !== mainG) p.g.pulse = Math.min(1, p.g.pulse + 0.05); parts.splice(i, 1); continue }
      let c;
      if (p.bridge) { p.bridge.curve.getPoint(p.dir > 0 ? p.k : 1 - p.k, tmp); c = cBh }
      else {
        const target = p.g.root.position;
        if (p.k < 0.6) {                // spiral in to its galaxy's nucleus
          const k = p.k / 0.6, e = k * k;
          tmp.copy(p.from).lerp(tmp2.copy(target).setY(target.y + 0.55), e);
          c = p.c;
        } else {                         // then ride the jet (main) or the backhaul toward the core
          const k = (p.k - 0.6) / 0.4;
          if (p.g.main) tmp.copy(target).add(tmp2.set((Math.random() - 0.5) * 0.15, (p.up ? 1 : -1) * (0.8 + k * 14), (Math.random() - 0.5) * 0.15));
          else { const b = bridges.find(x => x.to === p.g); if (b) b.curve.getPoint(1 - k, tmp); else tmp.copy(target) }
          c = p.g.main ? (p.up ? cJet : COL.g5) : cBh;
        }
      }
      const fade = p.k > 0.9 ? (1 - p.k) * 10 : 1;
      pPos[n * 3] = tmp.x; pPos[n * 3 + 1] = tmp.y; pPos[n * 3 + 2] = tmp.z;
      pCol[n * 3] = c.r * fade; pCol[n * 3 + 1] = c.g * fade; pCol[n * 3 + 2] = c.b * fade; n++;
    }
    pGeo.setDrawRange(0, n); pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    // hover
    raycaster.setFromCamera(mouse, camera);
    const cand = []; for (const g of G.values()) for (const st of g.stars.values()) cand.push(st.sp);
    const hit = mouse.x > -2 ? raycaster.intersectObjects(cand, false)[0] : null;
    hover = null;
    if (hit) for (const g of G.values()) for (const st of g.stars.values()) if (st.sp === hit.object) hover = st;
    if (hover) {
      const d = hover.d;
      tip.innerHTML = `<h4>${esc(devName(d))}</h4><div class="row"><span>${esc(d.ip || '')}</span><b>${d.conn === 'wifi' ? esc(d.band === '2G' ? '2.4' : d.band) + ' GHz' : 'wired'}</b></div>`
        + `<div class="row"><span>node</span><b>${esc(d.node || '')}</b></div>`
        + (d.rssi != null ? `<div class="row"><span>signal</span><b>${d.rssi} dBm</b></div>` : '')
        + `<div class="row"><span>internet conns · 5m</span><b>${conns(d)}</b></div>`
        + (d.dns && d.dns.q ? `<div class="row"><span>dns · blocked</span><b>${d.dns.q.toLocaleString()} · ${((d.dns.b || 0) / d.dns.q * 100).toFixed(1)}%</b></div>` : '')
        + (d.guest ? `<div class="row"><span>proxmox guest</span><b>${esc(d.guest)}</b></div>` : '')
        + `<div class="row"><span>${d.innet ? 'connected' : 'vendor'}</span><b>${d.innet ? fmtUp(d.innet) : esc(d.vendor || '—')}</b></div><div class="hint">click → show in table</div>`;
      tip.style.display = 'block'; tip.style.left = Math.min(W() - 230, +tip.dataset.x + 14) + 'px'; tip.style.top = Math.min(H() - 160, +tip.dataset.y + 12) + 'px';
      renderer.domElement.style.cursor = 'pointer';
    } else { tip.style.display = 'none'; renderer.domElement.style.cursor = '' }
    controls.update();
    composer.render(); css.render(scene, camera);
  }
  status('');
  raf = requestAnimationFrame(frame);
  return {
    pause() { if (live) { live = false; cancelAnimationFrame(raf); tip.style.display = 'none' } },
    resume() { if (!live) { live = true; last = performance.now(); raf = requestAnimationFrame(frame) } },
    get stats() { let s = 0; for (const g of G.values()) s += g.stars.size; return { galaxies: G.size, stars: s, parts: parts.length, calls: renderer.info.render.calls } },
  };
}
