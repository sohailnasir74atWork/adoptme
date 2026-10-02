"""Step 2/4: turn the raw wiki renders into 1024 px card art, and build the review sheet.

    python3 scripts/pet-cards/hd-art/process.py            # pick best source, trim, square, scale
    python3 scripts/pet-cards/hd-art/process.py --upscale  # same, and run Real-ESRGAN itself ($REALESRGAN)
    python3 scripts/pet-cards/hd-art/process.py --finish   # fold in out/upscale_out (Upscayl) and out/remaster

Output:
  out/1024/<key>.webp   final art (transparent, 1024x1024, WebP q92)
  out/512/<key>.webp    album thumbnail
  out/upscale_in/       padded PNGs that are too small; AI-upscale these x4 into out/upscale_out/
  out/remaster_ref/     reference images for pets that need an AI remaster (prompts §9)
  out/status.json       per pet: source, sizes, route, flags
  out/review.html       contact sheet; tick the bad ones and copy the list

Rules (PET_CARDS_PLAN.md §4):
  * a source counts only if it has a real transparent background (no screenshots);
  * the route follows the picture's REAL detail (effective_side), not its pixel size:
      sharp and >= 1024 px      -> scaled down as-is
      detail 256..1023 px       -> Real-ESRGAN x4 (soft pictures are shrunk to their
                                   real detail first, so the model rebuilds edges)
      detail < 256 px / no art  -> AI remaster from a reference (prompts §9)
  * nothing is ever stretched with plain resampling.
"""

import argparse
import glob
import html
import math
import os
import subprocess
import sys

from PIL import Image, ImageChops, ImageStat

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, RAW, read_json, write_json  # noqa: E402

FINAL = 1024
THUMB = 512
MARGIN = 0.08          # empty space on each side of the pet
DIR_1024 = os.path.join(OUT, "1024")
DIR_512 = os.path.join(OUT, "512")
DIR_2K = os.path.join(OUT, "2048")   # wallpaper art (a big pet on a 4K screen needs ~2000 px)
UP_IN = os.path.join(OUT, "upscale_in")
UP_OUT = os.path.join(OUT, "upscale_out")
REMASTER = os.path.join(OUT, "remaster")
REF = os.path.join(OUT, "remaster_ref")
# Real detail (see effective_side), not pixel count, decides the route.
# Calibrated 2026-10-01: sharp renders keep detail to 450+ px; the wiki's
# Dalmatian is 420 px but blurry (detail ~128 px), a known-blurred 128 px
# copy of Pelican measures 128-192.
GOOD_DETAIL = 448      # enough for a smooth 1024 render as-is
MIN_DETAIL = 256       # below this even a x4 AI upscale stays under 1024 and soft
DETAIL_LADDER = (128, 192, 256, 320, 384, 448, 512, 640, 768, 896)
DETAIL_LOSS = 1.0      # mean grey-level change (0-255) that counts as "detail lost"
UPSCALER = os.environ.get("REALESRGAN", "/Volumes/Sohail/AI_Projects/tools/realesrgan/realesrgan-ncnn-vulkan")
UPSCALE_MODEL = "realesrgan-x4plus-anime"   # cleanest on Adopt Me's smooth 3D renders


