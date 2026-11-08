// ORRERY · 3D — the Blender-built instrument, driven by live Proxmox + Plex state.
// Reads the classic-script globals from index.html (S, guests, plexSessions, heat, C, fmt*, esc, openDrawer, go).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { makeTraits } from './traits3d.js';
import { bodyFor } from './bodies3d.js';

// layout contract with blender/build_orrery.py
const RADII3 = [3.6, 6.2, 8.8], RADII2 = [4.6, 8.2], ARM_Y = [-0.9, -1.35, -1.8];
// prominence tiers — active: things you watch happen; watch: sentinels, small until they need you; hidden: never drawn; rest: quiet
const TIER = { active: /^(homeassistant|pihole|npm|netviz|seerr|audiobookshelf|romm)$/i, watch: /^(uptime-kuma|pbs|netdata)$/i, hidden: /^(guacamole|orrery|orrery-build|isponsorblocktv)$/i };
const tierOf = g => (globalThis.__orreryTiers && g.name in globalThis.__orreryTiers) ? globalThis.__orreryTiers[g.name] : TIER.hidden.test(g.name) ? 'hidden' : TIER.active.test(g.name) ? 'active' : TIER.watch.test(g.name) ? 'watch' : 'quiet';
function alarmOf(g, run) {                       // a reason string when a non-active guest needs attention, else ''
  if (!run) return 'stopped';
  const n = ({ uptimekuma: 'uptime-kuma', pbs: 'pbs', netdata: 'netdata' })[(globalThis.__orreryTpl || {})[g.name]] || g.name.toLowerCase(), Tr = S.traits || {}, V = Tr.svc || {};
  if (n === 'uptime-kuma') { const d = (S.fx || {}).kumaDown || 0; return d ? d + ' down' : '' }
  if (n === 'pbs') { const B = Tr.backup; return B && (B.failed || []).length ? 'backup failed' : '' }
  if (n === 'netdata') { const c = ((V.netdata || {}).alarms || []).filter(a => a.status === 'CRITICAL').length; return c ? c + ' critical' : '' }
  return '';
}
const busyOf = g => ((globalThis.__orreryTpl || {})[g.name] || g.name.toLowerCase()) === 'pbs' && !!((S.traits || {}).backup || {}).running;
const SUN_R = 1.25, PLEX_POS = new THREE.Vector3(19.5, 1.2, -6);
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const meshOf = o => { let m = null; o && o.traverse(x => { if (!m && x.isMesh) m = x }); return m };
function label(html, cls = 'o3-lab') { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return new CSS2DObject(d) }

