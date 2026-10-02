# Pet Cards — feature plan

A free collectible card album for Adopt Me pets. Every day the player opens a pack,
collects real pets as premium trading cards, completes sets built from real in-game
groupings (eggs, Halloween years), and gets something real for finishing them: a
profile frame everyone sees, a phone and desktop wallpaper made from their own cards,
and a pull card to share.

Companion file: **`PET_CARDS_ART_PROMPTS.md`** (every image asset, with ready-to-paste
prompts, sizes, file names and the HD pipeline).

Written 2026-10-01. **Parked 2026-10-02**: the app code is committed and the pet art is 74% uploaded, but nothing server-side is deployed. Resume from §10 at the bottom.

---

## 1. The rules that shape everything

| Rule | Why |
|---|---|
| **Packs are never sold for money and never a Pro perk.** Earned only: daily free pack, stars, Squad, streaks. | Paid random packs are loot boxes. Australia raised the minimum classification for games with paid loot boxes; the UK is watching them; Apple requires odds for paid ones. Stars are earn-only today, so packs stay outside all of that. |
| **No card ships without HD art.** A pet joins the pack pool only when its 1024 px art exists (`card_catalog.hd_ready`). | The app's pet images are 128×128 px. Stretched onto a full-screen card they look blurry. |
| **Frames, text and effects are drawn in code; AI makes the painted parts.** | Code-drawn frames are sharp at any size, line up the same on all 787 cards, carry text in 6 languages (Arabic right-to-left), and weigh almost nothing. AI art (backgrounds, materials, ornaments, packs, backs, wallpapers) gives the premium look. |
| **The server rolls every pack.** | Profiles show collections and serial numbers. A client-rolled pack could be faked. |
| **No trading, no free text, no player-to-player transfers in v1.** | Kids audience; card trading would open a new scam channel in chat. |
| **Sets come from real in-game groupings.** | Kids recognise "Fossil Egg" and "Halloween 2019". A made-up set means nothing to them. |

---

## 2. What the player sees

### 2.1 Entry points
1. **Home**: a large animated card under Trade Match/Squad: "🎴 Your free pack is ready" with a shimmering pack. When no pack is ready, it shows set progress ("Haunted Carnival 41/70") and a countdown to the next free pack.
2. **Profile drawer** (`BottomDrawer.jsx`): a **showcase** of the player's 3 chosen cards plus the collector score pill. It is loaded with the cosmetics row, so it costs no extra reads.
3. **Push**: one local notification a day, "Your free pack is ready", sent by notifee on the device (no server cost). Players can turn it off.
4. **Values screen**: a pet's detail sheet shows "You own this card ✓" or "Missing from your album".

### 2.2 Screens
| Screen | What it does |
|---|---|
| **Card Hub** (`PetCardsScreen`) | The player's packs (free, star, credits), the current limited set banner, album progress per set, collector score, and an odds button. |
| **Pack Opening** (`PackOpeningScreen`) | The pack sits on a lit stage. The player swipes across the top to tear it (haptic tick), and 3 cards slide out face-down. Tapping flips them one at a time. Before a rare card flips, its back glows in the rarity colour (the "tease"). Legendary cards get a white flash, light rays and a heavy haptic. Mega cards get a slow rainbow flip and a sparkle burst. A summary row at the end shows NEW / duplicate (+shards) / serial number. |
| **Album** (`CardAlbumScreen`) | Binder pages of 3×3 pockets, like a real 9-pocket binder page. Missing cards show the pet's silhouette and collector number, and the page shows the set's completion ring. Tabs: Limited (Halloween) · Eggs (18 pages) · All Pets (787) · Finishes. |
| **Card Viewer** (`CardViewerModal`) | The full-size card. Dragging tilts it in 3D and moves the holo shine. Tapping flips it to the back, which shows the value chart, Neon/Mega values, demand, egg origin, owned finishes and the serial. Actions: Share · Showcase · Craft (if missing). |
| **Set Complete** | A celebration screen with the reward: profile frame, phone wallpaper and 4K desktop wallpaper built from the player's own cards, and a share card. |

### 2.3 What each pack contains
3 cards. Slots 1–2 are any rarity; slot 3 is the **hit slot**.

