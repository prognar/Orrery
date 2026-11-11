"""Orrery: discovery cache, per-guest settings and the bindings the UI draws from.

Bindings answer, for every guest: which template it is, how it looks, how prominent it is and whether
the Manifest shows it. They come from discovery (best match, score >= 30) unless the user has overridden
them on the Setup screen. Everything that used to be a hardcoded guest name in the frontend reads these.

Writes need the admin key (data/admin.key, created on first start and printed to the journal).
"""
import json, os, re, threading, time, urllib.parse

import discover, wizard


def _version():
    """Release from the VERSION file; instances started with ORRERY_CHANNEL=dev say so."""
    try:
        v = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "VERSION")).read().strip()
    except OSError:
        v = "unknown"
    ch = os.environ.get("ORRERY_CHANNEL", "").strip()
    return f"{v}-{ch}" if ch else v


VERSION = _version()

TIERS = ("active", "watch", "quiet", "hidden")
MANIFEST = ("show", "hide")
GID = re.compile(r"^(lxc|qemu)/\d{1,9}$")
DEFAULTS = {
    "guests": {},                       # "lxc/101": {"template": "pihole", "tier": "active", "manifest": "show", "label": "..."}
    "manifest": {"hideStopped": False, "hideHiddenTier": False, "columns": []},   # columns = ones the user switched off
    "media": {"enabled": True},         # the external media giant (Plex / Jellyfin / Emby) planet
    "discovery": {"intervalMin": 360},
    "wizard": {"done": False},
    "network": {"source": "none"},
    "tailscale": {"wanted": False},
}

_pve_get = _node = None
_data = None
_lock = threading.Lock()
_disc = {"running": False, "last": 0.0, "result": None, "error": None}
_pending = {"restart": False}      # credentials saved but not loaded yet


def init(pve_get, node, data_dir, cfg=None):
    global _pve_get, _node, _data
    _pve_get, _node, _data = pve_get, node, data_dir
    os.makedirs(_data, exist_ok=True)
    wizard.init(_data, cfg or {})
    if not wizard.has_password():
        print("First run: open Orrery in a browser to set the admin password and finish setup.", flush=True)
    try:
        with open(os.path.join(_data, "discovery.json")) as f:
            _disc["result"] = json.load(f); _disc["last"] = _disc["result"].get("ts", 0)
    except (OSError, ValueError):
        pass
    threading.Thread(target=_scheduler, daemon=True).start()


# ---------------------------------------------------------------- settings
def settings():
    try:
        with open(os.path.join(_data, "settings.json")) as f:
            s = json.load(f)
    except (OSError, ValueError):
        s = {}
    out = json.loads(json.dumps(DEFAULTS))
    for k, v in s.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def _clean_guest(v, tkeys):
    o = {}
    if v.get("template") in tkeys: o["template"] = v["template"]
    if v.get("tier") in TIERS: o["tier"] = v["tier"]
    if v.get("manifest") in MANIFEST: o["manifest"] = v["manifest"]
    if isinstance(v.get("label"), str) and v["label"].strip(): o["label"] = v["label"].strip()[:60]
    return o


