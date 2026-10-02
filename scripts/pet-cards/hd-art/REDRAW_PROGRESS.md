# Pet art: HD progress and how to resume

Last updated **2026-10-02, 17:40 PKT**, when everything was paused.
For live numbers, run `python3 scripts/pet-cards/hd-art/gemini/status.py`. It counts from the files, so it stays right even after this note goes stale.

## Where it stands

| | Pets |
|---|---|
| Pets in the catalogue | 785 |
| **HD art live on the CDN** | **579** (all three sizes: 1024, 512, 2048) |
| — direct wiki renders | 255 |
| — Real-ESRGAN upscales | 248 |
| — AI redraws | 76 (Gemini 73, ChatGPT 3) |
| Still without HD art | 206: 202 in the kit 2 queue + 4 refused from kit 1 |

**CDN check (2026-10-02 17:40):**
- `verify_cdn.py` reports 0 missing and 0 different at every size.
- Storage holds 37.5 MB (1024) + 15.3 MB (512) + 84.9 MB (2048).
- The public `https://cardspull.b-cdn.net/v1/pets/index.json` lists 579.

**AI redraw totals:**
- Kit 1 (`out/remaster_kit`): 44 done. Four were refused: halloweengoldenmummycat, evilbasilisk, halloweenblackmummycat, monkeyking.
- Kit 2 (`out/kit2/queue.json`, 234 pets): 32 done, 202 left.
- Business Monkey (kit 2) is refused too.
- Refused pets need ChatGPT's free tier, which allows 3 images a day.

## Free Gemini limits (learned today)

- **Short-term cap:** about 75 images. The first run hit "100% used" at 17:20, and the cap reset at 21:17, i.e. a few hours later.
- **Weekly cap:** only 9% used after those ~75.
- **Effect:** the short-term cap is the bottleneck, so the 202 left need about 3 resets.
- **When capped,** Gemini answers "I can create more images as soon as your limit resets". The model shown also drops to Flash-Lite.
- **Live usage page:** https://gemini.google.com/usage
- **AI Studio is not a free alternative.** Its playground needs a paid plan or API key for image models.

## How it runs (no typing, no Save prompts)

1. **Run list.** `gemini/make_run.sh` lists every kit 2 pet with no redraw yet. It creates one GCS resumable-upload URL per pet; each URL can write only `out/<key>.png`, needs no token in the browser, and lasts 7 days. It stages the list in the bucket under a random name.
2. **In the Gemini tab** (Claude's browser pane, logged in), paste `gemini/runner.js`, then run:
   - `await __petLoad('<name>')`
   - delete `q/<name>.json` from the bucket
   - `__petRun2()` to start now, or `__petSchedule(h, m)` to start after a reset

   The runner then handles each pet:
   - starts a new chat, attaches the reference from `gs://adoptme-petcards-redraw-kit/kit2/<key>.png`, and inserts the prompt with `execCommand`
   - sends it, waits up to 4 minutes, and PUTs the picture to the upload URL
   - keeps its state in localStorage (`petItems`, `petDone`, `petLog`)
   - when capped, waits 30 minutes and retries the same pet
   - skips refusals
3. **Watcher.** `gemini/watch.sh` runs in the background. It pulls `out/*.png` from the bucket and runs `redraw.py`, which clears the white or navy backdrop and makes the 512/1024/2048 sizes. It moves the bucket copy to `done/` and runs `upload.py --new-only --apply` every 10 pets.
4. **Reviewing.** Spot-check with `gemini/sheet.py <out.jpg> <keys…>`, which shows the original next to the redraw on purple.

The browser pane must stay open and visible, and the Mac awake (`caffeinate -dis -t <seconds>`). A hidden pane can't take input.

## Resume from here

```
cd scripts/pet-cards/hd-art
python3 gemini/status.py --list            # what's left
nohup gemini/watch.sh >> /tmp/petwatch.log 2>&1 &
gemini/make_run.sh                         # prints <name>
```

Then, in the Gemini tab:
1. Paste `runner.js`.
2. Run `await __petLoad('<name>')`.
3. Run `gcloud storage rm gs://adoptme-petcards-redraw-kit/q/<name>.json`.
4. Run `__petRun2()`.

**After the last batch:**
- `source ../.env.cards && python3 verify_cdn.py --fix` re-uploads anything missing or changed.
- Then check that the public index count matches.

## Gotchas

- **`upload.py --new-only` skips keys already listed.** A pet redrawn after its first upload never reaches the CDN that way; use `verify_cdn.py --fix`.
- **The public index refreshes on its own after an upload, but with a delay.** It showed 577 for ~15 minutes while storage had 579, then caught up. Adding `?r=` to the URL does not bypass the cache. Purge in the Bunny dashboard if it's needed sooner.
- **Timeouts often finish late.** Open the chat path in `petLog` and grab the picture: Black Springer Spaniel and Capricorn were recovered that way.
- **`out/1024/chimera.webp` was a 0-byte file,** from a run killed mid-write; it was restored from the CDN. `verify_cdn.py` catches such files as "different".
- **Background removal needs the right backdrop.** White backdrop for dark pets; navy `#0A1A3A` for white or light pets. Green keyed out green eyes.

## Cleanup when everything is done

- the bucket `gs://adoptme-petcards-redraw-kit`
- the CDN folders `v1/kit` and `v1/kitjs`
- the dev-cdn server on :8765