| Pet rarity | Slots 1–2 | Slot 3 (hit) |
|---|---|---|
| Common | 40% | — |
| Uncommon | 28% | — |
| Rare | 18% | 55% |
| Ultra-Rare | 10% | 30% |
| Legendary | 4% | 15% |

**Finish** is rolled separately for every card. The finish is the "simple to fancy" ladder (§3.3).

| Finish | Chance | Serial number |
|---|---|---|
| Classic | 72% | — |
| Foil | 14% | — |
| Neon | 8% | — |
| Holo | 4% | yes |
| Gilded | 1.4% | yes |
| Mega | 0.5% | yes |
| Full Art | 0.1% | yes |

**Fairness (all enforced on the server):**
- **New-card bias.** After the rarity is rolled, the card is picked from the player's *missing* cards of that rarity with probability 60% in limited sets and 45% in All Pets.
- **Legendary pity.** A Legendary is guaranteed in the hit slot if none came in the last 8 packs.
- **Holo pity.** Holo or better is guaranteed if none came in the last 12 packs.
- **Serials.** Holo and better finishes get a global serial number per card+finish ("#0042"). Serial #1–#100 also carries a **1st Edition** stamp. This is the bragging-rights mechanic, and it costs nothing.
- **Odds.** The full odds table is one tap away on the Card Hub.

### 2.4 Earning packs
| Source | Amount | Notes |
|---|---|---|
| Daily free pack | 1 / UTC day | The core habit. |
| Stars | 5 ⭐ per pack, max 2 / day | Stars remain valuable for Mystery Egg. |
| 7-day streak | +1 bonus pack on day 7 | Resets if a day is missed. |
| Squad (phase 3) | +2 pack credits to both inviter and friend when the friend qualifies | Needs a small additive change to live `squad_ping`. |
| Event days (phase 3) | Admin grants a credit to everyone | Example: Halloween launch day. |

### 2.5 Duplicates → Shards → Crafting
- **Shards per duplicate:** Common 5 · Uncommon 10 · Rare 25 · Ultra-Rare 50 · Legendary 100.
- **Finish multiplier on shards:** Classic ×1 · Foil ×2 · Neon ×3 · Holo ×5 · Gilded ×10 · Mega ×20 · Full Art ×40.
- **Crafting** makes any *Classic* card the player is missing. Cost: Common 40 · Uncommon 80 · Rare 200 · Ultra-Rare 400 · Legendary 1,000.
- Fancy finishes stay luck-only; Full Art can never be crafted. Crafting means no kid is stuck at 69/70 forever.

### 2.6 Collector score
Each unique (card, finish) the player owns scores rarity points × the finish multiplier, with rarity points C 1 · U 2 · R 4 · UR 8 · L 16. The score shows on the profile pill and the weekly leaderboard (phase 3).

### 2.7 Rewards for completing sets
| Set | Reward |
|---|---|
| Any **Egg page** (7–12 cards) | Egg seal on the profile showcase + that egg's phone wallpaper + 50 shards |
| **Haunted Carnival** (70, limited) | Exclusive animated profile frame "Haunted Carnival" + Halloween card back + phone wallpaper + 4K desktop wallpaper |
| **Dragon Hoard** (31) | "Dragon Hoard" profile frame + wallpapers |
| **All Pets** master (787) | "Island Master" title + gold card back |

### 2.8 Wallpaper Studio
Wallpapers are **composed by the app from the player's own pets**, so every kid's wallpaper is different, and a different wallpaper is one they want to show. The studio builds on the More tab's wallpapers. Their best performers (one big pet peeking up from the bottom over a themed pattern, top kept clear for the clock) set the base layout. The studio adds what a static picture can't have: the player's own pets, **live values and weekly trends**.

| Style | What it is |
|---|---|
| **Peek-a-boo** | The More tab's winning layout, personal: a giant pet rising from the bottom edge, a themed pattern, a value sticker. |
| **Value Poster** | A pet on a light burst with a glass stats panel: Value / Neon / Mega, ▲▼ weekly trend, dated. |
| **Top Values** | A ranked board (gold/silver/bronze) of "my best cards" or "top pets right now", with HD pets, values and trends. |
| **Squad** | A group shot of up to 5 pets on a lit stage, value tags under each. |
| **Neon** | Synthwave: striped sun, perspective grid, pets with glowing outlines (a nod to Neon pets). |
| **Scrapbook** | Tilted polaroids with washi tape and stickers; captions show name and value. |
| **Pattern** | The pets themselves as a repeating pattern, the favourite in a ring badge. |
| **Card Fan** | The cards themselves, fanned, with light rays. |

