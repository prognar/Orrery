#!/usr/bin/env python3
"""ORRERY — read-only Proxmox observatory. Zero dependencies.
Proxies a whitelisted set of GET endpoints to the PVE API using a PVEAuditor token,
and serves the static frontend."""
import ipaddress, base64, json, os, re, socket, ssl, time, threading, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

CFG_PATH = os.environ.get("ORRERY_CFG", "/opt/orrery/config.json")
CFG = json.load(open(CFG_PATH))
try:   # credentials entered in the setup wizard live beside config.json and override it
    with open(os.path.join(os.path.dirname(os.path.abspath(CFG_PATH)), "secrets.json")) as _f:
        for _k, _v in json.load(_f).items():
            if _k == "traits" and isinstance(_v, dict):
                CFG.setdefault("traits", {}).update({k: v for k, v in _v.items() if v})
            elif _k != "servers" and _v:
                CFG[_k] = _v
except (OSError, ValueError):
    pass
PVE = CFG["pve"].rstrip("/")            # e.g. https://192.168.1.10:8006
PVE_HOST = urllib.parse.urlparse(PVE).hostname or ""
NODE = CFG.get("node", "pve")
AUTH = f"PVEAPIToken={CFG['tokenid']}={CFG['secret']}"
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
PORT = int(CFG.get("port", 8080))
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE

ALLOW = [re.compile(p) for p in (
    r"^cluster/(resources|tasks|status|backup|log)$",
    r"^nodes/[\w-]+/(status|rrddata|tasks|storage|network|netstat|version|subscription)$",
    r"^nodes/[\w-]+/disks/(list|smart)$",
    r"^nodes/[\w-]+/apt/update$",
    r"^nodes/[\w-]+/(qemu|lxc)/\d+/(status/current|rrddata|config|interfaces|snapshot)$",
    r"^nodes/[\w-]+/tasks/[\w:%.@!-]+/(log|status)$",
    r"^nodes/[\w-]+/storage/[\w-]+/(status|rrddata)$",
)]

_cache, _lock = {}, threading.Lock()

def pve_get(path, query="", ttl=2.0):
    key = path + "?" + query
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    url = f"{PVE}/api2/json/{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, headers={"Authorization": AUTH})
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=8) as r:
            data = json.loads(r.read()).get("data")
    except Exception as e:
        data = {"__error": str(e)}
    with _lock:
        _cache[key] = (now, data)
    return data

POOL = ThreadPoolExecutor(8)        # service integrations
PVE_POOL = ThreadPoolExecutor(6)    # Proxmox bundle only: a slow or unreachable service must never starve the core views
MEDIA_POOL = ThreadPoolExecutor(12) # Plex fan-out

_reach, _reach_lock = {}, threading.Lock()
def host_up(url, ttl_ok=30, ttl_down=60):
    """Fast reachability gate for optional remote services (Plex over Tailscale, Netdata, qBittorrent):
    one 1.5 s TCP check, remembered, so an unreachable box costs ~nothing instead of a timeout per call."""
    if not url:
        return False
    u = urllib.parse.urlsplit(url); key = (u.hostname, u.port or (443 if u.scheme == "https" else 80))
    now = time.time()
    with _reach_lock:
        hit = _reach.get(key)
        if hit and now - hit[0] < (ttl_ok if hit[1] else ttl_down):
            return hit[1]
    sk = socket.socket(); sk.settimeout(1.5)
    try:
        ok = sk.connect_ex(key) == 0
        if ok:
            try:
                sk.sendall(b"HEAD / HTTP/1.0\r\nHost: " + key[0].encode() + b"\r\nConnection: close\r\n\r\n"); sk.settimeout(1.5); sk.recv(64)
            except OSError:
                pass
    except OSError:
        ok = False
    finally:
        sk.close()
    with _reach_lock:
        _reach[key] = (now, ok)
    return ok


TEMPS = CFG.get("temps_file", "/mnt/host-temps/temps.json")   # written by orrery-temps.service on the host, bind-mounted read-only

def host_temps():
    try:
        with open(TEMPS) as f:
            d = json.load(f)
        return d if time.time() - d.get("ts", 0) < 60 else None
    except Exception:
        return None

def bundle():
    jobs = {
        "resources": ("cluster/resources", "", 2),
        "node": (f"nodes/{NODE}/status", "", 2),
        "tasks": ("cluster/tasks", "", 4),
        "storage": (f"nodes/{NODE}/storage", "", 10),
        "version": (f"nodes/{NODE}/version", "", 300),
    }
    futs = {k: PVE_POOL.submit(pve_get, p, q, t) for k, (p, q, t) in jobs.items()}
    out = {k: f.result() for k, f in futs.items()}
    out["temps"] = host_temps()
    out["nodeName"] = NODE
    out["ts"] = time.time()
    return out

# ---------------- Plex (optional, across Tailscale) ----------------
PLEX = CFG.get("plex") or {}
PLEX_URL = (PLEX.get("url") or "").rstrip("/")
PLEX_TOK = PLEX.get("token", "")
IMG_RX = re.compile(r"^/library/metadata/\d+/(thumb|art|grandparentThumb|parentThumb)/\d+$")

