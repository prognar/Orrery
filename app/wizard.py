"""First-run setup: admin password, service credentials (with live tests), media world, extra servers.

State lives in the data directory next to config.json:
  admin.json    pbkdf2 hash of the admin password            (0600)
  secrets.json  credentials entered in the wizard; server.py merges it over config.json at start (0600)
  settings.json wizard progress under "wizard"                 (via nextapi)
Saving credentials restarts the service (systemd brings it straight back) so every integration picks them up.
"""
import base64, hashlib, hmac, json, os, secrets, socket, ssl, threading, time, urllib.error, urllib.parse, urllib.request

_data = None
_cfg = {}
_CTX = ssl.create_default_context(); _CTX.check_hostname = False; _CTX.verify_mode = ssl.CERT_NONE


def init(data_dir, cfg):
    global _data, _cfg
    _data, _cfg = data_dir, cfg


def _p(name):
    return os.path.join(_data, name)


def _write_private(name, obj):
    tmp = _p(name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, _p(name))


# ---------------------------------------------------------------- password
def has_password():
    return os.path.exists(_p("admin.json")) or os.path.exists(_p("admin.key"))


def set_password(pw):
    salt = secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000)
    _write_private("admin.json", {"salt": base64.b64encode(salt).decode(), "hash": base64.b64encode(h).decode(), "set": time.time()})
    try: os.remove(_p("admin.key"))
    except OSError: pass


_ok_cache = {}
def check_password(pw):
    if not pw:
        return False
    if os.path.exists(_p("admin.json")):
        with open(_p("admin.json")) as f:
            d = json.load(f)
        ck = (d["hash"], pw)
        if ck in _ok_cache and time.time() - _ok_cache[ck] < 300:
            return True
        ok = hmac.compare_digest(hashlib.pbkdf2_hmac("sha256", pw.encode(), base64.b64decode(d["salt"]), 200_000), base64.b64decode(d["hash"]))
        if ok: _ok_cache[ck] = time.time()
        return ok
    if os.path.exists(_p("admin.key")):                       # legacy / dev key file
        with open(_p("admin.key")) as f:
            return hmac.compare_digest(pw.strip(), f.read().strip())
    return False


# ---------------------------------------------------------------- HTTP helper for tests
def _req(url, headers=None, body=None, method=None, timeout=6):
    data = json.dumps(body).encode() if body is not None else None
    h = {"User-Agent": "orrery-setup/1", **({"Content-Type": "application/json"} if data else {}), **(headers or {})}
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(r, timeout=timeout, context=_CTX) as resp:
        raw = resp.read(200000)
        try: return resp.status, json.loads(raw)
        except ValueError: return resp.status, raw.decode("utf8", "replace")


def _explain(e):
    if isinstance(e, urllib.error.HTTPError):
        if e.code in (401, 403): return "Reached it, but the key or password was rejected."
        if e.code == 404: return "Reached a web server, but not this service's API at that address. Check the port."
        return f"The service answered with an error (HTTP {e.code})."
    r = getattr(e, "reason", e)
    if isinstance(r, ssl.SSLError): return "TLS problem. Try http:// instead of https:// (or the other way round)."
    if isinstance(r, (socket.timeout, TimeoutError)) or "timed out" in str(r): return "Nothing answered in time. Is the address right, and reachable from Orrery?"
    if isinstance(r, ConnectionRefusedError) or "refused" in str(r): return "That machine is up, but nothing is listening on that port."
    if "Name or service not known" in str(r) or "nodename" in str(r): return "That hostname doesn't resolve from Orrery."
    return f"Couldn't connect: {str(r)[:120]}"


def _u(f, k="url"):
    v = (f.get(k) or "").strip().rstrip("/")
    if v and "://" not in v: v = "http://" + v
    return v


# ---------------------------------------------------------------- integration specs
def _t_pihole(f):
    s, d = _req(_u(f) + "/api/auth", body={"password": f.get("password", "")}, method="POST")
    if not ((d or {}).get("session") or {}).get("valid"): raise urllib.error.HTTPError("", 401, "", None, None)
    try: _req(_u(f) + "/api/auth", headers={"X-FTL-SID": d["session"]["sid"]}, method="DELETE")   # don't leave a session lying around
    except Exception: pass
    return "Signed in to Pi-hole."
def _t_bearer(path, what):
    def t(f):
        _req(_u(f) + path, {"Authorization": "Bearer " + f.get("token", "")}); return f"Connected to {what}."
    return t
def _t_immich(f):
    s, d = _req(_u(f) + "/api/server/statistics", {"x-api-key": f.get("token", "")})
    return f"Connected: {d.get('photos', 0):,} photos, {d.get('videos', 0):,} videos." if isinstance(d, dict) else "Connected to Immich."
def _t_kuma(f):
    s, d = _req(_u(f) + "/metrics", {"Authorization": "Basic " + base64.b64encode((":" + f.get("key", "")).encode()).decode()})
    n = str(d).count("monitor_status{")
    return f"Connected: {n} monitors." if n else "Connected to Uptime Kuma."
