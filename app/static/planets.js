/* Orrery — other servers as planets: what each preset looks like, what its label says, its hover card,
   its side panel (status, the things it's for, the machine, its services grouped), and the 2D map's drawing.
   Shared by the 3D view (worlds3d.js) and the 2D orbit map. Data: S.worlds from /api/next/worlds (worlds.js). */
(() => {
const LV_COL = ['#5fb3a1', '#f0a63a', '#e2453c'], LV_WORD = ['OK', 'ATTENTION', 'CRITICAL'], SLEEP_COL = '#7d8597';
const LINK_COL = { tailnet: '#9d86d6', lan: '#5aa6d8' };
// style = the surface (livingworld.js), R = 3D radius, r2 = 2D radius, feat = what sets it apart
const LOOK = {
  pc:      { style: 'earth', R: 1.35, r2: 17 },
  laptop:  { style: 'earth', R: 1.0, r2: 12 },
  generic: { style: 'earth', R: 1.1, r2: 14 },
  media:   { style: 'gas', R: 1.4, r2: 18, feat: 'ring' },
  nas:     { style: 'gas', R: 1.4, r2: 17, feat: 'pools' },
  backup:  { style: 'ice', R: 1.25, r2: 15 },
  router:  { style: 'gas', R: 1.15, r2: 14, feat: 'beacon' },
  dns:     { style: 'obsidian', R: 0.95, r2: 12, feat: 'disc' },
  home:    { style: 'city', R: 1.3, r2: 16 },
  nvr:     { style: 'rock', R: 1.15, r2: 14, feat: 'eyes' },
  game:    { style: 'earth', R: 1.3, r2: 16, feat: 'players' },
  ai:      { style: 'forge', R: 1.35, r2: 17, feat: 'models' },
  printer: { style: 'rock', R: 0.9, r2: 12, feat: 'progress' },
};
const look = w => LOOK[w.type] || LOOK.generic;
const ok = H => H && !H.__error ? H : null;
const F = w => ((w.preset || {}).facts) || {};
const lvOf = w => (w.state || {}).level || 0;
const ageS = s => s == null ? '—' : s < 3600 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`;
const pct0 = v => v == null ? '—' : v.toFixed(0) + '%';
const hw = H => !H ? '' : [H.cpu != null ? `cpu ${H.cpu.toFixed(0)}%${H.cpuT ? ' ' + H.cpuT.toFixed(0) + '°' : ''}` : '', H.ramPct != null ? `ram ${H.ramPct.toFixed(0)}%` : '',
  H.gpu != null || H.gpuT ? `gpu ${H.gpu != null ? H.gpu.toFixed(0) + '%' : ''}${H.gpuT ? ' ' + H.gpuT.toFixed(0) + '°' : ''}` : ''].filter(Boolean).join(' · ');

// the one-line answer under a planet's name: what you'd want to know first about this kind of machine
function summary(w) {
  const st = w.state || {}, f = F(w), H = ok(w.health);
  if (!w.enabled) return 'off';
  if (st.asleep) return 'asleep';
  if (st.level && (st.why || []).length) return st.why[0];
  switch (w.type) {
    case 'nas': { const P = f.pools || [], D = (H && H.disks || []).filter(d => d.used != null);
      if (P.length) return `${P.length} pool${P.length > 1 ? 's' : ''} · ${pct0(Math.max(...P.map(p => p.fill || 0)))} full`;
      if (D.length) return `${D.length} drive${D.length > 1 ? 's' : ''} · fullest ${pct0(Math.max(...D.map(d => d.used)))}`; break }
    case 'backup': if (f.newest != null) return `last backup ${ageS(f.newest)} ago`; break;
    case 'router': if (f.inet != null) return f.inet ? `internet ${f.inetMs != null ? f.inetMs.toFixed(0) + ' ms' : 'up'}` : 'internet down'; break;
    case 'dns': if (f.pct != null) return `${f.pct.toFixed(0)}% blocked`; if (f.dns) return `resolving · ${(f.dnsMs || 0).toFixed(0)} ms`; break;
    case 'home': if (f.devices) return `${f.devices - f.dead} / ${f.devices} devices`; break;
    case 'nvr': if ((f.cams || []).length) return `${f.cams.filter(c => c.on).length} / ${f.cams.length} cameras`; break;
    case 'game': if (f.players != null) return `${f.players} / ${f.max ?? '?'} players`; break;
    case 'ai': if (f.models) return f.models.length ? f.models.map(m => m.name).join(', ').slice(0, 34) : `idle${H && H.gpu != null ? ' · gpu ' + H.gpu.toFixed(0) + '%' : ''}`; break;
    case 'printer': if (f.state) return f.state === 'printing' ? `printing ${(f.progress * 100).toFixed(0)}%${f.left ? ' · ' + ageS(f.left) + ' left' : ''}` : f.state === 'complete' ? 'print finished' : 'idle'; break;
    case 'media': { const s = w.services.filter(x => x.group === 'Streaming').map(x => x.label.split(' ')[0]); if (s.length) return s.join(' · ') }
  }
  return hw(H) || (w.healthSrc ? '' : 'no health agent');
}
function linkLine(w) {
  if (!w.enabled) return '';
  const on = w.services.filter(s => s.on), up = on.filter(s => s.up).length;
  if (w.up === false) return (w.state || {}).asleep ? `${w.link === 'tailnet' ? 'tailscale' : 'lan'} · not answering` : 'unreachable';
  return `${w.link === 'tailnet' ? 'tailscale' : 'lan'}${w.ms != null ? ' · ' + w.ms.toFixed(0) + ' ms' : ''}${on.length ? ` · ${up}/${on.length} services` : ''}`;
}
const colOf = w => (w.state || {}).asleep || !w.enabled ? SLEEP_COL : LV_COL[lvOf(w)];

// ---------------------------------------------------------------- hover card
const row = (a, b, st = '') => `<div class="row"><span>${a}</span><b style="${st}">${b}</b></div>`;
function factRows(w) {
  const f = F(w); let h = '';
  if (w.type === 'nvr' && f.cams) h += f.cams.filter(c => !c.on).slice(0, 4).map(c => row(`<span style="color:${LV_COL[1]}">●</span> ${esc(c.name)}`, 'offline', `color:${LV_COL[1]}`)).join('');
  if (w.type === 'game' && (f.names || []).length) h += row('online', esc(f.names.slice(0, 6).join(', ')));
  if (w.type === 'game' && f.game) h += row('game', esc(f.game + (f.map ? ' · ' + f.map : '')).slice(0, 34));
  if (w.type === 'ai' && (f.models || []).length) h += f.models.slice(0, 3).map(m => row(esc(m.name).slice(0, 24), `${m.vram.toFixed(1)} GB vram`)).join('');
  if (w.type === 'printer' && f.file) h += row('file', esc(f.file).slice(0, 30));
  if (w.type === 'home' && (f.batteries || []).length) h += row('low batteries', esc(f.batteries.slice(0, 3).map(b => `${b[0]} ${b[1].toFixed(0)}%`).join(', ')).slice(0, 40));
  return h;
}
function tip(w) {
  if (!w) return null;
  const st = w.state || {}, lv = lvOf(w), on = w.services.filter(s => s.on), down = on.filter(s => s.up === false);
  let h = `<h4>${esc(w.name)}</h4>${row(esc(w.typeLabel), esc(w.addr))}`
    + row('link', w.link === 'tailnet' ? 'Tailscale' : 'local network', `color:${LINK_COL[w.link]}`);
  if (!w.enabled) return h + row('status', 'off', 'color:var(--faint)');
  if (st.asleep) h += row('status', 'asleep (not answering)', `color:${SLEEP_COL}`);
  else h += row('status', `${LV_WORD[lv]}${(st.why || []).length ? ' · ' + esc(st.why[0]) : ''}`, `color:${LV_COL[lv]}`);
  const shown = (st.checks || []).filter(c => c.level || c.sys !== 'svc').filter(c => c.sys !== 'fan' || c.level).slice(0, 7);
  shown.forEach(c => { h += row(`<span style="color:${LV_COL[c.level]}">●</span> ${esc(c.label).slice(0, 26)}`, esc(c.value), c.level ? `color:${LV_COL[c.level]}` : '') });
  h += factRows(w);
  if (on.length) h += row('services', `${on.length}${down.length ? ` · <span style="color:${LV_COL[1]}">${down.length} down</span>` : ' · all answering'}`);
  return h + '<div class="row"><span style="color:var(--faint)">click for details</span></div>';
}

// ---------------------------------------------------------------- side panel
const tc = v => v == null ? '' : `<span style="color:${v >= 85 ? 'var(--rose)' : v >= 70 ? 'var(--ember)' : 'var(--verd)'}">${v.toFixed(0)}°C</span>`;
function machineCard(w) {
  const H = w.health;
  if (!w.healthSrc) return `<div class="card"><h3>MACHINE</h3><div class="sub" style="margin:6px 0 0">No health agent. Install LibreHardwareMonitor (Windows), Glances or Netdata and connect it in Setup to see temperatures, memory and drives.</div></div>`;
  if (!H || H.__error) return `<div class="card"><h3>MACHINE<b>${esc(w.healthSrc)}</b></h3><div class="sub bad" style="margin:6px 0 0">${esc((H && H.__error) || 'not answering')}</div></div>`;
  let k = '';
  const kv = (a, b) => { k += `<span>${a}</span><b>${b}</b>` };
  if (H.cpu != null || H.cpuT) kv(`cpu${H.cpuName ? ' · ' + esc(H.cpuName.replace(/^AMD |^Intel\(R\) /, '').slice(0, 22)) : ''}`, `${H.cpu != null ? H.cpu.toFixed(0) + '%' : ''} ${tc(H.cpuT)}${H.cpuW ? ' · ' + H.cpuW.toFixed(0) + ' W' : ''}`);
  if (H.gpu != null || H.gpuT) kv(`gpu${H.gpuName ? ' · ' + esc(H.gpuName.replace(/^NVIDIA |^AMD /, '').slice(0, 22)) : ''}`, `${H.gpu != null ? H.gpu.toFixed(0) + '%' : ''} ${tc(H.gpuT)}${H.gpuW ? ' · ' + H.gpuW.toFixed(0) + ' W' : ''}`);
  if (H.vram) kv('vram', `${(H.vram[0] / 1024).toFixed(1)} / ${(H.vram[1] / 1024).toFixed(0)} GB`);
  if (H.ram) kv('memory', `${(H.ram[0] / 1024).toFixed(1)} / ${(H.ram[1] / 1024).toFixed(0)} GB · ${(H.ramPct || 0).toFixed(0)}%`);
  (H.disks || []).slice(0, 8).forEach(d => { if (d.t != null || d.used != null) kv(esc(d.name).slice(0, 24), `${d.used != null ? d.used.toFixed(0) + '% full ' : ''}${tc(d.t)}${d.life != null && d.life < 100 ? ' · ' + d.life.toFixed(0) + '% life' : ''}`) });
  const fans = (H.fans || []).filter(f => f.rpm > 0); if (fans.length) kv('fans', `${fans.length} · ${Math.max(...fans.map(f => f.rpm)).toFixed(0)} rpm max`);
  if (H.net) kv('network ↓ ↑', `${fmtR(H.net.down)} · ${fmtR(H.net.up)}`);
  if (H.up) kv('uptime', fmtUp(H.up));
  return `<div class="card"><h3>MACHINE<b>${esc(H.src)}</b></h3><div class="kv">${k || '<span>no readings</span><b></b>'}</div></div>`;
}
function presetCard(w) {
  const f = F(w), P = w.preset || {}, L = P.link;
  const head = (t, b = '') => `<div class="card"><h3>${t}<b>${b}</b></h3>`;
  let body = '';
  const kv = (a, b, st = '') => { body += `<span>${a}</span><b style="${st}">${b}</b>` };
  switch (w.type) {
    case 'nas': (f.pools || []).forEach(p => kv(`pool ${esc(p.name)}`, `${esc(p.status || '')} · ${pct0(p.fill)} full`, p.ok ? '' : `color:${LV_COL[2]}`)); break;
    case 'backup': (f.stores || []).forEach(s => kv(`datastore ${esc(s.name)}`, `${pct0(s.fill)} full`)); if (f.groups) kv('backup groups', f.groups); if (f.newest != null) kv('newest backup', ageS(f.newest) + ' ago'); if (f.stalest != null) kv('oldest last backup', ageS(f.stalest) + ' ago'); break;
    case 'router': if (f.inet != null) kv('internet', f.inet ? `up · ${(f.inetMs || 0).toFixed(0)} ms${f.loss ? ' · ' + f.loss + '% loss' : ''}` : 'down', `color:${LV_COL[f.inet ? 0 : 2]}`); if (f.dns != null) kv('dns', f.dns ? 'answering' : 'not answering'); break;
    case 'dns': if (f.dns != null) kv('answers dns', f.dns ? `yes · ${(f.dnsMs || 0).toFixed(0)} ms` : 'no', `color:${LV_COL[f.dns ? 0 : 2]}`); if (f.queries != null) kv('queries · blocked', `${f.queries.toLocaleString()} · ${f.blocked.toLocaleString()} (${f.pct.toFixed(1)}%)`); if (f.blocking != null) kv('blocking', f.blocking ? 'on' : 'off'); if (f.lists) kv('blocklist domains', f.lists.toLocaleString()); break;
    case 'home': if (f.devices) kv('devices answering', `${f.devices - f.dead} of ${f.devices}`); (f.deadNames || []).slice(0, 8).forEach(n => kv(`<span style="color:${LV_COL[1]}">●</span> ${esc(n).slice(0, 30)}`, 'unavailable')); (f.batteries || []).forEach(b => kv(`🔋 ${esc(b[0]).slice(0, 28)}`, b[1].toFixed(0) + '%', b[1] < 10 ? `color:${LV_COL[1]}` : '')); (f.updates || []).forEach(u => kv('update', esc(u).slice(0, 36))); break;
    case 'nvr': (f.cams || []).forEach(c => kv(`<span style="color:${LV_COL[c.on ? 0 : 1]}">●</span> ${esc(c.name)}`, c.on ? `${c.fps.toFixed(0)} fps${c.det ? ' · detecting ' + c.det.toFixed(1) : ''}` : 'offline', c.on ? '' : `color:${LV_COL[1]}`)); break;
    case 'game': if (f.players != null) kv('players', `${f.players} / ${f.max ?? '?'}`); (f.names || []).forEach(n => kv('▸', esc(n))); if (f.game) kv('game', esc(f.game)); if (f.map) kv('map', esc(f.map)); if (f.title) kv('server', esc(f.title).slice(0, 36)); break;
    case 'ai': (f.models || []).forEach(m => kv(esc(m.name).slice(0, 30), `${m.vram.toFixed(1)} GB in VRAM`)); if (f.models && !f.models.length) kv('models loaded', 'none (idle)'); break;
    case 'printer': if (f.state) kv('state', esc(f.state), `color:${LV_COL[f.state === 'error' ? 2 : f.state === 'paused' ? 1 : 0]}`); if (f.file) kv('file', esc(f.file).slice(0, 36)); if (f.state === 'printing') kv('progress', `${(f.progress * 100).toFixed(1)}%${f.left ? ' · ' + ageS(f.left) + ' left' : ''}`); break;
  }
  const link = L ? `${esc(L.label)}${L.error ? ` · <span class="bad">${esc(L.error)}</span>` : ''}` : '';
  if (!body && !link) {
    const want = (W_API().presets[w.type] || {}).links || [];
    if (!want.length) return '';
    return head(w.typeLabel.toUpperCase()) + `<div class="sub" style="margin:6px 0 0">Connect ${want.map(k => esc((W_API().links[k] || {}).label || k)).join(' or ')} in Setup to see more.</div></div>`;
  }
  return head(w.typeLabel.toUpperCase(), link) + `<div class="kv">${body}</div></div>`;
}
const W_API = () => globalThis.orreryWorlds && globalThis.orreryWorlds.data() || { presets: {}, links: {}, groupOrder: [] };
function servicesCard(w) {
  if (!w.services.length) return `<div class="card"><h3>SERVICES</h3><div class="sub" style="margin:6px 0 0">No known services found on this machine.</div></div>`;
  const order = W_API().groupOrder || [], by = {};
  w.services.forEach(s => (by[s.group || 'Other'] = by[s.group || 'Other'] || []).push(s));
  const gs = Object.keys(by).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const on = w.services.filter(s => s.on), up = on.filter(s => s.up).length;
  return `<div class="card"><h3>SERVICES<b>${up} / ${on.length} answering</b></h3>` + gs.map(g => `<div class="pgrp">${esc(g.toUpperCase())}</div>
    <div class="kv">${by[g].map(s => `<span>${s.on ? `<span style="color:${s.up === false ? 'var(--rose)' : s.up ? 'var(--verd)' : 'var(--faint)'}">●</span>` : '<span style="color:var(--faint)">○</span>'} ${esc(s.label)}</span>
      <b style="${s.on ? (s.up === false ? 'color:var(--rose)' : '') : 'color:var(--faint)'}">${!s.on ? 'not watched' : s.up === false ? 'not answering' : s.up ? (s.ms != null ? s.ms.toFixed(0) + ' ms' : 'up') : '—'}${s.port ? ' · :' + s.port : ''}</b>`).join('')}</div>`).join('') + '</div>';
}
function statusCard(w) {
  const st = w.state || {}, C = (st.checks || []).filter(c => c.sys !== 'svc');
  if (!C.length) return '';
  return `<div class="card"><h3>STATUS<b style="color:${colOf(w)}">${st.asleep ? 'ASLEEP' : LV_WORD[lvOf(w)]}</b></h3><div class="kv">${C.map(c => `<span><span style="color:${LV_COL[c.level]}">●</span> ${esc(c.label)}</span><b style="${c.level ? 'color:' + LV_COL[c.level] : ''}">${esc(c.value)}</b>`).join('')}</div></div>`;
}
function panel(w) {
  const st = w.state || {}, lv = lvOf(w);
  const verdict = !w.enabled ? 'switched off' : st.asleep ? 'asleep · not answering, which is fine for this kind of machine' : `${LV_WORD[lv]}${(st.why || []).length ? ' · ' + st.why.join(', ') : ''}`;
  return `<div class="sub" style="margin:0">${esc(w.typeLabel.toUpperCase())} · ${esc(w.addr)} · <span style="color:${LINK_COL[w.link]}">${w.link === 'tailnet' ? 'TAILSCALE' : 'LAN'}</span></div><h2>${esc(w.name)}</h2>
    <div class="sub" style="color:${colOf(w)}">● ${esc(verdict)}</div>
    ${w.media ? '<button class="sysbtn" data-pcast>OPEN BROADCAST · STREAMS AND LIBRARY ▸</button>' : ''}
    ${statusCard(w)}${presetCard(w)}${servicesCard(w)}${machineCard(w)}
    <button class="sysbtn" data-psetup>MANAGE IN SETUP ▸</button>`;
}
function openPlanet(id) {
  const w = (S.worlds || []).find(x => x.id === id); if (!w) return;
  S.selected = null; S.planet = id; $('#tip').style.display = 'none'; $('#dr').dataset.sig = '';
  $('#drawer').classList.add('on'); renderPanel();
}
function renderPanel() {
  if (!S.planet || !$('#drawer').classList.contains('on')) return;
  const w = (S.worlds || []).find(x => x.id === S.planet); if (!w) return;
  const html = panel(w), dr = $('#dr');
  if (dr.dataset.sig !== html) { dr.innerHTML = html; dr.dataset.sig = html }
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-psetup]')) { closeDrawer(); go('setup') }
  if (e.target.closest('[data-pcast]')) { closeDrawer(); go('cast') }
});
const css = document.createElement('style');
css.textContent = `#drawer .pgrp{font-size:9px;letter-spacing:.16em;color:var(--brass);margin:10px 0 3px}#drawer .pgrp:first-of-type{margin-top:6px}`;
document.head.appendChild(css);

// ---------------------------------------------------------------- the 2D map
const hash = s => [...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const ramp = (a, b, c, s) => s < 1 ? mix(a, b, s) : mix(b, c, Math.min(1, s - 1));
const rgb = (c, a = 1) => `rgba(${c.map(v => Math.round(v * 255)).join(',')},${a})`;
// [eden, drought, hellscape] for the body's light and dark tones
const PAL = {
  earth:    [[[.3, .62, .5], [.08, .22, .3]], [[.75, .62, .34], [.3, .25, .15]], [[.5, .12, .05], [.12, .03, .02]]],
  gas:      [[[.82, .74, .58], [.28, .45, .52]], [[.88, .62, .28], [.42, .3, .18]], [[.55, .1, .06], [.12, .04, .04]]],
  ice:      [[[.93, .96, 1], [.55, .7, .85]], [[.62, .68, .72], [.3, .36, .4]], [[.3, .14, .1], [.1, .05, .05]]],
  obsidian: [[[.2, .22, .26], [.04, .05, .06]], [[.22, .2, .18], [.05, .05, .05]], [[.25, .1, .08], [.05, .03, .03]]],
  city:     [[[.22, .36, .5], [.04, .08, .14]], [[.4, .34, .22], [.08, .07, .05]], [[.4, .1, .05], [.08, .02, .02]]],
  forge:    [[[.24, .2, .18], [.05, .04, .04]], [[.3, .2, .12], [.06, .04, .03]], [[.4, .1, .05], [.08, .02, .02]]],
  rock:     [[[.62, .62, .64], [.2, .2, .22]], [[.62, .55, .45], [.22, .18, .14]], [[.4, .2, .16], [.1, .05, .04]]],
};
const GLOW = [[.25, .95, .8], [1, .65, .2], [1, .2, .08]];
const decor = new Map();
function deco(w) {
  let d = decor.get(w.id); if (d) return d;
  const R = rng(hash(w.id + w.addr)); d = { spots: [], lines: [], ph: R() * 7 };
  for (let i = 0; i < 9; i++) d.spots.push([R() * 2 - 1, R() * 2 - 1, .2 + R() * .35]);
  for (let i = 0; i < 5; i++) { const a = R() * 7, l = .5 + R() * .9; d.lines.push([Math.cos(a) * (R() * .6), Math.sin(a) * (R() * .6), a + 1.2 + R(), l]) }
  for (let i = 0; i < 40; i++) d.spots.push([R() * 2 - 1, R() * 2 - 1, -1]);   // city lights
  decor.set(w.id, d); return d;
}
function place(n, w, h, cx, cy, R) {
  // in the free space outside the engraved scale: walk a rectangle just inside the canvas, keep the stretches that clear
  // the scale and the media planet, and spread the planets evenly along them
  const L = 95, T = 70, Rt = w - 95, B = h - 78, pts = [], pp = orb.plexPos;
  const per = 2 * ((Rt - L) + (B - T)), N = 480;
  for (let i = 0; i < N; i++) {
    let d = i / N * per, x, y;
    if (d < Rt - L) { x = L + d; y = T } else if ((d -= Rt - L) < B - T) { x = Rt; y = T + d } else if ((d -= B - T) < Rt - L) { x = Rt - d; y = B } else { d -= Rt - L; x = L; y = B - d }
    if (Math.hypot(x - cx, y - cy) < R + 58) continue;
    if (pp && Math.hypot(x - pp.x, y - pp.y) < 150) continue;
    if (x < 300 && y < 150) continue;                    // the title block
    if (x > w - 290 && y < 360) continue;                 // the readings on the right
    if (x < 330 && y > h - 190) continue;                 // the legend
    pts.push([x, y]);
  }
  if (pts.length < n * 4) {                               // a narrow screen: ring just outside the scale
    return Array.from({ length: n }, (_, i) => { const a = Math.PI * (1.1 + 1.5 * i / Math.max(1, n)); return [cx + Math.cos(a) * (R + 50), cy + Math.sin(a) * (R + 50)] });
  }
  return Array.from({ length: n }, (_, i) => pts[Math.floor((i + .5) / n * pts.length)]);
}
function body2d(x, w, px, py, r, t) {
  const L = look(w), st = w.state || {}, asleep = st.asleep || !w.enabled, sleep = asleep || w.up === false;   // unreachable: dark body, red sky
  const s = Math.max(st.climate || 0, st.weather || 0) * (sleep ? 0 : 1), P = PAL[L.style] || PAL.earth, d = deco(w);
  const lo = ramp(P[0][0], P[1][0], P[2][0], s), hi = ramp(P[0][1], P[1][1], P[2][1], s);
  const g = x.createRadialGradient(px - r * .35, py - r * .35, 1, px, py, r);
  const k = sleep ? .35 : 1, dim = c => c.map(v => v * k);
  g.addColorStop(0, rgb(dim(mix(lo, [1, 1, 1], .25)))); g.addColorStop(.6, rgb(dim(lo))); g.addColorStop(1, rgb(dim(hi)));
  x.save(); x.beginPath(); x.arc(px, py, r, 0, 7); x.fillStyle = g; x.fill(); x.clip();
  const glow = rgb(ramp(GLOW[0], GLOW[1], GLOW[2], s), sleep ? .15 : .85), f = F(w), H = ok(w.health);
  if (L.style === 'earth' || L.style === 'city') {
    x.fillStyle = rgb(dim(ramp([.14, .4, .2], [.62, .5, .25], [.12, .05, .04], s)), .9);
    d.spots.filter(p => p[2] > 0).forEach(p => { x.beginPath(); x.arc(px + p[0] * r * .8, py + p[1] * r * .8, p[2] * r, 0, 7); x.fill() });
    if (L.style === 'city') { const dead = f.frac || 0;
      d.spots.filter(p => p[2] < 0).forEach((p, i) => { x.fillStyle = i / 40 < dead * 2.4 ? 'rgba(255,60,30,.35)' : `rgba(255,205,120,${sleep ? .2 : .9})`; x.fillRect(px + p[0] * r * .85, py + p[1] * r * .85, 1.4, 1.4) }) }
  } else if (L.style === 'gas') {
    for (let i = -4; i <= 4; i++) { x.fillStyle = i % 2 ? rgb(dim(hi), .55) : rgb(dim(mix(lo, [1, 1, 1], .2)), .35); x.fillRect(px - r, py + i * r * .22 + Math.sin(t * .4 + i + d.ph) * 1.2, r * 2, r * .1) }
  } else if (L.style === 'ice' || L.style === 'obsidian' || L.style === 'forge') {
    x.strokeStyle = L.style === 'ice' ? rgb(s > 1.2 ? GLOW[2] : [.4, .58, .78], .8) : glow;
    x.lineWidth = L.style === 'forge' ? 1 + (H && H.gpu ? H.gpu / 100 * 1.6 : 0) : 1;
    if (L.style === 'forge' && !sleep) { x.shadowColor = glow; x.shadowBlur = 6 }
    d.lines.forEach(l => { x.beginPath(); x.moveTo(px + l[0] * r, py + l[1] * r); x.quadraticCurveTo(px + (l[0] + Math.cos(l[2]) * l[3] * .5) * r, py + (l[1] + Math.sin(l[2]) * l[3] * .5) * r + 3, px + (l[0] + Math.cos(l[2]) * l[3]) * r, py + (l[1] + Math.sin(l[2]) * l[3]) * r); x.stroke() });
    x.shadowBlur = 0;
    if (L.style === 'ice' && s > .3) { x.fillStyle = rgb([.12, .25, .38], Math.min(.8, s * .45)); d.spots.filter(p => p[2] > 0).slice(0, Math.ceil(s * 3)).forEach(p => { x.beginPath(); x.arc(px + p[0] * r * .7, py + p[1] * r * .7, p[2] * r * .8, 0, 7); x.fill() }) }
  } else if (L.style === 'rock') {
    x.strokeStyle = rgb(dim(hi), .7); d.spots.filter(p => p[2] > 0).slice(0, 6).forEach(p => { x.beginPath(); x.arc(px + p[0] * r * .75, py + p[1] * r * .75, p[2] * r * .5, 0, 7); x.stroke() });
  }
  // the night side
  const sh = x.createLinearGradient(px - r, py - r, px + r, py + r); sh.addColorStop(.45, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.55)');
  x.fillStyle = sh; x.fillRect(px - r, py - r, r * 2, r * 2); x.restore();
  // the sky: status colour, pulsing when critical
  const lv = lvOf(w), col = colOf(w), beat = lv === 2 && !asleep ? .55 + .45 * Math.abs(Math.sin(t * 3)) : 1;
  x.strokeStyle = col; x.globalAlpha = (asleep ? .35 : .75) * beat; x.lineWidth = 2; x.beginPath(); x.arc(px, py, r + 2.5, 0, 7); x.stroke(); x.globalAlpha = 1; x.lineWidth = 1;
  if (lv && !asleep) { const hg = x.createRadialGradient(px, py, r, px, py, r * 2.3); hg.addColorStop(0, col + '55'); hg.addColorStop(1, col + '00'); x.fillStyle = hg; x.globalAlpha = beat; x.beginPath(); x.arc(px, py, r * 2.3, 0, 7); x.fill(); x.globalAlpha = 1 }
}
function feat2d(x, w, px, py, r, t, front) {
  const L = look(w), f = F(w), H = ok(w.health), sleep = (w.state || {}).asleep || w.up === false;
  const orbit = (n, rr, sp, colFn, size = 2.2) => { for (let i = 0; i < n; i++) { const a = t * sp + i / n * Math.PI * 2, y = Math.sin(a) * rr * .38; if ((y > 0) !== front) continue;
    x.fillStyle = colFn(i); x.beginPath(); x.arc(px + Math.cos(a) * rr, py + y, size, 0, 7); x.fill() } };
  switch (L.feat) {
    case 'ring': case 'pools': {
      const rings = L.feat === 'ring' ? [{ fill: 1, ok: true, gold: 1 }] : (f.pools || []).length ? f.pools : ((H && H.disks) || []).filter(d => d.used != null).slice(0, 4).map(d => ({ fill: d.used, ok: (d.level || 0) < 2, lv: d.level }));
      rings.slice(0, 4).forEach((p, i) => { const rr = r * (1.55 + i * .22), fr = p.gold ? 1 : Math.min(1, (p.fill || 0) / 100);
        const c = p.gold ? '#c9a45c' : !p.ok ? LV_COL[2] : LV_COL[p.lv != null ? p.lv : (p.fill >= 95 ? 2 : p.fill >= 85 ? 1 : 0)];
        x.save(); x.translate(px, py); x.rotate(-.3); x.lineWidth = 2;
        x.strokeStyle = 'rgba(160,170,180,.18)'; x.beginPath(); x.ellipse(0, 0, rr, rr * .3, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); x.stroke();
        x.strokeStyle = c; x.globalAlpha = sleep ? .3 : .85;
        // the fill starts on the left, runs round the back half, then the front half
        x.beginPath(); x.ellipse(0, 0, rr, rr * .3, 0, front ? 0 : Math.PI, front ? Math.min(Math.PI, Math.max(0, fr * Math.PI * 2 - Math.PI)) : Math.PI + Math.min(Math.PI, fr * Math.PI * 2)); x.stroke();
        x.restore(); x.globalAlpha = 1 });
      break }
    case 'beacon': {
      if (!front) break;
      const up = f.inet !== false && !sleep, c = up ? LV_COL[lvOf(w)] : LV_COL[2], bl = up ? .6 + .4 * Math.sin(t * 4) : .25 + .25 * Math.sin(t * 1.5);
      x.strokeStyle = 'rgba(200,190,170,.6)'; x.beginPath(); x.moveTo(px, py - r); x.lineTo(px, py - r - 10); x.stroke();
      const bg = x.createRadialGradient(px, py - r - 11, 0, px, py - r - 11, 9); bg.addColorStop(0, c); bg.addColorStop(1, c + '00');
      x.globalAlpha = bl; x.fillStyle = bg; x.beginPath(); x.arc(px, py - r - 11, 9, 0, 7); x.fill(); x.globalAlpha = 1;
      if (up) orbit(6, r * 1.5, .9, () => 'rgba(90,166,216,.9)', 1.4);
      break }
    case 'disc': {
      const on = f.blocking !== false && f.dns !== false && !sleep;
      x.save(); x.translate(px, py); x.rotate(-.25);
      if (!front) { const g = x.createRadialGradient(0, 0, r * 1.1, 0, 0, r * 2.4); g.addColorStop(0, on ? 'rgba(64,220,190,.45)' : 'rgba(240,166,58,.35)'); g.addColorStop(1, 'rgba(64,220,190,0)');
        x.fillStyle = g; x.scale(1, .28); x.beginPath(); x.arc(0, 0, r * 2.4, 0, 7); x.fill() }
      else if (on) { const n = 5 + Math.round((f.pct || 10) / 6); for (let i = 0; i < n; i++) { const k = ((t * .25 + i / n) % 1), rr = r * (2.3 - k * 1.2), a = i * 2.4 + k * 5; x.fillStyle = `rgba(160,255,230,${.8 * (1 - k)})`; x.fillRect(Math.cos(a) * rr, Math.sin(a) * rr * .28, 1.4, 1.4) } }
      x.restore(); break }
    case 'eyes': { const C2 = (f.cams || []).slice(0, 12); orbit(C2.length, r * 1.6, .35, i => C2[i].on && !sleep ? '#9fe8d8' : LV_COL[1], 2.4); break }
    case 'players': orbit(Math.min(16, f.players || 0), r * 1.55, .6, i => ['#f0d08a', '#9fe8d8', '#c8b6ff', '#ffb38a'][i % 4], 1.8); break;
    case 'models': orbit(Math.min(4, (f.models || []).length), r * 1.5, .5, () => '#8fd8ff', 2.6); break;
    case 'progress': {
      if (!front || !f.state) break;
      const c = f.state === 'error' ? LV_COL[2] : f.state === 'paused' ? LV_COL[1] : '#f0d08a';
      x.lineWidth = 3; x.strokeStyle = 'rgba(160,170,180,.18)'; x.beginPath(); x.arc(px, py, r + 7, 0, 7); x.stroke();
      if (f.state === 'printing' || f.state === 'paused') { x.strokeStyle = c; x.beginPath(); x.arc(px, py, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (f.progress || 0)); x.stroke();
        const a = -Math.PI / 2 + Math.PI * 2 * (f.progress || 0); x.fillStyle = c; x.globalAlpha = .5 + .5 * Math.sin(t * 6); x.beginPath(); x.arc(px + Math.cos(a) * (r + 7), py + Math.sin(a) * (r + 7), 2.5, 0, 7); x.fill(); x.globalAlpha = 1 }
      x.lineWidth = 1; break }
  }
}
const parts2d = [];
function drawWorlds2d(x, w, h, cx, cy, coreR, R, t) {
  const list = (S.worlds || []).filter(v => v.enabled && !v.media);
  const pos = place(list.length, w, h, cx, cy, R), hits = [];
  list.forEach((v, i) => {
    const [px, py] = pos[i], L = look(v), r = L.r2, col = colOf(v), hov = orb.hover === '__w:' + v.id;
    const up = v.up !== false, lc = up ? LINK_COL[v.link] : (v.state || {}).asleep ? SLEEP_COL : LV_COL[2];
    // tether from the core's edge
    const ang = Math.atan2(py - cy, px - cx), sx = cx + Math.cos(ang) * (coreR + 40), sy = cy + Math.sin(ang) * (coreR + 40);
    const mx = (sx + px) / 2 + Math.sin(ang) * 30, my = (sy + py) / 2 - Math.cos(ang) * 30 - 20;
    x.save(); x.setLineDash([3, 6]); x.lineDashOffset = -t * 12; x.strokeStyle = lc; x.globalAlpha = up ? .5 : .35; x.lineWidth = 1.1;
    x.beginPath(); x.moveTo(sx, sy); x.quadraticCurveTo(mx, my, px, py); x.stroke(); x.restore();
    if (up && Math.random() < .03) parts2d.push({ k: 0, s: .006 + Math.random() * .004, a: [sx, sy, mx, my, px, py], c: lc });
    feat2d(x, v, px, py, r, t, false);
    body2d(x, v, px, py, r, t);
    feat2d(x, v, px, py, r, t, true);
    if (hov) { x.strokeStyle = C.hi; x.setLineDash([3, 3]); x.beginPath(); x.arc(px, py, r * 2, 0, 7); x.stroke(); x.setLineDash([]) }
    const ly = py + r * (L.feat === 'ring' || L.feat === 'pools' ? 1.25 : 1) + 16;
    x.textAlign = 'center'; x.font = '600 12px Cormorant Garamond'; x.fillStyle = lvOf(v) && !(v.state || {}).asleep ? col : up ? C.hi : C.faint;
    x.fillText(v.name.toUpperCase(), px, ly);
    x.font = '9px JetBrains Mono'; x.fillStyle = lvOf(v) ? col : C.muted; x.fillText(summary(v).slice(0, 38), px, ly + 12);
    x.fillStyle = C.faint; x.fillText(linkLine(v), px, ly + 23);
    hits.push({ id: v.id, x: px, y: py, r: r * 1.8 });
  });
  for (let i = parts2d.length - 1; i >= 0; i--) { const p = parts2d[i]; p.k += p.s; if (p.k >= 1) { parts2d.splice(i, 1); continue }
    const k = p.k, [sx, sy, mx, my, ex, ey] = p.a, qx = (1 - k) * (1 - k) * ex + 2 * (1 - k) * k * mx + k * k * sx, qy = (1 - k) * (1 - k) * ey + 2 * (1 - k) * k * my + k * k * sy;
    x.fillStyle = p.c; x.globalAlpha = Math.sin(k * Math.PI) * .9; x.beginPath(); x.arc(qx, qy, 1.3, 0, 7); x.fill() }
  x.globalAlpha = 1;
  orb.worlds2d = hits;
}
function hit2d(mx, my) { const h = (orb.worlds2d || []).find(b => Math.hypot(b.x - mx, b.y - my) < b.r); return h ? (S.worlds || []).find(w => w.id === h.id) : null }

globalThis.OP = { LOOK, look, summary, linkLine, tip, panel, colOf, LV_COL, LINK_COL, SLEEP_COL, renderPanel, hit2d };
globalThis.openPlanet = openPlanet;
globalThis.drawWorlds2d = drawWorlds2d;
})();
