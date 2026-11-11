"""Health of other servers (the non-Proxmox planets), from whichever monitoring agent the machine runs:

  LibreHardwareMonitor  Windows. Options -> Remote Web Server -> Run (port 8085). CPU/GPU temperatures and load,
                        RAM, VRAM, drive temperatures. The only common agent that reports GPU temperature.
  Glances               Linux / macOS / Pi.  `glances -w` (port 61208). CPU, RAM, sensors.
  Netdata               Any OS. Read through your Netdata parent when the machine streams to it, or directly on :19999.

detect() is called when a server is scanned; read() is cached for a few seconds. Every value is optional.
"""
import json, re, time, urllib.parse, urllib.request

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
def _lhm(addr, h):
    root = _get(f"http://{addr}:{h.get('port', LHM_PORT)}/data.json", 4)
    out = {"src": "LibreHardwareMonitor", "disks": []}
    def kids(n): return n.get("Children") or []
    def groups(hw): return {g.get("Text", ""): kids(g) for g in kids(hw)}
    def pick(sensors, prefer):
        for rx in prefer:
            for s in sensors:
                if re.search(rx, s.get("Text", ""), re.I) and _num(s.get("Value")) is not None:
                    return _num(s.get("Value"))
        vals = [_num(s.get("Value")) for s in sensors if _num(s.get("Value")) is not None]
        return max(vals) if vals else None
    hws = [hw for m in kids(root) for hw in kids(m)]
    for hw in hws:
        img, txt = (hw.get("ImageURL") or "").lower(), hw.get("Text", "")
        G = groups(hw)
        temps, load, data = G.get("Temperatures", []), G.get("Load", []), G.get("Data", []) + G.get("SmallData", [])
        if "cpu" in img and "cpu" not in out:
            out["cpu"] = pick(load, [r"^CPU Total$"])
            out["cpuT"] = pick(temps, [r"package", r"tctl|tdie", r"^CPU$", r"core.*max", r"average"])
            out["cpuName"] = txt
        elif re.search(r"nvidia|ati|amd|radeon|gpu", img) or re.search(r"geforce|radeon|rtx|gtx|\barc\b", txt, re.I):
            if "gpu" in out:
                continue
            out["gpu"] = pick(load, [r"^GPU Core$", r"^D3D 3D$"])
            out["gpuT"] = pick(temps, [r"^GPU Core$", r"^GPU$", r"hot ?spot"])
            used, tot = pick(data, [r"GPU Memory Used", r"D3D Dedicated Memory Used"]), pick(data, [r"GPU Memory Total"])
            if used is not None and tot: out["vram"] = [used, tot]          # MB
            out["gpuName"] = txt
        elif "ram" in img and "ram" not in out:
            used, avail = pick(data, [r"^Memory Used$", r"^Used Memory$"]), pick(data, [r"^Memory Available$", r"^Available Memory$"])
            if used is not None and avail is not None:
                out["ram"] = [used * 1024, (used + avail) * 1024]                # MiB
            out["ramPct"] = pick(load, [r"^Memory$"])
        elif "hdd" in img or "nvme" in img or "ssd" in img:
            t = pick(temps, [r"temperature", r"composite"])
            u = pick(load, [r"used space"])
            out["disks"].append({"name": txt[:28], "t": t, "used": u})
    return out


def _glances(addr, h):
    b = f"http://{addr}:{h.get('port', GLANCES_PORT)}/api/{h.get('api', '4')}"
    q = _get(b + "/quicklook")
    out = {"src": "Glances", "cpu": q.get("cpu"), "ramPct": q.get("mem"), "cpuName": q.get("cpu_name"), "disks": []}
    try:
        m = _get(b + "/mem"); out["ram"] = [(m.get("used") or 0) / 1048576, (m.get("total") or 0) / 1048576]
    except Exception:
        pass
    try:
        S = _get(b + "/sensors")
        core = [s.get("value") for s in S if str(s.get("type", "")).startswith("temperature") and isinstance(s.get("value"), (int, float))]
        gpu = [s.get("value") for s in S if re.search(r"gpu|amdgpu|nvidia|edge", str(s.get("label", "")), re.I) and isinstance(s.get("value"), (int, float))]
        if core: out["cpuT"] = max(core)
        if gpu: out["gpuT"] = max(gpu)
    except Exception:
        pass
    try:
        out["up"] = _get(b + "/uptime")
    except Exception:
        pass
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
    except Exception as e:
        v = {"src": h["kind"], "__error": str(e)[:120]}
    _cache[k] = (now, v)
    return v
