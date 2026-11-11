// ORRERY · 3D — a living planet for a machine that reports its health.
//
//   continents      one per drive, sized by capacity; cities spread as it fills, the coast glows red at 90%+
//   city flicker    drive reads (cyan) and writes (amber)
//   sea level       RAM: the water rises as memory fills and floods the coasts under pressure
//   wildfires       CPU load: one fire site per core / thread, burning as hard as that core
//   sky colour      CPU temperature: blue haze, amber, then a red pulse at 85 °C+
//   weather         fans: every spinning fan is a cyclone, sized and spun by its RPM; airflow drives the clouds
//   forge moon      the GPU: lava cracks glow with load, burn whiter with heat, widen as VRAM fills
//   aurora          network: green curtains in the north for download, magenta in the south for upload
//   night lights    power draw (CPU + GPU watts)
//
// Lit from the orrery's sun, so it has a real day and night side. Every input is optional: a machine that reports
// little is simply a quiet world.
import * as THREE from 'three';

const MAXD = 6, MAXF = 16, MAXS = 8;

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
uniform float uTime, uSea, uCity, uSeaAlarm, uSeed; uniform vec3 uSun;
uniform vec4 uDisk[${MAXD}]; uniform vec4 uDiskA[${MAXD}]; uniform int uND;
uniform vec4 uFire[${MAXF}]; uniform int uNF;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vN);
  // terrain: a continent per drive, ragged coasts, a few islands
  float h = (fbm(n*4.2+uSeed)-.66)*.8; int own = -1;
  for(int i=0;i<${MAXD};i++){ if(i>=uND) break;
    float d = dot(n, uDisk[i].xyz) + (fbm(n*2.6+float(i)*7.3+uSeed)-.5)*.42;
    float hi = smoothstep(cos(uDisk[i].w), cos(uDisk[i].w*.45), d) * .8 + smoothstep(cos(uDisk[i].w*.45), 1., d) * .2;
    if(hi > h){ h = hi; own = i; } }
  float sea = uSea, coast = h - sea;
  vec3 col; vec3 emit = vec3(0.);
  float lit = clamp(dot(normalize(vWN), uSun), 0., 1.), night = smoothstep(.12, -.25, dot(normalize(vWN), uSun));
  if(coast < 0.){                                                     // ocean
    float depth = clamp(-coast*3., 0., 1.);
    col = mix(vec3(.17,.43,.55), vec3(.04,.12,.24), depth);
    col = mix(col, vec3(.25,.06,.08), uSeaAlarm*.55*(1.-depth*.5));   // memory pressure: a dark red sea
    vec3 v = normalize(cameraPosition - vWP), r = reflect(-uSun, normalize(vWN));
    emit += vec3(1.,.95,.85) * pow(max(dot(r,v),0.), 180.) * .22 * lit;
  } else {                                                            // land
    vec4 a = own >= 0 ? uDiskA[own] : vec4(0.,0.,0.,0.);              // used, heat, read, write
    float elev = clamp(coast*2.2, 0., 1.);
    vec3 lush = vec3(.22,.38,.19), arid = vec3(.62,.5,.32), rock = vec3(.42,.38,.34), scorch = vec3(.48,.2,.12);
    col = mix(lush, arid, clamp(a.y*.9 + elev*.35, 0., 1.)); col = mix(col, rock, smoothstep(.55,.9,elev));
    col = mix(col, scorch, smoothstep(.75, 1., a.y));                // drive near its warning temperature
    // cities: fill the continent as the drive fills
    float cell = snoise(n*38.+uSeed*3.)*.5+.5, grow = snoise(n*6.+float(own)*3.1)*.5+.5;
    float city = step(1.-a.x*1.05, grow*.85+.08) * smoothstep(.5,.72,cell);
    col = mix(col, vec3(.36,.33,.3), city*.62);                        // built-up: warm concrete, greenery still shows between
    float io = clamp(a.z+a.w, 0., 1.), flick = step(.6, snoise(n*60.+vec3(uTime*6.)) * .5 + .5);
    emit += city * (vec3(1.,.72,.38) * (.25 + 1.6*uCity) * night + vec3(.25,.85,1.)*a.z*flick*1.4 + vec3(1.,.55,.15)*a.w*flick*1.4);
    // nearly full drive: the coastline burns
    float full = smoothstep(.88, .95, a.x);
    emit += vec3(1.,.15,.1) * full * smoothstep(.05,0.,coast) * (.6+.4*sin(uTime*4.)) * 1.8;
  }
  // wildfires = CPU cores
  for(int i=0;i<${MAXF};i++){ if(i>=uNF) break;
    float I = uFire[i].w; if(I < .02) continue;
    float d = acos(clamp(dot(n, uFire[i].xyz), -1., 1.));
    float rad = .03 + .1*I, flame = fbm(n*22. + vec3(0., -uTime*1.8, uTime*.7) + float(i));
    float f = smoothstep(rad, rad*.25, d + (flame-.5)*rad*.9);
    col = mix(col, vec3(.07,.05,.04), smoothstep(rad*1.8, rad*.6, d)*.75*I);       // burnt ground
    emit += mix(vec3(.95,.16,.02), vec3(1.,.62,.18), flame*flame) * f * (.7 + 1.1*I);
  }
  vec3 c = col * (.1 + .8*lit) + emit;
  gl_FragColor = vec4(c, 1.);
  #include <colorspace_fragment>
}`;

const CLOUD = /* glsl */`
uniform float uTime, uWind, uSeed; uniform vec3 uSun; uniform vec4 uStorm[${MAXS}]; uniform int uNS;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vN); float band = 0.;
  // cyclones: one per spinning fan; twist the cloud field around each eye
  for(int i=0;i<${MAXS};i++){ if(i>=uNS) break;
    vec3 s = uStorm[i].xyz; float k = uStorm[i].w, size = .25 + .35*k;
    float d = acos(clamp(dot(n, s), -1., 1.));
    if(d < size){ float w = pow(1.-d/size, 2.); n = rotAxis(n, s, w * (uTime*(1.+5.*k) + 6.*k)); band = max(band, w*k); } }
  vec3 drift = vec3(uTime*uWind*.05, 0., uTime*uWind*.02);
  float c = fbm(n*3.2 + drift + uSeed);
  float a = smoothstep(.6 - band*.22, .86, c) * (.4 + band*.5);
  float lit = clamp(dot(normalize(vWN), uSun), 0., 1.);
  gl_FragColor = vec4(vec3(.9) * (.12 + .7*lit), a * .8);
  #include <colorspace_fragment>
}`;

const ATMO = /* glsl */`
uniform float uTime, uAlarm, uAurN, uAurS; uniform vec3 uSky, uSun;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vN), v = normalize(cameraPosition - vWP);
  float rim = pow(1. - abs(dot(normalize(vWN), v)), 2.4);
  float lit = .35 + .65*clamp(dot(normalize(vWN), uSun)*.5+.5, 0., 1.);
  vec3 c = uSky * rim * lit * (1. + uAlarm*(.6+.6*sin(uTime*5.)));
  // aurora: download in the north, upload in the south
  float lon = atan(n.z, n.x);
  float cur = snoise(vec3(lon*5., uTime*.35, 1.)) * .5 + .5;
  float north = smoothstep(.58, .74, n.y) * (1.-smoothstep(.86, .97, n.y)) * cur * uAurN;
  float south = smoothstep(.58, .74, -n.y) * (1.-smoothstep(.86, .97, -n.y)) * cur * uAurS;
  c += vec3(.2,1.,.45)*north*1.6 + vec3(1.,.25,.85)*south*1.6;
  gl_FragColor = vec4(c, clamp(rim + north + south, 0., 1.));
  #include <colorspace_fragment>
}`;

const FORGE = /* glsl */`
uniform float uTime, uLoad, uVram, uHot, uSeed; uniform vec3 uLava, uSun;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vN);
  float c = abs(fbm(n*3.6+uSeed) - .5);
  float crack = 1. - smoothstep(.0, .018 + .07*uVram, c);
  float glow = crack * (.25 + 3.2*uLoad) * (.85 + .15*sin(uTime*7. + n.x*9.));
  float pool = smoothstep(.62, .8, fbm(n*2.+uSeed*2.)) * uLoad;
  float lit = clamp(dot(normalize(vWN), uSun), 0., 1.);
  vec3 rock = vec3(.12,.1,.1) * (.2 + .9*lit);
  vec3 c2 = rock + uLava * (glow + pool*1.4) * (1. + uHot*(.5+.5*sin(uTime*6.)));
  gl_FragColor = vec4(c2, 1.);
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- helpers
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 }
const hash = str => [...String(str)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const dirFrom = r => { const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u); return new THREE.Vector3(s * Math.cos(a), u * 0.85, s * Math.sin(a)).normalize() };
const lerp3 = (stops, x) => {         // [[x, '#hex'], ...] -> THREE.Color
  for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) { const [x0, c0] = stops[i - 1], [x1, c1] = stops[i]; return new THREE.Color(c0).lerp(new THREE.Color(c1), (x - x0) / (x1 - x0)) }
  return new THREE.Color(stops[stops.length - 1][1]);
};
const SKY = [[0, '#5fa8ff'], [50, '#6fb7ff'], [68, '#ffb347'], [80, '#ff6a3d'], [90, '#ff2b2b']];
const LAVA = [[0, '#ff3a0a'], [55, '#ff4a10'], [72, '#ff9a3a'], [85, '#ffe08a'], [95, '#ffffff']];
export const HOT_C = 85;