- **Backgrounds:**
  - 12 light themes: Cotton Candy, Peach Sorbet, Mint Shake, Lavender Dream, Lemonade, Sky Island, Sakura, Honey, Pastel Rainbow, Cloud Nine, Ice Cream, Sunrise.
  - 12 dark themes: Galaxy, Midnight, Neon City, Haunted, Emerald, Ruby, Black Gold, Deep Ocean, Aurora, Volcano, Royal, Hot Cocoa.
  - 20 painted scenes.
  - 10 motif patterns: crystals, candy, stars, hearts, bubbles, snow, paws, notes, sparkles, none.
  - Each theme is drawn in code (layered gradients) until its painted `WB-*` backdrop is uploaded (prompts §11.7).
- **Extras:** sparkles, glow, title, values, app name, and a lock-screen clock preview (preview only, never saved).
- **Formats:** phone 1290×2796 and desktop 3840×2160 (4K), saved straight to the photo library.
- **Sharpness:** big pets use the 2048 px art (`process.py --x2k`), so they stay sharp at 4K.

---

## 3. Visual design

### 3.1 Card anatomy (master canvas 1500×2100, 5:7, the real trading-card ratio)
```
┌───────────────────────────────┐  outer frame — material depends on finish
│ SHADOW DRAGON            ◆    │  header 4–13%: name (left) · rarity gem (right)
│ ┌───────────────────────────┐ │
│ │                           │ │  art window 13–66%: set/egg background art
│ │        [ pet 1024px ]     │ │  + HD pet; Mega/Full Art pets break out of the top
│ │                           │ │
│ └───────────────────────────┘ │
│ ⬢ Halloween 2019 · ✦ HOLO     │  type line 66–71%: set emblem · origin · finish
│ VALUE 675   Neon 2.4K  Mega 9K│  stat plate 71–90%: values from the live feed
│ ⚡ Sells fast                  │  demand (existing tradeAdvice tags)
│ 112/787      #0042 1st Edition│  footer 92–97%: collector no. · serial
└───────────────────────────────┘
```
- All text is real text, in the player's language. Arabic mirrors the layout.
- The tiny footer line reads "Fan-made · not affiliated with Uplift Games".
- The card design is our own: no yellow Pokémon border, no energy symbols, no Adopt Me logo.

### 3.2 Rarity colours (Adopt Me's own convention)
| Rarity | Base | Light | Neon glow |
|---|---|---|---|
| Common | `#9AA8B8` | `#E6ECF2` | `#C9D6E3` |
| Uncommon | `#3DBE5A` | `#DDF7E3` | `#5CFF85` |
| Rare | `#2E9BF0` | `#DCEFFE` | `#4FD2FF` |
| Ultra-Rare | `#A855F7` | `#F1E3FF` | `#D07BFF` |
| Legendary | `#F5A700` | `#FFF1CC` | `#FFD23F` |

### 3.3 The finish ladder (simple → fancy)
| # | Finish | Look | How it is built |
|---|---|---|---|
| 1 | **Classic** | Clean matte frame in the rarity colour, soft paper grain, painted background. Calm and premium. | RN gradient + paper texture `T-PAPER` |
| 2 | **Foil** | Brushed-metal frame tinted with the rarity colour; a light streak follows the finger. | `T-BRUSHED` + moving specular strip |
| 3 | **Neon** | Near-black card, glowing tube frame, glowing pet and name. It mirrors Neon pets. | `boxShadow` glow + darkened background + neon tint |
| 4 | **Holo** | The art window's background becomes holographic foil that shifts colour as you tilt. | `H-*` holo pattern, `mixBlendMode: color-dodge` + moving rainbow |
| 5 | **Gilded** | Gold-leaf frame, engraved corner ornaments, parchment stat plate, embossed name. | `T-GOLDLEAF` + `O-GILDED-*` ornaments |
| 6 | **Mega** | Rainbow border that slowly cycles, holo + neon together, pet breaks out of the frame, sparkles. It mirrors Mega Neons. | rotating conic texture `T-CONIC` + layers 3+4 + pop-out |
| 7 | **Full Art** | No frame. The painting fills the card, the pet is big, and text sits on frosted glass plates. Hairline gold edge. | `BG-*` full-card version + glass plates |

