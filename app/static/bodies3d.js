// ORRERY · bodies — every guest gets a small brass instrument shaped like its job instead of a plain planet.
// Each factory builds at roughly unit radius (scaled by the guest's size) and returns
//   { group, main, tick(dt, t, g, e) }   — `main` takes the CPU heat glow and turns to iron when the guest stops.
import * as THREE from 'three';

const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const metal = (color, o = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.32, ...o });
const matte = (color, o = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.8, ...o });
const glow = (color, k = 1.6) => new THREE.MeshBasicMaterial({ color: hdr(color, k), toneMapped: false });
const brass = () => metal('#c9a45c');
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m };
const tr = () => (S.traits || {});
const fx = () => (S.fx || {});

// --- the shapes ------------------------------------------------------------------------------
function house() {              // Home Assistant — a little house whose windows burn brighter with load
  const G = new THREE.Group(), main = metal('#c9a45c'), roofM = metal('#3f6f63', { roughness: 0.45 }), win = glow('#ffcf80', 1.2);
  G.add(mesh(new THREE.BoxGeometry(1.3, 0.85, 1.0), main, 0, -0.2, 0));
  const tri = new THREE.Shape([new THREE.Vector2(-0.82, 0), new THREE.Vector2(0.82, 0), new THREE.Vector2(0, 0.62)]);
  const roof = mesh(new THREE.ExtrudeGeometry(tri, { depth: 1.16, bevelEnabled: false }), roofM, 0, 0.22, -0.58); G.add(roof);
  G.add(mesh(new THREE.BoxGeometry(0.16, 0.42, 0.16), roofM, 0.42, 0.62, -0.15));
  [[-0.38, -0.12], [0.38, -0.12]].forEach(([x, y]) => { G.add(mesh(new THREE.PlaneGeometry(0.26, 0.24), win, x, y, 0.505)); const b = mesh(new THREE.PlaneGeometry(0.26, 0.24), win, x, y, -0.505); b.rotation.y = Math.PI; G.add(b) });
  G.add(mesh(new THREE.PlaneGeometry(0.22, 0.4), matte('#2a1d12'), 0, -0.42, 0.506));
  return { group: G, main, tick: (dt, t, g) => { const L = fx().haLights; win.color.copy(hdr('#ffcf80', L == null ? 0.7 + (g.cpu || 0) * 6 : 0.25 + Math.min(1, L * 3) * 2.2 + Math.sin(t * 3) * 0.05)) } };
}
function dbstack() {            // Postgres — the classic database stack, rings pulse with disk activity
  const G = new THREE.Group(), main = metal('#4f7fae'), ring = glow('#7fe9ff', 1.4);
  for (let i = 0; i < 3; i++) {
    G.add(mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.34, 40), main, 0, -0.42 + i * 0.4, 0));
    if (i < 2) { const r = mesh(new THREE.TorusGeometry(0.73, 0.025, 6, 48), ring, 0, -0.22 + i * 0.4, 0); r.rotation.x = Math.PI / 2; G.add(r) }
  }
  const rings = G.children.filter(c => c.geometry && c.geometry.type === 'TorusGeometry');
  return { group: G, main, tick: (dt, t, g, e) => { const r = (S.rates || {})[g.id] || {}, io = Math.log10((r.diskwrite || 0) + 1), q = Math.min(1, Math.log10((r.netin || 0) + (r.netout || 0) + 1) / 6); ring.color.copy(hdr('#7fe9ff', 0.6 + Math.max(0, io - 3) * 0.6 + q * 1.2 + Math.sin(t * (4 + q * 10)) * 0.15)); rings.forEach((m, i) => { m.rotation.z += dt * (0.2 + q * 4) * (i ? -1 : 1) }) } };
}
function vault() {              // PBS — a safe; the dial spins while a backup runs
  const G = new THREE.Group(), main = metal('#7c828c', { roughness: 0.4 }), door = brass();
  G.add(mesh(new THREE.BoxGeometry(1.2, 1.2, 1.1), main));
  const d = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 40), door, 0, 0, 0.58); d.rotation.x = Math.PI / 2; G.add(d);
  const dial = new THREE.Group(); dial.position.set(0, 0, 0.64); G.add(dial);
  for (let i = 0; i < 4; i++) { const s = mesh(new THREE.BoxGeometry(0.06, 0.6, 0.05), door); s.rotation.z = i * Math.PI / 4; dial.add(s) }
  dial.add(mesh(new THREE.SphereGeometry(0.1, 16, 12), glow('#f0d08a', 1.4)));
  [-0.45, 0.45].forEach(y => G.add(mesh(new THREE.BoxGeometry(0.1, 0.18, 0.08), door, 0.62, y, 0.3)));
  return { group: G, main, tick: (dt) => { dial.rotation.z += dt * ((tr().backup || {}).running ? 3 : 0.15) } };
}
function blackhole() {          // Pi-hole — a literal hole: a dark core inside a spinning raspberry torus
  const G = new THREE.Group(), main = metal('#a3324a', { roughness: 0.4 }), edge = glow('#ff7a8a', 1.3);
  const t1 = mesh(new THREE.TorusGeometry(0.62, 0.2, 18, 64), main); G.add(t1);
  G.add(mesh(new THREE.CircleGeometry(0.45, 40), new THREE.MeshBasicMaterial({ color: '#000', side: THREE.DoubleSide })));
  const h = mesh(new THREE.TorusGeometry(0.44, 0.02, 6, 64), edge); G.add(h);
  return { group: G, main, tick: (dt, t) => { G.rotation.x = 0.35 + Math.sin(t * 0.4) * 0.15; t1.rotation.z += dt * 0.6; edge.color.copy(hdr('#ff7a8a', 1 + Math.sin(t * 5) * 0.3)) } };
}
function junction() {           // Nginx Proxy Manager — a switchyard: a hub with ports, lit as traffic flows
  const G = new THREE.Group(), main = brass(), dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
  G.add(mesh(new THREE.SphereGeometry(0.34, 24, 16), main));
  const ports = dirs.map(d => {
    const v = new THREE.Vector3(...d), arm = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 10), main);
    arm.position.copy(v.clone().multiplyScalar(0.55)); arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v); G.add(arm);
    const m = glow('#5fb3a1', 1); const p = mesh(new THREE.SphereGeometry(0.14, 14, 10), m); p.position.copy(v.clone().multiplyScalar(0.9)); G.add(p); return m;
  });
  return { group: G, main, tick: (dt, t, g) => { const r = (S.rates || {})[g.id] || {}, a = Math.min(1, Math.log10((r.netin || 0) + (r.netout || 0) + 1) / 7); const f = fx().npm || 0; ports.forEach((m, i) => m.color.copy(hdr(f > 0.2 ? '#7fe9ff' : '#5fb3a1', 0.4 + a * 2 * (0.5 + 0.5 * Math.sin(t * 6 - i * 1.1)) + f * 2.5))); G.rotation.y += dt * (0.3 + f * 2) } };
}
function monitor() {            // Guacamole — a remote-desktop CRT with an avocado-green screen
  const G = new THREE.Group(), main = matte('#cfc6ac', { roughness: 0.6 }), scr = glow('#86d18c', 1.1);
  G.add(mesh(new THREE.BoxGeometry(1.25, 0.95, 0.9), main, 0, 0.12, 0));
  G.add(mesh(new THREE.PlaneGeometry(0.95, 0.7), scr, 0, 0.14, 0.455));
  G.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), main, 0, -0.42, 0));
  G.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), main, 0, -0.3, 0));
  return { group: G, main, tick: (dt, t, g) => { if (fx().guac) scr.color.copy(hdr('#d8f5ff', 1.4 + Math.sin(t * 40) * 0.06 + (Math.random() < 0.05 ? 0.4 : 0))); else scr.color.copy(hdr('#86d18c', 0.25 + ((t % 1.2) < 0.6 ? 0.25 : 0))) } };
}
function book() {               // Wiki.js — an open book, a page turning now and then
  const G = new THREE.Group(), main = matte('#7a3b2a', { roughness: 0.55 }), page = matte('#efe6d0');
  [-1, 1].forEach(s => { const c = mesh(new THREE.BoxGeometry(0.72, 0.05, 1.0), main, s * 0.37, 0, 0); c.rotation.z = -s * 0.22; G.add(c); const p = mesh(new THREE.BoxGeometry(0.66, 0.1, 0.92), page, s * 0.35, 0.07, 0); p.rotation.z = -s * 0.22; G.add(p) });
  const pivot = new THREE.Group(); pivot.position.set(0, 0.06, 0); G.add(pivot);
  const leaf = mesh(new THREE.PlaneGeometry(0.66, 0.9), new THREE.MeshStandardMaterial({ color: '#f6efe0', side: THREE.DoubleSide, roughness: 0.9 }), 0.33, 0, 0); leaf.rotation.x = -Math.PI / 2; pivot.add(leaf);
  G.rotation.x = 0.25;
  const turn = Math.PI - 0.44;
  let ph = 0;
  return { group: G, main, tick: (dt, t) => { const age = fx().wikiAge ?? 1e9; ph += dt / (age < 120 ? 0.9 : age < 900 ? 3 : 14); const k = ph % 1, tri = k < 0.5 ? k * 2 : 2 - k * 2, x = Math.min(1, Math.max(0, (tri - 0.35) / 0.3)); pivot.rotation.z = turn * x * x * (3 - 2 * x) } };
}
function telescope() {          // Seerr — a brass telescope scanning for something to watch
  const G = new THREE.Group(), main = brass(), dark = metal('#2a2a2c');
  const head = new THREE.Group(); head.position.y = 0.05; G.add(head);
  const tube = mesh(new THREE.CylinderGeometry(0.18, 0.28, 1.5, 24), main); tube.rotation.z = Math.PI / 2 - 0.55; head.add(tube);
  const lens = mesh(new THREE.CircleGeometry(0.26, 24), glow('#9fd8ff', 1.4)); lens.position.set(0.62, 0.42, 0); lens.rotation.y = Math.PI / 2; lens.rotation.x = 0; head.add(lens); lens.lookAt(1.5, 1.4, 0);
  head.add(mesh(new THREE.SphereGeometry(0.16, 14, 10), dark));
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2, l = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), dark, Math.cos(a) * 0.25, -0.38, Math.sin(a) * 0.25); l.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); G.add(l) }
  return { group: G, main, tick: (dt, t) => { const n = fx().seerrNew, fresh = n != null && t - n < 4; head.rotation.y += ((fresh ? 0.3 : Math.sin(t * 0.35) * 0.9) - head.rotation.y) * Math.min(1, dt * (fresh ? 4 : 1)); head.rotation.z += ((fresh ? 0.35 : Math.sin(t * 0.23) * 0.12) - head.rotation.z) * Math.min(1, dt * (fresh ? 4 : 1)) } };
}
function gramophone() {         // Audiobookshelf — a gramophone; the record turns while someone listens
  const G = new THREE.Group(), main = brass(), wood = matte('#6b4423', { roughness: 0.6 });
  G.add(mesh(new THREE.BoxGeometry(0.95, 0.32, 0.95), wood, 0, -0.5, 0));
  const rec = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 32), matte('#111'), 0, -0.32, 0); G.add(rec);
  rec.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.035, 20), glow('#ffb347', 1.2)));
  const pts = []; for (let i = 0; i <= 16; i++) { const k = i / 16; pts.push(new THREE.Vector2(0.05 + Math.pow(k, 3) * 0.62, k * 1.1)) }
  const horn = mesh(new THREE.LatheGeometry(pts, 32), new THREE.MeshStandardMaterial({ color: '#c9a45c', metalness: 0.8, roughness: 0.28, side: THREE.DoubleSide }), 0.28, -0.2, 0);
  horn.rotation.z = -0.75; G.add(horn);
  return { group: G, main: horn.material, tick: (dt) => { rec.rotation.y += dt * (((tr().abs || {}).sessions || []).length ? 3.5 : 0.1) } };
}
function heart() {              // Uptime Kuma — a heart that keeps beating
  const s = new THREE.Shape(); s.moveTo(0, -0.55); s.bezierCurveTo(-0.15, -0.38, -0.7, -0.15, -0.7, 0.18); s.bezierCurveTo(-0.7, 0.5, -0.32, 0.62, 0, 0.36); s.bezierCurveTo(0.32, 0.62, 0.7, 0.5, 0.7, 0.18); s.bezierCurveTo(0.7, -0.15, 0.15, -0.38, 0, -0.55);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 4, curveSegments: 24 }); geo.center();
  const main = metal('#c8414f', { roughness: 0.35 }), G = new THREE.Group(), h = mesh(geo, main); G.add(h);
  const base = main.color.clone(), sick = new THREE.Color('#ff3040');
  return { group: G, main, tick: (dt, t) => { const down = fx().kumaDown || 0, per = down ? 0.7 : 1.1, k = t % per, skip = down && Math.floor(t / per) % 3 === 2, b = skip ? 0 : Math.exp(-((k - 0.08) ** 2) / 0.002) * (down ? 0.22 : 0.14) + Math.exp(-((k - 0.3) ** 2) / 0.003) * 0.09; h.scale.setScalar(1 + b); if (down) { main.color.copy(base).lerp(sick, Math.min(1, 0.6 + b * 2)); main.userData.sick = true } else if (main.userData.sick) { main.color.copy(base); main.userData.sick = false } } };
}
function cartridge() {          // RomM — a game cartridge
  const G = new THREE.Group(), main = matte('#8a8f99', { roughness: 0.55 }), lab = glow('#9d86d6', 1.1);
  G.add(mesh(new THREE.BoxGeometry(1.1, 1.3, 0.28), main));
  G.add(mesh(new THREE.PlaneGeometry(0.8, 0.62), lab, 0, 0.12, 0.142));
  for (let i = 0; i < 4; i++) G.add(mesh(new THREE.BoxGeometry(0.9, 0.03, 0.31), main, 0, 0.56 - i * 0.07, 0));
  for (let i = 0; i < 5; i++) G.add(mesh(new THREE.BoxGeometry(0.12, 0.08, 0.3), metal('#d4b86a'), -0.3 + i * 0.15, -0.68, 0));
  return { group: G, main, tick: (dt, t) => { G.rotation.y += dt * 0.5; lab.color.copy(hdr('#9d86d6', ((tr().romm || {}).playing || []).length ? 1.6 + Math.sin(t * 8) * 0.4 : 0.8)) } };
}
function barchart() {           // Netdata — a live bar chart
  const G = new THREE.Group(), main = metal('#2f7d6d'), top = glow('#7fe9ff', 1.3);
  G.add(mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.1, 32), main, 0, -0.6, 0));
  const bars = []; for (let i = 0; i < 5; i++) { const b = mesh(new THREE.BoxGeometry(0.2, 1, 0.2), main, -0.5 + i * 0.25, -0.55, 0); b.add(mesh(new THREE.BoxGeometry(0.21, 0.04, 0.21), top, 0, 0.5, 0)); G.add(b); bars.push({ b, v: 0.5 }) }
  return { group: G, main, tick: (dt, t, g) => bars.forEach((x, i) => { x.v += (0.25 + Math.abs(Math.sin(t * (0.9 + i * 0.37) + i)) * (0.4 + (g.cpu || 0) * 6) - x.v) * Math.min(1, dt * 3); const h = Math.min(1.4, x.v); x.b.scale.y = h; x.b.position.y = -0.55 + h / 2 }) };
}
function papers() {             // Paperless — a stack of documents with one sheet drifting up and settling
  const G = new THREE.Group(), main = matte('#e9e0c9'), ink = matte('#5a5248');
  for (let i = 0; i < 7; i++) { const p = mesh(new THREE.BoxGeometry(1.0, 0.035, 1.3), main, (Math.random() - .5) * 0.06, -0.4 + i * 0.05, (Math.random() - .5) * 0.06); p.rotation.y = (Math.random() - .5) * 0.18; G.add(p) }
  const top = mesh(new THREE.BoxGeometry(1.0, 0.02, 1.3), main); G.add(top);
  for (let i = 0; i < 5; i++) top.add(mesh(new THREE.BoxGeometry(0.7 - (i % 2) * 0.2, 0.025, 0.04), ink, -0.05, 0.005, -0.4 + i * 0.18));
  return { group: G, main, tick: (dt, t) => { const busy = fx().paperBusy, k = (Math.sin(t * (busy ? 4 : 0.8)) + 1) / 2; top.position.set(Math.sin(t * 0.5) * 0.1, -0.02 + k * 0.45, 0); top.rotation.set(Math.sin(t * 1.3) * 0.15 * k, t * 0.2, Math.cos(t * 1.1) * 0.12 * k) } };
}
function radar() {              // Tracearr — a tracking dish sweeping the sky
  const G = new THREE.Group(), main = brass(), dark = metal('#2a2a2c');
  G.add(mesh(new THREE.CylinderGeometry(0.08, 0.16, 0.7, 12), dark, 0, -0.35, 0));
  const head = new THREE.Group(); head.position.y = 0.05; G.add(head);
  const pts = []; for (let i = 0; i <= 12; i++) { const k = i / 12; pts.push(new THREE.Vector2(k * 0.72, k * k * 0.35)) }
  const dish = mesh(new THREE.LatheGeometry(pts, 32), new THREE.MeshStandardMaterial({ color: '#c9a45c', metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide })); dish.rotation.x = -0.9; head.add(dish);
  const feed = mesh(new THREE.SphereGeometry(0.07, 10, 8), glow('#e0663b', 1.6), 0, 0.3, 0.22); head.add(feed);
  return { group: G, main: dish.material, tick: (dt, t) => { const n = fx().radar || 0; head.rotation.y += dt * (0.9 + Math.min(3, n) * 0.8); feed.material.color.copy(hdr(fx().violation ? '#ff3040' : '#e0663b', (n ? 1.6 : 0.8) + Math.sin(t * (n ? 10 : 4)) * 0.6)) } };
}
function armillary() {          // Orrery itself — a tiny armillary sphere
  const G = new THREE.Group(), main = brass(), rings = [];
  G.add(mesh(new THREE.SphereGeometry(0.2, 20, 14), glow('#ffcf80', 1.6)));
  [[0.75, 0], [0.62, 1.1], [0.5, 2.1]].forEach(([r, a]) => { const g = new THREE.Group(); g.rotation.set(a * 0.6, a, 0.3 * a); const m = mesh(new THREE.TorusGeometry(r, 0.035, 8, 64), main); g.add(m); G.add(g); rings.push(g) });
  return { group: G, main, tick: (dt) => { const v = Math.max(1, fx().viewers || 1); rings.forEach((r, i) => { r.rotation.y += dt * (0.4 + i * 0.35) * (i % 2 ? -1 : 1) * (0.7 + v * 0.5) }) } };
}
function cog() {                // orrery-build — a gear (the Blender build box)
  const s = new THREE.Shape(), n = 10;
  for (let i = 0; i < n * 2; i++) { const a0 = i / (n * 2) * Math.PI * 2, a1 = (i + 1) / (n * 2) * Math.PI * 2, r = i % 2 ? 0.58 : 0.75; s.absarc(0, 0, r, a0, a1, false) }
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.2, 0, Math.PI * 2, true); s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2 }); geo.center();
  const main = metal('#9a9aa2', { roughness: 0.4 }), G = new THREE.Group(), c = mesh(geo, main); G.add(c);
  return { group: G, main, tick: (dt, t, g) => { c.rotation.z += dt * (g.status === 'running' ? 1.2 : 0) } };
}

