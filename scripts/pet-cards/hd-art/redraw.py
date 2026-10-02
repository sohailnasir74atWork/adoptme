"""Fast path for AI redraws: process ONLY the new files in out/remaster.

    python3 scripts/pet-cards/hd-art/redraw.py            # every redraw newer than its HD art
    python3 scripts/pet-cards/hd-art/redraw.py batdragon  # just these keys

For each redraw: clear a plain backdrop if needed, trim, square, export the
1024 / 512 sizes, build the 2048 wallpaper size (2x AI upscale), and mark it
in out/status.json. Takes seconds per pet (process.py redoes all 785).
Then upload with:  upload.py --new-only --apply
"""

import glob
import os
import subprocess
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import process as P  # noqa: E402
from common import OUT, read_json, write_json  # noqa: E402


def todo_keys(argv):
    if argv:
        return argv
    keys = []
    for path in sorted(glob.glob(os.path.join(P.REMASTER, "*"))):
        key = os.path.basename(path).split("_")[0].split(".")[0]
        done = os.path.join(P.DIR_1024, f"{key}.webp")
        if not os.path.exists(done) or os.path.getmtime(done) < os.path.getmtime(path):
            keys.append(key)
    return keys


def make_2k_one(key):
    os.makedirs(P.DIR_2K, exist_ok=True)
    src = Image.open(os.path.join(P.DIR_1024, f"{key}.webp")).convert("RGBA")
    tmp_in = os.path.join(OUT, f"_2k_{key}.png")
    tmp_out = os.path.join(OUT, f"_2k_{key}_x2.png")
    src.save(tmp_in)
    models = os.path.join(os.path.dirname(P.UPSCALER), "models")
    r = subprocess.run([P.UPSCALER, "-i", tmp_in, "-o", tmp_out, "-n", "realesr-animevideov3", "-s", "2", "-f", "png", "-m", models],
                       capture_output=True, text=True)
    if r.returncode == 0 and os.path.exists(tmp_out):
        big = P.with_alpha_from(Image.open(tmp_out), src)
        P.resize_rgba(big, 2048).save(os.path.join(P.DIR_2K, f"{key}.webp"), "WEBP", quality=90, method=6)
    for p in (tmp_in, tmp_out):
        if os.path.exists(p):
            os.remove(p)


def main():
    keys = todo_keys(sys.argv[1:])
    if not keys:
        print("no new redraws in out/remaster")
        return
    status = read_json(os.path.join(OUT, "status.json"), {})
    for key in keys:
        path = P.find_override(P.REMASTER, key)
        if not path:
            print(f"  {key}: no file in out/remaster")
            continue
        raw = Image.open(path).convert("RGBA")
        img = P.clear_plain_background(raw)
        t = P.trimmed(img)
        if t is None or not P.has_transparent_background(img):
            print(f"  {key}: background could not be removed; ask for a transparent or bright green background")
            continue
        P.export(P.square(t), key)
        make_2k_one(key)
        row = status.get(key, {"name": key})
        row.update(route="remaster", src="remaster", srcSize=list(raw.size))
        row["flags"] = ["AI redraw"] + (["background removed automatically: check edges"] if img is not raw else [])
        status[key] = row
        print(f"  {key}: done ({raw.size[0]}px source -> 512 / 1024 / 2048)")
    write_json(os.path.join(OUT, "status.json"), status)
    P.write_review(status)


if __name__ == "__main__":
    main()
