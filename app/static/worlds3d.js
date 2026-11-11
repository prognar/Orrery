// ORRERY · 3D — other servers on the network, drawn as planets beyond the orrery with their services as moons.
// The media-server world (Plex) keeps its own big inhabited planet in orrery3d.js; this adds its service moons.
// Reads S.worlds (from worlds.js). Tether colour = how Orrery reaches the machine: purple Tailscale, blue LAN.
import * as THREE from 'three';

export const LINK_COL = { tailnet: '#9d86d6', lan: '#5aa6d8' };
const TYPE_COL = { media: '#b98f5a', nas: '#7d8a99', pc: '#b8734a', home: '#6f9a6a', generic: '#8a8172' };
const UP = '#c9a45c', DOWN = '#d14d5a', HOT = '#e0663b', GPU = '#5fb3a1';
const HOT_C = 85;   // °C: CPU or GPU at or above this pulses red

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
    // health gauges: brass arc = RAM, teal arc = GPU load (drawn only when the machine reports them)
    e.ramArc = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.035, 6, 72, 0.01), new THREE.MeshBasicMaterial({ color: hdr(UP, 1.5) }));
    e.gpuArc = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.035, 6, 72, 0.01), new THREE.MeshBasicMaterial({ color: hdr(GPU, 1.6) }));
    e.ramArc.rotation.x = e.gpuArc.rotation.x = -Math.PI / 2; e.ramArc.visible = e.gpuArc.visible = false; e.rf = e.gf = -1;
    e.g.add(e.ramArc, e.gpuArc);
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
    const on = w.services.filter(s => s.on !== false), sig = on.map(s => s.key).join();
    if (sig !== media.sig) { media.sig = sig; media.id = w.id; moonsFor(media, on, 3.1, 0.2) }
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
      const on = w.services.filter(s => s.on !== false), sig = on.map(s => s.key).join();
      if (sig !== e.sig) { e.sig = sig; moonsFor(e, on, 1.75, 0.13) }
      tickMoons(e, w, dt, 0.35);
      const ok = w.up !== false, H = w.health && !w.health.__error ? w.health : null;
      const cpu = H && H.cpu != null ? Math.min(100, H.cpu) / 100 : 0;
      const maxT = H ? Math.max(H.cpuT || 0, H.gpuT || 0) : 0, hot = maxT >= HOT_C;
      e.planet.rotation.y += dt * (0.06 + cpu * 0.7);                       // busier machine, faster spin
      if (!ok) { e.mat.emissive.set(DOWN); e.mat.emissiveIntensity = 0.25 }
      else if (hot) { const pu = 0.5 + 0.5 * Math.sin(t * 5); e.mat.emissive.set(DOWN); e.mat.emissiveIntensity = 0.25 + 0.45 * pu }
      else { e.mat.emissive.set(HOT); e.mat.emissiveIntensity = cpu * 0.55 }   // surface warms with CPU load
      e.halo.material.color.copy(hdr(LINK_COL[w.link], 0.6)).lerp(hdr(HOT, 0.9), cpu * 0.6);
      const rf = H && H.ramPct != null ? Math.min(1, H.ramPct / 100) : null, gf = H && H.gpu != null ? Math.min(1, H.gpu / 100) : null;
      e.ramArc.visible = rf != null; e.gpuArc.visible = gf != null;
      if (rf != null && Math.abs(rf - e.rf) > 0.01) { e.rf = rf; e.ramArc.geometry.dispose(); e.ramArc.geometry = new THREE.TorusGeometry(1.12, 0.035, 6, 72, Math.max(0.01, rf * Math.PI * 2)); e.ramArc.material.color.copy(hdr(rf > 0.9 ? DOWN : UP, 1.5)) }
      if (gf != null && Math.abs(gf - e.gf) > 0.01) { e.gf = gf; e.gpuArc.geometry.dispose(); e.gpuArc.geometry = new THREE.TorusGeometry(1.3, 0.035, 6, 72, Math.max(0.01, gf * Math.PI * 2)) }
      e.lab.element.classList.toggle('alarm', hot || !ok);
      e.tMat.color.copy(hdr(ok ? LINK_COL[w.link] : DOWN, 1.2));
      e.packets.forEach((p, j) => { p.visible = ok; if (ok) { e.curve.getPoint((t * 0.12 + j / 3) % 1, p.position) } });
      const up = w.services.filter(s => s.up).length;
      const hp = H ? [H.cpu != null ? `cpu ${H.cpu.toFixed(0)}%${H.cpuT ? ' ' + H.cpuT.toFixed(0) + '°' : ''}` : '', H.ramPct != null ? `ram ${H.ramPct.toFixed(0)}%` : '',
                      H.gpu != null || H.gpuT ? `gpu ${H.gpu != null ? H.gpu.toFixed(0) + '%' : ''}${H.gpuT ? ' ' + H.gpuT.toFixed(0) + '°' : ''}` : ''].filter(Boolean).join(' · ') : '';
      const lt = `<b>${esc(w.name.toUpperCase())}</b>${hp ? `<span${hot ? ' class="bad"' : ''}>${hp}</span>` : ''}<span>${ok ? `${w.link === 'tailnet' ? 'tailscale' : 'lan'}${w.ms != null ? ' · ' + w.ms.toFixed(0) + ' ms' : ''}${w.services.length ? ` · ${up}/${w.services.length} up` : ''}` : 'unreachable'}</span>`;
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
      + healthRows(w.health, row)
      + w.services.filter(s => s.on !== false).map(s => row(`${s.up === false ? '✕' : '●'} ${esc(s.label)}`, s.port ? ':' + s.port : '', `color:${s.up === false ? 'var(--rose)' : 'var(--brass)'}`)).join('')
      + '<div class="row"><span style="color:var(--faint)">click to manage in Setup</span></div>';
  }
  return { update, tip };
}

