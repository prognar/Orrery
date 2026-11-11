"""Other servers on your network: each one you enable becomes a planet beyond the orrery, and the services
it runs become its moons. (The orrery itself is the Proxmox host; its brass instruments are the guests.)

Suggestions come from the router's client list and from Tailscale peers, when those feeds exist
(router_file / tailscale_file in config.json, written by optional host agents). Every suggestion is
fingerprinted with the same templates used for guests, gently and in the background. You can also add
a server by address. Each server has a type (media server, NAS, desktop, home hub, server) that sets its look.
"""
import ipaddress, json, os, re, socket, threading, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor

import discover, health

TYPES = {"media": "Media server", "nas": "NAS / storage", "pc": "Desktop / PC", "home": "Home hub", "generic": "Server"}
SKIP_TPL = {"generic", "orrery", "database", "tailscale", "isponsorblocktv", "mosquitto"}
MOBILE = {"android", "ios", "iOS", "iPadOS"}
SCAN_EVERY = 6 * 3600
MACHINE_PORTS = (22, 445, 3389, 80, 443, 5900, 548)   # ssh, smb, rdp, http(s), vnc, afp: answers from almost any computer
ID_RX = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")

_cfg, _data = {}, None
_guest_ips = lambda: {}
_settings = _save = None
_scan = {}                       # addr -> {"ts", "open": [ports], "services": [keys]}
_live = {}                       # (addr, port) -> (ts, up, ms)
_state = {"scanning": None, "queue": []}
_lock = threading.Lock()


def init(data_dir, cfg, guest_ips, settings_fn, save_fn):
    global _cfg, _data, _guest_ips, _settings, _save
    _cfg, _data, _guest_ips, _settings, _save = cfg or {}, data_dir, guest_ips, settings_fn, save_fn
    try:
        with open(os.path.join(_data, "worlds_scan.json")) as f:
            _scan.update(json.load(f))
    except (OSError, ValueError):
        pass
    threading.Thread(target=_loop, daemon=True).start()


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", str(s or "").lower()).strip("-")
    return s[:40] or "server"


def tailnet(host):
    host = host or ""
    try:
        return ipaddress.ip_address(host) in ipaddress.ip_network("100.64.0.0/10")
    except ValueError:
        return host.endswith(".ts.net")


def _feed(key, default):
    try:
        with open(_cfg.get(key) or default) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _gips():
    g = _guest_ips()
    return g if isinstance(g, dict) and "__error" not in g else {}


def _plex_host():
    u = (_cfg.get("plex") or {}).get("url") or ""
    return urllib.parse.urlsplit(u).hostname if u else None


def plex_guest():
    """Name of the Proxmox guest Plex runs on, if it runs on one (then it is an ordinary body, not a planet)."""
    h = _plex_host()
    return _gips().get(h) if h else None


# ---------------------------------------------------------------- suggestions
def candidates():
    gips = _gips(); gnames = {str(n).lower() for n in gips.values()}
    pve = urllib.parse.urlsplit(_cfg.get("pve") or "").hostname
    out = {}
    R = _feed("router_file", "/mnt/host-temps/router.json") or {}
    nodes = {n.get("ip") for n in R.get("nodes") or []}
    for d in R.get("devices") or []:
        ip = d.get("ip")
        if not d.get("online") or not ip or ip in gips or ip == pve or ip in nodes:
            continue
        out[ip] = {"addr": ip, "name": d.get("name") or d.get("host") or ip, "link": "lan", "source": "router",
                   "detail": " · ".join(x for x in (d.get("conn"), d.get("vendor")) if x),
                   "auto": d.get("conn") == "wired" and not d.get("random")}
    T = _feed("tailscale_file", "/mnt/host-temps/tailscale.json") or {}
    for p in T.get("peers") or []:
        if not p.get("ip") or p.get("name", "").lower() in gnames:
            continue
        out[p["ip"]] = {"addr": p["ip"], "name": p.get("name") or p["ip"], "link": "tailnet", "source": "tailscale",
                        "detail": " · ".join(x for x in (p.get("os"), "online" if p.get("online") else "offline") if x),
                        "auto": bool(p.get("online")) and p.get("os") not in MOBILE}
    for a, c in out.items():
        sc = _scan.get(a) or {}
        c["services"], c["scanned"] = sc.get("services") or [], sc.get("ts")
    taken = {w.get("addr") for w in worlds().values()}
    return sorted((c for c in out.values() if c["addr"] not in taken),
                  key=lambda c: (-len(c["services"]), c["link"] != "tailnet", c["name"].lower())), {"router": bool(R), "tailscale": bool(T)}


