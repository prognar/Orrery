"""Capture README screenshots and animations from a running Orrery, anonymized.

    python capture.py http://orrery:8080 OUTDIR [scrub.json]

Every JSON response from the Orrery API is rewritten before the page sees it:
  * people (Plex accounts, listeners, players, requesters, Home Assistant people) -> stand-in first names
  * IPv4 addresses -> documentation ranges (LAN 10.0.0.x, tailnet 100.64.0.x, public 203.0.113.x)
  * hostnames, domains and anything listed in scrub.json -> neutral stand-ins
  * photo locations and memories are dropped
Some activity is staged so the animations have something to show: a couple of Plex streams, downloads that
finish (named after openly licensed films), an audiobook listener, two RomM players and a busier Pi-hole.
scrub.json (optional, keep it out of git): {"text": {"real": "stand-in", ...}, "home": [lat, lon]}
"""
import hashlib, ipaddress, json, math, os, re, sys, time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

URL, OUT = sys.argv[1].rstrip("/"), sys.argv[2]
EXTRA = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
for d in ("frames/hero", "frames/pihole", "frames/media", "frames/listen", "frames/wizard"):
    os.makedirs(f"{OUT}/{d}", exist_ok=True)

# ------------------------------------------------------------------ anonymizer
FAKE = ["Alex", "Sam", "Jordan", "Casey", "Riley", "Morgan", "Taylor", "Jamie", "Quinn", "Avery", "Rowan", "Skyler", "Reese", "Parker",
        "Reese", "Emerson", "Finley", "Harper", "Kendall", "Logan", "Micah", "Noel", "Oakley", "Peyton", "Sage", "Tatum", "Blair", "Dakota",
        "Ellis", "Frankie", "Gray", "Hayden", "Indy", "Jules", "Kai", "Lane", "Marlowe", "Nico", "Onyx", "Remy", "Shay", "Tobin", "Vale",
        "Wren", "Arden", "Bailey", "Cameron", "Devon", "Eden", "Flynn", "Gale", "Hollis", "Ira", "Jesse", "Kerry", "Lennon", "Milan", "Nova"]
DEVICES = ["living-room-tv", "bedroom-tv", "laptop", "phone", "tablet", "desktop", "game-console", "smart-speaker", "streaming-stick", "work-laptop",
           "kitchen-display", "thermostat", "doorbell", "printer", "nas", "watch"]
OPEN_FILMS = ["Big Buck Bunny (2008)", "Sintel (2010)", "Tears of Steel (2012)", "Elephants Dream (2006)", "Cosmos Laundromat (2015)",
              "Spring (2019)", "Agent 327 (2017)", "Night of the Living Dead (1968)", "Charge (2022)", "Sprite Fright (2021)"]
AD_DOMAINS = ["doubleclick.net", "googleads.g.doubleclick.net", "adservice.google.com", "app-measurement.com", "ads.yahoo.com", "pixel.facebook.com",
              "ads.tiktok.com", "metrics.roku.com", "tracking.miui.com", "telemetry.microsoft.com", "ads.linkedin.com", "adnxs.com",
              "scorecardresearch.com", "amazon-adsystem.com", "taboola.com", "outbrain.com", "criteo.com", "branch.io"]
names, hosts = {}, {}
TEXT = dict(EXTRA.get("text") or {})
HOME = EXTRA.get("home") or [39.83, -98.58]          # geographic centre of the contiguous US


def pseudo(real):
    if not isinstance(real, str) or not real.strip() or real in FAKE:
        return real
    k = real.strip().lower()
    if k not in names:
        names[k] = FAKE[len(names) % len(FAKE)] + ("" if len(names) < len(FAKE) else f" {len(names) // len(FAKE) + 1}")
    return names[k]


def host(real):
    k = real.lower()
    if k not in hosts:
        hosts[k] = DEVICES[len(hosts) % len(DEVICES)] + ("" if len(hosts) < len(DEVICES) else f"-{len(hosts) // len(DEVICES) + 1}") + ".lan"
    return hosts[k]