const tc = v => v == null ? '' : `<span style="color:${v >= HOT_C ? 'var(--rose)' : v >= 70 ? 'var(--ember)' : 'var(--verd)'}">${v.toFixed(0)}°C</span>`;
function healthRows(H, row) {
  if (!H) return row('health', 'no agent', 'color:var(--faint)');
  if (H.__error) return row('health', esc(H.src) + ' not answering', 'color:var(--rose)');
  let h = row('<i>health</i>', esc(H.src), 'color:var(--brass)');
  if (H.cpu != null || H.cpuT) h += row(`cpu${H.cpuName ? ' · ' + esc(H.cpuName).slice(0, 18) : ''}`, `${H.cpu != null ? H.cpu.toFixed(0) + '%' : ''} ${tc(H.cpuT)}`);
  if (H.gpu != null || H.gpuT) h += row(`gpu${H.gpuName ? ' · ' + esc(H.gpuName.replace(/^NVIDIA |^AMD /, '')).slice(0, 18) : ''}`, `${H.gpu != null ? H.gpu.toFixed(0) + '%' : ''} ${tc(H.gpuT)}`);
  if (H.vram) h += row('vram', `${(H.vram[0] / 1024).toFixed(1)} / ${(H.vram[1] / 1024).toFixed(0)} GB`);
  if (H.ram) h += row('ram', `${(H.ram[0] / 1024).toFixed(1)} / ${(H.ram[1] / 1024).toFixed(0)} GB · ${(H.ramPct || 0).toFixed(0)}%`, H.ramPct > 90 ? 'color:var(--rose)' : '');
  (H.disks || []).slice(0, 3).forEach(d => { if (d.t != null || d.used != null) h += row(esc(d.name).slice(0, 22), `${d.used != null ? d.used.toFixed(0) + '% full ' : ''}${tc(d.t)}`) });
  if (H.up) h += row('up', fmtUp(H.up));
  return h;
}
