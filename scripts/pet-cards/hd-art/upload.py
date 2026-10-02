"""Step 6: upload card art to Bunny storage. Dry run unless --apply.

    # pets (out/1024 -> v1/pets/<key>.webp, out/512 -> v1/pets/512/<key>.webp,
    #       out/2048 -> v1/pets/2k/<key>.webp (wallpapers), plus index.json manifests)
    python3 scripts/pet-cards/hd-art/upload.py
    BUNNY_STORAGE_ZONE=... BUNNY_STORAGE_KEY=... python3 scripts/pet-cards/hd-art/upload.py --apply

    # any other art folder (backgrounds, packs, backs...): files keep their names,
    # and v1/index.json lists them (the app only requests art that is listed)
    python3 scripts/pet-cards/hd-art/upload.py --dir art/export --apply

Use the DEDICATED storage zone adoptme-cards (pull zone cardspull -> cardspull.b-cdn.net).
Not the adoptme.b-cdn.net zone: it answers every path with the values catalogue.

The storage key comes ONLY from the environment. Never paste it into a file:
the old post-gag key leaked exactly that way.
Optional: BUNNY_STORAGE_HOST (default storage.bunnycdn.com = Falkenstein; use the
"Hostname" shown under the zone's FTP & API Access, e.g. ny.storage.bunnycdn.com).
After uploading, purge the three index.json URLs so phones see the new lists.
Files are never overwritten in place by design: phones cache by URL. To change
a picture, give it a new name and update the manifest/app.
"""

import argparse
import concurrent.futures as cf
import glob
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT  # noqa: E402

TYPES = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml"}


def live_index(prefix, rel):
    """The manifest as stored right now (storage API: never a stale CDN copy)."""
    zone = os.environ.get("BUNNY_STORAGE_ZONE")
    key = os.environ.get("BUNNY_STORAGE_KEY")
    host = os.environ.get("BUNNY_STORAGE_HOST", "storage.bunnycdn.com")
    if not zone or not key:
        sys.exit("--new-only needs BUNNY_STORAGE_ZONE and BUNNY_STORAGE_KEY")
    try:
        req = urllib.request.Request(f"https://{host}/{zone}/{prefix}/{rel}", headers={"AccessKey": key})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except Exception:
        return []


def put(host, zone, key, remote, data, ctype):
    req = urllib.request.Request(f"https://{host}/{zone}/{remote}", data=data, method="PUT",
                                 headers={"AccessKey": key, "Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dir", help="upload this folder instead of the pet art")
    ap.add_argument("--prefix", default="v1")
    ap.add_argument("--new-only", action="store_true", help="pets: skip keys already in the live index.json (manifests are always rewritten)")
    args = ap.parse_args()

    jobs = []  # (local path or None, remote path, bytes or None)
    if args.dir:
        ids = []
        for path in sorted(glob.glob(os.path.join(args.dir, "*"))):
            if os.path.splitext(path)[1].lower() in TYPES:
                jobs.append((path, f"{args.prefix}/{os.path.basename(path)}", None))
                if path.lower().endswith(".webp"):
                    ids.append(os.path.splitext(os.path.basename(path))[0])
        jobs.append((None, f"{args.prefix}/index.json", json.dumps(sorted(ids)).encode()))
    else:
        keys = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(OUT, "1024", "*.webp")))
        live = set(live_index(args.prefix, "pets/index.json")) if args.new_only else set()
        live2k = set(live_index(args.prefix, "pets/2k/index.json")) if args.new_only else set()
        for k in keys:
            if k in live:
                continue
            jobs.append((os.path.join(OUT, "1024", f"{k}.webp"), f"{args.prefix}/pets/{k}.webp", None))
            thumb = os.path.join(OUT, "512", f"{k}.webp")
            if os.path.exists(thumb):
                jobs.append((thumb, f"{args.prefix}/pets/512/{k}.webp", None))
        keys2k = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(OUT, "2048", "*.webp")))
        for k in keys2k:
            if k in live2k:
                continue
            jobs.append((os.path.join(OUT, "2048", f"{k}.webp"), f"{args.prefix}/pets/2k/{k}.webp", None))
        if keys2k:
            jobs.append((None, f"{args.prefix}/pets/2k/index.json", json.dumps(keys2k).encode()))
        jobs.append((None, f"{args.prefix}/pets/index.json", json.dumps(keys).encode()))

    size = sum(os.path.getsize(p) for p, _, _ in jobs if p)
    print(f"{len(jobs)} files, {size / 1e6:.1f} MB")
    for p, remote, _ in jobs[:5]:
        print("  ", remote)
    if not args.apply:
        print("dry run: add --apply (with BUNNY_STORAGE_ZONE and BUNNY_STORAGE_KEY set) to upload")
        return

    zone = os.environ.get("BUNNY_STORAGE_ZONE")
    key = os.environ.get("BUNNY_STORAGE_KEY")
    host = os.environ.get("BUNNY_STORAGE_HOST", "storage.bunnycdn.com")
    if not zone or not key:
        sys.exit("BUNNY_STORAGE_ZONE and BUNNY_STORAGE_KEY must be set in the environment")

    def send(job):
        path, remote, data = job
        ext = os.path.splitext(remote)[1].lower()
        try:
            body = data if data is not None else open(path, "rb").read()
            put(host, zone, key, remote, body, TYPES.get(ext, "application/octet-stream"))
            return None
        except Exception as e:
            return f"{remote}: {e}"

    # Manifests (index.json) go last, one by one, and only if every file made it,
    # so the app never lists art that isn't there yet.
    files = [j for j in jobs if not j[1].endswith("index.json")]
    manifests = [j for j in jobs if j[1].endswith("index.json")]
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        errors = [e for e in pool.map(send, files) if e]
    if not errors:
        for m in manifests:
            err = send(m)
            if err:
                errors.append(err)
    else:
        print("some files failed: manifests NOT updated (re-run to retry)")
    for e in errors:
        print("  failed", e)
    print(f"uploaded {len(jobs) - len(errors)}/{len(jobs)}")


if __name__ == "__main__":
    main()
