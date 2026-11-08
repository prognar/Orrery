#!/usr/bin/env python3
"""Stop private details leaking into a public push.

Reads a deny-list that never leaves your machine (data/denylist.txt, or $ORRERY_DENYLIST):
one entry per line, plain text matched case-insensitively, or `re:` + a regex. `#` starts a comment.

    tools/leakcheck.py                    # scan everything tracked
    tools/leakcheck.py origin/main..HEAD  # scan only lines added in that range

Text files are checked line by line. Screenshots (png/jpg) are OCR'd when tesseract is installed;
animated webp/gif can't be read, so it reminds you to check them by eye. Exit code 1 on any hit.
Installed as a pre-push hook by tools/install-hooks.sh.
"""
import os, re, shutil, subprocess, sys, tempfile

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
DENY = os.environ.get("ORRERY_DENYLIST") or os.path.join(ROOT, "data", "denylist.txt")
IMG = (".png", ".jpg", ".jpeg")
ANIM = (".webp", ".gif")
SELF = {"tools/leakcheck.py"}
FROM_CONFIG = set()   # ids of patterns taken from data/*.json, so hits never print the secret itself


def git(*a, binary=False):
    r = subprocess.run(["git", "-C", ROOT, *a], capture_output=True, check=True)
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def load():
    if not os.path.exists(DENY):
        sys.exit(f"leakcheck: no deny-list at {DENY}. Create one (it is gitignored) or set ORRERY_DENYLIST.")
    pats = []
    for ln in open(DENY, encoding="utf-8"):
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        pats.append(re.compile(ln[3:] if ln.startswith("re:") else re.escape(ln), re.I))
    # every key, token and address in your own config is automatically off-limits too
    import json
    def walk(v):
        if isinstance(v, dict):
            for x in v.values(): yield from walk(x)
        elif isinstance(v, list):
            for x in v: yield from walk(x)
        elif isinstance(v, str) and len(v) >= 12 and " " not in v and not v.startswith("/"):
            yield v
    for f in ("config.json", "secrets.json"):
        try:
            for v in set(walk(json.load(open(os.path.join(ROOT, "data", f))))):
                pats.append(re.compile(re.escape(v))); FROM_CONFIG.add(id(pats[-1]))
        except (OSError, ValueError):
            pass
    return pats


def scan_text(name, lines, pats, hits):
    for n, ln in lines:
        secret = any(id(p) in FROM_CONFIG and p.search(ln) for p in pats)   # never echo a line holding a secret
        for p in pats:
            if p.search(ln):
                what = "a value from data/config.json or secrets.json" if id(p) in FROM_CONFIG else f"/{p.pattern}/"
                hits.append(f"{name}:{n}: matches {what}" + ("" if secret else f": {ln.strip()[:120]}"))


def main():
    pats = load()
    rng = sys.argv[1] if len(sys.argv) > 1 else None
    hits, anims, unread = [], [], []
    if rng:
        files = [f for f in git("diff", "--name-only", "--diff-filter=AMR", rng).splitlines() if f]
        for f in files:
            if f in SELF or f.lower().endswith(IMG + ANIM):
                continue
            n, out = 0, []
            for ln in git("diff", "-U0", rng, "--", f).splitlines():
                m = re.match(r"@@ -\S+ \+(\d+)", ln)
                if m:
                    n = int(m.group(1)); continue
                if ln.startswith("+") and not ln.startswith("+++"):
                    out.append((n, ln[1:])); n += 1
            scan_text(f, out, pats, hits)
        rev = rng.split("..")[-1] or "HEAD"
    else:
        files = [f for f in git("ls-files").splitlines() if f]
        for f in files:
            if f in SELF or f.lower().endswith(IMG + ANIM):
                continue
            try:
                txt = open(os.path.join(ROOT, f), encoding="utf-8").read()
            except (UnicodeDecodeError, FileNotFoundError):
                continue
            scan_text(f, enumerate(txt.splitlines(), 1), pats, hits)
        rev = "HEAD"
    for f in files:                                   # file names themselves
        scan_text("(filename)", [(0, f)], pats, hits)
    ocr = shutil.which("tesseract")
    for f in files:
        low = f.lower()
        if low.endswith(ANIM):
            anims.append(f)
        elif low.endswith(IMG):
            if not ocr:
                unread.append(f); continue
            with tempfile.NamedTemporaryFile(suffix=os.path.splitext(f)[1]) as t:
                t.write(git("show", f"{rev}:{f}", binary=True)); t.flush()
                txt = subprocess.run([ocr, t.name, "-"], capture_output=True, text=True).stdout
            scan_text(f + " (ocr)", enumerate(txt.splitlines(), 1), pats, hits)
    for h in hits:
        print("LEAK  " + h)
    for f in unread:
        print("CHECK " + f + "  (install tesseract-ocr to scan screenshots)")
    for f in anims:
        print("CHECK " + f + "  (animation: look at it before publishing)")
    if hits:
        print(f"\nleakcheck: {len(hits)} hit(s). Fix them, or adjust {DENY} if a pattern is too broad.")
        sys.exit(1)
    print(f"leakcheck: clean ({len(files)} files, {len(pats)} patterns)")


if __name__ == "__main__":
    main()
