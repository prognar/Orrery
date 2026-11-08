// ORRERY · planetary characteristics — each service planet shows what it is actually doing.
//   pihole          → AEGIS: a lattice shield; every blocked DNS query is a meteor that shatters on it
//   netviz          → EARTH: the planet becomes the globe; blocked connections strike from their real country
//   audiobookshelf  → SONG: sound-rings ripple out while someone listens; each listener is a moon carrying the cover
//   romm            → ARCADE: a ring of pixels; players become cartridge moons; downloads ship out as cubes
//   immich          → ATLAS: Earth lit by photo GPS points; click opens the photos; ML jobs wire it like a neural net
//   pbs             → VAULT: during a backup a beam draws the guest into the vault; every guest carries a backup seal
// Reads classic-script globals from index.html (S, guests, esc, fmtR, fmtB, ago).
import * as THREE from 'three';

const D2R = Math.PI / 180;
// equirect lat/lon → local point on a three.js SphereGeometry of radius r (matches its UV layout)
function llVec(lat, lon, r, out = new THREE.Vector3()) {
  const phi = (lon + 180) / 360 * Math.PI * 2, th = (90 - lat) * D2R;
  return out.set(-Math.cos(phi) * Math.sin(th) * r, Math.cos(th) * r, Math.sin(phi) * Math.sin(th) * r);
}
const ccFlag = cc => cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map(c => 127397 + c.charCodeAt(0))) : '';
const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s };
const fmtK = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
const hms = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m` };
const ageTxt = sec => sec < 3600 ? Math.round(sec / 60) + 'm' : sec < 172800 ? Math.round(sec / 3600) + 'h' : Math.round(sec / 86400) + 'd';

export function makeTraits(X) {
  const { scene, entries, glowTex, label, hdr, tl, T, camera } = X;
  const root = new THREE.Group(); scene.add(root);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3(), cMix = new THREE.Color();

  // ---------- own particle field (additive points)
  const PMAX = 2400, pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.13, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; root.add(pts);
  const parts = [];   // {pos:fn(k,out), c:Color, k, s, life?}
  const flashes = []; // sprites that bloom and fade {sp, t, dur, s0, s1, parent}
  function flash(parent, pos, color, s1, dur = 0.6, s0 = 0.1) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: color.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.position.copy(pos); sp.scale.setScalar(s0); parent.add(sp); flashes.push({ sp, t: 0, dur, s0, s1, parent, c: color.clone() });
  }

  // ---------- binding a decoration group to a guest's planet (survives topology rebuilds)
  const names = () => (S.traits && S.traits.names) || { pihole: 'pihole', netviz: 'netviz', abs: 'audiobookshelf', romm: 'romm', pbs: 'pbs', immich: 'immich' };
  const byName = n => { for (const e of entries().values()) if (e.g.name === n) return e; return null };
  function anchorFor(slot, e) {
    if (!e) { if (slot.g.parent) slot.g.parent.remove(slot.g); slot.e = null; return null }
    if (slot.e !== e || slot.g.parent !== e.pivot) { e.pivot.add(slot.g); slot.g.position.copy(e.planet.position); slot.e = e; slot.built = false }
    return e;
  }
  const quiet = (slot, active) => { const el = slot.lab && slot.lab.element; if (!el) return; el.classList.toggle('quiet', !active); el.classList.toggle('hot', !!(slot.e && X.hotId && X.hotId() === slot.e.g.id)) };
  const clearGroup = g => { g.traverse(o => { if (o.isCSS2DObject) o.element.remove() }); g.clear() };
  const slots = {};
  const slot = k => slots[k] || (slots[k] = { g: new THREE.Group(), e: null, built: false });
  const C = { verd: hdr('#5fb3a1', 2.2), rose: hdr('#d14d5a', 2.6), roseHot: hdr('#ff9a8a', 3.2), brass: hdr('#c9a45c', 2), hi: hdr('#f0d08a', 2.6), ame: hdr('#9d86d6', 2.4), cyan: hdr('#7fe9ff', 2.2), amber: hdr('#ffb347', 2.4) };

  // =====================================================================================
  // PI-HOLE · AEGIS
  const PHs = slot('pihole');
  let phShield, phLattice, phSeen = new Set(), phQueue = [], phLast = '', phLastAt = 0, phHit = 0;
  function buildPihole(e) {
    const R = e.size * 2.05;
    clearGroup(PHs.g);
    phShield = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 24), new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color('#5fb3a1') }, uI: { value: 0.6 }, uHit: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 uC; uniform float uI, uHit; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0-abs(dot(vN,vV)), 2.6); gl_FragColor = vec4(uC*(f*uI + uHit*0.25*f), f*0.9); }' }));
    phLattice = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(R * 1.002, 2)),
      new THREE.LineBasicMaterial({ color: hdr('#5fb3a1', 0.7), transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    PHs.g.add(phShield, phLattice); PHs.R = R;
    PHs.lab = label('', 'o3-lab o3-trait'); PHs.lab.position.set(0, -R - 0.35, 0); PHs.g.add(PHs.lab);
    PHs.built = true;
  }
  function updPihole(dt, t, P) {
    const e = anchorFor(PHs, P ? byName(names().pihole) : null); if (!e) return;
    if (!PHs.built) buildPihole(e);
    if (P.__error) { phShield.material.uniforms.uC.value.set('#d14d5a'); PHs.lab.element.innerHTML = `<span class="bad">pi-hole api · ${esc(P.__error).slice(0, 30)}</span>`; return }
    // new blocked queries → meteor queue (released evenly, capped)
    const fresh = (P.recent || []).filter(q => !phSeen.has(q.id)).reverse();
    if (phSeen.size === 0) (P.recent || []).forEach(q => phSeen.add(q.id));   // first sight: don't replay history
    else fresh.forEach(q => { phSeen.add(q.id); phQueue.push(q) });
    if (phSeen.size > 3000) phSeen = new Set([...phSeen].slice(-1000));
    if (phQueue.length > 40) phQueue.splice(0, phQueue.length - 40);
    const rate = Math.max(1.2, phQueue.length / 2.5);
    if (phQueue.length && Math.random() < dt * rate) {
      const q = phQueue.shift(); phLast = q.d; phLastAt = t;
      const dir = new THREE.Vector3().randomDirection(); dir.y = Math.abs(dir.y) * 0.6 + 0.1; dir.normalize();
      const from = dir.clone().multiplyScalar(PHs.R * 4.2).add(new THREE.Vector3((Math.random() - .5) * 2, 0, (Math.random() - .5) * 2));
      const hit = dir.clone().multiplyScalar(PHs.R);
      parts.push({ kind: 'meteor', g: PHs.g, from, hit, k: 0, s: 1.1 + Math.random() * 0.6, c: C.rose, tail: 5 });
    }
    // allowed queries: faint motes falling through the lattice
    if (Math.random() < Math.min(0.9, (P.freq || 0) * 0.25) * dt * 20) {
      const dir = new THREE.Vector3().randomDirection();
      parts.push({ kind: 'mote', g: PHs.g, from: dir.clone().multiplyScalar(PHs.R * 2.2), to: dir.clone().multiplyScalar(e.size * 0.9), k: 0, s: 0.5 + Math.random() * 0.4, c: C.verd });
    }
    phHit = Math.max(0, phHit - dt * 2.2);
    const pct = (P.pct || 0) / 100;
    phShield.material.uniforms.uI.value = 0.35 + pct * 3 + Math.sin(t * 1.7) * 0.05;
    phShield.material.uniforms.uHit.value = phHit;
    phShield.material.uniforms.uC.value.set('#5fb3a1');
    phLattice.rotation.y += dt * 0.05; phLattice.material.opacity = 0.12 + phHit * 0.25;
    const lt = `<b class="o3-shield">⛨ ${(P.pct || 0).toFixed(1)}% blocked · ${fmtK(P.blocked)} today</b>`
      + (t - phLastAt < 2.4 && phLast ? `<span class="o3-hit">✕ ${esc(short(phLast, 34))}</span>` : `<span>${fmtK(P.gravity)} on the blocklist</span>`);
    if (PHs.lab.element.innerHTML !== lt) PHs.lab.element.innerHTML = lt;
    quiet(PHs, false);
  }
  function onMeteorHit(p) {
    phHit = Math.min(1.4, phHit + 0.5);
    flash(p.g, p.hit, C.roseHot, PHs.R * 0.9, 0.55);
    for (let i = 0; i < 10; i++) {
      const d = p.hit.clone().normalize().add(new THREE.Vector3().randomDirection().multiplyScalar(0.9)).normalize();
      parts.push({ kind: 'spark', g: p.g, from: p.hit.clone(), dir: d, v: 0.6 + Math.random() * 0.9, k: 0, s: 1.6 + Math.random(), c: C.hi });
    }
  }

  // =====================================================================================
  // NETVIZ · EARTH
  const NVs = slot('netviz');
  let earth, earthTilt, nvPins = [], nvHome = [39.83, -98.58];
  const landTex = tl.load('/nv_land.png'); landTex.colorSpace = THREE.SRGBColorSpace; landTex.anisotropy = 4;
  function buildNetviz(e) {
    clearGroup(NVs.g); const R = e.size * 1.1; NVs.R = R;
    earthTilt = new THREE.Group(); earthTilt.rotation.z = 23.4 * D2R; NVs.g.add(earthTilt);
    earth = new THREE.Group(); earthTilt.add(earth);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 32), new THREE.MeshStandardMaterial({ map: landTex, emissiveMap: landTex, emissive: new THREE.Color('#b9a8ff'), emissiveIntensity: 0.32, roughness: 0.9, metalness: 0 }));
    earth.add(ball); NVs.ball = ball;
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 48, 24), new THREE.ShaderMaterial({
      uniforms: { uI: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform float uI; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0-abs(dot(vN,vV)),2.4); gl_FragColor = vec4(vec3(0.5,0.4,1.0)*f*uI, f); }' }));
    NVs.g.add(atmo); NVs.atmo = atmo;
    const home = new THREE.Mesh(new THREE.SphereGeometry(R * 0.045, 10, 8), new THREE.MeshBasicMaterial({ color: hdr('#f0d08a', 3) }));
    llVec(nvHome[0], nvHome[1], R * 1.01, home.position); earth.add(home); NVs.home = home;
    NVs.lab = label('', 'o3-lab o3-trait'); NVs.lab.position.set(0, -R * 1.25 - 0.35, 0); NVs.g.add(NVs.lab);
    e.planet.visible = false; e.halo.visible = false; NVs.hidden = e;
    NVs.built = true;
  }
  // great-circle arc from a far point to home, lifted off the surface
  function arcPts(a, b, R, lift, n = 40) {
    const va = llVec(a[0], a[1], 1), vb = llVec(b[0], b[1], 1), out = [];
    const ang = va.angleTo(vb);
    for (let i = 0; i <= n; i++) {
      const k = i / n, s = Math.sin(ang) || 1;
      const v = va.clone().multiplyScalar(Math.sin((1 - k) * ang) / s).add(vb.clone().multiplyScalar(Math.sin(k * ang) / s)).normalize();
      out.push(v.multiplyScalar(R * (1 + lift * Math.sin(k * Math.PI) * Math.min(1, ang))));
    }
    return out;
  }
  function nvStrike(ev, isBlock) {
    if (!ev.ll || !earth) return;
    const R = NVs.R, pos = llVec(ev.ll[0], ev.ll[1], R * 1.01);
    const col = isBlock ? C.rose : C.cyan;
    const ptsA = arcPts(ev.ll, nvHome, R, isBlock ? 0.55 : 0.3);
    const g = new THREE.BufferGeometry().setFromPoints(ptsA);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col.clone().multiplyScalar(isBlock ? 1 : 0.5), transparent: true, opacity: isBlock ? 1 : 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    line.geometry.setDrawRange(0, 0); earth.add(line);
    const pin = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    pin.position.copy(pos); pin.scale.setScalar(isBlock ? R * 0.5 : R * 0.18); earth.add(pin);
    let lab = null;
    if (false) {
      lab = label(`<b>${ccFlag(ev.cc)} ${esc(ev.cc || '??')}</b><span>${ev.pr === 17 ? 'udp' : 'tcp'}/${ev.dp ?? '—'}</span>`, 'o3-lab o3-strike');
      lab.position.copy(pos).multiplyScalar(1.25); earth.add(lab);
    }
    if (isBlock) {
      // the bolt from deep space, along the country's bearing, before the arc lights
      const az = (ev.ll[1] - nvHome[1]) * D2R, el = ev.ll[0] * D2R * 0.5;
      const from = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el) + 0.25, -Math.sin(az) * Math.cos(el)).normalize().multiplyScalar(34);
      parts.push({ kind: 'bolt', from, toObj: NVs.ball, k: 0, s: 1.4, c: C.rose, tail: 9, world: true });
    }
    nvPins.push({ line, pin, lab, t: 0, life: isBlock ? 5 : 2.6, n: ptsA.length, block: isBlock });
    if (nvPins.length > 70) { const o = nvPins.shift(); disposePin(o) }
  }
  function disposePin(o) { earth.remove(o.line, o.pin); o.line.geometry.dispose(); o.line.material.dispose(); o.pin.material.dispose(); if (o.lab) { earth.remove(o.lab); o.lab.element.remove() } }
  let nvBlockQ = [], nvFlowQ = [], nvBlockFlash = 0;
  function updNetviz(dt, t, N) {
    const e = anchorFor(NVs, N ? byName(names().netviz) : null);
    if (!e) { if (NVs.hidden) { NVs.hidden.planet.visible = true; NVs.hidden = null } return }
    if (!NVs.built) { if (Array.isArray(N.home)) nvHome = N.home; buildNetviz(e) }
    e.planet.visible = false; e.halo.visible = false;
    // drain the event queues the poller filled (S.nvIn) — blocks one by one, flows as a gentle shimmer
    const inbox = S.nvIn || (S.nvIn = { blocks: [], flows: [] });
    while (inbox.blocks.length) nvBlockQ.push(inbox.blocks.shift());
    while (inbox.flows.length) nvFlowQ.push(inbox.flows.shift());
    if (nvBlockQ.length > 30) nvBlockQ.splice(0, nvBlockQ.length - 30);
    if (nvFlowQ.length > 90) nvFlowQ.splice(0, nvFlowQ.length - 90);
    if (nvBlockQ.length && Math.random() < dt * Math.max(0.8, nvBlockQ.length / 3)) { nvStrike(nvBlockQ.shift(), true); nvBlockFlash = 1 }
    if (nvFlowQ.length && Math.random() < dt * Math.max(2, nvFlowQ.length / 3)) nvStrike(nvFlowQ.shift(), false);
    earth.rotation.y += dt * 0.06;
    nvBlockFlash = Math.max(0, nvBlockFlash - dt * 1.5);
    NVs.atmo.material.uniforms.uI.value = 0.45 + nvBlockFlash * 0.9;
    for (let i = nvPins.length - 1; i >= 0; i--) {
      const o = nvPins[i]; o.t += dt; const k = o.t / o.life;
      o.line.geometry.setDrawRange(0, Math.min(o.n + 1, Math.floor(o.t / 0.7 * o.n)));
      o.line.material.opacity = (o.block ? 1 : 0.5) * Math.max(0, 1 - Math.max(0, k - 0.5) * 2);
      o.pin.material.opacity = Math.max(0, 1 - k);
      if (o.lab) o.lab.element.style.opacity = Math.max(0, 1.4 - k * 1.6);
      if (k >= 1) { disposePin(o); nvPins.splice(i, 1) }
    }
    const top = (N.top || []).slice(0, 3).map(x => `${ccFlag(x[0])}${x[0]}`).join(' ');
    const lt = N.ok === false ? `<span class="bad">netviz feed lost · ${esc(N.err || '')}</span>`
      : `<b class="o3-war">⚔ ${fmtK(N.blocks24)} blocked · 24h</b><span>${top}${N.fpmLive || N.fpm ? ' · ' + fmtK(N.fpmLive || N.fpm) + ' flows/min' : ''}</span>`;
    if (NVs.lab.element.innerHTML !== lt) NVs.lab.element.innerHTML = lt;
    quiet(NVs, N.ok === false);
  }

  // =====================================================================================
  // shared: cover-carrying moons for audiobookshelf listeners and romm players
  const covers = new Map();
  const coverTex = url => { if (!url) return null; if (!covers.has(url)) { const t = tl.load(url); t.colorSpace = THREE.SRGBColorSpace; covers.set(url, t) } return covers.get(url) };
  const frameMat = new THREE.SpriteMaterial({ color: hdr('#c9a45c', 1.15), depthWrite: false });
  function buildMoons(s, list, color, aspect) {
    s.moons.forEach(m => { s.g.remove(m); m.traverse(o => { if (o.isCSS2DObject) o.element.remove() }) }); s.moons = [];
    list.forEach((x, i) => {
      const m = new THREE.Group();
      const mat = (T.moon || T.lxc).material.clone(); mat.emissive = new THREE.Color(color); mat.emissiveIntensity = 0.15;
      const body = new THREE.Mesh((T.moon || T.lxc).geometry, mat); body.scale.setScalar(0.26);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(color, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 })); halo.scale.setScalar(1.3);
      const prog = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.022, 6, 48, 0.01), new THREE.MeshBasicMaterial({ color: hdr(color, 2.2) })); prog.rotation.x = -Math.PI / 2;
      m.add(body, halo, prog);
      const tex = coverTex(x.cover);
      if (tex) {
        const h = 0.62 * aspect;
        const fr = new THREE.Sprite(frameMat); fr.center.set(0.5, 0); fr.scale.set(0.68, h + 0.06, 1); fr.position.y = 0.36; fr.renderOrder = 5;
        const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true })); card.center.set(0.5, 0); card.scale.set(0.62, h, 1); card.position.y = 0.39; card.renderOrder = 6;
        m.add(fr, card);
      }
      const lab = label('', 'o3-lab o3-moonlab'); lab.position.set(0, -0.5, 0); m.add(lab);
      m.userData = { key: x.key, a: i / Math.max(1, list.length) * Math.PI * 2, body, prog, pf: -1, lab };
      s.g.add(m); s.moons.push(m);
    });
  }
  function orbitMoons(s, list, dt, rr, labFn, progFn) {
    s.moons.forEach((m, i) => {
      const u = m.userData, x = list.find(z => z.key === u.key); if (!x) return;
      u.a += dt * 0.35;
      m.position.set(Math.cos(u.a) * rr, 0.35 + Math.sin(u.a * 1.3) * 0.25, Math.sin(u.a) * rr);
      u.body.rotation.y += dt * 0.4;
      const pf = progFn(x);
      if (pf != null && Math.abs(pf - u.pf) > 0.004) { u.pf = pf; u.prog.geometry.dispose(); u.prog.geometry = new THREE.TorusGeometry(0.42, 0.022, 6, 48, Math.max(0.01, pf * Math.PI * 2)) }
      const lt = labFn(x); if (u.lab.element.innerHTML !== lt) u.lab.element.innerHTML = lt;
    });
  }

  // =====================================================================================
  // AUDIOBOOKSHELF · SONG
  const ABs = Object.assign(slot('abs'), { moons: [], sig: '', waves: [] });
  function updAbs(dt, t, A) {
    const e = anchorFor(ABs, A ? byName(names().abs) : null); if (!e) return;
    if (!ABs.built) { clearGroup(ABs.g); ABs.moons = []; ABs.waves = []; ABs.lab = label('', 'o3-lab o3-trait'); ABs.lab.position.set(0, -e.size - 0.75, 0); ABs.g.add(ABs.lab); ABs.built = true; ABs.sig = '' }
    const ss = A.__error ? [] : (A.sessions || []).map(s => ({ ...s, key: s.id, cover: s.item ? `/api/traits/img?k=abs&id=${s.item}` : null }));
    const sig = ss.map(s => s.key).join();
    if (sig !== ABs.sig) { ABs.sig = sig; buildMoons(ABs, ss, '#ffb347', 1) }
    orbitMoons(ABs, ss, dt, e.size * 2.6 + 0.4,
      x => `<b>${esc(x.user)}</b>`, x => x.dur ? x.cur / x.dur : null);
    // sound rings: one every ~0.7 s per listener, rippling out on the orbital plane
    ABs.wt = (ABs.wt || 0) + dt * ss.length;
    if (ss.length && ABs.wt > 0.7) {
      ABs.wt = 0;
      const w = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 96), new THREE.MeshBasicMaterial({ color: C.amber.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      w.rotation.x = -Math.PI / 2 + (Math.random() - .5) * 0.25; ABs.g.add(w); ABs.waves.push({ w, t: 0 });
    }
    for (let i = ABs.waves.length - 1; i >= 0; i--) {
      const o = ABs.waves[i]; o.t += dt; const k = o.t / 2.6;
      o.w.scale.setScalar(e.size * 1.25 + k * 1.5); o.w.material.color.copy(C.amber).multiplyScalar(Math.max(0, 1 - k) * 0.45 * (0.6 + 0.4 * Math.sin(o.t * 14)));
      if (k >= 1) { ABs.g.remove(o.w); o.w.geometry.dispose(); o.w.material.dispose(); ABs.waves.splice(i, 1) }
    }
    if (ss.length && Math.random() < dt * 4 * ss.length) {   // notes drifting up
      const a = Math.random() * Math.PI * 2, r = e.size * 1.1;
      parts.push({ kind: 'rise', g: ABs.g, from: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), h: 1.6 + Math.random(), k: 0, s: 0.45 + Math.random() * 0.3, c: C.amber });
    }
    const lt = A.__error ? `<span class="bad">audiobookshelf · ${esc(A.__error).slice(0, 28)}</span>`
      : ss.length ? `<b class="o3-song">♪ ${ss.length} listening</b><span>${ss.map(s => esc(s.user)).join(' · ')}</span>` : '';
    if (ABs.lab.element.innerHTML !== lt) ABs.lab.element.innerHTML = lt;
    quiet(ABs, ss.length > 0);
  }

  // =====================================================================================
  // ROMM · ARCADE
  const RMs = Object.assign(slot('romm'), { moons: [], sig: '' });
  const PIX = ['#e0663b', '#f0d08a', '#5fb3a1', '#9d86d6', '#7fe9ff', '#d14d5a'].map(c => new THREE.Color(c));
  const NPIX = 140;
  let pixMesh = null, pixData = [];
  function buildRomm(e) {
    clearGroup(RMs.g); RMs.moons = []; RMs.sig = '';
    const geo = new THREE.BoxGeometry(1, 1, 1);
    pixMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), NPIX);
    pixData = [];
    for (let i = 0; i < NPIX; i++) {
      pixData.push({ a: Math.random() * Math.PI * 2, r: e.size * (1.7 + Math.random() * 1.1), y: (Math.random() - .5) * 0.18, s: 0.022 + Math.random() * 0.03, sp: 0.6 + Math.random() * 0.8, c: PIX[i % PIX.length] });
      pixMesh.setColorAt(i, PIX[i % PIX.length]);
    }
    pixMesh.frustumCulled = false; RMs.g.add(pixMesh); RMs.tiltG = pixMesh; pixMesh.rotation.x = 0.35;
    RMs.lab = label('', 'o3-lab o3-trait'); RMs.lab.position.set(0, -e.size - 0.75, 0); RMs.g.add(RMs.lab);
    RMs.built = true;
  }
  const dummy = new THREE.Object3D();
  function updRomm(dt, t, R) {
    const e = anchorFor(RMs, R ? byName(names().romm) : null); if (!e) return;
    if (!RMs.built) buildRomm(e);
    const pl = R.__error ? [] : (R.playing || []).map(p => ({ ...p, key: p.user + ':' + p.rom_id, cover: p.cover ? `/api/traits/img?k=romm&id=${encodeURIComponent(p.cover)}` : null }));
    const sig = pl.map(p => p.key).join();
    if (sig !== RMs.sig) { RMs.sig = sig; buildMoons(RMs, pl, '#9d86d6', 1.35) }
    orbitMoons(RMs, pl, dt, e.size * 3.2 + 0.5, x => `<b>${esc(x.user)}</b>`, () => null);
    const rt = (S.rates || {})[e.g.id] || {};
    const ship = Math.min(1, Math.max(0, (Math.log10((rt.netout || 0) + 1) - 5.3) / 2));   // ≳200 KB/s → cubes ship out
    const energy = pl.length ? 1 : 0.15;
    for (let i = 0; i < NPIX; i++) {
      const p = pixData[i]; p.a += dt * p.sp * (0.12 + energy * 0.9) / p.r;
      const blink = pl.length && ((i + Math.floor(t * 6)) % 9 === 0) ? 1.8 : 1;
      dummy.position.set(Math.cos(p.a) * p.r, p.y + (pl.length ? Math.sin(t * 3 + i) * 0.05 : 0), Math.sin(p.a) * p.r);
      dummy.rotation.set(t * p.sp, t * p.sp * 0.7, 0); dummy.scale.setScalar(p.s * (pl.length ? 1.25 : 0.8) * blink);
      dummy.updateMatrix(); pixMesh.setMatrixAt(i, dummy.matrix);
      pixMesh.setColorAt(i, cMix.copy(p.c).multiplyScalar(pl.length ? 1.6 * blink : 0.35));
    }
    pixMesh.instanceMatrix.needsUpdate = true; pixMesh.instanceColor.needsUpdate = true;
    if (ship > 0 && Math.random() < dt * 12 * ship) {   // ROM downloads: pixels fly out toward the core
      e.planet.getWorldPosition(tmp);
      parts.push({ kind: 'ship', from: tmp.clone(), to: new THREE.Vector3(0, 0.3, 0), k: 0, s: 0.5 + Math.random() * 0.3, c: hdr(PIX[Math.floor(Math.random() * 4)].getStyle(), 2.4), world: true, o: (Math.random() - .5) * 1.5 });
    }
    const lt = R.__error ? `<span class="bad">romm · ${esc(R.__error).slice(0, 28)}</span>`
      : pl.length ? `<b class="o3-arcade">▶ ${pl.length} playing</b><span>${pl.map(p => esc(p.user)).join(' · ')}</span>`
        : ship > 0 ? `<b class="o3-arcade">⇡ shipping roms</b><span>${fmtR(rt.netout)}</span>` : '';
    if (RMs.lab.element.innerHTML !== lt) RMs.lab.element.innerHTML = lt;
    quiet(RMs, pl.length > 0 || ship > 0);
  }

  // =====================================================================================
  // IMMICH · ATLAS — Earth, lit by every place a photograph was taken (click the planet for the photos)
  const IMs = Object.assign(slot('immich'), { placeSig: '', total: null, links: null });
  const ML_Q = ['smartSearch', 'faceDetection', 'facialRecognition', 'ocr', 'duplicateDetection'];
  const DEV_Q = ['thumbnailGeneration', 'metadataExtraction', 'videoConversion', 'sidecar', 'library', 'storageTemplateMigration', 'migration'];
  function buildImmich(e) {
    clearGroup(IMs.g); IMs.placeSig = ''; IMs.links = null;
    const R = e.size * 1.08; IMs.R = R;
    IMs.spin = new THREE.Group(); IMs.spin.rotation.z = 0.2; IMs.g.add(IMs.spin);
    IMs.globe = new THREE.Group(); IMs.spin.add(IMs.globe);
    const earthMat = new THREE.MeshStandardMaterial({ map: landTex, roughness: 0.75, metalness: 0.05, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.22 });
    earthMat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <map_fragment>', `vec4 lt = texture2D(map, vMapUv);
          float land = smoothstep(0.035, 0.055, lt.b);   // land.png is sRGB-decoded: ocean b≈0.013, land b≈0.07
          float lat = abs(vMapUv.y - 0.5) * 2.0;
          vec3 ocean = mix(vec3(0.02, 0.07, 0.17), vec3(0.03, 0.12, 0.26), 0.5 + 0.15 * sin(vMapUv.x * 40.0) * sin(vMapUv.y * 30.0));
          vec3 ground = mix(vec3(0.13, 0.24, 0.10), vec3(0.32, 0.27, 0.16), smoothstep(0.15, 0.45, lat));
          ground = mix(ground, vec3(0.85, 0.88, 0.92), smoothstep(0.78, 0.86, lat));
          diffuseColor.rgb = mix(ocean, ground, land);`)
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= diffuseColor.rgb;');
    };
    const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 32), earthMat);
    IMs.globe.add(ball);
    const rim = new THREE.Mesh(new THREE.SphereGeometry(R * 1.1, 48, 24), new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0.6 }, uC: { value: new THREE.Color('#8fc3ff') } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform float uI; uniform vec3 uC; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0-abs(dot(vN,vV)),2.4); gl_FragColor = vec4(uC*f*uI, f); }' }));
    IMs.g.add(rim); IMs.rim = rim;
    IMs.lab = label('', 'o3-lab o3-trait'); IMs.lab.position.set(0, -R * 1.2 - 0.4, 0); IMs.g.add(IMs.lab);
    e.planet.visible = false; e.halo.visible = false; IMs.hidden = e;
    IMs.built = true;
  }
  function buildPlaces(P) {
    if (IMs.dots) { IMs.globe.remove(IMs.dots, IMs.hot); IMs.dots.geometry.dispose(); IMs.hot.geometry.dispose() }
    const pts = P.pts || [], mx = Math.log(1 + (pts[0] ? pts[0][2] : 1)), R = IMs.R * 1.012;
    const pos = new Float32Array(pts.length * 3), col = new Float32Array(pts.length * 3), v = new THREE.Vector3();
    const warm = new THREE.Color('#ffd9a0'), hot = new THREE.Color('#ffffff');
    pts.forEach((p, i) => {
      llVec(p[0], p[1], R, v); pos.set([v.x, v.y, v.z], i * 3);
      const k = Math.log(1 + p[2]) / mx; cMix.copy(warm).lerp(hot, k * k).multiplyScalar(0.35 + k * 2.4); col.set([cMix.r, cMix.g, cMix.b], i * 3);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    IMs.dots = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.085, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const top = pts.slice(0, 40), hp = new Float32Array(top.length * 3);
    top.forEach((p, i) => { llVec(p[0], p[1], R * 1.004, v); hp.set([v.x, v.y, v.z], i * 3) });
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
    IMs.hot = new THREE.Points(hg, new THREE.PointsMaterial({ size: 0.16, map: glowTex, color: hdr('#ffcf80', 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    IMs.globe.add(IMs.dots, IMs.hot); IMs.topPts = top.map(p => llVec(p[0], p[1], R * 1.01));
    // when the ML queues run, these hot cells get wired together like a neural net
    const lp = new Float32Array(60 * 6);
    for (let i = 0; i < 60 && IMs.topPts.length > 1; i++) {
      const a = IMs.topPts[Math.floor(Math.random() * IMs.topPts.length)], b = IMs.topPts[Math.floor(Math.random() * IMs.topPts.length)];
      lp.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    }
    if (IMs.links) IMs.globe.remove(IMs.links);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    IMs.links = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: hdr('#9d86d6', 1.8), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    IMs.globe.add(IMs.links);
  }
  function updImmich(dt, t, I) {
    const e = anchorFor(IMs, I ? byName(names().immich || 'immich') : null);
    if (!e) { if (IMs.hidden) { IMs.hidden.planet.visible = true; IMs.hidden = null } return }
    if (!IMs.built) buildImmich(e);
    e.planet.visible = false; e.halo.visible = false;
    if (I.__error) { IMs.lab.element.innerHTML = `<span class="bad">immich · ${esc(I.__error).slice(0, 30)}</span>`; return }
    const P = I.places;
    const ps = P ? P.pts.length + ':' + (P.pts[0] || []).join() : '';
    if (P && ps !== IMs.placeSig) { IMs.placeSig = ps; buildPlaces(P) }
    const mems = I.memories || [];
    IMs.spin.rotation.y += dt * 0.05;
    // queues: ML = neural wiring across the hot cells, development (thumbs/metadata/video) = shutter flashes
    const Q = I.queues || {}, qn = names => names.reduce((a, n) => a + ((Q[n] || {}).active || 0) + ((Q[n] || {}).waiting || 0), 0);
    const ml = qn(ML_Q), dev = qn(DEV_Q);
    if (IMs.links) IMs.links.material.opacity += (((ml ? 0.25 + 0.2 * Math.sin(t * 7) : 0)) - IMs.links.material.opacity) * Math.min(1, dt * 3);
    if (dev && Math.random() < dt * Math.min(6, 1 + Math.log10(dev + 1) * 2) && IMs.topPts) {
      const p = IMs.topPts[Math.floor(Math.random() * IMs.topPts.length)].clone(); IMs.globe.localToWorld(p); flash(root, p, hdr('#ffffff', 3), IMs.R * 0.7, 0.35);
    }
    // uploads: library grew → photographs fall in from the sky
    const tot = (I.photos || 0) + (I.videos || 0);
    if (IMs.total != null && tot > IMs.total) {
      const n = Math.min(40, tot - IMs.total);
      for (let i = 0; i < n * 3; i++) {
        const d = new THREE.Vector3().randomDirection(); d.y = Math.abs(d.y) + 0.3; d.normalize();
        parts.push({ kind: 'mote', g: IMs.g, from: d.clone().multiplyScalar(IMs.R * 5), to: d.clone().multiplyScalar(IMs.R), k: -Math.random() * 0.8, s: 0.7 + Math.random() * 0.4, c: hdr('#fff3d6', 2.6) });
      }
      IMs.newAt = t; IMs.newN = tot - IMs.total;
    }
    IMs.total = tot;
    IMs.rim.material.uniforms.uI.value = 0.45 + (ml ? 0.25 : 0) + (t - (IMs.newAt || -99) < 3 ? 0.8 : 0);
    const gib = b => b >= 2 ** 40 ? (b / 2 ** 40).toFixed(2) + ' TiB' : (b / 2 ** 30).toFixed(0) + ' GiB';
    const busy = ml ? `◌ learning · ${fmtK(ml)} queued` : dev ? `✦ developing · ${fmtK(dev)} queued` : '';
    const lt = `<b class="o3-atlas">▣ ${fmtK(I.photos)} photos · ${fmtK(I.videos)} videos</b>`
      + (t - (IMs.newAt || -99) < 6 ? `<span class="o3-hit" style="color:#fff3d6!important">+${IMs.newN} new</span>` : busy ? `<span>${busy}</span>`
        : `<span>${gib(I.usage || 0)}${P ? ' · ' + fmtK(P.cities) + ' places' : ''}${mems.length ? ' · ' + mems.length + ' memories today' : ''}</span>`);
    if (IMs.lab.element.innerHTML !== lt) IMs.lab.element.innerHTML = lt;
    quiet(IMs, t - (IMs.newAt || -99) < 6);
  }

  // =====================================================================================
  // PBS · VAULT + backup seals on every guest
  const PBs = slot('pbs');
  let beam = null, beamCurve = null, scanRing = null, vaultRing = null, vaultBg = null, vf = -1;
  const seals = new Map();
  const sealGeo = new THREE.OctahedronGeometry(0.07, 0);
  function buildPbs(e) {
    clearGroup(PBs.g);
    vaultBg = new THREE.Mesh(new THREE.TorusGeometry(e.size * 1.9, 0.02, 4, 96), new THREE.MeshBasicMaterial({ color: '#2a2418' })); vaultBg.rotation.x = -Math.PI / 2;
    vaultRing = new THREE.Mesh(new THREE.TorusGeometry(e.size * 1.9, 0.045, 6, 96, 0.01), new THREE.MeshBasicMaterial({ color: C.hi })); vaultRing.rotation.x = -Math.PI / 2;
    PBs.g.add(vaultBg, vaultRing);
    PBs.lab = label('', 'o3-lab o3-trait'); PBs.lab.position.set(0, -e.size - 0.75, 0); PBs.g.add(PBs.lab);
    scanRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 64), new THREE.MeshBasicMaterial({ color: C.hi.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    scanRing.rotation.x = -Math.PI / 2; scanRing.visible = false; root.add(scanRing);
    PBs.built = true;
  }
  function updPbs(dt, t, B) {
    const e = anchorFor(PBs, B ? byName(names().pbs) : null);
    const run = B && B.running;
    // seals: a small brass crystal beside each guest — fresh backup = bright, stale/failed = rose, never = none
    const now = Date.now() / 1000;
    entries().forEach(g => {
      let s = seals.get(g.g.id);
      const last = B && B.last ? B.last[g.g.vmid] : null, failed = B && (B.failed || []).includes(g.g.vmid);
      if (!last && !failed) { if (s) s.visible = false; return }
      if (!s || s.parent !== g.pivot) { s = new THREE.Mesh(sealGeo, new THREE.MeshBasicMaterial({ color: '#fff' })); g.pivot.add(s); seals.set(g.g.id, s) }
      s.visible = true;
      const age = last ? now - last : 1e9, stale = failed || age > 36 * 3600;
      s.material.color.copy(stale ? C.rose : C.hi).multiplyScalar(stale ? 0.8 + 0.5 * Math.sin(t * 4) : 0.5 + Math.max(0, 1 - age / 86400) * 0.6);
      s.position.set(g.r + g.size * 0.95, g.size * 0.85, 0); s.rotation.y += dt * 1.5;
    });
    if (!e) { if (beam) beam.visible = false; return }
    if (!PBs.built) buildPbs(e);
    const ids = run ? run.ids || [] : [], done = run ? (run.done || []).length : 0;
    const cur = run && run.cur ? [...entries().values()].find(x => x.g.vmid === run.cur) : null;
    const frac = run ? (ids.length ? (done + ((run.pct && run.pct.pct) || 0) / 100) / ids.length : 0) : 1;
    if (Math.abs(frac - vf) > 0.003) { vf = frac; vaultRing.geometry.dispose(); vaultRing.geometry = new THREE.TorusGeometry(e.size * 1.9, 0.045, 6, 96, Math.max(0.01, frac * Math.PI * 2)) }
    vaultRing.material.color.copy(run ? C.hi : C.brass).multiplyScalar(run ? 1 + 0.3 * Math.sin(t * 5) : 0.45);
    vaultRing.rotation.z += dt * (run ? 0.8 : 0.05);
    if (cur) {
      cur.planet.getWorldPosition(tmp); e.planet.getWorldPosition(tmp2);
      const mid = tmp.clone().add(tmp2).multiplyScalar(0.5); mid.y += 2.2 + tmp.distanceTo(tmp2) * 0.15;
      beamCurve = new THREE.QuadraticBezierCurve3(tmp.clone(), mid, tmp2.clone());
      if (!beam) { beam = new THREE.Mesh(new THREE.TubeGeometry(beamCurve, 48, 0.03, 6), new THREE.MeshBasicMaterial({ color: C.hi.clone(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })); root.add(beam) }
      else { beam.geometry.dispose(); beam.geometry = new THREE.TubeGeometry(beamCurve, 48, 0.03, 6) }
      beam.visible = true; beam.material.opacity = 0.35 + 0.2 * Math.sin(t * 6);
      if (Math.random() < dt * 30) parts.push({ kind: 'beam', k: 0, s: 0.7 + Math.random() * 0.4, c: C.hi, world: true });
      scanRing.visible = true; scanRing.position.copy(tmp); scanRing.position.y += Math.sin(t * 2.4) * cur.size * 0.9;
      scanRing.scale.setScalar(cur.size * (1.15 + 0.1 * Math.cos(t * 2.4)));
    } else { if (beam) beam.visible = false; scanRing.visible = false }
    const lastRun = B && B.last ? Math.max(0, ...Object.values(B.last)) : 0, nOk = B && B.last ? Object.keys(B.last).length : 0;
    const lt = run ? `<b class="o3-vault">⛁ backing up ${cur ? esc(cur.g.name) : '…'}</b><span>${run.pct ? run.pct.pct + '% of ' + esc(run.pct.of) + ' · ' + esc(run.pct.rate) + ' · ' : ''}${done}/${ids.length || '?'}</span>`
      : `<b class="o3-vault dim">⛁ vault</b><span>${lastRun ? 'last run ' + ageTxt(now - lastRun) + ' ago · ' : ''}${nOk} sealed${B && B.failed && B.failed.length ? ' · <i class="bad">' + B.failed.length + ' failed</i>' : ''}</span>`;
    if (PBs.lab.element.innerHTML !== lt) PBs.lab.element.innerHTML = lt;
    quiet(PBs, !!run);
  }

  // =====================================================================================
  // THE QUIET BODIES — one live signal each, from S.traits.svc (see server.py svc_bundle)
  const SV = { npm: 'npm', guac: 'guacamole', wiki: 'wiki', seerr: 'seerr', kuma: 'uptime-kuma', netdata: 'netdata', paperless: 'paperless',
               tracearr: 'tracearr', orrery: 'orrery', build: 'orrery-build', ha: 'HomeAssistant' };
  const FX = S.fx = S.fx || {};
  const nowS = () => Date.now() / 1000;
  const sv = k => { const s = slot('svc_' + k); return s };
  function svcBind(k, on) {                         // anchor (or drop) the decoration group; returns entry or null
    const s = sv(k), e = anchorFor(s, on ? byName(names()[k] || SV[k]) : null);
    if (e && !s.built) { clearGroup(s.g); s.lab = null; s.parts = {}; s.built = true }
    return e;
  }
  function svcLabel(k, e, html, active, dy = 0.8) {
    const s = sv(k);
    if (!s.lab) { s.lab = label('', 'o3-lab o3-trait'); s.g.add(s.lab) }
    s.lab.position.set(0, -e.size - dy, 0);
    if (s.lab.element.innerHTML !== html) s.lab.element.innerHTML = html;
    quiet(s, active);
  }
  const worldOf = (e, out = new THREE.Vector3()) => e.planet.getWorldPosition(out);
  const sprite = (color, sc, op = 1) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: color.clone ? color.clone() : new THREE.Color(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op })); sp.scale.setScalar(sc); return sp };
  const plexObj = () => scene.getObjectByName('PlexWorld') || scene.getObjectByName('PlexGiant');
  const cGrey = hdr('#8a8170', 1.2);

  // ---- NPM: every request flies from the junction to the planet it was routed to
  let npmSeq = -1;
  function updNpm(dt, t, N, ipm) {
    const e = svcBind('npm', !!N); if (!e) return;
    if (npmSeq < 0) npmSeq = N.seq || 0;
    const fresh = (N.ev || []).filter(x => x.n > npmSeq); npmSeq = Math.max(npmSeq, N.seq || 0);
    const P = worldOf(e, new THREE.Vector3()), kuma = byName(SV.kuma);
    fresh.slice(-40).forEach((x, i) => {
      const nm = ipm[x.to], tgt = nm && nm !== '__host__' ? byName(nm) : null;
      const to = tgt ? worldOf(tgt, new THREE.Vector3()) : nm === '__host__' ? new THREE.Vector3(0, 0.6, 0) : null; if (!to) return;
      const c = x.bot ? cGrey : x.s >= 500 ? C.rose : x.s >= 400 ? C.amber : C.verd, delay = -i * 0.09 - Math.random() * 0.2;
      if (x.bot && kuma) parts.push({ kind: 'ship', from: worldOf(kuma, new THREE.Vector3()), to: P.clone(), k: delay, s: 0.9, c: cGrey, o: Math.random() * 0.5, dim: 0.35 });
      else if (!x.lan) parts.push({ kind: 'ship', from: P.clone().add(new THREE.Vector3(-3, 9, 3)), to: P.clone(), k: delay, s: 1.1, c: C.cyan, o: 0 });
      parts.push({ kind: 'ship', from: P.clone(), to, k: delay - (x.lan ? 0 : 0.9), s: 0.75 + Math.random() * 0.3, c, o: Math.random() * 0.8, dim: x.bot ? 0.35 : 1 });
      FX.npm = 1;
    });
    FX.npm = Math.max(0, (FX.npm || 0) - dt * 1.5);
    const hosts = Object.entries(N.hosts5 || {}).sort((a, b) => b[1].n - a[1].n), real = (N.ev || []).filter(x => !x.bot && nowS() - x.t < 300).length;
    const lastReal = Math.max(0, ...(N.ev || []).filter(x => !x.bot).map(x => x.t));
    svcLabel('npm', e, `<b>⇄ ${real} request${real === 1 ? '' : 's'} · 5m</b><span>${hosts[0] ? esc(hosts[0][0].split('.')[0]) + ' ' + hosts[0][1].n : 'quiet'}</span>`, nowS() - lastReal < 20);
  }

  // ---- Guacamole: an open session lights the screen and tethers the monitor to the machine being driven
  let guacLine = null, guacCurve = null;
  function updGuac(dt, t, Gd, ipm) {
    const e = svcBind('guac', !!Gd); if (!e) { if (guacLine) guacLine.visible = false; return }
    const ss = (Gd && Gd.sessions) || []; FX.guac = ss.length;
    if (ss.length) {
      const nm = ipm[ss[0].to], tgt = nm ? byName(nm) : null, plex = !tgt && ipm[ss[0].to] === '__media__' ? plexObj() : null;
      const A = worldOf(e, new THREE.Vector3()), B = tgt ? worldOf(tgt, new THREE.Vector3()) : plex ? plex.getWorldPosition(new THREE.Vector3()) : A.clone().add(new THREE.Vector3(6, 4, -6));
      const mid = A.clone().lerp(B, 0.5); mid.y += 2 + A.distanceTo(B) * 0.12;
      guacCurve = new THREE.QuadraticBezierCurve3(A, mid, B);
      if (!guacLine) { guacLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(guacCurve.getPoints(40)), new THREE.LineBasicMaterial({ color: hdr('#86d18c', 1.6), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); root.add(guacLine) }
      else guacLine.geometry.setFromPoints(guacCurve.getPoints(40));
      guacLine.visible = true; guacLine.material.opacity = 0.35 + 0.15 * Math.sin(t * 3);
      if (Math.random() < dt * 12) parts.push({ kind: 'curve', curve: guacCurve, k: 0, s: 0.6 + Math.random() * 0.3, c: hdr('#86d18c', 2.2), back: Math.random() < 0.5 });
    } else if (guacLine) guacLine.visible = false;
    const who = ss.length ? (ipm[ss[0].to] === '__media__' ? 'media server' : ipm[ss[0].to] || ss[0].to) : '';
    svcLabel('guac', e, ss.length ? `<b>◐ ${esc(ss[0].proto.toUpperCase())} → ${esc(who)}</b><span>${ss.length} live session${ss.length > 1 ? 's' : ''}</span>` : `<b>◐ desktop idle</b><span>no one remoted in</span>`, ss.length > 0);
  }

  // ---- Wiki: an edit sets the pages flying, with gold sparks off the spine
  let wikiLast = 0;
  function updWiki(dt, t, W) {
    const e = svcBind('wiki', !!(W && W.recent)); if (!e) return;
    const top = W.recent[0], age = top ? nowS() - top.t : 1e9; FX.wikiAge = age;
    if (top && top.t > wikiLast) { if (wikiLast) { flash(sv('wiki').g, new THREE.Vector3(0, e.size * 0.4, 0), C.hi, e.size * 4, 1.2); for (let i = 0; i < 24; i++) parts.push({ kind: 'spark', g: sv('wiki').g, from: new THREE.Vector3(0, e.size * 0.3, 0), dir: new THREE.Vector3(Math.random() - .5, Math.random() * 0.8 + 0.2, Math.random() - .5).normalize(), v: e.size * 2.2, k: 0, s: 0.9 + Math.random(), c: C.hi }) } wikiLast = top.t }
    if (age < 900 && Math.random() < dt * 3) parts.push({ kind: 'rise', g: sv('wiki').g, from: new THREE.Vector3((Math.random() - .5) * e.size, e.size * 0.5, (Math.random() - .5) * e.size), h: e.size * 2.5, k: 0, s: 0.5, c: C.hi });
    svcLabel('wiki', e, top ? `<b>✎ ${esc(short(top.title, 22))}</b><span>edited ${ageTxt(age)} ago · ${W.pages || '—'} pages</span>` : '<b>✎ wiki</b>', age < 900);
  }

  // ---- Seerr: every request hangs as a star in the telescope's field; new ones streak into the lens
  let seerrMax = -1;
  function updSeerr(dt, t, Se) {
    const e = svcBind('seerr', !!(Se && !Se.__error)); if (!e) return;
    const s = sv('seerr'), rs = (Se.recent || []).slice(0, 8);
    if (!s.parts.stars) { s.parts.stars = []; for (let i = 0; i < 8; i++) { const sp = sprite(C.hi, 0.3); sp.visible = false; s.g.add(sp); s.parts.stars.push(sp) } }
    rs.forEach((r, i) => {
      const sp = s.parts.stars[i]; sp.visible = true;
      const a = -0.9 + i * 0.26, rr = e.size * (2.0 + (i % 3) * 0.35);
      sp.position.set(Math.cos(a) * rr * 0.6 + e.size * 1.2, e.size * (1.4 + Math.sin(a * 2.3) * 0.5) + (i % 2) * 0.3, Math.sin(a) * rr * 0.6);
      const pending = r.status === 1, avail = r.media === 5, declined = r.status === 3;
      const col = declined ? C.rose : pending ? C.amber : avail ? C.hi : C.cyan;
      sp.material.color.copy(col).multiplyScalar(pending ? 0.6 + 0.6 * (0.5 + 0.5 * Math.sin(t * 4 + i)) : avail ? 0.9 : 0.7);
      sp.scale.setScalar(e.size * (avail ? 0.45 : 0.32) * (1 + 0.08 * Math.sin(t * 2 + i)));
    });
    for (let i = rs.length; i < 8; i++) s.parts.stars[i].visible = false;
    const maxId = Math.max(0, ...rs.map(r => r.id));
    if (seerrMax >= 0 && maxId > seerrMax) {
      const P = worldOf(e, new THREE.Vector3()); parts.push({ kind: 'ship', from: P.clone().add(new THREE.Vector3(8, 9, -6)), to: P.clone(), k: 0, s: 0.7, c: C.amber, o: 1.5 });
      flash(s.g, new THREE.Vector3(0, e.size * 0.5, 0), C.amber, e.size * 4, 1); FX.seerrNew = t;
    }
    seerrMax = maxId;
    const cnt = Se.count || {}, latest = rs[0];
    svcLabel('seerr', e, `<b>✦ ${cnt.pending || 0} pending · ${cnt.processing || 0} on the way</b><span>${latest ? 'latest: ' + esc(short(latest.title, 20)) : ''}</span>`, (cnt.pending || 0) > 0 || (latest && nowS() - latest.t < 600));
  }

  // ---- Uptime Kuma: a ring of beads, one per monitor, lit by each heartbeat; anything down and the heart falters
  function updKuma(dt, t, K) {
    const e = svcBind('kuma', !!(K && !K.__error)); if (!e) return;
    const s = sv('kuma'), ms = K.monitors || [];
    if (!s.parts.beads || s.parts.beads.length !== ms.length) {
      (s.parts.beads || []).forEach(b => s.g.remove(b)); s.parts.beads = ms.map(() => { const b = sprite(C.verd, 0.18); s.g.add(b); return b });
    }
    const down = ms.filter(m => m.status === 0), beat = (t % 1.1) / 1.1; FX.kumaDown = down.length;
    s.parts.beads.forEach((b, i) => {
      const m = ms[i], a = i / ms.length * Math.PI * 2 + t * 0.15, R = e.size * 1.75;
      b.position.set(Math.cos(a) * R, Math.sin(a * 2) * 0.08, Math.sin(a) * R);
      const wave = Math.max(0, 1 - Math.abs(((beat * ms.length) % ms.length) - i) * 0.9);   // the pulse runs round the ring
      const c = m.status === 0 ? C.rose : m.status === 2 ? C.amber : C.verd;
      b.material.color.copy(c).multiplyScalar(m.status === 0 ? 0.6 + 0.7 * (0.5 + 0.5 * Math.sin(t * 7)) : 0.45 + wave * 1.1);
      b.scale.setScalar(e.size * (m.status === 0 ? 0.32 : 0.2 + wave * 0.08));
    });
    const avg = ms.length ? Math.round(ms.reduce((a, m) => a + (m.ms || 0), 0) / ms.length) : 0;
    svcLabel('kuma', e, down.length ? `<b class="bad">♥ ${down.length} down</b><span>${down.map(m => esc(m.name)).slice(0, 2).join(' · ')}</span>` : `<b>♥ ${K.up}/${ms.length} up</b><span>avg ${avg} ms</span>`, down.length > 0);
  }

  // ---- Netdata: a warning beacon above the chart; one satellite per host streaming in
  function updNetdata(dt, t, Nd) {
    const e = svcBind('netdata', !!(Nd && !Nd.__error)); if (!e) return;
    const s = sv('netdata'), hosts = Nd.hosts || [], cn = Nd.counts || {};
    if (!s.parts.beacon) { s.parts.beacon = sprite(C.rose, 0.5); s.parts.beacon.position.set(0, e.size * 1.6, 0); s.g.add(s.parts.beacon); s.parts.sats = [] }
    while (s.parts.sats.length < hosts.length) { const sp = sprite(C.cyan, 0.14); s.g.add(sp); s.parts.sats.push(sp) }
    s.parts.sats.forEach((sp, i) => { sp.visible = i < hosts.length; const a = t * 0.7 + i / Math.max(1, hosts.length) * Math.PI * 2; sp.position.set(Math.cos(a) * e.size * 1.5, e.size * 0.9, Math.sin(a) * e.size * 1.5) });
    const crit = cn.critical || 0, warn = cn.warning || 0, b = s.parts.beacon;
    b.visible = crit + warn > 0; b.material.color.copy(crit ? C.rose : C.amber).multiplyScalar(0.4 + 0.9 * Math.max(0, Math.sin(t * (crit ? 6 : 3))));
    b.scale.setScalar(e.size * (crit ? 1.1 : 0.8));
    const al = (Nd.alarms || []).find(a => a.status === 'CRITICAL') || (Nd.alarms || [])[0];
    svcLabel('netdata', e, crit + warn ? `<b class="${crit ? 'bad' : ''}">⚠ ${crit ? crit + ' critical' : warn + ' warning'}</b><span>${al ? esc(short(al.name, 22)) + ' · ' + esc(al.host || '') : ''}</span>` : `<b>▤ ${hosts.length} hosts streaming</b><span>all clear</span>`, crit > 0);
  }

  // ---- Paperless: new documents drop onto the stack; the inbox circles it until it's filed
  let plMax = -1;
  function updPaperless(dt, t, Pl) {
    const e = svcBind('paperless', !!(Pl && !Pl.__error)); if (!e) return;
    const s = sv('paperless'), inbox = Math.min(8, Pl.inbox || 0);
    if (!s.parts.sheets) s.parts.sheets = [];
    while (s.parts.sheets.length < inbox) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.29), new THREE.MeshBasicMaterial({ color: '#efe6d0', side: THREE.DoubleSide, transparent: true, opacity: 0.85 })); s.g.add(m); s.parts.sheets.push(m) }
    s.parts.sheets.forEach((m, i) => { m.visible = i < inbox; const a = t * 0.5 + i / Math.max(1, inbox) * Math.PI * 2; m.position.set(Math.cos(a) * e.size * 1.6, e.size * 0.3 + Math.sin(t + i) * 0.1, Math.sin(a) * e.size * 1.6); m.rotation.set(t + i, a, 0.3); m.scale.setScalar(e.size) });
    FX.paperBusy = (Pl.busy || []).length;
    const maxId = Math.max(0, ...(Pl.recent || []).map(d => d.id || 0));
    if (plMax >= 0 && maxId > plMax) { const P = worldOf(e, new THREE.Vector3()); parts.push({ kind: 'ship', from: P.clone().add(new THREE.Vector3(0, 7, 0)), to: P.clone(), k: 0, s: 0.8, c: hdr('#efe6d0', 2), o: 0 }); flash(s.g, new THREE.Vector3(0, e.size * 0.3, 0), C.hi, e.size * 3, 0.9) }
    plMax = maxId;
    const last = (Pl.recent || [])[0];
    svcLabel('paperless', e, `<b>▤ ${fmtK(Pl.total)} documents</b><span>${FX.paperBusy ? 'consuming ' + esc(short(Pl.busy[0], 18)) : Pl.inbox ? Pl.inbox + ' in the inbox' : last ? 'last filed ' + ageTxt(nowS() - last.added) + ' ago' : 'archive empty'}</span>`, FX.paperBusy > 0 || (last && nowS() - last.added < 600));
  }

  // ---- Tracearr: each live Plex stream is a blip on the radar; account-sharing violations flash red
  function updTracearr(dt, t, Ta) {
    const e = svcBind('tracearr', !!(Ta && !Ta.__error)); if (!e) return;
    const s = sv('tracearr'), ss = Ta.streams || [];
    if (!s.parts.sweep) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(e.size * 2.2, 32, 0, 0.6), new THREE.MeshBasicMaterial({ color: hdr('#e0663b', 1), transparent: true, opacity: 0.12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; s.g.add(m); s.parts.sweep = m; s.parts.blips = [];
    }
    s.parts.sweep.rotation.z -= dt * (ss.length ? 2.4 : 0.9); s.parts.sweep.material.opacity = ss.length ? 0.2 : 0.07;
    while (s.parts.blips.length < ss.length) { const sp = sprite(C.amber, 0.25); s.g.add(sp); s.parts.blips.push(sp) }
    s.parts.blips.forEach((sp, i) => {
      sp.visible = i < ss.length; if (!sp.visible) return;
      let h = 0; for (const ch of String(ss[i].who)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const a = (h % 628) / 100 + t * 0.05, R = e.size * (1.1 + (h % 7) / 7);
      sp.position.set(Math.cos(a) * R, 0.05, Math.sin(a) * R);
      const swept = Math.abs(((-s.parts.sweep.rotation.z - a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
      sp.material.color.copy(ss[i].tx ? C.rose : C.amber).multiplyScalar(0.6 + Math.max(0, 1 - swept * 2) * 1.6);
      sp.scale.setScalar(e.size * 0.35);
    });
    FX.radar = ss.length; FX.violation = Ta.violations || 0;
    const td = Ta.today || {};
    svcLabel('tracearr', e, ss.length ? `<b>◎ ${ss.length} streaming</b><span>${esc(short(ss[0].who, 12))}: ${esc(short(ss[0].title, 22))}</span>` : `<b>◎ ${td.todayPlays || 0} plays today</b><span>${td.activeUsersToday || 0} viewers · ${td.watchTimeHours || 0} h${Ta.violations ? ' · <i class="bad">' + Ta.violations + ' violations</i>' : ''}</span>`, ss.length > 0 || Ta.violations > 0);
  }

  // ---- Orrery: it knows when it's being watched
  function updOrrery(dt, t, O) {
    const e = svcBind('orrery', !!O); if (!e) return;
    FX.viewers = O.viewers || 0;
    svcLabel('orrery', e, `<b>◉ ${FX.viewers} watching</b><span>you are here</span>`, FX.viewers > 1);
  }

  // ---- orrery-build: when it's running, the forge throws sparks
  function updBuild(dt, t) {
    const e = svcBind('build', true); if (!e) return;
    const run = e.g.status === 'running';
    if (run && Math.random() < dt * 25) parts.push({ kind: 'spark', g: sv('build').g, from: new THREE.Vector3(e.size * 0.5, 0, 0), dir: new THREE.Vector3(Math.random() * 0.6 + 0.4, Math.random() * 0.9, Math.random() - .5).normalize(), v: e.size * 2.2, k: 0, s: 1.4 + Math.random(), c: C.amber });
    svcLabel('build', e, run ? '<b>⚒ forging</b><span>blender / test rig running</span>' : '<b>⚒ cold forge</b>', run);
  }

  // ---- Home Assistant: lights in the windows, people at the door, smoke when an automation fires, music when something plays
  let haAuto = -1, haLights = 0;
  function updHa(dt, t, H) {
    const e = svcBind('ha', !!(H && !H.__error)); if (!e) return;
    const s = sv('ha'), ppl = H.people || [], sz = e.size;
    FX.haLights = H.lights ? H.lightsOn / H.lights : null;
    if (!s.parts.people) { s.parts.people = []; s.parts.porch = sprite(C.hi, 0.2); s.parts.porch.position.set(0, -sz * 0.35, sz * 0.7); s.g.add(s.parts.porch) }
    while (s.parts.people.length < ppl.length) { const sp = sprite(hdr('#ffe2b0', 1.8), 0.22); s.g.add(sp); s.parts.people.push(sp) }
    s.parts.people.forEach((sp, i) => {
      const p = ppl[i]; if (!p) { sp.visible = false; return } const home = p.state === 'home';
      sp.visible = true; const x = (i - (ppl.length - 1) / 2) * sz * 0.5;
      sp.position.lerp(new THREE.Vector3(home ? x : x * 3, home ? -sz * 0.45 : sz * 0.2, home ? sz * 1.0 : sz * 3), Math.min(1, dt * 1.5));
      sp.material.color.copy(home ? hdr('#ffe2b0', 1.8) : cGrey).multiplyScalar(home ? 1 + 0.1 * Math.sin(t * 2 + i) : 0.35); sp.scale.setScalar(sz * (home ? 0.32 : 0.2));
    });
    const motion = (H.motion || []).length; s.parts.porch.material.color.copy(C.hi).multiplyScalar(motion ? 1.2 + 0.4 * Math.sin(t * 6) : 0.15); s.parts.porch.scale.setScalar(sz * (motion ? 0.7 : 0.3));
    if (haAuto >= 0 && H.lastAuto > haAuto) for (let i = 0; i < 10; i++) parts.push({ kind: 'rise', g: s.g, from: new THREE.Vector3(sz * 0.42, sz * 0.85, -sz * 0.15), h: sz * 2.8, k: -i * 0.08, s: 0.45, c: hdr('#d8d2c4', 1.4) });
    haAuto = H.lastAuto || 0;
    if ((H.media || []).length && Math.random() < dt * 2) parts.push({ kind: 'rise', g: s.g, from: new THREE.Vector3((Math.random() - .5) * sz, sz * 0.3, sz * 0.6), h: sz * 2, k: 0, s: 0.5, c: C.amber });
    const home = ppl.filter(p => p.state === 'home').length, md = (H.media || [])[0], la = (H.autos || [])[0];
    svcLabel('ha', e, `<b>⌂ ${H.lightsOn} lights · ${home}/${ppl.length} home</b><span>${md ? '♪ ' + esc(short(md.title || md.name, 22)) : la ? '⚙ ' + esc(short(la.name, 18)) + ' ' + ageTxt(nowS() - la.t) + ' ago' : ''}</span>`, !!md || (la && nowS() - la.t < 90));
  }

  function updSvc(dt, t) {
    const V = (S.traits || {}).svc || {}, ipm = V.ipmap || {};
    for (const [k, fn] of [['npm', () => updNpm(dt, t, V.npm, ipm)], ['guac', () => updGuac(dt, t, V.guac, ipm)], ['wiki', () => updWiki(dt, t, V.wiki)],
                           ['seerr', () => updSeerr(dt, t, V.seerr)], ['kuma', () => updKuma(dt, t, V.kuma)], ['netdata', () => updNetdata(dt, t, V.netdata)],
                           ['paperless', () => updPaperless(dt, t, V.paperless)], ['tracearr', () => updTracearr(dt, t, V.tracearr)],
                           ['orrery', () => updOrrery(dt, t, V.orrery)], ['build', () => updBuild(dt, t)], ['ha', () => updHa(dt, t, V.ha)]])
      try { fn() } catch (err) { if (!updSvc.warned) { console.warn(k + ' trait', err); updSvc.warned = true } }
  }

  // =====================================================================================
  // particles
  function stepParts(dt) {
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.k += p.s * dt;
      if (p.k >= 1) {
        if (p.kind === 'meteor') onMeteorHit(p);
        if (p.kind === 'bolt' && p.toObj) { p.toObj.getWorldPosition(tmp); flash(root, tmp, C.roseHot, 3.2, 0.5) }
        parts.splice(i, 1); continue;
      }
      if (p.k < 0) continue;
      let a = Math.sin(p.k * Math.PI);
      const put = (v, c, f = 1) => { if (n >= PMAX) return; pPos[n * 3] = v.x; pPos[n * 3 + 1] = v.y; pPos[n * 3 + 2] = v.z; pCol[n * 3] = c.r * f; pCol[n * 3 + 1] = c.g * f; pCol[n * 3 + 2] = c.b * f; n++ };
      if (p.kind === 'meteor') {        // streak with a short tail, local to the shield group
        for (let j = 0; j < p.tail; j++) {
          const k = Math.max(0, p.k - j * 0.03); tmp.copy(p.from).lerp(p.hit, k * k); p.g.localToWorld(tmp);
          put(tmp, j ? C.rose : C.roseHot, (1 - j / p.tail) * Math.min(1, p.k * 4));
        }
      } else if (p.kind === 'spark') {
        tmp.copy(p.from).addScaledVector(p.dir, p.k * p.v); p.g.localToWorld(tmp); put(tmp, p.c, 1 - p.k);
      } else if (p.kind === 'mote') {
        tmp.copy(p.from).lerp(p.to, p.k); p.g.localToWorld(tmp); put(tmp, p.c, a * 0.5);
      } else if (p.kind === 'rise') {
        tmp.copy(p.from); tmp.y += p.k * p.h; tmp.x += Math.sin(p.k * 9) * 0.08; p.g.localToWorld(tmp); put(tmp, p.c, a);
      } else if (p.kind === 'bolt') {
        p.toObj.getWorldPosition(tmp2);
        for (let j = 0; j < p.tail; j++) { const k = Math.max(0, p.k - j * 0.025); tmp.copy(p.from).lerp(tmp2, k * k * k); put(tmp, j ? C.rose : C.roseHot, 1 - j / p.tail) }
      } else if (p.kind === 'ship') {
        tmp.copy(p.from).lerp(p.to, p.k); tmp.y += Math.sin(p.k * Math.PI) * (0.8 + p.o); put(tmp, p.c, a * (p.dim ?? 1));
      } else if (p.kind === 'curve') {
        p.curve.getPoint(p.back ? 1 - p.k : p.k, tmp); put(tmp, p.c, a);
      } else if (p.kind === 'beam') {
        if (!beamCurve || !beam || !beam.visible) { p.k = 1; continue }
        beamCurve.getPoint(p.k, tmp); put(tmp, p.c, a * 1.2);
      }
    }
    if (parts.length > PMAX) parts.splice(0, parts.length - PMAX);
    pGeo.setDrawRange(0, n); pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i]; f.t += dt; const k = f.t / f.dur;
      f.sp.scale.setScalar(f.s0 + (f.s1 - f.s0) * Math.sqrt(Math.min(1, k))); f.sp.material.color.copy(f.c).multiplyScalar(Math.max(0, 1 - k));
      if (k >= 1) { f.parent.remove(f.sp); f.sp.material.dispose(); flashes.splice(i, 1) }
    }
  }

  // =====================================================================================
  function update(dt, t) {
    const Tr = S.traits || {};
    try { updPihole(dt, t, Tr.pihole) } catch (err) { console.warn('pihole trait', err) }
    try { updNetviz(dt, t, Tr.netviz) } catch (err) { console.warn('netviz trait', err) }
    try { updAbs(dt, t, Tr.abs) } catch (err) { console.warn('abs trait', err) }
    try { updRomm(dt, t, Tr.romm) } catch (err) { console.warn('romm trait', err) }
    try { updPbs(dt, t, Tr.backup) } catch (err) { console.warn('pbs trait', err) }
    try { updImmich(dt, t, Tr.immich) } catch (err) { console.warn('immich trait', err) }
    updSvc(dt, t);
    stepParts(dt);
  }

  // tooltip rows appended under a guest's normal readout
  function tipRows(g) {
    const Tr = S.traits || {}, nm = names(), row = (a, b, cls = '') => `<div class="row"><span>${a}</span><b class="${cls}">${b}</b></div>`;
    let h = '';
    const B = Tr.backup;
    if (B && B.last) {
      const last = B.last[g.vmid], failed = (B.failed || []).includes(g.vmid);
      if (B.running && B.running.cur === g.vmid) h += row('backup', `in progress${B.running.pct ? ' · ' + B.running.pct.pct + '%' : ''}`, 'ok');
      else if (failed) h += row('backup', 'last run FAILED', 'bad');
      else if (last) { const age = Date.now() / 1000 - last; h += row('last backup', ageTxt(age) + ' ago', age > 36 * 3600 ? 'bad' : '') }
    }
    if (g.name === nm.pihole && Tr.pihole && !Tr.pihole.__error) {
      const P = Tr.pihole;
      h += row('queries today', `${fmtK(P.total)} · ${(P.freq || 0).toFixed(1)}/s`) + row('blocked', `${fmtK(P.blocked)} · ${(P.pct || 0).toFixed(1)}%`, 'ok')
        + row('blocklist', fmtK(P.gravity) + ' domains') + (P.top && P.top[0] ? row('most blocked', esc(short(P.top[0][0], 26))) : '')
        + (P.topClients && P.topClients[0] ? row('noisiest client', esc(short(P.topClients[0][0], 22))) : '')
        + (P.recent || []).slice(0, 4).map(q => row(`<i style="color:var(--rose)">✕</i> ${esc(short(q.c, 14))}`, esc(short(q.d, 28)))).join('');
    }
    if (g.name === nm.netviz && Tr.netviz) {
      const N = Tr.netviz;
      h += row('feed', N.ok ? 'live' : 'lost', N.ok ? 'ok' : 'bad') + row('blocked · 24h', fmtK(N.blocks24)) + row('flows/min', fmtK(N.fpmLive || N.fpm))
        + (N.top || []).slice(0, 5).map(x => row(`${ccFlag(x[0])} ${esc(x[0])}`, fmtK(x[1]))).join('');
    }
    if (g.name === nm.abs && Tr.abs && !Tr.abs.__error) {
      const ss = Tr.abs.sessions || [];
      h += ss.length ? ss.map(s => row(`♪ ${esc(s.user)}`, `${esc(short(s.title, 24))} · ${hms(s.cur)} / ${hms(s.dur)}`, 'ok')).join('') : row('listening', 'nobody');
      const rc = (Tr.abs.recent || []).filter(r => !ss.some(s => s.user === r.user && s.title === r.title));
      if (rc.length) h += row('<i>recent</i>', '') + rc.slice(0, 5).map(r => row(`${esc(short(r.user, 10))} · ${ageTxt(nowS() - r.t)}`, `${esc(short(r.title, 26))}${r.pct != null ? ' · ' + r.pct + '%' : ''}`)).join('');
    }
    if (g.name === nm.romm && Tr.romm && !Tr.romm.__error) {
      const R = Tr.romm, pl = R.playing || [];
      h += row('library', `${fmtK(R.roms)} roms · ${R.platforms || '—'} platforms`)
        + (pl.length ? pl.map(p => row(`▶ ${esc(p.user)}`, `${esc(short(p.rom, 22))} · ${esc(short(p.platform, 12))}`, 'ok')).join('') : row('playing', 'nobody'));
      const rc = (R.recent || []).filter(r => !pl.some(p => p.user === r.user && p.rom === r.rom));
      if (rc.length) h += row('<i>recent</i>', '') + rc.slice(0, 5).map(r => row(`${esc(short(r.user, 10))} · ${ageTxt(nowS() - r.t)}`, `${esc(short(r.rom, 22))} · ${esc(short(r.platform, 14))}${r.secs >= 60 ? ' · ' + hms(r.secs) : ''}`)).join('');
    }
    if (g.name === (nm.immich || 'immich') && Tr.immich && !Tr.immich.__error) {
      const I = Tr.immich, P = I.places, Q = I.queues || {};
      h += row('library', `${fmtK(I.photos)} photos · ${fmtK(I.videos)} videos`) + row('size', fmtB(I.usage || 0))
        + (P ? row('geotagged', `${fmtK(P.geo)} · ${fmtK(P.cities)} places`) + (P.top || []).slice(0, 3).map(c => row('&nbsp;· ' + esc(short(c[0], 18)), fmtK(c[1]))).join('') : '')
        + (I.people != null ? row('faces / people', fmtK(I.people)) : '')
        + ((I.memories || []).length ? row('on this day', (I.memories || []).map(m => m.year).join(' · ')) : '')
        + Object.entries(Q).filter(([, v]) => v.active || v.waiting).map(([k, v]) => row('queue · ' + esc(k), `${v.active} active · ${fmtK(v.waiting)} waiting`, 'ok')).join('');
    }
    const V = Tr.svc || {};
    if (g.name === (names().seerr || 'seerr') && V.seerr && !V.seerr.__error) {
      const c = V.seerr.count || {}, ST = { 1: ['pending', 'bad'], 2: ['approved', ''], 3: ['declined', 'bad'], 4: ['failed', 'bad'], 5: ['done', 'ok'] }, MS = { 3: ['downloading', 'ok'], 4: ['partial', 'ok'], 5: ['available', 'ok'] };
      h += row('requests', `${fmtK(c.total || 0)} · ${c.movie || 0} movies · ${c.tv || 0} tv`) + (c.pending ? row('awaiting approval', c.pending, 'bad') : '') + (c.processing ? row('on the way', c.processing, 'ok') : '')
        + (V.seerr.recent || []).slice(0, 6).map(r => { const [lbl, cls] = (r.status === 4 && ST[4]) || MS[r.media] || ST[r.status] || ['?', '']; return row(`${r.kind === 'tv' ? '▣' : '◉'} ${esc(short(r.who || '?', 10))} · ${ageTxt(nowS() - r.t)}`, `${esc(short(r.title, 22))}${r.year ? ' (' + r.year + ')' : ''} · <span class="${cls}">${lbl}</span>`) }).join('');
    }
    if (g.name === (names().ha || 'HomeAssistant') && V.ha && !V.ha.__error) {
      const H = V.ha, ppl = H.people || [], W = (H.weather || [])[0];
      h += row('home', ppl.map(p => `${esc(p.name)} <span class="${p.state === 'home' ? 'ok' : ''}">${esc(p.state === 'not_home' ? 'away' : p.state)}</span>`).join(' · ') || '—')
        + row('lights on', `${H.lightsOn} / ${H.lights}`) + ((H.lightsList || []).length ? row('', esc(H.lightsList.slice(0, 4).map(x => short(x, 14)).join(', ')) + (H.lightsList.length > 4 ? ' +' + (H.lightsList.length - 4) : '')) : '')
        + (W ? row('outside', `${W.temp != null ? Math.round(W.temp) + '° · ' : ''}${esc(W.state)}`) : '')
        + (H.climate || []).map(c => row(esc(short(c.name, 14)), `${c.cur != null ? Math.round(c.cur) + '°' : '—'} → ${c.set != null ? Math.round(c.set) + '°' : '—'} · ${esc(c.act || c.mode)}`, c.act && c.act !== 'idle' && c.act !== 'off' ? 'ok' : '')).join('')
        + (H.media || []).map(m => row('♪ ' + esc(short(m.name, 14)), esc(short([m.title, m.artist].filter(Boolean).join(' — '), 28)), 'ok')).join('')
        + ((H.open || []).length ? row('open', esc(H.open.slice(0, 3).join(', ')), 'bad') : '')
        + (H.locks || []).filter(l => l.state !== 'locked').map(l => row(esc(short(l.name, 14)), esc(l.state), 'bad')).join('')
        + ((H.motion || []).length ? row('motion', esc(H.motion.slice(0, 3).join(', '))) : '')
        + (H.autos || []).slice(0, 4).map(a => row('⚙ ' + ageTxt(nowS() - a.t) + ' ago', esc(short(a.name, 26)))).join('');
    }
    if (g.name === nm.pbs && B) {
      if (B.running) h += row('job', `${(B.running.done || []).length} / ${(B.running.ids || []).length} guests`) + (B.running.pct ? row('current', `${B.running.pct.pct}% of ${esc(B.running.pct.of)} · ${esc(B.running.pct.rate)}`) : '');
      const st = (S.storage || []).find(s => s.type === 'pbs');
      if (st && st.total) h += row('datastore', `${fmtB(st.used)} / ${fmtB(st.total)}`);
    }
    return h;
  }
  return { update, tipRows };
}
