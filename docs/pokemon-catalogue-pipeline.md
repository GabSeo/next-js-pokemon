# The Pokémon catalogue: where every field comes from

The reference for how card data is acquired, stored and served. Every figure here
is printed by `npx tsx scripts/catalog-provenance.mts`, so this document can be
re-derived rather than trusted. Measured 2026-09-09.

This matters because the live scan is only as good as its references. A card with
no picture has no embedding, and a card with no embedding cannot be recognised by
anything, however good the camera pipeline gets.

---

## 1. The five sources

Nothing here is metered. No API key, no quota, no paid tier — that is a hard
constraint (`scripts/check-free-tier.mts` fails the build if a free route reaches
a metered upstream).

| # | Source | How we get it | What it gives | Lands in |
|---|--------|---------------|---------------|----------|
| 1 | **TCGdex** `api.tcgdex.net` | REST crawl, ~24k requests, ~20 min | Set lists, card identity, rarity, variants, market pointers, image URLs | `data/catalog/pokemon/` (16 MB)<br>`data/catalog/pokemon-ja/` (8.9 MB) |
| 2 | **type-null/PTCG-database** (GitHub, MIT) | One shallow `git clone`, 21,925 JSON files | Real Japanese names, Pokédex numbers, official image URLs | `data/catalog/pokemon-ja-official/` (6.4 MB) |
| 3 | **PokéAPI** `pokeapi.co` | 1 request | 1,025 species names, dex number → English | `data/catalog/pokemon-species.json` (48 KB) |
| 4 | **Limitless TCG** `limitlesstcg.com` | HTML scrape, 414 requests, 14 s | Images nobody else has, EN↔JP set bridge, English names for Japanese sets | `data/catalog/limitless/` (3.3 MB) |
| 5 | **Derived here** | Local compute, no network | Artwork signatures, MobileCLIP vectors | `data/catalog/pokemon-art/` (2.5 MB)<br>`data/catalog/pokemon-clip/` (21 MB) |

Prices are a separate pipeline (`data/prices/`, 5.6 MB) and are deliberately not
part of card identity — see §7.

### Why each one exists

**TCGdex** is the backbone because it is free, unmetered, keyless and complete on
the English side. It is the only source that answers "what sets exist and what
cards are in them" for both languages.

**PTCG-database** exists because TCGdex's Japanese catalogue is thin exactly where
the scan needs it: it pictures 16% of Japanese cards, and it romanises Japanese
names inconsistently (`Gengar Ex` for one card, `ナゾノクサ` for another). This
repository is an independent MIT-licensed scrape of the official Japanese card
search. It supplies 65% of Japanese pictures and the real Japanese name for every
record it covers.

**PokéAPI** exists to make Japanese cards *readable*. A Japanese card carries a
Pokédex number, which is the same integer in every language, so the English
species name is a lookup rather than a translation.

**Limitless** exists to close image gaps neither of the above reaches, and because
it is the only source that connects an English card to its Japanese release.

**The derived layer** is what the scan actually searches. It is computed from the
pictures the four sources point at, and never fetched.

---

## 2. The image cascade

This is the single most important mechanism in the catalogue, and it lives in
exactly one place: `src/lib/pokemon-image.ts`.

```
card.image                     → TCGdex asset CDN
  else, Japanese only:
japaneseImageUrl(set, localId) → official publisher, via our resize proxy
  else:
limitlessImageUrl(set, localId)→ Limitless CDN
  else:
undefined                      → "No picture published"
```

**`undefined` is a real answer, not a failure to handle.** 3,465 cards are pictured
nowhere public. Rendering a blank is honest; rendering a different card's artwork
is a confident lie, and confident lies are the failure mode this whole codebase is
built to avoid.

The cascade used to be copy-pasted in three files (the card page, the search grid,
the scan lookup). That duplication is how the `&w=320` bug shipped twice. It is now
one function, and a fourth source is a change to one file.

---

