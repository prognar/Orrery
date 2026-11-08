"""Service discovery: work out what each Proxmox guest is running.

Signals, strongest first:
  http fingerprint  a known path on a known port returns a known title/body/header   +60
  name / tags       guest name or Proxmox tags match the template                   +40
  port hint         a port the template is known for is open                        +12 (cap +24)
Templates come from templates.json. Score >= 60 is 'confident', 30..59 'likely', below that unknown → generic.
A guest can carry several matches (e.g. a Docker host running five things); the best one drives the planet.
"""
import json, os, re, socket, ssl, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
TPL_FILE = os.path.join(os.path.dirname(HERE), "templates.json")
_CTX = ssl.create_default_context(); _CTX.check_hostname = False; _CTX.verify_mode = ssl.CERT_NONE
UA = {"User-Agent": "orrery-discover/1"}


def load_templates():
    with open(TPL_FILE) as f:
        d = json.load(f)
    for t in d["templates"]:
        m = t.setdefault("match", {})
        m["_names"] = [re.compile(x, re.I) for x in m.get("names", [])]
        for h in m.get("http", []):
            h["_re"] = re.compile(h["re"], re.I)
    return d


# ---------------------------------------------------------------- addresses
_IPV4 = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")


def _ok_ip(ip):
    return bool(ip and _IPV4.match(ip) and not ip.startswith(("127.", "169.254.", "172.17.", "172.18.")))


def _arp_table():
    out = {}
    try:
        with open("/proc/net/arp") as f:
            for line in f.readlines()[1:]:
                p = line.split()
                if len(p) >= 4 and p[3] != "00:00:00:00:00:00":
                    out[p[3].lower()] = p[0]
    except OSError:
        pass
    return out


def _sweep(prefixes):
    """Touch every address in the given /24s so the kernel ARP table learns MACs on our L2 segment."""
    def poke(ip):
        s = socket.socket(); s.settimeout(0.25)
        try: s.connect_ex((ip, 9))
        except OSError: pass
        finally: s.close()
    with ThreadPoolExecutor(64) as ex:
        list(ex.map(poke, [f"{p}{i}" for p in prefixes for i in range(1, 255)]))


def guest_addresses(pve_get, node, guests):
    """{guest id: ip} using, in order: LXC interfaces, static ip= in config, QEMU guest agent, ARP via MAC."""
    ips, macs = {}, {}
    def one(g):
        base = f"nodes/{node}/{g['type']}/{g['vmid']}"
        cfg = pve_get(f"{base}/config", ttl=60) or {}
        if not isinstance(cfg, dict):
            cfg = {}
        nets = [v for k, v in cfg.items() if re.match(r"^net\d+$", k)]
        for v in nets:
            m = re.search(r"ip=([\d.]+)", v)
            if m and _ok_ip(m.group(1)):
                return g["id"], m.group(1), None, cfg
        if g["type"] == "lxc" and g.get("status") == "running":
            r = pve_get(f"{base}/interfaces", ttl=60)
            for itf in r if isinstance(r, list) else []:
                ip = (itf.get("inet") or "").split("/")[0]
                if itf.get("name") != "lo" and _ok_ip(ip):
                    return g["id"], ip, None, cfg
        if g["type"] == "qemu" and g.get("status") == "running" and str(cfg.get("agent", "0")).startswith(("1", "enabled=1")):
            r = pve_get(f"{base}/agent/network-get-interfaces", ttl=60) or {}
            for itf in (r.get("result") or []) if isinstance(r, dict) else []:
                for a in itf.get("ip-addresses") or []:
                    if a.get("ip-address-type") == "ipv4" and _ok_ip(a.get("ip-address")):
                        return g["id"], a["ip-address"], None, cfg
        mac = None
        for v in nets:
            m = re.search(r"(?:virtio|e1000|rtl8139|vmxnet3|hwaddr)=([0-9A-Fa-f:]{17})", v)
            if m:
                mac = m.group(1).lower(); break
        return g["id"], None, mac, cfg
    cfgs = {}
    with ThreadPoolExecutor(8) as ex:
        for gid, ip, mac, cfg in ex.map(one, guests):
            cfgs[gid] = cfg
            if ip: ips[gid] = ip
            elif mac: macs[gid] = mac
    if macs:
        arp = _arp_table()
        if any(m not in arp for m in macs.values()):
            prefixes = {ip.rsplit(".", 1)[0] + "." for ip in ips.values()} or {"192.168.1."}
            _sweep(prefixes); arp = _arp_table()
        for gid, mac in macs.items():
            if mac in arp:
                ips[gid] = arp[mac]
    return ips, cfgs


# ---------------------------------------------------------------- probing
NON_HTTP = {53, 1883, 3306, 5432, 6379, 22000, 27017, 41641, 51820}