// --- who gets what ---------------------------------------------------------------------------
const BY_NAME = [
  [/^homeassistant|home-?assistant|^hass/i, house], [/postgres|mariadb|mysql|^db$/i, dbstack], [/^pbs|backup/i, vault],
  [/pihole|pi-hole|adguard/i, blackhole], [/^npm$|proxy|traefik|caddy/i, junction], [/guacamole|rdp|desktop/i, monitor],
  [/wiki|docs|bookstack/i, book], [/seerr|overseerr|jellyseerr|ombi/i, telescope], [/audiobook|abs$/i, gramophone],
  [/uptime|kuma|status/i, heart], [/romm|retro|emul/i, cartridge], [/netdata|grafana|prometheus/i, barchart],
  [/paperless|document/i, papers], [/tracearr|tautulli|tracker/i, radar], [/orrery-build|build/i, cog], [/^orrery$/i, armillary],
];
const SKIP = /^(netviz|immich)$/i;   // these two are drawn as globes by traits3d.js
const LOOKS = { house, dbstack, vault, blackhole, junction, monitor, book, telescope, gramophone, heart, cartridge, barchart, papers, radar, cog, armillary };
export function bodyFor(name) {
  const L = globalThis.__orreryLooks;        // set by setup.js from /api/next/bindings
  if (L && name in L) return LOOKS[L[name]] ? LOOKS[L[name]]() : null;   // 'globe' and 'generic' draw no body
  if (SKIP.test(name)) return null;
  const hit = BY_NAME.find(([rx]) => rx.test(name));
  return hit ? hit[1]() : null;
}
export const hasGlobe = name => SKIP.test(name);