# ---------------------------------------------------------------- fingerprinting
def _tpls():
    return [t for t in discover.load_templates()["templates"] if t["key"] not in SKIP_TPL]


def _name_of(addr):
    for w in worlds().values():
        if w.get("addr") == addr:
            return w.get("name")
    return (_scan.get(addr) or {}).get("name") or ""


def _persist():
    tmp = os.path.join(_data, "worlds_scan.json.tmp")
    with open(tmp, "w") as f:
        json.dump(_scan, f)
    os.replace(tmp, os.path.join(_data, "worlds_scan.json"))


def _detect_health(addr):
    hl = health.detect(addr, _name_of(addr), (_cfg.get("netdata") or {}).get("url"))
    with _lock:
        sc = _scan.setdefault(addr, {})
        sc["health"], sc["hts"] = hl, time.time()
        _persist()
    return hl


def scan(addr, name=""):
    """Find which known services answer on addr. Only an HTTP fingerprint counts: a bare open port is too vague.
    Also notes which monitoring agent (LibreHardwareMonitor, Glances, Netdata) reports the machine's health."""
    tpls = _tpls()
    _, hits = discover.probe_guest(addr, tpls)
    svc = [t["key"] for t in tpls if t["key"] in hits]
    with _lock:
        old = _scan.get(addr) or {}
        _scan[addr] = {"ts": time.time(), "services": svc, "ports": {k: hits[k][0]["port"] for k in svc},
                       "name": name or old.get("name") or "", "health": old.get("health"), "hts": old.get("hts", 0)}
    _detect_health(addr)
    return svc


def request_scan(addr):
    with _lock:
        if addr and addr not in _state["queue"] and _state["scanning"] != addr:
            _state["queue"].append(addr)


def _loop():
    time.sleep(20)
    while True:
        try:
            _migrate()
            with _lock:
                nxt = _state["queue"].pop(0) if _state["queue"] else None
            if not nxt:
                now = time.time()
                want = [w["addr"] for w in worlds().values() if w.get("enabled")]
                want += [c["addr"] for c in candidates()[0] if c["auto"]]
                nxt = next((a for a in want if now - (_scan.get(a) or {}).get("ts", 0) > SCAN_EVERY), None)
            if nxt:
                _state["scanning"] = nxt
                scan(nxt)
                _state["scanning"] = None
                continue
        except Exception as e:
            _state["scanning"] = None
            print("worlds:", e, flush=True)
        time.sleep(30)


# ---------------------------------------------------------------- settings
def worlds():
    w = (_settings() or {}).get("worlds")
    return w if isinstance(w, dict) else {}


def clean(cur, patch):
    """Merge a {id: {...} | null} patch into the saved worlds. Returns the new dict."""
    out = {k: v for k, v in (cur or {}).items() if ID_RX.match(k) and isinstance(v, dict)}
    tkeys = {t["key"] for t in discover.load_templates()["templates"]}
    for wid, v in (patch or {}).items():
        if not isinstance(wid, str):
            continue
        if v is None:
            out.pop(wid, None); continue
        if not isinstance(v, dict):
            continue
        w = dict(out.get(wid) or {})
        if isinstance(v.get("name"), str) and v["name"].strip(): w["name"] = v["name"].strip()[:40]
        if isinstance(v.get("addr"), str) and re.match(r"^[A-Za-z0-9.:-]{1,100}$", v["addr"].strip()): w["addr"] = v["addr"].strip()
        if v.get("type") in TYPES: w["type"] = v["type"]
        if isinstance(v.get("enabled"), bool): w["enabled"] = v["enabled"]
        if isinstance(v.get("services"), list): w["services"] = [s for s in v["services"] if s in tkeys][:12]
        if isinstance(v.get("off"), list): w["off"] = [s for s in v["off"] if s in tkeys][:24]     # services hidden as moons
        if v.get("health") in ("auto", "off"): w["health"] = v["health"]
        if not w.get("addr"):
            continue
        w.setdefault("name", w["addr"]); w.setdefault("type", "generic"); w.setdefault("enabled", True)
        wid = wid if ID_RX.match(wid) else slug(w["name"])
        out[wid] = w
        if not _scan.get(w["addr"]):
            request_scan(w["addr"])
    return out


