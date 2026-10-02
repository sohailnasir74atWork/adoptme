# Pet Cards — art production pack

Every image the Pet Cards feature needs, with:
- a ready-to-paste prompt
- the tool and settings
- the exact size and file name
- a pass/fail check

Plan: `PET_CARDS_PLAN.md`.

**Quality bar:** everything high definition. No asset ships blurry, upscaled more than 4× from what the generator produced, or with fake text, melted shapes or watermarks.

---

## 0. How to work through this file

### 0.1 Which tool for what
| Asset type | Best tool | Why |
|---|---|---|
| Painted backgrounds, wallpapers, packs, card backs, stages | **Midjourney v7** (or ChatGPT image as second choice) | Richest painted lighting; `--sref` keeps a whole set consistent |
| Anything that needs a **transparent background** (packs, ornaments, frames) | **ChatGPT image / gpt-image** with "transparent background", then check the alpha | Native transparency; no cut-out halo |
| Gems, set emblems, small icons | **Recraft** (Vector illustration / Icon style), export **SVG** | Vector = sharp at any size, tiny files |
| Tileable textures and holo patterns | **Midjourney `--tile`** | Real seamless tiles |
| Pet HD remaster (only for pets whose original render fails review) | **ChatGPT image** or **Gemini image editing** with the reference attached | Keeps the pet's identity best |
| Upscaling | **Upscayl** (free, Mac) with *Remacri* or *UltraSharp* for painted art, *Real-ESRGAN anime* for pets/flat art; Topaz Gigapixel or Magnific if available | Free and offline |

### 0.2 Consistency method
Generate the **master** of each family first:
- `BG-ISLAND-MEADOW` for the island and egg backgrounds
- `BG-HAUNTED-MIDWAY` for Halloween
- `CB-STANDARD` for card backs
- `P-ISLAND` for packs

Pick the best result, upscale it, and upload it somewhere Midjourney can read. Then:
- **Midjourney:** add `--sref <master image URL> --sw 250` to every other prompt in the family. Keep `--stylize` the same across the family.
- **ChatGPT:** attach the master and start the prompt with *"Match the exact art style, lighting, palette and level of detail of the attached image."*
- **Recraft:** make a custom style from the first 3 approved emblems and use it for all the rest.

### 0.3 HD rules (all assets)
1. Generate at the generator's largest size.
   - Midjourney: the image, then **Upscale (Subtle)** ×2.
   - ChatGPT: quality **high**, size 1024×1536 / 1536×1024 / 1024×1024.
2. Bring every asset to its **Master size** (table in §12). Upscale at most **4× in total** from the native output.
3. Inspect at **100% zoom**. Reject any of these:
   - mushy patches, smeared fine detail or melted shapes
   - letters or squiggles that look like text
   - doubled objects or extra limbs
   - a watermark or signature
   - visible tile seams (for textures)
4. Export to WebP with:
   ```bash
   cwebp -q 90 -m 6 -alpha_q 100 input.png -o OUTPUT.webp
   ```
   Textures use `-q 85`. Keep the PNG master in `art/masters/`.
5. File names are the asset IDs: `BG-HAUNTED-MIDWAY.webp`, `G-LEGENDARY.svg`.

### 0.4 Tool set-up (one time)
```bash
brew install webp imagemagick
```
Upscayl: download the free Mac app from upscayl.org. Pick the model per asset type (above), scale ×2 or ×4, format PNG.

### 0.5 Words that go in EVERY prompt
Paste the **Style block** for the family (§1). End every prompt with the **Rules block**:

> No text, no letters, no numbers, no logos, no watermark, no signature, no UI, no card frame or border unless asked, no people. No animals or creatures unless asked: the pet is added by the app.

Midjourney users: put the Rules as `--no text, letters, numbers, logo, watermark, signature, frame, border, people, animals, creature, character, blurry`.

---

## 1. Style bible

### 1.1 Style block — ISLAND (All Pets + all egg pages + standard backs/packs)
> Premium collectible-card art for a cheerful pet-adoption game. Stylized 3D-painted look: soft rounded clay-like forms with hand-painted texture, like high-end animated-film concept art. Luminous golden-hour lighting with a warm key light, a cool sky-blue rim light and gentle volumetric haze. Rich, harmonious, saturated colours; clean readable shapes; layered depth with soft atmospheric perspective; background gently out of focus so a character placed in front pops. Cosy, magical, safe and friendly for kids. Crisp fine detail, extremely high resolution, sharp, clean, no noise.

### 1.2 Style block — HAUNTED CARNIVAL (Halloween 2026)
> Premium collectible-card art for a cheerful pet game's Halloween event. Spooky-cute, never scary: stylized 3D-painted look with soft rounded forms and hand-painted texture, like a family animated film. Moonlit midnight-blue and deep plum palette accented with glowing candy-corn orange and slime green; warm lantern light against cool fog; gentle volumetric mist; twinkling bulbs. Clean readable shapes, soft depth of field so a character placed in front pops. Crisp fine detail, extremely high resolution, sharp, no noise.

### 1.3 Style block — WINTER (December, phase 3)
> Premium collectible-card art for a cheerful pet game's winter holiday event. Stylized 3D-painted look with soft rounded forms and hand-painted texture. Fresh snow, pink-gold low winter sun or deep blue night with warm window light, sparkling frost, gentle snowfall, cosy and magical. Crisp fine detail, extremely high resolution, sharp, no noise.

### 1.4 Background composition block (every `BG-*`)
> Vertical 5:7 composition. Horizon at about 45% from the top. A clear, uncluttered ground stage in the lower-middle where a character will stand: keep the central 40% of the width calm and open between 35% and 85% of the height. Put most detail toward the edges and in the distance. Even, readable lighting on the central stage.

*Why:* the app crops the art window (a landscape slice of the middle) from this image and uses the whole image for the Full Art finish. One render serves both.

### 1.5 Palette reference (the app's code uses these exact values)
| Name | Hex | Name | Hex |
|---|---|---|---|
| Island cream | `#FFF7E8` | Haunted midnight | `#120B26` |
| Island sky | `#7CC6FF` | Haunted plum | `#3B1E5E` |
| Island palm | `#39B36A` | Candy-corn orange | `#FF7A1A` |
| Island sand | `#F2C879` | Slime green | `#8CFF3A` |
| Common | `#9AA8B8` | Bone | `#EDE6D6` |
| Uncommon | `#3DBE5A` | Rare | `#2E9BF0` |
| Ultra-Rare | `#A855F7` | Legendary | `#F5A700` |