IP_RX = re.compile(r"\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b")
HOST_RX = re.compile(r"\b[\w-]+\.(?:%s)\b" % "|".join(map(re.escape, EXTRA.get("local_suffixes") or ["lan", "local", "home"])), re.I)
KEEP_IPS = {"1.1.1.1", "8.8.8.8", "8.8.4.4", "9.9.9.9", "127.0.0.1", "0.0.0.0", "255.255.255.0"}


def ip(m):
    s = m.group(0)
    try:
        a = ipaddress.ip_address(s)
    except ValueError:
        return s
    if s in KEEP_IPS:
        return s
    o = [int(x) for x in m.groups()]
    if a.is_private and o[0] == 192 and o[1] == 168:
        return f"10.0.0.{o[3]}"
    if o[0] == 100 and 64 <= o[1] <= 127:
        return f"100.64.0.{o[3]}"
    if a.is_private or a.is_loopback or a.is_link_local:
        return s
    h = int(hashlib.sha1(s.encode()).hexdigest(), 16)
    return f"{('203.0.113', '198.51.100', '192.0.2')[h % 3]}.{h % 254 + 1}"


WORD_CACHE = {"sig": None, "rx": None}
COMMON = {"max", "home", "admin", "guest", "user", "test", "plex", "media", "kids", "family", "tv", "pc", "owner", "root", "someone", "listener"}
free = lambda: [n for n in names if n not in COMMON and len(n) > 2]


def scrub_str(s):
    s = IP_RX.sub(ip, s)
    s = HOST_RX.sub(lambda m: host(m.group(0)), s)
    for a, b in TEXT.items():
        s = s.replace(a, b)
    sig = len(names)
    if WORD_CACHE["sig"] != sig and free():
        WORD_CACHE.update(sig=sig, rx=re.compile(r"\b(" + "|".join(sorted(map(re.escape, free()), key=len, reverse=True)) + r")\b", re.I))
    if WORD_CACHE["rx"] is not None:
        s = WORD_CACHE["rx"].sub(lambda m: names[m.group(0).lower()], s)
    return s


PERSON_KEYS = {"user", "username", "who", "displayName", "friendlyName", "requestedBy", "owner"}


def walk(v, parent=None):
    if isinstance(v, dict):
        out = {}
        for k, x in v.items():
            nk = scrub_str(k) if isinstance(k, str) else k
            if k in PERSON_KEYS and isinstance(x, str):
                out[nk] = pseudo(x)
            elif k == "User" and isinstance(x, dict) and isinstance(x.get("title"), str):
                out[nk] = {**walk(x), "title": pseudo(x["title"])}
            else:
                out[nk] = walk(x, k)
        return out
    if isinstance(v, list):
        return [walk(x, parent) for x in v]
    if isinstance(v, str):
        return scrub_str(v)
    return v


def learn(plex, traits):
    """Register every real person name before anything is drawn, so free-text mentions get replaced too."""
    for a in ((plex.get("accounts") or {}).get("Account") or []):
        pseudo(a.get("name"))
    for m in ((plex.get("sessions") or {}).get("Metadata") or []):
        pseudo((m.get("User") or {}).get("title"))
    A, R, V = traits.get("abs") or {}, traits.get("romm") or {}, traits.get("svc") or {}
    for x in (A.get("sessions") or []) + (A.get("recent") or []) + (R.get("playing") or []) + (R.get("recent") or []):
        pseudo(x.get("user"))
    for x in ((V.get("seerr") or {}).get("recent") or []):
        pseudo(x.get("who"))
    T = V.get("tracearr") or {}
    for x in (T.get("streams") or []) + (T.get("history") or []) + (T.get("recentV") or []):
        pseudo(x.get("who"))
    for p in ((V.get("ha") or {}).get("people") or []):
        pseudo(p.get("name"))
    for real in EXTRA.get("people") or []:
        pseudo(real)


# ------------------------------------------------------------------ staging
STAGE = {"t0": time.time(), "dl": {}, "done": [], "ph": 0}
FILM_HASH = {f: hashlib.sha1(f.encode()).hexdigest()[:40] for f in OPEN_FILMS}
DEMO = {}   # filled from real data: posters, audiobook, roms