**Set themes** change the palette, ornaments, backgrounds and card back, but not the layout:
- **Adoption Island** (All Pets): warm cream, sky blue, palm green, sand. Storybook island light.
- **Haunted Carnival** (Halloween 2026, limited): midnight, plum, candy-corn orange, slime green, bone. Wrought-iron filigree, carnival bulbs, moonlit fog.
- **Egg pages**: each card's art window uses its egg's biome (Fossil → amber dig site, Ocean → coral reef, Moon → crater with earthrise, and so on). A card's background shows where the pet comes from in the game.

### 3.4 Motion (no Reanimated: it was removed for app size)
- **Tilt.** A PanResponder drives `Animated` rotateX/rotateY with `perspective`, using the native driver. On release the card springs back.
- **Shine.** A large rainbow/specular strip, clipped by the card, moves opposite to the finger.
- **Idle.** Rare+ cards run a slow 6 s shine loop, so they look alive in screenshots and screen recordings.
- **Mega border.** `T-CONIC` rotates behind an inset card body (native driver, 60 fps).
- **Reveal.** A flip (`rotateY` 180° with a backface swap), a rarity-tinted radial flash using `backgroundImage: radial-gradient`, and haptics from `react-native-haptic-feedback`.
- **Bursts.** Particle bursts are small Animated sprites. No new library.

RN 0.87 on the New Architecture supports `backgroundImage` (linear/radial gradients), `mixBlendMode`, `boxShadow` and `filter`. These cover everything above without SVG or a new dependency.

---

## 4. HD art pipeline (pets)

Measured 2026-10-01:
- App images (elvebredd.com): **128×128** px for every pet.
- Adopt Me wiki renders, found for 776 of 787 pets:

| Best render size | Pets |
|---|---|
| ≥ 1000 px | 289 |
| 512–999 px | 88 |
| 256–511 px | 309 |
| < 256 px | 90 |
| none | 11 |

Target: **every pet at 1024×1024, transparent, WebP q92 (~40–90 KB)**, plus a 512 px thumbnail, hosted on Bunny at `cards/v1/pets/<slug>.webp`.

The pipeline lives in `scripts/pet-cards/hd-art/`; `PET_CARDS_ART_PROMPTS.md` §2 has the commands.
1. **Collect.** Take the best wiki render per pet (`File:<Name>.png`, then the page image) and check it has a transparent background.
2. **Clean.** Trim the empty margin and pad to a square with an 8% margin.
3. **Scale:**
   - ≥ 1024 px: Lanczos down to 1024.
   - 512–1023 px: AI upscale ×2, then down to 1024.
   - < 512 px: AI upscale ×4 (Real-ESRGAN anime model, free and offline on Apple Silicon via `realesrgan-ncnn-vulkan` or the Upscayl app).
4. **Review.** A contact sheet (`review.html`) shows before and after, flagged by risk: no alpha, ×4 upscale, screenshot-like source.
5. **Remaster.** Rejects (blurry, wrong pose, background baked in) are redrawn from the reference with the "HD remaster" prompt (prompts §9), then checked against the original by eye.
6. **Upload.** The key comes from an environment variable, never from code (the `post-gag` key leak is the lesson). The script then marks `hd_ready` in `card_catalog`.

**Launch bar:** Haunted Carnival needs its 70 pets HD-ready. All Pets launches with whatever is ready (expected 600+), and the rest join as they pass review.

---

## 5. Data and server (Supabase, `supabase/037_pet_cards.sql`)

Same pattern as Squad and Trade Match: tables locked to the service role, `security definer` RPCs keyed on `firebase_uid()`, no realtime, pg_cron retention.

