"""Pre-tile the repeating Pet Cards textures into sheets for small cards.

    python3 scripts/pet-cards/make-texture-sheets.py

Why: on Android, <Image resizeMode="repeat"> is a Fresco postprocessor that
paints a NEW bitmap the size of the view for every image view, uncached. An
album page mounts 30+ cards with 1-3 tiled layers each, so opening it built
dozens of bitmaps on the spot (2026-10-08: the album open stalled for
~0.5 s per frame on the emulator; without the tiled layers it was smooth).

A sheet is the tile repeated from the top-left, exactly what "repeat" draws
(RN tiles at the bitmap's own pixel size from the top-left corner), so a card
that fits inside the sheet looks identical, and every card shares one decoded
bitmap. PetCard falls back to "repeat" for anything bigger (full-size cards).

Reads assets/pet-cards/<tile>.webp (from make-textures.py), writes
assets/pet-cards/<tile>_sheet.webp. Lossless, so no second compression pass.
"""

import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIR = os.path.join(ROOT, "assets", "pet-cards")
SHEET_W, SHEET_H = 512, 768   # keep in step with SHEET_PX in Code/PetCards/PetCard.jsx
TILES = ["t_paper", "t_brushed", "h_cosmos", "h_starlight", "h_web"]


def main():
    for name in TILES:
        tile = Image.open(os.path.join(DIR, f"{name}.webp")).convert("RGBA")
        sheet = Image.new("RGBA", (SHEET_W, SHEET_H), (0, 0, 0, 0))
        for y in range(0, SHEET_H, tile.size[1]):
            for x in range(0, SHEET_W, tile.size[0]):
                sheet.paste(tile, (x, y))
        out = os.path.join(DIR, f"{name}_sheet.webp")
        sheet.save(out, "WEBP", lossless=True, quality=100, method=6)
        print(f"{name}_sheet.webp  {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main()
