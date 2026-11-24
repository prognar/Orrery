// ORRERY · 3D — a living planet for a machine on your network. Green, yellow, red: Eden to Hellscape.
//
//   land and sea  = climate: the slow things (drives and pools filling, drives wearing out, backups getting old)
//   sky and cloud = weather: the fast things (temperatures, memory, the internet, cameras, a dead service)
//   cloud speed   = how busy it is (CPU load)
//
// Every preset shares that language but has its own surface, so you can tell WHAT a machine is at a glance:
//   earth (desktop, laptop, server, game), ice (backup: it melts as the last good backup gets old),
//   gas bands (NAS, router), obsidian (DNS), city lights (home hub: dead devices are dark districts),
//   forge (AI box: veins glow with GPU load), rock (printer, cameras).
// Stress comes from the server (worlds._combine: 0 calm, 1 needs attention, 2 critical, smooth in between).
import * as THREE from 'three';

export const LEVEL_COL = ['#5fb3a1', '#f0a63a', '#e2453c'];
export const LEVEL_WORD = ['OK', 'ATTENTION', 'CRITICAL'];
export const STYLE = { earth: 0, ice: 1, gas: 2, obsidian: 3, city: 4, forge: 5, rock: 6 };
const CLOUDS = [1, .45, 0, 0, .55, .3, 0];
const SKY0 = [[.4, .7, 1], [.7, .92, 1], [.55, .8, .95], [.3, .95, .85], [.45, .6, 1], [.5, .8, 1], [.62, .66, .72]];

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