def stage_plex(d):
    rec = ((d.get("recent") or {}).get("Metadata") or [])
    films = [m for m in rec if m.get("type") == "movie"][:2] or rec[:2]
    sess = []
    for i, m in enumerate(films):
        dur = m.get("duration") or 6_000_000
        sess.append({"sessionKey": f"demo{i}", "ratingKey": m.get("ratingKey"), "type": "movie", "title": m.get("title"), "year": m.get("year"),
                     "thumb": m.get("thumb"), "art": m.get("art"), "duration": dur, "viewOffset": int(dur * (0.32 + 0.3 * i)),
                     "User": {"title": FAKE[3 + i]}, "Player": {"title": ("Living Room TV", "Tablet")[i], "product": "Plex", "platform": ("Android TV", "iPadOS")[i],
                     "state": "playing", "local": i == 0, "machineIdentifier": f"demo-client-{i}"},
                     "Session": {"bandwidth": 9000 + 4000 * i, "location": "lan" if i == 0 else "wan"},
                     "Media": [{"bitrate": 8200 + 3000 * i, "videoResolution": "1080", "videoCodec": "h264", "audioCodec": "aac"}],
                     **({"TranscodeSession": {"videoDecision": "transcode", "audioDecision": "copy", "speed": 2.1, "progress": 40}} if i == 1 else {})})
    d["sessions"] = {"size": len(sess), "Metadata": sess}
    bw = d.get("bw") if isinstance(d.get("bw"), dict) and not d["bw"].get("__error") else {}
    bw = {**bw, "total": 2.6e6, "lan": 1.1e6, "wan": 1.5e6, "byClient": {"demo-client-0": 1.1e6, "demo-client-1": 1.5e6}}
    d["bw"] = bw
    dl = [{"hash": FILM_HASH[f], "name": f, "progress": p, "dlspeed": int(9e6 + 4e6 * k), "upspeed": 0, "eta": int((1 - p) * 600), "size": 2.1e9,
           "state": "downloading", "num_seeds": 40, "num_leechs": 3} for k, (f, p) in enumerate(STAGE["dl"].items()) if p < 1]
    done = [{"hash": FILM_HASH[f], "name": f, "progress": 1, "completion_on": int(time.time()), "size": 2.1e9} for f in STAGE["done"]]
    base = [{"hash": FILM_HASH[f], "name": f, "progress": 1, "size": 1.8e9} for f in OPEN_FILMS[6:]]
    d["qbit"] = {"enabled": True, "status": "connected", "dl_speed": sum(x["dlspeed"] for x in dl), "up_speed": 1.4e6,
                 "dl_session": 6.1e11, "up_session": 3.2e11, "downloading": dl, "n_downloading": len(dl),
                 "uploading": [{**b, "upspeed": 7e5} for b in base[:2]], "n_active": len(dl) + 2, "recent": done[::-1] + base}
    return d


def stage_traits(d):
    P = d.get("pihole")
    if isinstance(P, dict) and not P.get("__error"):
        now = time.time(); extra = []
        for k in range(4):
            STAGE["ph"] += 1
            extra.append({"id": 9_000_000_000 + STAGE["ph"], "t": now, "d": AD_DOMAINS[STAGE["ph"] % len(AD_DOMAINS)], "c": DEVICES[STAGE["ph"] % 6] + ".lan"})
        P["recent"] = extra + (P.get("recent") or [])[:20]
    A = d.get("abs")
    if isinstance(A, dict) and not A.get("__error") and DEMO.get("abs"):
        b = DEMO["abs"]
        A["sessions"] = [{"id": "demo-abs", "user": FAKE[5], "title": b["title"], "author": b["author"], "cur": b["dur"] * 0.41 + (time.time() - STAGE["t0"]),
                          "dur": b["dur"], "item": b["id"], "player": "web", "age": 3, "type": "book"}]
    R = d.get("romm")
    if isinstance(R, dict) and not R.get("__error") and DEMO.get("roms"):
        R["playing"] = [{"user": FAKE[6 + i], "rom": r["name"], "rom_id": r["id"], "platform": r["platform"], "cover": r["cover"], "device": "browser",
                         "since": "2026-11-08T15:00:00Z"} for i, r in enumerate(DEMO["roms"][:2])]
    if isinstance(d.get("netviz"), dict):
        d["netviz"]["home"] = HOME
    I = d.get("immich")
    if isinstance(I, dict):                       # photos and where they were taken never leave the house
        I["places"] = None; I["memories"] = []; I["recent"] = []
    V = d.get("svc") or {}
    if isinstance(V.get("paperless"), dict):
        for x in V["paperless"].get("docs") or V["paperless"].get("recent") or []:
            if isinstance(x, dict) and "title" in x: x["title"] = "Scanned document"
    T = V.get("tracearr")
    if isinstance(T, dict):
        for x in (T.get("streams") or []) + (T.get("history") or []):
            for g in ("geo", "city", "region", "country", "ip"): x.pop(g, None)
    return d


