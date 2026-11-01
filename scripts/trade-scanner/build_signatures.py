#!/usr/bin/env python3
"""
Build Code/TradeScanner/itemSignatures.json: one small picture signature per
tradeable item for the Trade Scanner (Code/TradeScanner/matcher.js).

    ADOPTME_IMG_BASE=https://<image host> python3 scripts/trade-scanner/build_signatures.py [--cache DIR]
    npm run scanner:build                  (then repack the WebView page)

ADOPTME_IMG_BASE is the same image host the app reads from RTDB image_url
(the website's NEXT_PUBLIC_IMG_CDN). --cache DIR reuses / stores the PNGs.
Reads the live catalogue (adoptme.b-cdn.net/data.json). Re-run when items are
added.

Signature = icon composited on the trade tile colour BG, "icon pixel" = opaque
and |rgb - BG| > FG_DIFF (the same test matcher.js tileSignature() applies to
a screenshot, so white parts of an icon drop out on both sides), cropped to
those pixels, padded to a square and box-filtered to N x N. Stored as RGBA
bytes, A = share of icon pixels; non-icon pixels count as BG.
"""
import argparse
import base64
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date

from PIL import Image

N = 20
BG = (244, 254, 244)   # matcher.js BG
FG_DIFF = 45           # matcher.js FG_DIFF
TYPES = ['pets', 'eggs', 'vehicles', 'strollers', 'toys', 'food', 'gifts', 'other']
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'Code', 'TradeScanner', 'itemSignatures.json')
CATALOG = 'https://adoptme.b-cdn.net/data.json'


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'adoptme-build'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def signature(im):
    im = im.convert('RGBA')
    im.thumbnail((192, 192), Image.LANCZOS)
    w, h = im.size
    px = im.load()
    fg = [[False] * w for _ in range(h)]
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            # Composite on the tile, then the same test as a screenshot pixel.
            k = a / 255
            cr, cg, cb = r * k + BG[0] * (1 - k), g * k + BG[1] * (1 - k), b * k + BG[2] * (1 - k)
            if abs(cr - BG[0]) + abs(cg - BG[1]) + abs(cb - BG[2]) > FG_DIFF:
                fg[y][x] = (cr, cg, cb)
                x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
    if x1 < 0:
        return None
    bw, bh = x1 + 1 - x0, y1 + 1 - y0
    s = max(bw, bh)
    ox, oy = x0 - (s - bw) / 2, y0 - (s - bh) / 2
    raw = bytearray()
    for j in range(N):
        for i in range(N):
            sx0 = int((ox + i * s / N) // 1)
            sx1 = max(sx0 + 1, int((ox + (i + 1) * s / N) // 1))
            sy0 = int((oy + j * s / N) // 1)
            sy1 = max(sy0 + 1, int((oy + (j + 1) * s / N) // 1))
            r = g = b = al = cnt = 0
            for y in range(sy0, sy1):
                for x in range(sx0, sx1):
                    v = fg[y][x] if x0 <= x <= x1 and y0 <= y <= y1 else False
                    if v:
                        r += v[0]; g += v[1]; b += v[2]; al += 1
                    else:
                        r += BG[0]; g += BG[1]; b += BG[2]
                    cnt += 1
            raw += bytes([round(r / cnt), round(g / cnt), round(b / cnt), round(255 * al / cnt)])
    return base64.b64encode(bytes(raw)).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', help='folder of <id>.png icons (read first, written on download)')
    args = ap.parse_args()
    base = os.environ.get('ADOPTME_IMG_BASE', '').rstrip('/')
    catalog = json.loads(fetch(CATALOG))
    items, missing = [], []
    for entry in catalog:
        name, image, typ = entry.get('name'), entry.get('image'), entry.get('type')
        if typ not in TYPES or not name or not image or name == 'nan':
            continue
        path = os.path.join(args.cache, f"{entry['id']}.png") if args.cache else None
        try:
            if path and os.path.exists(path):
                data = open(path, 'rb').read()
            else:
                if not base:
                    sys.exit('set ADOPTME_IMG_BASE (or --cache with the icons)')
                data = fetch(base + urllib.parse.quote(image))
                if path:
                    open(path, 'wb').write(data)
            sig = signature(Image.open(io.BytesIO(data)))
        except Exception as e:  # 404 or undecodable
            sig = None
            print(f'  {name}: {e}', file=sys.stderr)
        if sig:
            items.append({'id': entry['id'], 'name': name, 'type': typ, 'sig': sig})
        else:
            missing.append(name)
    out = {'N': N, 'built': date.today().isoformat(), 'types': TYPES, 'items': items}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
        f.write('\n')
    print(f'{len(items)} signatures -> {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB); no icon: {len(missing)} {missing[:20]}')


if __name__ == '__main__':
    main()