---

## 2. HD pet art (the pets themselves)

The app's pet images are 128×128 px, which is too small for cards. The pipeline in `scripts/pet-cards/hd-art/` builds 1024×1024 transparent WebPs.

```bash
cd /Volumes/Sohail/AI_Projects/RunningApps/adoptme-jan7

# 1. Download the best Adopt Me wiki render for every pet (about 787 files; cached, re-runnable)
python3 scripts/pet-cards/hd-art/collect.py

# 2. Trim, square, scale. Big renders go straight to 1024.
#    Small ones are copied to out/upscale_in/ with the scale they need.
python3 scripts/pet-cards/hd-art/process.py

# 3. AI-upscale the small ones. Pick ONE:
#    a) Upscayl app: input folder out/upscale_in, output out/upscale_out,
#       model "Real-ESRGAN anime" (or "UltraSharp"), scale 4, format PNG
#    b) CLI (if installed):
realesrgan-ncnn-vulkan -i scripts/pet-cards/hd-art/out/upscale_in -o scripts/pet-cards/hd-art/out/upscale_out -n realesrgan-x4plus-anime -s 4 -f png

# 4. Fold the upscaled files back in and build the review sheet
python3 scripts/pet-cards/hd-art/process.py --finish
open scripts/pet-cards/hd-art/out/review.html

# 5. Pets marked REJECT in review: remaster them with prompt PET-REMASTER (§9),
#    save as out/remaster/<slug>.png, then:
python3 scripts/pet-cards/hd-art/process.py --finish

# 6. Upload (dry run first; the key comes from the environment, never from code)
python3 scripts/pet-cards/hd-art/upload.py
BUNNY_STORAGE_ZONE=... BUNNY_STORAGE_KEY=... python3 scripts/pet-cards/hd-art/upload.py --apply
```

**Pass:** 1024×1024, transparent background, pet fills 80–90% of the height, edges clean (no white halo), colours identical to the in-game pet.

---

## 3. Materials and textures (`T-*`), tileable

Master 2048×2048 → app 1024×1024 (the small ones bundled at 512). Midjourney settings for all: `--tile --ar 1:1 --v 7 --style raw --stylize 50`.

**T-PAPER** — Classic finish paper grain
> Seamless tileable texture of premium cotton trading-card stock: very fine fibres and gentle tooth, extremely low contrast, neutral warm white, perfectly even flat lighting, no shadows, no vignette, no stains. Ultra high resolution, crisp micro-detail.

**T-BRUSHED** — Foil finish frame metal (the app tints it)
> Seamless tileable brushed aluminium surface, fine straight horizontal brush lines with subtle variation, neutral mid-grey, perfectly even flat lighting, no reflections of objects, no scratches, no vignette. Ultra high resolution, crisp.

**T-GOLDLEAF** — Gilded finish frame
> Seamless tileable genuine gold-leaf gilding: overlapping gold leaf squares with soft crinkles and hairline cracks, rich warm 24-karat gold with gentle tonal variation, perfectly even lighting, no vignette, no hard shadows. Ultra high resolution, crisp.

**T-PARCHMENT** — Gilded stat plate
> Seamless tileable warm ivory parchment, subtle mottling and soft fibres, very low contrast, perfectly even lighting, no stains, no writing, no vignette. Ultra high resolution.

**T-IRIDESCENT** — foil sheen, Mega layer
> Seamless tileable iridescent holographic film: smooth flowing oil-slick bands of pastel cyan, magenta, gold, lilac and mint, soft and luminous, no hard edges, perfectly even lighting, no vignette. Ultra high resolution, silky smooth gradients.

**T-OBSIDIAN** — Haunted Carnival frame lacquer
> Seamless tileable deep black-violet lacquered obsidian, faint purple sheen, sparse tiny silver glitter flecks, perfectly even lighting, no reflections of objects, no vignette. Ultra high resolution, crisp.

**T-CONIC** and **T-SPECULAR** are **not AI**. The script `scripts/pet-cards/make-gradients.py` renders them mathematically (perfect gradients, any size).

---

## 4. Holo patterns (`H-*`) — grayscale, white on black

The app tints these with a moving rainbow and blends them (`color-dodge`), so they must be **pure white shapes on pure black**, high contrast, evenly spread.

