"""Step 1: download the best Adopt Me wiki render for every pet.

    python3 scripts/pet-cards/hd-art/collect.py            # all pets (cached: re-runs only fetch what's missing)
    python3 scripts/pet-cards/hd-art/collect.py --limit 20 # quick test

For each pet it asks the wiki for two candidates:
  file  - File:<Name>.png  (usually the clean infobox render)
  page  - the page's main image (sometimes a bigger render, sometimes a screenshot)
Both are saved to out/raw/<key>__file.png / __page.png; process.py picks the best.
"""

import argparse
import concurrent.futures as cf
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW, OUT, WIKI_API, http_bytes, http_json, load_pets, read_json, write_json  # noqa: E402

INDEX = os.path.join(RAW, "index.json")


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def wiki_candidates(names):
    """{name: {'file': (w, h, url), 'page': (w, h, url)}} for up to 50 names."""
    out = {n: {} for n in names}
    d = http_json(WIKI_API, {
        "action": "query", "format": "json", "prop": "imageinfo", "iiprop": "size|url|mime",
        "titles": "|".join(f"File:{n}.png" for n in names),
    })
    norm = {x["to"]: x["from"] for x in d["query"].get("normalized", [])}
    for pg in d["query"]["pages"].values():
        title = norm.get(pg["title"], pg["title"])
        name = title[len("File:"):-len(".png")]
        ii = pg.get("imageinfo")
        if name in out and ii:
            out[name]["file"] = (ii[0]["width"], ii[0]["height"], ii[0]["url"])

    d = http_json(WIKI_API, {
        "action": "query", "format": "json", "prop": "pageimages", "piprop": "original",
        "redirects": 1, "titles": "|".join(names),
    })
    norm = {x["to"]: x["from"] for x in d["query"].get("normalized", [])}
    red = {x["to"]: x["from"] for x in d["query"].get("redirects", [])}
    for pg in d["query"]["pages"].values():
        t = pg["title"]
        name = norm.get(red.get(t, t), red.get(t, t))
        o = pg.get("original")
        if name in out and o:
            out[name]["page"] = (o["width"], o["height"], o["source"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    os.makedirs(RAW, exist_ok=True)
    pets = load_pets()
    if args.limit:
        pets = pets[:args.limit]
    index = read_json(INDEX, {})

    todo = [p for p in pets if p["key"] not in index]
    print(f"{len(pets)} pets, {len(todo)} not looked up yet")
    for group in chunks(todo, 50):
        found = wiki_candidates([p["name"] for p in group])
        for p in group:
            index[p["key"]] = {"name": p["name"], "rarity": p["rarity"], "candidates": found.get(p["name"], {})}
        write_json(INDEX, index)

    jobs = []
    for p in pets:
        for kind, (w, h, url) in index[p["key"]]["candidates"].items():
            dest = os.path.join(RAW, f"{p['key']}__{kind}.png")
            if not os.path.exists(dest):
                jobs.append((dest, url))
    print(f"{len(jobs)} images to download")

    def fetch(job):
        dest, url = job
        try:
            data = http_bytes(url)
            with open(dest + ".part", "wb") as f:
                f.write(data)
            os.replace(dest + ".part", dest)
            return None
        except Exception as e:
            return f"{os.path.basename(dest)}: {e}"

    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        errors = [e for e in pool.map(fetch, jobs) if e]
    for e in errors:
        print("  failed", e)

    missing = [p["name"] for p in pets if not index[p["key"]]["candidates"]]
    write_json(os.path.join(OUT, "missing_on_wiki.json"), missing)
    print(f"done. {len(missing)} pets have no wiki image (out/missing_on_wiki.json); {len(errors)} downloads failed")


if __name__ == "__main__":
    main()
