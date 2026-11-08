/* Orrery — first-run setup wizard.
   Opens on its own until setup is finished; re-run any time from SETUP → "Run setup wizard". */
(() => {
const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TIERS = [['active', 'Prominent'], ['watch', 'Sentinel'], ['quiet', 'Background'], ['hidden', 'Hidden']];
const STEPS = ['Welcome', 'Discover', 'Connect', 'Media', 'Network', 'Remote', 'Servers', 'Finish'];
let st = null, tpl = null, bind = null, step = 0, busy = false, solo = null;
const filled = {};          // spec key -> {field: value} entered this session
const results = {};         // spec key -> {ok, detail}
let mediaKind = null, netChoice = null, tsWanted = false;

const css = document.createElement('style');
css.textContent = `
#wz{position:fixed;inset:0;z-index:200;background:rgba(4,6,9,.92);backdrop-filter:blur(6px);display:none;overflow:auto}
#wz.on{display:block}
#wz .box{max-width:980px;margin:32px auto;padding:0 20px 40px}
#wz .steps{display:flex;gap:4px;margin-bottom:22px;flex-wrap:wrap}
#wz .steps span{flex:1;min-width:90px;font-size:10px;letter-spacing:.14em;color:var(--faint);border-top:2px solid var(--line);padding-top:6px}
#wz .steps span.on{color:var(--brass-hi);border-color:var(--brass)}#wz .steps span.done{color:var(--muted);border-color:var(--brass-dim,var(--muted))}
#wz h1{font-family:var(--serif);font-weight:600;font-size:34px;color:var(--brass-hi);margin:0 0 6px}
#wz .lead{color:var(--muted);max-width:720px;line-height:1.55;margin-bottom:20px}
#wz .card{margin-bottom:12px}
#wz .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px}
#wz label.f{display:block;font-size:10px;letter-spacing:.14em;color:var(--muted);margin:10px 0 4px}
#wz input[type=text],#wz input[type=password],#wz select{width:100%;box-sizing:border-box;background:var(--ink);color:var(--text);border:1px solid var(--line);font:inherit;font-size:12px;padding:7px 8px}
#wz input:focus,#wz select:focus{outline:1px solid var(--brass);border-color:var(--brass)}
#wz .hint{font-size:11px;color:var(--faint);margin-top:4px;line-height:1.45}
#wz .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#wz .nav{display:flex;justify-content:space-between;align-items:center;margin-top:22px;gap:12px}
#wz button{font:inherit;font-size:11px;letter-spacing:.12em;padding:9px 18px;cursor:pointer;border:1px solid var(--brass-dim,var(--line));background:none;color:var(--brass)}
#wz button.pri{background:var(--brass);color:#111;border-color:var(--brass)}
#wz button:disabled{opacity:.4;cursor:default}
#wz button.sm{padding:5px 10px}
#wz .ok{color:var(--verd)}#wz .bad{color:var(--rose)}#wz .muted{color:var(--muted)}
#wz .res{font-size:11px;margin-top:8px;min-height:15px}
#wz .badge{font-size:10px;letter-spacing:.08em;padding:1px 6px;border:1px solid currentColor;margin-left:6px;white-space:nowrap}
#wz .g{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}
#wz .g:last-child{border:none}
#wz .g .n{min-width:0}#wz .g .n b{color:var(--brass-hi);font-weight:400}#wz .g .why{font-size:10px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:330px}
#wz .g select{width:auto;max-width:200px}
#wz .opt{border:1px solid var(--line);padding:12px 14px;cursor:pointer;display:block}
#wz .opt.sel{border-color:var(--brass)}#wz .opt.dis{opacity:.45;cursor:default}
#wz .opt b{color:var(--text);font-weight:400}#wz .opt .hint{margin-top:2px}
#wz .spin{display:inline-block;width:10px;height:10px;border:2px solid var(--brass);border-right-color:transparent;border-radius:50%;animation:wzs .8s linear infinite;margin-right:8px;vertical-align:-1px}
@keyframes wzs{to{transform:rotate(360deg)}}
#wz .x{position:fixed;top:14px;right:20px}
@media (max-width:600px){#wz .g{flex-wrap:wrap}#wz .g .why{max-width:240px}}
`;
document.head.appendChild(css);
const root = document.createElement('div'); root.id = 'wz'; document.body.appendChild(root);

const key = () => { try { return localStorage.getItem('orreryKey') || '' } catch (e) { return '' } };
const setKey = k => { try { localStorage.setItem('orreryKey', k) } catch (e) {} };
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Orrery-Key': key() }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { status: r.status });
  return j;
}
async function load() {
  [st, bind] = await Promise.all([api('/api/next/setup/state'), api('/api/next/bindings')]);
  if (!tpl) tpl = await api('/api/next/templates');
}

// ---------------------------------------------------------------- shell
function shell(title, lead, body, opts = {}) {
  root.innerHTML = `<div class="box">
    ${st.done ? '<button class="x sm" data-a="close">CLOSE ✕</button>' : ''}
    <div class="steps">${STEPS.map((s, i) => `<span class="${i === step ? 'on' : i < step ? 'done' : ''}">${String(i + 1).padStart(2, '0')} · ${s.toUpperCase()}</span>`).join('')}</div>
    <h1>${title}</h1><div class="lead">${lead}</div>${body}
    <div class="nav"><div>${step > 0 && !opts.noBack ? '<button data-a="back">← BACK</button>' : ''}</div>
      <div class="row"><span class="res" id="wz-msg"></span>${opts.skip ? `<button data-a="skip">${opts.skip}</button>` : ''}
      <button class="pri" data-a="next" ${opts.nextDisabled ? 'disabled' : ''}>${opts.next || 'CONTINUE →'}</button></div></div></div>`;
  root.scrollTop = 0;
}
const msg = (t, cls = '') => { const m = root.querySelector('#wz-msg'); if (m) { m.className = 'res ' + cls; m.innerHTML = t } };
const val = id => (root.querySelector('#' + id) || {}).value || '';

// ---------------------------------------------------------------- steps
const render = [
  // 0 welcome + password
  () => {
    const login = !st.needsPassword && !key();
    shell('Welcome to Orrery', `Orrery is connected to your Proxmox node <b>${E(st.node)}</b>${st.pveVersion ? ` (Proxmox VE ${E(st.pveVersion)})` : ''} and can see <b>${st.guests || 'your'}</b> guests.
      It turns each one into a body in a live orrery. This setup takes a few minutes: it works out what each guest runs, connects the services you want live detail from, and sets up the extras.
      You can change everything later from the SETUP screen.`,
      st.needsPassword ? `<div class="card" style="max-width:460px"><h3>ADMIN PASSWORD</h3>
        <div class="hint" style="margin:0 0 6px">Anyone on your network can look at Orrery. This password protects changing it and the service keys you'll enter next.</div>
        <label class="f">PASSWORD</label><input type="password" id="pw1" autocomplete="new-password">
        <label class="f">AGAIN</label><input type="password" id="pw2" autocomplete="new-password"></div>`
      : login ? `<div class="card" style="max-width:460px"><h3>SIGN IN</h3><label class="f">ADMIN PASSWORD</label><input type="password" id="pw1" autocomplete="current-password"></div>` : '',
      { next: st.needsPassword ? 'SET PASSWORD →' : login ? 'SIGN IN →' : 'BEGIN →' });
    const f = root.querySelector('#pw1'); if (f) f.focus();
  },
  // 1 discover
  () => {
    if (!bind.ready || st.discovery.running && !bind.ready) {
      shell('Discovering your bodies', 'Orrery is looking at every guest: its address, which ports answer, and what the web page on each one says it is.',
        `<div class="card"><span class="spin"></span>Scanning ${st.guests || ''} guests… this usually takes under a minute.</div>`, { nextDisabled: true });
      setTimeout(async () => { if (step === 1) { await load(); go_(1) } }, 3000); return;
    }
    const gs = Object.entries(bind.guests).sort((a, b) => a[1].vmid - b[1].vmid);
    const grp = { sure: [], guess: [], unk: [] };
    gs.forEach(x => grp[x[1].confidence === 'confident' || x[1].confidence === 'manual' ? 'sure' : x[1].confidence === 'likely' ? 'guess' : 'unk'].push(x));
    const opts = sel => tpl.categories.map(c => { const ts = tpl.templates.filter(t => t.category === c && t.key !== 'generic').sort((a, b) => a.label.localeCompare(b.label));
      return ts.length ? `<optgroup label="${E(c)}">${ts.map(t => `<option value="${t.key}"${t.key === sel ? ' selected' : ''}>${E(t.label)}</option>`).join('')}</optgroup>` : '' }).join('')
      + `<option value="generic"${sel === 'generic' ? ' selected' : ''}>Something else (plain planet)</option>`;
    const row = ([id, g]) => `<div class="g" data-id="${id}"><div class="n"><b>${E(g.name)}</b> <span class="muted">${g.type === 'qemu' ? 'VM' : 'LXC'} ${g.vmid}${g.ip ? ' · ' + E(g.ip) : ''}</span>
        <div class="why" title="${E(g.why.join(' · '))}">${E(g.why.join(' · ') || (g.status !== 'running' ? 'not running, so it could not be checked' : 'no web page or known port answered'))}</div></div>
      <div class="row"><select data-f="template">${opts(g.template)}</select><select data-f="tier" title="How prominent it is in the orrery">${TIERS.map(([k, l]) => `<option value="${k}"${k === g.tier ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>`;
    const sec = (t, h, xs) => xs.length ? `<div class="card"><h3>${t}<b>${xs.length}</b></h3><div class="hint" style="margin:0 0 6px">${h}</div>${xs.map(row).join('')}</div>` : '';
    shell('Here’s what Orrery found', `Each guest is matched to a service. Fix anything that's wrong, and choose how prominent each one is: <b>Prominent</b> bodies are big and bright, <b>Sentinels</b> stay small until something breaks, <b>Background</b> ones are small and dim, <b>Hidden</b> ones aren't drawn.`,
      sec('IDENTIFIED', 'Its own web page or API said what it is.', grp.sure) + sec('BEST GUESSES', 'Matched by name or an open port only. Worth a glance.', grp.guess)
      + sec('NOT RECOGNISED', 'Pick what it is if you know, or leave it as a plain planet.', grp.unk), { next: 'LOOKS RIGHT →' });
  },
  // 2 connect services
  () => {
    const list = st.services;
    if (!list.length) { shell('Connect your services', 'None of the services Orrery found have live detail it can show yet. You can still see every guest’s CPU, memory and network.', '', {}); return }
    shell('Connect your services', `Orrery can show live detail for these, like who's streaming, what's blocked, or who's home. Each needs a key from the service itself; where to find it is under each box.
      Keys stay on this Orrery and are only sent to that service. Skip any you don't want.`,
      `<div class="grid">${list.map(s => svcCard(s)).join('')}</div>`, { next: 'SAVE & CONTINUE →' });
  },
  // 3 media world
  () => {
    const m = st.media, found = m.find(x => x.guest), cur = mediaKind || (m.find(x => x.configured) || found || {}).key || 'none';
    mediaKind = cur;
    const pick = m.find(x => x.key === cur);
    shell('Your media world', `If you run Plex, Jellyfin or Emby, Orrery can show it as its own giant planet, with streams orbiting as moons. It can live anywhere: on this host, another machine, or across Tailscale.
      ${found ? `Orrery spotted <b>${E(found.label)}</b> on <b>${E(found.guest)}</b>.` : 'Orrery didn’t find one on this host. If yours runs elsewhere, enter its address.'}`,
      `<div class="grid" style="margin-bottom:12px">${[...m.map(x => [x.key, x.label, x.preview ? 'Planet now; live streams coming soon' : 'Streams, libraries, history']), ['none', 'No media server', 'Skip the media world']]
        .map(([k, l, h]) => `<label class="opt ${k === cur ? 'sel' : ''}" data-media="${k}"><b>${E(l)}</b><div class="hint">${h}</div></label>`).join('')}</div>
      ${pick ? svcCard(pick, true) : ''}
      ${pick && pick.key === 'plex' ? `<details class="card"><summary class="muted" style="cursor:pointer">Downloads (optional): show qBittorrent activity on the media world</summary>${svcCard(st.qbit, true)}</details>` : ''}`,
      { next: 'SAVE & CONTINUE →' });
  },
  // 4 network
  () => {
    const hasNv = st.services.some(s => s.key === 'netviz');
    netChoice = netChoice || st.network.source || 'none';
    const O = [['none', 'Not now', 'The orrery works fully without it; you just won’t get the network view.', true],
      ['netviz', 'NetViz', hasNv ? 'Orrery found NetViz on this host and will use its flow data.' : 'Requires a NetViz install.', hasNv],
      ['dns', 'DNS only (Pi-hole / AdGuard)', 'Which devices are online and what they look up. No traffic volumes. Coming soon.', false],
      ['opnsense', 'OPNsense / pfSense', 'Per-device traffic from your firewall’s API. Coming soon.', false],
      ['unifi', 'UniFi', 'Clients and traffic from a UniFi controller. Coming soon.', false],
      ['netflow', 'NetFlow / sFlow / IPFIX', 'For routers that can export flows (MikroTik, OpenWrt with softflowd, Asuswrt-Merlin). Coming soon.', false]];
    shell('Network traffic', 'Orrery can draw what’s talking to what across your network. Routers expose this in very different ways, so pick what you have. You can come back to this any time.',
      `<div class="grid">${O.map(([k, l, h, on]) => `<label class="opt ${k === netChoice ? 'sel' : ''} ${on ? '' : 'dis'}" ${on ? `data-net="${k}"` : ''}><b>${E(l)}</b><div class="hint">${h}</div></label>`).join('')}</div>`);
  },
  // 5 remote / tailscale
  () => {
    tsWanted = tsWanted || st.tailscale.wanted;
    shell('Reaching remote services', `Some things you want on the orrery may not be on your local network, for example a Plex server at a friend's house or a VPS. If they're on your <b>Tailscale</b> tailnet, Orrery can join it too.`,
      `<label class="opt ${tsWanted ? 'sel' : ''}" data-ts="1" style="max-width:620px"><b>${tsWanted ? '✓ ' : ''}Some of my services are only reachable over Tailscale</b>
        <div class="hint">Joining needs a one-time change on the Proxmox host (giving Orrery's container a network tunnel device). The Orrery installer will do that for you; until then, Orrery remembers you want it and shows those services as unreachable instead of failing silently.</div></label>`);
  },
  // 6 servers
  () => {
    const p = st.proxmoxSpec;
    shell('More Proxmox servers', `Run more than one Proxmox host? Add each one and it gets its own orrery you can switch between. Orrery only needs read-only access: create an API token for a user with the <b>PVEAuditor</b> role.`,
      `${st.servers.length ? `<div class="card"><h3>ADDED</h3>${st.servers.map(s => `<div class="g"><div class="n"><b>${E(s.name)}</b> <span class="muted">${E(s.url)}</span></div><button class="sm" data-rmsrv="${E(s.url)}">REMOVE</button></div>`).join('')}</div>` : ''}
      <div class="card" style="max-width:560px"><h3>ADD A SERVER</h3>${fields(p, 'srv')}<div class="row" style="margin-top:12px"><button class="sm" data-test="proxmox" data-pfx="srv">TEST</button><button class="sm" data-addsrv>ADD</button></div><div class="res" id="res-srv"></div></div>
      <div class="hint">Switching between servers in the orrery itself is still being built; servers you add here are saved and will appear when it lands.</div>`, { next: 'CONTINUE →' });
  },
  // 7 finish
  () => {
    const ok = Object.values(results).filter(r => r.ok).length;
    const svcs = st.services.filter(s => s.configured || filled[s.key]);
    shell('All set', `Orrery will restart for a moment to start using what you entered, then open the orrery.`,
      `<div class="card"><h3>SUMMARY</h3>
        <div class="g"><span>Bodies</span><span>${Object.keys(bind.guests).length} guests · ${Object.values(bind.guests).filter(g => g.tier === 'active').length} prominent</span></div>
        <div class="g"><span>Live services</span><span>${svcs.length ? svcs.map(s => E(s.label)).join(', ') : 'none yet'}</span></div>
        <div class="g"><span>Media world</span><span>${mediaKind && mediaKind !== 'none' ? E((st.media.find(m => m.key === mediaKind) || {}).label) : 'off'}</span></div>
        <div class="g"><span>Network traffic</span><span>${E(netChoice || 'none')}</span></div>
        <div class="g"><span>Extra servers</span><span>${st.servers.length || 'none'}</span></div>
        ${ok ? `<div class="g"><span>Connection tests passed</span><span class="ok">${ok}</span></div>` : ''}</div>`, { next: 'OPEN THE ORRERY →' });
  },
];

function fields(s, pfx) {
  return s.fields.map(f => `<label class="f">${E(f.label.toUpperCase())}${f.saved ? ' <span class="ok">· saved</span>' : ''}</label>
    <input type="${f.secret ? 'password' : 'text'}" id="${pfx}-${f.key}" autocomplete="off" spellcheck="false"
      value="${E((filled[s.key] || {})[f.key] ?? (f.key === 'url' || f.key === 'host' ? (f.value || (f.key === 'host' ? s.ip : s.prefill) || '') : f.value || ''))}"
      placeholder="${E(f.saved ? 'leave blank to keep the saved one' : f.placeholder || '')}">${f.hint ? `<div class="hint">${E(f.hint)}</div>` : ''}`).join('');
}
function svcCard(s, wide) {
  const r = results[s.key];
  return `<div class="card" data-svc="${s.key}" ${wide ? 'style="max-width:620px"' : ''}><h3>${E(s.label)}${s.guest ? ` <span class="muted" style="font-size:10px">on ${E(s.guest)}</span>` : ''}
      ${s.configured ? '<span class="badge ok">CONNECTED</span>' : ''}</h3>
    ${s.gives ? `<div class="hint" style="margin:0">Shows ${E(s.gives)}.</div>` : ''}${s.note ? `<div class="hint">${E(s.note)}</div>` : ''}
    ${fields(s, 'f-' + s.key)}
    <div class="row" style="margin-top:12px"><button class="sm" data-test="${s.key}" data-pfx="f-${s.key}">TEST</button></div>
    <div class="res ${r ? (r.ok ? 'ok' : 'bad') : ''}" id="res-f-${s.key}">${r ? (r.ok ? '✓ ' : '✕ ') + E(r.detail) : ''}</div></div>`;
}
const spec = k => k === 'proxmox' ? st.proxmoxSpec : k === 'qbit' ? st.qbit : st.services.find(s => s.key === k) || st.media.find(s => s.key === k);
function collect(k, pfx) {
  const s = spec(k); if (!s) return {};
  const o = {}; s.fields.forEach(f => { const v = val(`${pfx}-${f.key}`).trim(); if (v) o[f.key] = v });
  return o;
}

// ---------------------------------------------------------------- navigation
async function next() {
  if (busy) return; busy = true;
  try {
    if (step === 0) {
      if (st.needsPassword) {
        const a = val('pw1'), b = val('pw2');
        if (a.length < 8) return msg('Use at least 8 characters.', 'bad');
        if (a !== b) return msg('Those don’t match.', 'bad');
        await api('/api/next/setup/password', { password: a }); setKey(a); st.needsPassword = false;
      } else if (!key() || root.querySelector('#pw1')) {
        setKey(val('pw1'));
        try { await api('/api/next/auth', {}) } catch (e) { setKey(''); return msg('That password didn’t work.', 'bad') }
      }
    }
    if (step === 2) {
      const items = {};
      st.services.forEach(s => { const f = collect(s.key, 'f-' + s.key); const meaningful = s.fields.some(x => x.key !== 'url' && x.key !== 'host' && f[x.key]) || (s.noauth && (f.url || f.host));
        if (meaningful) { items[s.key] = f; filled[s.key] = f } });
      if (Object.keys(items).length) { msg('<span class="spin"></span>Saving…'); await api('/api/next/setup/save', { integrations: items, restart: false }) }
    }
    if (step === 3) {
      const items = {};
      if (mediaKind && mediaKind !== 'none') { const f = collect(mediaKind, 'f-' + mediaKind); if (f.url) { items[mediaKind] = f; filled[mediaKind] = f } }
      if (mediaKind === 'plex') { const q = collect('qbit', 'f-qbit'); if (q.url) items.qbit = q }
      await api('/api/next/setup/save', { integrations: items, media: { enabled: mediaKind !== 'none' }, restart: false });
    }
    if (step === 4) await api('/api/next/setup/save', { network: { source: netChoice }, restart: false });
    if (step === 5) await api('/api/next/setup/save', { tailscale: { wanted: tsWanted }, restart: false });
    if (step === 7) return finish();
    await load(); go_(step + 1);
  } catch (e) { msg(e.status === 401 ? 'Your session needs the admin password again.' : E(e.message), 'bad'); if (e.status === 401) { setKey(''); await load(); go_(0) } }
  finally { busy = false }
}
async function finish() {
  msg('<span class="spin"></span>Restarting Orrery…');
  await api('/api/next/setup/save', { wizard: { done: true }, restart: true }).catch(() => {});
  const t0 = Date.now();
  await new Promise(r => setTimeout(r, 2500));
  for (;;) { try { const r = await fetch('/api/next/setup/state'); if (r.ok) break } catch (e) {} if (Date.now() - t0 > 30000) break; await new Promise(r => setTimeout(r, 1000)) }
  location.reload();
}
function go_(i) { solo = null; step = Math.max(0, Math.min(STEPS.length - 1, i)); render[step]() }
function renderSolo() {
  const s = spec(solo); if (!s) return close();
  root.innerHTML = `<div class="box" style="max-width:680px">
    <h1>${s.configured ? 'Edit' : 'Connect'} ${E(s.label)}</h1>
    <div class="lead">${s.noauth ? 'This one needs no key, just its address.' : 'Paste the key from the service. Keys stay on this Orrery and are only sent to that service.'}</div>
    ${svcCard(s, true)}
    <div class="nav"><div>${s.configured ? '<button data-solo="remove">DISCONNECT</button>' : ''}</div>
      <div class="row"><span class="res" id="wz-msg"></span><button data-solo="cancel">CANCEL</button><button class="pri" data-solo="save">SAVE</button></div></div></div>`;
}
async function soloAct(a) {
  if (a === 'cancel') return close();
  const f = a === 'remove' ? { _remove: true } : collect(solo, 'f-' + solo);
  if (a === 'save' && !Object.keys(f).length) return msg('Nothing entered.', 'bad');
  try {
    msg('<span class="spin"></span>Saving and applying…');
    const r = await api('/api/next/setup/save', { integrations: { [solo]: f }, restart: true });
    if (r.restarting) { await new Promise(x => setTimeout(x, 2500)); for (let i = 0; i < 25; i++) { try { if ((await fetch('/api/next/setup/state')).ok) break } catch (e) {} await new Promise(x => setTimeout(x, 1000)) } }
    close(); dispatchEvent(new Event('orrery-connections'));
  } catch (e) { msg(E(e.message), 'bad') }
}

root.addEventListener('click', async e => {
  const so = e.target.closest('[data-solo]'); if (so) { soloAct(so.dataset.solo); return }
  const a = e.target.closest('[data-a]');
  if (a) { const k = a.dataset.a; if (k === 'next') next(); else if (k === 'back') go_(step - 1); else if (k === 'skip') go_(step + 1); else if (k === 'close') close(); return }
  const t = e.target.closest('[data-test]');
  if (t) {
    const k = t.dataset.test, pfx = t.dataset.pfx, out = root.querySelector('#res-' + pfx);
    out.className = 'res'; out.innerHTML = '<span class="spin"></span>Testing…'; t.disabled = true;
    try { const r = await api('/api/next/setup/test', { key: k, fields: collect(k, pfx) }); results[k] = r; out.className = 'res ' + (r.ok ? 'ok' : 'bad'); out.textContent = (r.ok ? '✓ ' : '✕ ') + r.detail }
    catch (er) { out.className = 'res bad'; out.textContent = '✕ ' + er.message }
    t.disabled = false; return;
  }
  const m = e.target.closest('[data-media]'); if (m) { mediaKind = m.dataset.media; render[3](); return }
  const n = e.target.closest('[data-net]'); if (n) { netChoice = n.dataset.net; render[4](); return }
  if (e.target.closest('[data-ts]')) { tsWanted = !tsWanted; render[5](); return }
  if (e.target.closest('[data-addsrv]')) {
    const f = collect('proxmox', 'srv'), out = root.querySelector('#res-srv');
    if (!f.url || !f.tokenid || !f.secret) { out.className = 'res bad'; out.textContent = 'Fill in the address, token ID and secret.'; return }
    const r = await api('/api/next/setup/test', { key: 'proxmox', fields: f });
    if (!r.ok) { out.className = 'res bad'; out.textContent = '✕ ' + r.detail; return }
    await api('/api/next/setup/save', { servers: [f], restart: false }); await load(); render[6](); return;
  }
  const rm = e.target.closest('[data-rmsrv]');
  if (rm) { await api('/api/next/setup/save', { servers: [{ url: rm.dataset.rmsrv, _remove: true }], restart: false }); await load(); render[6]() }
});
root.addEventListener('change', async e => {     // discovery step: corrections save immediately
  const s = e.target.closest('select[data-f]'), row = e.target.closest('[data-id]'); if (!s || !row || step !== 1) return;
  const g = bind.guests[row.dataset.id], p = { [s.dataset.f]: s.value };
  if (s.dataset.f === 'template') { if (s.value === g.auto) p.template = null; if (!g.overridden.includes('tier')) p.tier = null }
  try { bind = await api('/api/next/settings', { guests: { [row.dataset.id]: p } }); st = await api('/api/next/setup/state'); render[1]() } catch (er) { msg(E(er.message), 'bad') }
});
root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && step === 0) next() });

function open(at = 0) { root.classList.add('on'); go_(at) }
function close() { root.classList.remove('on') }
globalThis.orreryWizard = async (at = 0) => { await load(); open(at) };
globalThis.orreryConnect = async k => {           // edit one service's key from the SETUP screen
  if (!key()) { const p = prompt('Admin password:'); if (!p) return; setKey(p) }
  await load(); solo = k; root.classList.add('on'); renderSolo();
};
globalThis.orreryState = async () => { await load(); return st };

(async () => {
  try { await load() } catch (e) { return }
  if (st.needsPassword || !st.done) open(0);
  const host = document.querySelector('#setup-rescan');
  if (host) { const b = document.createElement('button'); b.className = 'act'; b.style.marginLeft = '8px'; b.textContent = 'RUN SETUP WIZARD'; b.onclick = () => globalThis.orreryWizard(); host.after(b) }
})();
})();
