/* Orrery — other servers on the network ("worlds").
   The orrery is the Proxmox host and its brass instruments are the guests. Any other machine you switch on here
   becomes a planet beyond it, with the services it runs as moons. Tethers are purple over Tailscale, blue on the LAN.
   Polls /api/next/worlds into S.worlds for the 3D view, and renders the OTHER SERVERS card on the Setup screen. */
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
#v-setup .wl button{background:none;border:1px solid var(--line);color:var(--brass);font:inherit;font-size:10px;letter-spacing:.1em;padding:3px 9px;cursor:pointer;white-space:nowrap}
#v-setup .wl button:hover{border-color:var(--brass)}#v-setup .wl button.x{border:none;color:var(--faint);font-size:13px;padding:0 4px}#v-setup .wl button.x:hover{color:var(--rose)}
#v-setup .wl select{max-width:150px}
#v-setup .wsub{font-size:10px;letter-spacing:.14em;color:var(--muted);margin:12px 0 2px}
#v-setup details.wmore summary{cursor:pointer;font-size:10px;letter-spacing:.14em;color:var(--muted);margin-top:10px}
#v-setup .wadd{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}#v-setup .wadd input{flex:1;min-width:110px}
@media (max-width:600px){#v-setup .wl{grid-template-columns:auto minmax(0,1fr) auto}#v-setup .wl select{grid-column:2/-1;max-width:none}}
`;
document.head.appendChild(css);

let W = null, busy = false;
async function poll() {
  try { W = await fetch('/api/next/worlds').then(r => r.json()); S.worlds = W.worlds } catch (e) { return }
  if (S.view === 'setup') render();
}
poll(); setInterval(poll, 10000);
globalThis.orreryWorlds = { refresh: poll };

const linkPill = l => { const [t, c] = LINK[l] || LINK.lan; return `<span class="lk" style="color:${c}">${t}</span>` };
const typeSel = (id, cur) => `<select data-wtype="${esc(id)}">${Object.entries(W.types).map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const svcChips = (list, live) => list.length
  ? list.map(s => typeof s === 'string' ? `<span>${esc(s)}</span>` : `<span class="${live ? (s.up ? 'up' : s.up === false ? 'dn' : '') : ''}" title="${esc(s.label)}${s.port ? ' · port ' + s.port : ''}">${live && s.up === false ? '✕ ' : ''}${esc(s.label)}</span>`).join('')
  : '<span style="border:none;color:var(--faint)">no known services found yet</span>';

function render() {
  const host = $('#worlds-card'); if (!host || !W) return;
  const on = W.worlds.filter(w => w.enabled).length;
  $('#worlds-count').textContent = on ? `${on} on the orrery` : '';
  const ws = W.worlds.map(w => `<div class="wl" data-wid="${esc(w.id)}">
      <input type="checkbox" data-won="${esc(w.id)}" ${w.enabled ? 'checked' : ''} title="show as a planet">
      <div class="nm"><b>${esc(w.name)}</b><span class="ad">${esc(w.addr)}</span>${linkPill(w.link)}
        <span class="dt">${w.enabled ? (w.up ? ` · ${(w.ms || 0).toFixed(0)} ms` : w.up === false ? ' · <span class="bad">unreachable</span>' : '') : ' · off'}${w.media ? ' · Plex' : ''}${w.scanning ? ' · scanning…' : ''}</span></div>
      ${typeSel(w.id, w.type)}
      <span><button data-wscan="${esc(w.addr)}" title="look for services again">RESCAN</button><button class="x" data-wdel="${esc(w.id)}" title="remove">✕</button></span>
      <div class="mo">${svcChips(w.services, w.enabled)}</div></div>`).join('');
  const withSvc = W.candidates.filter(c => c.services.length), rest = W.candidates.filter(c => !c.services.length);
  const cand = c => `<div class="wl"><span></span>
      <div class="nm"><b>${esc(c.name)}</b><span class="ad">${esc(c.addr)}</span>${linkPill(c.link)}<span class="dt"> · ${esc(c.detail || c.source)}${W.scanning === c.addr || W.queue.includes(c.addr) ? ' · scanning…' : ''}</span></div>
      <span></span><span>${c.services.length ? '' : `<button data-wscan="${esc(c.addr)}">SCAN</button>`}<button data-wadd="${esc(c.addr)}" data-wname="${esc(c.name)}" data-wsvc="${esc(c.services.join(','))}">ADD</button></span>
      ${c.services.length ? `<div class="mo">${svcChips(c.services, false)}</div>` : ''}</div>`;
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
function guessType(svc) {
  const s = svc || [];
  if (s.some(k => ['plex', 'jellyfin', 'emby'].includes(k))) return 'media';
  if (s.some(k => ['truenas', 'nextcloud', 'syncthing'].includes(k))) return 'nas';
  if (s.some(k => ['homeassistant', 'zigbee2mqtt', 'nodered', 'frigate'].includes(k))) return 'home';
  return 'generic';
}
const sid = n => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server';

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.won) save({ worlds: { [t.dataset.won]: { enabled: t.checked } } }, t.checked ? 'Planet on.' : 'Planet off.');
  if (t.dataset.wtype) save({ worlds: { [t.dataset.wtype]: { type: t.value } } }, 'Type saved.');
});
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t || !t.closest('#worlds-card')) return;
  if (t.dataset.wscan) { try { await globalThis.orreryPost('/api/next/worlds/scan', { addr: t.dataset.wscan }); t.textContent = 'QUEUED'; setTimeout(poll, 4000); setTimeout(poll, 20000) } catch (er) {} }
  if (t.dataset.wdel && confirm('Remove this server from the orrery?')) save({ worlds: { [t.dataset.wdel]: null } }, 'Removed.');
  if (t.dataset.wadd) {
    const svc = t.dataset.wsvc ? t.dataset.wsvc.split(',') : [];
    save({ worlds: { [sid(t.dataset.wname)]: { name: t.dataset.wname, addr: t.dataset.wadd, type: guessType(svc), enabled: true } } }, `${t.dataset.wname} added.`);
  }
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
    <div class="muted" style="font-size:11px">Machines that aren't this Proxmox host. Each one you switch on becomes a planet beyond the orrery, with its services as moons.
      The tether is <span style="color:var(--ame)">purple over Tailscale</span> and <span style="color:var(--lan)">blue on your local network</span>.
      A Media server (Plex, Jellyfin, Emby) is drawn as the big inhabited world.</div>
    <input type="checkbox" id="media-on" hidden><div id="worlds-card" style="margin-top:8px" class="muted">Loading…</div>`;
  render();
}
const baseGo = go;
go = function (v) { baseGo(v); if (v === 'setup') { mount(); poll() } };
if (S.view === 'setup') mount();
})();
