#!/usr/bin/env python3
# Pet Runway anchor points: where hats, glasses, necklaces, wings and held items sit on each pet.
# Finds them from the eyes (Adopt Me pets have big dark glossy eyes) in the Pet Cards HD art, then
# applies hand-set points from overrides.json. Also stores each pet's display name.
#
#   PET_ART_DIR=<folder of <key>.webp from cardspull.b-cdn.net/v1/pets/512/> python3 scripts/pet-runway/anchors.py
#
# Writes Code/PetRunway/game/anchors.json; then run `npm run runway:build`.
import json, glob, os, re, sys, urllib.request
from collections import deque
from PIL import Image

N = 256
def comps(mask):
    h, w = len(mask), len(mask[0]); seen = [[False] * w for _ in range(h)]; out = []
    for y in range(h):
        for x in range(w):
            if mask[y][x] and not seen[y][x]:
                q = deque([(y, x)]); seen[y][x] = True; pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny, nx = cy+dy, cx+dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx] = True; q.append((ny, nx))
                out.append(pts)
    return out

def analyse(path):
    im = Image.open(path).convert('RGBA').resize((N, N)); px = im.load()
    al = [[px[x, y][3] for x in range(N)] for y in range(N)]
    lum = [[.299 * px[x, y][0] + .587 * px[x, y][1] + .114 * px[x, y][2] for x in range(N)] for y in range(N)]
    sat = [[max(px[x, y][:3]) - min(px[x, y][:3]) for x in range(N)] for y in range(N)]
    solid = [(x, y) for y in range(N) for x in range(N) if al[y][x] > 128]
    xs = [p[0] for p in solid]; ys = [p[1] for p in solid]
    bx0, bx1, by0, by1 = min(xs), max(xs), min(ys), max(ys)
    bw, bh = bx1 - bx0, by1 - by0
    ls = sorted(lum[y][x] for x, y in solid); body_lum = ls[len(ls) // 2]
    cut = by0 + bh * .8
    dark = [[al[y][x] > 200 and lum[y][x] < min(70, body_lum * .55) and sat[y][x] < 60 and y < cut for x in range(N)] for y in range(N)]
    cands = []
    for p in comps(dark):
        n = len(p)
        if n < 8 or n > N * N * .02: continue
        py = [q[0] for q in p]; pxs = [q[1] for q in p]
        hh, ww = max(py) - min(py) + 1, max(pxs) - min(pxs) + 1
        if not (.45 < hh / ww < 2.4) or n / (hh * ww) < .5: continue
        cands.append(dict(x=sum(pxs) / n, y=sum(py) / n, n=n, w=ww, h=hh))
    best = None
    for i in range(len(cands)):
        for j in range(i + 1, len(cands)):
            A, B = cands[i], cands[j]
            d = abs(A['x'] - B['x'])
            if abs(A['y'] - B['y']) < max(A['h'], B['h']) * .8 and .4 < A['n'] / B['n'] < 2.5 and A['w'] * 1.2 < d < bw * .6:
                sc = (A['n'] + B['n']) - abs(A['y'] - B['y']) * 4 - (A['y'] + B['y']) * .05
                if not best or sc > best[0]: best = (sc, A, B)
    if best:
        _, A, B = best; ex, ey = (A['x'] + B['x']) / 2, (A['y'] + B['y']) / 2
        span = abs(A['x'] - B['x']); eyes_w = span * 1.9; kind = 'pair'
    elif cands:
        C = max(cands, key=lambda c: c['n'] - c['y'] * .5)
        ex, ey = C['x'], C['y']; span = C['w'] * 2.4; eyes_w = span * 1.3; kind = 'one'
    else:
        ex, ey = (bx0 + bx1) / 2, by0 + bh * .3; span = bw * .25; eyes_w = span * 1.8; kind = 'none'
    c0, c1 = max(0, int(ex - span * .25)), min(N - 1, int(ex + span * .25))
    top = next((y for y in range(N) if any(al[y][x] > 128 for x in range(c0, c1 + 1))), by0)
    head_y = max(top, ey - span * 1.45)
    neck_y = min(ey + span * 1.15, by1 - bh * .15)
    f = lambda v: round(float(v) / N, 3)
    return kind, {
        'head': {'x': f(ex), 'y': f(head_y), 'w': f(span * 2.4)},
        'eyes': {'x': f(ex), 'y': f(ey), 'w': f(eyes_w)},
        'cheeks': {'x': f(ex), 'y': f(ey + span * .5), 'w': f(span * 2.1)},
        'neck': {'x': f(ex), 'y': f(neck_y), 'w': f(span * 2.2)},
        'body': {'x': f((bx0 + bx1) / 2), 'y': f(by0 + bh * .6), 'w': f(bw * .95)},
        'hand': {'x': f(bx0 + bw * .82), 'y': f(by0 + bh * .62), 'w': f(bw * .4)},
    }

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.environ.get('PET_ART_DIR') or sys.exit('set PET_ART_DIR')
OUT = os.path.join(HERE, '../../Code/PetRunway/game/anchors.json')
# Display names from the values catalogue (its name field is the " " key); card keys are the name
# lower-cased with everything but letters and digits removed.
data = json.load(urllib.request.urlopen('https://adoptme.b-cdn.net/data.json'))
names = {}
for row in data:
    n = (row.get(' ') or row.get('name') or '').strip()
    if n: names.setdefault(re.sub(r'[^a-z0-9]', '', n.lower()), n)
out = {}
for p in sorted(glob.glob(os.path.join(ART, '*.webp'))):
    k = os.path.basename(p)[:-5]; kind, an = analyse(p); an['kind'] = kind; out[k] = an
over = json.load(open(os.path.join(HERE, 'overrides.json')))
for k, v in over.items():
    for slot, d in v.items(): out.setdefault(k, {}).setdefault(slot, {}).update(d)
for k, v in out.items():
    v['name'] = names.get(k, k)
    for slot in ('head', 'eyes', 'cheeks', 'neck', 'body', 'hand'):
        v[slot] = [v[slot]['x'], v[slot]['y'], v[slot]['w']]
json.dump(out, open(OUT, 'w'), separators=(',', ':'), sort_keys=True)
kinds = {}
for v in out.values(): kinds[v['kind']] = kinds.get(v['kind'], 0) + 1
print(len(out), 'pets', kinds, 'named', sum(1 for k, v in out.items() if v['name'] != k))