### 5.1 Tables
| Table | Purpose |
|---|---|
| `card_catalog` | `key` (= `petKey`, e.g. `shadow dragon\|pet`), `name`, `rarity`, `no` (collector number), `egg`, `sets text[]`, `hd_ready`, `active` |
| `card_sets` | `id`, `kind` (`pack` \| `page`), `names jsonb` (6 languages), `theme`, `starts_at`, `ends_at`, `sort`, `pack bool`, `art jsonb` (CDN urls) |
| `card_collection` | PK (`uid`, `card_key`, `finish`), `count`, `first_at`, `best_serial` |
| `card_wallet` | `uid` PK, `shards`, `pity_legend`, `pity_holo`, `free_day`, `star_day`, `star_count`, `streak`, `streak_day`, `credits jsonb`, `packs_opened`, `score` |
| `card_serials` | PK (`card_key`, `finish`), `last_serial` |
| `card_pulls` | Pull log (`uid`, `set_id`, `card_key`, `finish`, `serial`, `source`, `created_at`). Rows with a serial are kept forever (provenance); others are kept 30 days. |

`user_cosmetics` gets `card_score int` and `card_showcase jsonb`, so profiles show them with no extra reads (the same trick as `squad_count`).

### 5.2 RPCs
| RPC | Does |
|---|---|
| `cards_state()` | Wallet, packs available now, next free time, active sets, per-set progress. One call per Card Hub open (cached 2 min). |
| `open_card_pack(p_set, p_source)` | Checks the source (free / stars / streak / credit), rolls 3 cards with the odds, bias and pity above, assigns serials, updates the collection, wallet, score and showcase mirror, and returns the cards. |
| `craft_card(p_key)` | Spends shards to make a Classic card. |
| `get_card_album(p_set, p_uid default caller)` | Owned (key, finish, count, best_serial) for one set. Other players' albums are readable, because showcasing is the point. |
| `set_card_showcase(p_cards jsonb)` | Up to 3 owned cards, written to the `user_cosmetics` mirror. |

**Stars:** stars live in RTDB (`users/{uid}/dailyStars/starBalance`) and are trusted from the client, the same as Mystery Egg. The client spends them, then calls `open_card_pack(set,'stars')`; if the call fails, it refunds with `increment`, as Mystery Egg does. The server caps star packs at 2 a day, so a forged star balance gains at most what an honest player gets.

### 5.3 Catalog sync
`scripts/pet-cards/sync-card-catalog.js` reads the live CDN catalog (`adoptme.b-cdn.net`), joins the wiki groupings (egg and event categories, cached in `scripts/pet-cards/sets.json`), assigns stable collector numbers (new pets append; numbers never change), and upserts `card_catalog`. Run it when new pets arrive. It is dry-run by default, like the Trade Match backfill.

### 5.4 Cost
- About 2–4 RPCs per player per day.
- Storage: a typical player has 100–300 collection rows, which is roughly 300 MB at 10k players.
- No realtime messages.
- CDN: about 50 MB of pet art; views are cached by the HTTP layer.
- App size: the bundle holds only gems, emblems and the small textures (about 400 KB); all big art lives on the CDN.

---

## 6. Client code (`Code/PetCards/`)

| File | Role |
|---|---|
| `cardConfig.js` | Odds, finishes, rarity colours, shard and craft tables. These mirror the SQL and are display-only. |
| `cardThemes.js` | Set themes: palettes, gradients, which textures and ornaments to use. |
| `cardAssets.js` | Asset manifest: key → bundled `require` or CDN URL. If art is missing, it falls back to procedural gradients so nothing ever renders broken. |
| `cardsApi.js` | RPC wrappers and an MMKV cache (per uid, cleared on logout with `remove()` per MMKV v4). |
| `cardMath.js` | Pure helpers: set progress, score, pack availability, countdowns. Tested in `__tests__/petCards.test.js`. |
| `PetCard.jsx` | The renderer. Sizes: `thumb` (album pocket), `medium` (reveal), `full` (viewer), `export` (share/wallpaper). Thumbs skip heavy layers. |
| `CardShine.jsx` | Tilt + holo/shine layers (Animated + PanResponder). |
| `PackOpeningScreen.jsx`, `CardAlbumScreen.jsx`, `PetCardsScreen.jsx`, `CardViewerModal.jsx` | The screens. |
| `CardShareSheet.jsx` | 9:16 pull and collection share cards, made with `react-native-view-shot` and `react-native-share`. |
| `CardWallpaper.jsx` | Builds the phone and 4K wallpapers off-screen and saves them with CameraRoll. |