// the surface: climate, in the preset's own materials
const SURF = /* glsl */`
uniform float uTime, uClimate, uWeather, uSeed, uStyle, uLoad, uDark, uSleep; uniform vec3 uSun;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
vec3 lavaCracks(vec3 n, float s, float k){
  float c = abs(fbm(n*4.5 + uSeed*2.) - .5);
  return vec3(1.,.32,.06) * (1. - smoothstep(.0, .02, c)) * smoothstep(1.2, 1.9, s) * k * (1.4 + .6*sin(uTime*3. + n.x*9.));
}
void main(){
  vec3 n = normalize(vN);
  float s = uClimate, w = uWeather;
  float h = fbm(n*1.8 + uSeed), detail = fbm(n*7. + uSeed*1.7);
  float lat = abs(n.y);
  float lit = clamp(dot(normalize(vWN), uSun), 0., 1.);
  vec3 col = vec3(.5); vec3 emit = vec3(0.);
  int st = int(uStyle + .5);
  if(st == 0 || st == 4){                                         // earth, and the home hub's lit cities
    float sea = .5 - smoothstep(1., 2., s)*.08;
    if(h < sea){
      float depth = clamp((sea - h)*6., 0., 1.);
      col = ramp3(mix(vec3(.12,.45,.6), vec3(.03,.14,.3), depth), mix(vec3(.3,.42,.33), vec3(.12,.2,.18), depth), mix(vec3(.45,.09,.03), vec3(.18,.03,.02), depth), s);
      emit += vec3(1.,.25,.05) * smoothstep(1.4, 2., s) * (1.-depth) * (.35 + .25*sin(uTime*2. + h*40.));
      vec3 v = normalize(cameraPosition - vWP), r = reflect(-uSun, normalize(vWN));
      emit += vec3(1.,.95,.85) * pow(max(dot(r,v),0.), 160.) * .18 * lit * (1. - smoothstep(1., 2., s));
    } else {
      float e = clamp((h - sea)*3., 0., 1.);
      vec3 eden = mix(mix(vec3(.17,.42,.16), vec3(.3,.5,.2), detail), vec3(.42,.4,.34), smoothstep(.55,.9,e));
      vec3 dry  = mix(mix(vec3(.72,.6,.32), vec3(.58,.42,.22), detail), vec3(.52,.44,.36), smoothstep(.55,.9,e));
      col = ramp3(eden, dry, mix(vec3(.09,.05,.04), vec3(.2,.08,.05), detail), s);
      col = mix(col, vec3(.92,.94,.97), smoothstep(.78, .9, lat) * (1. - smoothstep(.3, 1.2, s)));
      emit += lavaCracks(n, s, 1.);
      if(st == 4){                                                // city lights; dead devices are dark districts
        float city = smoothstep(.62, .75, fbm(n*16. + uSeed*3.)) * smoothstep(.25, .6, e + .3);
        float district = fbm(n*2.6 + uSeed*5.);
        float alive = smoothstep(uDark*2.4 - .02, uDark*2.4 + .04, district);
        float night = 1. - smoothstep(.0, .35, lit);
        emit += vec3(1.,.78,.42) * city * alive * (.25 + 1.3*night);
        emit += vec3(1.,.2,.1) * city * (1. - alive) * .12 * night;   // a faint red glow where the lights went out
      }
    }
  } else if(st == 1){                                             // ice: melts as the last good backup gets old
    float melt = smoothstep(.25, 1.6, s);
    float pool = 1. - smoothstep(melt*.55 - .04, melt*.55 + .02, h);
    vec3 ice = mix(vec3(.86,.92,.98), vec3(.62,.76,.9), detail*.8);
    float frac = 1. - smoothstep(.0, .015, abs(fbm(n*6. + uSeed) - .5));
    ice = mix(ice, vec3(.45,.62,.8), frac*.5);
    vec3 slush = mix(vec3(.5,.55,.58), vec3(.36,.4,.42), detail);
    col = mix(ice, slush, smoothstep(.6, 1.4, s));
    col = mix(col, ramp3(vec3(.1,.3,.5), vec3(.12,.2,.25), vec3(.2,.05,.03), s), pool);
    emit += vec3(1.,.3,.08) * frac * smoothstep(1.3, 2., s) * (1.1 + .5*sin(uTime*2.5 + n.y*7.));
    vec3 v = normalize(cameraPosition - vWP), r = reflect(-uSun, normalize(vWN));
    emit += vec3(.9,.95,1.) * pow(max(dot(r,v),0.), 40.) * .25 * lit * (1. - pool);
  } else if(st == 2){                                             // gas bands
    float y = n.y*5.5 + (fbm(n*2.2 + uSeed + vec3(uTime*.01,0.,0.)) - .5)*1.6;
    float b = .5 + .5*sin(y*3.1 + uSeed);
    float storm = smoothstep(.72, .9, fbm(n*3. + vec3(uTime*.03, 0., 0.) + uSeed*2.));
    vec3 e0 = mix(vec3(.75,.68,.52), vec3(.35,.55,.62), b), e1 = mix(vec3(.82,.58,.25), vec3(.55,.4,.25), b), e2 = mix(vec3(.45,.08,.05), vec3(.1,.04,.04), b);
    col = ramp3(e0, e1, e2, s);
    col = mix(col, ramp3(vec3(.95,.92,.85), vec3(1.,.75,.35), vec3(1.,.3,.1), max(s, w)), storm*.6);
    emit += vec3(1.,.3,.08) * storm * smoothstep(1.3, 2., max(s, w)) * .8;
  } else if(st == 3){                                             // obsidian with glowing fissures
    col = mix(vec3(.05,.06,.08), vec3(.11,.11,.13), detail);
    float c = 1. - smoothstep(.0, .022, abs(fbm(n*3.6 + uSeed) - .5));
    vec3 g = ramp3(vec3(.15,.95,.8), vec3(1.,.65,.2), vec3(1.,.15,.08), max(s, w));
    emit += g * c * (.55 + .35*sin(uTime*1.6 + n.x*5.));
  } else if(st == 5){                                             // forge: basalt, veins glow with GPU load
    col = mix(vec3(.07,.06,.06), vec3(.16,.13,.12), detail);
    float c = 1. - smoothstep(.0, .03, abs(fbm(n*4.2 + uSeed) - .5));
    float c2 = 1. - smoothstep(.0, .015, abs(fbm(n*9. + uSeed*3.) - .5));
    vec3 g = ramp3(vec3(.45,.85,1.), vec3(1.,.62,.2), vec3(1.,.18,.06), max(s, w));
    emit += g * (c + c2*.5) * (.18 + uLoad*1.6) * (.85 + .15*sin(uTime*4. + n.y*11.));
  } else {                                                        // rock
    float cr = fbm(n*5. + uSeed);
    col = mix(vec3(.42,.42,.44), vec3(.26,.26,.28), smoothstep(.45, .6, cr));
    col *= .8 + .4*detail;
    col = ramp3(col, col*vec3(1.05,.9,.75), col*vec3(.5,.3,.25), s);
    emit += lavaCracks(n, s, .7);
  }
  vec3 o = col * (.1 + .85*lit) + emit;
  float g = dot(o, vec3(.3,.59,.11));
  o = mix(o, vec3(g)*.35, uSleep);                                // asleep: grey and dim
  gl_FragColor = vec4(o, 1.);
  #include <colorspace_fragment>
}`;

// clouds: weather (white -> dust -> smoke), their speed is how busy the machine is
const CLOUD = /* glsl */`
uniform float uTime, uWeather, uBusy, uSeed, uAmount, uSleep; uniform vec3 uSun;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vN);
  float t = uTime * (.15 + uBusy*1.6);
  float d = acos(clamp(dot(n, normalize(vec3(.4,.35,.85))), -1., 1.)), w = pow(max(0., 1. - d/.9), 2.);
  float a = w * (t*1.2 + uBusy*4.);
  vec3 q = n*cos(a) + cross(normalize(vec3(.4,.35,.85)), n)*sin(a);
  float c = fbm(q*3. + vec3(t*.12, 0., t*.05) + uSeed);
  float cover = smoothstep(.6 - uBusy*.08, .86, c) * (.45 + w*uBusy*.45);
  vec3 tint = ramp3(vec3(.95), vec3(.78,.62,.38), vec3(.16,.1,.09), uWeather);
  float lit = clamp(dot(normalize(vWN), uSun), 0., 1.);
  vec3 col = tint * (.14 + .75*lit);
  col += vec3(1.,.4,.1) * smoothstep(1.5, 2., uWeather) * step(.93, fbm(n*30. + vec3(0., -uTime*.6, 0.))) * 2.;
  float amt = max(uAmount, smoothstep(1.2, 2., uWeather) * .8);   // anything on fire makes smoke
  gl_FragColor = vec4(col * (1. - uSleep*.6), cover * (.75 + uWeather*.1) * amt);
  #include <colorspace_fragment>
}`;