export async function start(host, status = () => {}) {
  const W = () => Math.max(1, host.clientWidth), H = () => Math.max(1, host.clientHeight);
  // ---------- renderer / scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
  host.appendChild(renderer.domElement);
  const css = new CSS2DRenderer(); css.setSize(W(), H()); css.domElement.className = 'o3-labels'; host.appendChild(css.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#06080c');
  scene.fog = new THREE.FogExp2('#06080c', 0.0065);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.38;

  const camera = new THREE.PerspectiveCamera(36, W() / H(), 0.1, 500);
  camera.position.set(10, 15, 35);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(6.2, -1, -0.8); controls.enableDamping = true; controls.dampingFactor = 0.06;
  controls.minDistance = 8; controls.maxDistance = 80; controls.maxPolarAngle = 1.5;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.3;
  let idleAt = 0;
  controls.addEventListener('start', () => { controls.autoRotate = false; idleAt = performance.now() });
  controls.addEventListener('end', () => { idleAt = performance.now() });

  scene.add(new THREE.HemisphereLight('#d8c39a', '#07080b', 0.35));
  const key = new THREE.DirectionalLight('#ffe2b0', 1.7); key.position.set(-14, 24, 12); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 80 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; scene.add(key);
  const rim = new THREE.DirectionalLight('#8fb7ff', 0.9); rim.position.set(18, 6, -20); scene.add(rim);
  const sunLight = new THREE.PointLight('#ffcf80', 12, 30, 1.8); scene.add(sunLight);

  { // stars
    const n = 2200, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 150 + Math.random() * 80, s = Math.sqrt(1 - u * u); p.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3) }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#e8dcc0', size: 0.8, transparent: true, opacity: 0.7, depthWrite: false, fog: false })));
  }

  // ---------- the instrument (Blender)
  status('assembling the instrument…');
  const gltf = await new GLTFLoader().loadAsync('/orrery.glb');
  const tl = new THREE.TextureLoader();
  const ao = async f => { try { const t = await tl.loadAsync(f); t.flipY = false; t.colorSpace = THREE.NoColorSpace; return t } catch (e) { return null } };
  const [aoBase, aoScale] = await Promise.all([ao('/ao_base.jpg'), ao('/ao_scale.jpg')]);
  const root = gltf.scene; scene.add(root);
  const N = n => root.getObjectByName(n);
  root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true } });
  const withAO = (o, t) => o && t && o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.aoMap = t; m.material.aoMapIntensity = 1 } });
  withAO(N('Base'), aoBase); withAO(N('Scale'), aoScale);
  const gears = ['Gear0', 'Gear1', 'Gear2', 'Gear3'].map(N).filter(Boolean);
  const scaleRing = N('Scale');
  const T = { vm: meshOf(N('TplVM')), lxc: meshOf(N('TplLXC')), giant: meshOf(N('PlexWorld')) || meshOf(N('PlexGiant')), ring: meshOf(N('PlexRing')) };
  ['TplVM', 'TplLXC', 'PlexGiant', 'PlexWorld', 'PlexRing'].forEach(n => N(n) && (N(n).visible = false));
  const isWorld = !!N('PlexWorld');
  const brass = (meshOf(N('Arbors')) || T.lxc).material;
  const brassArm = new THREE.MeshStandardMaterial({ color: '#d4a45a', metalness: 1, roughness: 0.3 });
  const iron = new THREE.MeshStandardMaterial({ color: '#2a2a2c', metalness: 0.7, roughness: 0.75 });
  const glowTex = glowTexture();

  // ---------- the sun (host)
  // living photosphere: granulation churns faster, sunspots open and the star swells/reddens as the CPU heats.
  // uHeat 0 = cold (≈35 °C, pale calm white-gold) … 1 = critical (≈90 °C, swollen pulsing red giant)
  const sunU = { uT: { value: 0 }, uHeat: { value: 0 }, uLoad: { value: 0 }, uCol: { value: new THREE.Color('#ffd27a') }, uPulse: { value: 0 } };
  const sunMat = new THREE.ShaderMaterial({
    uniforms: sunU,
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){ vP=position; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uT,uHeat,uLoad,uPulse; uniform vec3 uCol; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      vec3 h3(vec3 p){ p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453)*2.-1.; }
      float n3(vec3 p){ vec3 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
        return mix(mix(mix(dot(h3(i),f),dot(h3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),mix(dot(h3(i+vec3(0,1,0)),f-vec3(0,1,0)),dot(h3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
                   mix(mix(dot(h3(i+vec3(0,0,1)),f-vec3(0,0,1)),dot(h3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),mix(dot(h3(i+vec3(0,1,1)),f-vec3(0,1,1)),dot(h3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z); }
      // cellular-ish granulation: 1 - |noise| ridges
      float gran(vec3 p,float s){ float a=0.,w=.5; for(int i=0;i<4;i++){ a+=w*(1.-abs(n3(p+vec3(0,s,s*.7)))); p*=2.07; w*=.5; s*=1.3; } return a; }
      void main(){
        vec3 p=normalize(vP);
        float spd=.05+uHeat*.35+uLoad*.15;
        float g=gran(p*3.4,uT*spd);
        float fine=n3(p*14.+uT*spd*2.);
        // sunspots: large slow noise below threshold, only once warm
        float sp=n3(p*2.3+vec3(uT*.01));
        float spot=smoothstep(.62-uHeat*.5,.70-uHeat*.5,-sp)*smoothstep(.35,.6,uHeat);
        float mu=max(dot(vN,vV),0.);
        float limb=pow(mu,.45+uHeat*.35);                    // limb darkening — stronger on a red giant
        vec3 hot=mix(uCol,vec3(1.,.97,.9),.28-uHeat*.24);    // bright granule cores whiten
        vec3 cool=uCol*vec3(.85,.55,.35);                     // dark lanes
        vec3 c=mix(cool,hot,smoothstep(.45,1.05,g)+fine*.12);
        c=mix(c,uCol*vec3(.25,.08,.03),spot*.9);
        float lum=(.62+uLoad*1.1+uHeat*.25+uPulse*.9)*limb;
        c*=lum;
        c+=uCol*pow(1.-mu,3.)*(.35+uHeat*1.2);                 // hot rim
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 96, 48), sunMat); scene.add(sun);
  // blackbody-ish ramp, °C → star colour
  const HEAT_STOPS = [[35, '#fff1d0'], [50, '#ffd27a'], [65, '#ffa040'], [78, '#ff642a'], [90, '#ff2416']].map(([c, h]) => [c, new THREE.Color(h)]);
  const heatColor = (tc, out) => {
    if (tc <= HEAT_STOPS[0][0]) return out.copy(HEAT_STOPS[0][1]);
    for (let i = 1; i < HEAT_STOPS.length; i++) if (tc <= HEAT_STOPS[i][0]) { const [a, ca] = HEAT_STOPS[i - 1], [b, cb] = HEAT_STOPS[i]; return out.copy(ca).lerp(cb, (tc - a) / (b - a)) }
    return out.copy(HEAT_STOPS[HEAT_STOPS.length - 1][1]);
  };
  // prominences: glowing loops that erupt off the limb once the star runs warm
  const proms = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.32 + (i % 3) * 0.1, 0.022, 6, 40, Math.PI),
      new THREE.MeshBasicMaterial({ color: '#ff7a3a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const pv = new THREE.Group(); pv.add(m); m.position.y = SUN_R * 0.92;
    pv.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 0); m.rotation.y = Math.random() * Math.PI;
    pv.userData = { ph: Math.random(), sp: 0.07 + Math.random() * 0.08, slot: i }; scene.add(pv); proms.push(pv);
  }
  let heatS = -1, pulseT = 0; const sunCol = new THREE.Color('#ffd27a');
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr('#ffcf80', 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  corona.scale.setScalar(5); scene.add(corona);
  const sunLab = label('<b class="o3-big">—</b><span>CPU</span>', 'o3-lab o3-sun'); sunLab.position.set(0, SUN_R + 1.7, 0); scene.add(sunLab);
  const threads = new THREE.Group(); scene.add(threads);
  const tickGeo = new THREE.BoxGeometry(0.34, 0.08, 0.1);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, m = new THREE.Mesh(tickGeo, new THREE.MeshBasicMaterial({ color: '#4a3a1c' }));
    m.position.set(Math.cos(a) * 1.78, 0, Math.sin(a) * 1.78); m.rotation.y = -a; threads.add(m);
  }
  const arc = (r, tube, c) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 96, 0.001), new THREE.MeshBasicMaterial({ color: c })); m.rotation.x = -Math.PI / 2; scene.add(m); return m };
  const trackMem = arc(2.15, 0.02, '#3a3020'), trackSwap = arc(2.38, 0.016, '#3a2018');
  trackMem.geometry = new THREE.TorusGeometry(2.15, 0.02, 6, 96); trackSwap.geometry = new THREE.TorusGeometry(2.38, 0.016, 6, 96);
  const memArc = arc(2.15, 0.05, hdr('#c9a45c', 1.6)), swapArc = arc(2.38, 0.04, hdr('#e0663b', 1.8));
  let memF = -1, swapF = -1;

  // ---------- orbit tracks (faint, data-sized)
  const tracks = new THREE.Group(); scene.add(tracks);

  // ---------- guests
  const world = new THREE.Group(); scene.add(world);
  const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 10), postGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8), knob = new THREE.SphereGeometry(0.09, 12, 8);
  let E = new Map(), sig = '';
  globalThis.__orreryRebuild = () => { sig = '' };   // setup.js calls this when bindings change
  const pick = [];
  function rebuild() {
    E.forEach(e => { world.remove(e.pivot); e.lab.element.remove(); const i = pick.indexOf(e.planet); if (i >= 0) pick.splice(i, 1) }); E = new Map();   // keep the media giant + moons pickable
    tracks.clear();
    const gs = guests().filter(g => tierOf(g) !== 'hidden').sort((a, b) => a.vmid - b.vmid);
    const vms = gs.filter(g => g.type === 'qemu'), lx = gs.filter(g => g.type === 'lxc');
    const rings = [vms, lx.filter(g => tierOf(g) === 'active'), lx.filter(g => tierOf(g) !== 'active')];
    const radii = RADII3;
    const maxMem = Math.max(1, ...gs.map(g => g.maxmem || 1));
    rings.forEach((ring, ri) => {
      const r = radii[ri], y = ARM_Y[ri];
      const tr = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 4, 160), new THREE.MeshBasicMaterial({ color: ri === 0 ? hdr('#5fb3a1', 0.5) : hdr('#c9a45c', 0.45), transparent: true, opacity: ri === 2 ? 0.25 : 0.6 }));
      tr.rotation.x = -Math.PI / 2; tracks.add(tr);
      ring.forEach((g, i) => {
        const tier = tierOf(g), mf = Math.sqrt((g.maxmem || 0) / maxMem);
        const size = tier === 'active' ? 0.55 + 0.4 * mf : 0.24 + 0.14 * mf;
        const pivot = new THREE.Group(); world.add(pivot);
        const arm = new THREE.Mesh(armGeo, brassArm); const L = r - 0.44;
        arm.scale.set(1, L, 1); arm.rotation.z = Math.PI / 2; arm.position.set(0.44 + L / 2, y, 0); arm.castShadow = true;
        const elbow = new THREE.Mesh(knob, brassArm); elbow.position.set(r, y, 0);
        const post = new THREE.Mesh(postGeo, brassArm); const pl = -size * 0.9 - y; post.scale.set(1, pl, 1); post.position.set(r, y + pl / 2, 0);
        const tpl = g.type === 'qemu' ? T.vm : T.lxc;
        const mat = tpl.material.clone();
        const planet = new THREE.Mesh(tpl.geometry, mat); planet.scale.setScalar(size); planet.position.set(r, 0, 0);
        planet.castShadow = true; planet.receiveShadow = true; planet.userData.gid = g.id;
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#5fb3a1', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.38 }));
        halo.position.copy(planet.position);
        const mem = new THREE.Mesh(new THREE.TorusGeometry(size * 1.45, 0.03, 6, 64, 0.01), new THREE.MeshBasicMaterial({ color: hdr('#c9a45c', 1.5) }));
        mem.rotation.x = -Math.PI / 2; mem.position.copy(planet.position);
        const memBg = new THREE.Mesh(new THREE.TorusGeometry(size * 1.45, 0.018, 4, 64), new THREE.MeshBasicMaterial({ color: '#2a2418' }));
        memBg.rotation.x = -Math.PI / 2; memBg.position.copy(planet.position);
        const sel = new THREE.Mesh(new THREE.TorusGeometry(size * 1.85, 0.025, 6, 64), new THREE.MeshBasicMaterial({ color: hdr('#f0d08a', 2.2) }));
        sel.rotation.x = -Math.PI / 2; sel.position.copy(planet.position); sel.visible = false;
        const lab = label('', 'o3-lab g' + (tier === 'active' ? ' big' : '')); lab.position.set(r, size + 0.55, 0);
        const B = bodyFor(g.name);
        if (B) { B.group.scale.setScalar(size); B.group.position.copy(planet.position); B.group.traverse(o => { if (o.isMesh) o.userData.gid = g.id }); planet.visible = false }
        pivot.add(arm, elbow, post, planet, halo, mem, memBg, sel, lab); if (B) pivot.add(B.group);
        const e = { g, pivot, planet, mat, baseMat: B ? B.main : mat, body: B, bodyCol: B ? B.main.color.clone() : null, halo, mem, sel, lab, size, r, tier, k: -1, phase: (i / ring.length) * Math.PI * 2 + ri * 0.7,
          speed: (ri % 2 ? -1 : 1) * 0.018 / (1 + ri * 0.45), angle: 0, mf: -1, st: '', wp: new THREE.Vector3() };
        E.set(g.id, e); pick.push(planet);
      });
    });
  }

  // ---------- particles (guest traffic, tether packets, broadcast sparks)
  const PMAX = 3000, pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.16, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; scene.add(pts);
  const parts = [];
  const cIn = hdr('#5fb3a1', 2.4), cOut = hdr('#e0663b', 2.4), cAme = hdr('#9d86d6', 2.6);

  // ---------- the far planet (Plex over Tailscale)
  const plexG = new THREE.Group(); plexG.position.copy(PLEX_POS); scene.add(plexG);
  const tilt = new THREE.Group(); tilt.rotation.set(0.38, 0, -0.22); plexG.add(tilt);
  const giantMat = T.giant.material.clone(), giantBase = giantMat.color.clone();
  const giant = new THREE.Mesh(T.giant.geometry, giantMat); giant.scale.setScalar(1.35); giant.castShadow = true; tilt.add(giant);
  giant.userData.plex = true;

  // ---------- The media server as an inhabited world — D: usage = how much of it is colonised
  const wTex = async f => { try { const t = await tl.loadAsync(f); t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; return t } catch (e) { return null } };
  const [wData, wCities, wClouds] = isWorld ? await Promise.all([wTex('/world_data.png'), wTex('/world_cities.png'), wTex('/world_clouds.png')]) : [null, null, null];
  const WU = { uCities: { value: wCities }, uColonized: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uBuild: { value: 0 }, uAlarm: { value: 0 } };
  if (wCities) {
    if (wData) { giantMat.bumpMap = wData; giantMat.bumpScale = 4; giantMat.roughnessMap = wData; giantMat.roughness = 1 }
    giantMat.metalness = 0;
    giantMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, WU);
      sh.fragmentShader = 'uniform sampler2D uCities; uniform float uColonized, uTime, uBuild, uAlarm; uniform vec3 uSunDir;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 cty = texture2D(uCities, vMapUv);
          float settled = cty.r * step(cty.g, uColonized);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.78, 0.62), settled * 0.5);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float night = smoothstep(0.25, -0.35, dot(normal, uSunDir));
          float front = cty.r * (1.0 - smoothstep(0.0, 0.03, abs(cty.g - uColonized)));
          vec3 lightsCol = mix(vec3(1.0, 0.66, 0.3), vec3(1.0, 0.28, 0.22), uAlarm);
          totalEmissiveRadiance += lightsCol * settled * (0.25 + 5.5 * night);
          totalEmissiveRadiance += vec3(0.45, 1.0, 0.9) * front * (0.35 + 3.5 * uBuild) * (0.65 + 0.35 * sin(uTime * 4.0 + cty.g * 400.0));`)
        .replace('#include <opaque_fragment>', `outgoingLight = (outgoingLight - totalEmissiveRadiance) * mix(1.0, 0.16, night) + totalEmissiveRadiance;
          #include <opaque_fragment>`);
    };
    giantMat.needsUpdate = true;
  }
  let clouds = null;
  if (wClouds) {
    clouds = new THREE.Mesh(T.giant.geometry, new THREE.MeshStandardMaterial({ color: '#f4f1ea', alphaMap: wClouds, transparent: true, depthWrite: false, roughness: 1, metalness: 0, opacity: 0.5 }));
    clouds.scale.setScalar(1.025); giant.add(clouds);
  }
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#7fd6c8') }, uI: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uI; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); gl_FragColor = vec4(uColor * f * uI, f); }' });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), atmoMat); atmo.scale.setScalar(1.35 * 1.1); atmo.visible = !!wCities; tilt.add(atmo);
  const cAtmo = new THREE.Color('#7fd6c8'), cAlarm = new THREE.Color('#d14d5a');
  let colTarget = 0, buildS = 0, alarmS = 0;
  const ringMat = T.ring.material.clone(); ringMat.side = THREE.DoubleSide; ringMat.transparent = true; ringMat.depthWrite = false;
  const pring = new THREE.Mesh(T.ring.geometry, ringMat); pring.scale.setScalar(1.35); tilt.add(pring);
  const plexHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr('#9d86d6', 0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  plexHalo.scale.setScalar(7); plexG.add(plexHalo);
  const plexLab = label(''); plexLab.position.set(0, -2.8, 0); plexG.add(plexLab);
  const dirP = PLEX_POS.clone().normalize();
  const tStart = dirP.clone().multiplyScalar(SUN_R + 0.9), tEnd = PLEX_POS.clone().sub(dirP.clone().multiplyScalar(2.2));
  const tCtrl = tStart.clone().add(tEnd).multiplyScalar(0.5).add(new THREE.Vector3(0, 6, 0));
  const tether = new THREE.QuadraticBezierCurve3(tStart, tCtrl, tEnd);
  const tetherMat = new THREE.MeshBasicMaterial({ color: hdr('#9d86d6', 1.3), transparent: true, opacity: 0.5, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(tether, 96, 0.028, 6), tetherMat));
  const tLab = label('', 'o3-lab o3-tether'); tLab.position.copy(tether.getPoint(0.5)).add(new THREE.Vector3(0, 0.7, 0)); scene.add(tLab);
  pick.push(giant);
  // generous invisible hit shell so the whole world (clouds, rings) answers hover, not just the core mesh
  const plexHit = new THREE.Mesh(new THREE.SphereGeometry(2.1, 24, 16), new THREE.MeshBasicMaterial({ visible: false }));
  plexHit.userData.plex = true; plexG.add(plexHit); pick.push(plexHit);

  // ---------- stream moons: Blender-cratered moons carrying brass-framed poster placards
  const moons = new THREE.Group(); plexG.add(moons);
  T.moon = meshOf(N('TplMoon')) || T.lxc; if (N('TplMoon')) N('TplMoon').visible = false;
  const DEC = { tx: '#e0663b', ds: '#c9a45c', dp: '#5fb3a1' };
  const frameMat = new THREE.SpriteMaterial({ color: hdr('#c9a45c', 1.15), depthWrite: false });
  const posters = new Map();
  const poster = p => { if (!p) return null; if (!posters.has(p)) { const t = tl.load(imgUrl(p, 220, 330)); t.colorSpace = THREE.SRGBColorSpace; posters.set(p, t) } return posters.get(p) };
  const TRAIL = 56;
  function trailLine(color) {
    const pos = new Float32Array(TRAIL * 3), col = new Float32Array(TRAIL * 3), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    l.frustumCulled = false; l.userData = { pos, col, hist: [], color: new THREE.Color(color) }; return l;
  }
  function pushTrail(l, p, k = 1) {
    const u = l.userData; u.hist.unshift(p.clone()); if (u.hist.length > TRAIL) u.hist.pop();
    u.hist.forEach((h, i) => { const f = (1 - i / TRAIL) ** 1.6 * k; u.pos.set([h.x, h.y, h.z], i * 3); u.col.set([u.color.r * f, u.color.g * f, u.color.b * f], i * 3) });
    l.geometry.setDrawRange(0, u.hist.length); l.geometry.attributes.position.needsUpdate = true; l.geometry.attributes.color.needsUpdate = true;
  }
  function dropLabels(group) { group.traverse(o => { if (o.isCSS2DObject) o.element.remove() }) }
  let moonSig = '';
  function buildMoons(ss) {
    dropLabels(moons); moons.children.forEach(m => { const i = pick.indexOf(m.userData.body); if (i >= 0) pick.splice(i, 1) }); moons.clear();
    ss.forEach((x, i) => {
      const c = DEC[x.dec], g = new THREE.Group();
      const mat = T.moon.material.clone(); mat.emissive = new THREE.Color(c); mat.emissiveIntensity = 0.12;
      const body = new THREE.Mesh(T.moon.geometry, mat); body.scale.setScalar(0.42); body.castShadow = true; body.userData.stream = x.key;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(c, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
      halo.scale.setScalar(2.1);
      const ringBg = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.012, 4, 64), new THREE.MeshBasicMaterial({ color: '#2a2418' })); ringBg.rotation.x = -Math.PI / 2;
      const prog = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.03, 6, 64, 0.01), new THREE.MeshBasicMaterial({ color: hdr(c, 2.2) })); prog.rotation.x = -Math.PI / 2;
      g.add(body, halo, ringBg, prog);
      const tex = poster(x.thumb);
      let card = null;
      if (tex) {
        const fr = new THREE.Sprite(frameMat); fr.center.set(0.5, 0); fr.scale.set(1.08, 1.56, 1); fr.position.y = 0.62; fr.renderOrder = 5;
        card = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true })); card.center.set(0.5, 0); card.scale.set(0.96, 1.44, 1); card.position.y = 0.68; card.renderOrder = 6;
        g.add(fr, card);
      }
      const lab = label(''); lab.position.set(0, -0.8, 0); g.add(lab);
      const trail = trailLine(hdr(c, 1.6)); moons.add(trail);
      g.userData = { key: x.key, i, n: ss.length, a: i / ss.length * Math.PI * 2, body, halo, prog, pf: -1, card, lab, trail };
      moons.add(g); pick.push(body);
    });
  }

  // ---------- planetary characteristics (Pi-hole, NetViz, Audiobookshelf, RomM, PBS)
  const hotId = () => (hover && hover.userData.gid) || (S.selected && S.selected.id) || null;
  const traits = makeTraits({ scene, entries: () => E, glowTex, label, hdr, tl, T, camera, pick, hotId });

  // ---------- acquisitions (qBittorrent): downloads = accretion vortex + spiralling comets, uploads = polar jets
  const diskTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); x.translate(256, 256);
    const g = x.createRadialGradient(0, 0, 50, 0, 0, 256); g.addColorStop(0, 'rgba(255,255,255,.4)'); g.addColorStop(.3, 'rgba(255,255,255,.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, 256, 0, 7); x.fill();
    for (let k = 0; k < 4; k++) for (let i = 0; i < 260; i++) {
      const t = i / 260, r = 52 + t * 200, a = k * Math.PI / 2 + t * 5.2;
      x.fillStyle = `rgba(255,255,255,${(1 - t) * 0.07})`; x.beginPath(); x.arc(r * Math.cos(a), r * Math.sin(a), 2 + t * 9, 0, 7); x.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const disk = new THREE.Mesh(new THREE.RingGeometry(2.2, 7.8, 128, 1), new THREE.MeshBasicMaterial({ map: diskTex, color: hdr('#5fb3a1', 1.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  disk.rotation.x = -Math.PI / 2; tilt.add(disk);
  const jetTex = (() => { const c = document.createElement('canvas'); c.width = 8; c.height = 256; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.4, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 8, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t })();
  const jetGeo = new THREE.ConeGeometry(0.55, 1, 32, 1, true); jetGeo.translate(0, -0.5, 0);
  const jetMat = new THREE.MeshBasicMaterial({ map: jetTex, color: hdr('#e0663b', 2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const jetN = new THREE.Mesh(jetGeo, jetMat); jetN.rotation.x = Math.PI; jetN.position.y = 1.25;
  const jetS = new THREE.Mesh(jetGeo, jetMat); jetS.position.y = -1.25;
  tilt.add(jetN, jetS);
  const comets = new THREE.Group(); tilt.add(comets);
  let cometSig = '', acqSeen = 0;
  const shocks = [];
  const cVort = hdr('#5fb3a1', 2.6), cVortHot = hdr('#e8fff8', 3), cJet = hdr('#e0663b', 2.6), cJetHot = hdr('#f0d08a', 3.2), cShock = hdr('#f0d08a', 3);
  const giantGlow = new THREE.Color('#f0d08a');
  function buildComets(list) {
    dropLabels(comets); comets.clear();
    list.forEach((q, i) => {
      const g = new THREE.Group();
      const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr('#5fb3a1', 2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      head.scale.setScalar(0.9);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: hdr('#e8fff8', 3) }));
      const lab = label('', 'o3-lab o3-comet'); lab.position.set(0, 0.45, 0);
      g.add(head, core, lab);
      const trail = trailLine(hdr('#5fb3a1', 1.4)); comets.add(trail);
      g.userData = { hash: q.hash, a: i / Math.max(1, list.length) * Math.PI * 2 + 0.6, r: 2.6 + (1 - (q.progress || 0)) * 5.4, head, lab, trail };
      comets.add(g);
    });
  }
  function shock(name) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 128), new THREE.MeshBasicMaterial({ color: cShock.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; tilt.add(m);
    const lab = label(`<b>ACQUIRED</b><span>${esc(name).slice(0, 44)}</span>`, 'o3-lab o3-acq'); lab.position.set(0, 2.4, 0); plexG.add(lab);
    shocks.push({ m, lab, t: 0 });
    for (let i = 0; i < 160; i++) { const a = Math.random() * Math.PI * 2; parts.push({ kind: 'b', a, v: 4 + Math.random() * 6, y: (Math.random() - .5) * 1.2, k: 0, s: 0.008 + Math.random() * 0.01 }) }
  }

  // ---------- interaction
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), tip = document.getElementById('tip');
  let hover = null, downAt = null;
  function plexExtra(P) {
    try {
      const row = (a, b, st = '') => `<div class="row"><span${st ? ` style="${st}"` : ''}>${a}</span><b>${b}</b></div>`, ago = t => { const s = Date.now() / 1000 - t; return s < 3600 ? Math.round(s / 60) + 'm' : s < 172800 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd' };
      const sh = (x, n) => { x = String(x || ''); return x.length > n ? x.slice(0, n - 1) + '…' : x };
      const L = Array.isArray(P.libraries) ? P.libraries : [], mv = L.filter(l => l.type === 'movie'), tv = L.filter(l => l.type === 'show'), sum = (a, k) => a.reduce((n, l) => n + (l[k] || 0), 0);
      let h = '';
      if (L.length) h += row('library', `${sum(mv, 'count').toLocaleString()} movies · ${sum(tv, 'count').toLocaleString()} shows · ${sum(tv, 'episodes').toLocaleString()} eps`);
      const M = (P.world || {}).machine; if (M && M.uptime) h += row('machine up', fmtUp(M.uptime));
      const acc = {}; (((P.accounts || {}).Account) || []).forEach(a => acc[a.id] = a.name);
      const H = ((P.history || {}).Metadata) || [];
      if (H.length) {
        const wk = H.filter(x => Date.now() / 1000 - x.viewedAt < 7 * 86400), who = new Set(wk.map(x => x.accountID));
        h += row('<i>recently watched</i>', (P.history.totalSize ? P.history.totalSize.toLocaleString() + ' plays all-time' : ''), 'color:var(--brass)');
        const seen = new Set(); let n = 0;
        for (const x of H) { const k = x.accountID + '|' + (x.grandparentTitle || x.title); if (seen.has(k)) continue; seen.add(k);
          h += row(`${esc(sh(acc[x.accountID] || 'viewer', 11))} · ${ago(x.viewedAt)}`, esc(sh(x.grandparentTitle ? `${x.grandparentTitle} S${x.parentIndex}E${x.index}` : x.title, 30))); if (++n >= 5) break }
      }
      const R = ((P.recent || {}).Metadata) || [];
      if (R.length) {
        h += row('<i>recently added</i>', '', 'color:var(--brass)');
        h += R.slice(0, 4).map(x => row(ago(x.addedAt) + ' ago', esc(sh(x.type === 'season' ? `${x.parentTitle} · ${x.title}` : `${x.title}${x.year ? ' (' + x.year + ')' : ''}`, 30)))).join('');
      }
      return h;
    } catch (e) { console.warn('plex tip', e); return '' }
  }
  function tipFor(obj, ev) {
    if (!obj) { tip.style.display = 'none'; renderer.domElement.style.cursor = 'grab'; return }
    renderer.domElement.style.cursor = 'pointer';
    if (obj.userData.stream !== undefined) {
      const x = plexSessions().find(s => s.key === obj.userData.stream); if (!x) return;
      tip.innerHTML = `<h4>${esc(x.title)}</h4><div class="row"><span>${esc(x.sub || '')}</span><b></b></div>
        <div class="row"><span>viewer</span><b>${esc(x.user)}</b></div><div class="row"><span>device</span><b>${esc(x.device)} · ${x.local ? 'LAN' : 'WAN'}</b></div>
        <div class="row"><span>mode</span><b style="color:${x.dec === 'tx' ? C.ember : x.dec === 'ds' ? C.brass : C.verd}">${x.dec === 'tx' ? 'transcode' : x.dec === 'ds' ? 'direct stream' : 'direct play'}</b></div>
        <div class="row"><span>progress</span><b>${fmtMs(x.off)} / ${fmtMs(x.dur)}</b></div><div class="row"><span>measured</span><b>${fmtBps(x.act)}</b></div>`;
    } else if (obj.userData.plex) {
      const P = S.plex || {}, ss = plexSessions(), ok = P.enabled && !(P.identity || {}).__error;
      tip.innerHTML = `<h4>${esc(P.host || 'plex')}</h4><div class="row"><span>${esc(P.addr || '')}</span><b class="${ok ? 'ok' : 'bad'}">${ok ? 'reachable' : 'unreachable'}</b></div>
        <div class="row"><span>tailnet latency</span><b>${ok ? (P.identity.__ms || 0).toFixed(0) + ' ms' : '—'}</b></div>
        <div class="row"><span>streams</span><b>${ss.length}${ss.length ? ' · ' + ss.filter(s => s.dec === 'tx').length + ' transcoding' : ''}</b></div>
        <div class="row"><span>outbound · 30s avg</span><b>${fmtBps(plexOut())}</b></div>
        ${(() => { const Q = P.qbit; if (!Q || !Q.enabled) return ''; if (Q.__error) return `<div class="row"><span>qbittorrent</span><b class="bad">${esc(Q.__error).slice(0, 40)}</b></div>`;
          return `<div class="row"><span>qbittorrent ⇣ / ⇡</span><b>${fmtR(Q.dl_speed)} · ${fmtR(Q.up_speed)}</b></div><div class="row"><span>downloading · active</span><b>${Q.n_downloading} · ${Q.n_active}</b></div>` })()}
        ${(() => { const W = P.world; if (!W || !W.enabled || W.__error || !W.d) return ''; const tot = W.d.used + W.d.avail, gib = v => v >= 1024 ? (v / 1024).toFixed(2) + ' TiB' : v.toFixed(0) + ' GiB';
          return `<div class="row"><span>colonised (D:)</span><b>${(W.d.used / tot * 100).toFixed(1)}% · ${gib(W.d.avail)} wild</b></div>`
            + (W.c ? `<div class="row"><span>C: system</span><b>${gib(W.c.used)} / ${gib(W.c.used + W.c.avail)}</b></div>` : '')
            + `<div class="row"><span>cpu · ram</span><b>${(W.cpu || 0).toFixed(0)}% · ${W.ram_used ? (W.ram_used / (W.ram_used + W.ram_free) * 100).toFixed(0) : '—'}%</b></div>`
            + `<div class="row"><span>disk writes</span><b>${fmtR((W.io_write || 0) * 1024)}</b></div>` })()}
        ${ss.slice(0, 4).map(s => `<div class="row"><span style="color:${s.dec === 'tx' ? C.ember : C.verd}">▶ ${esc(s.user)}</span><b>${esc(s.title).slice(0, 26)}</b></div>`).join('')}
        ${plexExtra(P)}
        <div class="row"><span style="color:var(--faint)">click to open broadcast</span></div>`;
    } else {
      const g = guests().find(x => x.id === obj.userData.gid); if (!g) return;
      const rt = S.rates[g.id] || {};
      tip.innerHTML = `<h4>${esc(g.name)}</h4><div class="row"><span>${g.type === 'qemu' ? 'VM' : 'LXC'} ${g.vmid}</span><b class="${g.status === 'running' ? 'ok' : 'bad'}">${g.status}</b></div>
        <div class="row"><span>cpu</span><b>${fmtP((g.cpu || 0) * 100)} of ${g.maxcpu}</b></div>
        <div class="row"><span>memory</span><b>${fmtB(g.mem)} / ${fmtB(g.maxmem)}</b></div>
        <div class="row"><span>net ↓ ↑</span><b>${fmtR(rt.netin)} · ${fmtR(rt.netout)}</b></div>
        <div class="row"><span>disk r w</span><b>${fmtR(rt.diskread)} · ${fmtR(rt.diskwrite)}</b></div>
        <div class="row"><span>uptime</span><b>${fmtUp(g.uptime)}</b></div>` + traits.tipRows(g);
    }
    tip.style.display = 'block';
    tip.style.left = Math.min(innerWidth - 260, ev.clientX + 18) + 'px';
    tip.style.top = Math.max(10, Math.min(innerHeight - tip.offsetHeight - 10, ev.clientY + 14)) + 'px';
  }
  const el = renderer.domElement; el.style.cursor = 'grab';
  el.addEventListener('pointermove', ev => {
    const r = el.getBoundingClientRect(); ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera); const hit = ray.intersectObjects(pick, false)[0];
    hover = hit ? hit.object : null; tipFor(hover, ev);
  });
  el.addEventListener('pointerleave', () => { hover = null; tip.style.display = 'none' });
  el.addEventListener('pointerdown', ev => { downAt = [ev.clientX, ev.clientY] });
  el.addEventListener('pointerup', ev => {
    if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 6 || !hover) return;
    tip.style.display = 'none';
    if (hover.userData.plex || hover.userData.stream !== undefined) go('cast'); else openDrawer(hover.userData.gid);
  });

  // ---------- post
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.55, 0.45, 0.93); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const ro = new ResizeObserver(() => {
    camera.aspect = W() / H(); camera.updateProjectionMatrix();
    renderer.setSize(W(), H()); composer.setSize(W(), H()); css.setSize(W(), H());
  }); ro.observe(host);

  // ---------- per-frame state
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), cMix = new THREE.Color();
  let t = 0, lastSig = '';
  function update(dt) {
    t += dt;
    const n = S.node || {}, cpu = n.cpu || 0, mem = n.memory || {}, sw = n.swap || {};
    // rebuild on topology change
    const s = guests().map(g => g.id).sort().join();
    if (s !== sig) { sig = s; rebuild() }
    // sun
    // load = brightness/size of the glow; temperature = the star's colour, churn, spots, flares, swell
    const tC = S.temps && S.temps.cpu, tTarget = tC == null ? 50 : tC;
    heatS = heatS < 0 ? tTarget : heatS + (tTarget - heatS) * Math.min(1, dt * 0.8);   // ease between 5 s samples
    const hk = Math.min(1, Math.max(0, (heatS - 35) / 55));
    heatColor(heatS, sunCol);
    const crit = Math.max(0, (heatS - 82) / 8);                                          // ≥82 °C: the star throbs
    pulseT += dt * (1.2 + crit * 3);
    const pulse = crit > 0 ? Math.min(1, crit) * (0.5 + 0.5 * Math.sin(pulseT * 2.4)) : 0;
    sunU.uT.value = t; sunU.uHeat.value = hk; sunU.uLoad.value = cpu; sunU.uPulse.value = pulse; sunU.uCol.value.copy(sunCol);
    sun.scale.setScalar(1 + Math.max(0, hk - 0.45) * 0.28 + pulse * 0.03);           // swells into a giant when hot
    corona.scale.setScalar((4.2 + cpu * 7) * (1 + hk * 0.35 + pulse * 0.12));
    corona.material.opacity = 0.55 + cpu * 0.45;
    corona.material.color.copy(sunCol).multiplyScalar(0.8 + hk * 0.7 + pulse * 0.6);
    sunLight.color.copy(sunCol); sunLight.intensity = 8 + cpu * 40 + pulse * 10;      // planets are lit by the star's colour
    proms.forEach(pv => {
      const u = pv.userData, on = hk > 0.4 + u.slot * 0.08;                          // more loops the hotter it runs
      u.ph = (u.ph + dt * u.sp * (0.6 + hk)) % 1;
      if (u.ph < dt * u.sp * 2) { pv.rotation.set(Math.random() * 6.28, Math.random() * 6.28, 0) }
      const m = pv.children[0], life = Math.sin(u.ph * Math.PI);
      m.material.opacity = on ? life * (0.35 + hk * 0.5) : Math.max(0, m.material.opacity - dt);
      m.material.color.copy(sunCol).multiplyScalar(1.4 + hk);
      m.scale.setScalar(0.5 + u.ph * 0.9 * (0.6 + hk)); m.position.y = SUN_R * sun.scale.x * 0.92;
    });
    sunLab.element.firstChild.textContent = Math.round(cpu * 100) + '%';
    const st2 = tC == null ? 'CPU' : `CPU · ${Math.round(tC)}°C`;
    if (sunLab.element.lastChild.textContent !== st2) sunLab.element.lastChild.textContent = st2;
    sunLab.element.lastChild.style.color = tC == null ? '' : '#' + sunCol.getHexString();
    sunLab.element.classList.toggle('hot', heatS >= 82);
    threads.rotation.y -= dt * 0.15;
    const th = (n.cpuinfo && n.cpuinfo.cpus) || 16, lit = cpu * th;
    threads.children.forEach((m, i) => { const f = Math.min(1, Math.max(0, lit - i)); m.material.color.set(f > 0 ? '#f0d08a' : '#4a3a1c').multiplyScalar(f > 0 ? 1 + f * 2 : 1) });
    const mf = mem.total ? mem.used / mem.total : 0, sf = sw.total ? sw.used / sw.total : 0;
    if (Math.abs(mf - memF) > 0.004) { memF = mf; memArc.geometry.dispose(); memArc.geometry = new THREE.TorusGeometry(2.15, 0.05, 8, 96, Math.max(0.001, mf * Math.PI * 2)) }
    if (Math.abs(sf - swapF) > 0.004) { swapF = sf; swapArc.geometry.dispose(); swapArc.geometry = new THREE.TorusGeometry(2.38, 0.04, 8, 96, Math.max(0.001, sf * Math.PI * 2)) }
    // clockwork: gears turn with CPU, scale drifts
    const gs = 0.25 + cpu * 5;
    gears.forEach(g => g.rotation.y += dt * gs * ((g.userData && g.userData.speed) || 1));
    if (scaleRing) scaleRing.rotation.y += dt * 0.01;
    // planets
    const selId = S.selected && S.selected.id;
    E.forEach(e => {
      const g = guests().find(x => x.id === e.g.id) || e.g; e.g = g;
      const run = g.status === 'running', gc = run ? (g.cpu || 0) : 0;
      if (run) e.angle += dt * e.speed;
      e.pivot.rotation.y = e.phase + e.angle;
      const st = run ? 'run' : 'stop';
      if (st !== e.st) { e.st = st; e.k = -1; if (e.body) { e.body.main.color.copy(run ? e.bodyCol : iron.color); if (!run) e.body.main.emissiveIntensity = 0 } else e.planet.material = run ? e.baseMat : iron; e.lab.element.classList.toggle('dim', !run) }
      if (e.body && (run || e.body.group.visible)) e.body.tick(dt, t, g, e);
      const al = alarmOf(g, run), busy = run && busyOf(g);
      const k = e.tier === 'active' || al || busy ? 1 : 0.4;
      if (k !== e.k && run) { e.k = k; if (e.body) e.body.main.color.copy(e.bodyCol).multiplyScalar(0.4 + 0.6 * k) }
      const hc = new THREE.Color(heat(gc));
      if (run) { e.baseMat.emissive.copy(hc); e.baseMat.emissiveIntensity = (e.body ? 0.01 + gc * 0.55 : 0.04 + gc * 1.4) * k }
      e.halo.visible = run || !!al;
      if (al) { const p = 0.5 + 0.5 * Math.sin(t * 4); e.halo.material.opacity = 0.55 + 0.4 * p; e.halo.material.color.copy(hdr('#d14d5a', 1.6 + p)); e.halo.scale.setScalar(1.6 + e.size * 4 + p * 0.6) }
      else { e.halo.material.opacity = 0.38 * k; e.halo.material.color.copy(hc).multiplyScalar(0.8 + gc * 1.8); e.halo.scale.setScalar(e.size * (2.2 + gc * 6)) }
      const mfr = g.maxmem ? Math.min(1, g.mem / g.maxmem) : 0;
      if (Math.abs(mfr - e.mf) > 0.01) { e.mf = mfr; e.mem.geometry.dispose(); e.mem.geometry = new THREE.TorusGeometry(e.size * 1.45, 0.03, 6, 64, Math.max(0.01, mfr * Math.PI * 2)); e.mem.material.color.copy(hdr(mfr > 0.9 ? '#d14d5a' : '#c9a45c', 1.5)) }
      e.sel.visible = hotId() === g.id;
      const lt = al ? `<b>${esc(g.name)}</b><span>${esc(al)}</span>` : `<b>${esc(g.name)}</b><span>${g.vmid} · ${run ? fmtP(gc * 100) : 'stopped'}</span>`;
      e.lab.element.classList.toggle('alarm', !!al); e.lab.element.classList.toggle('quiet', k < 1);
      if (e.lab.element.innerHTML !== lt) e.lab.element.innerHTML = lt;
      e.lab.element.classList.toggle('hot', hotId() === g.id);
      e.planet.getWorldPosition(e.wp);
      // traffic
      const r = S.rates[g.id];
      if (run && r) {
        const pin = Math.min(0.6, Math.log10(r.netin + 1) / 14), pout = Math.min(0.6, Math.log10(r.netout + 1) / 14);
        if (Math.random() < pin * pin * 2) parts.push({ kind: 'g', e, dir: 1, k: 0, s: 0.006 + Math.random() * 0.01, o: (Math.random() - 0.5) * 1.2, h: 0.3 + Math.random() * 0.9 });
        if (Math.random() < pout * pout * 2) parts.push({ kind: 'g', e, dir: -1, k: 0, s: 0.006 + Math.random() * 0.01, o: (Math.random() - 0.5) * 1.2, h: 0.3 + Math.random() * 0.9 });
      }
    });
    // plex
    const P = S.plex, ss = (P && P.enabled) ? plexSessions() : [];
    plexG.visible = !!(P && P.enabled);
    if (P && P.enabled) {
      const ok = !(P.identity || {}).__error;
      giant.rotation.y += dt * 0.12;
      giantMat.color.copy(giantBase).multiplyScalar(ok ? 1 : 0.22);
      // the world: colonisation = D: used, frontier = disk writes, weather = CPU, atmosphere = RAM, red skies = D: nearly full
      const Wd = P.world && P.world.enabled && !P.world.__error ? P.world : null;
      if (Wd && Wd.d) {
        const tot = Wd.d.used + Wd.d.avail; colTarget = tot ? Wd.d.used / tot : 0;
        const wr = Math.min(1, Math.max(0, (Math.log10((Wd.io_write || 0) * 1024 + 1) - 4) / 4.5));   // ~10 KB/s → 0 … ~300 MB/s → 1
        buildS += (wr - buildS) * Math.min(1, dt * 1.5);
        alarmS += ((tot && Wd.d.avail / tot < 0.1 ? 1 : 0) - alarmS) * Math.min(1, dt);
        const cpuW = Math.min(1, (Wd.cpu || 0) / 100), ramW = Wd.ram_used ? Wd.ram_used / (Wd.ram_used + (Wd.ram_free || 0)) : 0.5;
        if (clouds) { clouds.rotation.y += dt * (0.015 + cpuW * 0.3); clouds.material.opacity += ((0.18 + cpuW * 0.55) - clouds.material.opacity) * Math.min(1, dt) }
        atmoMat.uniforms.uI.value = 0.55 + ramW * 1.1;
        atmoMat.uniforms.uColor.value.copy(cAtmo).lerp(cAlarm, alarmS);
      }
      WU.uColonized.value += (colTarget - WU.uColonized.value) * Math.min(1, dt * 0.6);   // sweeps in on load, creeps as D: fills
      WU.uBuild.value = buildS; WU.uAlarm.value = alarmS; WU.uTime.value = t;
      WU.uSunDir.value.copy(key.position).normalize().transformDirection(camera.matrixWorldInverse);
      plexHalo.material.color.copy(hdr(ok ? '#9d86d6' : '#d14d5a', ok ? 0.35 + ss.length * 0.15 : 0.25));
      tetherMat.color.copy(hdr(ok ? '#9d86d6' : '#d14d5a', 1.3));
      const tl = ok ? `TAILSCALE · ${(P.identity.__ms || 0).toFixed(0)} ms` : 'TAILNET · NO SIGNAL';
      if (tLab.element.textContent !== tl) tLab.element.textContent = tl;
      tLab.element.classList.toggle('bad', !ok);
      const Qb = P.qbit && P.qbit.enabled && !P.qbit.__error ? P.qbit : null;
      const pl = `<b>${esc((P.host || 'plex').toUpperCase())}</b><span>${ok ? (ss.length ? `${ss.length} stream${ss.length > 1 ? 's' : ''} · ${fmtBps(plexOut())}` : 'plex · idle') : 'unreachable'}</span>`
        + (Qb ? `<span class="o3-q more">⇣ ${fmtR(Qb.dl_speed)} · ⇡ ${fmtR(Qb.up_speed)}${Qb.n_downloading ? ' · ' + Qb.n_downloading + ' inbound' : ''}</span>` : '')
        + (Wd && Wd.d ? `<span class="o3-col more${alarmS > 0.5 ? ' bad' : ''}">colonised ${(colTarget * 100).toFixed(1)}% · ${(Wd.d.used / 1024).toFixed(1)} / ${((Wd.d.used + Wd.d.avail) / 1024).toFixed(1)} TiB</span>` : '');
      if (plexLab.element.innerHTML !== pl) plexLab.element.innerHTML = pl;
      const plexHot = !!hover && (hover.userData.plex || hover.userData.stream !== undefined);
      plexLab.element.classList.toggle('hot', plexHot);
      // moons = streams
      const ms = ss.map(x => x.key + x.dec + x.thumb).join();
      if (ms !== moonSig) { moonSig = ms; buildMoons(ss) }
      moons.children.forEach(m => {
        const u = m.userData; if (u.key === undefined) return;
        const x = ss.find(s => s.key === u.key); if (!x) return;
        const playing = x.state === 'playing';
        u.a += dt * (playing ? 0.32 : 0.025);
        const rr = 4.7 + (u.i % 2) * 1.0;
        m.position.set(Math.cos(u.a) * rr, 0.5 + Math.sin(u.a) * rr * 0.28, Math.sin(u.a) * rr);
        u.body.rotation.y += dt * 0.35;
        u.halo.scale.setScalar(playing ? 2.1 + Math.sin(t * 3 + u.i) * 0.15 : 1.5);
        const pf = x.dur ? x.off / x.dur : 0;
        if (Math.abs(pf - u.pf) > 0.004) { u.pf = pf; u.prog.geometry.dispose(); u.prog.geometry = new THREE.TorusGeometry(0.66, 0.03, 6, 64, Math.max(0.01, pf * Math.PI * 2)) }
        if (u.card) u.card.material.opacity = playing ? 1 : 0.45;
        const lt = `<b>${esc(x.user)}</b><span class="more">${esc(x.title).slice(0, 26)} · ${playing ? '▶' : '❚❚'}</span>`;
        u.lab.element.classList.toggle('hot', hover === u.body);
        if (u.lab.element.innerHTML !== lt) u.lab.element.innerHTML = lt;
        pushTrail(u.trail, m.position, playing ? 1 : 0.4);
        if (playing && Math.random() < Math.min(0.5, 0.1 + x.act * 8 / 1e3 / 30000)) {
          m.getWorldPosition(tmp);
          parts.push({ kind: 's', from: tmp.clone(), dir: tmp.clone().sub(PLEX_POS).normalize().add(new THREE.Vector3((Math.random() - .5) * .6, (Math.random() - .5) * .6, (Math.random() - .5) * .6)).normalize(), k: 0, s: 0.012 + Math.random() * 0.01, c: hdr(DEC[x.dec], 2.2) });
        }
      });
      if (ok && Math.random() < (ss.length ? Math.min(1, 0.08 + ss.length * 0.15) : 0.02)) parts.push({ kind: 't', k: 0, s: 0.004 + Math.random() * 0.004 });

      // acquisitions
      const Q = P.qbit && P.qbit.enabled && !P.qbit.__error ? P.qbit : null;
      const fd = Q ? Math.min(1, Math.log10((Q.dl_speed || 0) + 1) / 8) : 0, fu = Q ? Math.min(1, Math.log10((Q.up_speed || 0) + 1) / 8) : 0;
      const dIn = fd > 0.45 ? (fd - 0.45) / 0.55 : 0, uOut = fu > 0.45 ? (fu - 0.45) / 0.55 : 0;  // ≈ >4 KB/s starts to show
      disk.material.opacity += ((dIn * 0.55) - disk.material.opacity) * Math.min(1, dt * 2);
      disk.rotation.z -= dt * (0.15 + dIn * 1.6);
      jetMat.opacity += ((uOut * 0.45) - jetMat.opacity) * Math.min(1, dt * 2);
      const jl = 2 + uOut * 9 + Math.sin(t * 9) * 0.25 * uOut; jetN.scale.set(1 + uOut * .6, jl, 1 + uOut * .6); jetS.scale.copy(jetN.scale);
      pring.rotation.y += dt * (0.03 + dIn * 1.1);
      giant.rotation.y += dt * dIn * 0.6;
      if (Math.random() < dIn * dIn * 5) for (let q = 0; q < 1 + Math.floor(dIn * 4); q++) parts.push({ kind: 'v', a: Math.random() * Math.PI * 2, r0: 6.6 + Math.random() * 1.6, y: (Math.random() - .5) * 0.5, k: 0, s: 0.004 + Math.random() * 0.004 + dIn * 0.004 });
      if (Math.random() < uOut * uOut * 5) for (let q = 0; q < 1 + Math.floor(uOut * 4); q++) parts.push({ kind: 'j', sg: Math.random() < .5 ? 1 : -1, jx: (Math.random() - .5) * .9, jz: (Math.random() - .5) * .9, L: 3 + uOut * 9, k: 0, s: 0.012 + Math.random() * 0.012 });
      // comets: each active download spirals inward as it completes
      const dl = Q ? (Q.downloading || []).filter(q => (q.progress || 0) < 1).slice(0, 8) : [];
      const cs = dl.map(q => q.hash).join();
      if (cs !== cometSig) { cometSig = cs; buildComets(dl) }
      comets.children.forEach(c => {
        const u = c.userData; if (!u.hash) return;
        const q = dl.find(z => z.hash === u.hash); if (!q) return;
        const live = (q.dlspeed || 0) > 0, target = 2.6 + (1 - (q.progress || 0)) * 5.4;
        u.r += (target - u.r) * Math.min(1, dt * 0.6);
        u.a += dt * (live ? 0.9 / Math.sqrt(u.r) : 0.05);
        c.position.set(Math.cos(u.a) * u.r, Math.sin(u.a * 3) * 0.18, Math.sin(u.a) * u.r);
        u.head.material.opacity = live ? 1 : 0.35; u.head.scale.setScalar(live ? 0.9 + Math.sin(t * 6 + u.a) * 0.1 : 0.6);
        const nm = String(q.name || '').replace(/[._]/g, ' ').replace(/\s+(19|20)\d\d\b.*$/, '').trim() || q.name;   // "The Rock 1996 1080p…" → "The Rock"
        const lt = `<b>⇣ ${esc(nm).slice(0, 26)}</b><span>${((q.progress || 0) * 100).toFixed(0)}%${live ? ' · ' + fmtR(q.dlspeed) : ' · stalled'}</span>`;
        if (u.lab.element.innerHTML !== lt) u.lab.element.innerHTML = lt;
        u.lab.element.classList.toggle('hot', plexHot);
        pushTrail(u.trail, c.position, live ? 1 : 0.3);
        if (live && Math.random() < 0.25 + Math.min(0.5, (q.dlspeed || 0) / 2e7)) parts.push({ kind: 'f', from: c.position.clone(), k: 0, s: 0.02 + Math.random() * 0.015 });
      });
      // completions → shockwave
      while (S.acqEvents && acqSeen < S.acqEvents.length) shock(S.acqEvents[acqSeen++].name);
      for (let i = shocks.length - 1; i >= 0; i--) {
        const sh = shocks[i]; sh.t += dt; const k = sh.t / 2.6;
        sh.m.geometry.dispose(); sh.m.geometry = new THREE.TorusGeometry(1.5 + sh.t * 5, 0.035 + sh.t * 0.01, 6, 160); sh.m.material.color.copy(cShock).multiplyScalar(Math.max(0, 1 - k));
        sh.lab.position.y = 2.4 + sh.t * 0.9; sh.lab.element.style.opacity = Math.max(0, 1.6 - k * 1.6);
        if (k >= 1.6) { tilt.remove(sh.m); sh.m.geometry.dispose(); plexG.remove(sh.lab); sh.lab.element.remove(); shocks.splice(i, 1) }
      }
      const flash = shocks.reduce((a, s) => Math.max(a, 1 - s.t / 1.2), 0);
      giantMat.emissive.copy(giantGlow); giantMat.emissiveIntensity = Math.max(0, flash) * (isWorld ? 0.25 : 1.4) + dIn * (isWorld ? 0.03 : 0.12);
      plexHalo.scale.setScalar(7 + dIn * 3 + Math.max(0, flash) * 8);
    }
    traits.update(dt, t);
    // particles → buffer
    let n2 = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.k += p.s;
      if (p.k >= 1 || (p.kind === 'g' && !E.has(p.e.g.id))) { parts.splice(i, 1); continue }
      let c;
      if (p.kind === 'g') {
        const e = p.e, k = p.dir === 1 ? p.k : 1 - p.k;
        tmp2.copy(e.wp).setY(0).normalize();
        const sx = e.wp.x - tmp2.x * e.size, sz = e.wp.z - tmp2.z * e.size, ex = tmp2.x * (SUN_R + 0.5), ez = tmp2.z * (SUN_R + 0.5);
        const bend = Math.sin(k * Math.PI);
        tmp.set(sx + (ex - sx) * k - tmp2.z * bend * p.o, bend * p.h, sz + (ez - sz) * k + tmp2.x * bend * p.o);
        c = p.dir === 1 ? cIn : cOut;
      } else if (p.kind === 't') { tether.getPoint(1 - p.k, tmp); c = cAme }
      else if (p.kind === 'v') {            // accretion: log-spiral inflow in the ring plane
        const k = p.k, r = p.r0 + (1.45 - p.r0) * Math.pow(k, 1.5), a = p.a + k * 5.2;
        tmp.set(Math.cos(a) * r, p.y * (1 - k), Math.sin(a) * r); tilt.localToWorld(tmp);
        c = cMix.copy(cVort).lerp(cVortHot, k * k);
      } else if (p.kind === 'j') {          // polar jets along the giant's axis
        const k = p.k; tmp.set(p.jx * k, p.sg * (1.3 + k * p.L), p.jz * k); tilt.localToWorld(tmp);
        c = cMix.copy(cJetHot).lerp(cJet, k);
      } else if (p.kind === 'f') {          // comet feeding the planet
        tmp.copy(p.from).multiplyScalar(1 - p.k); tilt.localToWorld(tmp); c = cVort;
      } else if (p.kind === 'b') {          // completion burst
        const r = 1.5 + p.k * p.v * 0.8; tmp.set(Math.cos(p.a) * r, p.y * p.k, Math.sin(p.a) * r); tilt.localToWorld(tmp); c = cShock;
      }
      else { tmp.copy(p.from).addScaledVector(p.dir, p.k * 4); c = p.c }
      if (n2 >= PMAX) continue;
      const a = Math.sin(p.k * Math.PI);
      pPos[n2 * 3] = tmp.x; pPos[n2 * 3 + 1] = tmp.y; pPos[n2 * 3 + 2] = tmp.z;
      pCol[n2 * 3] = c.r * a; pCol[n2 * 3 + 1] = c.g * a; pCol[n2 * 3 + 2] = c.b * a; n2++;
    }
    if (parts.length > PMAX) parts.splice(0, parts.length - PMAX);
    pGeo.setDrawRange(0, n2); pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    if (!controls.autoRotate && performance.now() - idleAt > 25000) controls.autoRotate = true;
  }

  // ---------- loop
  let raf = 0, last = performance.now(), live = true;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) { last = now; return }
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    update(dt); controls.update(); composer.render(); css.render(scene, camera);
  }
  status(null);
  raf = requestAnimationFrame(frame);
  return {
    pause() { if (live) { live = false; cancelAnimationFrame(raf); tip.style.display = 'none' } },
    resume() { if (!live) { live = true; last = performance.now(); raf = requestAnimationFrame(frame) } },
    focus(x, y, z, tx, ty, tz) { camera.position.set(x, y, z); controls.target.set(tx, ty, tz); controls.autoRotate = false; idleAt = performance.now() },
    where(n) { for (const e of E.values()) if (e.g.name === n) { const v = e.planet.getWorldPosition(new THREE.Vector3()); return [v.x, v.y, v.z] } return null },
    get stats() { return { parts: parts.length, guests: E.size, calls: renderer.info.render.calls, tris: renderer.info.render.triangles } },
  };
}