def people_fields(u, d):
    if "/api/plex" in u and isinstance(d, dict):
        for a in ((d.get("accounts") or {}).get("Account") or []):
            if isinstance(a, dict) and a.get("name"): a["name"] = pseudo(a["name"])
    if "/api/traits" in u and isinstance(d, dict):
        H = (d.get("svc") or {}).get("ha")
        if isinstance(H, dict):
            for x in H.get("people") or []:
                if isinstance(x, dict) and x.get("name"): x["name"] = pseudo(x["name"])
    return d


def handle(route, req):
    u = req.url
    if "/api/traits/img" in u and "k=immich" in u:
        return route.fulfill(status=404, body="")
    if "/img" in u or not ("/api/" in u):
        return route.continue_()
    try:
        r = route.fetch()
        ct = r.headers.get("content-type", "")
        if "json" not in ct:
            return route.fulfill(response=r)
        d = r.json()
    except Exception:
        return route.continue_()
    if "/api/plex" in u and isinstance(d, dict) and d.get("enabled"):
        d = stage_plex(d)
    if "/api/traits" in u and isinstance(d, dict):
        d = stage_traits(d)
    d = people_fields(u, d)
    if "/api/next/setup/state" in u and isinstance(d, dict) and STAGE.get("first_run"):
        d["needsPassword"] = True; d["done"] = False
    route.fulfill(status=r.status, body=json.dumps(walk(d)), headers={"content-type": "application/json", "cache-control": "no-store"})


def fix_js(route, req):
    """NetViz draws your home on the globe; move it for published images."""
    r = route.fetch(); body = r.text()
    body = re.sub(r"nvHome = \[[-\d., ]+\]", f"nvHome = [{HOME[0]}, {HOME[1]}]", body)
    route.fulfill(response=r, body=body)


# ------------------------------------------------------------------ page helpers
VTIME_JS = """(() => { let vt = 0; const q = new Map(); let id = 0;
  performance.now = () => vt;
  window.requestAnimationFrame = cb => { q.set(++id, cb); return id };
  window.cancelAnimationFrame = i => q.delete(i);
  window.__tick = ms => { vt += ms; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) { try { cb(vt) } catch (e) { console.error(e) } } };
  window.__pump = setInterval(() => window.__tick(33), 33);
})();"""


def dom_scrub_js():
    m = {**TEXT, **{k: names[k] for k in free()}}
    return """(() => { const M = %s;
  const ipx = /\\b(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\b/g;
  const rx = new RegExp('\\\\b(' + Object.keys(M).sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('|') + ')\\\\b', 'gi');
  const low = Object.fromEntries(Object.entries(M).map(([a, b]) => [a.toLowerCase(), b]));
  const fixS = t => t.replace(ipx, (s, a, b, c, d) => a === '192' && b === '168' ? '10.0.0.' + d : (a === '100' && +b >= 64 && +b <= 127) ? '100.64.0.' + d : s).replace(rx, s => low[s.toLowerCase()] || s);
  const fix = n => { const t = n.nodeValue, o = fixS(t); if (o !== t) n.nodeValue = o };
  const walk = r => { const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) fix(n) };
  new MutationObserver(ms => ms.forEach(m => { m.addedNodes.forEach(n => n.nodeType === 3 ? fix(n) : n.nodeType === 1 && walk(n)); if (m.type === 'characterData') fix(m.target) }))
    .observe(document, { childList: true, subtree: true, characterData: true });
  const st = document.createElement('style'); st.textContent = '#disk-tbl tr > :last-child{display:none}';
  document.addEventListener('DOMContentLoaded', () => { document.head.appendChild(st); walk(document.body) });
})();""" % json.dumps(m)


