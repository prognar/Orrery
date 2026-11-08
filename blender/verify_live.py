"""Headless check of the live Orrery 3D view against real data. Prints JSON; saves a screenshot."""
import json, sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/"
out = {"errors": []}
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1600, "height": 900})
    pg.on("pageerror", lambda e: out["errors"].append("page: " + str(e)))
    pg.on("console", lambda m: m.type == "error" and out["errors"].append("console: " + m.text))
    pg.goto(URL); pg.wait_for_timeout(15000)
    out["mode3d"] = pg.evaluate("S.mode3d")
    out["stats"] = pg.evaluate("window.__o3d && window.__o3d.stats")
    out["labels"] = pg.evaluate("[...document.querySelectorAll('.o3-lab b')].map(b=>b.textContent).slice(0,30)")
    out["tether"] = pg.evaluate("(document.querySelector('.o3-tether')||{}).textContent")
    out["status_overlay"] = pg.evaluate("!!document.querySelector('.o3-status')")
    out["sub"] = pg.evaluate("document.getElementById('orbit-sub').textContent")
    pg.screenshot(path="/root/live.jpg", type="jpeg", quality=70)
    b.close()
print(json.dumps(out, indent=1))
