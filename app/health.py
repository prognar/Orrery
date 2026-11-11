"""Health of other servers (the non-Proxmox planets), from whichever monitoring agent the machine runs:

  LibreHardwareMonitor  Windows. Options -> Remote Web Server -> Run (port 8085). CPU/GPU temperatures and load,
                        RAM, VRAM, drive temperatures. The only common agent that reports GPU temperature.
  Glances               Linux / macOS / Pi.  `glances -w` (port 61208). CPU, RAM, sensors.
  Netdata               Any OS. Read through your Netdata parent when the machine streams to it, or directly on :19999.

detect() is called when a server is scanned; read() is cached for a few seconds. Every value is optional.
"""
import errno, json, re, socket, time, urllib.parse, urllib.request

UA = {"User-Agent": "orrery-health/1"}
LHM_PORT, GLANCES_PORT, NETDATA_PORT = 8085, 61208, 19999
_cache = {}


def _get(url, timeout=3):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.loads(r.read())


def _num(s):
    """'55,8 °C' / '23.4 %' / '1 234 MB' -> float"""
    if isinstance(s, (int, float)):
        return float(s)
    m = re.search(r"-?\d[\d\s]*(?:[.,]\d+)?", str(s or ""))
    return float(m.group(0).replace(" ", "").replace(",", ".")) if m else None


# ---------------------------------------------------------------- detection
def detect(addr, name, nd_parent=None):
    """Which agent answers for this machine? Returns {"kind": ..., ...} or None."""
    try:
        d = _get(f"http://{addr}:{LHM_PORT}/data.json", 3)
        if isinstance(d, dict) and "Children" in d:
            return {"kind": "lhm", "port": LHM_PORT}
    except Exception:
        pass
    for v in ("4", "3"):
        try:
            d = _get(f"http://{addr}:{GLANCES_PORT}/api/{v}/quicklook", 3)
            if isinstance(d, dict) and "cpu" in d:
                return {"kind": "glances", "port": GLANCES_PORT, "api": v}
        except Exception:
            pass
    if nd_parent:
        try:
            nodes = _get(nd_parent.rstrip("/") + "/api/v2/nodes", 4).get("nodes") or []
            for n in nodes:
                nm = n.get("nm") or ""
                if nm and nm.lower() in {str(name or "").lower(), str(addr).lower()}:
                    return {"kind": "netdata", "base": f"{nd_parent.rstrip('/')}/host/{urllib.parse.quote(nm)}", "node": nm}
        except Exception:
            pass
    try:
        if "version" in _get(f"http://{addr}:{NETDATA_PORT}/api/v1/info", 3):
            return {"kind": "netdata", "base": f"http://{addr}:{NETDATA_PORT}"}
    except Exception:
        pass
    return None


# ---------------------------------------------------------------- readers
def _val(s, kind=None):
    """LHM value with its unit -> number in Orrery's units: °C, B/s, MiB, %, RPM, W."""
    s = str(s or "")
    v = _num(s)
    if v is None:
        return None
    u = s.strip().split()[-1] if " " in s.strip() else ""
    if u in ("°F", "F"):                     # LHM can be set to Fahrenheit
        return (v - 32) * 5 / 9
    mult = {"B/s": 1, "KB/s": 1024, "MB/s": 1048576, "GB/s": 1073741824, "MB": 1, "GB": 1024, "TB": 1048576, "KB": 1 / 1024}
    return v * mult[u] if u in mult else v


