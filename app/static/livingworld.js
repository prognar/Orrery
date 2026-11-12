// ORRERY · 3D — a living planet for a machine that reports its health. Green, yellow, red: Eden to Hellscape.
//
//   land and sea  = climate: the slow things (drives filling up, drives wearing out)
//                   lush green  ->  drought, dry yellow land and murky sea  ->  scorched earth, lava and a red sea
//   sky and cloud = weather: the fast things (CPU and GPU temperature, memory, fans)
//                   clear blue sky, white cloud  ->  amber haze and dust  ->  burning red sky, smoke and embers
//   cloud speed   = how busy it is (CPU load)
//
// Stress comes from the server (health.assess: 0 calm, 1 needs attention, 2 critical, smooth in between),
// so the planet, its label and the hover card always tell the same story.
import * as THREE from 'three';

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
vec3 ramp3(vec3 a, vec3 b, vec3 c, float s){ return s < 1. ? mix(a, b, s) : mix(b, c, s - 1.); }
`;

const VERT = /* glsl */`
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.); vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp; }`;

// land and sea: climate
const SURF = /* glsl */`
uniform float uTime, uClimate, uSeed; uniform vec3 uSun;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vN);
  float s = uClimate;
  float h = fbm(n*1.8 + uSeed), detail = fbm(n*7. + uSeed*1.7);
  float sea = .5 - smoothstep(1., 2., s)*.08;                          // the sea shrinks as it boils away
  float lat = abs(n.y);
  vec3 col; vec3 emit = vec3(0.);
  float lit = clamp(dot(normalize(vWN), uSun), 0., 1.);
  if(h < sea){
    float depth = clamp((sea - h)*6., 0., 1.);
    vec3 eden = mix(vec3(.12,.45,.6), vec3(.03,.14,.3), depth);
    vec3 dry  = mix(vec3(.3,.42,.33), vec3(.12,.2,.18), depth);
    vec3 hell = mix(vec3(.45,.09,.03), vec3(.18,.03,.02), depth);
    col = ramp3(eden, dry, hell, s);
    emit += vec3(1.,.25,.05) * smoothstep(1.4, 2., s) * (1.-depth) * (.35 + .25*sin(uTime*2. + h*40.));   // the sea glows like magma
    vec3 v = normalize(cameraPosition - vWP), r = reflect(-uSun, normalize(vWN));
    emit += vec3(1.,.95,.85) * pow(max(dot(r,v),0.), 160.) * .18 * lit * (1. - smoothstep(1., 2., s));
  } else {
    float e = clamp((h - sea)*3., 0., 1.);
    vec3 eden = mix(mix(vec3(.17,.42,.16), vec3(.3,.5,.2), detail), vec3(.42,.4,.34), smoothstep(.55,.9,e));
    vec3 dry  = mix(mix(vec3(.72,.6,.32), vec3(.58,.42,.22), detail), vec3(.52,.44,.36), smoothstep(.55,.9,e));
    vec3 hell = mix(vec3(.09,.05,.04), vec3(.2,.08,.05), detail);
    col = ramp3(eden, dry, hell, s);
    col = mix(col, vec3(.92,.94,.97), smoothstep(.78, .9, lat) * (1. - smoothstep(.3, 1.2, s)));   // ice caps melt as it heats
    // hellscape: lava cracks open across the land
    float c = abs(fbm(n*4.5 + uSeed*2.) - .5);
    float crack = (1. - smoothstep(.0, .02, c)) * smoothstep(1.2, 1.9, s);
    emit += vec3(1.,.32,.06) * crack * (1.4 + .6*sin(uTime*3. + n.x*9.));
  }
  gl_FragColor = vec4(col * (.1 + .85*lit) + emit, 1.);
  #include <colorspace_fragment>
}`;

// clouds: weather (white -> dust -> smoke), their speed is how busy the machine is
const CLOUD = /* glsl */`
uniform float uTime, uWeather, uBusy, uSeed; uniform vec3 uSun;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vN), s3 = vec3(0.,1.,0.);
  float t = uTime * (.15 + uBusy*1.6);
  // a single storm whose swirl tightens as the machine works harder
  float d = acos(clamp(dot(n, normalize(vec3(.4,.35,.85))), -1., 1.)), w = pow(max(0., 1. - d/.9), 2.);
  float a = w * (t*1.2 + uBusy*4.);
  vec3 q = n*cos(a) + cross(normalize(vec3(.4,.35,.85)), n)*sin(a);
  float c = fbm(q*3. + vec3(t*.12, 0., t*.05) + uSeed);
  float cover = smoothstep(.6 - uBusy*.08, .86, c) * (.45 + w*uBusy*.45);
  vec3 tint = ramp3(vec3(.95), vec3(.78,.62,.38), vec3(.16,.1,.09), uWeather);
  float lit = clamp(dot(normalize(vWN), uSun), 0., 1.);
  vec3 col = tint * (.14 + .75*lit);
  col += vec3(1.,.4,.1) * smoothstep(1.5, 2., uWeather) * step(.93, fbm(n*30. + vec3(0., -uTime*.6, 0.))) * 2.;   // embers in the smoke
  gl_FragColor = vec4(col, cover * (.75 + uWeather*.1));
  #include <colorspace_fragment>
}`;

// sky: weather colour, pulsing when critical
const ATMO = /* glsl */`
uniform float uTime, uWeather; uniform vec3 uSun;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
void main(){
  vec3 v = normalize(cameraPosition - vWP);
  float rim = pow(1. - abs(dot(normalize(vWN), v)), 2.2);
  float lit = .45 + .55*clamp(dot(normalize(vWN), uSun)*.5+.5, 0., 1.);
  vec3 sky = ramp3(vec3(.4,.7,1.), vec3(1.,.66,.25), vec3(1.,.15,.1), uWeather);
  float beat = uWeather > 1.5 ? .6 + .6*abs(sin(uTime*3.)) : 1.;
  gl_FragColor = vec4(sky * rim * lit * beat * (1. + uWeather*.45), rim);
  #include <colorspace_fragment>
}`;

const hash = str => [...String(str)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

export function makeLiving({ seed, R = 1.35 }) {
  const sd = (hash(seed) % 1000) / 10;
  const group = new THREE.Group();
  const sunU = { value: new THREE.Vector3(1, 0, 0) }, time = { value: 0 };
  const U = { uTime: time, uSun: sunU, uSeed: { value: sd }, uClimate: { value: 0 } };
  const CU = { uTime: time, uSun: sunU, uSeed: { value: sd + 11 }, uWeather: { value: 0 }, uBusy: { value: 0 } };
  const AU = { uTime: time, uSun: sunU, uWeather: CU.uWeather };
  const surf = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: SURF }));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 80, 56), new THREE.ShaderMaterial({ uniforms: CU, vertexShader: VERT, fragmentShader: CLOUD, transparent: true, depthWrite: false }));
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 64, 48), new THREE.ShaderMaterial({ uniforms: AU, vertexShader: VERT, fragmentShader: ATMO, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const spinG = new THREE.Group(); spinG.rotation.set(0.32, 0, 0.18); spinG.add(surf, clouds); group.add(spinG, atmo);
  const sm = { c: 0, w: 0, busy: 0 };

  function update(H, dt, t, sunWorld) {
    time.value = t;
    group.updateMatrixWorld();
    sunU.value.copy(sunWorld).sub(group.getWorldPosition(new THREE.Vector3())).normalize();
    const h = H && !H.__error ? H : {};
    // climate drifts slowly, weather moves fast, both toward the server's stress (0 Eden .. 2 Hellscape);
    // the first reading applies at once so a page doesn't fade in from Eden
    if (!sm.seen && H && !H.__error) { sm.seen = true; sm.c = h.climate || 0; sm.w = h.weather || 0; sm.busy = (h.cpu || 0) / 100 }
    sm.c += ((h.climate || 0) - sm.c) * Math.min(1, dt * 0.4);
    sm.w += ((h.weather || 0) - sm.w) * Math.min(1, dt * 2.5);
    sm.busy += ((h.cpu || 0) / 100 - sm.busy) * Math.min(1, dt * 1.5);
    U.uClimate.value = sm.c; CU.uWeather.value = sm.w; CU.uBusy.value = sm.busy;
    spinG.rotation.y += dt * 0.05;
  }
  function dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose() }) }
  return { group, planet: surf, pickables: [surf], update, dispose, R };
}

// hover card: verdict, the two layers, and only the readings that matter
export function livingLegend(H) {
  if (!H || H.__error) return '';
  const L = H.level || 0, word = s => s >= 1.5 ? ['hellscape', 2] : s >= 0.75 ? ['drought', 1] : ['eden', 0];
  const row = (a, b, st = '') => `<div class="row"><span>${a}</span><b style="${st}">${b}</b></div>`;
  const [cw, cl] = word(H.climate || 0), [ww, wl] = word(H.weather || 0);
  let h = row('status', `${LEVEL_WORD[L]}${(H.why || []).length ? ' · ' + esc(H.why[0]) : ''}`, `color:${LEVEL_COL[L]}`);
  h += row('land · storage (slow)', cw, `color:${LEVEL_COL[cl]}`) + row('sky · heat &amp; memory (fast)', ww, `color:${LEVEL_COL[wl]}`);
  const key = (H.checks || []).filter(c => c.level || ['CPU temperature', 'GPU temperature', 'Memory in use', 'CPU load'].includes(c.label) || /full$/.test(c.label));
  key.slice(0, 7).forEach(c => { h += row(`<span style="color:${LEVEL_COL[c.level]}">●</span> ${esc(c.label).slice(0, 26)}`, esc(c.value), c.level ? `color:${LEVEL_COL[c.level]}` : '') });
  return h;
}