def _migrate():
    """First run with this feature: an existing off-host Plex becomes a media-server planet."""
    s = _settings() or {}
    raw = {}
    try:
        with open(os.path.join(_data, "settings.json")) as f:
            raw = json.load(f)
    except (OSError, ValueError):
        pass
    if "worlds" in raw:
        return
    h, P = _plex_host(), _cfg.get("plex") or {}
    w = {}
    if h and not plex_guest():
        svc = ["plex"]
        for k, tk in (("qbit", "qbittorrent"), ("netdata", "netdata")):
            u = (_cfg.get(k) or {}).get("url") or ""
            if u and urllib.parse.urlsplit(u).hostname == h:
                svc.append(tk)
        w[slug(P.get("name") or h)] = {"name": P.get("name") or h, "addr": h, "type": "media",
                                      "enabled": bool((s.get("media") or {}).get("enabled", True)), "services": svc}
    _save({"worlds": w} if w else {"worlds": {}})


# ---------------------------------------------------------------- live status
def _port_up(addr, port, ttl=20):
    k, now = (addr, port), time.time()
    hit = _live.get(k)
    if hit and now - hit[0] < ttl:
        return hit[1], hit[2]
    t0 = time.time(); s = socket.socket(); s.settimeout(1.5)
    try:
        up = s.connect_ex((addr, port)) == 0
    except OSError:
        up = False
    finally:
        s.close()
    ms = (time.time() - t0) * 1000 if up else None
    _live[k] = (now, up, ms)
    return up, ms


def status():
    T = {t["key"]: t for t in discover.load_templates()["templates"]}
    ph, out, jobs = _plex_host(), [], []
    now = time.time()
    for wid, w in worlds().items():
        sc = _scan.get(w["addr"]) or {}
        keys = list(dict.fromkeys((w.get("services") or []) + (sc.get("services") or [])))   # configured first, then found
        ports, off = sc.get("ports") or {}, set(w.get("off") or [])
        svc = []
        for k in keys:
            t = T.get(k) or {}
            p = ports.get(k) or next(iter([h["port"] for h in (t.get("match") or {}).get("http", [])] + (t.get("match") or {}).get("ports", [])), None)
            svc.append({"key": k, "label": t.get("label", k), "look": t.get("look", "generic"), "port": p, "on": k not in off})
        hl = sc.get("health") if w.get("health") != "off" else None
        if w.get("enabled", True) and w.get("health") != "off" and not hl and now - sc.get("hts", 0) > 300 and _state.get("hdet") != w["addr"]:
            _state["hdet"] = w["addr"]                      # agent not found yet: look again in the background every 5 min
            threading.Thread(target=lambda a=w["addr"]: (_detect_health(a), _state.update(hdet=None)), daemon=True).start()
        out.append({"id": wid, "name": w.get("name"), "addr": w["addr"], "type": w.get("type", "generic"), "_h": hl,
                    "healthMode": w.get("health", "auto"), "healthSrc": (hl or {}).get("kind"),
                    "typeLabel": TYPES.get(w.get("type"), "Server"), "enabled": w.get("enabled", True),
                    "link": "tailnet" if tailnet(w["addr"]) else "lan", "media": w.get("type") == "media" and w["addr"] == ph,
                    "services": svc, "scanned": sc.get("ts"), "scanning": _state["scanning"] == w["addr"]})
    with ThreadPoolExecutor(6) as ex:
        for w in out:
            if not w["enabled"]:
                continue
            for s in w["services"]:
                if s["port"] and s["on"]:
                    jobs.append((s, ex.submit(_port_up, w["addr"], s["port"])))
            if w["_h"]:
                jobs.append((w, ex.submit(health.read, w["addr"], w["_h"])))
        for o, f in jobs:
            if o is not None and "key" in o:
                o["up"], o["ms"] = f.result()
            else:
                o["health"] = f.result()
    for w in out:
        w.pop("_h", None)
        ms = [s["ms"] for s in w["services"] if s.get("ms") is not None]
        if not ms and w["enabled"]:                # no known service answering: is the machine itself there?
            for port in MACHINE_PORTS:
                up, m = _port_up(w["addr"], port, ttl=60)
                if up:
                    ms = [m]; break
        w["up"] = bool(ms) if w["enabled"] else None
        w["ms"] = min(ms) if ms else None
    return out


def api():
    cands, feeds = candidates()
    return {"types": TYPES, "worlds": status(), "candidates": cands[:40], "feeds": feeds,
            "scanning": _state["scanning"], "queue": list(_state["queue"]), "plexGuest": plex_guest()}