Master 2048×2048 → app 1024 (bundled 512). Midjourney: `--tile --ar 1:1 --v 7 --style raw --stylize 0`. Then in an editor: desaturate, Levels so the background is pure black (#000), and save as grayscale.

**H-COSMOS** (signature holo)
> Seamless tileable "cosmos holo" foil pattern: overlapping circles, rings and dots of many sizes like cosmic bubbles, bright white shapes on a pure black background, crisp clean edges, high contrast, evenly distributed, flat graphic, no gradients on the background.

**H-CRACKED-ICE**
> Seamless tileable "cracked ice" holographic foil pattern: angular shattered-glass facets of varied sizes with bright white edges and soft white fills on a pure black background, crisp, high contrast, evenly distributed, flat graphic.

**H-STARLIGHT**
> Seamless tileable pattern of tiny four-point sparkles, stars and glints of varied sizes, bright white on a pure black background, crisp, high contrast, evenly scattered, flat graphic.

**H-PAWS** (our own signature)
> Seamless tileable diagonal lattice of small rounded paw prints alternating with tiny diamonds and dots, bright white on a pure black background, crisp vector-clean edges, high contrast, evenly spaced, flat graphic.

**H-WEB** (Haunted Carnival)
> Seamless tileable delicate spiderweb lattice with tiny stars caught in the threads, bright white thin lines on a pure black background, crisp, high contrast, evenly spread, cute not creepy, flat graphic.

**H-SCALES** (Dragon Hoard, phase 3)
> Seamless tileable dragon-scale pattern: overlapping rounded scales with bright white edges fading to dark centres, on a pure black background, crisp, high contrast, even, flat graphic.

**H-SUNBURST** (not tileable; centred behind Legendary reveals)
> Square radial sunburst: fine straight rays of varied width radiating from the exact centre, bright white on a pure black background, crisp, high contrast, symmetric, flat graphic. `--ar 1:1 --style raw --stylize 0` (no `--tile`)

---

## 5. Frame ornaments (`O-*`), transparent PNG

The app places these on the code-drawn frame and mirrors corners.

Master 1024×1024 → app 512.

**ChatGPT:** "transparent background PNG". **Midjourney:** put it on plain #00FF00 green and remove it with Photoshop/remove.bg, then check there is no green fringe.

**O-GILDED-CORNER** — Gilded finish, top-left corner
> A single ornate gold corner ornament for the TOP-LEFT corner of a premium trading-card frame. Baroque acanthus scrollwork with fine engraving and polished highlights, a tiny round medallion with a raised paw print where the two arms meet; one arm runs along the top edge and one down the left edge, each ending in a delicate curl. Front view, flat orthographic, no perspective. Isolated on a fully transparent background. Crisp, ultra high resolution, clean edges.

**O-GILDED-CREST** — Gilded finish, top-centre crest
> A small symmetrical ornate gold crest for the top-centre of a premium trading-card frame: two engraved laurel wings spreading left and right from an empty round gem socket, polished gold with fine engraving, front view, perfectly symmetrical. Isolated on a fully transparent background. Crisp, ultra high resolution.

**O-HAUNTED-CORNER** — Haunted Carnival, top-left corner
> A single spooky-cute corner ornament for the TOP-LEFT corner of a trading-card frame: curling wrought-iron filigree with a tiny friendly bat perched at the corner and a glowing candy-corn enamel bead; matte black iron with warm orange rim light and a faint slime-green glint. One arm along the top edge, one down the left edge. Front view, flat, no perspective. Isolated on a fully transparent background. Crisp, ultra high resolution.

**O-HAUNTED-CREST** — Haunted Carnival, top-centre crest
> A small symmetrical spooky-cute crest for the top-centre of a trading-card frame: a smiling carved jack-o'-lantern moon in the centre with soft orange inner glow, flanked by two little bat wings made of wrought-iron filigree. Front view, perfectly symmetrical. Isolated on a fully transparent background. Crisp, ultra high resolution.

---

## 6. Rarity gems (`G-*`) and set emblems (`E-*`): Recraft, SVG

**Recraft settings:** model V3, style *Vector illustration → Icon* (or "Flat 2.0 with soft gradients"), export **SVG**. Also export a 768×768 PNG for preview.

Each gem has a **different shape**, so colour-blind players can tell rarities apart.

**Gem prompt template:** "A single [GEM] gemstone icon, front view, centred, faceted with crisp bright highlights and soft inner glow, set in a thin polished [METAL] bezel, clean vector illustration with smooth gradients, premium mobile game UI icon, transparent background, no text."

| ID | [GEM] | [METAL] |
|---|---|---|
| G-COMMON | round cabochon pale silver-grey moonstone (`#9AA8B8`) | silver |
| G-UNCOMMON | emerald-cut square green emerald (`#3DBE5A`) | silver |
| G-RARE | triangular trillion-cut blue sapphire (`#2E9BF0`) | white gold |
| G-ULTRA | marquise-cut violet amethyst (`#A855F7`) | gold |
| G-LEGENDARY | eight-point star-cut golden topaz (`#F5A700`) with a tiny crown prong setting | gold |
| G-NEON | hexagon-cut gem glowing bright electric cyan with a neon light halo | dark chrome |
| G-MEGA | heart-cut gem with swirling rainbow prismatic fire | platinum |

**Emblem prompt template:** "An enamel-pin style badge icon shaped like a rounded egg, thin gold outline, depicting [MOTIF] in a simple bold flat-vector design with soft gradients and one highlight, limited palette of [COLOURS], centred, transparent background, no text, premium mobile game UI icon."

| ID | Set | [MOTIF] | [COLOURS] |
|---|---|---|---|
| E-ISLAND | All Pets | a palm tree and a smiling sun over a little island | sky blue, sand, green, gold |
| E-HAUNTED | Haunted Carnival | a jack-o'-lantern moon over a striped carnival tent | plum, orange, slime green |
| E-FARM | Farm Egg | a red barn with a sunflower | red, yellow, green |
| E-SAFARI | Safari Egg | an acacia tree against a big setting sun | orange, gold, brown |
| E-JUNGLE | Jungle Egg | a monstera leaf with a drip of dew | deep green, lime |
| E-AUSSIE | Aussie Egg | eucalyptus leaves over a red rock formation | red earth, sage, sky blue |
| E-FOSSIL | Fossil Egg | an ammonite spiral shell fossil | amber, brown, cream |
| E-OCEAN | Ocean Egg | a curling wave with a scallop shell | teal, navy, white |
| E-MYTHIC | Mythic Egg | a winged marble pillar with a small star | white, gold, lavender |
| E-JAPAN | Japan Egg | a cherry blossom flower over a small arched bridge | pink, red, cream |
| E-DANGER | Danger Egg | a small erupting volcano | dark red, orange, charcoal |
| E-WOODLAND | Woodland Egg | an acorn with an oak leaf | brown, green, gold |
| E-MOON | Moon Egg | a crescent moon with craters and a star | silver, navy, pale yellow |
| E-DESERT | Desert Egg | a sand dune with a cactus and a sun | sand, terracotta, green |
| E-URBAN | Urban Egg | a little city skyline with lit windows | slate blue, yellow, pink |
| E-ENDANGERED | Endangered Egg | a leaf shaped like a heart with a tiny sprout | green, mint, gold |
| E-FAIRYTALE | Fairytale Egg | a castle spire with a sparkle | lavender, pink, gold |
| E-AZTEC | Aztec Egg | a stepped stone pyramid with a sun | jade, gold, stone grey |
| E-SOUTHEAST-ASIA | Southeast Asia Egg | a lotus flower with a small paper lantern | magenta, gold, teal |
| E-GARDEN | Garden Egg | a rose with a small watering can | rose, green, copper |
| E-DRAGON | Dragon Hoard | a dragon wing over a cut gem | crimson, gold, navy |
| E-CAT | Cat Café | cat ears peeking over a latte cup with heart foam | matcha green, cream, brown |
| E-WINTER | Winter Wonderland | a snowflake with a tiny star | ice blue, white, silver |

**Pass:** reads clearly at 32 px, no text, consistent stroke weight across all emblems.

---

## 7. Art-window backgrounds (`BG-*`)

**For every prompt:**
- Format: Style block (§1.1 / §1.2 / §1.3) + scene + Composition block (§1.4) + Rules block.
- Master 2048×2867 (5:7). App files: `BG-*.webp` at 1500×2100, plus the app crops the art window itself.
- Midjourney: `--ar 5:7 --v 7 --stylize 200`, plus `--sref <master URL> --sw 250` after the master is approved.
- ChatGPT: 1024×1536, then crop to 5:7 (1024×1434) and upscale ×2.

### 7.1 Island set (All Pets, and pets with no egg)
The app picks one by the pet's sets: Winter events → SNOW; Lunar New Year/festivals → FESTIVAL; summer/beach → BEACH; flying/mythic → SKY; Neon finish → NIGHT; everything else → MEADOW.

**BG-ISLAND-MEADOW** ★ master
> A sunny hilltop meadow on a tropical pet-adoption island: soft rolling grass dotted with tiny daisies, a winding sand path, a distant pastel town of rounded cottages with colourful roofs, a lighthouse on a far cliff, leaning palm trees, fluffy cumulus clouds, warm late-afternoon sun.

**BG-ISLAND-BEACH**
> A sparkling lagoon beach: pale sand with scattered seashells and a sandcastle mound near the edges, turquoise shallow water with dancing light caustics, a wooden pier, leaning palm trees, a distant striped ice-cream kiosk, bright midday sun and a few puffy clouds.

**BG-ISLAND-SKY**
> High above the island among the clouds: floating grassy sky-islands with tiny waterfalls spilling into mist, a soft rainbow arc, sunbeams through towering cumulus clouds, the sea glittering far below, dreamy pastel sky.

**BG-ISLAND-NIGHT**
> The island at night: a calm sky full of stars and a soft Milky Way, fireflies glowing over a meadow, warm lit windows in distant cottages, a crescent moon reflected in a still sea, cool cyan and violet tones with warm accents.

**BG-ISLAND-SNOW**
> The island in winter: soft fresh snow over rounded hills, frosted pine trees wrapped in warm string lights, a frozen pond, gentle falling snow, cosy cottages with smoking chimneys, pink-gold winter sunset.

**BG-ISLAND-FESTIVAL**
> Festival evening in the island town square: rows of glowing red and gold paper lanterns overhead, ribbons and bunting, a lit gazebo stage, soft fireworks blooming in a twilight sky, warm reds and golds.

### 7.2 Egg pages (ISLAND style block)
| ID | Scene (paste after the Style block) |
|---|---|
| **BG-EGG-FARM** | A golden farm at sunrise: a red barn with white trim, round hay bales, a wooden fence, a turning windmill, sunflowers and pumpkins near the edges, dewy grass, soft morning mist. |
| **BG-EGG-SAFARI** | An African savanna at sunset: golden grass, a lone acacia tree silhouetted against an enormous orange sun, distant flat-topped hills, warm dust glowing in the air, a dry sandy path. |
| **BG-EGG-JUNGLE** | A lush rainforest clearing: giant tropical leaves and ferns framing the edges, hanging vines, a misty waterfall behind, shafts of green-gold light through the canopy, glowing orchids. |
| **BG-EGG-AUSSIE** | The Australian outback at golden hour: red earth, tufts of spinifex grass, a huge red sandstone rock formation far away, eucalyptus trees, a wide deep-blue sky with wispy clouds. |
| **BG-EGG-FOSSIL** | A prehistoric dig site: amber-lit canyon walls with layered rock strata, giant fossil bones half-buried in the cliffs near the edges, lantern-lit wooden scaffolding and dig tools, tree ferns, a gently smoking volcano far away, warm amber dusty light. |
| **BG-EGG-OCEAN** | An underwater coral reef: sun rays slanting down from the bright surface, colourful corals and anemones framing the edges, swaying kelp, rising bubbles, an open sandy floor in the middle, turquoise fading to deep blue. |
| **BG-EGG-MYTHIC** | A mythic sky temple: white marble columns and floating stone steps among golden clouds, glowing stone archways, sunbeams, distant mountain peaks above the clouds, soft gold and lavender light. |
| **BG-EGG-JAPAN** | A peaceful Japanese garden in spring: cherry blossom trees with drifting petals, a red arched wooden bridge over a calm pond, stone lanterns, a distant snow-capped mountain, soft pink and teal tones. |
| **BG-EGG-DANGER** | A dramatic volcanic jungle: dark basalt rocks, glowing lava rivers far in the distance, smoke plumes, thorny plants and twisted trees at the edges, drifting ember sparks, deep red-orange glow with teal shadows. Exciting, not scary. |
| **BG-EGG-WOODLAND** | An enchanted woodland: tall mossy oak trees, a carpet of bluebells and little mushrooms, a babbling brook, misty sunbeams through the canopy, fireflies, soft green and gold. |
| **BG-EGG-MOON** | The surface of the moon: soft grey craters and rocks, a giant blue-green Earth rising over the horizon, a deep starry sky with a pastel nebula, crisp silver light. |
| **BG-EGG-DESERT** | A desert oasis at dusk: sweeping sand dunes, a turquoise pool fringed with date palms, sandstone arches, a violet-to-peach sky with the first stars appearing. |
| **BG-EGG-URBAN** | A city rooftop at dusk: a rooftop garden with planters and string lights, a water tower, a skyline of glowing skyscrapers, warm lit windows, pink-orange sunset sky. |
| **BG-EGG-ENDANGERED** | A wildlife sanctuary in a misty mountain rainforest: bamboo groves, terraced green hills, a wooden ranger boardwalk, distant waterfalls, soft morning fog, hopeful sunrise light. |
| **BG-EGG-FAIRYTALE** | An enchanted fairytale realm: a pastel castle with tall spires on a far hill, a ring of giant glowing mushrooms, a twisting storybook path, floating sparkles, lavender and rose-gold sky. |
| **BG-EGG-AZTEC** | Ancient Mesoamerican-inspired jungle ruins: a mossy stepped stone pyramid in the distance, carved stone blocks overgrown with vines, golden sunlight through mist, tropical flowers, turquoise and gold accents. |
| **BG-EGG-SOUTHEAST-ASIA** | A Southeast Asian river at twilight: wooden stilt houses with warm lanterns, a long-tail boat moored at a jetty, limestone karst mountains rising from calm water, lotus flowers, floating lanterns, gold and teal reflections. |
| **BG-EGG-GARDEN** | A blooming back garden: tall foxgloves and climbing roses, a glinting glass greenhouse, a stepping-stone path, a white picket fence, golden pollen sparkles in warm spring sunlight. |

### 7.3 Haunted Carnival (HAUNTED style block)
The app assigns one of the six to each of the 70 Halloween cards, spread evenly.

**BG-HAUNTED-MIDWAY** ★ master
> A Halloween carnival midway at night: a glowing Ferris wheel and striped circus tents in the distance, strings of round warm bulbs overhead, carved jack-o'-lanterns on crates near the edges, a candy-and-popcorn stall with a striped awning, low rolling purple fog, a huge full moon.

**BG-HAUNTED-MANOR**
> A spooky-cute manor on a hill: a crooked gothic house with glowing orange windows, a curly wrought-iron gate, twisting bare trees, a winding path lined with pumpkins, a few tiny distant bat silhouettes, a giant moon behind thin clouds.

**BG-HAUNTED-PATCH**
> A moonlit pumpkin patch: rows of plump orange pumpkins and curling vines, a wooden post with a hanging lantern, tall corn stalks at the edges, fireflies, soft mist, purple sky.

**BG-HAUNTED-HOTEL**
> A grand haunted hotel lobby: plush purple carpet, a sweeping staircase, a crystal chandelier with candle flames, empty ornate picture frames on the walls, soft cobwebs in the top corners, floating candelabra glow, warm amber against deep violet.

**BG-HAUNTED-GRAVEYARD**
> A gentle old garden cemetery at night: mossy rounded headstones with no writing, a low iron fence, soft glowing ghost-light orbs (no faces), flickering candles, a gnarled friendly tree, teal-green moonlight and fog. Cute, calm, not scary.

**BG-HAUNTED-SWAMP**
> A glowing slime bayou: twisted cypress trees draped with moss, bubbling neon-green slime pools, glowing mushrooms, a wooden boardwalk, fireflies, fog, deep teal and plum.

### 7.4 Phase 3
| ID | Style | Scene |
|---|---|---|
| **BG-DRAGON-HOARD** | ISLAND | A dragon's treasure cave: mountains of glittering gold coins and gems at the edges, crystal clusters, a glowing magma seam in the rock, ancient carved pillars, warm gold light against deep blue shadows. |
| **BG-CAT-CAFE** | ISLAND | A cosy cat café interior: a warm wooden counter with pastries, hanging plants, soft cushions, a window seat with gentle rain outside, a steaming coffee machine, fairy lights, latte and matcha tones. |
| **BG-WINTER-VILLAGE** | WINTER | A snowy village square at blue hour: a giant decorated tree with warm lights, gingerbread-style cottages, an ice rink, falling snow. |
| **BG-WINTER-AURORA** | WINTER | A frozen lake under a green and violet aurora, snow-covered pines, an igloo glowing warm, stars. |
| **BG-WINTER-WORKSHOP** | WINTER | A cosy toy workshop: shelves of wrapped gifts, a crackling fireplace, candy-cane striped pillars, ribbon spools, warm golden light. |

**Pass for all BG:**
- The central stage is calm. Check by placing a pet PNG on it: does the pet pop?
- No animals or people.
- No text-like marks.
- Matches its master side by side.

---

## 8. Card backs (`CB-*`)

Master 1500×2100 (5:7). Front view, perfectly symmetrical, edge to edge: **no table, no shadow, no perspective, no rounded-corner cut-out** (the app rounds the corners). Midjourney: `--ar 5:7 --v 7 --stylize 150 --style raw`.

**CB-STANDARD** ★ master
> The back of a premium collectible trading card, flat front view filling the whole image edge to edge, perfectly symmetrical. Deep navy-blue lacquered surface with a subtle repeating damask pattern of tiny paw prints and stars. In the exact centre, an ornate gold circular crest containing a stylized paw print whose four toes are little suns over a tiny island silhouette. Fine gold filigree border lines inset from the edges with small corner flourishes. Soft satin sheen, crisp engraved detail, luxurious. Ultra high resolution. No text, no letters, no logos.

**CB-HAUNTED**
> The back of a premium collectible trading card for a Halloween event, flat front view filling the whole image edge to edge, perfectly symmetrical. Midnight-plum lacquered surface with a subtle repeating pattern of tiny bats, stars and candy corn. In the exact centre, an ornate wrought-iron and gold crest holding a glowing carved jack-o'-lantern moon with a paw print carved into it. Spiderweb filigree border lines inset from the edges, small bat-wing corner flourishes, faint orange glow. Ultra high resolution. No text, no letters, no logos.

**CB-GOLD** (All Pets master reward)
> The back of a premium collectible trading card, flat front view edge to edge, perfectly symmetrical. Polished brushed gold with a fine diamond-cut guilloché engine-turned pattern, a raised central crest with a small crown above a paw print, platinum inlay border lines, luxurious reflections. Ultra high resolution. No text.

**CB-PRO** (Pro cosmetic; no randomness)
> The back of a premium collectible trading card, flat front view edge to edge, perfectly symmetrical. Iridescent black-pearl surface with a prismatic wave guilloché pattern, a platinum central crest of a paw print inside a star, thin glowing cyan inlay lines. Ultra high resolution. No text.

---

## 9. Pet HD remaster (`PET-REMASTER`)

Use this only for pets that fail review after upscaling. Attach the pet's best original image (from `scripts/pet-cards/hd-art/out/raw/`).

**Tool:** ChatGPT image (attach the reference) or Gemini image editing. Output 1024×1024 with a transparent background.

> Use the attached image as the exact character reference. Recreate this same pet as a clean high-resolution 3D render in the style of a modern Roblox pet game. Keep it identical: same species, body shape, proportions, colours, markings, eye style and accessories. Do not add, remove or redesign anything. Pose: the same pose and angle as the reference, full body visible, centred. Lighting: soft studio key light from the top left, gentle rim light, no cast shadow, no ground. Background: fully transparent. Smooth clean surfaces, crisp edges, no blur, no outline stroke, no text. Square 1024×1024 with about 8% empty margin around the pet.

**Pass:** put it side by side with the original at the same size. Every colour, marking and accessory must match, otherwise reject. Mark it `remastered` in the review sheet. Neon/Mega look is added by the app, so remaster only the normal pet.

---

## 10. Packs (`P-*`), transparent

Master 1200×1800 (2:3), transparent background. ChatGPT: size 1024×1536, transparent, quality high, then upscale ×2 and downscale to 1200×1800. The app splits the top crimp to "tear" it and prints the set name and "3 CARDS" itself.

**P-ISLAND** ★ master
> A sealed collectible card booster pack, front view, standing upright, perfectly centred, isolated on a fully transparent background. Shape: a tall foil pouch with crimped serrated seals across the top and bottom edges and softly puffed pillow edges. Printed artwork on the foil: a sunny tropical pet island with rounded green hills, pastel cottages, palm trees and a rainbow sky; a big glowing paw-print sun emblem in the upper centre; a smooth empty colour band across the lower third (leave it blank for a title). Glossy holographic metallic foil with crisp specular highlights and subtle crinkles. Ultra high resolution. No text, no letters, no logos.

**P-HAUNTED**
> A sealed collectible card booster pack, front view, standing upright, perfectly centred, isolated on a fully transparent background. Shape: a tall foil pouch with crimped serrated seals across the top and bottom and softly puffed edges. Printed artwork on the foil: a Halloween carnival at night with a Ferris wheel, striped tents, strings of warm bulbs and purple fog under a giant moon; a glowing carved jack-o'-lantern moon emblem in the upper centre; a smooth empty dark-plum band across the lower third (leave it blank for a title). Purple-black holographic foil with orange and slime-green glints, crisp highlights, subtle crinkles. Ultra high resolution. No text, no letters, no logos.

**P-WINTER** (phase 3)
> (Same structure as P-ISLAND.) Printed artwork: a snowy village with a glowing decorated tree and aurora sky; a sparkling snowflake-star emblem in the upper centre; empty ice-blue band across the lower third. Silver-blue holographic foil with frosty sparkles. No text.

---

## 11. Screens, sharing and rewards

### 11.1 Pack-opening stages (`S-*`)
Master 1290×2796 (phone, 6:13). Midjourney: `--ar 6:13 --v 7 --stylize 200`.

**S-ISLAND**
> [ISLAND style block] A vertical phone-screen background for a magical card-opening moment: a round podium of polished white stone with gold trim in the lower third, a soft spotlight cone falling from above onto it, a warm sunset island bokeh far behind, gently floating sparkles. The whole middle area is calm and empty, with space for a card pack and three cards. Ultra high resolution. [Rules block]

**S-HAUNTED**
> [HAUNTED style block] A vertical phone-screen background for a magical card-opening moment: a round podium of dark carved stone with a softly glowing orange trim (no symbols) in the lower third, a cool moonlight spotlight from above, Halloween carnival bulbs and Ferris wheel bokeh far behind, soft purple fog, floating orange sparks. The whole middle area is calm and empty. Ultra high resolution. [Rules block]

### 11.2 Album covers (`A-*`)
Master 2048×1152 (16:9; the album header crops it).

**A-COVER-ISLAND**
> Close-up of a premium collector's binder cover in soft navy leather with neat stitched edges and a debossed gold paw-print crest in the centre, warm studio light raking across the grain, flat front view, edge to edge. Ultra high resolution. No text.

**A-COVER-HAUNTED**
> Close-up of a premium collector's binder cover in deep plum leather with orange stitching, a debossed gold jack-o'-lantern crest in the centre and tiny embossed bats in the corners, moody warm light, flat front view, edge to edge. Ultra high resolution. No text.

### 11.3 Share-card backgrounds (`SH-*`)
Master 2160×3840 → app 1080×1920 (9:16). Safe zones:
- top 18% calm (the headline goes there)
- centre for one big card
- bottom 14% calm (app badge and the player's name)

Midjourney: `--ar 9:16`.

**SH-PULL-ISLAND**
> [ISLAND style block] A celebratory vertical background: soft golden light rays bursting from the exact centre, gentle confetti and sparkles drifting, a sunny island sky and sea softly blurred behind, warm and joyful. The centre is a clean glowing area with space for one large card. The top and bottom bands are calm and simple. [Rules block]

**SH-PULL-HAUNTED**
> [HAUNTED style block] A celebratory vertical background: orange and violet light rays bursting from the exact centre, drifting candy corn, tiny stars and sparkles, a carnival night softly blurred behind. Clean glowing centre for one large card. Calm top and bottom bands. [Rules block]

**SH-SETCOMPLETE**
> [ISLAND style block] A triumphant vertical background: a radiant golden burst with fine rays, falling gold confetti and ribbons, a soft laurel-wreath glow framing the centre. Clean centre for a fan of cards. Calm top and bottom bands. [Rules block]

### 11.4 Wallpapers (`W-*`): the set-completion reward
The app lays the player's own cards over these, so they need large calm areas.
- **Phone:** master 1290×2796 (`--ar 6:13`). The top 30% is simple sky (the lock-screen clock goes there); the cards are fanned across 45–85% of the height.
- **Desktop:** master 3840×2160 (`--ar 16:9`, Upscale Subtle, then ×2 in Upscayl). A calm horizontal band through the middle for a row of cards; the detail lives at the left and right edges.

| ID | Prompt (Style block + this + Rules block) |
|---|---|
| **W-HAUNTED-PHONE** | A tall moonlit Halloween carnival scene: a huge glowing full moon in a calm deep-violet sky at the top, the Ferris wheel and striped tents as soft silhouettes in the middle distance, warm bulb strings, pumpkins and purple fog at the very bottom. The middle area is softly lit and uncluttered. |
| **W-HAUNTED-DESKTOP** | A wide panoramic Halloween carnival at night: a Ferris wheel on the far left, a crooked manor on a hill on the far right, a giant moon high in the centre, warm bulb strings, pumpkins and fog along the bottom edge. A calm, softly lit horizontal band across the middle. |
| **W-ISLAND-PHONE** | A tall view of the pet island at golden hour: a calm gradient sky with soft clouds at the top, rolling hills, a lighthouse and pastel cottages in the middle distance, flowers along the very bottom. Uncluttered middle. |
| **W-ISLAND-DESKTOP** | A wide panoramic pet island at golden hour: a lighthouse cliff on the far left, a pastel town and palm trees on the far right, the sea and soft clouds in the centre. A calm horizontal band across the middle. |
| **W-DRAGON-PHONE / -DESKTOP** (phase 3) | A treasure cave opening onto a starry sky; gold and gems along the bottom; calm middle. |
| **W-CAT-PHONE / -DESKTOP** (phase 3) | A cosy café window at night with rain and fairy lights; calm middle. |
| **W-WINTER-PHONE / -DESKTOP** (phase 3) | Aurora over a snowy village; calm middle. |

Egg-page phone wallpapers reuse that egg's `BG-EGG-*` (cover-cropped), so they need no extra art.

### 11.5 Profile frames (`F-*`), transparent
Master 1024×1024, transparent, **the inner circle (70% of the width) fully empty**. Front view, symmetrical.

**F-HAUNTED** (Haunted Carnival completion)
> A circular avatar frame ring isolated on a fully transparent background, the centre completely empty and transparent (the empty inner circle is 70% of the width). The ring is made of curling wrought-iron filigree around a glowing candy-corn enamel band, with small bat wings on the left and right sides and a tiny smiling jack-o'-lantern at the bottom centre; warm orange glow highlights and a faint slime-green glint. Front view, perfectly symmetrical, crisp, ultra high resolution. No text.

**F-DRAGON** (phase 3)
> A circular avatar frame ring isolated on a fully transparent background, the centre completely empty (inner circle 70% of the width). The ring is two curved dragon wings of crimson scales with gold edges wrapping around, a cut ruby at the top centre, gold coins at the bottom. Front view, symmetrical, crisp, ultra high resolution. No text.

**F-ISLAND-MASTER** (All Pets complete)
> A circular avatar frame ring isolated on a fully transparent background, the centre completely empty (inner circle 70% of the width). The ring is polished gold laurel leaves with tiny inset gems in all five rarity colours (silver, green, blue, violet, gold), a small crown at the top centre, a ribbon at the bottom. Front view, perfectly symmetrical, crisp, ultra high resolution. No text.

### 11.6 Promo (`M-*`)
| ID | Size | Prompt (Style block + this + Rules block) |
|---|---|---|
| **M-HOME-BANNER** | 2400×1000 → 1200×500 | A wide magical banner background: soft light rays and sparkles bursting from the right side, floating confetti, violet-to-sunset-orange gradient sky. The left 55% is calm for a title. |
| **M-TIKTOK-COVER** | 2160×3840 | A dramatic vertical background for a card-pack-opening video cover: a spotlight beam on an empty glowing stage, sparkles and light rays, deep purple to gold. Calm top 25% for a headline. |
| **M-PLAY-FEATURE** | 2048×1000 → 1024×500 | A wide premium collectible-card hero background: an empty glowing stage with light rays and sparkles, island sunset bokeh. Calm centre-left for a title. |

The app (or Canva) places real cards on these. Never ask the AI to draw the cards or the pets.

### 11.7 Wallpaper Studio backdrops (`WB-*`)
Wallpaper Studio draws the pets, values, glows and patterns itself; these are only the **backdrops**. Every one already has a code-drawn version, so the studio works without them. When `WB-<ID>.webp` is uploaded, it replaces the drawn version.

**Look:** the More tab's best-performing wallpapers (one big pet, a themed motif background, clean flat shapes) are flat vector art. Match that look so the studio feels like part of the same app, then make it more premium with soft light and depth.

**Style block — FLAT VECTOR WALLPAPER**
> Premium flat vector illustration for a phone wallpaper in the style of a cheerful pet game: bold clean shapes, soft gradients inside shapes, gentle long shadows, subtle grain, a soft glowing light source, tidy decorative motifs scattered with breathing room. Harmonious palette, crisp edges, extremely high resolution, no noise. No text, no letters, no logos, no watermark, no animals, no characters, no people. The lower-middle 50% of the image is a clear, calm area where the app will place pets; the top 30% is simple and calm for the lock-screen clock.

Master sizes:
- **Phone:** 1290×2796 (`--ar 6:13`).
- **Desktop:** 3840×2160 (`--ar 16:9`). Desktop versions are named `WB-<ID>-DESKTOP` (optional; without one, the phone art is cover-cropped).
- Midjourney: `--v 7 --stylize 150`, then Upscale (Subtle). Export JPG q92.

**Light themes** (keep them airy and bright, with pastel and white highlights):
| ID | Scene + motifs (after the Style block) |
|---|---|
| **WB-COTTON** | Cotton-candy sky of pink, lilac and baby blue, fluffy pastel clouds, tiny sparkles and candy hearts drifting. |
| **WB-PEACH** | Peach sorbet gradient, soft scoops of round sorbet shapes along the edges, little sprinkles and orange slices. |
| **WB-MINT** | Mint milkshake: soft mint waves, cream swirls, little mint leaves and bubbles near the edges. |
| **WB-LAVENDER** | Lavender dream: lilac hills, lavender sprigs at the edges, floating sparkles, a soft crescent moon. |
| **WB-LEMONADE** | Lemonade stand day: lemon-yellow to sky blue, lemon slices, ice cubes and fizzy bubbles near the edges, a bright sun. |
| **WB-SKY** | Sky Island: bright blue sky, puffy layered clouds with a small floating grassy island far away, birds as tiny ticks. |
| **WB-SAKURA** | Sakura: blush pink, cherry-blossom branches framing the top corners, drifting petals. |
| **WB-HONEY** | Honey: warm cream to golden, honeycomb hexagon pattern fading at the edges, glowing honey drips at the top. |
| **WB-RAINBOW** | Pastel rainbow arcs behind soft clouds, scattered stars and hearts. |
| **WB-CLOUD** | Cloud nine: white and pale-blue cloudscape, soft sunbeams, a few golden stars. |
| **WB-ICECREAM** | Ice-cream parlour: strawberry, vanilla and mint stripes, waffle-cone pattern edges, sprinkles. |
| **WB-SUNRISE** | Soft sunrise: peach, pink and lilac sky, a big gentle sun low in the middle, layered pastel hills. |

**Dark themes** (rich, glowing and premium; never muddy):
| ID | Scene + motifs |
|---|---|
| **WB-GALAXY** | A deep purple and blue nebula galaxy, star clusters, small planets with rings near the edges. |
| **WB-MIDNIGHT** | A midnight-blue sky over a sleepy town silhouette, a glowing full moon, twinkling stars. |
| **WB-NEON** | A neon city at night, magenta and cyan signs as glowing shapes (no letters), wet street reflections at the bottom edge. |
| **WB-HAUNTED** | A spooky-cute Halloween night: a giant moon, bats as small silhouettes, a curly iron gate and pumpkins at the bottom edges. |
| **WB-EMERALD** | Emerald night: a deep green crystal cave glow, faceted emerald crystals at the edges, floating light motes. |
| **WB-RUBY** | Ruby: deep crimson velvet with faceted ruby gems and soft gold sparkles around the edges. |
| **WB-OBSIDIAN** | Black and gold luxury: black marble with fine gold veins, gold geometric art-deco lines at the corners, soft golden glow. |
| **WB-OCEAN** | A deep ocean: dark teal water with light rays from the surface, softly glowing bioluminescent dots, coral silhouettes at the bottom edges. |
| **WB-AURORA** | An aurora: green and violet aurora ribbons over a snowy mountain silhouette, stars. |
| **WB-VOLCANO** | A volcano night: black rocks, glowing lava rivers at the bottom edges, drifting embers, smoky purple sky. |
| **WB-ROYAL** | Royal: deep royal-blue velvet, a soft gold crown silhouette glow at the top, gold filigree corners. |
| **WB-COCOA** | Hot cocoa: warm chocolate brown, marshmallows and cocoa swirls at the edges, cinnamon stars, cosy steam curls. |

**Scenes:** `WB-HAUNTED-MIDWAY`, `WB-ISLAND-MEADOW`, `WB-EGG-JAPAN` and the rest reuse the matching `BG-*` prompt (§7) with the flat-vector Style block and `--ar 6:13`.

**Pass:**
- A pet PNG dropped in the lower middle stands out clearly.
- The lock-screen clock stays readable over the top 30% (white text on dark themes, dark text on light themes).
- The look matches the More-tab wallpapers.

---

## 12. Master list (sizes, priority, where it goes)

Priority **A** = needed for the Halloween launch. **B** = egg pages and the All Pets polish. **C** = phase 3.

| ID | Master size | App file | Where | Prio |
|---|---|---|---|---|
| Pets (787) | 1024² transparent | `cards/v1/pets/<slug>.webp` 1024 + `@512` | CDN | **A** (the 70 Halloween first) |
| T-PAPER, T-BRUSHED, T-GOLDLEAF, T-PARCHMENT, T-IRIDESCENT | 2048² tile | 512² WebP | bundled | **A** |
| T-OBSIDIAN | 2048² tile | 512² WebP | bundled | **A** |
| T-CONIC, T-SPECULAR | script | 1024² PNG | bundled | **A** (script) |
| H-COSMOS, H-CRACKED-ICE, H-STARLIGHT, H-PAWS, H-WEB, H-SUNBURST | 2048² gray | 512² WebP | bundled | **A** |
| H-SCALES | 2048² gray | 512² WebP | bundled | C |
| O-GILDED-CORNER, O-GILDED-CREST, O-HAUNTED-CORNER, O-HAUNTED-CREST | 1024² alpha | 512² WebP | bundled | **A** |
| G-COMMON … G-MEGA (7) | SVG | 192² PNG ×3 densities or SVG | bundled | **A** |
| E-ISLAND, E-HAUNTED | SVG | 192² PNG | bundled | **A** |
| E-* eggs (18) | SVG | 192² PNG | bundled | B |
| E-DRAGON, E-CAT, E-WINTER | SVG | 192² PNG | bundled | C |
| BG-ISLAND-* (6) | 2048×2867 | 1500×2100 WebP | CDN | **A** |
| BG-HAUNTED-* (6) | 2048×2867 | 1500×2100 WebP | CDN | **A** |
| BG-EGG-* (18) | 2048×2867 | 1500×2100 WebP | CDN | B |
| BG-DRAGON-HOARD, BG-CAT-CAFE, BG-WINTER-* (3) | 2048×2867 | 1500×2100 WebP | CDN | C |
| CB-STANDARD, CB-HAUNTED | 1500×2100 | 1500×2100 WebP | CDN (+1 bundled thumb) | **A** |
| CB-GOLD, CB-PRO | 1500×2100 | 1500×2100 WebP | CDN | C |
| P-ISLAND, P-HAUNTED | 1200×1800 alpha | 1200×1800 WebP | CDN | **A** |
| P-WINTER | 1200×1800 alpha | 1200×1800 WebP | CDN | C |
| S-ISLAND, S-HAUNTED | 1290×2796 | 1290×2796 WebP | CDN | **A** |
| A-COVER-ISLAND, A-COVER-HAUNTED | 2048×1152 | 1600×900 WebP | CDN | B |
| SH-PULL-ISLAND, SH-PULL-HAUNTED, SH-SETCOMPLETE | 2160×3840 | 1080×1920 WebP | CDN | **A** |
| W-HAUNTED-PHONE, W-HAUNTED-DESKTOP | 1290×2796 / 3840×2160 | same, JPG q92 | CDN | **A** |
| W-ISLAND-PHONE, W-ISLAND-DESKTOP | 1290×2796 / 3840×2160 | same, JPG q92 | CDN | B |
| W-DRAGON-*, W-CAT-*, W-WINTER-* | as above | as above | CDN | C |
| F-HAUNTED | 1024² alpha | 512² WebP | CDN | **A** |
| F-DRAGON, F-ISLAND-MASTER | 1024² alpha | 512² WebP | CDN | C |
| WB-* light (12) + dark (12) | 1290×2796 (+ optional 3840×2160 `-DESKTOP`) | JPG q92 | CDN | B |
| Pets 2048 px (wallpapers) | `process.py --x2k` | `v1/pets/2k/<key>.webp` | CDN | B |
| M-HOME-BANNER | 2400×1000 | 1200×500 WebP | bundled | **A** |
| M-TIKTOK-COVER, M-PLAY-FEATURE | as listed | — | marketing | B |

**Where finished files go:**
- **Bundled:** `assets/pet-cards/<ID>.webp` (the app requires them by ID in `Code/PetCards/cardAssets.js`).
- **CDN:** `cards/v1/<ID>.webp` on the Bunny storage zone. Upload with `scripts/pet-cards/hd-art/upload.py --dir art/export --prefix cards/v1`.
- **Updating art:** upload a new file under a new name (`BG-HAUNTED-MIDWAY-2.webp`) and change the manifest. Never overwrite in place: phones cache by URL.

### Final check before upload (every asset)
- [ ] Exact master size; looked at 100% zoom with no blur, smears or melted details.
- [ ] No text or text-like squiggles, no watermark or signature.
- [ ] Safe zones respected (calm stage for backgrounds; calm bands for share and wallpapers; empty centre for frames).
- [ ] Transparent where required, with no halo or green fringe.
- [ ] Matches its family master side by side.
- [ ] Kid-safe: cute, never gory or frightening.
- [ ] Exported WebP at the stated quality; the PNG master is kept in `art/masters/`.