**Wiring:**
- `App.js` stack screens.
- The Home card.
- The `BottomDrawer` showcase.
- The Values detail "owned" tick.
- A notifee daily local reminder.
- i18n `pet_cards.*` keys, written natively in en/ru/es/fr/de/ar (rewritten per language, using the in-game terms already in `Translation/*.json`).
- `trackGrowthEvent` events: `cards_hub_open`, `card_pack_open {set, source}`, `card_pull {rarity, finish}`, `card_share {kind}`, `card_set_complete {set}`, `card_wallpaper_save {set, format}`, `card_craft {rarity}`.

**Feature flag:** RTDB `config/petCards = { enabled, sets }` (read once at boot). It keeps the screen hidden until the art and SQL are live.

---

## 7. Launch sets (from the Adopt Me wiki categories, matched to the catalog)

| Set | Kind | Cards | Window |
|---|---|---|---|
| **Haunted Carnival** | Pack + page | 70 (every pet from Halloween events 2017–2026: Bat Dragon, Shadow Dragon, Evil Unicorn, Headless Horse, Phantom Dragon…) | Halloween launch → ~10 Nov 2026, then the pack retires (cards stay; craftable) |
| **All Pets** | Pack | 787 | Always |
| **Egg pages** ×18 | Pages (filled by any pack) | Farm 9 · Safari 7 · Jungle 7 · Aussie 8 · Fossil 12 · Ocean 8 · Mythic 7 · Japan 12 · Danger 12 · Woodland 8 · Moon 8 · Desert 12 · Urban 12 · Endangered 10 · Fairytale 10 · Aztec 8 · Southeast Asia 10 · Garden (names to fix) | Always |
| **Dragon Hoard** | Page | 31 | Phase 3 |
| **Cat Café** | Page | ~40 (incl. the new Sept cats) | Phase 3 |
| **Winter Wonderland** | Pack + page | 84 (Christmas/Winter events) | December |

---

## 8. Build order

| Phase | Who | What | Done when |
|---|---|---|---|
| **0. Art** | Owner (+ me for scripts) | HD pet pipeline; generate the assets in `PET_CARDS_ART_PROMPTS.md` (Priority A first) | 70 Halloween pets + Priority A assets uploaded |
| **1. Core** | Me | SQL 037 tested on PGlite; catalog sync script; `Code/PetCards/*` renderer, Card Hub, pack opening, album, viewer; i18n ×6; procedural fallbacks so it runs before art lands | Pack → reveal → album works on the Android emulator and iOS simulator |
| **2. Viral layer** | Me | Share cards, set-complete wallpapers (phone + 4K), profile showcase, Home card, daily reminder | A screenshot of each on device |
| **3. Retention** | Me | Squad pack credits, leaderboard, Dragon/Cat pages, Winter set | — |
| **Deploy** | Owner says go | Run SQL 037; run catalog sync `--apply`; upload art; flip `config/petCards.enabled` | — |

---

## 9. Kids-safety checklist
- [ ] No real-money path to any pack, directly or through Pro.
- [ ] Odds visible before opening.
- [ ] No gambling words ("bet", "spin", "jackpot") in any language.
- [ ] No free text. Card names come from the catalog.
- [ ] One reminder push a day at most, with an opt-out.
- [ ] No "only 2 hours left!" pressure pushes. The limited set shows a calm end date.
- [ ] No card trading between players.
- [ ] Showcase shows only cards and score, never anything personal.
- [ ] Disclaimer: fan-made, not affiliated with Uplift Games.

---

## 10. Where it stands (2026-10-02) and how to resume

Parked on the owner's decision: ship the pending uploads and the app release
first, then come back here. Everything below was checked on 2026-10-02, not
taken from notes.

### Done

| Piece | State | Proof |
|---|---|---|
| App code (`Code/PetCards/*`, Home card, i18n ×6, tests) | Committed `7cb431b`, pushed on `bump-android-138` | `git log` |
| Pet HD art on the CDN | **579 / 785 pets**, all three sizes (1024 / 512 / 2048), manifest `https://cardspull.b-cdn.net/v1/pets/index.json` | `python3 scripts/pet-cards/hd-art/gemini/status.py`; `verify_cdn.py` reported 0 missing / 0 different |
| CDN zone | Storage zone `adoptme-cards`, pull zone **`cardspull.b-cdn.net`** (`CARDS_CDN` in `cardConfig.js`) | `curl -I https://cardspull.b-cdn.net/v1/pets/dalmatian.webp` → 200 |
| SQL 037 tested | 50/50 on PGlite (`scripts/pet-cards/test037.mjs`) | — |
| Bundled textures / holo patterns | 7 webp in `assets/pet-cards` (180 KB) | — |

