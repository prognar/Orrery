// ORRERY · 3D — a living planet for a machine that reports its health.
//
// First question, answered from across the room: is it OK, does it need a look, or is something about to go wrong?
//   OK         a calm blue-green world, soft sky, no ring
//   attention  amber sky and an amber beacon ring; the subsystem in trouble turns amber
//   critical   red pulsing sky, red ring with shockwaves, magma fissures; overheating sets the land on fire
// Second question, on a closer look: what is it doing?
//   continents   one per drive, sized by capacity, settled from the centre outwards as the drive fills
//   sea level    RAM: the water rises as memory fills and swallows the coast
//   spin         CPU load: a busy machine turns faster
//   storms       fans: a cyclone per spinning fan, cloud speed follows airflow
//   moon         the GPU: glows brighter with load, coloured by its temperature; the arc is VRAM
//   aurora       network traffic (download north, upload south)
//   night glow   power draw, on the settled land
// Ratings come from the server (health.assess), so the planet, label and hover card always agree.
import * as THREE from 'three';

const MAXD = 6, MAXS = 3;
export const LEVEL_COL = ['#5fb3a1', '#f0a63a', '#e2453c'];
export const LEVEL_WORD = ['OK', 'ATTENTION', 'CRITICAL'];

const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm(vec4 x){return mod289(((x*34.)+1.)*x);}vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
 vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;
 vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
 i=mod289(i);vec4 p=perm(perm(perm(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
 float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
 vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
 vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
 vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
 vec4 nr=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=nr.x;p1*=nr.y;p2*=nr.z;p3*=nr.w;
 vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
 return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float fbm(vec3 p){float f=0.,a=.5;for(int i=0;i<5;i++){f+=a*snoise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return f*.5+.5;}
vec3 rotAxis(vec3 v,vec3 k,float a){return v*cos(a)+cross(k,v)*sin(a)+k*dot(k,v)*(1.-cos(a));}
`;

const VERT = /* glsl */`
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.); vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp; }`;

const SURF = /* glsl */`
uniform float uTime, uSea, uSeaLvl, uGlow, uFire, uCrack, uSeed; uniform vec3 uSun;
uniform vec4 uDisk[${MAXD}]; uniform vec4 uDiskA[${MAXD}]; uniform int uND;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
vec3 lvlCol(float l){ return l < .5 ? vec3(.78,.64,.42) : l < 1.5 ? vec3(.95,.62,.18) : vec3(.9,.22,.15); }
void main(){
  vec3 n = normalize(vN);
  float pulse = .5 + .5*sin(uTime*3.);
  // terrain: a plateau continent per drive, ragged coasts, a few islands
  float h = (fbm(n*4.2+uSeed)-.66)*.8; int own = -1; float rel = 1.;
  for(int i=0;i<${MAXD};i++){ if(i>=uND) break;
    float d = dot(n, uDisk[i].xyz) + (fbm(n*2.6+float(i)*7.3+uSeed)-.5)*.32;
    float hi = smoothstep(cos(uDisk[i].w), cos(uDisk[i].w*.5), d) * .85 + smoothstep(cos(uDisk[i].w*.5), 1., d) * .15;
    if(hi > h){ h = hi; own = i; rel = acos(clamp(dot(n, uDisk[i].xyz), -1., 1.)) / uDisk[i].w; } }
  float coast = h - uSea;
  float lit = clamp(dot(normalize(vWN), uSun), 0., 1.), night = smoothstep(.15, -.2, dot(normalize(vWN), uSun));
  vec3 col; vec3 emit = vec3(0.);
  if(coast < 0.){                                               // ocean: RAM
    float depth = clamp(-coast*3., 0., 1.);
    col = mix(vec3(.16,.42,.55), vec3(.04,.12,.25), depth);
    if(uSeaLvl > .5) col = mix(col, uSeaLvl > 1.5 ? vec3(.3,.07,.06) : vec3(.32,.26,.1), .65);
    vec3 v = normalize(cameraPosition - vWP), r = reflect(-uSun, normalize(vWN));
    emit += vec3(1.,.95,.85) * pow(max(dot(r,v),0.), 160.) * .2 * lit;
  } else {                                                      // land: drives
    vec4 a = own >= 0 ? uDiskA[own] : vec4(0.);                 // fill, level, -, -
    float elev = clamp(coast*2.2, 0., 1.);
    vec3 wild = mix(vec3(.2,.38,.18), vec3(.36,.42,.24), fbm(n*9.+uSeed));
    col = mix(wild, vec3(.4,.37,.33), smoothstep(.6,.95,elev));
    // settled ground spreads from the continent's heart as the drive fills: one clean shape, not sparkles
    float edge = sqrt(clamp(a.x, 0., 1.)) * 1.05 + (fbm(n*7.+float(own))-.5)*.12;
    float settled = 1. - smoothstep(edge - .04, edge, rel);
    vec3 sc = lvlCol(a.y);
    col = mix(col, sc * .8, settled);
    emit += settled * sc * night * (.15 + .9*uGlow);                                   // night glow = power draw
    float rim = smoothstep(.06, 0., abs(rel - edge)) * step(.5, a.y);                  // the frontier lights up when the drive is in trouble
    emit += rim * sc * (a.y > 1.5 ? 1.6*(.5+.5*sin(uTime*5.)) : .9*(.6+.4*pulse));
    if(a.y > 1.5) emit += vec3(1.,.2,.1) * smoothstep(.05,0.,coast) * (.6+.4*sin(uTime*5.));   // and its coast burns
  }
  // overheating: wildfires spread across the land (attention: a few fronts; critical: everywhere)
  if(uFire > .01 && coast > 0.){
    float f = fbm(n*6. + vec3(0., -uTime*.25, uTime*.1));
    float burn = smoothstep(1. - uFire*.55, 1. - uFire*.55 + .08, f);
    float flame = fbm(n*28. + vec3(0., -uTime*2., 0.));
    col = mix(col, vec3(.08,.05,.04), smoothstep(1. - uFire*.7, 1. - uFire*.55, f));
    emit += mix(vec3(.95,.18,.03), vec3(1.,.65,.2), flame) * burn * (.8 + .8*flame);
  }
  // critical: magma fissures split the crust
  if(uCrack > .01){
    float c = abs(fbm(n*3.2 + uSeed*2.) - .5);
    float crack = 1. - smoothstep(.0, .012 + .02*uCrack, c);
    emit += vec3(1.,.28,.06) * crack * uCrack * (1.2 + .8*sin(uTime*4. + n.y*6.));
  }
  gl_FragColor = vec4(col * (.1 + .85*lit) + emit, 1.);
  #include <colorspace_fragment>
}`;

const CLOUD = /* glsl */`
uniform float uTime, uWind, uSeed, uDim; uniform vec3 uSun; uniform vec4 uStorm[${MAXS}]; uniform int uNS;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vN); float band = 0.;
  for(int i=0;i<${MAXS};i++){ if(i>=uNS) break;
    vec3 s = uStorm[i].xyz; float k = uStorm[i].w, size = .35 + .25*k;
    float d = acos(clamp(dot(n, s), -1., 1.));
    if(d < size){ float w = pow(1.-d/size, 2.); n = rotAxis(n, s, w * (uTime*(.6+2.5*k) + 5.*k)); band = max(band, w*k); } }
  float c = fbm(n*3. + vec3(uTime*uWind*.05, 0., uTime*uWind*.02) + uSeed);
  float a = smoothstep(.62 - band*.22, .88, c) * (.35 + band*.5);
  float lit = clamp(dot(normalize(vWN), uSun), 0., 1.);
  gl_FragColor = vec4(mix(vec3(.9), vec3(.35,.3,.3), uDim) * (.12 + .7*lit), a * .8);
  #include <colorspace_fragment>
}`;

const ATMO = /* glsl */`
uniform float uTime, uLvl, uAurN, uAurS; uniform vec3 uSky, uSun;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vN), v = normalize(cameraPosition - vWP);
  float rim = pow(1. - abs(dot(normalize(vWN), v)), 2.2);
  float lit = .4 + .6*clamp(dot(normalize(vWN), uSun)*.5+.5, 0., 1.);
  float beat = uLvl > 1.5 ? .55 + .65*abs(sin(uTime*3.2)) : uLvl > .5 ? .85 + .25*sin(uTime*1.6) : 1.;
  vec3 c = uSky * rim * lit * beat * (1. + uLvl*.35);
  float cur = snoise(vec3(atan(n.z, n.x)*5., uTime*.35, 1.)) * .5 + .5;
  float north = smoothstep(.62, .76, n.y) * (1.-smoothstep(.88, .97, n.y)) * cur * uAurN;
  float south = smoothstep(.62, .76, -n.y) * (1.-smoothstep(.88, .97, -n.y)) * cur * uAurS;
  c += (vec3(.2,1.,.45)*north + vec3(.9,.3,1.)*south) * .45;
  gl_FragColor = vec4(c, clamp(rim + north + south, 0., 1.));
  #include <colorspace_fragment>
}`;

function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 }
const hash = str => [...String(str)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const dirFrom = r => { const u = r() * 1.6 - 0.8, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u); return new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a)).normalize() };
const lvlOf = (v, warn, crit) => v == null ? 0 : v >= crit ? 2 : v >= warn ? 1 : 0;

export function makeLiving({ seed, R = 1.35, glowTex, hdr }) {
  const r = rng(hash(seed)), sd = r() * 100;
  const group = new THREE.Group();
  const sunU = { value: new THREE.Vector3(1, 0, 0) }, time = { value: 0 };
  // continents spread around the globe so each drive is its own landmass
  const diskDirs = Array.from({ length: MAXD }, (_, i) => { const a = i * 2.39996 + r() * 0.4, y = (i % 2 ? -0.35 : 0.3) + (r() - 0.5) * 0.3; return new THREE.Vector3(Math.cos(a), y, Math.sin(a)).normalize() });
  const stormDirs = Array.from({ length: MAXS }, () => dirFrom(r));
  const U = { uTime: time, uSun: sunU, uSeed: { value: sd }, uSea: { value: 0.3 }, uSeaLvl: { value: 0 }, uGlow: { value: 0.3 }, uFire: { value: 0 }, uCrack: { value: 0 },
    uDisk: { value: diskDirs.map(d => new THREE.Vector4(d.x, d.y, d.z, 0.9)) }, uDiskA: { value: diskDirs.map(() => new THREE.Vector4()) }, uND: { value: 1 } };
  const surf = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: SURF }));
  const CU = { uTime: time, uSun: sunU, uSeed: { value: sd + 11 }, uWind: { value: 0.3 }, uDim: { value: 0 }, uStorm: { value: stormDirs.map(d => new THREE.Vector4(d.x, d.y, d.z, 0)) }, uNS: { value: 0 } };
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 80, 56), new THREE.ShaderMaterial({ uniforms: CU, vertexShader: VERT, fragmentShader: CLOUD, transparent: true, depthWrite: false }));
  const AU = { uTime: time, uSun: sunU, uSky: { value: new THREE.Color(LEVEL_COL[0]) }, uLvl: { value: 0 }, uAurN: { value: 0 }, uAurS: { value: 0 } };
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 64, 48), new THREE.ShaderMaterial({ uniforms: AU, vertexShader: VERT, fragmentShader: ATMO, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const spinG = new THREE.Group(); spinG.rotation.set(0.32, 0, 0.18); spinG.add(surf, clouds); group.add(spinG, atmo);
  // the beacon: no ring when all is well, amber when it needs a look, red with shockwaves when it's critical
  const ringMat = new THREE.MeshBasicMaterial({ color: hdr(LEVEL_COL[1], 1.6), transparent: true, opacity: 0, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.62, 0.035, 8, 128), ringMat); ring.rotation.x = Math.PI / 2.15;
  const waves = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.TorusGeometry(R * 1.62, 0.02, 6, 128), new THREE.MeshBasicMaterial({ color: hdr(LEVEL_COL[2], 2), transparent: true, opacity: 0, depthWrite: false })); m.rotation.x = Math.PI / 2.15; return m });
  group.add(ring, ...waves);
  // the GPU moon: brighter with load, coloured by temperature; the arc is VRAM
  const moonMat = new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.7, metalness: 0.2, emissive: new THREE.Color(LEVEL_COL[0]), emissiveIntensity: 0.2 });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(R * 0.15, 40, 28), moonMat);
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(LEVEL_COL[0], 0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  moonGlow.scale.setScalar(R * 0.6);
  const vramArc = new THREE.Mesh(new THREE.TorusGeometry(R * 0.24, 0.018, 6, 64, 0.01), new THREE.MeshBasicMaterial({ color: hdr('#c9a45c', 1.6) }));
  vramArc.rotation.x = -Math.PI / 2;
  const moonG = new THREE.Group(); moonG.add(moon, moonGlow, vramArc); moonG.visible = false; group.add(moonG);
  let ma = r() * 6.28, vf = -1, wave = 0;
  const sm = { ram: 0.5, wind: 0.3, load: 0, gl: 0 };

  function update(H, dt, t, sunWorld) {
    time.value = t;
    group.updateMatrixWorld();
    sunU.value.copy(sunWorld).sub(group.getWorldPosition(new THREE.Vector3())).normalize();
    const h = H && !H.__error ? H : {}, L = h.level || 0;
    // drives
    const disks = (h.disks || []).slice(0, MAXD), tot = disks.reduce((a, d) => a + (d.size || 1), 0) || 1;
    U.uND.value = Math.max(1, disks.length);
    for (let i = 0; i < MAXD; i++) {
      const d = disks[i];
      U.uDisk.value[i].w = disks.length ? 0.6 + 0.65 * Math.sqrt((d ? d.size || 1 : 1) / tot) : 1.0;
      U.uDiskA.value[i].set(d && d.used != null ? d.used / 100 : 0.35, d ? d.level || 0 : 0, 0, 0);
    }
    // RAM -> sea level
    const ram = h.ramPct != null ? h.ramPct / 100 : 0.4;
    sm.ram += (ram - sm.ram) * Math.min(1, dt * 0.8);
    U.uSea.value = 0.02 + sm.ram * 0.38; U.uSeaLvl.value = lvlOf(h.ramPct, 85, 95);
    // power -> night glow on settled land
    U.uGlow.value = Math.max(0.15, Math.min(1, ((h.cpuW || 0) + (h.gpuW || 0)) / 400));
    // overheating -> fire; critical anywhere -> fissures
    const cpuL = lvlOf(h.cpuT, 80, 89);
    const fireT = cpuL === 2 ? 1 : cpuL === 1 ? 0.4 : 0;
    U.uFire.value += (fireT - U.uFire.value) * Math.min(1, dt * 1.5);
    U.uCrack.value += ((L === 2 ? 1 : 0) - U.uCrack.value) * Math.min(1, dt * 1.5);
    // status sky + beacon
    AU.uSky.value.copy(new THREE.Color(L ? LEVEL_COL[L] : '#6fb7ff')).multiplyScalar(L ? 1 : 0.8); AU.uLvl.value = L;
    ringMat.color.copy(hdr(LEVEL_COL[Math.max(1, L)], 1.6));
    ringMat.opacity += ((L === 0 ? 0 : L === 1 ? 0.5 + 0.3 * Math.sin(t * 2) : 0.6 + 0.4 * Math.abs(Math.sin(t * 4))) - ringMat.opacity) * Math.min(1, dt * 4);
    ring.rotation.z += dt * (L === 2 ? 0.8 : 0.25);
    wave = (wave + dt * 0.8) % 1;
    waves.forEach((w, i) => { const k = (wave + i * 0.5) % 1; w.visible = L === 2; w.scale.setScalar(1 + k * 0.9); w.material.opacity = (1 - k) * 0.8 });
    // network -> aurora (gentle; it's information, not alarm)
    const n = h.net || {};
    AU.uAurN.value += (Math.min(0.8, Math.log10((n.down || 0) + 1) / 8) - AU.uAurN.value) * Math.min(1, dt);
    AU.uAurS.value += (Math.min(0.8, Math.log10((n.up || 0) + 1) / 8) - AU.uAurS.value) * Math.min(1, dt);
    // fans -> storms; a stopped fan dims the weather
    const fans = (h.fans || []).filter(f => f.rpm > 0);
    const big = fans.slice().sort((a, b) => b.rpm - a.rpm).slice(0, MAXS), maxR = Math.max(1500, ...fans.map(f => f.rpm));
    CU.uNS.value = big.length; big.forEach((f, i) => { CU.uStorm.value[i].w = Math.min(1, f.rpm / maxR) });
    const wind = fans.length ? fans.reduce((a, f) => a + f.rpm, 0) / fans.length / 1000 : 0.2;
    sm.wind += (wind - sm.wind) * Math.min(1, dt * 0.5); CU.uWind.value = sm.wind;
    CU.uDim.value = (h.checks || []).some(c => c.sys === 'fan' && c.level) ? 1 : 0;
    // CPU load -> spin
    sm.load += ((h.cpu || 0) / 100 - sm.load) * Math.min(1, dt);
    spinG.rotation.y += dt * (0.04 + sm.load * 0.9); clouds.rotation.y += dt * 0.01 * (1 + sm.wind);
    // GPU moon
    const hasGpu = h.gpu != null || h.gpuT != null;
    moonG.visible = hasGpu;
    if (hasGpu) {
      const gl = Math.max(lvlOf(h.gpuT, 83, 90), lvlOf(h.gpuHot, 95, 105), lvlOf(h.gpuMemT, 95, 105));
      sm.gl += (Math.min(1, (h.gpu || 0) / 100) - sm.gl) * Math.min(1, dt * 2);
      const c = new THREE.Color(LEVEL_COL[gl]), beat = gl === 2 ? 0.6 + 0.4 * Math.abs(Math.sin(t * 4)) : 1;
      moonMat.emissive.copy(c); moonMat.emissiveIntensity = (0.12 + sm.gl * 1.5) * beat;
      moonGlow.material.color.copy(c).multiplyScalar((0.15 + sm.gl * 0.9) * beat);
      const f = h.vram && h.vram[1] ? h.vram[0] / h.vram[1] : 0;
      if (Math.abs(f - vf) > 0.01) { vf = f; vramArc.geometry.dispose(); vramArc.geometry = new THREE.TorusGeometry(R * 0.24, 0.018, 6, 64, Math.max(0.01, f * Math.PI * 2)); vramArc.material.color.copy(hdr(f > 0.92 ? LEVEL_COL[1] : '#c9a45c', 1.6)) }
      ma += dt * 0.22; moonG.position.set(Math.cos(ma) * R * 2.35, Math.sin(ma * 0.6) * R * 0.4, Math.sin(ma) * R * 2.35); moon.rotation.y += dt * 0.3;
    }
  }
  function dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose() }) }
  return { group, planet: surf, pickables: [surf, moon], update, dispose, R };
}

// hover card: the verdict, every check with its rating, and how to read the planet
export function livingLegend(H) {
  if (!H || H.__error) return '';
  const L = H.level || 0, dot = l => `<span style="color:${LEVEL_COL[l]}">●</span>`;
  let h = `<div class="row"><span>status</span><b style="color:${LEVEL_COL[L]}">${LEVEL_WORD[L]}${(H.why || []).length ? ' · ' + esc(H.why[0]) : ''}</b></div>`;
  (H.checks || []).filter(c => c.level || ['CPU temperature', 'CPU load', 'Memory in use', 'GPU temperature', 'Fans spinning'].includes(c.label) || /full$/.test(c.label))
    .slice(0, 10).forEach(c => { h += `<div class="row"><span>${dot(c.level)} ${esc(c.label).slice(0, 26)}</span><b style="${c.level ? 'color:' + LEVEL_COL[c.level] : ''}">${esc(c.value)}</b></div>` });
  h += `<div class="row" style="margin-top:4px"><span style="color:var(--faint);white-space:normal;line-height:1.4">continents = drives (settled = used) · sea level = RAM · spin = CPU load · moon = GPU (arc = VRAM) · storms = fans · fire and fissures = overheating · ring = needs attention</span></div>`;
  return h;
}