// sky: weather colour, pulsing when critical
const ATMO = /* glsl */`
uniform float uTime, uWeather, uSleep; uniform vec3 uSun, uSky0;
varying vec3 vN; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 v = normalize(cameraPosition - vWP);
  float rim = pow(1. - abs(dot(normalize(vWN), v)), 2.2);
  float lit = .45 + .55*clamp(dot(normalize(vWN), uSun)*.5+.5, 0., 1.);
  vec3 sky = ramp3(uSky0, vec3(1.,.66,.25), vec3(1.,.15,.1), uWeather);
  float beat = uWeather > 1.5 ? .6 + .6*abs(sin(uTime*3.)) : 1.;
  gl_FragColor = vec4(sky * rim * lit * beat * (1. + uWeather*.45) * (1. - uSleep*.85), rim);
  #include <colorspace_fragment>
}`.replace('void main', `vec3 ramp3(vec3 a, vec3 b, vec3 c, float s){ return s < 1. ? mix(a, b, s) : mix(b, c, s - 1.); }\nvoid main`);

const hash = str => [...String(str)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

export function makeLiving({ seed, R = 1.35, style = 'earth' }) {
  const sd = (hash(seed) % 1000) / 10, si = STYLE[style] ?? 0;
  const group = new THREE.Group();
  const sunU = { value: new THREE.Vector3(1, 0, 0) }, time = { value: 0 }, sleep = { value: 0 }, weather = { value: 0 };
  const U = { uTime: time, uSun: sunU, uSeed: { value: sd }, uClimate: { value: 0 }, uWeather: weather, uStyle: { value: si }, uLoad: { value: 0 }, uDark: { value: 0 }, uSleep: sleep };
  const CU = { uTime: time, uSun: sunU, uSeed: { value: sd + 11 }, uWeather: weather, uBusy: { value: 0 }, uAmount: { value: CLOUDS[si] }, uSleep: sleep };
  const AU = { uTime: time, uSun: sunU, uWeather: weather, uSleep: sleep, uSky0: { value: new THREE.Vector3(...SKY0[si]) } };
  const surf = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: SURF }));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 80, 56), new THREE.ShaderMaterial({ uniforms: CU, vertexShader: VERT, fragmentShader: CLOUD, transparent: true, depthWrite: false }));
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 64, 48), new THREE.ShaderMaterial({ uniforms: AU, vertexShader: VERT, fragmentShader: ATMO, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const spinG = new THREE.Group(); spinG.rotation.set(0.32, 0, 0.18); spinG.add(surf, clouds); group.add(spinG, atmo);
  const sm = { c: 0, w: 0, busy: 0, load: 0, dark: 0, sleep: 0 };

  // X: {climate, weather, busy 0..1, load 0..1, dark 0..1, asleep}
  function update(X, dt, t, sunWorld) {
    time.value = t;
    group.updateMatrixWorld();
    sunU.value.copy(sunWorld).sub(group.getWorldPosition(new THREE.Vector3())).normalize();
    const x = X || {};
    if (!sm.seen && X) { sm.seen = true; Object.assign(sm, { c: x.climate || 0, w: x.weather || 0, busy: x.busy || 0, load: x.load || 0, dark: x.dark || 0, sleep: x.asleep ? 1 : 0 }) }
    const k = (a, b, r) => a + (b - a) * Math.min(1, dt * r);
    sm.c = k(sm.c, x.climate || 0, 0.4); sm.w = k(sm.w, x.weather || 0, 2.5); sm.busy = k(sm.busy, x.busy || 0, 1.5);
    sm.load = k(sm.load, x.load || 0, 1.5); sm.dark = k(sm.dark, x.dark || 0, 1); sm.sleep = k(sm.sleep, x.asleep ? 1 : 0, 1.5);
    U.uClimate.value = sm.c; weather.value = sm.w; CU.uBusy.value = sm.busy * (1 - sm.sleep); U.uLoad.value = sm.load; U.uDark.value = sm.dark; sleep.value = sm.sleep;
    spinG.rotation.y += dt * 0.05 * (1 - sm.sleep * 0.8);
  }
  function dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose() }) }
  return { group, planet: surf, spin: spinG, pickables: [surf], update, dispose, R };
}