def _t_paperless(f):
    s, d = _req(_u(f) + "/api/statistics/", {"Authorization": "Token " + f.get("token", "")})
    return f"Connected: {d.get('documents_total', 0):,} documents." if isinstance(d, dict) else "Connected to Paperless."
def _t_seerr(f):
    s, d = _req(_u(f) + "/api/v1/request/count", {"X-Api-Key": f.get("key", "")})
    return f"Connected: {d.get('total', 0)} requests so far." if isinstance(d, dict) else "Connected to Seerr."
def _t_ha(f):
    s, d = _req(_u(f) + "/api/config", {"Authorization": "Bearer " + f.get("token", "")})
    return f"Connected to “{d.get('location_name', 'Home')}” (HA {d.get('version', '?')})." if isinstance(d, dict) else "Connected to Home Assistant."
def _t_plex(f):
    s, d = _req(_u(f) + "/identity", {"Accept": "application/json"})
    s2, l = _req(_u(f) + "/library/sections?X-Plex-Token=" + urllib.parse.quote(f.get("token", "")), {"Accept": "application/json"})
    n = len(((l or {}).get("MediaContainer") or {}).get("Directory") or []) if isinstance(l, dict) else 0
    return f"Connected: {n} libraries."
def _t_jelly(f):
    s, d = _req(_u(f) + "/System/Info", {"X-Emby-Token": f.get("token", "")})
    return f"Connected to {d.get('ServerName', 'server')} ({d.get('ProductName', '')} {d.get('Version', '')})." if isinstance(d, dict) else "Connected."
def _t_qbit(f):
    s, d = _req(_u(f) + "/api/v2/app/version")
    return f"Connected: qBittorrent {d}."
def _t_netdata(f):
    s, d = _req(_u(f) + "/api/v1/info")
    return f"Connected: Netdata {d.get('version', '')}." if isinstance(d, dict) else "Connected."
def _t_netviz(f):
    _req(f"http://{f.get('host')}:{f.get('port') or 8099}/"); return "NetViz is answering."
def _t_pve(f):
    s, d = _req(_u(f) + "/api2/json/nodes", {"Authorization": f"PVEAPIToken={f.get('tokenid', '')}={f.get('secret', '')}"})
    nodes = [n.get("node") for n in (d or {}).get("data") or []]
    return f"Connected: node {', '.join(nodes)}." if nodes else "Connected."

F = lambda key, label, secret=False, hint=None, ph=None: {"key": key, "label": label, "secret": secret, "hint": hint, "placeholder": ph}
URL = F("url", "Address", ph="http://192.168.1.20:8080")
SPEC = {
    "pihole":    {"label": "Pi-hole", "dest": ("traits", "pihole"), "test": _t_pihole, "fields": [URL, F("password", "App password", True, "Pi-hole → Settings → Web interface / API → Configure app password. Your normal web password also works.")], "gives": "queries, blocking rate, top domains"},
    "abs":       {"label": "Audiobookshelf", "dest": ("traits", "abs"), "test": _t_bearer("/api/me", "Audiobookshelf"), "fields": [URL, F("token", "API token", True, "Settings → Users → click your user → API Token (copy).")], "gives": "who's listening, recent listens"},
    "romm":      {"label": "RomM", "dest": ("traits", "romm"), "test": _t_bearer("/api/stats", "RomM"), "fields": [URL, F("token", "Client API token", True, "Profile → Client API Tokens → New. Read scopes are enough.")], "gives": "who's playing, recent plays, library size"},
    "immich":    {"label": "Immich", "dest": ("traits", "immich"), "test": _t_immich, "fields": [URL, F("token", "API key", True, "Account Settings → API Keys → New API Key (create it as an admin user).")], "gives": "library stats, memories, photo map"},
    "kuma":      {"label": "Uptime Kuma", "dest": ("traits", "kuma"), "test": _t_kuma, "fields": [URL, F("key", "API key", True, "Settings → API Keys → Add API Key.")], "gives": "monitors that are down"},
    "paperless": {"label": "Paperless-ngx", "dest": ("traits", "paperless"), "test": _t_paperless, "fields": [URL, F("token", "API token", True, "Click your name (top right) → My Profile → API Auth Token.")], "gives": "documents, recent scans"},
    "seerr":     {"label": "Seerr / Overseerr / Jellyseerr", "dest": ("traits", "seerr"), "test": _t_seerr, "fields": [URL, F("key", "API key", True, "Settings → General → API Key.")], "gives": "recent requests and their status"},
    "tracearr":  {"label": "Tracearr", "dest": ("traits", "tracearr"), "test": _t_bearer("/api/v1/public/stats/today", "Tracearr"), "fields": [URL, F("token", "API token", True, "Settings → API → create a public API token.")], "gives": "streams today, sharing alerts"},
    "ha":        {"label": "Home Assistant", "dest": ("traits", "ha"), "test": _t_ha, "fields": [URL, F("token", "Long-lived access token", True, "Click your profile (bottom left) → Security → Long-lived access tokens → Create token.")], "gives": "who's home, lights, climate, automations"},
    "netviz":    {"label": "NetViz", "dest": ("traits", "netviz"), "test": _t_netviz, "fields": [F("host", "Address", ph="192.168.1.21"), F("port", "Port", ph="8099")], "gives": "live traffic globe", "noauth": True},
    "netdata":   {"label": "Netdata", "dest": ("netdata",), "test": _t_netdata, "fields": [URL], "gives": "host health alarms", "noauth": True},
    "plex":      {"label": "Plex", "dest": ("plex",), "test": _t_plex, "fields": [URL, F("token", "X-Plex-Token", True, "In Plex Web, open any movie → ⋯ → Get Info → View XML. The token is the X-Plex-Token= part of that page's address."), F("name", "Planet name", ph="My Plex")], "gives": "streams, libraries, history"},
    "jellyfin":  {"label": "Jellyfin", "dest": ("jellyfin",), "test": _t_jelly, "fields": [URL, F("token", "API key", True, "Dashboard → API Keys → +."), F("name", "Planet name", ph="My Jellyfin")], "gives": "streams, libraries", "preview": True},
    "emby":      {"label": "Emby", "dest": ("emby",), "test": _t_jelly, "fields": [URL, F("token", "API key", True, "Settings → Advanced → API Keys → New."), F("name", "Planet name", ph="My Emby")], "gives": "streams, libraries", "preview": True},
    "qbit":      {"label": "qBittorrent", "dest": ("qbit",), "test": _t_qbit, "fields": [URL], "gives": "downloads on the media world",
                  "note": "qBittorrent → Options → Web UI → enable “Bypass authentication for clients in whitelisted IP subnets” and add Orrery's address.", "noauth": True},
    "proxmox":   {"label": "Proxmox server", "dest": None, "test": _t_pve, "fields": [F("url", "Address", ph="https://192.168.1.6:8006"), F("tokenid", "Token ID", ph="orrery@pve!dash"), F("secret", "Token secret", True, "Datacenter → Permissions → API Tokens → Add (user with the PVEAuditor role, privilege separation off).")], "noauth": True},
}
TRAIT_TO_SPEC = {"pihole": "pihole", "abs": "abs", "romm": "romm", "immich": "immich", "kuma": "kuma", "paperless": "paperless", "seerr": "seerr",
                 "tracearr": "tracearr", "ha": "ha", "netviz": "netviz", "netdata": "netdata", "plex": "plex", "jellyfin": "jellyfin", "emby": "emby", "qbit": "qbit"}


