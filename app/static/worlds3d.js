// ORRERY · 3D — other servers on the network, drawn as planets beyond the orrery with their services as moons.
// The media-server world (Plex) keeps its own big inhabited planet in orrery3d.js; this adds its service moons.
// Every other machine is a living world (livingworld.js) whose land, sea, fire and weather are its health.
// Reads S.worlds (from worlds.js). Tether colour = how Orrery reaches the machine: purple Tailscale, blue LAN.
import * as THREE from 'three';
import { makeLiving, livingLegend, HOT_C } from './livingworld.js';

export const LINK_COL = { tailnet: '#9d86d6', lan: '#5aa6d8' };
const UP = '#c9a45c', DOWN = '#d14d5a';
const ORIGIN = new THREE.Vector3();

export function makeWorlds({ scene, label, hdr, T, glowTex, pick, sunR, mediaPos }) {
  const root = new THREE.Group(); scene.add(root);
  const W = new Map();                 // id -> entry
  const moonGeo = (T.moon && T.moon.geometry) || new THREE.SphereGeometry(1, 16, 12);
  const base = Math.atan2(mediaPos.z, mediaPos.x), R = Math.hypot(mediaPos.x, mediaPos.z) - 1.0;
  // slots fan out from the media planet, alternating either side of it
  const slot = k => { const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.66; return new THREE.Vector3(Math.cos(a) * R, 0.6 + (k % 3) * 0.6, Math.sin(a) * R) };

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
    e.live = makeLiving({ seed: w.id + w.addr, glowTex, hdr });
    e.live.pickables.forEach(p => { p.userData.world = w.id; pick.push(p) });
    e.planet = e.live.planet; e.g.add(e.live.group);
    e.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(LINK_COL[w.link], 0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    e.halo.scale.setScalar(6.5); e.g.add(e.halo);
    if (w.type === 'nas') { const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.05, 6, 96), new THREE.MeshStandardMaterial({ color: '#9aa6b4', metalness: 0.7, roughness: 0.35 })); ring.rotation.x = Math.PI / 2.3; e.g.add(ring) }
    e.lab = label(''); e.lab.position.set(0, -2.45, 0); e.g.add(e.lab);
    e.moonG = new THREE.Group(); e.g.add(e.moonG);
    e.curve = tetherTo(e.g.position, 1.9);
    e.tMat = new THREE.MeshBasicMaterial({ color: hdr(LINK_COL[w.link], 1.2), transparent: true, opacity: 0.4, depthWrite: false });
    e.tether = new THREE.Mesh(new THREE.TubeGeometry(e.curve, 72, 0.022, 6), e.tMat); root.add(e.tether);
    e.packets = [0, 1, 2].map(i => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: hdr(LINK_COL[w.link], 2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.setScalar(0.35); root.add(s); return s });
    W.set(w.id, e); return e;
  }
  function drop(e) {
    [e.g, e.tether, ...e.packets].forEach(o => { o.traverse(x => { if (x.isCSS2DObject) x.element.remove() }); root.remove(o) });
    [...e.live.pickables, ...e.moonG.children.map(m => m.userData.body)].forEach(o => { const i = pick.indexOf(o); if (i >= 0) pick.splice(i, 1) });
    e.live.dispose(); W.delete(e.id);
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
      m.position.set(Math.cos(u.a) * u.r, Math.sin(u.a * 2) * 0.15 + 0.35, Math.sin(u.a) * u.r);
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
      if (sig !== e.sig) { e.sig = sig; moonsFor(e, on, 2.85, 0.13) }
      tickMoons(e, w, dt, 0.3);
      const ok = w.up !== false, H = w.health && !w.health.__error ? w.health : null;
      e.live.update(H, dt, t, ORIGIN);
      const maxT = H ? Math.max(H.cpuT || 0, H.gpuT || 0) : 0, hot = maxT >= HOT_C;
      e.halo.material.color.copy(hdr(ok ? LINK_COL[w.link] : DOWN, ok ? 0.35 : 0.6));
      e.tMat.color.copy(hdr(ok ? LINK_COL[w.link] : DOWN, 1.2));
      e.packets.forEach((p, j) => { p.visible = ok; if (ok) { e.curve.getPoint((t * 0.12 + j / 3) % 1, p.position) } });
      const up = w.services.filter(s => s.on !== false && s.up).length, non = w.services.filter(s => s.on !== false).length;
      const hp = H ? [H.cpu != null ? `cpu ${H.cpu.toFixed(0)}%${H.cpuT ? ' ' + H.cpuT.toFixed(0) + '°' : ''}` : '', H.ramPct != null ? `ram ${H.ramPct.toFixed(0)}%` : '',
                      H.gpu != null || H.gpuT ? `gpu ${H.gpu != null ? H.gpu.toFixed(0) + '%' : ''}${H.gpuT ? ' ' + H.gpuT.toFixed(0) + '°' : ''}` : ''].filter(Boolean).join(' · ') : '';
      const lt = `<b>${esc(w.name.toUpperCase())}</b>${hp ? `<span${hot ? ' class="bad"' : ''}>${hp}</span>` : ''}<span>${ok ? `${w.link === 'tailnet' ? 'tailscale' : 'lan'}${w.ms != null ? ' · ' + w.ms.toFixed(0) + ' ms' : ''}${non ? ` · ${up}/${non} up` : ''}` : 'unreachable'}</span>`;
      if (e.lab.element.innerHTML !== lt) e.lab.element.innerHTML = lt;
      e.lab.element.classList.toggle('alarm', hot || !ok);
      e.lab.element.classList.toggle('hot', !!hover && (hover.userData.world === w.id || (hover.userData.wsvc && hover.userData.wsvc.id === w.id)));
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
      + (w.health && !w.health.__error ? row('health via', esc(w.health.src)) + livingLegend(w.health) : healthRows(w.health, row))
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
  if (H.cpu != null || H.cpuT) h += row(`cpu${H.cpuName ? ' · ' + esc(H.cpuName.replace(/^AMD |^Intel\(R\) /, '')).slice(0, 18) : ''}`, `${H.cpu != null ? H.cpu.toFixed(0) + '%' : ''} ${tc(H.cpuT)}${H.cpuW ? ' · ' + H.cpuW.toFixed(0) + ' W' : ''}`);
  if (H.gpu != null || H.gpuT) h += row(`gpu${H.gpuName ? ' · ' + esc(H.gpuName.replace(/^NVIDIA |^AMD /, '')).slice(0, 18) : ''}`, `${H.gpu != null ? H.gpu.toFixed(0) + '%' : ''} ${tc(H.gpuT)}${H.gpuW ? ' · ' + H.gpuW.toFixed(0) + ' W' : ''}`);
  if (H.vram) h += row('vram', `${(H.vram[0] / 1024).toFixed(1)} / ${(H.vram[1] / 1024).toFixed(0)} GB`);
  if (H.ram) h += row('ram', `${(H.ram[0] / 1024).toFixed(1)} / ${(H.ram[1] / 1024).toFixed(0)} GB · ${(H.ramPct || 0).toFixed(0)}%`, H.ramPct > 90 ? 'color:var(--rose)' : '');
  (H.disks || []).slice(0, 3).forEach(d => { if (d.t != null || d.used != null) h += row(esc(d.name).slice(0, 22), `${d.used != null ? d.used.toFixed(0) + '% full ' : ''}${tc(d.t)}${d.life != null && d.life < 100 ? ' · ' + d.life.toFixed(0) + '% life' : ''}`) });
  if (H.up) h += row('up', fmtUp(H.up));
  return h;
}
