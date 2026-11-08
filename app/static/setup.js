/* Orrery — Setup screen, bindings, Manifest visibility.
   Loaded after the main inline script; shares its globals (S, $, $$, esc, guests, go, renderManifest). */
(() => {
const TIERS = [['active', 'Prominent'], ['watch', 'Sentinel'], ['quiet', 'Background'], ['hidden', 'Hidden']];
const TIER_HINT = { active: 'big, bright, middle ring', watch: 'small until it needs you', quiet: 'small and dim, outer ring', hidden: 'not drawn' };
const MAN_COLS = [['vmid', 'ID'], ['role', 'ROLE'], ['type', 'KIND'], ['cpu', 'CPU'], ['mem', 'MEMORY'], ['disk', 'DISK'], ['netin', 'NET ↓'], ['netout', 'NET ↑'], ['uptime', 'UPTIME'], ['tags', 'TAGS']];
let TPL = null, bindSig = '', keyOk = false, CONN = null, connAt = 0;
S.bind = null;

const css = document.createElement('style');
css.textContent = `
#v-setup .row2{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:14px}
#v-setup select,#v-setup input[type=text]{background:var(--ink);color:var(--text);border:1px solid var(--line);font:inherit;font-size:11px;padding:3px 6px;max-width:100%}
#v-setup select:focus{outline:1px solid var(--brass)}
#v-setup td{vertical-align:middle;padding:6px 8px;border-bottom:1px solid var(--line)}
#v-setup th{text-align:left;font-weight:400;color:var(--muted);font-size:10px;letter-spacing:.14em;padding:6px 8px}
#v-setup .conf{font-size:10px;letter-spacing:.08em;padding:1px 6px;border:1px solid currentColor;margin-left:6px}
#v-setup .conf.confident{color:var(--verd)}#v-setup .conf.likely{color:var(--brass)}#v-setup .conf.unknown{color:var(--faint)}#v-setup .conf.manual{color:var(--hi,#9ec7ff)}
#v-setup .why{color:var(--faint);font-size:10px;margin-top:2px}
#v-setup .chk{display:flex;gap:8px;align-items:center;margin:6px 0;color:var(--muted);cursor:pointer}
#v-setup .cols{display:flex;flex-wrap:wrap;gap:4px 14px}
#v-setup button.act{background:none;border:1px solid var(--brass-dim,var(--line));color:var(--brass);font:inherit;font-size:11px;letter-spacing:.1em;padding:5px 12px;cursor:pointer}
#v-setup button.act:hover{border-color:var(--brass)}
#v-setup button.reset{background:none;border:none;color:var(--faint);cursor:pointer;font-size:13px}
#v-setup button.reset:hover{color:var(--rose)}
#v-setup tr.off td{opacity:.45}
#v-setup .gname{color:var(--brass-hi)}#v-setup .muted{color:var(--muted)}
#setup-msg{min-height:16px;color:var(--muted);font-size:11px}
#v-setup .lv{font-size:10px;letter-spacing:.08em;padding:1px 6px;border:1px solid currentColor;white-space:nowrap;cursor:default}
#v-setup .lv.on{color:var(--verd)}#v-setup .lv.need{color:var(--ember,#e8a33d);cursor:pointer;background:rgba(232,163,61,.08)}#v-setup .lv.need:hover{background:rgba(232,163,61,.2)}
#v-setup .lv.free{color:var(--hi,#9ec7ff)}#v-setup .lv.look{color:var(--faint);border-color:transparent}
#v-setup tr.needkey td:first-child{box-shadow:inset 3px 0 0 var(--ember,#e8a33d)}
#v-setup .conn{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)}
#v-setup .conn:last-child{border:none}#v-setup .conn.needkey{box-shadow:inset 3px 0 0 var(--ember,#e8a33d);padding-left:9px}
#v-setup .conn .what{font-size:10px;color:var(--faint)}
#v-setup .conn button,#v-setup .srv button{background:none;border:1px solid var(--line);color:var(--brass);font:inherit;font-size:10px;letter-spacing:.1em;padding:3px 9px;cursor:pointer}
#v-setup .conn button:hover{border-color:var(--brass)}
#v-setup .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:10px;color:var(--muted);margin:2px 0 8px}
`;
document.head.appendChild(css);

// ---- nav + view
const nav = $('#nav'), foot = nav.querySelector('.navfoot');
const btn = document.createElement('button'); btn.dataset.v = 'setup';
btn.innerHTML = '<span class="num">VIII</span><span class="lbl">SETUP</span><small>what each guest is, how it shows</small>';
nav.insertBefore(btn, foot);
btn.addEventListener('click', () => go('setup'));
if (foot) foot.innerHTML = foot.innerHTML.replace('keys 1–7', 'keys 1–8');
const sec = document.createElement('section'); sec.className = 'view'; sec.id = 'v-setup';
sec.innerHTML = `<h2>Setup <em>what every body is</em></h2>
  <div class="sub">Orrery scanned each guest and guessed what it runs. Correct anything it got wrong, choose how prominent each one is, and what the Manifest shows.</div>
  <div class="row2">
    <div class="card"><h3>DISCOVERY</h3><div id="setup-disc" class="muted"></div><div style="margin-top:10px"><button class="act" id="setup-rescan">RESCAN NOW</button></div></div>
    <div class="card"><h3>MANIFEST</h3>
      <label class="chk"><input type="checkbox" id="man-hs"> hide stopped guests</label>
      <label class="chk"><input type="checkbox" id="man-hh"> hide guests set to Hidden</label>
      <div class="muted" style="margin:8px 0 4px;font-size:10px;letter-spacing:.14em">COLUMNS</div><div class="cols" id="man-cols"></div></div>
    <div class="card"><h3>MEDIA WORLD</h3>
      <label class="chk"><input type="checkbox" id="media-on"> show the media server as its own giant planet</label>
      <div class="muted" style="font-size:11px">Plex, Jellyfin or Emby — anywhere on your network, not just on this host.</div></div>
  </div>
  <div class="row2">
    <div class="card" style="grid-column:1/-1"><h3>CONNECTIONS<b id="conn-count"></b></h3>
      <div class="legend"><span><span class="lv on">CONNECTED</span> live detail on</span><span><span class="lv need">NEEDS API KEY</span> click to add one</span><span><span class="lv free">NO KEY NEEDED</span> just an address</span></div>
      <div id="conn-list" class="muted">Loading…</div></div>
    <div class="card"><h3>REMOTE ACCESS</h3>
      <label class="chk"><input type="checkbox" id="ts-on"> some services are only reachable over Tailscale</label>
      <div class="muted" style="font-size:11px">Joining your tailnet needs a one-time change on the Proxmox host (a tunnel device for Orrery's container). Until then those services show as unreachable instead of failing silently.</div></div>
    <div class="card"><h3>NETWORK TRAFFIC</h3>
      <select id="net-src" style="width:100%"></select>
      <div class="muted" id="net-hint" style="font-size:11px;margin-top:6px"></div></div>
    <div class="card"><h3>PROXMOX SERVERS</h3><div id="srv-list" class="muted"></div>
      <div style="margin-top:10px"><button class="act" id="srv-add">ADD A SERVER</button></div></div>
  </div>
  <div class="card"><h3>GUESTS<b id="setup-count"></b></h3><div id="setup-msg"></div><table id="setup-tbl"></table></div>`;
$('#v-manifest').parentElement.appendChild(sec);

// ---- auth
async function post(path, body) {
  for (let i = 0; i < 2; i++) {
    let k = ''; try { k = localStorage.getItem('orreryKey') || '' } catch (e) {}
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Orrery-Key': k }, body: JSON.stringify(body || {}) });
    if (r.status !== 401) { keyOk = true; return r.json() }
    const nk = prompt('Admin password:');
    if (!nk) throw new Error('admin key required');
    try { localStorage.setItem('orreryKey', nk.trim()) } catch (e) {}
  }
  throw new Error('admin key rejected');
}
const msg = t => { const m = $('#setup-msg'); if (m) { m.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => m.textContent = '', 4000) } };

// ---- bindings → 3D + manifest
function applyBind(b) {
  S.bind = b;
  if (!b.ready) {           // first scan still running: keep the built-in defaults, check back soon
    if (S.view === 'setup') renderSetup();
    setTimeout(pollBind, 5000); return;
  }
  const looks = {}, tiers = {}, tpl = {};
  Object.values(b.guests).forEach(g => { if (!g.name) return; looks[g.name] = g.look; tiers[g.name] = g.tier; tpl[g.name] = g.template });
  globalThis.__orreryLooks = looks; globalThis.__orreryTiers = tiers; globalThis.__orreryTpl = tpl;
  globalThis.__orreryMedia = b.settings.media.enabled;
  if (S.traits) S.traits.names = Object.assign({}, S.traits.names, b.names);
  const sig = JSON.stringify([looks, tiers, b.settings.media.enabled]);
  if (sig !== bindSig) { bindSig = sig; if (globalThis.__orreryRebuild) globalThis.__orreryRebuild() }
  if (S.view === 'manifest') renderManifest();
  if (S.view === 'setup') renderSetup();
}
async function pollBind() { try { applyBind(await fetch('/api/next/bindings').then(r => r.json())) } catch (e) {} }
pollBind(); setInterval(pollBind, 30000);

// ---- manifest wrapper: per-guest + global visibility, column switches, service label
const baseManifest = renderManifest;
renderManifest = function () {
  baseManifest();
  const B = S.bind; if (!B) return;
  const M = B.settings.manifest, off = new Set(M.columns || []);
  let shown = 0;
  $$('#man-tbl tr[data-id]').forEach(tr => {
    const g = B.guests[tr.dataset.id]; if (!g) return;
    const hide = g.manifest === 'hide' || (M.hideStopped && g.status !== 'running') || (M.hideHiddenTier && g.tier === 'hidden');
    tr.style.display = hide ? 'none' : ''; if (!hide) shown++;
    const role = tr.querySelector('.man-role');
    if (role && !role.querySelector('b')) role.innerHTML = `<b>${esc(g.label)}</b> <span>${g.template === 'generic' ? '' : esc(g.ip || '')}</span>`;
  });
  const ths = $$('#man-tbl tr:first-child th'), idx = [];
  ths.forEach((th, i) => { if (off.has(th.dataset.k)) idx.push(i + 1) });
  let st = $('#man-colstyle'); if (!st) { st = document.createElement('style'); st.id = 'man-colstyle'; document.head.appendChild(st) }
  st.textContent = idx.map(n => `#man-tbl tr > :nth-child(${n}){display:none}`).join('');
  const total = $$('#man-tbl tr[data-id]').length;
  if (shown < total) $('#man-sub').textContent += ` · ${total - shown} hidden by Setup`;
};

// ---- setup screen
function tplOptions(sel) {
  const cats = {};
  TPL.templates.forEach(t => (cats[t.category] = cats[t.category] || []).push(t));
  return TPL.categories.filter(c => cats[c]).map(c => `<optgroup label="${esc(c)}">${cats[c].filter(t => t.key !== 'generic').sort((a, b) => a.label.localeCompare(b.label))
    .map(t => `<option value="${t.key}"${t.key === sel ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>`).join('')
    + `<option value="generic"${sel === 'generic' ? ' selected' : ''}>Generic planet</option>`;
}
async function loadConn(force) {
  if (!force && CONN && Date.now() - connAt < 30000) return;
  try {
    const st = await fetch('/api/next/setup/state').then(r => r.json()); connAt = Date.now();
    const all = [...st.services, ...st.media.filter(m => m.guest || m.configured), ...(st.qbit.configured ? [st.qbit] : [])];
    CONN = { st, all, byGuest: Object.fromEntries(st.services.concat(st.media).filter(x => x.guest).map(x => [x.guest, x])) };
  } catch (e) {}
}
const NET = [['none', 'None', 'No network view.'], ['netviz', 'NetViz', 'Flow data from a NetViz install on this host.'], ['dns', 'DNS only (Pi-hole / AdGuard) — coming soon', ''],
  ['opnsense', 'OPNsense / pfSense — coming soon', ''], ['unifi', 'UniFi — coming soon', ''], ['netflow', 'NetFlow / sFlow / IPFIX — coming soon', '']];
function renderConn() {
  if (!CONN) return;
  const { st, all } = CONN, need = all.filter(c => !c.configured && !c.noauth).length;
  $('#conn-count').textContent = `${all.filter(c => c.configured).length} connected${need ? ' · ' + need + ' need a key' : ''}`;
  const order = c => c.configured ? 2 : c.noauth ? 1 : 0;
  $('#conn-list').innerHTML = all.length ? all.slice().sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label)).map(c => {
    const [cls, txt] = c.configured ? ['on', 'CONNECTED'] : c.noauth ? ['free', 'NO KEY NEEDED'] : ['need', 'NEEDS API KEY'];
    return `<div class="conn ${cls === 'need' || cls === 'free' ? 'needkey' : ''}"><div><b style="color:var(--text);font-weight:400">${esc(c.label)}</b>${c.guest ? ` <span class="muted">on ${esc(c.guest)}</span>` : ''}
        <div class="what">${c.gives ? 'Shows ' + esc(c.gives) : ''}${c.preview ? ' · live stats coming soon' : ''}</div></div>
      <div class="row" style="display:flex;gap:8px;align-items:center"><span class="lv ${cls}">${txt}</span><button data-conn="${c.key}">${c.configured ? 'EDIT' : c.noauth ? 'SET ADDRESS' : 'ADD KEY'}</button></div></div>`;
  }).join('') : '<span class="muted">Nothing here has a live integration yet.</span>';
  $('#ts-on').checked = !!st.tailscale.wanted;
  const ns = $('#net-src'), cur = st.network.source || 'none', hasNv = st.services.some(s => s.key === 'netviz');
  ns.innerHTML = NET.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}${k === 'none' || (k === 'netviz' && hasNv) ? '' : ' disabled'}>${l}</option>`).join('');
  $('#net-hint').textContent = (NET.find(n => n[0] === cur) || [])[2] || '';
  $('#srv-list').innerHTML = `<div class="srv">This server: <b style="color:var(--text);font-weight:400">${esc(st.node)}</b></div>` + st.servers.map(x => `<div class="srv">${esc(x.name)} <span class="muted">${esc(x.url)}</span></div>`).join('')
    + (st.servers.length ? '<div class="muted" style="font-size:11px;margin-top:4px">Switching between servers in the orrery is still being built.</div>' : '');
}
async function renderSetup() {
  if (!TPL) { try { TPL = await fetch('/api/next/templates').then(r => r.json()) } catch (e) { return } }
  await loadConn(); renderConn();
  const B = S.bind; if (!B) return;
  const D = B.discovery, ago = D.last ? Math.round((Date.now() / 1000 - D.last) / 60) : null;
  $('#setup-disc').innerHTML = D.running ? 'Scanning guests…' : D.error ? `<span class="bad">Last scan failed: ${esc(D.error)}</span>`
    : ago == null ? 'Not scanned yet.' : `Last scan ${ago < 1 ? 'just now' : ago < 120 ? ago + ' min ago' : Math.round(ago / 60) + ' h ago'} · rescans every ${Math.round(B.settings.discovery.intervalMin / 60)} h and whenever a new guest appears`;
  const M = B.settings.manifest;
  $('#man-hs').checked = !!M.hideStopped; $('#man-hh').checked = !!M.hideHiddenTier; $('#media-on').checked = !!B.settings.media.enabled;
  const off = new Set(M.columns || []);
  $('#man-cols').innerHTML = MAN_COLS.map(([k, l]) => `<label class="chk" style="margin:0"><input type="checkbox" data-col="${k}"${off.has(k) ? '' : ' checked'}> ${l}</label>`).join('');
  const gs = Object.entries(B.guests).sort((a, b) => a[1].vmid - b[1].vmid);
  $('#setup-count').textContent = `${gs.length} guests · ${gs.filter(([, g]) => g.confidence === 'confident' || g.confidence === 'manual').length} identified`;
  const tbl = $('#setup-tbl');
  if (tbl.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;   // don't yank a dropdown out from under the user
  const live = g => { const c = CONN && CONN.byGuest[g.name]; return !c ? ['look', 'LOOK ONLY', 'Orrery has no live integration for this service yet'] : c.configured ? ['on', 'CONNECTED', 'Live detail on'] : c.noauth ? ['free', 'NO KEY NEEDED', 'Add its address to turn on live detail'] : ['need', 'NEEDS API KEY', 'Click to add a key and turn on live detail'] };
  tbl.innerHTML = `<tr><th>GUEST</th><th>ADDRESS</th><th>DETECTED</th><th>SERVICE</th><th>LIVE DATA</th><th>PROMINENCE</th><th>MANIFEST</th><th></th></tr>` + gs.map(([id, g]) => {
    const autoT = TPL.templates.find(t => t.key === g.auto) || { label: 'Generic' };
    const [lc, lt, lh] = live(g), ck = CONN && CONN.byGuest[g.name];
    return `<tr data-id="${id}" class="${g.tier === 'hidden' ? 'off' : ''}${lc === 'need' || lc === 'free' ? ' needkey' : ''}">
      <td><span class="gname">${esc(g.name || '?')}</span><div class="why">${g.type === 'qemu' ? 'VM' : 'LXC'} ${g.vmid}${g.status !== 'running' ? ' · ' + esc(g.status || '?') : ''}</div></td>
      <td>${g.ip ? (g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.ip)}</a>` : esc(g.ip)) : '<span class="muted">—</span>'}</td>
      <td>${esc(autoT.label)}<span class="conf ${g.confidence}">${g.confidence}</span><div class="why" title="${esc(g.why.join(' · '))}">${esc(g.why.join(' · ') || 'nothing recognisable')}${g.alts.length ? ' · also looks like ' + esc(g.alts.join(', ')) : ''}</div></td>
      <td><select data-f="template">${tplOptions(g.template)}</select></td>
      <td><span class="lv ${lc}" title="${lh}" ${ck && lc !== 'look' ? `data-conn="${ck.key}"` : ''}>${lt}</span></td>
      <td><select data-f="tier" title="${TIER_HINT[g.tier]}">${TIERS.map(([k, l]) => `<option value="${k}"${k === g.tier ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><select data-f="manifest"><option value="show"${g.manifest === 'show' ? ' selected' : ''}>Show</option><option value="hide"${g.manifest === 'hide' ? ' selected' : ''}>Hide</option></select></td>
      <td>${g.overridden.length ? `<button class="reset" data-reset title="Undo your changes (${esc(g.overridden.join(', '))}) and use what discovery found">↺</button>` : ''}</td></tr>`;
  }).join('');
}
async function save(patch, note) {
  try { applyBind(await post('/api/next/settings', patch)); msg(note || 'Saved.') } catch (e) { msg(e.message); renderSetup() }
}
$('#setup-tbl').addEventListener('change', e => {
  const s = e.target.closest('select'), tr = e.target.closest('tr[data-id]'); if (!s || !tr) return;
  const g = S.bind.guests[tr.dataset.id], f = s.dataset.f, v = s.value, p = { [f]: v };
  if (f === 'template') {   // picking a service also resets prominence to that service's default unless the user set one
    if (v === g.auto) p.template = null;
    if (!g.overridden.includes('tier')) p.tier = null;
  }
  save({ guests: { [tr.dataset.id]: p } }, `${g.name}: ${f} → ${s.options[s.selectedIndex].text}`);
});
$('#setup-tbl').addEventListener('click', e => {
  const b = e.target.closest('[data-reset]'), tr = e.target.closest('tr[data-id]'); if (!b || !tr) return;
  save({ guests: { [tr.dataset.id]: null } }, `${S.bind.guests[tr.dataset.id].name}: back to detected`);
});
$('#v-setup').addEventListener('click', e => { const c = e.target.closest('[data-conn]'); if (c && globalThis.orreryConnect) globalThis.orreryConnect(c.dataset.conn) });
addEventListener('orrery-connections', async () => { await loadConn(true); pollBind(); renderSetup() });
$('#ts-on').addEventListener('change', async e => { await save({ tailscale: { wanted: e.target.checked } }, e.target.checked ? 'Tailscale wanted: noted.' : 'Tailscale off.'); await loadConn(true); renderConn() });
$('#net-src').addEventListener('change', async e => { await save({ network: { source: e.target.value } }, 'Network source saved.'); await loadConn(true); renderConn() });
$('#srv-add').addEventListener('click', () => globalThis.orreryWizard && globalThis.orreryWizard(6));
$('#man-hs').addEventListener('change', e => save({ manifest: { hideStopped: e.target.checked } }));
$('#man-hh').addEventListener('change', e => save({ manifest: { hideHiddenTier: e.target.checked } }));
$('#media-on').addEventListener('change', e => save({ media: { enabled: e.target.checked } }));
$('#man-cols').addEventListener('change', () => save({ manifest: { columns: $$('#man-cols input').filter(i => !i.checked).map(i => i.dataset.col) } }));
$('#setup-rescan').addEventListener('click', async () => {
  try { const r = await post('/api/next/rescan'); msg(r.started ? 'Scanning… results appear in under a minute.' : 'A scan is already running.'); setTimeout(pollBind, 1500); setTimeout(pollBind, 15000) } catch (e) { msg(e.message) }
});

// ---- routing hooks
const baseGo = go;
go = function (v) { baseGo(v); if (v === 'setup') renderSetup() };
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; if (e.key === '8') go('setup') });
})();
