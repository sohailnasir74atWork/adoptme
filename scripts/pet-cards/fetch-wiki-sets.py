"""Build scripts/pet-cards/sets.json: which pets belong to which card set.

    python3 scripts/pet-cards/fetch-wiki-sets.py

Sets come from real in-game groupings on the Adopt Me wiki, matched to the
live catalogue by card key (normalizeName):
  egg_<name>  - "<Name> Egg Pets" categories (Fossil, Ocean, Japan, ...)
  haunted26   - every "Halloween Event (YYYY)" category
  winter26    - Christmas / Winter Event / Winter Festival / Winter Holiday
  dragons     - pets whose name says dragon/wyvern/drake
  cats        - cats and big cats
Also a background hint per pet (festival / snow / beach) from its event.

The output is committed; sync-card-catalog.js reads it. Re-run when a new
egg or event arrives, review the diff, commit.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "hd-art"))
from common import WIKI_API, card_key, http_json, load_pets  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sets.json")


def all_categories():
    cats, cont = [], {}
    while True:
        d = http_json(WIKI_API, {"action": "query", "format": "json", "list": "allcategories", "aclimit": 500, **cont})
        cats += [c["*"] for c in d["query"]["allcategories"]]
        if "continue" not in d:
            return cats
        cont = d["continue"]


def members(cat):
    out, cont = [], {}
    while True:
        d = http_json(WIKI_API, {"action": "query", "format": "json", "list": "categorymembers",
                                 "cmtitle": "Category:" + cat, "cmlimit": 500, "cmnamespace": 0, **cont})
        out += [m["title"] for m in d["query"]["categorymembers"]]
        if "continue" not in d:
            return out
        cont = d["continue"]


def main():
    pets = load_pets()
    by_key = {p["key"]: p for p in pets}
    sets = {}
    egg = {}
    bg = {}

    def add(set_id, names):
        for n in names:
            k = card_key(n)
            if k in by_key:
                sets.setdefault(set_id, set()).add(k)

    def hint(names, value):
        for n in names:
            if card_key(n) in by_key:
                bg.setdefault(card_key(n), value)

    for cat in all_categories():
        m = re.fullmatch(r"(.+) Egg Pets", cat)
        if m:
            eid = re.sub(r"[^a-z0-9]+", "_", m.group(1).lower()).strip("_")
            names = members(cat)
            add("egg_" + eid, names)
            for n in names:
                if card_key(n) in by_key:
                    egg.setdefault(card_key(n), eid)
        elif re.fullmatch(r"Halloween Event \(\d{4}\)", cat):
            add("haunted26", members(cat))
        elif re.match(r"(Christmas Event|Winter Event|Winter Festival|Winter Holiday) \(\d{4}\)", cat):
            names = members(cat)
            add("winter26", names)
            hint(names, "snow")
        elif re.match(r"(Lunar New Year|Spring Festival|Cherry Blossom Festival|Sugar Festival)", cat):
            hint(members(cat), "festival")
        elif re.match(r"(Summer Festival|Summer Camp Event|Ocean Event|Celestial Summer)", cat):
            hint(members(cat), "beach")

    for p in pets:
        if re.search(r"Dragon|Wyvern|Drake", p["name"]):
            sets.setdefault("dragons", set()).add(p["key"])
        if re.search(r"\bCat\b|Kitty|Kitten|Lion|Tiger|Leopard|Lynx|Panther|Cheetah|Catacino|^Cate$|Pain Au Chat|Feline", p["name"]):
            sets.setdefault("cats", set()).add(p["key"])

    out = {
        "source": "adoptme.fandom.com categories, matched to adoptme.b-cdn.net by normalizeName",
        "sets": {k: sorted(v) for k, v in sorted(sets.items())},
        "egg": dict(sorted(egg.items())),
        "bg": dict(sorted(bg.items())),
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    for k, v in out["sets"].items():
        print(f"{len(v):4d}  {k}")
    print(f"egg for {len(egg)} pets, bg hint for {len(bg)} pets -> {OUT}")


if __name__ == "__main__":
    main()
