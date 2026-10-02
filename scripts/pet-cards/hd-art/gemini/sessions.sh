#!/bin/zsh
# usage: sessions.sh key...  ->  key<TAB>uploadURL
# Each URL is a GCS resumable-upload session: it can write exactly one object
# (out/<key>.png in the redraw bucket), needs no token in the browser, and
# stays valid for 7 days. Created with your gcloud login.
T=$(gcloud auth print-access-token)
for k in "$@"; do
  u=$(curl -s -D - -o /dev/null -X POST \
    -H "Authorization: Bearer $T" -H "Origin: https://gemini.google.com" \
    -H "X-Upload-Content-Type: image/png" -H "Content-Length: 0" \
    "https://storage.googleapis.com/upload/storage/v1/b/adoptme-petcards-redraw-kit/o?uploadType=resumable&name=out/$k.png" \
    | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r')
  print "$k\t$u"
done
