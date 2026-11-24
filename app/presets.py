"""Planet presets for other servers: what a machine IS decides how its planet looks and which checks count.

Every preset speaks the same status language (green / amber / red, Eden to Hellscape). On top of the machine
health from an agent (health.py), a preset can read the thing the machine is FOR: is the internet up, did last
night's backup run, are the cameras recording, is anyone on the game server.

  links   integrations the preset can read. Ones without secrets are tried automatically when the service is found.
  offline "alarm": a server that should always be on. "asleep": a desktop, laptop or printer that is allowed to sleep.

Each reader returns {"src", "checks": [...], "facts": {...}} where checks use health.assess's shape and facts feed
the planet's look. Everything is optional and cached for a few seconds.
"""
import base64, json, os, random, socket, ssl, struct, threading, time, urllib.error, urllib.parse, urllib.request

import health

# ---------------------------------------------------------------- presets
PRESETS = {
    "pc":      {"label": "Desktop / gaming PC", "group": "Computers", "offline": "asleep", "links": []},
    "laptop":  {"label": "Laptop", "group": "Computers", "offline": "asleep", "links": []},
    "generic": {"label": "Server / Pi", "group": "Computers", "offline": "alarm", "links": []},
    "media":   {"label": "Media server", "group": "Media & storage", "offline": "alarm", "links": []},
    "nas":     {"label": "NAS / storage", "group": "Media & storage", "offline": "alarm", "links": ["truenas"]},
    "backup":  {"label": "Backup server", "group": "Media & storage", "offline": "alarm", "links": ["pbs"]},
    "router":  {"label": "Router / firewall", "group": "Network", "offline": "alarm", "links": []},
    "dns":     {"label": "DNS / ad-blocker", "group": "Network", "offline": "alarm", "links": ["pihole", "adguard"]},
    "home":    {"label": "Home hub", "group": "Home", "offline": "alarm", "links": ["ha"]},
    "nvr":     {"label": "Cameras / NVR", "group": "Home", "offline": "alarm", "links": ["frigate"]},
    "game":    {"label": "Game server", "group": "Special", "offline": "alarm", "links": ["minecraft", "steam"]},
    "ai":      {"label": "AI / GPU box", "group": "Special", "offline": "alarm", "links": ["ollama"]},
    "printer": {"label": "3D printer", "group": "Special", "offline": "asleep", "links": ["moonraker", "octoprint"]},
}
TYPES = {k: v["label"] for k, v in PRESETS.items()}

# fields: (key, label, default, secret). {addr} is filled in with the machine's address.
LINKS = {
    "truenas":   {"label": "TrueNAS", "fields": [("url", "URL", "https://{addr}", False), ("key", "API key", "", True)],
                  "hint": "TrueNAS → your user → API Keys → Add"},
    "pbs":       {"label": "Proxmox Backup Server", "fields": [("url", "URL", "https://{addr}:8007", False), ("token", "API token", "", True)],
                  "hint": "Configuration → Access Control → API Token, with the DatastoreAudit role. Paste it as user@pbs!name=secret"},
    "pihole":    {"label": "Pi-hole", "fields": [("url", "URL", "http://{addr}", False), ("password", "App password", "", True)],
                  "hint": "Settings → Web interface / API → Configure app password"},
    "adguard":   {"label": "AdGuard Home", "fields": [("url", "URL", "http://{addr}", False), ("user", "Username", "", False), ("password", "Password", "", True)], "hint": ""},
    "ha":        {"label": "Home Assistant", "fields": [("url", "URL", "http://{addr}:8123", False), ("token", "Long-lived token", "", True)],
                  "hint": "Your profile → Security → Long-lived access tokens"},
    "frigate":   {"label": "Frigate", "fields": [("url", "URL", "http://{addr}:5000", False)], "hint": "The unauthenticated port (5000)", "auto": "frigate"},
    "ollama":    {"label": "Ollama", "fields": [("url", "URL", "http://{addr}:11434", False)], "hint": "", "auto": "ollama"},
    "moonraker": {"label": "Klipper (Moonraker)", "fields": [("url", "URL", "http://{addr}:7125", False)], "hint": "Mainsail and Fluidd both use Moonraker", "auto": "moonraker"},
    "octoprint": {"label": "OctoPrint", "fields": [("url", "URL", "http://{addr}", False), ("key", "API key", "", True)], "hint": "Settings → Application Keys"},
    "minecraft": {"label": "Minecraft", "fields": [("port", "Port", "25565", False)], "hint": "Java edition server list ping", "auto": "minecraft"},
    "steam":     {"label": "Steam game (Valheim, Rust, ARK…)", "fields": [("port", "Query port", "27015", False)], "hint": "The Steam query port, often game port + 1"},
}