def plex_raw(path, accept="application/json", timeout=6):
    sep = "&" if "?" in path else "?"
    req = urllib.request.Request(f"{PLEX_URL}{path}{sep}X-Plex-Token={PLEX_TOK}",
                                 headers={"Accept": accept, "X-Plex-Client-Identifier": "orrery", "X-Plex-Product": "Orrery"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "")

def plex_get(path, ttl=3.0):
    key = "plex:" + path
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    try:
        t0 = time.time()
        body, _ = plex_raw(path)
        data = json.loads(body).get("MediaContainer", {}) if body else {}
        data["__ms"] = round((time.time() - t0) * 1000, 1)
    except Exception as e:
        data = {"__error": str(e)}
    with _lock:
        _cache[key] = (now, data)
    return data

def plex_libraries():
    secs = plex_get("/library/sections", 600)
    out = []
    for d in secs.get("Directory", []) if isinstance(secs, dict) else []:
        k = d.get("key")
        item = {"key": k, "title": d.get("title"), "type": d.get("type"), "scannedAt": d.get("scannedAt"),
                "refreshing": d.get("refreshing"), "count": None, "episodes": None}
        c = plex_get(f"/library/sections/{k}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0", 600)
        item["count"] = c.get("totalSize", c.get("size"))
        if d.get("type") == "show":
            e = plex_get(f"/library/sections/{k}/all?type=4&X-Plex-Container-Start=0&X-Plex-Container-Size=0", 600)
            item["episodes"] = e.get("totalSize", e.get("size"))
        out.append(item)
    return out

def plex_bw(window=30, bucket=5, span=150):
    """Measured throughput from Plex's per-device byte counters (timespan=6 ≈ per-second samples).
    Session.bandwidth is only Plex's reservation estimate; this is what actually left the server."""
    d = plex_get("/statistics/bandwidth?timespan=6", 3)
    if not isinstance(d, dict) or "__error" in d:
        return {"__error": (d or {}).get("__error", "no data")}
    rows = d.get("StatisticsBandwidth", []) or []
    cid = {x.get("id"): x.get("clientIdentifier") for x in d.get("Device", []) or []}
    now = time.time()
    latest = max([r.get("at", 0) for r in rows] or [now])
    ref = max(now, latest)  # tolerate small clock skew between hosts
    by, lan, wan, total = {}, 0, 0, 0
    nb = span // bucket
    series = [[0, 0] for _ in range(nb)]  # [lan, wan] bytes per bucket
    for r in rows:
        at, b = r.get("at", 0), r.get("bytes", 0) or 0
        age = ref - at
        if age < window:
            total += b
            if r.get("lan"): lan += b
            else: wan += b
            k = cid.get(r.get("deviceID")) or f"dev{r.get('deviceID')}"
            by[k] = by.get(k, 0) + b
        i = nb - 1 - int(age // bucket)
        if 0 <= i < nb:
            series[i][0 if r.get("lan") else 1] += b
    return {"window": window, "bucket": bucket,
            "total": total / window, "lan": lan / window, "wan": wan / window,
            "byClient": {k: v / window for k, v in by.items()},
            "series": [[l / bucket, w / bucket] for l, w in series],
            "end": ref}

# ---------------- qBittorrent (optional; read-only use of the WebUI API) ----------------
QB = ((CFG.get("qbit") or {}).get("url") or "").rstrip("/")
QB_FIELDS = ("hash", "name", "progress", "dlspeed", "upspeed", "eta", "size", "state", "num_seeds", "num_leechs",
             "category", "completion_on", "added_on", "ratio")

def qb_get(path, ttl=3.0):
    key = "qb:" + path
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    try:
        req = urllib.request.Request(QB + path, headers={"Referer": QB})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        data = {"__error": "forbidden — add this Orrery's IP to qBittorrent's Web UI auth-bypass whitelist" if e.code == 403 else f"HTTP {e.code}"}
    except Exception as e:
        data = {"__error": str(e)}
    with _lock:
        _cache[key] = (now, data)
    return data

def qbit_bundle():
    if not QB:
        return {"enabled": False}
    if not host_up(QB):
        return {"enabled": True, "__error": f"can't reach {urllib.parse.urlsplit(QB).hostname} from Orrery"}
    jobs = {
        "info": ("/api/v2/transfer/info", 2),
        "dl": ("/api/v2/torrents/info?filter=downloading&sort=dlspeed&reverse=true", 3),
        "active": ("/api/v2/torrents/info?filter=active&sort=upspeed&reverse=true", 3),
        "done": ("/api/v2/torrents/info?filter=completed&sort=completion_on&reverse=true&limit=8", 20),
    }
    raw = {k: qb_get(p, t) for k, (p, t) in jobs.items()}  # inline: this already runs inside POOL
    err = next((v["__error"] for v in raw.values() if isinstance(v, dict) and "__error" in v), None)
    if err:
        return {"enabled": True, "__error": err}
    trim = lambda lst, n: [{k: t.get(k) for k in QB_FIELDS} for t in (lst or [])[:n]]
    info = raw["info"] or {}
    act = raw["active"] or []
    return {"enabled": True,
            "dl_speed": info.get("dl_info_speed", 0), "up_speed": info.get("up_info_speed", 0),
            "dl_session": info.get("dl_info_data", 0), "up_session": info.get("up_info_data", 0),
            "status": info.get("connection_status"),
            "downloading": trim(raw["dl"], 24), "n_downloading": len(raw["dl"] or []),
            "uploading": trim([t for t in act if (t.get("upspeed") or 0) > 0], 12),
            "n_active": len(act), "recent": trim(raw["done"], 8), "ts": time.time()}

# ---------------- Media-server host metrics via the Netdata parent (CT 114) ----------------
ND = CFG.get("netdata") or {}

def nd_latest(chart, ttl=5.0, after=-6):
    """Latest averaged values of a Netdata chart as {dimension: value} (abs), or {'__error': ...}."""
    key = "nd:" + chart
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    url = (f"{ND['url'].rstrip('/')}/host/{urllib.parse.quote(ND['host'])}/api/v1/data?chart={urllib.parse.quote(chart)}"
           f"&after={after}&points=1&format=json&options=abs")
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            d = json.loads(r.read())
        row = (d.get("data") or [[None]])[0]
        data = {k: v for k, v in zip(d.get("labels", []), row) if k != "time" and v is not None}
    except Exception as e:
        data = {"__error": str(e)}
    with _lock:
        _cache[key] = (now, data)
    return data

ND_FILTER = ("system.cpu system.ram system.uptime system.processes system.threads system.net mem.available mem.swap "
             "cpu.cpu* net.* net_speed.* disk.* disk_space.* smartctl.device_sd*_temperature smartctl.device_sd*_power_on_time "
             "smartctl.device_sd*_smart_status service.service_*arr_state service.service_Tailscale_state "
             "service.service_Plex*_state service.service_Netdata_state service.service_*qbit*_state service.service_*Tautulli*_state")

def nd_machine():
    """Everything worth knowing about the Plex machine, from one Netdata allmetrics call."""
    def build():
        url = (f"{ND['url'].rstrip('/')}/host/{urllib.parse.quote(ND['host'])}/api/v1/allmetrics?format=json&filter="
               + urllib.parse.quote(ND_FILTER))
        with urllib.request.urlopen(url, timeout=6) as r:
            A = json.loads(r.read())
        v = lambda ch: {k: x.get("value") for k, x in ((A.get(ch) or {}).get("dimensions") or {}).items()}
        cores = []
        for k in sorted((k for k in A if k.startswith("cpu.cpu")), key=lambda k: int(k[7:]) if k[7:].isdigit() else 0):
            c = v(k); cores.append(round(sum(x or 0 for n, x in c.items() if n != "idle"), 1))
        ram, av, sw, up = v("system.ram"), v("mem.available"), v("mem.swap"), v("system.uptime")
        nic = next((k for k in A if k.startswith("net.")), None)
        sp = next((k for k in A if k.startswith("net_speed.")), None)
        net = v(nic) if nic else {}
        vols = []
        for k in sorted(k for k in A if k.startswith("disk_space.")):
            x = v(k)
            if (x.get("used") or 0) + (x.get("avail") or 0) > 1:      # skip tiny recovery/EFI partitions
                vols.append({"name": k.split(".", 1)[1], "used": x.get("used"), "avail": x.get("avail")})
        io = [{"name": k.split(".", 1)[1], "r": abs(v(k).get("reads") or 0), "w": abs(v(k).get("writes") or 0)} for k in sorted(k for k in A if k.startswith("disk."))]
        hdd = {}
        for k in A:
            m = re.match(r"smartctl\.device_(sd\w+)_type_\w+?_(temperature|power_on_time|smart_status)$", k)
            if m:
                lab = (A[k].get("labels") or A[k].get("chart_labels") or {})
                h = hdd.setdefault(m.group(1), {"dev": m.group(1)})
                x = v(k)
                if m.group(2) == "temperature": h["temp"] = x.get("temperature")
                elif m.group(2) == "power_on_time": h["hours"] = (x.get("power_on_time") or 0) / 3600
                else: h["ok"] = (x.get("passed") or 0) >= 1
        svcs = []
        for k in sorted(k for k in A if k.startswith("service.service_")):
            x = v(k); st = max(x, key=lambda n: x[n] or 0) if x else "unknown"
            svcs.append({"name": k[len("service.service_"):-len("_state")], "state": st})
        return {"uptime": up.get("uptime"), "cores": cores,
                "ram_used": ram.get("used"), "ram_free": ram.get("free"), "ram_avail": av.get("avail"),
                "swap_used": sw.get("used"), "swap_free": sw.get("free"),
                "procs": v("system.processes").get("running"), "threads": v("system.threads").get("threads"),
                "net_in": abs(net.get("received") or 0), "net_out": abs(net.get("sent") or 0),   # kilobits/s
                "nic": nic.split(".", 1)[1] if nic else None, "link": (v(sp).get("speed") if sp else None),
                "vols": vols, "io": io, "hdd": sorted(hdd.values(), key=lambda h: h["dev"]), "svcs": svcs}
    return cached("nd:machine", 5, build)

def world_bundle():
    if not ND.get("url"):
        return {"enabled": False}
    if not host_up(ND["url"]):
        return {"enabled": True, "__error": f"can't reach {urllib.parse.urlsplit(ND['url']).hostname} from Orrery"}
    d, c = nd_latest("disk_space.D:", 30, -30), nd_latest("disk_space.C:", 60, -30)
    cpu, ram, io = nd_latest("system.cpu", 4), nd_latest("system.ram", 6), nd_latest("system.io", 4)
    if "__error" in d:
        return {"enabled": True, "__error": d["__error"]}
    vol = lambda x: {"used": x.get("used", 0), "avail": x.get("avail", 0)} if "__error" not in x else None   # GiB
    return {"enabled": True, "host": ND.get("host"), "d": vol(d), "c": vol(c), "machine": nd_machine(),
            "cpu": sum(v for v in cpu.values() if isinstance(v, (int, float))) if "__error" not in cpu else None,   # %
            "ram_used": ram.get("used"), "ram_free": ram.get("free"),                                                # MiB
            "io_read": io.get("reads", io.get("in")), "io_write": io.get("writes", io.get("out"))}                    # KiB/s

def plex_bundle():
    if not PLEX_URL:
        return {"enabled": False}
    if not host_up(PLEX_URL):
        err = {"__error": f"can't reach {urllib.parse.urlsplit(PLEX_URL).hostname} from Orrery"}
        return {**{k: err for k in ("identity", "sessions", "transcodes", "activities", "resources", "recent", "history", "accounts", "devices",
                                    "libraries", "bw")},
                "qbit": qbit_bundle(), "world": world_bundle(), "enabled": True, "unreachable": True,
                "host": PLEX.get("name", "plex"), "addr": urllib.parse.urlsplit(PLEX_URL).hostname, "ts": time.time()}
    jobs = {
        "identity": ("/identity", 60),
        "sessions": ("/status/sessions", 2),
        "transcodes": ("/transcode/sessions", 3),
        "activities": ("/activities", 5),
        "resources": ("/statistics/resources?timespan=6", 10),
        "recent": ("/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=14", 120),
        "history": ("/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=25", 30),
        "accounts": ("/accounts", 600),
        "devices": ("/devices", 600),
    }
    futs = {k: MEDIA_POOL.submit(plex_get, p, t) for k, (p, t) in jobs.items()}
    libs = MEDIA_POOL.submit(plex_libraries)
    bw = MEDIA_POOL.submit(plex_bw)
    qb = MEDIA_POOL.submit(qbit_bundle)
    wd = MEDIA_POOL.submit(world_bundle)
    out = {k: f.result() for k, f in futs.items()}
    out["libraries"] = libs.result()
    out["bw"] = bw.result()
    out["qbit"] = qb.result()
    out["world"] = wd.result()
    out["enabled"] = True
    out["host"] = PLEX.get("name", "plex")
    out["addr"] = urllib.parse.urlsplit(PLEX_URL).hostname
    out["ts"] = time.time()
    return out

# ---------------- Network: every device as the router sees it ----------------
ROUTER_FILE = CFG.get("router_file", "/mnt/host-temps/router.json")   # written by orrery-router.service on the host (forced-command SSH)

def _guest_ips():
    """{ip: guest name} for LXC guests (static addresses never show a DHCP name on the router)."""
    def build():
        out = {}
        res = pve_get("cluster/resources", "type=vm", 60)
        for g in res if isinstance(res, list) else []:
            if g.get("type") != "lxc" or g.get("status") != "running":
                continue
            ifs = pve_get(f"nodes/{g.get('node', NODE)}/lxc/{g['vmid']}/interfaces", "", 600)
            for i in ifs if isinstance(ifs, list) else []:
                for a in [i.get("inet")] + [x.get("ip-address") for x in (i.get("ip-addresses") or [])]:
                    if a and not a.startswith("127."):
                        out[a.split("/")[0]] = g.get("name")
        return out
    return cached("net:guests", 600, build)

def _ph_clients():
    def build():
        tot = ph_get("/stats/top_clients?count=400")
        blk = ph_get("/stats/top_clients?blocked=true&count=400")
        out = {}
        for x in tot.get("clients") or []:
            out.setdefault(x.get("ip"), {})["q"] = x.get("count"); out[x.get("ip")]["n"] = x.get("name") or ""
        for x in blk.get("clients") or []:
            out.setdefault(x.get("ip"), {})["b"] = x.get("count")
        return out
    return cached("net:ph", 60, build) if PH.get("url") else {}

def net_bundle():
    _nv_start()
    try:
        with open(ROUTER_FILE) as f:
            R = json.load(f)
    except Exception as e:
        return {"enabled": False, "__error": f"router snapshot unavailable ({e.__class__.__name__})"}
    stale = time.time() - R.get("ts", 0) > 90
    ph, flows = _ph_clients(), nv_ip_totals()
    gips = _guest_ips()
    if not isinstance(ph, dict) or "__error" in ph: ph = {}
    if not isinstance(gips, dict) or "__error" in gips: gips = {}
    devs = R.get("devices") or []
    for d in devs:
        ip = d.get("ip") or ""
        if not d.get("name"):
            d["name"] = gips.get(ip) or ((ph.get(ip) or {}).get("n") or "").split(".")[0] or ""
        if ip in gips: d["guest"] = gips[ip]
        if ip in ph: d["dns"] = ph[ip]
        if ip in flows: d["net"] = flows[ip]
    tot = {"o5": sum(f["o5"] for f in flows.values()), "i5": sum(f["i5"] for f in flows.values()),
           "span": min(3600, time.time() - _nv["since"]) if _nv["since"] else 0}
    return {"enabled": True, "stale": stale, "err": R.get("err"), "ts": R.get("ts"), "router": R.get("router"),
            "nodes": R.get("nodes") or [], "devices": devs, "flows": tot, "flowsOk": _nv["ok"], "flowsSince": _nv["since"], "hostIp": PVE_HOST}

# ---------------- Planet traits: per-service integrations (all read-only use) ----------------
TR = CFG.get("traits") or {}
UUID_RX = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
ROMM_IMG_RX = re.compile(r"^/assets/romm/resources/[\w./ %()\[\]'!,&+-]+\.(png|jpe?g|webp)$", re.I)

def cached(key, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    try:
        data = fn()
    except urllib.error.HTTPError as e:
        data = {"__error": f"HTTP {e.code}"}
    except Exception as e:
        data = {"__error": str(e)[:160]}
    with _lock:
        _cache[key] = (now, data)
    return data

def http_json(url, headers=None, body=None, method=None, timeout=5):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}

# --- Pi-hole v6 (app password → session id, re-login on 401)
PH = TR.get("pihole") or {}
_ph = {"sid": None, "lock": threading.Lock()}

def ph_get(path):
    def once():
        if not _ph["sid"]:
            s = http_json(PH["url"].rstrip("/") + "/api/auth", body={"password": PH["password"]}, method="POST")
            _ph["sid"] = (s.get("session") or {}).get("sid")
            if not _ph["sid"]:
                raise RuntimeError("pihole auth refused")
        return http_json(PH["url"].rstrip("/") + "/api" + path, headers={"X-FTL-SID": _ph["sid"]})
    with _ph["lock"]:
        try:
            return once()
        except urllib.error.HTTPError as e:
            if e.code != 401:
                raise
            _ph["sid"] = None
            return once()

def pihole_trait():
    if not PH.get("url"):
        return None
    s = cached("ph:sum", 5, lambda: ph_get("/stats/summary"))
    if "__error" in s:
        return {"__error": s["__error"]}
    q = s.get("queries") or {}
    rec = cached("ph:rec", 2.5, lambda: ph_get("/queries?length=60&upstream=blocklist"))
    top = cached("ph:top", 60, lambda: ph_get("/stats/top_domains?blocked=true&count=5"))
    cli = cached("ph:cli", 60, lambda: ph_get("/stats/top_clients?blocked=true&count=5"))
    return {"total": q.get("total"), "blocked": q.get("blocked"), "pct": q.get("percent_blocked"), "freq": q.get("frequency"),
            "gravity": (s.get("gravity") or {}).get("domains_being_blocked"), "clients": (s.get("clients") or {}).get("active"),
            "recent": [{"id": x.get("id"), "t": x.get("time"), "d": x.get("domain"), "c": (x.get("client") or {}).get("name") or (x.get("client") or {}).get("ip")}
                       for x in (rec.get("queries") or [])] if isinstance(rec, dict) else [],
            "top": [[x.get("domain"), x.get("count")] for x in (top.get("domains") or [])] if isinstance(top, dict) else [],
            "topClients": [[x.get("name") or x.get("ip"), x.get("count")] for x in (cli.get("clients") or [])] if isinstance(cli, dict) else []}

# --- NetViz: a background WebSocket listener keeps a short memory of blocks and a geo sample of flows
NV = TR.get("netviz") or {}
NV_HOME = [39.83, -98.58]   # where globe arcs land unless traits.netviz.home = [lat, lon] is set
MEDIA_IP = (CFG.get("media") or {}).get("ip") or ""   # LAN IP of the media-server PC, so remote sessions to it point at the giant

def _private(ip):
    try:
        a = ipaddress.ip_address(ip)
        return a.version == 4 and a.is_private
    except ValueError:
        return False
_nv = {"seq": 0, "ev": [], "flows": 0, "bytes": 0, "win": [], "ok": False, "err": None, "since": 0, "lock": threading.Lock()}
# per-LAN-IP internet *connections*: one dict per minute, last 60 minutes. [outbound, inbound] flow records.
# (the router's hardware acceleration offloads established flows, so softflowd sees connection starts, not volume)
_nvip = {"cur": {}, "t0": 0.0, "ring": []}
FLOW_RX = re.compile(rb'"s":\s*"([\d.]+)",\s*"d":\s*"([\d.]+)",\s*"b":\s*(\d+)')
_LANP = (NV.get("lan_prefix") or (PVE_HOST.rsplit(".", 1)[0] + "." if PVE_HOST.count(".") == 3 else "192.168.")).encode()

def _nv_account(raw):
    m = FLOW_RX.search(raw)
    if not m:
        return
    src, dst, b = m.group(1), m.group(2), int(m.group(3))
    pre = _LANP
    now = time.time()
    with _nv["lock"]:
        if now - _nvip["t0"] >= 60:
            if _nvip["t0"]:
                _nvip["ring"].append((_nvip["t0"], _nvip["cur"])); _nvip["ring"] = _nvip["ring"][-60:]
            _nvip["cur"], _nvip["t0"] = {}, now - (now % 60)
        if src.startswith(pre) and not dst.startswith(pre):
            r = _nvip["cur"].setdefault(src.decode(), [0, 0]); r[0] += 1
        elif dst.startswith(pre) and not src.startswith(pre):
            r = _nvip["cur"].setdefault(dst.decode(), [0, 0]); r[1] += 1

def nv_ip_totals():
    """{ip: {"o5","i5" (flows in the last 5 min), "o60","i60" (last hour)}}"""
    now = time.time()
    with _nv["lock"]:
        ring = list(_nvip["ring"]) + [(_nvip["t0"], dict(_nvip["cur"]))]
    out = {}
    for t0, dct in ring:
        recent = t0 >= now - 300
        for ip, (u, d) in dct.items():
            o = out.setdefault(ip, {"o5": 0, "i5": 0, "o60": 0, "i60": 0})
            o["o60"] += u; o["i60"] += d
            if recent:
                o["o5"] += u; o["i5"] += d
    return out

def _ws_messages(host, port, path="/"):
    import base64, socket, struct
    s = socket.create_connection((host, port), timeout=60)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://{host}:{port}\r\n\r\n").encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        c = s.recv(4096)
        if not c: raise ConnectionError("closed during handshake")
        buf += c
    head, buf = buf.split(b"\r\n\r\n", 1)
    if b" 101 " not in head.split(b"\r\n")[0]:
        raise ConnectionError(head.split(b"\r\n")[0].decode(errors="replace"))
    def need(n):
        nonlocal buf
        while len(buf) < n:
            c = s.recv(65536)
            if not c: raise ConnectionError("closed")
            buf += c
        out, buf = buf[:n], buf[n:]
        return out
    frag = b""
    while True:
        b1, b2 = need(2)
        op, ln = b1 & 0x0F, b2 & 0x7F
        if ln == 126: ln = struct.unpack(">H", need(2))[0]
        elif ln == 127: ln = struct.unpack(">Q", need(8))[0]
        mask = need(4) if b2 & 0x80 else None
        data = need(ln)
        if mask: data = bytes(x ^ mask[i % 4] for i, x in enumerate(data))
        if op == 0x9:                       # ping → masked pong
            m = os.urandom(4)
            s.sendall(bytes([0x8A, 0x80 | len(data)]) + m + bytes(x ^ m[i % 4] for i, x in enumerate(data)))
            continue
        if op == 0x8: raise ConnectionError("server closed")
        if op in (0x0, 0x1, 0x2):
            frag += data
            if b1 & 0x80:
                yield frag; frag = b""

def _nv_loop():
    host, port = NV["host"], int(NV.get("port", 8099))
    home = NV.get("home") or NV_HOME
    while True:
        try:
            tick, nflow = time.time(), 0
            for raw in _ws_messages(host, port):
                with _nv["lock"]:
                    _nv["ok"], _nv["err"] = True, None
                if b'"block"' not in raw:
                    _nv_account(raw)
                    nflow += 1
                    # flows: count them all, keep ~1 in 40 that are geolocated off-site as globe pings
                    if nflow % 40 or b'"dll"' not in raw:
                        with _nv["lock"]:
                            _nv["flows"] += 1
                        continue
                try:
                    w = json.loads(raw)
                except ValueError:
                    continue
                k = w.get("k")
                # the far end is whichever side is not this site (NetViz marks home as country "--")
                far, cc = (w.get("dll"), w.get("dc")) if w.get("sc") in (None, "--") else (w.get("sll"), w.get("sc"))
                if not far or list(far) == list(home):
                    continue
                with _nv["lock"]:
                    if k == "flow":
                        _nv["flows"] += 1
                    _nv["seq"] += 1
                    _nv["ev"].append({"n": _nv["seq"], "k": "b" if k == "block" else "f", "t": w.get("t"), "ll": far, "cc": cc,
                                      "p": w.get("p"), "dp": w.get("dp"), "pr": w.get("pr"), "ip": w.get("d") if k == "block" else None})
                    if len(_nv["ev"]) > 600:
                        del _nv["ev"][:200]
                now = time.time()
                if now - tick >= 5:
                    with _nv["lock"]:
                        _nv["win"].append((now, _nv["flows"])); _nv["win"] = _nv["win"][-24:]
                    tick = now
        except Exception as e:
            with _nv["lock"]:
                _nv["ok"], _nv["err"] = False, str(e)[:120]
            time.sleep(10)

def _nv_start():
    if NV.get("host") and not _nv["since"]:
        _nv["since"] = time.time()
        threading.Thread(target=_nv_loop, name="netviz-ws", daemon=True).start()

def netviz_trait(since):
    if not NV.get("host"):
        return None
    _nv_start()
    st = cached("nv:stats", 20, lambda: http_json(f"http://{NV['host']}:{int(NV.get('port', 8099))}/stats.json"))
    with _nv["lock"]:
        evs = [e for e in _nv["ev"] if e["n"] > since]
        win = list(_nv["win"])
        out = {"ok": _nv["ok"], "err": _nv["err"], "seq": _nv["seq"], "home": NV.get("home") or NV_HOME}
    blocks = [e for e in evs if e["k"] == "b"][-40:]
    flows = [e for e in evs if e["k"] == "f"][-60:]
    rate = (win[-1][1] - win[0][1]) / (win[-1][0] - win[0][0]) * 60 if len(win) >= 2 and win[-1][0] > win[0][0] else None
    if isinstance(st, dict) and "__error" not in st:
        b = st.get("blocks") or {}
        out.update({"blocks24": b.get("total"), "top": [[x.get("cc"), x.get("n"), x.get("spark")] for x in (b.get("top") or [])],
                    "fpm": (st.get("netflow") or {}).get("flows_per_min")})
    out.update({"blocks": blocks, "flows": flows, "fpmLive": rate})
    return out

# --- Audiobookshelf: open listening sessions (active = synced in the last 90 s)
AB = TR.get("abs") or {}

def abs_trait():
    if not AB.get("url"):
        return None
    hdr = {"Authorization": "Bearer " + AB["token"]}
    on = cached("abs:on", 3, lambda: http_json(AB["url"].rstrip("/") + "/api/users/online", hdr))
    if "__error" in on:
        return {"__error": on["__error"]}
    users = cached("abs:users", 600, lambda: http_json(AB["url"].rstrip("/") + "/api/users", hdr))
    names = {u.get("id"): u.get("username") for u in (users.get("users") or [])} if isinstance(users, dict) else {}
    now = time.time() * 1000
    ss = []
    for s in on.get("openSessions") or []:
        age = (now - (s.get("updatedAt") or 0)) / 1000
        if age > 90:
            continue
        ss.append({"id": s.get("id"), "user": names.get(s.get("userId"), "listener"), "title": s.get("displayTitle"),
                   "author": s.get("displayAuthor"), "cur": s.get("currentTime"), "dur": s.get("duration"),
                   "item": s.get("libraryItemId"), "player": s.get("mediaPlayer"), "age": round(age), "type": s.get("mediaType")})
    rec = cached("abs:recent", 60, lambda: http_json(AB["url"].rstrip("/") + "/api/sessions?itemsPerPage=40&page=0&sort=updatedAt&desc=1", hdr))
    recent, seen = [], set()
    for s in (rec.get("sessions") or []) if isinstance(rec, dict) else []:
        k = (s.get("userId"), s.get("libraryItemId"))
        if k in seen:
            continue
        seen.add(k); dur = s.get("duration") or 0
        recent.append({"user": names.get(s.get("userId"), "listener"), "title": s.get("displayTitle"), "author": s.get("displayAuthor"),
                       "t": round((s.get("updatedAt") or 0) / 1000), "pct": round(100 * (s.get("currentTime") or 0) / dur) if dur else None,
                       "secs": s.get("timeListening") or 0})
        if len(recent) >= 6:
            break
    return {"sessions": ss, "recent": recent, "sessionsTotal": rec.get("total") if isinstance(rec, dict) else None}

# --- RomM: who is playing what (activity = live play sessions across users)
RM = TR.get("romm") or {}

def romm_trait():
    if not RM.get("url"):
        return None
    hdr = {"Authorization": "Bearer " + RM["token"]}
    act = cached("romm:act", 4, lambda: http_json(RM["url"].rstrip("/") + "/api/activity", hdr))
    if isinstance(act, dict) and "__error" in act:
        return {"__error": act["__error"]}
    st = cached("romm:stats", 300, lambda: http_json(RM["url"].rstrip("/") + "/api/stats", hdr))
    return {"playing": [{"user": a.get("username"), "rom": a.get("rom_name"), "rom_id": a.get("rom_id"), "platform": a.get("platform_name"),
                         "cover": a.get("rom_cover_path") or "", "device": a.get("device_type"), "since": a.get("started_at")} for a in act or []],
            "recent": ((_probe() or {}).get("romm") or {}).get("recent") or [],
            "roms": (st or {}).get("ROMS") if isinstance(st, dict) else None, "platforms": (st or {}).get("PLATFORMS") if isinstance(st, dict) else None}

# --- Immich: library size, ML/transcode queues, "on this day" memories, and every place a photo was taken
IM = TR.get("immich") or {}

def immich_trait():
    if not IM.get("url"):
        return None
    base, hdr = IM["url"].rstrip("/") + "/api", {"x-api-key": IM["token"]}
    st = cached("im:stats", 60, lambda: http_json(base + "/server/statistics", hdr))
    if "__error" in st:
        return {"__error": st["__error"]}
    qs = cached("im:queues", 4, lambda: http_json(base + "/queues", hdr))
    queues = {q.get("name"): {"active": (q.get("statistics") or {}).get("active", 0), "waiting": (q.get("statistics") or {}).get("waiting", 0)}
              for q in qs} if isinstance(qs, list) else {}
    def mem():
        now = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
        out = []
        for m in http_json(base + "/memories", hdr, timeout=10):
            if m.get("type") != "on_this_day" or not (m.get("showAt", "") <= now + "Z" <= m.get("hideAt", "~")):
                continue
            ids = [a.get("id") for a in (m.get("assets") or []) if a.get("type") == "IMAGE"][:9]
            if ids:
                out.append({"year": (m.get("data") or {}).get("year"), "n": len(m.get("assets") or []), "ids": ids})
        return sorted(out, key=lambda x: -(x["year"] or 0))[:6]
    mems = cached("im:mem", 900, mem)
    def places():
        bins, cities = {}, {}
        for p in http_json(base + "/map/markers", hdr, timeout=20):
            la, lo = p.get("lat"), p.get("lon")
            if la is None or lo is None:
                continue
            k = (round(la * 2) / 2, round(lo * 2) / 2)          # 0.5° cells
            bins[k] = bins.get(k, 0) + 1
            c = p.get("city")
            if c: cities[c] = cities.get(c, 0) + 1
        pts = sorted(([k[0], k[1], n] for k, n in bins.items()), key=lambda x: -x[2])[:900]
        return {"pts": pts, "geo": sum(bins.values()), "cells": len(bins), "cities": len(cities),
                "top": sorted(cities.items(), key=lambda x: -x[1])[:5]}
    pl = cached("im:places", 3600, places)
    ppl = cached("im:people", 900, lambda: http_json(base + "/people?size=1", hdr))
    def recent():
        r = http_json(base + "/search/metadata", hdr, body={"size": 12, "order": "desc", "withDeleted": False}, method="POST", timeout=10)
        return [{"id": a.get("id"), "t": a.get("localDateTime") or a.get("fileCreatedAt"), "video": a.get("type") == "VIDEO"}
                for a in ((r.get("assets") or {}).get("items") or [])]
    rec = cached("im:recent", 120, recent) if IM.get("photos", True) else []
    return {"photos": st.get("photos"), "videos": st.get("videos"), "usage": st.get("usage"), "queues": queues,
            "memories": mems if isinstance(mems, list) else [], "places": pl if isinstance(pl, dict) and "__error" not in pl else None,
            "people": (ppl or {}).get("total") if isinstance(ppl, dict) else None, "photosOn": IM.get("photos", True),
            "recent": rec if isinstance(rec, list) else []}

# --- Backups (vzdump → PBS) from the PVE task log: live progress + age of each guest's last good backup
VZ_START = re.compile(r"Starting Backup of VM (\d+)")
VZ_DONE = re.compile(r"Finished Backup of VM (\d+)")
VZ_FAIL = re.compile(r"ERROR: Backup of VM (\d+) failed")
VZ_PCT = re.compile(r"INFO:\s+(\d+)% \(([\d.]+ \w+) of ([\d.]+ \w+)\).*?write: ([\d.]+ \w+/s)")
VZ_JOB = re.compile(r"vzdump ((?:\d+ ?)+)")

def task_lines(upid, ttl):
    d = pve_get(f"nodes/{NODE}/tasks/{urllib.parse.quote(upid, safe='')}/log", "start=0&limit=5000", ttl)
    return [x.get("t", "") for x in d] if isinstance(d, list) else []

def backup_trait():
    # the node's own task list keeps vzdump history (cluster/tasks only holds the last ~50 tasks of any type)
    tasks = pve_get(f"nodes/{NODE}/tasks", "typefilter=vzdump&limit=6&source=all", 5)
    if not isinstance(tasks, list):
        return None
    vz = sorted([t for t in tasks if t.get("type") == "vzdump"], key=lambda t: t.get("starttime", 0), reverse=True)
    out = {"running": None, "last": {}, "failed": []}
    for t in vz[:6]:
        live = not t.get("endtime")
        lines = task_lines(t["upid"], 3 if live else 900)
        if live and out["running"] is None:
            m = next((VZ_JOB.search(l) for l in lines if VZ_JOB.search(l)), None)
            ids = [int(x) for x in m.group(1).split()] if m else []
            cur = next((int(VZ_START.search(l).group(1)) for l in reversed(lines) if VZ_START.search(l)), None)
            done = [int(VZ_DONE.search(l).group(1)) for l in lines if VZ_DONE.search(l)]
            pct = None
            for l in reversed(lines):
                if VZ_START.search(l): break
                p = VZ_PCT.search(l)
                if p: pct = {"pct": int(p.group(1)), "of": p.group(3), "rate": p.group(4)}; break
            out["running"] = {"upid": t["upid"], "ids": ids, "cur": cur if cur not in done else None, "done": done, "pct": pct,
                              "started": t.get("starttime")}
        end = t.get("endtime") or time.time()
        for l in lines:
            d = VZ_DONE.search(l)
            if d and int(d.group(1)) not in out["last"]:
                out["last"][int(d.group(1))] = end
            f = VZ_FAIL.search(l)
            if f and not live:
                out["failed"].append(int(f.group(1)))
    return out


# ---------------------------------------------------------------- the quiet bodies: one live signal each (read-only)
LINKS = CFG.get("links") or {}   # optional: {"wiki": "http://wiki.lan:3000"} makes recent wiki edits clickable
PROBE_FILE = CFG.get("probe_file", "/mnt/host-temps/probe.json")   # orrery-probe.service on the host: npm requests, guac sockets, wiki edits
KU, PL, SE, TA, HA = (TR.get(k) or {} for k in ("kuma", "paperless", "seerr", "tracearr", "ha"))
_viewers = {}

def _probe():
    try:
        with open(PROBE_FILE) as f:
            d = json.load(f)
        return d if time.time() - d.get("ts", 0) < 60 else None
    except Exception:
        return None

def _iso(t):
    try:
        return time.mktime(time.strptime(t[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
    except Exception:
        return None

def kuma_svc():
    if not KU.get("url"):
        return None
    def build():
        req = urllib.request.Request(KU["url"].rstrip("/") + "/metrics", headers={"Authorization": "Basic " + base64.b64encode((":" + KU["key"]).encode()).decode()})
        with urllib.request.urlopen(req, timeout=6) as r:
            txt = r.read().decode(errors="replace")
        mons = {}
        lab = lambda x: dict(re.findall(r'(\w+)="([^"]*)"', x))
        for m in re.finditer(r'^monitor_status\{([^}]*)\}\s+([-\d.e+]+)$', txt, re.M):
            L = lab(m.group(1)); mons[L.get("monitor_id")] = {"name": L.get("monitor_name"), "type": L.get("monitor_type"), "status": int(float(m.group(2)))}
        for m in re.finditer(r'^monitor_response_time\{([^}]*)\}\s+([-\d.e+]+)$', txt, re.M):
            L = lab(m.group(1))
            if L.get("monitor_id") in mons: mons[L["monitor_id"]]["ms"] = round(float(m.group(2)))
        for m in re.finditer(r'^monitor_uptime_ratio\{([^}]*)\}\s+([-\d.e+]+)$', txt, re.M):
            L = lab(m.group(1))
            if L.get("monitor_id") in mons and L.get("window") == "1d": mons[L["monitor_id"]]["up24"] = float(m.group(2))
        ms = sorted(mons.values(), key=lambda x: (x["status"] == 1, x["name"] or ""))
        return {"monitors": ms, "up": sum(m["status"] == 1 for m in ms), "down": sum(m["status"] == 0 for m in ms), "pending": sum(m["status"] == 2 for m in ms)}
    return cached("svc:kuma", 10, build)

def paperless_svc():
    if not PL.get("url"):
        return None
    u, h = PL["url"].rstrip("/"), {"Authorization": "Token " + PL["token"]}
    st = cached("svc:pl:st", 30, lambda: http_json(u + "/api/statistics/", h))
    docs = cached("svc:pl:docs", 12, lambda: http_json(u + "/api/documents/?ordering=-added&page_size=6&fields=id,title,added,created", h))
    tasks = cached("svc:pl:tasks", 8, lambda: http_json(u + "/api/tasks/?status=STARTED", h))
    if "__error" in st:
        return {"__error": st["__error"]}
    tl = tasks if isinstance(tasks, list) else (tasks.get("results") or []) if isinstance(tasks, dict) else []
    return {"total": st.get("documents_total"), "inbox": st.get("documents_inbox"), "chars": st.get("character_count"),
            "recent": [{"id": d.get("id"), "title": d.get("title"), "added": _iso(d.get("added") or "")} for d in (docs.get("results") or [])] if isinstance(docs, dict) else [],
            "busy": [t.get("task_file_name") for t in tl][:4]}

def seerr_svc():
    if not SE.get("url"):
        return None
    u, h = SE["url"].rstrip("/"), {"X-Api-Key": SE["key"]}
    cnt = cached("svc:se:c", 20, lambda: http_json(u + "/api/v1/request/count", h))
    req = cached("svc:se:r", 20, lambda: http_json(u + "/api/v1/request?take=8&skip=0&sort=added&filter=all", h))
    if "__error" in cnt:
        return {"__error": cnt["__error"]}
    out = []
    for r in (req.get("results") or [])[:8] if isinstance(req, dict) else []:
        md = r.get("media") or {}; kind = md.get("mediaType") or r.get("type"); tid = md.get("tmdbId")
        info = cached(f"svc:se:t:{kind}:{tid}", 86400, lambda: http_json(f"{u}/api/v1/{'tv' if kind == 'tv' else 'movie'}/{tid}", h)) if tid else {}
        out.append({"id": r.get("id"), "status": r.get("status"), "media": md.get("status"), "kind": kind, "t": _iso(r.get("createdAt") or ""),
                    "who": (r.get("requestedBy") or {}).get("displayName"), "title": info.get("title") or info.get("name") or "?",
                    "year": (info.get("releaseDate") or info.get("firstAirDate") or "")[:4], "poster": info.get("posterPath")})
    return {"count": cnt, "recent": out}

def tracearr_svc():
    if not TA.get("url"):
        return None
    u, h = TA["url"].rstrip("/"), {"Authorization": "Bearer " + TA["token"]}
    st = cached("svc:ta:st", 4, lambda: http_json(u + "/api/v1/public/streams", h))
    today = cached("svc:ta:td", 30, lambda: http_json(u + "/api/v1/public/stats/today", h))
    vio = cached("svc:ta:v", 60, lambda: http_json(u + "/api/v1/public/violations?pageSize=5", h))
    hist = cached("svc:ta:h", 60, lambda: http_json(u + "/api/v1/public/history?pageSize=6", h))
    if "__error" in today:
        return {"__error": today["__error"]}
    def who(x):
        us = x.get("user") if isinstance(x.get("user"), dict) else {}
        return us.get("displayName") or us.get("username") or x.get("displayName") or x.get("username") or x.get("userName") or "?"
    def title(x):
        return f"{x.get('showTitle')} · S{x.get('seasonNumber')}E{x.get('episodeNumber')}" if x.get("showTitle") else x.get("mediaTitle")
    def geo(x):
        g = x.get("geo") if isinstance(x.get("geo"), dict) else x
        return {k: g.get(k2) for k, k2 in (("city", "geoCity"), ("country", "geoCountry"), ("lat", "geoLat"), ("lon", "geoLon")) if g.get(k2) is not None} or \
               {k: g.get(k) for k in ("city", "country", "lat", "lon") if g.get(k) is not None}
    streams = [{"who": who(x), "title": title(x), "state": x.get("state"), "tx": x.get("isTranscode"), "device": x.get("device") or x.get("platform"), **geo(x)}
               for x in (st.get("data") or [])] if isinstance(st, dict) else []
    return {"today": today, "streams": streams, "violations": (vio.get("meta") or {}).get("total", 0) if isinstance(vio, dict) else 0,
            "recentV": [{"who": who(v), "rule": v.get("ruleName") or v.get("type") or v.get("rule"), "sev": v.get("severity")} for v in (vio.get("data") or [])][:5] if isinstance(vio, dict) else [],
            "history": [{"who": who(x), "title": title(x), "t": _iso(x.get("startedAt") or "")} for x in (hist.get("data") or [])] if isinstance(hist, dict) else []}

def netdata_svc():
    if not ND.get("url"):
        return None
    base = ND["url"].rstrip("/")
    info = cached("svc:nd:i", 30, lambda: http_json(base + "/api/v1/info"))
    al = cached("svc:nd:a", 10, lambda: http_json(base + "/api/v1/alarms"))
    if "__error" in info:
        return {"__error": info["__error"]}
    alarms = [{"name": v.get("name") or k, "chart": v.get("chart"), "status": v.get("status"), "value": v.get("value_string"), "host": v.get("hostname") or info.get("mirrored_hosts", ["?"])[0]}
              for k, v in ((al.get("alarms") or {}).items() if isinstance(al, dict) else [])]
    return {"hosts": info.get("mirrored_hosts") or [], "counts": info.get("alarms") or {}, "alarms": alarms[:8], "version": info.get("version")}

def ha_svc():
    if not HA.get("url"):
        return None
    def build():
        S_ = http_json(HA["url"].rstrip("/") + "/api/states", {"Authorization": "Bearer " + HA["token"]}, timeout=8)
        if isinstance(S_, dict):
            return S_
        now = time.time(); A = lambda x: x.get("attributes") or {}; nm = lambda x: A(x).get("friendly_name") or x["entity_id"]
        lights = [x for x in S_ if x["entity_id"].startswith("light.") and not A(x).get("entity_id")]   # skip light groups
        dc = lambda x, *c: A(x).get("device_class") in c
        bs = [x for x in S_ if x["entity_id"].startswith("binary_sensor.")]
        autos = sorted(((nm(x), _iso(A(x).get("last_triggered") or "") or 0) for x in S_ if x["entity_id"].startswith("automation.")), key=lambda a: -a[1])
        temps = [(nm(x), x["state"]) for x in S_ if x["entity_id"].startswith("weather.")] or []
        clim = [{"name": nm(x), "cur": A(x).get("current_temperature"), "set": A(x).get("temperature"), "mode": x["state"], "act": A(x).get("hvac_action")} for x in S_ if x["entity_id"].startswith("climate.")]
        return {"lightsOn": sum(x["state"] == "on" for x in lights), "lights": len(lights),
                "lightsList": [nm(x) for x in lights if x["state"] == "on"][:12],
                "people": [{"name": nm(x), "state": x["state"]} for x in S_ if x["entity_id"].startswith("person.")],
                "media": [{"name": nm(x), "title": A(x).get("media_title"), "artist": A(x).get("media_artist")} for x in S_ if x["entity_id"].startswith("media_player.") and x["state"] == "playing"][:6],
                "motion": [nm(x) for x in bs if dc(x, "motion", "occupancy", "presence") and x["state"] == "on"][:8],
                "open": [nm(x) for x in bs if dc(x, "door", "garage_door", "window", "opening") and x["state"] == "on"][:8],
                "locks": [{"name": nm(x), "state": x["state"]} for x in S_ if x["entity_id"].startswith("lock.")],
                "autos": [{"name": a, "t": t} for a, t in autos[:6] if t], "lastAuto": autos[0][1] if autos else 0,
                "weather": [{"name": n, "state": st, "temp": next((A(x).get("temperature") for x in S_ if nm(x) == n), None)} for n, st in temps][:1],
                "climate": clim[:3], "entities": len(S_)}
    return cached("svc:ha", 6, build)

def ipmap():
    """{ip: guest name} — LXC addresses from Proxmox, VM addresses from the router's client list."""
    m = dict(_guest_ips() if isinstance(_guest_ips(), dict) and "__error" not in _guest_ips() else {})
    try:
        with open(ROUTER_FILE) as f:
            devs = json.load(f).get("devices") or []
        res = pve_get("cluster/resources", "type=vm", 60)
        names = {g.get("name", "").lower(): g.get("name") for g in res} if isinstance(res, list) else {}
        for d in devs:
            n = (d.get("name") or "").lower()
            if d.get("ip") and n in names and d["ip"] not in m:
                m[d["ip"]] = names[n]
        if PVE_HOST: m.setdefault(PVE_HOST, "__host__")
        if MEDIA_IP: m.setdefault(MEDIA_IP, "__media__")
        m = {ip: n for ip, n in m.items() if _private(ip)}
    except Exception:
        pass
    return m

def svc_bundle():
    jobs = {k: POOL.submit(f) for k, f in (("kuma", kuma_svc), ("paperless", paperless_svc), ("seerr", seerr_svc), ("tracearr", tracearr_svc),
                                           ("netdata", netdata_svc), ("ha", ha_svc))}
    out = {k: f.result() for k, f in jobs.items()}
    pr = _probe() or {}
    out["npm"], out["guac"], out["wiki"] = pr.get("npm"), pr.get("guac"), pr.get("wiki")
    if isinstance(out.get("wiki"), dict) and LINKS.get("wiki"):
        out["wiki"] = {**out["wiki"], "base": LINKS["wiki"].rstrip("/")}
    out["ipmap"] = cached("svc:ipmap", 120, ipmap)
    now = time.time()
    for ip in [ip for ip, t in _viewers.items() if now - t > 20]:
        _viewers.pop(ip, None)
    out["orrery"] = {"viewers": len(_viewers)}
    return out

def traits_bundle(since=0):
    names = {"pihole": "pihole", "netviz": "netviz", "abs": "audiobookshelf", "romm": "romm", "pbs": "pbs", "immich": "immich", **(TR.get("names") or {}), **nextapi.trait_names()}
    jobs = {"pihole": POOL.submit(pihole_trait), "abs": POOL.submit(abs_trait), "romm": POOL.submit(romm_trait),
            "backup": POOL.submit(backup_trait), "immich": POOL.submit(immich_trait)}
    out = {k: f.result() for k, f in jobs.items()}
    out["netviz"] = netviz_trait(since)
    try:
        out["svc"] = svc_bundle()
    except Exception as e:
        out["svc"] = {"__error": str(e)[:160]}
    out["names"] = names
    out["ts"] = time.time()
    return out

def trait_img(kind, ident, size="thumbnail"):
    if kind == "abs" and AB.get("url") and UUID_RX.match(ident):
        url, hdr = f"{AB['url'].rstrip('/')}/api/items/{ident}/cover?width=240&format=jpeg", {"Authorization": "Bearer " + AB["token"]}
    elif kind == "romm" and RM.get("url") and ROMM_IMG_RX.match(ident) and ".." not in ident:
        url, hdr = RM["url"].rstrip("/") + urllib.parse.quote(ident), {"Authorization": "Bearer " + RM["token"]}
    elif kind == "paperless" and PL.get("url") and ident.isdigit():
        url, hdr = f"{PL['url'].rstrip('/')}/api/documents/{ident}/thumb/", {"Authorization": "Token " + PL["token"]}
    elif kind == "immich" and IM.get("url") and IM.get("photos", True) and UUID_RX.match(ident):
        size = size if size in ("thumbnail", "preview") else "thumbnail"
        url, hdr = f"{IM['url'].rstrip('/')}/api/assets/{ident}/thumbnail?size={size}", {"x-api-key": IM["token"]}
    else:
        return None
    with urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=15) as r:
        return r.read(), r.headers.get("Content-Type", "image/jpeg")

import nextapi
nextapi.init(pve_get, NODE, os.path.dirname(os.path.abspath(CFG_PATH)), CFG)

class H(BaseHTTPRequestHandler):
    server_version = "Orrery/1.0"
    def log_message(self, *a): pass

    def send(self, code, body, ctype="application/json", cache="no-store"):
        if isinstance(body, (dict, list)) or body is None:
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", cache)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        p = u.path
        r = nextapi.get(p, u.query)
        if r:
            return self.send(*r)
        if p == "/api/bundle":
            _viewers[self.headers.get("X-Forwarded-For") or self.client_address[0]] = time.time()
            return self.send(200, bundle())
        if p == "/api/plex":
            if not nextapi.settings()["media"]["enabled"]:
                return self.send(200, {"enabled": False, "reason": "media world switched off in Setup"})
            return self.send(200, plex_bundle())
        if p == "/api/net":
            return self.send(200, net_bundle())
        if p == "/api/traits":
            q = urllib.parse.parse_qs(u.query)
            try: since = int((q.get("nv") or ["0"])[0])
            except ValueError: since = 0
            return self.send(200, traits_bundle(since))
        if p == "/api/traits/img":
            q = urllib.parse.parse_qs(u.query)
            try:
                r = trait_img((q.get("k") or [""])[0], (q.get("id") or [""])[0], (q.get("s") or ["thumbnail"])[0])
            except Exception as e:
                return self.send(502, {"error": str(e)[:120]})
            if not r:
                return self.send(400, {"error": "bad image request"})
            return self.send(200, r[0], r[1] or "image/jpeg", "public, max-age=86400")
        if p == "/api/plex/img":
            q = urllib.parse.parse_qs(u.query)
            src = (q.get("p") or [""])[0]
            w = max(40, min(600, int((q.get("w") or ["200"])[0] or 200)))
            h = max(40, min(900, int((q.get("h") or ["300"])[0] or 300)))
            if not PLEX_URL or not IMG_RX.match(src) or not host_up(PLEX_URL):
                return self.send(400, {"error": "bad image path"})
            try:
                body, ct = plex_raw(f"/photo/:/transcode?width={w}&height={h}&minSize=1&upscale=1&url={urllib.parse.quote(src)}",
                                    accept="image/*", timeout=10)
                return self.send(200, body, ct or "image/jpeg", "public, max-age=86400")
            except Exception as e:
                return self.send(502, {"error": str(e)})
        if p.startswith("/api/"):
            sub = p[5:]
            if not any(rx.match(sub) for rx in ALLOW):
                return self.send(403, {"error": "not in whitelist"})
            ttl = 30 if "rrddata" in sub else (60 if ("disks" in sub or "apt" in sub or "config" in sub) else 3)
            return self.send(200, {"data": pve_get(sub, u.query, ttl)})
        f = "index.html" if p in ("/", "") else p.lstrip("/")
        fp = os.path.realpath(os.path.join(STATIC, f))
        if not fp.startswith(STATIC) or not os.path.isfile(fp):
            return self.send(404, "not found", "text/plain")
        ct = {"html": "text/html; charset=utf-8", "js": "text/javascript", "css": "text/css",
              "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "json": "application/json",
              "glb": "model/gltf-binary"}.get(fp.rsplit(".", 1)[-1], "application/octet-stream")
        mtime = int(os.path.getmtime(fp))
        lm = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime(mtime))
        if self.headers.get("If-Modified-Since") == lm:
            self.send_response(304); self.send_header("Last-Modified", lm); self.end_headers(); return
        cache = "public, max-age=604800, immutable" if f.startswith("vendor/") else "no-cache"
        with open(fp, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ct); self.send_header("Cache-Control", cache)
        self.send_header("Last-Modified", lm); self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(min(n, 65536)) if n else b""
        r = nextapi.post(urllib.parse.urlsplit(self.path).path, self.headers, body)
        return self.send(*(r or (405, {"error": "read-only"})))

    def do_PUT(self): self.send(405, {"error": "read-only"})
    do_DELETE = do_PUT

if __name__ == "__main__":
    print(f"Orrery listening on :{PORT} → {PVE} ({NODE})", flush=True)
    _nv_start()   # keep per-device flow accounting running even with no page open
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
