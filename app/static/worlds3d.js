// ORRERY · 3D — other servers on the network, drawn as planets beyond the orrery.
// Each preset (planets.js LOOK) has its own surface (livingworld.js) and one feature that says what it's for:
//   NAS: a ring per pool, filled as it fills · router: a beacon and the traffic orbiting it · DNS: an accretion disc
//   cameras: an eye per camera · game server: a moon per player · AI box: a moon per loaded model · printer: a ring being printed
// Services aren't drawn (they're listed in the planet's panel); a dead one turns the sky amber.
// Reads S.worlds (from worlds.js). Tether colour = how Orrery reaches the machine: purple Tailscale, blue LAN.
import * as THREE from 'three';
import { makeLiving, LEVEL_COL } from './livingworld.js';

export const LINK_COL = { tailnet: '#9d86d6', lan: '#5aa6d8' };
const DOWN = '#d14d5a', SLEEP = '#7d8597';
const ORIGIN = new THREE.Vector3();

export function makeWorlds({ scene, label, hdr, T, glowTex, pick, sunR, mediaPos }) {
  const root = new THREE.Group(); scene.add(root);
  const W = new Map();                 // id -> entry
  const moonGeo = (T.moon && T.moon.geometry) || new THREE.SphereGeometry(1, 16, 12);
  const base = Math.atan2(mediaPos.z, mediaPos.x), RR = Math.hypot(mediaPos.x, mediaPos.z) - 1.0;
  // slots: one just past the media planet, the rest round the far side of the orrery, never between it and the camera
  const slot = (k, n) => {
    const step = Math.min(0.52, 2.9 / Math.max(1, n - 1));
    const a = k === 1 ? base + 0.5 : base - (k - 1) * step;
    const r = RR + (k % 2) * 3.5;
    return new THREE.Vector3(Math.cos(a) * r, 0.6 + (k % 3) * 0.9, Math.sin(a) * r);
  };
  const glow = (col, s, a = 1) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(col, a), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); m.scale.setScalar(s); return m };

  function tetherTo(pos, endPad) {
    const dir = pos.clone().setY(0).normalize();
    const a = dir.clone().multiplyScalar(sunR + 0.9), b = pos.clone().sub(pos.clone().normalize().multiplyScalar(endPad));
    const ctrl = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 4.5, 0));
    return new THREE.QuadraticBezierCurve3(a, ctrl, b);
  }

  // a small swarm of bodies on tilted orbits (players, cameras, models), kept at the right count
  function swarm(g, make) {
    const items = [];
    return {
      set(n) {
        while (items.length < n) { const i = items.length, o = make(i); o.userData.orb = { a: i * 2.399, inc: ((i * 0.618) % 1 - .5) * 1.1, r: o.userData.r || 2, sp: o.userData.sp || .5 }; g.add(o); items.push(o) }
        while (items.length > n) { const o = items.pop(); g.remove(o); o.traverse(x => { if (x.geometry && x.geometry !== moonGeo) x.geometry.dispose(); if (x.material) x.material.dispose() }) }
      },
      tick(dt, fn) { items.forEach((o, i) => { const u = o.userData.orb; u.a += dt * u.sp; const c = Math.cos(u.a) * u.r, s = Math.sin(u.a) * u.r;
        o.position.set(c, s * Math.sin(u.inc), s * Math.cos(u.inc)); fn && fn(o, i) }) },
      items,
    };
  }
  function arcRing(r, tube, col) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 6, 120, Math.PI * 2), new THREE.MeshBasicMaterial({ color: hdr(col, 1.4), transparent: true, opacity: .9 }));
    m.userData.frac = 1; return m;
  }
  function setArc(m, frac) {
    frac = Math.max(0.002, Math.min(1, frac));
    if (Math.abs(frac - m.userData.frac) < 0.005) return;
    const p = m.geometry.parameters; m.geometry.dispose();
    m.geometry = new THREE.TorusGeometry(p.radius, p.tube, 6, Math.max(8, Math.round(120 * frac)), Math.PI * 2 * frac); m.userData.frac = frac;
  }
  const faint = (r, tube = .012) => new THREE.Mesh(new THREE.TorusGeometry(r, tube, 6, 120), new THREE.MeshBasicMaterial({ color: '#8a95a3', transparent: true, opacity: .22 }));

  function makeFeat(e, w) {
    const L = OP.look(w), R = L.R, g = new THREE.Group(); e.g.add(g);
    const F = { g, tick() {} };
    switch (L.feat) {
      case 'ring': {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.62, 0.05, 6, 120), new THREE.MeshStandardMaterial({ color: '#c9a45c', metalness: .75, roughness: .35 }));
        ring.rotation.x = Math.PI / 2.25; g.add(ring); break }
      case 'pools': {
        g.rotation.x = Math.PI / 2.3; const rings = [];
        F.tick = (w2, dt, t) => {
          const f = (w2.preset || {}).facts || {}, H = w2.health && !w2.health.__error ? w2.health : null;
          const P = (f.pools || []).length ? f.pools.map(p => ({ fill: p.fill || 0, lv: p.ok ? (p.fill >= 95 ? 2 : p.fill >= 85 ? 1 : 0) : 2 }))
            : ((H && H.disks) || []).filter(d => d.used != null).slice(0, 4).map(d => ({ fill: d.used, lv: d.level || 0 }));
          while (rings.length < Math.min(4, P.length)) { const i = rings.length, r = R * (1.5 + i * .2), bg = faint(r), arc = arcRing(r, .028, LEVEL_COL[0]); g.add(bg, arc); rings.push({ bg, arc }) }
          while (rings.length > Math.min(4, P.length)) { const x = rings.pop(); [x.bg, x.arc].forEach(m => { g.remove(m); m.geometry.dispose(); m.material.dispose() }) }
          rings.forEach((x, i) => { setArc(x.arc, P[i].fill / 100); x.arc.material.color.copy(hdr(LEVEL_COL[P[i].lv], 1.4));
            x.arc.material.opacity = P[i].lv === 2 ? .55 + .45 * Math.abs(Math.sin(t * 3)) : .9 });
          g.rotation.z += dt * .05;
        };
        break }
      case 'beacon': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, R * .55, 6), new THREE.MeshStandardMaterial({ color: '#b8b0a0', metalness: .8, roughness: .3 }));
        pole.position.y = R * 1.25; const lamp = glow(LEVEL_COL[0], 1.1); lamp.position.y = R * 1.55; g.add(pole, lamp);
        const ring = new THREE.Group(); ring.rotation.x = .35; g.add(ring);
        const pk = [...Array(10)].map((_, i) => { const s = glow(LINK_COL.lan, .28, 2.2); s.userData.a = i / 10 * Math.PI * 2; ring.add(s); return s });
        F.tick = (w2, dt, t) => {
          const f = (w2.preset || {}).facts || {}, up = f.inet !== false && w2.up !== false, H = w2.health && !w2.health.__error ? w2.health : null;
          const lv = (w2.state || {}).level || 0;
          lamp.material.color.copy(hdr(up ? LEVEL_COL[lv] : DOWN, up ? 2 : 1.2)); lamp.material.opacity = up ? .6 + .4 * Math.sin(t * 4) : .25 + .25 * Math.sin(t * 1.3);
          const bps = H && H.net ? H.net.down + H.net.up : 0, sp = .35 + Math.min(2.5, Math.log10(bps + 1) / 3);
          pk.forEach(s => { s.visible = up; s.userData.a += dt * sp; s.position.set(Math.cos(s.userData.a) * R * 1.55, 0, Math.sin(s.userData.a) * R * 1.55) });
        };
        break }
      case 'disc': {
        const U = { uTime: { value: 0 }, uOn: { value: 1 } };
        const disc = new THREE.Mesh(new THREE.RingGeometry(R * 1.25, R * 2.7, 128, 1), new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
          vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
          fragmentShader: `uniform float uTime, uOn; varying vec2 vP;
            void main(){ float r = length(vP), a = atan(vP.y, vP.x);
              float k = clamp((r - ${(R * 1.25).toFixed(3)}) / ${(R * 1.45).toFixed(3)}, 0., 1.);
              float sw = .5 + .5*sin(a*3. + log(r)*9. - uTime*1.6);
              vec3 c = mix(vec3(1.,.62,.2), vec3(.25,.95,.8), uOn);
              gl_FragColor = vec4(c * (.35 + .65*sw) * pow(1. - k, 1.6) * (.35 + .65*uOn), (1. - k) * .8); }` }));
        disc.rotation.x = -Math.PI / 2 + .28; g.add(disc);
        const fall = [...Array(14)].map((_, i) => { const s = glow('#a0ffe6', .2, 2); s.userData.k = i / 14; s.userData.a = i * 2.4; disc.add(s); return s });
        F.tick = (w2, dt, t) => {
          const f = (w2.preset || {}).facts || {}, on = f.blocking !== false && f.dns !== false && w2.up !== false;
          U.uTime.value = t; U.uOn.value += ((on ? 1 : 0) - U.uOn.value) * Math.min(1, dt * 2);
          const rate = .12 + Math.min(.5, (f.pct || 0) / 60);
          fall.forEach(s => { s.visible = on; s.userData.k = (s.userData.k + dt * rate) % 1; const k = s.userData.k, r = R * (2.6 - k * 1.35), a = s.userData.a + k * 6;
            s.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.01); s.material.opacity = 1 - k });
        };
        break }
      case 'eyes': case 'players': case 'models': {
        const kind = L.feat;
        const sw = swarm(g, i => {
          const o = new THREE.Group();
          const mat = new THREE.MeshStandardMaterial({ color: kind === 'eyes' ? '#3a3f46' : kind === 'models' ? '#bfe9ff' : '#f0d08a', metalness: kind === 'eyes' ? .8 : .3, roughness: .4,
            emissive: new THREE.Color(kind === 'eyes' ? '#000' : kind === 'models' ? '#57c8ff' : ['#f0b060', '#7fe0c8', '#b09cff', '#ff9a70'][i % 4]), emissiveIntensity: kind === 'eyes' ? 0 : .9 });
          const b = new THREE.Mesh(moonGeo, mat); b.scale.setScalar(kind === 'models' ? .16 : kind === 'eyes' ? .11 : .075); o.add(b);
          if (kind === 'eyes') { const lens = glow('#9fe8d8', .32, 2); lens.position.set(0, 0, 0); o.add(lens); o.userData.lens = lens }
          o.userData.r = R * (kind === 'players' ? 1.55 + (i % 3) * .18 : 1.7); o.userData.sp = kind === 'players' ? .55 + (i % 4) * .08 : .3;
          return o;
        });
        F.tick = (w2, dt, t) => {
          const f = (w2.preset || {}).facts || {};
          const n = kind === 'eyes' ? Math.min(12, (f.cams || []).length) : kind === 'models' ? Math.min(4, (f.models || []).length) : Math.min(16, f.players || 0);
          sw.set(w2.up === false ? 0 : n);
          sw.tick(dt, (o, i) => { if (o.userData.lens) { const on = ((f.cams || [])[i] || {}).on; o.userData.lens.material.color.copy(hdr(on ? '#9fe8d8' : DOWN, on ? 2 : 1.4)); o.userData.lens.material.opacity = on ? 1 : .4 + .3 * Math.sin(t * 2 + i) } });
        };
        break }
      case 'progress': {
        const tilt = new THREE.Group(); tilt.rotation.x = Math.PI / 2.2; g.add(tilt);
        const bg = faint(R * 1.5, .02), arc = arcRing(R * 1.5, .045, '#f0d08a'), head = glow('#f0d08a', .55, 2.4); tilt.add(bg, arc); tilt.add(head);
        F.tick = (w2, dt, t) => {
          const f = (w2.preset || {}).facts || {}, act = f.state === 'printing' || f.state === 'paused';
          const c = f.state === 'error' ? DOWN : f.state === 'paused' ? LEVEL_COL[1] : '#f0d08a';
          arc.visible = head.visible = act; bg.visible = !!f.state;
          if (act) { setArc(arc, f.progress || 0); arc.material.color.copy(hdr(c, 1.5)); const a = Math.PI * 2 * Math.max(.002, f.progress || 0);
            head.position.set(Math.cos(a) * R * 1.5, Math.sin(a) * R * 1.5, 0); head.material.color.copy(hdr(c, 2.4)); head.material.opacity = .5 + .5 * Math.sin(t * 6) }
        };
        break }
    }
    return F;
  }

  function build(w, k, n) {
    const L = OP.look(w), e = { id: w.id, k };
    e.g = new THREE.Group(); e.g.position.copy(slot(k, n)); root.add(e.g);
    e.live = makeLiving({ seed: w.id + w.addr, R: L.R, style: L.style });
    e.planet = e.live.planet; e.g.add(e.live.group);
    e.shell = new THREE.Mesh(new THREE.SphereGeometry(L.R * 1.55, 16, 12), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));   // easy to point at
    e.g.add(e.shell);
    [e.planet, e.shell].forEach(p => { p.userData.world = w.id; pick.push(p) });
    e.halo = glow(LINK_COL[w.link], L.R * 4.8, 0.35); e.g.add(e.halo);
    e.lab = label(''); e.lab.position.set(0, -(L.R + (L.feat === 'pools' || L.feat === 'ring' ? .9 : 1.0)), 0); e.g.add(e.lab);
    e.feat = makeFeat(e, w);
    e.curve = tetherTo(e.g.position, L.R + 0.5);
    e.tMat = new THREE.MeshBasicMaterial({ color: hdr(LINK_COL[w.link], 1.2), transparent: true, opacity: 0.4, depthWrite: false });
    e.tether = new THREE.Mesh(new THREE.TubeGeometry(e.curve, 72, 0.022, 6), e.tMat); root.add(e.tether);
    e.packets = [0, 1, 2].map(() => { const s = glow(LINK_COL[w.link], 0.35, 2.4); root.add(s); return s });
    W.set(w.id, e); return e;
  }
  function drop(e) {
    [e.g, e.tether, ...e.packets].forEach(o => { o.traverse(x => { if (x.isCSS2DObject) x.element.remove() }); root.remove(o) });
    [e.planet, e.shell].forEach(o => { const i = pick.indexOf(o); if (i >= 0) pick.splice(i, 1) });
    e.g.traverse(x => { if (x.geometry && x.geometry !== moonGeo) x.geometry.dispose(); if (x.material && x.material.dispose) x.material.dispose() });
    e.live.dispose(); W.delete(e.id);
  }

  function update(dt, t, { hover }) {
    const list = (S.worlds || []).filter(w => w.enabled && !w.media);
    const ids = new Set(list.map(w => w.id));
    for (const e of [...W.values()]) if (!ids.has(e.id)) drop(e);
    list.forEach((w, i) => {
      let e = W.get(w.id);
      const look = w.type + w.link + (i + 1) + '/' + list.length;
      if (e && e.look !== look) { drop(e); e = null }
      if (!e) { e = build(w, i + 1, list.length); e.look = look }
      const st = w.state || {}, H = w.health && !w.health.__error ? w.health : null, ok = w.up !== false, asleep = !!st.asleep;
      e.live.update({ climate: ok ? st.climate : 0, weather: ok ? st.weather : 0, busy: H && H.cpu != null ? H.cpu / 100 : .15,
        load: H && H.gpu != null ? H.gpu / 100 : 0, dark: ((w.preset || {}).facts || {}).frac || 0, asleep: asleep || !ok }, dt, t, ORIGIN);
      e.feat.tick(w, dt, t);
      const lc = ok ? LINK_COL[w.link] : asleep ? SLEEP : DOWN;
      e.halo.material.color.copy(hdr(lc, ok ? 0.35 : 0.5));
      e.tMat.color.copy(hdr(lc, 1.2)); e.tMat.opacity = ok ? .4 : .25;
      e.packets.forEach((p, j) => { p.visible = ok; if (ok) { e.curve.getPoint((t * 0.12 + j / 3) % 1, p.position) } });
      const lv = st.level || 0, col = OP.colOf(w), sum = OP.summary(w);
      const lt = `<b style="${lv && !asleep ? 'color:' + col : ''}">${esc(w.name.toUpperCase())}</b><span style="${lv || asleep ? 'color:' + col : ''}">${lv === 2 && !asleep ? '✖ ' : lv === 1 ? '⚠ ' : ''}${esc(sum)}</span><span>${esc(OP.linkLine(w))}</span>`;
      if (e.lab.element.innerHTML !== lt) e.lab.element.innerHTML = lt;
      e.lab.element.classList.toggle('alarm', lv === 2 && !asleep);
      e.lab.element.classList.toggle('hot', !!hover && hover.userData.world === w.id);
    });
  }

  function tip(obj) {
    const w = (S.worlds || []).find(x => x.id === obj.userData.world);
    return w ? OP.tip(w) : null;
  }
  return { update, tip };
}