# which group a service is listed under in a planet's panel
SERVICE_GROUP = {
    "plex": "Streaming", "jellyfin": "Streaming", "emby": "Streaming", "audiobookshelf": "Audio & books", "navidrome": "Audio & books",
    "seerr": "Requests", "sonarr": "Library automation", "radarr": "Library automation", "prowlarr": "Library automation",
    "qbittorrent": "Downloads", "transmission": "Downloads", "tracearr": "Watch stats", "immich": "Photos", "romm": "Games",
    "minecraft": "Games", "pihole": "DNS", "adguard": "DNS", "npm": "Proxy", "traefik": "Proxy", "caddy": "Proxy", "tailscale": "VPN",
    "netviz": "Network", "opnsense": "Network", "pfsense": "Network", "unifi": "Network", "openwrt": "Network",
    "homeassistant": "Home", "zigbee2mqtt": "Home", "mosquitto": "Home", "nodered": "Home", "frigate": "Cameras", "blueiris": "Cameras",
    "nextcloud": "Storage & sync", "truenas": "Storage & sync", "synology": "Storage & sync", "unraid": "Storage & sync", "syncthing": "Storage & sync",
    "pbs": "Backup", "paperless": "Documents", "wiki": "Documents", "vaultwarden": "Security", "authentik": "Security",
    "uptimekuma": "Monitoring", "netdata": "Monitoring", "grafana": "Monitoring", "database": "Databases", "docker": "Admin",
    "dashboard": "Admin", "guacamole": "Admin", "gitea": "Development", "ollama": "AI", "moonraker": "Printing", "octoprint": "Printing",
}
GROUP_ORDER = ["Streaming", "Requests", "Library automation", "Downloads", "Watch stats", "Audio & books", "Photos", "Games",
               "Network", "DNS", "Proxy", "VPN", "Home", "Cameras", "Storage & sync", "Backup", "Documents", "Security",
               "Monitoring", "Databases", "AI", "Printing", "Development", "Admin", "Other"]


def guess(services, health_kind=None, open_ports=()):
    """Best preset for what a machine runs. The user can always change it."""
    s = set(services or [])
    for keys, p in ((("plex", "jellyfin", "emby"), "media"), (("pbs",), "backup"), (("truenas", "synology", "unraid"), "nas"),
                    (("opnsense", "pfsense", "unifi", "openwrt"), "router"), (("frigate", "blueiris"), "nvr"),
                    (("homeassistant",), "home"), (("moonraker", "octoprint"), "printer"), (("ollama",), "ai"),
                    (("minecraft",), "game"), (("pihole", "adguard"), "dns"), (("nextcloud", "syncthing"), "nas")):
        if s & set(keys):
            return p
    if health_kind == "lhm":
        return "pc"
    return "generic"


# ---------------------------------------------------------------- helpers
_cache, _lock = {}, threading.Lock()
_NOVERIFY = ssl.create_default_context(); _NOVERIFY.check_hostname = False; _NOVERIFY.verify_mode = ssl.CERT_NONE   # home servers use self-signed certs
UA = {"User-Agent": "orrery-presets/1"}


def _req(url, headers=None, body=None, method=None, timeout=4, raw=False):
    h = dict(UA, **(headers or {}))
    data = None
    if body is not None:
        data = json.dumps(body).encode(); h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(r, timeout=timeout, context=_NOVERIFY if url.startswith("https") else None) as f:
        b = f.read()
    return b if raw else json.loads(b or b"null")


