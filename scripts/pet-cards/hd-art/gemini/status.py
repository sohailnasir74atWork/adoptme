"""Where the AI redraws stand, worked out from the files (never from notes).

    python3 scripts/pet-cards/hd-art/gemini/status.py          # summary
    python3 scripts/pet-cards/hd-art/gemini/status.py --list   # + every remaining key
"""

import json
import os
import sys
import urllib.request
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "out")
REFUSED = {  # Gemini answers "third-party content providers"; try ChatGPT (3 free/day)
    "businessmonkey", "halloweengoldenmummycat", "evilbasilisk", "halloweenblackmummycat", "monkeyking",
}


def main():
    status = json.load(open(os.path.join(OUT, "status.json")))
    routes = Counter(v.get("route") for v in status.values())
    redrawn = {os.path.splitext(f)[0] for f in os.listdir(os.path.join(OUT, "remaster"))}
    kit1 = [row[1] for row in json.load(open(os.path.join(OUT, "remaster_kit", "queue.json")))]
    kit2 = [row[0] for row in json.load(open(os.path.join(OUT, "kit2", "queue.json")))]
    left1 = [k for k in kit1 if k not in redrawn]
    left2 = [k for k in kit2 if k not in redrawn]
    hd = len([f for f in os.listdir(os.path.join(OUT, "1024")) if f.endswith(".webp")])

    print(f"pets with HD art locally : {hd}  (direct {routes['direct']}, upscaled {routes['upscaled']}, AI redraw {routes['remaster']})")
    print(f"AI redraws on disk       : {len(redrawn)}")
    print(f"kit 1 (first 48)         : {len(kit1) - len(left1)}/{len(kit1)} done, left: {', '.join(left1) or '-'}")
    print(f"kit 2 (big queue)        : {len(kit2) - len(left2)}/{len(kit2)} done, {len(left2)} left")
    print(f"refused by Gemini        : {', '.join(sorted(REFUSED & (set(left1) | set(left2))))}")
    try:
        with urllib.request.urlopen("https://cardspull.b-cdn.net/v1/pets/index.json", timeout=30) as r:
            print(f"public CDN index         : {len(json.load(r))} pets")
    except Exception as e:
        print(f"public CDN index         : unreachable ({e})")
    if "--list" in sys.argv:
        print("\nremaining kit 2 keys, in run order:")
        print(" ".join(k for k in left2 if k not in REFUSED))


if __name__ == "__main__":
    main()
