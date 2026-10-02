"""Compare every local pet image with what Bunny storage holds (SHA-256), and
optionally re-upload anything missing or different.

    source scripts/pet-cards/.env.cards
    python3 scripts/pet-cards/hd-art/verify_cdn.py          # report only
    python3 scripts/pet-cards/hd-art/verify_cdn.py --fix    # upload missing/different files + manifests

upload.py --new-only skips keys that are already listed, so a pet that was
redrawn AFTER its first upload never reaches the CDN that way. This catches it.
"""

import argparse
import glob
import hashlib
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT  # noqa: E402
from upload import put  # noqa: E402

DIRS = [("1024", "v1/pets"), ("512", "v1/pets/512"), ("2048", "v1/pets/2k")]


def listing(host, zone, key, remote_dir):
    req = urllib.request.Request(f"https://{host}/{zone}/{remote_dir}/", headers={"AccessKey": key})
    with urllib.request.urlopen(req, timeout=120) as r:
        return {o["ObjectName"]: (o.get("Checksum") or "").upper() for o in json.load(r) if not o.get("IsDirectory")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fix", action="store_true")
    args = ap.parse_args()
    zone = os.environ.get("BUNNY_STORAGE_ZONE")
    key = os.environ.get("BUNNY_STORAGE_KEY")
    host = os.environ.get("BUNNY_STORAGE_HOST", "storage.bunnycdn.com")
    if not zone or not key:
        sys.exit("source scripts/pet-cards/.env.cards first")

    bad = []
    for local_dir, remote_dir in DIRS:
        remote = listing(host, zone, key, remote_dir)
        files = sorted(glob.glob(os.path.join(OUT, local_dir, "*.webp")))
        missing = changed = 0
        for path in files:
            name = os.path.basename(path)
            digest = hashlib.sha256(open(path, "rb").read()).hexdigest().upper()
            if name not in remote:
                missing += 1
                bad.append((path, f"{remote_dir}/{name}"))
            elif remote[name] and remote[name] != digest:
                changed += 1
                bad.append((path, f"{remote_dir}/{name}"))
        print(f"{remote_dir}: {len(files)} local, {len(remote)} on storage, {missing} missing, {changed} different")

    if not bad:
        print("CDN matches local art")
    elif args.fix:
        fails = 0
        for path, remote in bad:
            try:
                put(host, zone, key, remote, open(path, "rb").read(), "image/webp")
            except Exception as e:
                fails += 1
                print("  failed", remote, e)
        print(f"re-uploaded {len(bad) - fails}/{len(bad)}")
        if not fails:
            for local_dir, manifest in (("1024", "v1/pets/index.json"), ("2048", "v1/pets/2k/index.json")):
                keys = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(OUT, local_dir, "*.webp")))
                put(host, zone, key, manifest, json.dumps(keys).encode(), "application/json")
            print("manifests rewritten")
    else:
        for _, remote in bad[:20]:
            print("  ", remote)
        print("run with --fix to upload these")


if __name__ == "__main__":
    main()