def _lhm(addr, h):
    root = _get(f"http://{addr}:{h.get('port', LHM_PORT)}/data.json", 4)
    out = {"src": "LibreHardwareMonitor", "disks": [], "fans": [], "cores": []}
    kids = lambda n: n.get("Children") or []
    def groups(hw):
        g = {}
        for x in kids(hw):
            if kids(x) and not kids(kids(x)[0]):
                g.setdefault(x.get("Text", ""), []).extend(kids(x))
        return g
    def find(sensors, prefer, fallback_max=True):
        for rx in prefer:
            for s in sensors:
                if re.search(rx, s.get("Text", ""), re.I) and _val(s.get("Value")) is not None:
                    return _val(s.get("Value"))
        vals = [_val(s.get("Value")) for s in sensors if _val(s.get("Value")) is not None]
        return max(vals) if vals and fallback_max else None
    hws = []
    def collect(n):                           # hardware can nest (mainboard -> super I/O chip)
        for c in kids(n):
            if c.get("ImageURL") and any(kids(k) for k in kids(c)):
                hws.append(c); collect(c)
    for m in kids(root):
        collect(m)
    gpus, net = [], {"down": 0.0, "up": 0.0}
    for hw in hws:
        img, txt, G = (hw.get("ImageURL") or "").lower(), hw.get("Text", ""), groups(hw)
        temps, load, data = G.get("Temperatures", []), G.get("Load", []), G.get("Data", []) + G.get("SmallData", [])
        if "cpu" in img and "cpuName" not in out:
            out["cpuName"], out["cpu"] = txt, find(load, [r"^CPU Total$"])
            out["cpuT"] = find(temps, [r"package", r"tctl|tdie", r"^CPU$", r"core.*max", r"average"])
            out["cpuW"] = find(G.get("Powers", []), [r"^Package$", r"^CPU Package$"], False)
            out["cores"] = [round(_val(s["Value"]), 1) for s in load if re.match(r"^CPU Core #\d+$", s.get("Text", "")) and _val(s.get("Value")) is not None]
        elif re.search(r"nvidia|ati|amd|radeon|gpu|intel", img) and img.split("/")[-1] != "cpu.png":
            vt = find(data, [r"^GPU Memory Total$"], False) or 0
            gpus.append({"gpuName": txt, "gpu": find(load, [r"^GPU Core$", r"^D3D 3D$"]),
                         "gpuT": find(temps, [r"^GPU Core$", r"^GPU$"]), "gpuHot": find(temps, [r"hot ?spot"], False),
                         "gpuMemT": find(temps, [r"memory junction"], False), "gpuW": find(G.get("Powers", []), [r"package", r"board"]),
                         "vram": [find(data, [r"^GPU Memory Used$"], False) or 0, vt],
                         "gpuFans": [_val(s["Value"]) for s in G.get("Fans", []) if _val(s.get("Value"))], "_rank": vt + (20000 if "nvidia" in img else 0)})
        elif "ram" in img and re.search(r"^total memory$|^generic memory$|^memory$", txt, re.I):
            used, avail = find(data, [r"^Memory Used$"], False), find(data, [r"^Memory Available$"], False)
            if used is not None and avail is not None:
                out["ram"] = [used, used + avail]                                    # MiB
            out["ramPct"] = find(load, [r"^Memory$"], False)
        elif "ram" in img and temps:
            t = find(temps, [r"^DIMM"], False)
            if t is not None: out["dimmT"] = max(out.get("dimmT") or 0, t)
        elif "hdd" in img or "nvme" in img or "ssd" in img:
            out["disks"].append({"name": txt[:30], "t": find(temps, [r"composite", r"^Temperature$"]),
                                 "tWarn": find(temps, [r"warning"], False), "used": find(load, [r"used space"], False),
                                 "act": find(load, [r"total activity"], False), "life": find(G.get("Levels", []), [r"^Life$"], False),
                                 "size": find(data, [r"total space"], False),                  # MiB
                                 "read": find(G.get("Throughput", []), [r"read rate"], False) or 0,
                                 "write": find(G.get("Throughput", []), [r"write rate"], False) or 0})
        elif "nic" in img:
            th = G.get("Throughput", [])
            net["down"] += find(th, [r"download"], False) or 0; net["up"] += find(th, [r"upload"], False) or 0
        if "chip" in img or "mainboard" in img:
            for s in G.get("Fans", []):
                r = _val(s.get("Value"))
                if r: out["fans"].append({"name": s.get("Text", ""), "rpm": r})
    if gpus:                                            # the discrete card, not the iGPU
        g = max(gpus, key=lambda x: x["_rank"]); g.pop("_rank")
        if not g["vram"][1]: g.pop("vram")
        for f in g.pop("gpuFans"): out["fans"].append({"name": "GPU", "rpm": f, "gpu": True})
        out.update(g)
    out["net"] = net
    return out


def _glances(addr, h):
    b = f"http://{addr}:{h.get('port', GLANCES_PORT)}/api/{h.get('api', '4')}"
    q = _get(b + "/quicklook")
    out = {"src": "Glances", "cpu": q.get("cpu"), "ramPct": q.get("mem"), "cpuName": q.get("cpu_name"), "disks": [], "fans": [], "cores": []}
    def opt(path):
        try: return _get(b + path)
        except Exception: return None
    m = opt("/mem")
    if m: out["ram"] = [(m.get("used") or 0) / 1048576, (m.get("total") or 0) / 1048576]
    pc = opt("/percpu")
    if isinstance(pc, list): out["cores"] = [round(100 - (c.get("idle") or 0), 1) for c in pc]
    S = opt("/sensors") or []
    core = [s.get("value") for s in S if str(s.get("type", "")).startswith("temperature") and isinstance(s.get("value"), (int, float))]
    gpu = [s.get("value") for s in S if re.search(r"gpu|amdgpu|nvidia|edge", str(s.get("label", "")), re.I) and isinstance(s.get("value"), (int, float))]
    if core: out["cpuT"] = max(core)
    if gpu: out["gpuT"] = max(gpu)
    out["fans"] = [{"name": s.get("label", ""), "rpm": s["value"]} for s in S if s.get("type") == "fan_speed" and s.get("value")]
    for f in opt("/fs") or []:
        if (f.get("size") or 0) > 2 ** 30:
            out["disks"].append({"name": f.get("mnt_point") or f.get("device_name"), "used": f.get("percent"), "size": f["size"] / 1048576, "read": 0, "write": 0})
    io = opt("/diskio") or []
    if io and out["disks"]:
        out["disks"][0]["read"] = sum(d.get("read_bytes_rate_per_sec") or d.get("read_bytes", 0) for d in io)
        out["disks"][0]["write"] = sum(d.get("write_bytes_rate_per_sec") or d.get("write_bytes", 0) for d in io)
    nets = opt("/network") or []
    out["net"] = {"down": sum(n.get("bytes_recv_rate_per_sec") or n.get("rx", 0) for n in nets if not str(n.get("interface_name", "")).startswith("lo")),
                  "up": sum(n.get("bytes_sent_rate_per_sec") or n.get("tx", 0) for n in nets if not str(n.get("interface_name", "")).startswith("lo"))}
    up = opt("/uptime")
    if up: out["up"] = up
    return out


