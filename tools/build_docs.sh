#!/bin/bash
# Turn raw captures into README assets, then render a GitHub-accurate preview.
# Usage: build_docs.sh SHOTS_DIR REPO_DIR PREVIEW_DIR
set -e
S=$1 R=$2 P=$3
I=$R/docs/images; mkdir -p $I
for f in orbit hover-netviz hover-pihole hover-abs hover-romm hover-seerr hover-ha hover-plex pulse vaults chron manifest setup wizard-welcome wizard-discover wizard-connect wizard-media wizard-network wizard-servers; do
  [ -f $S/$f.png ] && ffmpeg -loglevel error -y -i $S/$f.png -vf "scale=2400:-1:flags=lanczos" -q:v 3 $I/$f.jpg
done
webp() { ffmpeg -loglevel error -y -framerate 15 -i $S/frames/$1/%03d.png -vf "scale=${2:-1100}:-1:flags=lanczos" -c:v libwebp_anim -lossless 0 -q:v ${3:-72} -compression_level 6 -loop 0 $I/$1.webp; }
webp hero 1100; webp pihole 900; webp media 900; webp listen 900
pal="split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle"
ffmpeg -loglevel error -y -framerate 1/2.4 -i $S/frames/wizard/%02d.png -vf "scale=1200:-1:flags=lanczos,$pal" -loop 0 $I/wizard.gif
ls -la $I

# preview: GitHub's own markdown renderer + github-markdown-css, served from the repo folder
mkdir -p $P; rm -rf $P/docs; cp -r $R/docs $P/; cp $R/README.md $R/templates.json $P/
python3 - "$P" <<'EOF'
import json, sys, urllib.request
P = sys.argv[1]
md = open(f"{P}/README.md").read()
req = urllib.request.Request("https://api.github.com/markdown", json.dumps({"text": md, "mode": "gfm"}).encode(),
                             {"Accept": "application/vnd.github+json", "User-Agent": "orrery-docs"})
body = urllib.request.urlopen(req, timeout=30).read().decode()
css = urllib.request.urlopen("https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-dark.min.css", timeout=30).read().decode()
open(f"{P}/index.html", "w").write(f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Orrery README preview</title><style>{css}
body{{background:#0d1117;margin:0}}.markdown-body{{box-sizing:border-box;max-width:1012px;margin:0 auto;padding:45px}}
.bar{{background:#161b22;color:#8b949e;font:13px system-ui;padding:10px 16px;border-bottom:1px solid #30363d}}</style></head>
<body><div class="bar">README preview, rendered by GitHub's Markdown API. Not published anywhere yet.</div><article class="markdown-body">{body}</article></body></html>""")
print("preview html", len(body))
EOF
