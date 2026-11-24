/* Orrery — other servers on the network ("worlds").
   The orrery is the Proxmox host and its brass instruments are the guests. Any other machine you switch on here
   becomes a planet beyond it. Its preset (desktop, NAS, router, cameras...) sets its look and what's checked; its
   services are listed in the planet's panel. Tethers are purple over Tailscale, blue on the LAN.
   Polls /api/next/worlds into S.worlds for both maps, and renders the OTHER SERVERS card on the Setup screen. */
(() => {
const $ = s => document.querySelector(s);
const LINK = { tailnet: ['TAILSCALE', 'var(--ame)'], lan: ['LAN', 'var(--lan,#5aa6d8)'] };
const css = document.createElement('style');
css.textContent = `
:root{--lan:#5aa6d8}
#v-setup .wl{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:6px 10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
#v-setup .wl:last-child{border:none}
#v-setup .wl .nm{min-width:0}#v-setup .wl .nm b{color:var(--brass-hi);font-weight:normal}
#v-setup .wl .ad{color:var(--faint);font-size:10px;margin-left:6px}
#v-setup .wl .lk{font-size:9px;letter-spacing:.12em;padding:0 5px;border:1px solid currentColor;margin-left:6px;white-space:nowrap}
#v-setup .wl .mo{grid-column:2/-1;display:flex;flex-wrap:wrap;gap:4px;font-size:10px}
#v-setup .wl .mo span{border:1px solid var(--line);padding:0 6px;color:var(--muted)}
#v-setup .wl .mo span.up{color:var(--verd);border-color:var(--verd-dim)}#v-setup .wl .mo span.dn{color:var(--rose)}
#v-setup .wl .dt{color:var(--faint);font-size:10px}
#v-setup .wl .mo span.tg{cursor:pointer;user-select:none}#v-setup .wl .mo span.tg:hover{border-color:var(--brass)}
#v-setup .wl .mo span.tg.off{color:var(--faint);border-style:dashed;text-decoration:line-through}
#v-setup .wl .hl{grid-column:2/-1;font-size:10px;color:var(--muted)}
#v-setup .wl .hl button{margin-left:2px}#v-setup .hc{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}#v-setup .hc[hidden]{display:none}#v-setup .hc input{width:60px}#v-setup .hc input.wide{width:200px}#v-setup .hc .hres{flex-basis:100%;font-size:11px}#v-setup .hc .hres.ok{color:var(--verd)}#v-setup .hc .hres.bad{color:var(--rose)}#v-setup .hc .hint{flex-basis:100%;color:var(--faint)}#v-setup .wl .hl a{color:var(--brass)}#v-setup .wl .hl .bad{color:var(--rose)}#v-setup .wl .hl .good{color:var(--verd)}
#v-setup .wl button{background:none;border:1px solid var(--line);color:var(--brass);font:inherit;font-size:10px;letter-spacing:.1em;padding:3px 9px;cursor:pointer;white-space:nowrap}
#v-setup .wl button:hover{border-color:var(--brass)}#v-setup .wl button.x{border:none;color:var(--faint);font-size:13px;padding:0 4px}#v-setup .wl button.x:hover{color:var(--rose)}
#v-setup .wl select{max-width:170px}
#v-setup .wsub{font-size:10px;letter-spacing:.14em;color:var(--muted);margin:12px 0 2px}
#v-setup details.wmore summary{cursor:pointer;font-size:10px;letter-spacing:.14em;color:var(--muted);margin-top:10px}
#v-setup .wadd{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}#v-setup .wadd input{flex:1;min-width:110px}
@media (max-width:600px){#v-setup .wl{grid-template-columns:auto minmax(0,1fr) auto}#v-setup .wl select{grid-column:2/-1;max-width:none}#v-setup .hc input.wide{width:100%}}
`;
document.head.appendChild(css);

let W = null, busy = false, paused = false;
async function poll() {
  try { W = await fetch('/api/next/worlds').then(r => r.json()); S.worlds = W.worlds } catch (e) { return }
  if (S.view === 'setup' && !paused) render();
  if (globalThis.OP) OP.renderPanel();
}
poll(); setInterval(poll, 10000);
globalThis.orreryWorlds = { refresh: poll, data: () => W };

const linkPill = l => { const [t, c] = LINK[l] || LINK.lan; return `<span class="lk" style="color:${c}">${t}</span>` };
function typeSel(id, cur) {
  const P = W.presets || {}, groups = {};
  Object.entries(P).forEach(([k, p]) => (groups[p.group] = groups[p.group] || []).push([k, p.label]));
  if (!Object.keys(P).length) Object.entries(W.types).forEach(([k, l]) => (groups.Types = groups.Types || []).push([k, l]));
  return `<select data-wtype="${esc(id)}" title="preset: how the planet looks and what's checked">${Object.entries(groups).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
const svcChips = list => list.length ? list.map(s => `<span>${esc(s)}</span>`).join('') : '<span style="border:none;color:var(--faint)">no known services found yet</span>';

function healthLine(w) {
  const H = w.health, form = `<span class="hc" data-hform="${esc(w.id)}" hidden>
      <select data-hkind>${Object.entries(W.agents || {}).map(([k, a]) => `<option value="${k}" data-port="${a.port}">${esc(a.label)}</option>`).join('')}</select>
      port <input data-hport size="5" value="${(Object.values(W.agents || {})[0] || {}).port || ''}"> <button data-hgo="${esc(w.id)}">CONNECT</button>
      <span class="hres"></span></span>`;
  const open = `<button data-hopen="${esc(w.id)}">${w.healthSrc ? 'CHANGE' : 'CONNECT HEALTH'}</button>`;
  if (w.healthMode === 'off') return `machine health hidden · <a href="#" data-whealth="${esc(w.id)}" data-v="auto">show</a>`;
  if (!w.healthSrc) return `machine: no health agent found · ${open} · install <a href="https://github.com/LibreHardwareMonitor/LibreHardwareMonitor" target="_blank" rel="noopener">LibreHardwareMonitor</a> (Windows: Remote Web Server on), <a href="https://github.com/nicolargo/glances" target="_blank" rel="noopener">Glances</a> (<code>glances -w</code>) or <a href="https://github.com/netdata/netdata" target="_blank" rel="noopener">Netdata</a>${form}`;
  const how = w.healthMode === 'pinned' ? 'connected by you' : 'found automatically';
  if (!H || H.__error) return `machine: <span class="bad">${esc((H && H.src) || w.healthSrc)} not answering</span> (${how}) · ${open}${form}`;
  const bits = [H.cpu != null ? `cpu ${H.cpu.toFixed(0)}%${H.cpuT ? ' ' + H.cpuT.toFixed(0) + '°C' : ''}` : '', H.ramPct != null ? `ram ${H.ramPct.toFixed(0)}%` : '',
    H.gpu != null || H.gpuT ? `gpu ${H.gpu != null ? H.gpu.toFixed(0) + '%' : ''}${H.gpuT ? ' ' + H.gpuT.toFixed(0) + '°C' : ''}` : ''].filter(Boolean).join(' · ');
  return `machine via ${esc(H.src)} (${how})${bits ? ' · ' + bits : ''} · ${open} · <a href="#" data-whealth="${esc(w.id)}" data-v="${w.healthMode === 'pinned' ? 'auto' : 'off'}">${w.healthMode === 'pinned' ? 'disconnect' : 'hide'}</a>${form}`;
}
// the integration a preset reads (Pi-hole, Home Assistant, Frigate...)
function linkLine(w) {
  const p = (W.presets || {})[w.type] || {}, kinds = p.links || [], P = w.preset || {}, L = P.link;
  if (!kinds.length) return '';
  const cur = (w.linkCfg && w.linkCfg.kind) || (L && L.kind) || kinds[0];
  const spec = k => (W.links || {})[k] || { fields: [], label: k };
  const fields = k => spec(k).fields.map(f => `<label>${esc(f.label)} <input data-lf="${esc(f.key)}" class="${f.key === 'url' ? 'wide' : ''}" ${f.secret ? 'type="password" autocomplete="new-password"' : ''}
      placeholder="${f.secret ? (w.hasSecret && w.linkCfg && w.linkCfg.kind === k ? 'saved · leave blank to keep' : '') : esc(f.default.replace('{addr}', w.addr))}"
      value="${!f.secret && w.linkCfg && w.linkCfg.kind === k && w.linkCfg[f.key] ? esc(w.linkCfg[f.key]) : ''}"></label>`).join(' ');
  const form = `<span class="hc" data-lform="${esc(w.id)}" hidden>
      ${kinds.length > 1 ? `<select data-lkind>${kinds.map(k => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(spec(k).label)}</option>`).join('')}</select>` : ''}
      <span data-lfields>${fields(cur)}</span> <button data-lgo="${esc(w.id)}">TEST &amp; SAVE</button>
      <span class="hint" data-lhint>${esc(spec(cur).hint || '')}</span><span class="hres"></span></span>`;
  const btn = `<button data-lopen="${esc(w.id)}">${L || w.linkCfg ? 'CHANGE' : 'SET UP'}</button>`;
  if (w.linkMode === 'off') return `<div class="hl">reads: off · <a href="#" data-wlink="${esc(w.id)}" data-v="auto">turn back on</a></div>`;
  let st;
  if (!L) st = `reads: nothing yet · ${btn} ${kinds.map(k => esc(spec(k).label)).join(' or ')}`;
  else if (L.error) st = `reads: <span class="bad">${esc(L.label)}: ${esc(L.error)}</span> · ${btn}`;
  else st = `reads: <span class="good">${esc(L.label)}</span> (${L.pinned ? 'set up by you' : 'found automatically'}) · ${btn}${L.pinned ? ` · <a href="#" data-wlink="${esc(w.id)}" data-v="auto">disconnect</a>` : ` · <a href="#" data-wlink="${esc(w.id)}" data-v="off">ignore</a>`}`;
  return `<div class="hl">${st}${form}</div>`;
}
function render() {
  const host = $('#worlds-card'); if (!host || !W) return;
  const on = W.worlds.filter(w => w.enabled).length;
  $('#worlds-count').textContent = on ? `${on} on the orrery` : '';
  const LC = ['var(--verd)', '#f0a63a', '#e2453c'];
  const ws = W.worlds.map(w => { const st = w.state || {}, lv = st.level || 0;
    return `<div class="wl" data-wid="${esc(w.id)}">
      <input type="checkbox" data-won="${esc(w.id)}" ${w.enabled ? 'checked' : ''} title="show as a planet">
      <div class="nm"><b>${esc(w.name)}</b><span class="ad">${esc(w.addr)}</span>${linkPill(w.link)}
        <span class="dt">${w.enabled ? (st.asleep ? ' · asleep' : w.up ? ` · ${(w.ms || 0).toFixed(0)} ms` : w.up === false ? ' · <span class="bad">unreachable</span>' : '') : ' · off'}${w.media ? ' · Plex' : ''}${w.scanning ? ' · scanning…' : ''}
        ${w.enabled && !st.asleep && w.up !== false ? ` · <b style="color:${LC[lv]}">${['OK', 'ATTENTION', 'CRITICAL'][lv]}</b>${lv && (st.why || []).length ? ': ' + esc(st.why.join(', ')) : ''}` : ''}</span></div>
      ${typeSel(w.id, w.type)}
      <span><button data-wscan="${esc(w.addr)}" title="look for services again">RESCAN</button><button class="x" data-wdel="${esc(w.id)}" title="remove">✕</button></span>
      <div class="mo">${w.services.length ? w.services.map(sv => `<span class="tg ${sv.on === false ? 'off' : w.enabled ? (sv.up ? 'up' : sv.up === false ? 'dn' : '') : ''}" data-wtog="${esc(w.id)}" data-key="${esc(sv.key)}" title="${esc(sv.group)}${sv.port ? ' · port ' + sv.port : ''} · ${sv.on === false ? 'not watched: click to watch it again' : 'click to stop watching (it won\'t raise an alarm when it\'s down)'}">${w.enabled && sv.on !== false && sv.up === false ? '✕ ' : ''}${esc(sv.label)}</span>`).join('') : '<span style="border:none;color:var(--faint)">no known services found yet</span>'}</div>
      ${linkLine(w)}
      <div class="hl">${healthLine(w)}</div></div>` }).join('');
  const withSvc = W.candidates.filter(c => c.services.length), rest = W.candidates.filter(c => !c.services.length);
  const label = k => ((W.presets || {})[k] || {}).label || k;
  const cand = c => `<div class="wl"><span></span>
      <div class="nm"><b>${esc(c.name)}</b><span class="ad">${esc(c.addr)}</span>${linkPill(c.link)}<span class="dt"> · ${esc(c.detail || c.source)}${c.services.length ? ' · looks like a ' + esc(label(c.guess).toLowerCase()) : ''}${W.scanning === c.addr || W.queue.includes(c.addr) ? ' · scanning…' : ''}</span></div>
      <span></span><span>${c.services.length ? '' : `<button data-wscan="${esc(c.addr)}">SCAN</button>`}<button data-wadd="${esc(c.addr)}" data-wname="${esc(c.name)}" data-wtype2="${esc(c.guess || 'generic')}">ADD</button></span>
      ${c.services.length ? `<div class="mo">${svcChips(c.services)}</div>` : ''}</div>`;
  const feeds = !W.feeds.router && !W.feeds.tailscale ? `<div class="muted" style="font-size:11px;margin-top:8px">No router or Tailscale feed connected, so there are no suggestions. Add servers by address below.</div>` : '';
  host.innerHTML = (ws || '<div class="muted" style="font-size:11px">None yet.</div>')
    + (withSvc.length ? `<div class="wsub">SUGGESTED · RUNNING SERVICES ORRERY KNOWS</div>${withSvc.map(cand).join('')}` : '')
    + (rest.length ? `<details class="wmore"><summary>OTHER DEVICES ON THE NETWORK (${rest.length})</summary>${rest.map(cand).join('')}</details>` : '')
    + feeds
    + `<div class="wadd"><input id="wadd-name" placeholder="name (optional)"><input id="wadd-addr" placeholder="address, e.g. 192.168.1.40"><button class="act" id="wadd-go">ADD SERVER</button></div>`;
}

async function save(patch, note) {
  if (busy) return; busy = true;
  try { await globalThis.orrerySave(patch, note) } finally { busy = false }
  await poll();
}
const sid = n => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server';

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.hkind !== undefined) { const o = t.options[t.selectedIndex]; const pi = t.closest('.hc').querySelector('[data-hport]'); if (pi) pi.value = o.dataset.port; return }
  if (t.dataset.lkind !== undefined) {
    const f = t.closest('.hc'), id = f.dataset.lform, w = W.worlds.find(x => x.id === id), sp = (W.links || {})[t.value] || { fields: [] };
    f.querySelector('[data-lfields]').innerHTML = sp.fields.map(x => `<label>${esc(x.label)} <input data-lf="${esc(x.key)}" class="${x.key === 'url' ? 'wide' : ''}" ${x.secret ? 'type="password" autocomplete="new-password"' : ''} placeholder="${x.secret ? '' : esc(x.default.replace('{addr}', w ? w.addr : ''))}"></label>`).join(' ');
    f.querySelector('[data-lhint]').textContent = sp.hint || ''; return;
  }
  if (t.dataset.won) save({ worlds: { [t.dataset.won]: { enabled: t.checked } } }, t.checked ? 'Planet on.' : 'Planet off.');
  if (t.dataset.wtype) save({ worlds: { [t.dataset.wtype]: { type: t.value } } }, 'Preset saved.');
});
document.addEventListener('click', async e => {
  const tg = e.target.closest('[data-wtog]'), hl = e.target.closest('[data-whealth]'), wl = e.target.closest('[data-wlink]');
  if (tg && tg.closest('#worlds-card')) {
    const w = W.worlds.find(x => x.id === tg.dataset.wtog); if (!w) return;
    const off = new Set(w.services.filter(s => s.on === false).map(s => s.key));
    off.has(tg.dataset.key) ? off.delete(tg.dataset.key) : off.add(tg.dataset.key);
    return save({ worlds: { [w.id]: { off: [...off] } } }, `${w.name}: ${tg.textContent.trim()} ${off.has(tg.dataset.key) ? 'not watched' : 'watched'}.`);
  }
  if (hl && hl.closest('#worlds-card')) {
    e.preventDefault();
    try { await globalThis.orreryPost('/api/next/worlds/health', { id: hl.dataset.whealth, kind: hl.dataset.v }) } catch (er) {}
    return poll();
  }
  if (wl && wl.closest('#worlds-card')) {
    e.preventDefault();
    try { await globalThis.orreryPost('/api/next/worlds/link', { id: wl.dataset.wlink, kind: wl.dataset.v }) } catch (er) {}
    return poll();
  }
  const ho = e.target.closest('[data-hopen]'), lo = e.target.closest('[data-lopen]');
  if (ho || lo) { const f = document.querySelector(ho ? `[data-hform="${CSS.escape(ho.dataset.hopen)}"]` : `[data-lform="${CSS.escape(lo.dataset.lopen)}"]`); if (f) { f.hidden = !f.hidden; paused = !f.hidden } return }
  const hg = e.target.closest('[data-hgo]'), lg = e.target.closest('[data-lgo]');
  if (hg || lg) {
    const b = hg || lg, f = b.closest('.hc'), res = f.querySelector('.hres');
    res.className = 'hres'; res.textContent = 'Testing…'; b.disabled = true;
    try {
      const r = hg ? await globalThis.orreryPost('/api/next/worlds/health', { id: hg.dataset.hgo, kind: f.querySelector('[data-hkind]').value, port: +f.querySelector('[data-hport]').value || null })
        : await globalThis.orreryPost('/api/next/worlds/link', { id: lg.dataset.lgo, kind: (f.querySelector('[data-lkind]') || {}).value || ((W.presets[(W.worlds.find(x => x.id === lg.dataset.lgo) || {}).type] || {}).links || [])[0],
            fields: Object.fromEntries([...f.querySelectorAll('[data-lf]')].map(i => [i.dataset.lf, i.value.trim()]).filter(([, v]) => v)) });
      if (r.ok) { res.className = 'hres ok'; res.textContent = 'Connected.'; paused = false; setTimeout(poll, 800) }
      else { res.className = 'hres bad'; res.textContent = r.error || 'Could not connect.' }
    } catch (er) { res.className = 'hres bad'; res.textContent = er.message }
    b.disabled = false; return;
  }
  const t = e.target.closest('button'); if (!t || !t.closest('#worlds-card')) return;
  if (t.dataset.wscan) { try { await globalThis.orreryPost('/api/next/worlds/scan', { addr: t.dataset.wscan }); t.textContent = 'QUEUED'; setTimeout(poll, 4000); setTimeout(poll, 20000) } catch (er) {} }
  if (t.dataset.wdel && confirm('Remove this server from the orrery?')) save({ worlds: { [t.dataset.wdel]: null } }, 'Removed.');
  if (t.dataset.wadd) save({ worlds: { [sid(t.dataset.wname)]: { name: t.dataset.wname, addr: t.dataset.wadd, type: t.dataset.wtype2 || 'generic', enabled: true } } }, `${t.dataset.wname} added.`);
  if (t.id === 'wadd-go') {
    const addr = ($('#wadd-addr').value || '').trim(), name = ($('#wadd-name').value || '').trim() || addr;
    if (!addr) return;
    save({ worlds: { [sid(name)]: { name, addr, type: 'generic', enabled: true } } }, `${name} added; looking for its services…`);
  }
});

// put the card where the old single "media world" switch was
function mount() {
  const old = $('#media-on'); const card = old && old.closest('.card');
  if (!card || $('#worlds-card')) return;
  card.style.gridColumn = '1/-1';
  card.innerHTML = `<h3>OTHER SERVERS<b id="worlds-count"></b></h3>
    <div class="muted" style="font-size:11px">Machines that aren't this Proxmox host. Each one you switch on becomes a planet beyond the orrery: green and calm when it's fine,
      amber when something needs a look, red and burning when it needs you now. Its <b>preset</b> sets how it looks and what's checked (a NAS shows its pools as rings,
      a router its internet, a game server its players). Click a planet to see its services, grouped.
      The tether is <span style="color:var(--ame)">purple over Tailscale</span> and <span style="color:var(--lan)">blue on your local network</span>.</div>
    <input type="checkbox" id="media-on" hidden><div id="worlds-card" style="margin-top:8px" class="muted">Loading…</div>`;
  render();
}
const baseGo = go;
go = function (v) { baseGo(v); if (v === 'setup') { mount(); poll() } };
if (S.view === 'setup') mount();
})();