def _netdata(addr, h):
    b = h["base"]
    def latest(chart):
        d = _get(f"{b}/api/v1/data?chart={urllib.parse.quote(chart)}&after=-6&points=1&format=json&options=abs", 4)
        row = (d.get("data") or [[None]])[0]
        return {k: v for k, v in zip(d.get("labels", []), row) if k != "time" and v is not None}
    out = {"src": "Netdata", "disks": []}
    try:
        c = latest("system.cpu"); out["cpu"] = sum(v for v in c.values() if isinstance(v, (int, float)))
    except Exception:
        pass
    try:
        r = latest("system.ram"); used, tot = r.get("used"), sum(v for v in r.values() if isinstance(v, (int, float)))
        if used is not None and tot: out["ram"] = [used, tot]
    except Exception:
        pass
    try:
        out["up"] = latest("system.uptime").get("uptime")
    except Exception:
        pass
    return out


AGENTS = {"lhm": ("LibreHardwareMonitor", LHM_PORT), "glances": ("Glances", GLANCES_PORT), "netdata": ("Netdata", NETDATA_PORT)}


def _tcp(addr, port, timeout=3):
    s = socket.socket(); s.settimeout(timeout)
    try:
        rc = s.connect_ex((addr, port))          # a timeout comes back as an error code, not an exception
    except socket.timeout:
        return "timeout"
    except OSError:
        return "unreachable"
    finally:
        s.close()
    if rc == 0: return "open"
    if rc == errno.ECONNREFUSED: return "refused"
    if rc in (errno.EAGAIN, errno.EWOULDBLOCK, errno.ETIMEDOUT, errno.EINPROGRESS): return "timeout"
    return "unreachable"


def connect(kind, addr, port=None, name="", nd_parent=None):
    """The user picked an agent on purpose: test it now. Returns (config, None) or (None, reason)."""
    if kind not in AGENTS:
        return None, "Unknown agent."
    label, dport = AGENTS[kind]
    port = int(port or dport)
    if kind == "netdata" and nd_parent and port == NETDATA_PORT:     # streamed to a parent? read it there
        h = detect(addr, name, nd_parent)
        if h and h["kind"] == "netdata":
            return h, None
    st = _tcp(addr, port)
    if st == "timeout":
        return None, (f"No answer from {addr}:{port} within 3 s. That's almost always a firewall: on Windows, allow inbound TCP {port} "
                      f"for your home network (and check the network is set to Private).")
    if st == "refused":
        return None, f"{addr} answered, but nothing is listening on port {port}. Is {label} running with its web server switched on?"
    if st != "open":
        return None, f"Can't reach {addr} at all from Orrery."
    h = {"kind": kind, "port": port}
    if kind == "netdata":
        h = {"kind": "netdata", "base": f"http://{addr}:{port}"}
    if kind == "glances":
        for v in ("4", "3"):
            try:
                if "cpu" in _get(f"http://{addr}:{port}/api/{v}/quicklook", 4):
                    h["api"] = v; break
            except Exception:
                pass
        else:
            return None, f"Port {port} is open, but it doesn't answer like Glances (try `glances -w`)."
    try:
        v = READERS[kind](addr, h)
    except Exception as e:
        return None, f"Port {port} is open, but it doesn't answer like {label} ({str(e)[:80]})."
    if not any(v.get(k) is not None for k in ("cpu", "cpuT", "ram", "gpu")):
        return None, f"{label} answered but reported no CPU, RAM or GPU readings. On Windows, run it as administrator."
    return h, None


READERS = {"lhm": _lhm, "glances": _glances, "netdata": _netdata}