def save(patch):
    """Merge a patch into settings. A guest entry of null, or a field of null, clears that override."""
    tkeys = {t["key"] for t in discover.load_templates()["templates"]}
    s = settings()
    s["guests"] = {k: v for k, v in s["guests"].items() if GID.match(k)}
    for gid, v in (patch.get("guests") or {}).items():
        if not isinstance(gid, str) or not GID.match(gid):
            continue
        if v is None:
            s["guests"].pop(gid, None); continue
        if not isinstance(v, dict):
            continue
        cur = dict(s["guests"].get(gid) or {})
        for f, x in v.items():
            if x is None: cur.pop(f, None)
            elif _clean_guest({f: x}, tkeys): cur[f] = x      # an invalid value is ignored, not allowed to wipe a good one
        cur = _clean_guest(cur, tkeys)
        if cur: s["guests"][gid] = cur
        else: s["guests"].pop(gid, None)
    m = patch.get("manifest") or {}
    for f in ("hideStopped", "hideHiddenTier"):
        if isinstance(m.get(f), bool): s["manifest"][f] = m[f]
    if isinstance(m.get("columns"), list):
        s["manifest"]["columns"] = [c for c in m["columns"] if isinstance(c, str)][:20]
    if isinstance((patch.get("media") or {}).get("enabled"), bool):
        s["media"]["enabled"] = patch["media"]["enabled"]
    if isinstance((patch.get("wizard") or {}).get("done"), bool):
        s["wizard"]["done"] = patch["wizard"]["done"]
    src = (patch.get("network") or {}).get("source")
    if src in ("none", "dns", "netflow", "opnsense", "unifi", "merlin", "netviz"):
        s["network"]["source"] = src
    if isinstance((patch.get("tailscale") or {}).get("wanted"), bool):
        s["tailscale"]["wanted"] = patch["tailscale"]["wanted"]
    iv = (patch.get("discovery") or {}).get("intervalMin")
    if isinstance(iv, int) and 0 <= iv <= 10080:
        s["discovery"]["intervalMin"] = iv
    tmp = os.path.join(_data, "settings.json.tmp")
    with open(tmp, "w") as f:
        json.dump(s, f, indent=1)
    os.replace(tmp, os.path.join(_data, "settings.json"))
    return s


# ---------------------------------------------------------------- discovery
def _run():
    try:
        r = discover.discover(_pve_get, _node)
        tmp = os.path.join(_data, "discovery.json.tmp")
        with open(tmp, "w") as f:
            json.dump(r, f)
        os.replace(tmp, os.path.join(_data, "discovery.json"))
        _disc.update(result=r, last=time.time(), error=None)
    except Exception as e:
        _disc["error"] = str(e)[:200]
    finally:
        _disc["running"] = False


def rescan(force=False):
    with _lock:
        if _disc["running"] or (not force and time.time() - _disc["last"] < 60):
            return False
        _disc["running"] = True
    threading.Thread(target=_run, daemon=True).start()
    return True


def _scheduler():
    """Rescan on start if nothing is cached, then every intervalMin; also whenever a new guest appears."""
    known = None
    while True:
        try:
            iv = settings()["discovery"]["intervalMin"]
            res = _pve_get("cluster/resources", "type=vm", ttl=5)
            ids = {g["id"] for g in res if isinstance(g, dict) and g.get("node") == _node and not g.get("template")} if isinstance(res, list) else None
            new_guest = ids is not None and known is not None and ids - known
            if ids is not None: known = ids
            if _disc["result"] is None or new_guest or (iv and time.time() - _disc["last"] > iv * 60):
                rescan(force=True)
        except Exception:
            pass
        time.sleep(30)