def new_ctx(b, w, h, dsf, vtime=True):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dsf)
    ctx.add_init_script(dom_scrub_js())
    if vtime: ctx.add_init_script(VTIME_JS)
    ctx.route("**/api/**", handle)
    ctx.route("**/traits3d.js", fix_js)
    return ctx


def ticks(pg, n=2, ms=33):
    for _ in range(n): pg.evaluate(f"__tick({ms})")


def focus_on(pg, name, off):
    p = pg.evaluate(f"o3d && o3d.where({json.dumps(name)})")
    if not p: return None
    pg.evaluate(f"o3d.focus({p[0] + off[0]}, {p[1] + off[1]}, {p[2] + off[2]}, {p[0]}, {p[1]}, {p[2]})")
    return p


def hover_center(pg, want, tries=40):
    box = pg.eval_on_selector("#orbit3d", "e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }")
    cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
    for k in range(tries):
        a, rr = k * 2.4, 4 + k * 3
        x, y = cx + rr * math.cos(a), cy + rr * math.sin(a)
        pg.mouse.move(x, y); ticks(pg, 1)
        t = pg.evaluate("() => { const t = document.querySelector('#tip'); return t && t.style.display === 'block' ? (t.querySelector('h4') || {}).innerText : null }")
        if t and t.strip().lower() == want.lower():
            pg.mouse.move(x + 1, y); ticks(pg, 2); return True
    return False


def boot(pg, warm=22000):
    pg.goto(URL); pg.wait_for_timeout(2500)
    pg.evaluate("setMode('3d', false)"); pg.wait_for_timeout(warm)