def chk(sys, label, value, level, why="", st=None):
    return {"sys": sys, "label": label, "value": value, "level": level, "why": why, "stress": float(level) if st is None else st}


def _url(c, addr, default):
    return (c.get("url") or default.replace("{addr}", addr)).rstrip("/")


def _age(sec):
    if sec is None: return "never"
    if sec < 3600: return f"{sec / 60:.0f} min ago"
    if sec < 172800: return f"{sec / 3600:.0f} h ago"
    return f"{sec / 86400:.0f} days ago"


# ---------------------------------------------------------------- built-in checks (no setup needed)
def _dns_query(addr, name="example.com", timeout=2):
    """One A query straight to the machine. Returns (answered, ms)."""
    qid = random.randint(0, 65535)
    q = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0) + b"".join(bytes([len(p)]) + p.encode() for p in name.split(".")) + b"\0" + struct.pack(">HH", 1, 1)
    s = socket.socket(socket.AF_INET6 if ":" in addr else socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(timeout)
    t0 = time.time()
    try:
        s.sendto(q, (addr, 53))
        d, _ = s.recvfrom(1500)
        rid, flags, _, an = struct.unpack(">HHHH", d[:8])
        return rid == qid and (flags & 0xF) == 0 and an > 0, (time.time() - t0) * 1000
    except OSError:
        return False, None
    finally:
        s.close()


INTERNET = (("1.1.1.1", 443), ("8.8.8.8", 443), ("9.9.9.9", 443))


def _internet():
    res = []
    for host, port in INTERNET:
        s = socket.socket(); s.settimeout(1.5); t0 = time.time()
        try:
            res.append((time.time() - t0) * 1000 if s.connect_ex((host, port)) == 0 else None)
        except OSError:
            res.append(None)
        finally:
            s.close()
    ok = [r for r in res if r is not None]
    return {"up": bool(ok), "ms": min(ok) if ok else None, "loss": round(100 * (len(res) - len(ok)) / len(res))}


def router(addr, c, sec, ctx):
    I = _cached(("inet",), 15, _internet)
    C, F = [], {"inet": I.get("up"), "inetMs": I.get("ms"), "loss": I.get("loss")}
    if not I.get("up"):
        C.append(chk("net", "Internet", "down", 2, "the internet is down"))
    else:
        ms, loss = I["ms"] or 0, I["loss"]
        l = 1 if ms > 150 or loss >= 34 else 0
        C.append(chk("net", "Internet", f"{ms:.0f} ms" + (f" · {loss}% loss" if loss else ""), l, "internet slow or dropping" if l else "", min(1, ms / 150) ** 2 if not l else 1))
    if 53 in (ctx.get("open") or []):
        ok, ms = _dns_query(addr)
        F["dns"] = ok
        C.append(chk("net", "DNS", f"{ms:.0f} ms" if ok else "not answering", 0 if ok else 1, "" if ok else "router DNS not answering"))
    return {"src": "Orrery", "checks": C, "facts": F}


def dns(addr, c, sec, ctx):
    ok, ms = _dns_query(addr)
    if not ok:
        ok, ms = _dns_query(addr)                 # one retry: UDP can drop a packet
    return {"src": "Orrery", "facts": {"dns": ok, "dnsMs": ms},
            "checks": [chk("dns", "Answers DNS", f"{ms:.0f} ms" if ok else "no answer", 0 if ok else 2, "" if ok else "not answering DNS: the network can't look names up")]}


BUILTIN = {"router": router, "dns": dns}


# ---------------------------------------------------------------- integrations
_ph_sid = {}


def pihole(addr, c, sec, ctx):
    u = _url(c, addr, "http://{addr}")
    pw = sec.get("password") or ""
    def v6(path):
        if not _ph_sid.get(u):
            s = _req(u + "/api/auth", body={"password": pw}, method="POST")
            _ph_sid[u] = ((s or {}).get("session") or {}).get("sid")
            if not _ph_sid[u]:
                raise RuntimeError("Pi-hole refused the password")
        try:
            return _req(u + "/api" + path, headers={"X-FTL-SID": _ph_sid[u]})
        except urllib.error.HTTPError as e:
            if e.code != 401: raise
            _ph_sid.pop(u, None); return v6(path)
    try:
        s = v6("/stats/summary"); b = v6("/dns/blocking")
        q = s.get("queries") or {}
        tot, blk, on = q.get("total") or 0, q.get("blocked") or 0, (b or {}).get("blocking") == "enabled"
        lists = (s.get("gravity") or {}).get("domains_being_blocked")
    except urllib.error.HTTPError as e:
        if e.code != 404: raise
        d = _req(f"{u}/admin/api.php?summaryRaw&auth={urllib.parse.quote(pw)}")     # Pi-hole v5
        tot, blk, on, lists = d.get("dns_queries_today") or 0, d.get("ads_blocked_today") or 0, d.get("status") == "enabled", d.get("domains_being_blocked")
    pct = blk / tot * 100 if tot else 0
    return {"src": "Pi-hole", "facts": {"queries": tot, "blocked": blk, "pct": pct, "blocking": on, "lists": lists},
            "checks": [chk("dns", "Ad-blocking", "on" if on else "OFF", 0 if on else 1, "" if on else "ad-blocking is switched off"),
                       chk("dns", "Blocked today", f"{blk:,} of {tot:,} · {pct:.0f}%", 0)]}


def adguard(addr, c, sec, ctx):
    u = _url(c, addr, "http://{addr}")
    h = {"Authorization": "Basic " + base64.b64encode(f"{c.get('user', '')}:{sec.get('password', '')}".encode()).decode()}
    st, s = _req(u + "/control/status", h), _req(u + "/control/stats", h)
    on, tot, blk = st.get("protection_enabled"), s.get("num_dns_queries") or 0, s.get("num_blocked_filtering") or 0
    pct = blk / tot * 100 if tot else 0
    return {"src": "AdGuard Home", "facts": {"queries": tot, "blocked": blk, "pct": pct, "blocking": bool(on), "avgMs": (s.get("avg_processing_time") or 0) * 1000},
            "checks": [chk("dns", "Protection", "on" if on else "OFF", 0 if on else 1, "" if on else "protection is switched off"),
                       chk("dns", "Blocked", f"{blk:,} of {tot:,} · {pct:.0f}%", 0)]}


HA_DEVICES = ("sensor", "binary_sensor", "light", "switch", "lock", "climate", "cover", "fan", "camera", "media_player", "vacuum", "alarm_control_panel")


def ha(addr, c, sec, ctx):
    u = _url(c, addr, "http://{addr}:8123")
    S = _req(u + "/api/states", {"Authorization": "Bearer " + sec.get("token", "")}, timeout=8)
    dev = [e for e in S if e.get("entity_id", "").split(".")[0] in HA_DEVICES]
    dead = [e for e in dev if e.get("state") in ("unavailable", "unknown") and e["entity_id"].split(".")[0] != "sensor" or e.get("state") == "unavailable"]
    nm = lambda e: (e.get("attributes") or {}).get("friendly_name") or e["entity_id"]
    bat = []
    for e in S:
        a = e.get("attributes") or {}
        if a.get("device_class") == "battery" and a.get("unit_of_measurement") == "%":
            try:
                v = float(e.get("state"))
                if v < 20: bat.append((nm(e).replace(" Battery", "").replace(" battery", ""), v))
            except (TypeError, ValueError):
                pass
    upd = [nm(e) for e in S if e.get("entity_id", "").startswith("update.") and e.get("state") == "on"]
    frac = len(dead) / max(1, len(dev))
    C = [chk("home", "Devices answering", f"{len(dev) - len(dead)} of {len(dev)}", 2 if frac > .25 else 1 if frac > .05 else 0,
             f"{len(dead)} devices unavailable" if frac > .05 else "", min(2, (frac / .05) ** 2 if frac <= .05 else 1 + (frac - .05) / .2))]
    if bat:
        lo = min(v for _, v in bat)
        C.append(chk("home", "Low batteries", f"{len(bat)} · lowest {lo:.0f}%", 1 if lo < 10 else 0, f"{len(bat)} batteries low" if lo < 10 else ""))
    if upd:
        C.append(chk("home", "Updates waiting", str(len(upd)), 0))
    return {"src": "Home Assistant", "checks": C,
            "facts": {"devices": len(dev), "dead": len(dead), "deadNames": [nm(e) for e in dead][:12], "frac": frac,
                      "batteries": sorted(bat, key=lambda x: x[1])[:8], "updates": upd[:8]}}


def frigate(addr, c, sec, ctx):
    u = _url(c, addr, "http://{addr}:5000")
    s = _req(u + "/api/stats")
    cams = [{"name": k, "on": (v.get("camera_fps") or 0) > 0, "fps": v.get("camera_fps") or 0, "det": v.get("detection_fps") or 0}
            for k, v in (s.get("cameras") or {}).items()]
    C, off = [], [x["name"] for x in cams if not x["on"]]
    if cams:
        C.append(chk("cam", "Cameras online", f"{len(cams) - len(off)} of {len(cams)}", 2 if len(off) == len(cams) else 1 if off else 0,
                     "every camera is offline" if len(off) == len(cams) else f"{', '.join(off[:3])} offline" if off else ""))
    det = [v.get("inference_speed") for v in (s.get("detectors") or {}).values() if v.get("inference_speed")]
    if det:
        ms = max(det); C.append(chk("cam", "Detector", f"{ms:.0f} ms", 1 if ms > 100 else 0, "object detection is slow" if ms > 100 else ""))
    for path, v in ((s.get("service") or {}).get("storage") or {}).items():
        if "recordings" in path and v.get("total"):
            pct = v["used"] / v["total"] * 100
            C.append(chk("disk", "Recordings disk", f"{pct:.0f}%", health._lvl(pct, "fill"), "recordings disk filling up" if pct >= 85 else "", health.stress(pct, "fill")))
    return {"src": "Frigate", "checks": C, "facts": {"cams": cams[:16]}}


def ollama(addr, c, sec, ctx):
    u = _url(c, addr, "http://{addr}:11434")
    ps = _req(u + "/api/ps").get("models") or []
    m = [{"name": x.get("name"), "vram": (x.get("size_vram") or 0) / 2 ** 30, "size": (x.get("size") or 0) / 2 ** 30} for x in ps]
    return {"src": "Ollama", "facts": {"models": m},
            "checks": [chk("ai", "Models loaded", ", ".join(x["name"] for x in m[:3]) if m else "none (idle)", 0)]}


def moonraker(addr, c, sec, ctx):
    u = _url(c, addr, "http://{addr}:7125")
    s = (_req(u + "/printer/objects/query?print_stats&extruder&heater_bed&display_status&webhooks").get("result") or {}).get("status") or {}
    ps, wh = s.get("print_stats") or {}, s.get("webhooks") or {}
    st = ps.get("state") or "standby"
    if wh.get("state") in ("shutdown", "error"):
        st = "error"
    prog = (s.get("display_status") or {}).get("progress") or 0
    dur = ps.get("print_duration") or 0
    return _printer("Klipper", st, prog, ps.get("filename"), dur / prog - dur if prog > 0.01 and st == "printing" else None,
                    (s.get("extruder") or {}).get("temperature"), (s.get("heater_bed") or {}).get("temperature"), wh.get("state_message") if st == "error" else "")


def octoprint(addr, c, sec, ctx):
    u = _url(c, addr, "http://{addr}")
    h = {"X-Api-Key": sec.get("key", "")}
    j = _req(u + "/api/job", h)
    st = (j.get("state") or "").lower()
    st = "printing" if st.startswith("printing") else "paused" if "paus" in st else "error" if "error" in st or "offline" in st else "standby"
    tool = bed = None
    try:
        p = _req(u + "/api/printer", h); tool = ((p.get("temperature") or {}).get("tool0") or {}).get("actual"); bed = ((p.get("temperature") or {}).get("bed") or {}).get("actual")
    except Exception:
        pass
    pr = j.get("progress") or {}
    return _printer("OctoPrint", st, (pr.get("completion") or 0) / 100, ((j.get("job") or {}).get("file") or {}).get("name"), pr.get("printTimeLeft"), tool, bed, "")


def _printer(src, st, prog, fn, left, tool, bed, msg):
    lv = 2 if st == "error" else 1 if st == "paused" else 0
    why = ("printer error" + (f": {msg}" if msg else "")) if st == "error" else "print paused" if st == "paused" else ""
    val = {"printing": f"printing {prog * 100:.0f}%", "paused": f"paused at {prog * 100:.0f}%", "complete": "finished", "error": "error",
           "cancelled": "cancelled"}.get(st, "idle")
    C = [chk("print", "Printer", val, lv, why)]
    if st == "printing" and left:
        C.append(chk("print", "Time left", f"{left / 3600:.0f} h {left % 3600 / 60:.0f} min" if left >= 3600 else f"{left / 60:.0f} min", 0))
    if tool is not None:
        C.append(chk("print", "Nozzle · bed", f"{tool:.0f} °C · {bed or 0:.0f} °C", 0))
    return {"src": src, "checks": C, "facts": {"state": st, "progress": prog, "file": fn, "left": left}}


def truenas(addr, c, sec, ctx):
    u = _url(c, addr, "https://{addr}")
    h = {"Authorization": "Bearer " + sec.get("key", "")}
    pools = _req(u + "/api/v2.0/pool", h, timeout=8)
    P, C = [], []
    for p in pools:
        size, alloc = p.get("size") or 0, p.get("allocated") or 0
        fill = alloc / size * 100 if size else None
        ok = p.get("status") == "ONLINE" and p.get("healthy", True)
        P.append({"name": p.get("name"), "fill": fill, "ok": ok, "status": p.get("status")})
        C.append(chk("pool", f"Pool {p.get('name')}", p.get("status", "?") + (f" · {fill:.0f}% full" if fill is not None else ""),
                     max(0 if ok else 2 if p.get("status") in ("FAULTED", "UNAVAIL", "OFFLINE") else 1, health._lvl(fill, "fill")),
                     "" if ok else f"pool {p.get('name')} is {p.get('status', 'unhealthy').lower()}" if p.get("status") != "ONLINE" else f"pool {p.get('name')} has errors",
                     None if not ok else health.stress(fill, "fill")))
        if ok and fill is not None and fill >= 85:
            C[-1]["why"] = f"pool {p.get('name')} {fill:.0f}% full"
    try:
        al = [a for a in _req(u + "/api/v2.0/alert/list", h) if not a.get("dismissed") and a.get("level") in ("CRITICAL", "ALERT", "EMERGENCY", "ERROR", "WARNING")]
        if al:
            crit = any(a["level"] != "WARNING" for a in al)
            C.append(chk("pool", "TrueNAS alerts", str(len(al)), 2 if crit else 1, (al[0].get("formatted") or al[0].get("klass") or "alert")[:80]))
    except Exception:
        pass
    return {"src": "TrueNAS", "checks": C, "facts": {"pools": P}}


BACKUP_WARN, BACKUP_CRIT = 26 * 3600, 72 * 3600


def pbs(addr, c, sec, ctx):
    u = _url(c, addr, "https://{addr}:8007")
    tok = sec.get("token", "")
    tid, _, secret = tok.partition("=")
    h = {"Authorization": f"PBSAPIToken={tid}:{secret}"}
    usage = _req(u + "/api2/json/status/datastore-usage", h).get("data") or []
    now, C, stores, ages = time.time(), [], [], []
    for d in usage:
        fill = d["used"] / d["total"] * 100 if d.get("total") else None
        stores.append({"name": d.get("store"), "fill": fill})
        if fill is not None:
            C.append(chk("backup", f"Datastore {d.get('store')}", f"{fill:.0f}% full", health._lvl(fill, "fill"), f"datastore {d.get('store')} {fill:.0f}% full" if fill >= 85 else "", health.stress(fill, "fill")))
        try:
            for g in _req(f"{u}/api2/json/admin/datastore/{urllib.parse.quote(d['store'])}/groups", h).get("data") or []:
                if g.get("last-backup"):
                    ages.append((now - g["last-backup"], f"{g.get('backup-type')}/{g.get('backup-id')}", g.get("comment") or ""))
        except Exception:
            pass
    stale = max(ages) if ages else None
    if ages:
        a = stale[0]
        l = 2 if a > BACKUP_CRIT else 1 if a > BACKUP_WARN else 0
        C.insert(0, chk("backup", "Oldest last backup", f"{stale[2] or stale[1]} · {_age(a)}", l,
                        f"{stale[2] or stale[1]} not backed up for {_age(a).replace(' ago', '')}" if l else "",
                        min(2, (a / BACKUP_WARN) ** 2 if a <= BACKUP_WARN else 1 + (a - BACKUP_WARN) / (BACKUP_CRIT - BACKUP_WARN))))
        C.insert(1, chk("backup", "Newest backup", _age(min(ages)[0]), 0))
    try:
        bad = [t for t in _req(u + "/api2/json/nodes/localhost/tasks?errors=1&limit=50&since=" + str(int(now - 86400)), h).get("data") or []
               if t.get("status") and t["status"] != "OK"]
        if bad:
            C.append(chk("backup", "Failed tasks (24 h)", str(len(bad)), 1, f"{len(bad)} {bad[0].get('worker_type', 'task')} task{'s' if len(bad) > 1 else ''} failed today"))
    except Exception:
        pass
    return {"src": "Proxmox Backup Server", "checks": C,
            "facts": {"stores": stores, "groups": len(ages), "stalest": stale[0] if stale else None, "newest": min(ages)[0] if ages else None}}


def _varint(n):
    out = b""
    while True:
        b = n & 0x7F; n >>= 7
        out += bytes([b | (0x80 if n else 0)])
        if not n: return out


def minecraft(addr, c, sec, ctx):
    port = int(c.get("port") or 25565)
    s = socket.create_connection((addr, port), 3); s.settimeout(3); t0 = time.time()
    try:
        hs = b"\x00" + _varint(767) + _varint(len(addr)) + addr.encode() + struct.pack(">H", port) + b"\x01"
        s.sendall(_varint(len(hs)) + hs + b"\x01\x00")
        buf, d = b"", None
        while True:
            ch = s.recv(65536)
            if not ch: break
            buf += ch
            try:
                i, n, sh = 0, 0, 0
                def rv():
                    nonlocal i
                    v, sh2 = 0, 0
                    while True:
                        b = buf[i]; i += 1; v |= (b & 0x7F) << sh2; sh2 += 7
                        if not b & 0x80: return v
                total = rv(); start = i
                if len(buf) - start < total: continue
                rv(); ln = rv()
                d = json.loads(buf[i:i + ln]); break
            except (IndexError, ValueError):
                continue
        ms = (time.time() - t0) * 1000
    finally:
        s.close()
    if not isinstance(d, dict):
        raise RuntimeError("no server-list answer")
    pl = d.get("players") or {}
    names = [p.get("name") for p in pl.get("sample") or [] if p.get("name")]
    return {"src": "Minecraft", "facts": {"players": pl.get("online") or 0, "max": pl.get("max"), "names": names[:12], "game": "Minecraft " + str((d.get("version") or {}).get("name", ""))},
            "checks": [chk("game", "Players", f"{pl.get('online', 0)} / {pl.get('max', '?')}", 0), chk("game", "Server", f"answering · {ms:.0f} ms", 0)]}


def steam(addr, c, sec, ctx):
    port = int(c.get("port") or 27015)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(3)
    q = b"\xFF\xFF\xFF\xFFTSource Engine Query\x00"
    try:
        s.sendto(q, (addr, port)); d, _ = s.recvfrom(1400)
        if d[4:5] == b"A":                                   # challenge: ask again with it
            s.sendto(q + d[5:9], (addr, port)); d, _ = s.recvfrom(1400)
    finally:
        s.close()
    if d[4:5] != b"I":
        raise RuntimeError("not a Steam query answer")
    i = 6
    def st():
        nonlocal i
        j = d.index(b"\0", i); v = d[i:j].decode("utf-8", "replace"); i = j + 1; return v
    name, mp, _, game = st(), st(), st(), st()
    i += 2
    n, mx = d[i], d[i + 1]
    return {"src": "Steam query", "facts": {"players": n, "max": mx, "names": [], "game": game, "map": mp, "title": name},
            "checks": [chk("game", "Players", f"{n} / {mx}", 0), chk("game", "Server", f"{game} · {mp}"[:60], 0)]}


READERS = {"truenas": truenas, "pbs": pbs, "pihole": pihole, "adguard": adguard, "ha": ha, "frigate": frigate, "ollama": ollama,
           "moonraker": moonraker, "octoprint": octoprint, "minecraft": minecraft, "steam": steam}
TTL = {"pihole": 30, "ha": 30, "pbs": 60, "truenas": 30}


def _cached(k, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(k)
    if hit and now - hit[0] < ttl:
        return hit[1]
    try:
        v = fn()
    except Exception as e:
        v = {"__error": _why(e)}
    with _lock:
        _cache[k] = (now, v)
    return v


def _why(e):
    if isinstance(e, urllib.error.HTTPError):
        return {401: "refused the key or password (401)", 403: "key lacks permission (403)", 404: "API not found (404): check the URL"}.get(e.code, f"HTTP {e.code}")
    if isinstance(e, (socket.timeout, TimeoutError)):
        return "no answer (timed out)"
    if isinstance(e, ConnectionRefusedError):
        return "connection refused: nothing on that port"
    if isinstance(e, urllib.error.URLError):
        return _why(e.reason) if isinstance(e.reason, Exception) else str(e.reason)[:100]
    return str(e)[:120] or type(e).__name__


# ---------------------------------------------------------------- what a planet reads
def wanted(w, services):
    """Which integration this world reads: the one you set up, or one that needs no setup and is clearly there."""
    L = w.get("link") if isinstance(w.get("link"), dict) else None
    p = PRESETS.get(w.get("type")) or PRESETS["generic"]
    if L and L.get("kind") in READERS:
        return L
    if L == "off" or w.get("link") == "off":
        return None
    for k in p["links"]:
        a = LINKS[k].get("auto")
        if a and (a in services or (k == "minecraft" and w.get("type") == "game")):
            return {"kind": k}
    return None


def read(addr, wid, w, services, ctx, secrets):
    """All preset data for one world: built-in checks plus its integration."""
    out = {"checks": [], "facts": {}, "src": []}
    b = BUILTIN.get(w.get("type"))
    if b:
        r = _cached(("b", addr, w.get("type")), 15, lambda: b(addr, {}, {}, ctx))
        if "__error" not in r:
            out["checks"] += r["checks"]; out["facts"].update(r["facts"])
    L = wanted(w, services)
    if L:
        sec = (secrets or {}).get(wid) or {}
        r = _cached(("l", addr, L["kind"], json.dumps(L, sort_keys=True)), TTL.get(L["kind"], 10), lambda: READERS[L["kind"]](addr, L, sec, ctx))
        out["link"] = {"kind": L["kind"], "label": LINKS[L["kind"]]["label"], "pinned": isinstance(w.get("link"), dict)}
        if "__error" in r:
            out["link"]["error"] = r["__error"]
            out["checks"].append(chk("link", LINKS[L["kind"]]["label"], "not answering", 1, f"{LINKS[L['kind']]['label']}: {r['__error']}"))
        else:
            out["checks"] += r["checks"]; out["facts"].update(r["facts"]); out["src"].append(r["src"])
    return out


def test(kind, addr, fields, secret_fields):
    if kind not in READERS:
        return None, "Unknown integration."
    try:
        r = READERS[kind](addr, fields, secret_fields, {})
    except Exception as e:
        return None, f"{LINKS[kind]['label']}: {_why(e)}"
    return r, None


def public():
    return {"presets": {k: {"label": v["label"], "group": v["group"], "offline": v["offline"], "links": v["links"]} for k, v in PRESETS.items()},
            "links": {k: {"label": v["label"], "hint": v["hint"], "auto": bool(v.get("auto")),
                          "fields": [{"key": f[0], "label": f[1], "default": f[2], "secret": f[3]} for f in v["fields"]]} for k, v in LINKS.items()},
            "groupOrder": GROUP_ORDER}