Safe to release the app before the rest: in release builds the Home card
hides itself when `cards_state` fails (037 missing) or when no pack has cards,
so players see nothing until the server side is ready. Dev builds fall back to
`cardsMock.js` automatically.

### Not done

| Piece | State | Notes |
|---|---|---|
| Pet HD art, remaining | **206 pets**: 202 in the kit 2 queue + 4 refused by Gemini (`halloweengoldenmummycat`, `evilbasilisk`, `halloweenblackmummycat`, `monkeyking`; `businessmonkey` refused too) | Procedure, limits and the no-typing runner are in `scripts/pet-cards/hd-art/REDRAW_PROGRESS.md`. Free Gemini allows ~75 images per short-term window, so ~3 windows. Refused pets go through ChatGPT (3 a day). Launching with 579 is fine: only `hd_ready` cards can be pulled. |
| Non-pet art (`PET_CARDS_ART_PROMPTS.md` §3–§11: backgrounds, card backs, packs, gems, emblems) | Never uploaded (`v1/index.json` is 404) | Optional polish. The app draws packs, backs, frames and gems procedurally (`PackArt.jsx`, `CardBack.jsx`, `RarityGem.jsx`). Upload later with `upload.py --dir <folder> --apply`; the app only requests art that the manifest lists. |
| SQL 037 | **Not deployed** (no `card_*` tables live, 0 `cards_*` functions) | Additive; nothing in the app or RTDB depends on it until the Home card finds a pack. |
| Catalog sync | Not run (needs 037) | `scripts/pet-cards/sync-card-catalog.js` fills `card_catalog` from the live values catalogue + `sets.json` (21 sets) + the CDN manifest (`hd_ready`). Dry run by default. |
| Launch packs | Seeded by 037: `haunted26` (Haunted Carnival, **retires 2026-11-10**) and `all` (All Pets, no end) + 18 egg album pages | If the resume lands after 10 Nov, `haunted26` is already retired: pick a new seasonal pack or extend `ends_at` before launch. |
| Device test | Not done since the last code changes | Use the `PetCardsTest` AVD (emulator-5556), not Pixel9; `dev-cdn.py` on :8765 + `adb reverse tcp:8765 tcp:8765` for local art. |

### Resume checklist, in order

1. **(Optional, any time) Finish the pet art.** Follow `hd-art/REDRAW_PROGRESS.md`
   → `upload.py --apply` → `verify_cdn.py` → purge the three `index.json` URLs.
   Can also continue after launch: new `hd_ready` pets join packs on the next
   catalog sync.
2. **Deploy 037** through the Management API in one transaction (same path as
   038/040; PAT in `~/.supabase/access-token`). Re-run `test037.mjs` first if
   the file changed. Check after: `card_sets` has `haunted26` + `all` + 18 pages.
3. **Catalog sync.** Secrets from GCP Secret Manager:
   `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/pet-cards/sync-card-catalog.js`
   (dry run; expect ~785 rows, 579+ `hd_ready`), then `--apply`. Collector
   numbers are assigned once and never change.
4. **Check the packs open.** `select id, kind, starts_at, ends_at, active from card_sets where kind='pack'`;
   fix `ends_at` on `haunted26` or add the season's pack. Confirm
   `cards_state` returns a pack with `total > 0` for a test uid.
5. **Device pass** on `PetCardsTest`: Home card → hub → open a pack → album →
   viewer → share card → Wallpaper Studio, light and dark.
6. **Release.** The Home card appears by itself once step 4 holds; no app flag
   to flip. Watch `open_card_pack` error rate and the `pet_cards.err.*` keys
   in analytics for the first days.
7. **After launch:** the §9 kids-safety checklist, then §8 phase 3 (Squad
   pack credits, leaderboard, Winter set).