# ---------------------------------------------------------------- bindings
def bindings():
    T = {t["key"]: t for t in discover.load_templates()["templates"]}
    s = settings()
    meta = {"running": _disc["running"], "last": _disc["last"], "error": _disc["error"]}
    if _disc["result"] is None:      # first start, scan still running: don't hand out guesses that are all 'generic'
        return {"ready": False, "guests": {}, "names": {}, "settings": {k: s[k] for k in ("manifest", "media", "discovery")}, "discovery": meta}
    disc = _disc["result"].get("guests", {})
    res = _pve_get("cluster/resources", "type=vm", ttl=5)
    live = {g["id"]: g for g in res if isinstance(g, dict) and g.get("node") == _node and not g.get("template")} if isinstance(res, list) else {}
    out, names, best = {}, {}, {}
    for gid in sorted(set(live) | set(disc), key=lambda i: int(i.split("/")[1])):
        g, d, ov = live.get(gid, {}), disc.get(gid, {}), s["guests"].get(gid, {})
        m = (d.get("matches") or [None])[0]
        auto = m["key"] if m and m["score"] >= 30 and m["key"] in T else "generic"
        key = ov.get("template") or auto
        t = T.get(key, T["generic"])
        tier = ov.get("tier") or t["tier"]
        name = g.get("name") or d.get("name")
        out[gid] = {"vmid": int(gid.split("/")[1]), "name": name, "type": gid.split("/")[0], "status": g.get("status") or d.get("status"),
                    "template": key, "auto": auto, "label": ov.get("label") or t["label"], "look": t["look"], "tier": tier,
                    "manifest": ov.get("manifest") or "show", "trait": t.get("trait"), "category": t.get("category"),
                    "confidence": "manual" if ov.get("template") else d.get("confidence", "unknown"),
                    "score": m["score"] if m else 0, "why": m["why"] if m else [], "ip": d.get("ip"),
                    "url": (m or {}).get("url") if key == auto else None, "alts": [x["key"] for x in (d.get("matches") or [])[1:]],
                    "overridden": sorted(ov)}
        tr = t.get("trait")
        if tr and name:     # one guest per live-data integration: a manual assignment wins, then the best score
            sc = 1000 if ov.get("template") else out[gid]["score"]
            if sc >= best.get(tr, -1):
                best[tr] = sc; names[tr] = name
    return {"ready": True, "guests": out, "names": names, "settings": {k: s[k] for k in ("manifest", "media", "discovery")},
            "discovery": meta}


def trait_names():
    try:
        return bindings()["names"]
    except Exception:
        return {}


def templates_public():
    d = discover.load_templates()
    return {"categories": d["categories"],
            "templates": [{k: v for k, v in t.items() if k not in ("match",)} for t in d["templates"]]}


# ---------------------------------------------------------------- first-run wizard
MEDIA_SPECS = ("plex", "jellyfin", "emby")


def _prefill(g, T):
    """Best guess at a service's address from discovery: the URL that fingerprinted it, else its IP + the template's port."""
    if g.get("url"):
        u = urllib.parse.urlsplit(g["url"]); return f"{u.scheme}://{u.netloc}"
    t = T.get(g["template"]) or {}
    h = ((t.get("match") or {}).get("http") or [{}])[0]
    if g.get("ip") and h.get("port"):
        return f"{h.get('scheme') or ('https' if h['port'] in (443, 8007, 8443, 9443) else 'http')}://{g['ip']}:{h['port']}"
    return f"http://{g['ip']}" if g.get("ip") else None


def setup_state():
    T = {t["key"]: t for t in discover.load_templates()["templates"]}
    s, b = settings(), bindings()
    services, media, seen = [], [], set()
    for gid, g in (b.get("guests") or {}).items():
        sk = wizard.TRAIT_TO_SPEC.get(g.get("trait") or "")
        if not sk or sk in seen or g["tier"] == "hidden" and sk not in ("netdata",):
            continue
        if b["names"].get(g["trait"]) not in (None, g["name"]):
            continue                                   # another guest owns this integration
        seen.add(sk)
        item = {**wizard.public_spec(sk), "guest": g["name"], "vmid": g["vmid"], "prefill": _prefill(g, T), "ip": g.get("ip")}
        (media if sk in MEDIA_SPECS else services).append(item)
    for sk in MEDIA_SPECS:                             # media servers usually live off-host: always offer them
        if sk not in seen: media.append({**wizard.public_spec(sk), "guest": None, "prefill": None})
    res = _pve_get(f"nodes/{_node}/version", ttl=60)
    return {"version": VERSION, "needsPassword": not wizard.has_password(), "done": s["wizard"]["done"], "node": _node,
            "pveVersion": res.get("version") if isinstance(res, dict) else None,
            "guests": len(b.get("guests") or {}), "ready": b.get("ready"), "discovery": b["discovery"],
            "services": sorted(services, key=lambda x: x["vmid"]), "media": media, "qbit": wizard.public_spec("qbit"),
            "network": s["network"], "tailscale": s["tailscale"], "proxmoxSpec": wizard.public_spec("proxmox"),
            "servers": [{"name": x.get("name"), "url": x.get("url")} for x in _servers()]}