export function makeLiving({ seed, R = 1.35, glowTex, hdr }) {
  const r = rng(hash(seed)), sd = (r() * 100);
  const group = new THREE.Group();
  const sunU = { value: new THREE.Vector3(1, 0, 0) }, time = { value: 0 };
  const geo = new THREE.SphereGeometry(R, 96, 64);
  // continents and fire sites are placed once from the seed, so a machine always looks like itself
  const diskDirs = Array.from({ length: MAXD }, () => dirFrom(r));
  const fireOff = Array.from({ length: MAXF }, () => dirFrom(r)), fireDirs = fireOff.map(o => o.clone());
  let fireND = -1;
  const stormDirs = Array.from({ length: MAXS }, () => dirFrom(r));
  const U = {
    uTime: time, uSun: sunU, uSeed: { value: sd }, uSea: { value: 0.3 }, uCity: { value: 0.3 }, uSeaAlarm: { value: 0 },
    uDisk: { value: diskDirs.map(d => new THREE.Vector4(d.x, d.y, d.z, 0.9)) }, uDiskA: { value: diskDirs.map(() => new THREE.Vector4()) }, uND: { value: 1 },
    uFire: { value: fireDirs.map(d => new THREE.Vector4(d.x, d.y, d.z, 0)) }, uNF: { value: 0 },
  };
  const surf = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: SURF }));
  const CU = { uTime: time, uSun: sunU, uSeed: { value: sd + 11 }, uWind: { value: 0.3 }, uStorm: { value: stormDirs.map(d => new THREE.Vector4(d.x, d.y, d.z, 0)) }, uNS: { value: 0 } };
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 80, 56), new THREE.ShaderMaterial({ uniforms: CU, vertexShader: VERT, fragmentShader: CLOUD, transparent: true, depthWrite: false }));
  const AU = { uTime: time, uSun: sunU, uSky: { value: new THREE.Color('#6fb7ff') }, uAlarm: { value: 0 }, uAurN: { value: 0 }, uAurS: { value: 0 } };
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 64, 48), new THREE.ShaderMaterial({ uniforms: AU, vertexShader: VERT, fragmentShader: ATMO, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide }));
  const tilt = new THREE.Group(); tilt.rotation.set(0.32, 0, 0.18); tilt.add(surf, clouds); group.add(tilt, atmo);
  // the forge moon (GPU)
  const FU = { uTime: time, uSun: sunU, uSeed: { value: sd + 5 }, uLoad: { value: 0 }, uVram: { value: 0 }, uHot: { value: 0 }, uLava: { value: new THREE.Color('#ff4a10') } };
  const forge = new THREE.Mesh(new THREE.SphereGeometry(R * 0.3, 48, 32), new THREE.ShaderMaterial({ uniforms: FU, vertexShader: VERT, fragmentShader: FORGE }));
  const forgeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr('#ff6a2a', 1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  forgeGlow.scale.setScalar(R * 1.1);
  const forgeG = new THREE.Group(); forgeG.add(forge, forgeGlow); forgeG.visible = false; group.add(forgeG);
  const sparks = Array.from({ length: 14 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr('#ffb050', 2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.setScalar(0.09); s.userData = { k: Math.random(), d: dirFrom(Math.random).clone() }; forgeG.add(s); return s });
  let fa = r() * 6.28, spin = 0, last = null;
  const sm = { cpu: 0, ram: 0.5, wind: 0.3 };

  function update(H, dt, t, sunWorld) {
    time.value = t; last = H;
    group.updateMatrixWorld();
    const wp = group.getWorldPosition(new THREE.Vector3());
    sunU.value.copy(sunWorld).sub(wp).normalize();
    const h = H && !H.__error ? H : {};
    // drives -> continents (size by capacity share), cities by fill, heat by temperature vs warning
    const disks = (h.disks || []).slice(0, MAXD);
    const tot = disks.reduce((a, d) => a + (d.size || 1), 0) || 1;
    U.uND.value = Math.max(1, disks.length);
    if (U.uND.value !== fireND) {        // fire sites sit on the continents that exist
      fireND = U.uND.value;
      fireDirs.forEach((d, i) => { d.copy(diskDirs[i % fireND]).addScaledVector(fireOff[i], 0.45).normalize(); U.uFire.value[i].set(d.x, d.y, d.z, U.uFire.value[i].w) });
    }
    for (let i = 0; i < MAXD; i++) {
      const d = disks[i];
      const share = d ? (d.size || 1) / tot : 1;
      U.uDisk.value[i].w = disks.length ? 0.45 + 0.75 * Math.sqrt(share) : 0.85;
      const warn = d && d.tWarn ? d.tWarn : 70;
      U.uDiskA.value[i].set(d && d.used != null ? d.used / 100 : 0.3, d && d.t != null ? Math.max(0, Math.min(1, (d.t - 30) / Math.max(5, warn - 30))) : 0,
        d ? Math.min(1, Math.log10((d.read || 0) + 1) / 8) : 0, d ? Math.min(1, Math.log10((d.write || 0) + 1) / 8) : 0);
    }
    // RAM -> sea level (eased so it creeps rather than jumps)
    const ram = h.ramPct != null ? h.ramPct / 100 : 0.4;
    sm.ram += (ram - sm.ram) * Math.min(1, dt * 0.8);
    U.uSea.value = 0.08 + sm.ram * 0.38; U.uSeaAlarm.value = Math.max(0, (sm.ram - 0.88) / 0.12);
    // CPU cores -> wildfires
    const cores = (h.cores && h.cores.length ? h.cores : h.cpu != null ? [h.cpu] : []).slice(0, MAXF);
    U.uNF.value = cores.length;
    cores.forEach((c, i) => { const v = U.uFire.value[i]; v.w += (Math.min(1, c / 100) - v.w) * Math.min(1, dt * 2) });
    // power -> night lights
    U.uCity.value = Math.max(0.15, Math.min(1, ((h.cpuW || 0) + (h.gpuW || 0)) / 400));
    // CPU temperature -> sky
    const T = h.cpuT;
    AU.uSky.value.copy(lerp3(SKY, T != null ? T : 40)).multiplyScalar(0.9);
    AU.uAlarm.value = T != null && T >= HOT_C ? 1 : 0;
    // network -> aurora
    const n = h.net || {};
    AU.uAurN.value += (Math.min(1, Math.log10((n.down || 0) + 1) / 7.5) - AU.uAurN.value) * Math.min(1, dt);
    AU.uAurS.value += (Math.min(1, Math.log10((n.up || 0) + 1) / 7.5) - AU.uAurS.value) * Math.min(1, dt);
    // fans -> cyclones and wind
    const fans = (h.fans || []).filter(f => f.rpm > 0).slice(0, MAXS);
    const maxR = Math.max(2000, ...fans.map(f => f.rpm));
    CU.uNS.value = fans.length;
    fans.forEach((f, i) => { CU.uStorm.value[i].w = Math.min(1, f.rpm / maxR) });
    const wind = fans.length ? fans.reduce((a, f) => a + f.rpm, 0) / fans.length / 1000 : 0.25;
    sm.wind += (wind - sm.wind) * Math.min(1, dt * 0.5); CU.uWind.value = sm.wind;
    // GPU -> forge moon
    const hasGpu = h.gpu != null || h.gpuT != null;
    forgeG.visible = hasGpu;
    if (hasGpu) {
      const L = Math.min(1, (h.gpu || 0) / 100);
      FU.uLoad.value += (L - FU.uLoad.value) * Math.min(1, dt * 2);
      FU.uVram.value = h.vram && h.vram[1] ? h.vram[0] / h.vram[1] : 0.2;
      const gt = Math.max(h.gpuT || 0, (h.gpuHot || 0) - 8);
      FU.uLava.value.copy(lerp3(LAVA, gt || 50)); FU.uHot.value = gt >= HOT_C ? 1 : 0;
      forgeGlow.material.color.copy(FU.uLava.value).multiplyScalar(0.25 + FU.uLoad.value * 1.2);
      const gfan = (h.fans || []).filter(f => f.gpu).reduce((a, f) => Math.max(a, f.rpm), 0);
      fa += dt * 0.18; spin += dt * (0.2 + gfan / 1200);
      forgeG.position.set(Math.cos(fa) * R * 1.75, Math.sin(fa * 0.7) * R * 0.45, Math.sin(fa) * R * 1.75); forge.rotation.y = spin;
      sparks.forEach(s => {        // eruptions: more and faster with GPU power
        const u = s.userData; u.k += dt * (0.4 + FU.uLoad.value * 1.6);
        if (u.k > 1) { u.k = 0; u.d = dirFrom(Math.random) }
        s.visible = FU.uLoad.value > 0.08 && Math.random() < 0.95;
        s.position.copy(u.d).multiplyScalar(R * 0.3 * (1 + u.k * 1.6 * FU.uLoad.value));
        s.material.opacity = (1 - u.k) * Math.min(1, FU.uLoad.value * 2);
      });
    }
    // rotation: the world turns; clouds drift a little faster
    tilt.rotation.y += dt * 0.05; clouds.rotation.y += dt * 0.012 * (1 + sm.wind);
  }
  function dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose() }) }
  return { group, planet: surf, pickables: [surf, forge], forge, update, dispose, R };
}