def read(addr, h, ttl=8):
    if not h or h.get("kind") not in READERS:
        return None
    k, now = (addr, h["kind"]), time.time()
    hit = _cache.get(k)
    if hit and now - hit[0] < ttl:
        return hit[1]
    try:
        v = READERS[h["kind"]](addr, h)
        if v.get("ram") and v["ram"][1] and v.get("ramPct") is None:
            v["ramPct"] = v["ram"][0] / v["ram"][1] * 100
        assess(addr, v)
    except Exception as e:
        v = {"src": h["kind"], "__error": str(e)[:120]}
    _cache[k] = (now, v)
    return v


# ---------------------------------------------------------------- status: is this machine OK?
# (attention, critical) thresholds. Temperatures in °C, the rest in %.
LIMITS = {
    "cpuT": (80, 89), "gpuT": (83, 90), "gpuHot": (95, 105), "gpuMemT": (95, 105),
    "ram": (85, 95), "fill": (85, 95), "life": (20, 10),
}
LEVEL = {0: "ok", 1: "warn", 2: "crit"}
_fans_seen = {}        # (addr, fan name) -> highest RPM seen, to notice a fan that stops


def _lvl(v, key, lower_is_bad=False):
    if v is None:
        return 0
    a, c = LIMITS[key]
    if lower_is_bad:
        return 2 if v <= c else 1 if v <= a else 0
    return 2 if v >= c else 1 if v >= a else 0


def assess(addr, H):
    """Rate every reading ok / warn / crit and the machine as a whole (the worst of them).
    Adds H["status"] and H["checks"] = [{sys, label, value, level, why}] (worst first)."""
    if not H or H.get("__error"):
        return H
    C = []
    def add(sys, label, value, level, why=""):
        C.append({"sys": sys, "label": label, "value": value, "level": level, "why": why})
    if H.get("cpuT") is not None:
        l = _lvl(H["cpuT"], "cpuT"); add("cpu", "CPU temperature", f"{H['cpuT']:.0f} °C", l, "CPU running hot" if l == 1 else "CPU at its thermal limit" if l else "")
    if H.get("cpu") is not None:
        add("cpu", "CPU load", f"{H['cpu']:.0f}%", 0)
    for k, lab in (("gpuT", "GPU temperature"), ("gpuHot", "GPU hot spot"), ("gpuMemT", "GPU memory")):
        if H.get(k) is not None:
            l = _lvl(H[k], k); add("gpu", lab, f"{H[k]:.0f} °C", l, f"{lab} high" if l else "")
    if H.get("ramPct") is not None:
        l = _lvl(H["ramPct"], "ram"); add("ram", "Memory in use", f"{H['ramPct']:.0f}%", l, "memory almost full" if l == 2 else "memory filling up" if l else "")
    for d in H.get("disks") or []:
        nm = d.get("name") or "drive"
        if d.get("used") is not None:
            l = _lvl(d["used"], "fill"); add("disk", f"{nm} full", f"{d['used']:.0f}%", l, f"{nm} {d['used']:.0f}% full" if l else "")
            d["level"] = l
        if d.get("t") is not None:
            w = d.get("tWarn") or 70
            l = 2 if d["t"] >= w else 1 if d["t"] >= w - 5 else 0
            add("disk", f"{nm} temperature", f"{d['t']:.0f} °C", l, f"{nm} hot" if l else ""); d["level"] = max(d.get("level", 0), l)
        if d.get("life") is not None:
            l = _lvl(d["life"], "life", True); add("disk", f"{nm} life left", f"{d['life']:.0f}%", l, f"{nm} wearing out" if l else ""); d["level"] = max(d.get("level", 0), l)
    for f in H.get("fans") or []:
        if f.get("gpu"):
            continue                    # GPUs park their fans when cool; that's normal
        k = (addr, f.get("name"))
        _fans_seen[k] = max(_fans_seen.get(k, 0), f.get("rpm") or 0)
    stopped = [n for (a, n), top in _fans_seen.items() if a == addr and top > 300 and not any(f.get("name") == n and (f.get("rpm") or 0) > 0 for f in H.get("fans") or [])]
    for n in stopped:
        add("fan", f"{n}", "stopped", 1, f"{n} has stopped")
    fans = [f for f in H.get("fans") or [] if (f.get("rpm") or 0) > 0]
    if fans:
        add("fan", "Fans spinning", f"{len(fans)} · {max(f['rpm'] for f in fans):.0f} rpm max", 0)
    C.sort(key=lambda c: -c["level"])
    H["checks"] = C
    H["level"] = max([c["level"] for c in C] or [0])
    H["status"] = LEVEL[H["level"]]
    H["why"] = [c["why"] for c in C if c["level"] == H["level"] and c["why"]][:3]
    return H