def _servers():
    try:
        with open(os.path.join(_data, "secrets.json")) as f:
            return json.load(f).get("servers") or []
    except (OSError, ValueError):
        return []


def _save_servers(items):
    p = os.path.join(_data, "secrets.json")
    try:
        with open(p) as f: sec = json.load(f)
    except (OSError, ValueError):
        sec = {}
    cur = {x["url"]: x for x in sec.get("servers") or []}
    for it in items or []:
        if not isinstance(it, dict) or not it.get("url"): continue
        if it.get("_remove"): cur.pop(it["url"], None); continue
        prev = cur.get(it["url"], {})
        cur[it["url"]] = {"url": wizard._u(it), "tokenid": it.get("tokenid") or prev.get("tokenid"), "secret": it.get("secret") or prev.get("secret"),
                          "name": it.get("name") or prev.get("name") or urllib.parse.urlsplit(wizard._u(it)).hostname}
    sec["servers"] = list(cur.values())
    wizard._write_private("secrets.json", sec)


# ---------------------------------------------------------------- HTTP
def get(path, query):
    if path == "/api/next/bindings":
        return 200, bindings()
    if path == "/api/next/templates":
        return 200, templates_public()
    if path == "/api/next/setup/state":
        return 200, setup_state()
    if path == "/api/next/discovery":
        return 200, {"running": _disc["running"], "last": _disc["last"], "error": _disc["error"], "result": _disc["result"]}
    return None


def post(path, headers, body):
    if not path.startswith("/api/next/"):
        return None
    if path == "/api/next/setup/password":
        try: pw = (json.loads(body or b"{}").get("password") or "")
        except (ValueError, AttributeError): return 400, {"error": "bad json"}
        if wizard.has_password() and not wizard.check_password((headers.get("X-Orrery-Key") or "").strip()):
            return 401, {"error": "current password required"}
        if len(pw) < 8:
            return 400, {"error": "Use at least 8 characters."}
        wizard.set_password(pw)
        return 200, {"ok": True}
    if not wizard.has_password():
        return 409, {"error": "set an admin password first"}
    if not wizard.check_password((headers.get("X-Orrery-Key") or "").strip()):
        return 401, {"error": "admin password required"}
    if path == "/api/next/auth":
        return 200, {"ok": True}
    if path == "/api/next/settings":
        try:
            patch = json.loads(body or b"{}")
        except ValueError:
            return 400, {"error": "bad json"}
        if not isinstance(patch, dict):
            return 400, {"error": "bad patch"}
        save(patch)
        return 200, bindings()
    if path in ("/api/next/setup/test", "/api/next/setup/save"):
        try:
            d = json.loads(body or b"{}")
        except ValueError:
            return 400, {"error": "bad json"}
        if not isinstance(d, dict):
            return 400, {"error": "bad request"}
        if path.endswith("/test"):
            return 200, wizard.test(d.get("key"), d.get("fields"))
        changed = wizard.save_integrations(d.get("integrations"))
        if d.get("servers"):
            _save_servers(d["servers"]); changed = True
        patch = {k: d[k] for k in ("wizard", "network", "tailscale", "media", "guests", "manifest") if k in d}
        if patch:
            save(patch)
        _pending["restart"] = _pending["restart"] or changed
        go = bool(d.get("restart", True) and _pending["restart"])
        if go:
            wizard.restart_soon()
        return 200, {"ok": True, "restarting": go, "pendingRestart": _pending["restart"] and not go}
    if path == "/api/next/rescan":
        return 200, {"started": rescan(force=True)}
    return 404, {"error": "not found"}