// hover legend + the numbers behind each effect
export function livingLegend(H) {
  if (!H || H.__error) return '';
  const r = (a, b) => `<div class="row"><span>${a}</span><b>${b}</b></div>`, f = (v, u = '', d = 0) => v == null ? '—' : v.toFixed(d) + u;
  const disks = (H.disks || []).map(d => `${f(d.used, '%')}${d.t != null ? ' · ' + f(d.t, '°') : ''}`).join(' / ');
  const busy = (H.cores || []).filter(c => c >= 50).length;
  const fans = (H.fans || []).filter(x => x.rpm > 0);
  return '<div class="row"><span style="color:var(--brass)"><i>reading the planet</i></span><b></b></div>'
    + r('🏙 continents = drives', disks || '—')
    + r('🌊 sea level = RAM', f(H.ramPct, '%'))
    + r('🔥 fires = CPU cores', `${f(H.cpu, '%')}${(H.cores || []).length ? ` · ${busy} of ${H.cores.length} ablaze` : ''}`)
    + r('🌅 sky = CPU temp', f(H.cpuT, '°C'))
    + r('🌀 storms = fans', fans.length ? `${fans.length} · ${Math.max(...fans.map(x => x.rpm)).toFixed(0)} rpm max` : '—')
    + (H.gpu != null || H.gpuT != null ? r('🌋 forge moon = GPU', `${f(H.gpu, '%')} · ${f(H.gpuT, '°C')}${H.vram ? ' · ' + (H.vram[0] / H.vram[1] * 100).toFixed(0) + '% vram' : ''}`) : '')
    + (H.net ? r('🌌 aurora = network', `↓ ${fmtR(H.net.down || 0)} · ↑ ${fmtR(H.net.up || 0)}`) : '')
    + ((H.cpuW || H.gpuW) ? r('✨ night lights = power', f((H.cpuW || 0) + (H.gpuW || 0), ' W')) : '');
}
