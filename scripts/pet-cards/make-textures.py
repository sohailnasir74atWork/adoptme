"""Render the small bundled Pet Cards textures (no AI needed: they are math).

    python3 scripts/pet-cards/make-textures.py

Writes assets/pet-cards/:
  t_conic.webp      rainbow wheel that spins behind Mega borders
  h_cosmos.webp     "cosmos holo" bubbles      (white on transparent, tileable)
  h_starlight.webp  four-point sparkles        (white on transparent, tileable)
  h_paws.webp       paw-print lattice          (white on transparent, tileable)
  h_web.webp        spiderweb lattice          (Haunted Carnival)
  t_paper.webp      card-stock grain           (dark specks on transparent, tileable)
  t_brushed.webp    brushed-metal streaks      (white/black streaks, tileable)

Everything is drawn at 2x and downsampled, so edges are clean. Deterministic
(fixed seeds): re-running produces identical files.
"""

import colorsys
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "pet-cards")
N = 512          # final tile size
S = N * 2        # drawing size


def save(img, name, quality=88, size=N):
    os.makedirs(OUT, exist_ok=True)
    if img.size[0] != size:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(OUT, name), "WEBP", quality=quality, method=6)
    print(f"{name:18s} {os.path.getsize(os.path.join(OUT, name)) // 1024} KB")


def tiled(draw_fn):
    """Draw each shape 9 times (offset by the tile size) so the tile wraps seamlessly."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for ox in (-S, 0, S):
        for oy in (-S, 0, S):
            draw_fn(d, ox, oy)
    return img


def conic():
    img = Image.new("RGB", (S, S))
    px = img.load()
    c = S / 2
    for y in range(S):
        for x in range(S):
            a = (math.atan2(y - c, x - c) / (2 * math.pi)) % 1.0
            r, g, b = colorsys.hsv_to_rgb(a, 0.75, 1.0)
            px[x, y] = (int(r * 255), int(g * 255), int(b * 255))
    save(img, "t_conic.webp", 90)


def cosmos():
    rnd = random.Random(7)
    shapes = []
    for _ in range(170):
        r = rnd.choice([3, 4, 6, 9, 14, 22, 34, 52]) * 2
        shapes.append((rnd.uniform(0, S), rnd.uniform(0, S), r, rnd.random() < 0.45, rnd.uniform(0.35, 1)))

    def draw(d, ox, oy):
        for x, y, r, ring, a in shapes:
            box = (x + ox - r, y + oy - r, x + ox + r, y + oy + r)
            col = (255, 255, 255, int(255 * a))
            if ring:
                d.ellipse(box, outline=col, width=max(2, r // 7))
            else:
                d.ellipse(box, fill=col)
    save(tiled(draw), "h_cosmos.webp")


def sparkle(d, x, y, r, a):
    col = (255, 255, 255, int(255 * a))
    w = max(2, r / 6)
    d.polygon([(x, y - r), (x + w, y - w), (x + r, y), (x + w, y + w), (x, y + r), (x - w, y + w), (x - r, y), (x - w, y - w)], fill=col)


def starlight():
    rnd = random.Random(11)
    stars = [(rnd.uniform(0, S), rnd.uniform(0, S), rnd.choice([6, 9, 12, 18, 26, 40]), rnd.uniform(0.4, 1)) for _ in range(150)]
    dots = [(rnd.uniform(0, S), rnd.uniform(0, S), rnd.choice([2, 3, 4])) for _ in range(260)]

    def draw(d, ox, oy):
        for x, y, r, a in stars:
            sparkle(d, x + ox, y + oy, r, a)
        for x, y, r in dots:
            d.ellipse((x + ox - r, y + oy - r, x + ox + r, y + oy + r), fill=(255, 255, 255, 200))
    save(tiled(draw), "h_starlight.webp")


def paws():
    step = S // 6

    def paw(d, x, y, s, a):
        col = (255, 255, 255, int(255 * a))
        d.ellipse((x - s * 0.55, y - s * 0.05, x + s * 0.55, y + s * 0.75), fill=col)
        for tx, ty in ((-0.62, -0.42), (-0.22, -0.78), (0.22, -0.78), (0.62, -0.42)):
            r = s * 0.22
            d.ellipse((x + tx * s - r, y + ty * s - r * 1.15, x + tx * s + r, y + ty * s + r * 1.15), fill=col)

    def draw(d, ox, oy):
        for i in range(6):
            for j in range(6):
                x = i * step + (step / 2 if j % 2 else 0) + ox
                y = j * step + oy
                if (i + j) % 2 == 0:
                    paw(d, x + step / 2, y + step / 2, step * 0.22, 0.95)
                else:
                    sparkle(d, x + step / 2, y + step / 2, step * 0.12, 0.8)
    save(tiled(draw), "h_paws.webp")


def web():
    rnd = random.Random(3)
    c = S / 2

    def draw(d, ox, oy):
        col = (255, 255, 255, 210)
        for k in range(12):
            a = k * math.pi / 6
            d.line((c + ox, c + oy, c + ox + math.cos(a) * S * 0.75, c + oy + math.sin(a) * S * 0.75), fill=col, width=3)
        for ring in range(1, 9):
            r = ring * S * 0.075
            pts = []
            for k in range(13):
                a = k * math.pi / 6
                sag = 0.9 if k % 2 else 1.0
                pts.append((c + ox + math.cos(a) * r * sag, c + oy + math.sin(a) * r * sag))
            d.line(pts, fill=col, width=3)
        for _ in range(14):
            sparkle(d, rnd.uniform(0, S) + ox, rnd.uniform(0, S) + oy, rnd.choice([8, 12, 18]), 0.9)
    save(tiled(draw), "h_web.webp")


def paper():
    rnd = random.Random(5)
    n = 256   # noise doesn't compress: a smaller tile, repeated, looks the same
    img = Image.new("L", (n, n))
    img.putdata([rnd.randint(0, 255) for _ in range(n * n)])
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    alpha = img.point(lambda v: max(0, v - 150) // 4)       # sparse, faint specks
    out = Image.new("RGBA", (n, n), (60, 40, 20, 0))
    out.putalpha(alpha)
    save(out, "t_paper.webp", 75, n)


def brushed():
    rnd = random.Random(9)
    n = 256
    small = Image.new("L", (n // 16, n))
    small.putdata([rnd.randint(0, 255) for _ in range((n // 16) * n)])
    streaks = small.resize((n, n), Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.6))
    out = Image.new("RGBA", (n, n))
    px = out.load()
    sp = streaks.load()
    for y in range(n):
        for x in range(n):
            v = sp[x, y]
            px[x, y] = (255, 255, 255, (v - 128) // 3) if v >= 128 else (0, 0, 0, (128 - v) // 3)
    save(out, "t_brushed.webp", 75, n)


if __name__ == "__main__":
    conic()
    cosmos()
    starlight()
    paws()
    web()
    paper()
    brushed()
