#!/bin/zsh
# Build the run list for every kit2 pet that has no redraw yet, with a fresh
# upload URL each, and stage it in the bucket under a random name for the
# Gemini tab to read once. Prints the object name; DELETE it after loading:
#   gcloud storage rm gs://adoptme-petcards-redraw-kit/q/<name>.json
cd "$(dirname "$0")/.."              # hd-art
G=gemini
keys=($(python3 - <<'PY'
import json,os
skip={'businessmonkey'}               # Gemini refuses these (third-party content)
for k,n,b in json.load(open('out/kit2/queue.json')):
    if k in skip or any(os.path.exists(f'out/remaster/{k}{e}') for e in ('.png','.jpg')): continue
    print(k)
PY
))
echo "${#keys} pets to run" >&2
tmp=$(mktemp)
$G/sessions.sh $keys > $tmp
N=$(uuidgen | tr A-Z a-z)
python3 - "$tmp" <<'PY' > $tmp.json
import json,sys
q={k:(n,b) for k,n,b in json.load(open('out/kit2/queue.json'))}
rows=[]
for line in open(sys.argv[1]):
    k,u=line.rstrip('\n').split('\t'); rows.append([k,q[k][0],q[k][1],u.split('upload_id=')[1]])
print(json.dumps(rows,separators=(',',':')))
PY
gcloud storage cp -q $tmp.json gs://adoptme-petcards-redraw-kit/q/$N.json --content-type=application/json --cache-control=no-store
rm -f $tmp $tmp.json
echo $N