def has_transparent_background(img):
    """True when the corners are (almost) fully transparent: a cut-out render, not a screenshot."""
    a = img.getchannel("A")
    w, h = img.size
    s = max(2, min(w, h) // 25)
    boxes = [(0, 0, s, s), (w - s, 0, w, s), (0, h - s, s, h), (w - s, h - s, w, h)]
    clear = 0
    for b in boxes:
        hist = a.crop(b).histogram()
        clear += sum(hist[:16]) / max(1, sum(hist))
    return clear / 4 > 0.9


def trimmed(img):
    bbox = img.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox()
    return img.crop(bbox) if bbox else None


def square(img):
    """Centre the trimmed pet on a transparent square with MARGIN on every side."""
    w, h = img.size
    side = math.ceil(max(w, h) / (1 - 2 * MARGIN))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
    return canvas


def resize_rgba(img, size):
    # Premultiplied resize, so transparent edges don't pick up a dark fringe.
    return img.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")


def export(img, key):
    os.makedirs(DIR_1024, exist_ok=True)
    os.makedirs(DIR_512, exist_ok=True)
    resize_rgba(img, FINAL).save(os.path.join(DIR_1024, f"{key}.webp"), "WEBP", quality=92, method=6)
    resize_rgba(img, THUMB).save(os.path.join(DIR_512, f"{key}.webp"), "WEBP", quality=90, method=6)


def best_source(key):
    """(kind, padded RGBA square, original size) for the best usable candidate, or None."""
    best = None
    for path in sorted(glob.glob(os.path.join(RAW, f"{key}__*.png"))):
        kind = path.rsplit("__", 1)[1][:-4]
        try:
            img = Image.open(path).convert("RGBA")
        except Exception:
            continue
        if not has_transparent_background(img):
            continue
        t = trimmed(img)
        if t is None:
            continue
        sq = square(t)
        score = sq.size[0] + (1 if kind == "file" else 0)  # tie -> the infobox render
        if best is None or score > best[0]:
            best = (score, kind, sq, img.size)
    return best[1:] if best else None


def clear_plain_background(img):
    """AI tools often return a plain white/grey backdrop instead of transparency.
    If the picture has no transparent background but its border is one flat
    colour, flood that colour away from the edges (soft edge, so no halo)."""
    if has_transparent_background(img):
        return img
    from PIL import ImageDraw, ImageFilter
    w, h = img.size
    rgb = img.convert("RGB")
    border = [rgb.getpixel((x, y)) for x in range(0, w, max(1, w // 40)) for y in (0, h - 1)] + \
             [rgb.getpixel((x, y)) for y in range(0, h, max(1, h // 40)) for x in (0, w - 1)]
    ref = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))
    if ref[1] > 150 and ref[0] < 110 and ref[2] < 110:
        return chroma_key_green(img)
    if sum(1 for c in border if max(abs(c[i] - ref[i]) for i in range(3)) < 14) < len(border) * 0.9:
        return img                       # not a plain backdrop: leave it for review
    mask = Image.new("L", (w + 2, h + 2), 0)
    flood = rgb.copy()
    marker = tuple(255 - c for c in ref)   # far from the backdrop colour, so the fill can't stall
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if max(abs(flood.getpixel(seed)[i] - ref[i]) for i in range(3)) < 8:
            # Tight threshold: a white pet on a white backdrop must not be eaten.
            # A bright green (#00FF00) backdrop is the safe choice and clears fully.
            ImageDraw.floodfill(flood, seed, marker, thresh=8 if max(ref) - min(ref) < 60 else 40)
    # Background = exactly the pixels the fill changed (comparing to the
    # original, so pet pixels that happen to match the marker colour stay).
    from PIL import ImageChops
    changed = ImageChops.difference(flood, rgb).convert("L").point(lambda v: 255 if v else 0)
    if sum(ref) < 600:
        # A coloured backdrop (never white: white pets would lose their white
        # parts) also shows through enclosed gaps, e.g. between ribs. Clear
        # every pixel that is almost exactly the backdrop colour.
        solid = Image.new("RGB", rgb.size, ref)
        near = ImageChops.difference(rgb, solid).convert("L").point(lambda v: 255 if v < 14 else 0)
        changed = ImageChops.lighter(changed, near)
    alpha = ImageChops.invert(changed).filter(ImageFilter.GaussianBlur(1.2))
    out = img.copy()
    out.putalpha(alpha)
    return out


def chroma_key_green(img):
    """Green-screen removal: transparency from how much green beats red/blue,
    soft at the edges, with the green tint (spill) taken out of edge pixels."""
    rgb = img.convert("RGB")
    out = Image.new("RGBA", rgb.size)
    src, dst = rgb.load(), out.load()
    w, h = rgb.size
    lo, hi = 35, 110
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            key = g - max(r, b)
            if key >= hi:
                dst[x, y] = (0, 0, 0, 0)
                continue
            a = 255 if key <= lo else int(255 * (hi - key) / (hi - lo))
            if key > 0:
                g = max(r, b)                 # despill
            dst[x, y] = (r, g, b, a)
    return out


def save_reference(key):
    """Copy the largest raw candidate to out/remaster_ref/ to attach to the remaster prompt."""
    paths = glob.glob(os.path.join(RAW, f"{key}__*.png"))
    if not paths:
        return
    def area(p):
        try:
            w, h = Image.open(p).size
            return w * h
        except Exception:
            return 0
    os.makedirs(REF, exist_ok=True)
    best = max(paths, key=area)
    Image.open(best).save(os.path.join(REF, f"{key}.png"))


def effective_side(sq):
    """How many pixels of real detail the picture holds.

    Shrink to each ladder size and blow back up; the first size that loses
    (almost) nothing is the size the picture really is. A sharp 1000 px render
    loses detail below ~450 px; an enlarged thumbnail loses nothing even at 128.
    """
    side = sq.size[0]
    base = sq.convert("L")
    mask = sq.getchannel("A").point(lambda v: 255 if v > 200 else 0)
    for s in DETAIL_LADDER:
        if s >= side:
            break
        back = base.resize((s, s), Image.LANCZOS).resize((side, side), Image.LANCZOS)
        if ImageStat.Stat(ImageChops.difference(base, back), mask).mean[0] < DETAIL_LOSS:
            return s
    return side


def run_upscaler(key):
    """Real-ESRGAN x4 on one file; returns the output path or None."""
    if not os.path.exists(UPSCALER):
        return None
    src = os.path.join(UP_IN, f"{key}.png")
    dst = os.path.join(UP_OUT, f"{key}.png")
    models = os.path.join(os.path.dirname(UPSCALER), "models")
    r = subprocess.run([UPSCALER, "-i", src, "-o", dst, "-n", UPSCALE_MODEL, "-s", "4", "-f", "png", "-m", models],
                       capture_output=True, text=True)
    return dst if r.returncode == 0 and os.path.exists(dst) else None


def make_2k():
    """out/1024 -> out/2048 with a 2x AI model (fast), for wallpapers only."""
    os.makedirs(DIR_2K, exist_ok=True)
    tmp = os.path.join(OUT, "_2k_tmp")
    os.makedirs(tmp, exist_ok=True)
    models = os.path.join(os.path.dirname(UPSCALER), "models")
    done = 0
    for f in sorted(os.listdir(DIR_1024)):
        key = f[:-5]
        dst = os.path.join(DIR_2K, f"{key}.webp")
        if not f.endswith(".webp") or os.path.exists(dst):
            continue
        src_png = os.path.join(tmp, f"{key}.png")
        out_png = os.path.join(tmp, f"{key}_x2.png")
        src = Image.open(os.path.join(DIR_1024, f)).convert("RGBA")
        src.save(src_png)
        r = subprocess.run([UPSCALER, "-i", src_png, "-o", out_png, "-n", "realesr-animevideov3", "-s", "2", "-f", "png", "-m", models],
                           capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(out_png):
            print("  2k failed", key)
            continue
        big = with_alpha_from(Image.open(out_png), src)
        resize_rgba(big, 2048).save(dst, "WEBP", quality=90, method=6)
        for p in (src_png, out_png):
            os.remove(p)
        done += 1
    print(f"2048 art: {done} new, {len(os.listdir(DIR_2K))} total -> out/2048/")


def find_override(folder, key):
    for path in glob.glob(os.path.join(folder, f"{key}*")):
        base = os.path.basename(path)
        # Upscayl renames files ("<key>_upscayl_4x_....png"); keys are [a-z0-9] only.
        if base.split("_")[0].split(".")[0] == key:
            return path
    return None


def with_alpha_from(upscaled, padded):
    """Some upscalers drop the alpha channel; rebuild it from the source's alpha."""
    if upscaled.mode == "RGBA" and upscaled.getchannel("A").getextrema()[0] < 250:
        return upscaled
    alpha = padded.getchannel("A").resize(upscaled.size, Image.LANCZOS)
    out = upscaled.convert("RGB").convert("RGBA")
    out.putalpha(alpha)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--finish", action="store_true", help="fold in out/upscale_out and out/remaster")
    ap.add_argument("--upscale", action="store_true", help="run Real-ESRGAN on every pet that needs it")
    ap.add_argument("--x2k", action="store_true", help="only build out/2048 (wallpaper art) from out/1024, 2x AI upscale")
    args = ap.parse_args()

    if args.x2k:
        make_2k()
        return
    index = read_json(os.path.join(RAW, "index.json"), {})
    if not index:
        sys.exit("run collect.py first")
    previous = read_json(os.path.join(OUT, "status.json"), {})
    status = {}
    os.makedirs(UP_IN, exist_ok=True)
    os.makedirs(UP_OUT, exist_ok=True)
    os.makedirs(REMASTER, exist_ok=True)

    for key, meta in sorted(index.items()):
        row = {"name": meta["name"], "rarity": meta.get("rarity"), "flags": []}
        status[key] = row

        remaster = find_override(REMASTER, key)
        if remaster:
            raw_img = Image.open(remaster).convert("RGBA")
            img = clear_plain_background(raw_img)
            if img is not raw_img:
                row["flags"].append("background removed automatically: check edges")
            t = trimmed(img)
            if t is not None:
                export(square(t), key)
                row.update(route="remaster", src="remaster", srcSize=list(img.size))
                row["flags"].append("remastered")
                continue

        src = best_source(key)
        if not src:
            row.update(route="needs_remaster", src=None)
            if meta["candidates"]:
                # The wiki only has a screenshot, an inventory icon or fan art with a
                # baked-in background. Keep the biggest one as the remaster reference.
                row["flags"].append("no clean render: remaster (prompts §9)")
                save_reference(key)
            else:
                row["flags"].append("not on wiki: remaster from the in-game look")
            continue
        kind, sq, orig = src
        side = sq.size[0]
        prev = previous.get(key) or {}
        # Measuring detail is the slow part; reuse it while the source is unchanged.
        if prev.get("src") == kind and prev.get("srcSize") == list(orig) and prev.get("detail"):
            eff = prev["detail"]
        else:
            eff = effective_side(sq)
        row.update(src=kind, srcSize=list(orig), side=side, detail=eff)

        if eff < MIN_DETAIL:
            # Blurry no matter how many pixels it has (often a thumbnail someone
            # enlarged before uploading). An upscaler would only enlarge the blur.
            row["route"] = "needs_remaster"
            row["flags"].append(f"blurry: real detail ~{eff}px of {side}px: remaster (prompts §9)")
            save_reference(key)
            continue

        if side >= FINAL and eff >= GOOD_DETAIL:
            export(sq, key)
            row["route"] = "direct"
            continue

        # Upscale route. A soft picture is first shrunk to the detail it really
        # has, so the AI model sees crisp edges and rebuilds them, instead of
        # sharpening blur.
        feed = sq if eff >= side * 0.85 else resize_rgba(sq, eff)
        feed.save(os.path.join(UP_IN, f"{key}.png"))
        row["route"] = "needs_upscale"
        row["upFrom"] = feed.size[0]
        if args.upscale or args.finish:
            up = find_override(UP_OUT, key)
            if up is None and args.upscale:
                up = run_upscaler(key)
            if up:
                img = with_alpha_from(Image.open(up), feed)
                export(img, key)
                row["route"] = "upscaled"
                row["flags"].append(f"AI upscaled from {feed.size[0]}px")

    write_json(os.path.join(OUT, "status.json"), status)
    write_review(status)

    routes = {}
    for r in status.values():
        routes[r["route"]] = routes.get(r["route"], 0) + 1
    print("routes:", routes)
    ready = sum(1 for r in status.values() if r["route"] in ("direct", "upscaled", "remaster"))
    print(f"HD ready: {ready}/{len(status)}  ->  out/1024/")
    if routes.get("needs_upscale"):
        print(f"{routes['needs_upscale']} need the AI upscaler: run with --upscale (or Upscayl x4 into out/upscale_out, then --finish)")
    if routes.get("needs_remaster"):
        print(f"{routes['needs_remaster']} need an AI remaster: references in out/remaster_ref/, prompt PET-REMASTER (prompts §9)")
    print("review sheet: out/review.html")


def write_review(status):
    cells = []
    order = {"needs_remaster": 0, "needs_upscale": 1, "upscaled": 2, "remaster": 3, "direct": 4}
    for key, r in sorted(status.items(), key=lambda kv: (order.get(kv[1]["route"], 9), kv[1]["name"])):
        route = r["route"]
        if route in ("direct", "upscaled", "remaster"):
            img = f"512/{key}.webp"
        elif route == "needs_upscale":
            img = f"upscale_in/{key}.png"
        elif os.path.exists(os.path.join(REF, f"{key}.png")):
            img = f"remaster_ref/{key}.png"
        else:
            img = ""
        size = "×".join(map(str, r.get("srcSize") or [])) or "—"
        if r.get("detail"):
            size += f" · detail {r['detail']}px"
        flags = "".join(f"<span class=flag>{html.escape(f)}</span>" for f in r["flags"])
        pic = f'<img loading=lazy src="{img}">' if img else '<div class=none>no art</div>'
        cells.append(
            f'<label class="cell r-{route}" data-route="{route}" data-key="{key}">'
            f'<div class=pic>{pic}</div>'
            f'<b>{html.escape(r["name"])}</b><small>{html.escape(str(r.get("rarity")))} · {route} · src {html.escape(str(r.get("src")))} {size}</small>'
            f'{flags}<span class=rej><input type=checkbox> reject</span></label>'
        )
    page = f"""<!doctype html><meta charset=utf-8><title>Pet Cards HD art review</title>
<style>
body{{font:14px system-ui;margin:16px;background:#111;color:#eee}}
.bar{{position:sticky;top:0;background:#111;padding:8px 0;display:flex;gap:8px;flex-wrap:wrap;z-index:2}}
button{{background:#333;color:#eee;border:1px solid #555;border-radius:6px;padding:6px 10px;cursor:pointer}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}}
.cell{{background:#1c1c1c;border:1px solid #333;border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:4px}}
.pic{{aspect-ratio:1;border-radius:8px;background:conic-gradient(#ccc 25%,#fff 0 50%,#ccc 0 75%,#fff 0) 0 0/20px 20px;display:grid;place-items:center;overflow:hidden}}
.pic img{{width:100%;height:100%;object-fit:contain}}
.none{{color:#900}} small{{color:#999}} .flag{{background:#5a3b00;color:#ffcf66;border-radius:4px;padding:1px 5px;font-size:12px}}
.r-needs_remaster{{border-color:#a33}} .r-needs_upscale{{border-color:#a80}}
.cell:has(input:checked){{outline:3px solid #e33}}
</style>
<div class=bar>
<button onclick="f('all')">All {len(status)}</button>
<button onclick="f('direct')">Direct</button><button onclick="f('upscaled')">Upscaled</button>
<button onclick="f('needs_upscale')">Needs upscale</button><button onclick="f('needs_remaster')">Needs remaster</button>
<button onclick="copyRejects()">Copy rejected keys</button><span id=msg></span></div>
<div class=grid>{''.join(cells)}</div>
<script>
function f(r){{document.querySelectorAll('.cell').forEach(c=>c.style.display=(r==='all'||c.dataset.route===r)?'':'none')}}
function copyRejects(){{const k=[...document.querySelectorAll('.cell')].filter(c=>c.querySelector('input').checked).map(c=>c.dataset.key);
navigator.clipboard.writeText(k.join('\\n'));document.getElementById('msg').textContent=k.length+' copied: remaster these (prompts §9)'}}
</script>"""
    with open(os.path.join(OUT, "review.html"), "w") as fh:
        fh.write(page)


if __name__ == "__main__":
    main()
