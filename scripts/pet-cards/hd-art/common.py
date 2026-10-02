"""Shared helpers for the Pet Cards HD art pipeline (see PET_CARDS_ART_PROMPTS.md §2)."""

import json
import os
import re
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
RAW = os.path.join(OUT, "raw")
CATALOG_URL = "https://adoptme.b-cdn.net"
WIKI_API = "https://adoptme.fandom.com/api.php"
UA = "PetCardsArtPipeline/1.0 (adoptme values app; contact via Play listing)"


def card_key(name):
    """Same as normalizeName() in Code/Helper/valueSources.js: the card's id and file name."""
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def http_json(url, params=None, retries=3):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # network blips: back off and retry
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def http_bytes(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def load_pets():
    """Live catalogue pets, one per card key (hidden rows and duplicates dropped)."""
    rows = http_json(CATALOG_URL)
    pets, seen = [], set()
    for p in rows:
        if not isinstance(p, dict) or p.get("type") != "pets" or p.get("hidden"):
            continue
        k = card_key(p.get("name"))
        if not k or k in seen:
            continue
        seen.add(k)
        pets.append({"key": k, "name": p["name"], "rarity": p.get("rarity")})
    return pets


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)