# ------------------------------------------------------------------ run
plex0 = json.loads(urlopen(URL + "/api/plex", timeout=30).read())
traits0 = json.loads(urlopen(URL + "/api/traits", timeout=30).read())
learn(plex0, traits0)
DEMO.update(EXTRA.get("demo") or {})
print("people mapped:", len(names), flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    errs = []

    # ---------- stills (2x)
    ctx = new_ctx(b, 1440, 900, 2)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    STAGE["dl"] = {OPEN_FILMS[0]: 0.62, OPEN_FILMS[1]: 0.31}
    boot(pg); pg.evaluate("clearInterval(window.__pump)"); ticks(pg, 3)
    pg.mouse.move(5, 5); ticks(pg); pg.screenshot(path=f"{OUT}/orbit.png", timeout=180000); print("orbit", flush=True)
    for name, want, off, fname in [("pihole", "pihole", (3.2, 3.0, 7.6), "hover-pihole"), ("audiobookshelf", "audiobookshelf", (3.2, 3.0, 7.6), "hover-abs"),
                                   ("romm", "romm", (3.2, 3.0, 7.6), "hover-romm"), ("seerr", "seerr", (3.2, 3.0, 7.6), "hover-seerr"),
                                   ("HomeAssistant", "HomeAssistant", (3.2, 3.0, 7.6), "hover-ha"), ("netviz", "netviz", (3.2, 3.0, 7.6), "hover-netviz")]:
        if focus_on(pg, name, off) is None: print("no body", name, flush=True); continue
        ticks(pg, 30)
        ok = hover_center(pg, want)
        pg.screenshot(path=f"{OUT}/{fname}.png", timeout=180000); print(fname, "hover" if ok else "NO HOVER", flush=True)
        pg.mouse.move(5, 5)
    pg.evaluate("o3d.focus(30, 9, 9, 19.5, 1.2, -6)"); ticks(pg, 30)
    ok = hover_center(pg, "plex")
    pg.screenshot(path=f"{OUT}/hover-plex.png", timeout=180000); print("hover-plex", ok, flush=True)
    pg.mouse.move(5, 5); pg.evaluate("window.__pump = setInterval(() => window.__tick(33), 33)")
    for v in ["pulse", "vaults", "chron", "manifest", "setup"]:
        pg.evaluate(f"go('{v}')"); pg.wait_for_timeout(5000)
        pg.screenshot(path=f"{OUT}/{v}.png", timeout=180000); print(v, flush=True)
    pg.close()
    STAGE["first_run"] = True
    pg = ctx.new_page(); pg.goto(URL); pg.wait_for_timeout(3000)
    pg.evaluate("setMode('2d', false); clearInterval(window.__pump)"); pg.wait_for_timeout(1500)
    for k, (i, nm) in enumerate([(0, "welcome"), (1, "discover"), (2, "connect"), (3, "media"), (4, "network"), (6, "servers")]):
        pg.evaluate(f"orreryWizard({i})"); pg.wait_for_timeout(2500); ticks(pg, 1)
        pg.screenshot(path=f"{OUT}/wizard-{nm}.png", timeout=180000)
        os.link(f"{OUT}/wizard-{nm}.png", f"{OUT}/frames/wizard/{k:02d}.png"); print("wizard", nm, flush=True)
    STAGE["first_run"] = False
    pg.close(); ctx.close()

    # ---------- animations (1x, virtual clock)
    ctx = new_ctx(b, 1100, 660, 1)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    STAGE["dl"] = {OPEN_FILMS[0]: 0.55, OPEN_FILMS[1]: 0.2, OPEN_FILMS[2]: 0.05}; STAGE["done"] = []
    boot(pg); pg.evaluate("clearInterval(window.__pump)"); ticks(pg, 3)

    def poll(n=1):          # let the page's own pollers run (they use real timers)
        pg.wait_for_timeout(120 * n)

    # hero: slow sweep of the whole system
    box = pg.eval_on_selector("#orbit3d", "e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }")
    cx, cy = box[0] + box[2] * .5, box[1] + box[3] * .62
    pg.mouse.move(cx, cy); pg.mouse.down()
    for k in range(110):
        pg.mouse.move(cx + k * 2.0, cy + k * 0.12); ticks(pg, 2); poll()
        pg.screenshot(path=f"{OUT}/frames/hero/{k:03d}.png", timeout=180000)
    pg.mouse.up(); print("hero frames", flush=True)

    # Pi-hole close-up, tracking the body as it orbits
    for k in range(80):
        focus_on(pg, "pihole", (2.6, 2.4, 7.6)); ticks(pg, 2); poll()
        pg.screenshot(path=f"{OUT}/frames/pihole/{k:03d}.png", timeout=180000)
    print("pihole frames", flush=True)

    # media world: downloads spiral in, one finishes -> ACQUIRED shockwave
    pg.evaluate("o3d.focus(31, 10, 8, 19.5, 1.2, -6)")
    for k in range(130):
        f0 = OPEN_FILMS[0]
        if k < 45: STAGE["dl"][f0] = min(0.99, 0.55 + k * 0.01)
        elif k == 45: STAGE["dl"].pop(f0, None); STAGE["done"].append(f0)
        for f in list(STAGE["dl"]): STAGE["dl"][f] = min(0.98, STAGE["dl"][f] + 0.002)
        ticks(pg, 2); poll(2 if 40 <= k <= 50 else 1)
        pg.screenshot(path=f"{OUT}/frames/media/{k:03d}.png", timeout=180000)
    print("media frames", flush=True)

    # someone listening, someone playing
    k = 0
    for name in ("audiobookshelf", "romm"):
        for _ in range(55):
            focus_on(pg, name, (2.6, 2.6, 7.6)); ticks(pg, 2); poll()
            pg.screenshot(path=f"{OUT}/frames/listen/{k:03d}.png", timeout=180000); k += 1
    print("listen frames", flush=True)
    b.close()

json.dump({"people": len(names), "hosts": len(hosts)}, open(f"{OUT}/anon.json", "w"))
print("page errors:", errs[:5], flush=True)
print("CAPTURE DONE", flush=True)