def _current(spec_key):
    """What's configured now for an integration (config.json + secrets.json merged by the caller)."""
    d = SPEC[spec_key]["dest"]
    if not d: return {}
    cur = _cfg
    for k in d: cur = (cur or {}).get(k) or {}
    return cur if isinstance(cur, dict) else {}


def public_spec(spec_key):
    s = SPEC[spec_key]; cur = _current(spec_key)
    return {"key": spec_key, "label": s["label"], "gives": s.get("gives"), "note": s.get("note"), "preview": bool(s.get("preview")), "noauth": bool(s.get("noauth")),
            "configured": bool(cur.get("url") or cur.get("host")),
            "fields": [{**f, "value": None if f["secret"] else (str(cur.get(f["key"])) if cur.get(f["key"]) is not None else None),
                        "saved": bool(f["secret"] and cur.get(f["key"]))} for f in s["fields"]]}


def test(spec_key, fields):
    s = SPEC.get(spec_key)
    if not s: return {"ok": False, "detail": "Unknown service."}
    cur = _current(spec_key)
    f = {**{k: v for k, v in cur.items() if isinstance(v, (str, int))}, **{k: v for k, v in (fields or {}).items() if v not in (None, "")}}
    try:
        return {"ok": True, "detail": s["test"](f)}
    except Exception as e:
        return {"ok": False, "detail": _explain(e)}


def save_integrations(items):
    """items: {spec_key: {field: value}}. Blank secret fields keep what was saved before. Returns True when anything changed."""
    try:
        with open(_p("secrets.json")) as fh: sec = json.load(fh)
    except (OSError, ValueError):
        sec = {}
    changed = False
    for k, fields in (items or {}).items():
        s = SPEC.get(k)
        if not s or not s["dest"] or not isinstance(fields, dict): continue
        if fields.get("_remove"):
            node = sec
            for p in s["dest"][:-1]: node = node.setdefault(p, {})
            node[s["dest"][-1]] = {}; changed = True; continue
        cur = dict(_current(k))
        for fd in s["fields"]:
            v = fields.get(fd["key"])
            if v in (None, "") and fd["secret"]: continue
            if v is None: continue
            v = str(v).strip()
            if fd["key"] == "url": v = _u({"url": v})
            if fd["key"] == "port":
                try: v = int(v)
                except ValueError: continue
            cur[fd["key"]] = v
        if k == "immich": cur.setdefault("photos", True)
        node = sec
        for p in s["dest"][:-1]: node = node.setdefault(p, {})
        node[s["dest"][-1]] = cur; changed = True
    if changed:
        _write_private("secrets.json", sec)
    return changed


def restart_soon(delay=1.0):
    """Exit after the response is sent; systemd (Restart=always) brings the service straight back with the new credentials."""
    threading.Timer(delay, lambda: os._exit(0)).start()
