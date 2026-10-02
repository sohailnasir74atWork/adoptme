#!/bin/zsh
# Background watcher: pull finished redraws from gs://adoptme-petcards-redraw-kit/out/,
# process them (redraw.py -> 512/1024/2048), archive the bucket copy to done/,
# and push to the Bunny CDN every 10 pets or when the queue goes idle.
#   nohup scripts/pet-cards/hd-art/gemini/watch.sh >> /tmp/petwatch.log 2>&1 &
cd "$(dirname "$0")/../.."          # scripts/pet-cards
source ./.env.cards
cd hd-art
B=gs://adoptme-petcards-redraw-kit
python3 redraw.py 2>&1 | grep -v '^$'          # anything a previous watcher left half-done
pending=1; idle=0
while true; do
  got=0
  for obj in $(gcloud storage ls "$B/out/" 2>/dev/null | grep '\.png$'); do
    k=$(basename $obj .png)
    gcloud storage cp -q "$obj" "out/remaster/$k.png" >/dev/null 2>&1 || continue
    gcloud storage mv -q "$obj" "$B/done/$k.png" >/dev/null 2>&1
    python3 redraw.py "$k" 2>&1 | grep -v '^$'
    got=1; pending=$((pending+1))
  done
  if [ $got = 0 ]; then idle=$((idle+1)); else idle=0; fi
  if [ $pending -ge 10 ] || { [ $pending -gt 0 ] && [ $idle -ge 6 ]; }; then
    echo "== $(date +%H:%M) uploading to CDN ($pending new)"
    python3 upload.py --new-only --apply 2>&1 | tail -2
    pending=0
  fi
  sleep 15
done
