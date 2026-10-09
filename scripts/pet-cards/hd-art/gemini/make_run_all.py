"""Run list for every pet still to redraw: kit 2 (no HD art yet) first, then
kit 3 (live, but upscaled from originals under 384 px: the weakest art).
One GCS resumable-upload session per pet (retried), staged in the bucket
under a random name. Prints the name; delete q/<name>.json after loading.

    python3 scripts/pet-cards/hd-art/gemini/make_run_all.py
"""
import json, os, subprocess, sys, time, uuid

HD = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(HD, 'out')
SKIP = {'businessmonkey'}  # Gemini refuses (third-party content)


def done(k):
    return any(os.path.exists(os.path.join(OUT, 'remaster', f'{k}{e}')) for e in ('.png', '.jpg'))


def session(k, token):
    for attempt in range(4):
        r = subprocess.run(['curl', '-s', '-D', '-', '-o', '/dev/null', '-X', 'POST',
                            '-H', f'Authorization: Bearer {token}', '-H', 'Origin: https://gemini.google.com',
                            '-H', 'X-Upload-Content-Type: image/png', '-H', 'Content-Length: 0',
                            f'https://storage.googleapis.com/upload/storage/v1/b/adoptme-petcards-redraw-kit/o?uploadType=resumable&name=out/{k}.png'],
                           capture_output=True, text=True)
        for line in r.stdout.splitlines():
            if line.lower().startswith('location:') and 'upload_id=' in line:
                return line.split('upload_id=')[1].strip()
        time.sleep(2 + attempt * 3)
    return None


rows = []
for kit in ('kit2', 'kit3'):
    path = os.path.join(OUT, kit, 'queue.json')
    if not os.path.exists(path):
        continue
    for k, name, bg in json.load(open(path)):
        if k in SKIP or done(k) or any(r[0] == k for r in rows):
            continue
        rows.append([k, name, bg])
print(f'{len(rows)} pets to run', file=sys.stderr)
token = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True).stdout.strip()
out, failed = [], []
for i, (k, name, bg) in enumerate(rows):
    uid = session(k, token)
    (out.append([k, name, bg, uid]) if uid else failed.append(k))
    if i % 25 == 24:
        print(f'  {i + 1}/{len(rows)}', file=sys.stderr)
if failed:
    print(f'no upload session for: {failed}', file=sys.stderr)
n = str(uuid.uuid4())
tmp = f'/tmp/{n}.json'
json.dump(out, open(tmp, 'w'), separators=(',', ':'))
subprocess.run(['gcloud', 'storage', 'cp', '-q', tmp, f'gs://adoptme-petcards-redraw-kit/q/{n}.json',
                '--content-type=application/json', '--cache-control=no-store'], check=True)
os.remove(tmp)
print(f'{len(out)} staged', file=sys.stderr)
print(n)