## 3. English versus Japanese

The same code path, radically different data underneath.

| | English | Japanese |
|---|---|---|
| sets | 203 | 381 |
| cards | 21,066 | 23,919 |
| **picture: TCGdex** | 19,508 (92.6%) | 3,882 (16.2%) |
| **picture: publisher** | — | 15,609 (65.3%) |
| **picture: Limitless** | 787 (3.7%) | 1,734 (7.2%) |
| **picture: none** | 771 (3.7%) | 2,694 (11.3%) |
| **→ pictured** | **20,295 (96.3%)** | **21,225 (88.7%)** |
| rarity known | 100% | 50.5% |
| printings known | 99.8% | 53.4% |
| Pokédex number | 0% | 69.6% |
| Latin label | 100% | 100% |
| market pointer | 97.1% | 43.3% |
| artwork signatures | 20,280 | 21,223 |
| MobileCLIP vectors | 20,276 | 21,224 |

### The four differences that matter

**1. Japanese is bigger and worse covered.** 23,919 cards against 21,066, but
TCGdex pictures only 16% of them. Three sources are needed to reach 88.7%, where
English reaches 96.3% from one.

**2. English has no Pokédex number and does not need one.** `dexId` is populated
only from the Japanese official data. An English card is already labelled in
English, so nothing needs to be derived.

**3. Japanese cards know less about themselves.** Half have no rarity and half have
no printing data, because 11,138 of them come from the official mirror, which
publishes what a card *is* without saying how many ways it was printed. The card
page renders one unlabelled printing rather than an empty page.

**4. Every label is Latin, in both languages, by construction.** A Japanese card
displays as `Gengar ex`, never `ゲンガーex`. The rule is four-source and lives in
`src/lib/card-label.ts`: Pokédex species name → species named inside the Japanese
name → the official English label → the printed number. The Japanese spelling stays
in the backend, where the scan reads it off a photograph.

---

## 4. Card identity: the part that is genuinely hard

Three findings, each measured, each of which cost a wrong implementation first.

**A printed number is a filter, not an identifier.** 53% of English and 57% of
Japanese printed numbers name more than one card. `110/098` is a Lugia *and* a
Kangaskhan from another set. Anything that treats a scanned number as an identity
will confidently return the wrong card roughly half the time.

**Artwork identifies the CARD, never the PRINTING.** Of 10,110 multi-variant
Pokémon cards, zero have a distinct image per variant. So artwork can tell you
*which card*; it can never tell you whether you are holding the reverse holo.

**An English card and its Japanese release share artwork exactly.** Which is why
the scan searches one language at a time and never both — the same photograph
matches in both indexes.

The unit the catalogue stores is a **card**. The unit a collection holds is a
**print**. `src/lib/card-view.ts` is where one becomes the other.

---

## 5. What runs when

Nothing below is on a request path. All of it is offline, incremental, and
re-runnable per set.

```bash
npm run catalog                    # TCGdex, English      ~20 min
npm run catalog:pokemon-ja         # TCGdex, Japanese     ~20 min
npm run catalog:pokemon-ja-official# PTCG-database clone  ~2 min
npm run catalog:pokemon-species    # PokéAPI              1 request
npm run catalog:limitless          # Limitless sets       14 s
npm run catalog:limitless-bridge   # EN↔JP bridge         27 s
npm run catalog:pokemon-art        # artwork signatures   ~45 s
npm run catalog:pokemon-clip       # MobileCLIP vectors   ~2 min
```

Verification, which is not optional:

```bash
npm run limitless:coverage         # what each source contributes
npm run limitless:verify           # does a match name the same card? 120/120
npx tsx scripts/catalog-provenance.mts   # the numbers in this document
```

Every crawl is **incremental**: a set already held is skipped without a request,
so adding a new set costs the new set. That is the property that makes this
maintainable rather than a quarterly ordeal.

---

## 6. What is served at request time