def _open(ip, port, timeout=0.7):
    """Is the port open? For anything that might be a web server, send a real HEAD request and read
    the reply before closing — some embedded servers (Pi-hole v6's civetweb) leak a worker thread for
    every connect-then-hang-up, and a scan of a few dozen ports can exhaust them."""
    s = socket.socket(); s.settimeout(timeout)
    try:
        if s.connect_ex((ip, port)) != 0:
            return False
        if port not in NON_HTTP:
            try:
                s.sendall(b"HEAD / HTTP/1.0\r\nHost: " + ip.encode() + b"\r\nUser-Agent: orrery-discover/1\r\nConnection: close\r\n\r\n")
                s.settimeout(1.5); s.recv(256)
            except OSError:
                pass
        return True
    except OSError:
        return False
    finally:
        try: s.shutdown(socket.SHUT_RDWR)
        except OSError: pass
        s.close()


def _fetch(ip, port, path, scheme=None):
    """(text, scheme) of title+body+server header, trying http then https unless pinned."""
    for sc in ([scheme] if scheme else (["https"] if port in (443, 8006, 8007, 8443, 9443, 8971) else ["http", "https"])):
        try:
            req = urllib.request.Request(f"{sc}://{ip}:{port}{path}", headers=UA)
            with urllib.request.urlopen(req, timeout=3, context=_CTX) as r:
                return r.read(40000).decode("utf8", "replace") + "\n" + str(r.headers.get("Server") or ""), sc
        except urllib.error.HTTPError as e:
            try: return e.read(20000).decode("utf8", "replace") + "\n" + str(e.headers.get("Server") or ""), sc
            except Exception: return "", sc
        except Exception:
            continue
    return None, None


def probe_guest(ip, tpls):
    ports = sorted({p for t in tpls for p in t["match"].get("ports", [])} |
                   {h["port"] for t in tpls for h in t["match"].get("http", [])})
    with ThreadPoolExecutor(4) as ex:   # gentle: at most 4 connections to one guest at a time
        openp = [p for p, ok in zip(ports, ex.map(lambda p: _open(ip, p), ports)) if ok]
    hits, cache = {}, {}
    want = [(t["key"], h) for t in tpls for h in t["match"].get("http", []) if h["port"] in openp]
    def get(k):
        if k not in cache:
            cache[k] = _fetch(ip, k[0], k[1], k[2])
        return cache[k]
    with ThreadPoolExecutor(4) as ex:
        keys = list({(h["port"], h["path"], h.get("scheme")) for _, h in want})
        for k, r in zip(keys, ex.map(get, keys)):
            cache[k] = r
    for key, h in want:
        body, sc = cache.get((h["port"], h["path"], h.get("scheme")), (None, None))
        if body and h["_re"].search(body):
            hits.setdefault(key, []).append({"port": h["port"], "path": h["path"], "scheme": sc})
    return openp, hits


def score(g, tags, openp, hits, t):
    m, s, why = t["match"], 0, []
    if t["key"] in hits:
        s += 60; h = hits[t["key"]][0]; why.append(f"answers like {t['label']} on :{h['port']}{h['path']}")
    if any(rx.search(g.get("name", "")) for rx in m["_names"]):
        s += 40; why.append("name")
    elif any(rx.search(tg) for rx in m["_names"] for tg in tags):
        s += 40; why.append("tag")
    pp = [p for p in m.get("ports", []) if p in openp]
    if pp:
        s += min(24, 12 * len(pp)); why.append("port " + ",".join(map(str, pp)))
    return s, why


def discover(pve_get, node, only=None):
    T = load_templates()
    tpls = [t for t in T["templates"] if t["key"] != "generic"]
    res = pve_get("cluster/resources", "type=vm", ttl=5)
    res = res if isinstance(res, list) else []
    guests = [g for g in res if g.get("type") in ("qemu", "lxc") and g.get("node") == node and not g.get("template")]
    if only:
        guests = [g for g in guests if g["id"] in only]
    ips, cfgs = guest_addresses(pve_get, node, guests)
    def one(g):
        tags = [x for x in re.split(r"[;, ]", g.get("tags") or "") if x]
        ip = ips.get(g["id"])
        openp, hits = probe_guest(ip, tpls) if ip and g.get("status") == "running" else ([], {})
        ms = []
        for t in tpls:
            s, why = score(g, tags, openp, hits, t)
            if s >= 30:
                ms.append({"key": t["key"], "score": min(100, s), "why": why, "url": _url(ip, hits.get(t["key"]))})
        ms.sort(key=lambda x: -x["score"])
        notes = (cfgs.get(g["id"]) or {}).get("description")
        return g["id"], {"vmid": g["vmid"], "name": g.get("name"), "type": g["type"], "status": g.get("status"), "ip": ip,
                         "open": openp, "matches": ms[:4], "notes": notes.strip() if isinstance(notes, str) else None,
                         "confidence": "confident" if ms and ms[0]["score"] >= 60 else "likely" if ms else "unknown"}
    with ThreadPoolExecutor(6) as ex:
        out = dict(ex.map(one, guests))
    return {"ts": time.time(), "node": node, "guests": out}


def _url(ip, h):
    if not ip or not h:
        return None
    h = h[0]
    path = h["path"] if h["path"].endswith("/") and not re.search(r"/(api|System|status\.php|alive|identity)", h["path"]) else "/"
    return f"{h['scheme']}://{ip}:{h['port']}{path}"
