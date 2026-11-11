// ORRERY · 3D — other servers on the network, drawn as planets beyond the orrery with their services as moons.
// The media-server world (Plex) keeps its own big inhabited planet in orrery3d.js; this adds its service moons.
// Reads S.worlds (from worlds.js). Tether colour = how Orrery reaches the machine: purple Tailscale, blue LAN.
import * as THREE from 'three';

export const LINK_COL = { tailnet: '#9d86d6', lan: '#5aa6d8' };
const TYPE_COL = { media: '#b98f5a', nas: '#7d8a99', pc: '#b8734a', home: '#6f9a6a', generic: '#8a8172' };
const UP = '#c9a45c', DOWN = '#d14d5a';

export function makeWorlds({ scene, label, hdr, T, glowTex, pick, sunR, mediaPos }) {
  const root = new THREE.Group(); scene.add(root);
  const W = new Map();                 // id -> entry
  const sphere = new THREE.SphereGeometry(0.8, 48, 32);
  const moonGeo = (T.moon && T.moon.geometry) || new THREE.SphereGeometry(1, 16, 12);
  const base = Math.atan2(mediaPos.z, mediaPos.x), R = Math.hypot(mediaPos.x, mediaPos.z) - 1.5;
  // slots fan out from the media planet, alternating either side of it, a little closer in
  const slot = k => { const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.62; return new THREE.Vector3(Math.cos(a) * R, 0.4 + (k % 3) * 0.5, Math.sin(a) * R) };

  function tetherTo(pos, endPad) {
    const dir = pos.clone().setY(0).normalize();
    const a = dir.clone().multiplyScalar(sunR + 0.9), b = pos.clone().sub(pos.clone().normalize().multiplyScalar(endPad));
    const ctrl = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 4.5, 0));
    return new THREE.QuadraticBezierCurve3(a, ctrl, b);
  }
  function moonsFor(e, svc, ringR, size) {
    e.moonG.children.slice().forEach(m => { m.traverse(o => { if (o.isCSS2DObject) o.element.remove() }); const i = pick.indexOf(m.userData.body); if (i >= 0) pick.splice(i, 1); e.moonG.remove(m) });
    svc.forEach((s, i) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: UP, roughness: 0.55, metalness: 0.5, emissive: new THREE.Color(UP), emissiveIntensity: 0.15 });
      const body = new THREE.Mesh(moonGeo, mat); body.scale.setScalar(size); body.userData.wsvc = { id: e.id, key: s.key };
      const lab = label(`<b>${esc(s.label)}</b>`, 'o3-lab o3-wmoon'); lab.position.set(0, -size * 2.6, 0);
      g.add(body, lab); g.userData = { body, mat, lab, key: s.key, a: i / Math.max(1, svc.length) * Math.PI * 2, r: ringR };
      e.moonG.add(g); pick.push(body);
    });
  }
  function build(w, k) {
    const e = { id: w.id, k, sig: '' };
    e.g = new THREE.Group(); e.g.position.copy(slot(k)); root.add(e.g);
    e.mat = new THREE.MeshStandardMaterial({ color: TYPE_COL[w.type] || TYPE_COL.generic, roughness: 0.85, metalness: 0.1 });
    e.planet = new THREE.Mesh(sphere, e.mat); e.planet.castShadow = true; e.planet.userData.world = w.id; e.g.add(e.planet); pick.push(e.planet);
    e.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(LINK_COL[w.link], 0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    e.halo.scale.setScalar(4.2); e.g.add(e.halo);
    if (w.type === 'nas') { const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.05, 6, 72), new THREE.MeshStandardMaterial({ color: '#9aa6b4', metalness: 0.7, roughness: 0.35 })); ring.rotation.x = Math.PI / 2.3; e.g.add(ring) }
    e.lab = label(''); e.lab.position.set(0, -1.6, 0); e.g.add(e.lab);
    e.moonG = new THREE.Group(); e.g.add(e.moonG);
    e.curve = tetherTo(e.g.position, 1.1);
    e.tMat = new THREE.MeshBasicMaterial({ color: hdr(LINK_COL[w.link], 1.2), transparent: true, opacity: 0.4, depthWrite: false });
    e.tether = new THREE.Mesh(new THREE.TubeGeometry(e.curve, 72, 0.022, 6), e.tMat); root.add(e.tether);
    e.packets = [0, 1, 2].map(i => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(LINK_COL[w.link], 2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.setScalar(0.35); root.add(s); return s });
    W.set(w.id, e); return e;
  }
  function drop(e) {
    [e.g, e.tether, ...e.packets].forEach(o => { o.traverse(x => { if (x.isCSS2DObject) x.element.remove() }); root.remove(o) });
    [e.planet, ...e.moonG.children.map(m => m.userData.body)].forEach(o => { const i = pick.indexOf(o); if (i >= 0) pick.splice(i, 1) });
    W.delete(e.id);
  }

  // service moons around the big media planet (its streams already orbit further out)
  const media = { moonG: null, sig: '', id: null };
  function mediaMoons(group, w, dt) {
    if (!media.moonG) { media.moonG = new THREE.Group(); group.add(media.moonG) }
    media.moonG.visible = !!w;
    if (!w) return;
    const sig = w.services.map(s => s.key).join();
    if (sig !== media.sig) { media.sig = sig; media.id = w.id; moonsFor(media, w.services, 3.1, 0.2) }
    tickMoons(media, w, dt, 0.22);
  }
  function tickMoons(e, w, dt, speed) {
    e.moonG.children.forEach(m => {
      const u = m.userData, s = w.services.find(x => x.key === u.key) || {};
      u.a += dt * speed;
      m.position.set(Math.cos(u.a) * u.r, Math.sin(u.a * 2) * 0.12 + 0.35, Math.sin(u.a) * u.r);
      const col = s.up === false ? DOWN : UP;
      u.mat.color.set(col); u.mat.emissive.set(col); u.mat.emissiveIntensity = s.up === false ? 0.6 : 0.15;
      const lt = `<b>${esc(s.label || u.key)}</b>${s.up === false ? '<span class="bad">down</span>' : ''}`;
      if (u.lab.element.innerHTML !== lt) u.lab.element.innerHTML = lt;
    });
  }

  function update(dt, t, { mediaGroup, mediaWorld, hover }) {
    const list = (S.worlds || []).filter(w => w.enabled && !w.media);
    const ids = new Set(list.map(w => w.id));
    for (const e of [...W.values()]) if (!ids.has(e.id)) drop(e);
    list.forEach((w, i) => {
      let e = W.get(w.id);
      const look = w.type + w.link + (i + 1);
      if (e && e.look !== look) { drop(e); e = null }
      if (!e) { e = build(w, i + 1); e.look = look }
      const sig = w.services.map(s => s.key).join();
      if (sig !== e.sig) { e.sig = sig; moonsFor(e, w.services, 1.55, 0.13) }
      tickMoons(e, w, dt, 0.35);
      e.planet.rotation.y += dt * 0.08;
      const ok = w.up !== false;
      e.mat.emissive.set(ok ? '#000' : DOWN); e.mat.emissiveIntensity = ok ? 0 : 0.25;
      e.tMat.color.copy(hdr(ok ? LINK_COL[w.link] : DOWN, 1.2));
      e.packets.forEach((p, j) => { p.visible = ok; if (ok) { e.curve.getPoint((t * 0.12 + j / 3) % 1, p.position) } });
      const up = w.services.filter(s => s.up).length;
      const lt = `<b>${esc(w.name.toUpperCase())}</b><span>${ok ? `${w.link === 'tailnet' ? 'tailscale' : 'lan'}${w.ms != null ? ' · ' + w.ms.toFixed(0) + ' ms' : ''}${w.services.length ? ` · ${up}/${w.services.length} up` : ''}` : 'unreachable'}</span>`;
      if (e.lab.element.innerHTML !== lt) e.lab.element.innerHTML = lt;
      e.lab.element.classList.toggle('hot', !!hover && (hover === e.planet || (hover.userData.wsvc && hover.userData.wsvc.id === w.id)));
    });
    if (mediaGroup) mediaMoons(mediaGroup, mediaWorld && mediaWorld.enabled ? mediaWorld : null, dt);
  }

  function tip(obj) {
    const d = obj.userData, w = (S.worlds || []).find(x => x.id === (d.world || (d.wsvc && d.wsvc.id)));
    if (!w) return null;
    const row = (a, b, st = '') => `<div class="row"><span>${a}</span><b style="${st}">${b}</b></div>`;
    if (d.wsvc) {
      const s = w.services.find(x => x.key === d.wsvc.key) || {};
      return `<h4>${esc(s.label || d.wsvc.key)}</h4>${row('on', esc(w.name))}${row('port', s.port || '—')}`
        + row('status', s.up ? 'answering' : s.up === false ? 'not answering' : '—', `color:${s.up ? 'var(--verd)' : 'var(--rose)'}`)
        + (s.ms != null ? row('connect', s.ms.toFixed(0) + ' ms') : '');
    }
    return `<h4>${esc(w.name)}</h4>${row(esc(w.typeLabel), esc(w.addr))}`
      + row('link', w.link === 'tailnet' ? 'Tailscale' : 'local network', `color:${LINK_COL[w.link]}`)
      + row('reachable', w.up ? `yes · ${(w.ms || 0).toFixed(0)} ms` : w.up === false ? 'no' : '—', `color:${w.up === false ? 'var(--rose)' : 'var(--verd)'}`)
      + w.services.map(s => row(`${s.up === false ? '✕' : '●'} ${esc(s.label)}`, s.port ? ':' + s.port : '', `color:${s.up === false ? 'var(--rose)' : 'var(--brass)'}`)).join('')
      + '<div class="row"><span style="color:var(--faint)">click to manage in Setup</span></div>';
  }
  return { update, tip };
}