**No API is called for card identity, ever.** The catalogue is JSON files read from
disk once per process and indexed in memory. This is the "tier-1 loader" discipline:
those modules import `node:fs` and `node:path` and nothing else, and
`scripts/check-free-tier.mts` fails the build if a free route reaches a metered
client transitively.

Measured effect: search is 9 ms across 44,985 cards.

Images are the exception, and they are pointers rather than bytes:

| Source | How it reaches the browser |
|---|---|
| TCGdex | Hot-linked from `assets.tcgdex.net` |
| Official Japanese | Proxied through `/api/pokemon-ja-image`, resized to webp at 320/480/640 |
| Limitless | Hot-linked from their CDN |
| One Piece promos | Mirrored into `public/card-images/one-piece/` (970 files, 67 MB) |

The grid and the card page use a plain `<img>`, not `next/image`, deliberately:
these hosts serve pre-sized files and `next/image` would re-optimise them against
a metered Vercel quota.

The only metered call in the whole scan path is Google Vision OCR, capped at 33/day
and declared in `lib/api-budget.ts`.

---

## 7. Should we mirror every image and serve it ourselves?

Short answer: **no for display, and unnecessary for the scan.**

**For the scan, images are not the artefact.** What the matcher searches is a
512-dimension int8 vector per card. 41,500 vectors is **21 MB** — already computed,
already committed, already searchable in 8 ms of plain JavaScript with no vector
database. Mirroring images would not make the scan one millisecond faster, because
the scan never touches an image after ingestion.

**For display, the arithmetic is decisive.** The One Piece mirror is the precedent:
970 images at 480px webp q78 = 67 MB, so ~69 KB each.

| Approach | Files | Size |
|---|---|---|
| One Piece mirror (existing) | 970 | 67 MB |
| All Pokémon at 480px webp | 41,520 | **~2.9 GB** |
| All Pokémon at TCGdex `low` (13.5 KB) | 41,520 | **~560 MB** |

Either number is a non-starter in a Git repository deployed on Vercel. The One
Piece mirror exists because those 970 pictures **exist nowhere else** — Bandai does
not publish them. That is the rule: *mirror what would otherwise be lost, point at
what is reliably served.*

**What is worth doing instead**, if latency ever becomes a real complaint rather
than a suspicion: put a caching proxy in front of the three upstream hosts
(`/api/card-image/...`), so the browser talks to one origin, we control cache
headers and format, and no image is stored in the repository. That is a
one-afternoon change, and it should follow a measurement rather than precede one.

---

## 8. Current state

**Done and measured.**

- 44,985 cards across both languages, 41,520 pictured, **41,500 searchable by a photograph**
- Five sources, none metered, all incremental
- One image rule, one label rule, guarded by build-time checks
- Search 9 ms; artwork signatures and MobileCLIP vectors committed
- EN↔JP set bridge: 83 English sets mapped to a Japanese origin
- Matching verified: 120/120 sampled Limitless matches name the same card

**Built but not wired in.** The MobileCLIP index exists and nothing in `src/` reads
it. The live scan still runs Google Vision OCR → printed number → 64-bit artwork
hash. Connecting the index is the next real step, and it is the one that turns a
photograph into an answer without spending OCR quota.

**Measured on real photographs**, with corners read by hand — the output a perfect
detector would produce:

```
as shot        3/4
hand-rectified 4/4
```

So a card detector is worth building, and that is measured rather than assumed.

**Known gaps, in priority order.**

1. **No card detector.** This is the only thing between us and a video feed. The
   open question is which dataset to train on, and whether its training images show
   cards held in a hand or lying flat on a desk.
2. **2,694 Japanese cards from 1996–2005** are pictured by no public source.
3. **771 English cards**, almost all Trainer Kit reprints.
4. **Browser inference time is still an estimate** scaled from Node, not measured
   on a phone.

**The endgoal.** The fastest live scan on the market, on the best data we can
collect legally and for free. The data half is in good shape. The camera half has
not started.
