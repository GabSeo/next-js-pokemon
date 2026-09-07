# The free catalogue, the scan, and where money starts

**Status: plan of record.** Written 2026-09-07, revised the same day after a
second round of measurement extended the central finding from One Piece to
Pokémon. Supersedes the "Implication" half of `docs/scan-to-collection.md`,
which reasoned toward this from a smaller evidence base; that document's
*Measured* sections remain a source for the finding this design is built on.

The product goal: **a person photographs a card, picks which printing they own,
and it lands in their collection. Free. Market data — eBay, Cardmarket,
TCGplayer, price history — is what they pay for.**

---

## 1. The constraint everything is designed around

We proved this twice, independently, and it is not a limitation to engineer
around — it is the shape of the domain.

**A card code identifies a card. It does not identify a collectible.**

`ST21-014` returns four real printings. All four are SR, all four are Monkey D.
Luffy, all four are Red / cost 5 / power 6000 / Strike. They trade at **USD
1,747.19, 29.51, 8.67 and 8.58** — a 204× spread. Every field a scanner can
read off the card is identical across all four.

And the official source is no better. Measured 2026-09-06 across Bandai's own
published catalogue:

| | |
|---|---|
| (code, pack) groups holding more than one printing | 945 |
| of those, identical in **every field** but the id and the image URL | **895 (94.7%)** |
| groups where `name` differs | **0** |
| tracked cards identifiable from (code + pack + treatment) | **0 of 9** |

Bandai records *that* a code has three printings. It does not record *which* is
the Alternate Art, the Manga or the Reprint. That distinction exists only in the
picture.

### And Pokémon is the same problem, for a stronger reason

This was measured on 2026-09-07 and corrects an assumption held throughout the
earlier design work: that Pokémon was the solved franchise and One Piece the
hard one. It is not. **Both are unsolved, in mirror-image ways.**

| | Pokémon (TCGdex) | One Piece (Bandai) |
|---|---|---|
| cards / (pack, code) groups | 21,066 | 3,665 |
| holding more than one printing | 10,110 (48%) | 945 (26%) |
| **distinct image per printing** | **0 (0%)** | **945 (100%)** |
| **distinct label per printing** | **100%** — `normal`/`reverse`/`holo` | **0 (0%)** |
| distinct market id per printing | 1,211 (12%) | n/a — Bandai sells no singles |

**One Piece has pictures with no labels. Pokémon has labels with no pictures.**

And the Pokémon gap cannot be sourced away. Two independent free catalogues were
checked and agree:

| probe | result |
|---|---|
| `assets.tcgdex.net/en/sv/sv08/001/reverse/high.png` | **404** |
| `assets.tcgdex.net/en/sv/sv08/001-reverse/high.png` | **404** |
| TCGdex card record | one `image`; `variants` is a **boolean map** |
| `api.pokemontcg.io/v2/cards/sv8-1` | one `images.small` / `.large` pair |

The reason is not data quality. **A reverse holo is the same artwork** — the
difference is the foil pattern on the border and text box. There is no second
scan to publish, so no catalogue publishes one, and none ever will.

This makes the constraint below stronger for Pokémon than for One Piece. A One
Piece printing is *unlabelled*; a Pokémon variant is *visually identical*. No
scanner, no embedding and no better source can separate the second case.

### What follows

1. **No pipeline can pick the printing automatically.** Not from a scan, not
   from a code, not from any catalogue we have found. Anything claiming to is
   guessing, and a wrong guess is a 204× error in a user's collection total —
   or, on the Pokémon side, a median **3.36×** one (§3d).
2. **So the human picks — and the product is built around that step, not in
   spite of it.** A scan narrows 34,000 cards to three or four candidates. The
   person then answers a question only they can: *which of these is the one in
   your hand?* That is a two-second tap, and it is the only correct answer.
   It is **mandatory for both games**, not a One Piece workaround.
3. **The unit of everything downstream is a PRINT IDENTITY**, not a code:
   `(tcg, code, printing)`. Collections, prices and metrics all key on it.
4. **The choose step is what makes the One Piece join tractable** (§6). We do
   not need to *label* `_p2`/`_p3`/`_p4` — we show three pictures and the person
   points. For One Piece, **the image is the label**.

---

## 2. The two planes

The free/paid split is not a business decision bolted onto the architecture. It
falls out of which sources are metered.

| | IDENTITY plane | MARKET plane |
|---|---|---|
| **Answers** | what is this card | what is it worth |
| **Pokémon** | TCGdex → `data/catalog/pokemon/` | apitcg, PokéWallet, eBay |
| **One Piece** | punk-records → `data/catalog/one-piece-official/`<br>BerryWallet corpus → `data/catalog/one-piece/` | BerryWallet live, apitcg, eBay |
| **Cost per user** | **zero** — files on disk | metered, per card |
| **Who gets it** | everyone | subscribers |
| **Changes** | when a set releases | continuously |

Identity is already free and local for both franchises. That work is done. The
plan below is about *exposing* it to users who are not paying, without letting a
single metered call leak into their path.

### The rule, stated once

> A page a free user can reach must be renderable with **zero metered calls**.
> Market data is an explicit, per-card, gated action.

### The shape both catalogues must reach

Today both stores are **card-shaped**. A portfolio holds **printings**. That gap
is the whole of the remaining catalogue work, and it is one schema for both
games — the only difference is that a print *may* carry its own image:

```
CARD    (tcg, setId, number)          ← what a scan matches: name, artwork
  └─ PRINT  (+ printKey, language)    ← what a collection row points at
       ├─ image        One Piece: per print (Bandai).  Pokémon: inherits the card's.
       ├─ label        Pokémon: normal/reverse/holo.   One Piece: none — use the image.
       ├─ marketKey    the id the price plane is keyed on
       └─ price        variant-scoped, never card-scoped
```

Read across the two games, each already solves the half the other is missing:

| | Pokémon | One Piece |
|---|---|---|
| card image | ✅ | ✅ |
| **print image** | none, and none exists (§1) | ✅ 100% of 945 groups |
| **print label** | ✅ `normal`/`reverse`/`holo`/`1st-edition` | ❌ Bandai gives none |
| **print price** | ✅ variant-keyed, already on disk, free | ✅ per print, on BerryWallet ids |
| **print → price join** | ✅ direct | ❌ unproven (§6) |

Only one cell in that table is a genuine unknown, and it sits behind the
paywall. Everything else is either present or provably absent.

---

## 3. What is wrong today

Four things. The first three break the free/paid rule above; the fourth is a
live correctness bug that costs nothing to fix.

### a. One Piece card images are metered

`lib/berrywallet.ts`'s `fetchCardImage` passes `RATE_LIMIT_BUCKET` to
`resilientFetch`, so **every image charges the 90/hour BerryWallet budget**. A
candidate grid showing nine printings of a scanned card would spend nine calls,
for a free user, on a picture.

This is the single blocking issue for the scan flow.

**Fix**: serve One Piece images from Bandai's URLs, which `punk-records` gives
us for all 12,720 printings, through our own proxy. Bandai sets
`Cross-Origin-Resource-Policy: same-site`, so a browser will not load them from
our domain directly — but a *server* fetch is unaffected, re-verified
2026-09-07: `HTTP 200, 247,155 bytes, image/png`. `same-site` constrains
browsers, not servers. The proxy pattern already exists for BerryWallet; this is
the same route pointed at a free source that has no ceiling in `BUDGETS`.

**Not a third party.** `arjunkai/optcg-api` (the Cloudflare Worker behind
opbindr.com) advertises a public card-image proxy and was evaluated as a
shortcut. Measured: `/image/…` and `/v1/images/…` both return **401** — the
data *and* image endpoints are gated to their own origins, key on request. We
would be depending on one person's worker for every image on the site. Our own
route is less work and has no owner but us.

**Serve `webp`.** TCGdex publishes both, and the same card is `high.png`
349,641 b against `high.webp` 82,528 b — **4.2× smaller**, same CDN, same cost.
Whatever the grid renders, it should not render png.

### b. There is no free per-card page

`/products/[slug]` is the tracked-card page and resolves everything eagerly:
identity, Cardmarket, TCGplayer, eBay tiers, history. It exists for 12 refs. A
free user scanning any of 21,066 Pokémon cards or 2,785 One Piece codes has
nowhere to land that is safe.

### c. Nothing enforces the boundary

The tier-1 discipline (`lib/catalog.ts` and friends import `node:fs` and
nothing else) is real but only covers the loaders. Nothing stops a future page
importing `cards.ts` and quietly putting a metered call on a free route.

### d. Pokémon prices are variant-blind, and we already hold the fix

**This one is live, wrong on screen today, and free to correct.**

TCGdex and pokemontcg.io both split prices by variant — TCGdex as a `-holo`
suffix on the Cardmarket block and as keyed blocks under `tcgplayer`. Our crawl
*already keeps them*. Measured across `data/prices/pokemon.json` on 2026-09-07:

| | |
|---|---|
| rows | 20,451 |
| carrying a `-holo` Cardmarket split | **16,219 (79.3%)** |
| normal vs reverse price ratio | median **3.36×**, p90 **10.7×** |
| rows where the two differ by more than 2× | 12,190 (**75%**) |
| TCGplayer variant blocks present | `reverse-holofoil`, `normal`, `holofoil`, `unlimited`, `1st-edition`, `unlimited-holofoil`, `1st-edition-holofoil` |

Nothing renders them. A reverse holo is shown its normal print's price in four
cases out of five, off by a median 3.4×.

The catalogue side is what is missing: `data/catalog/pokemon/*.json` stores
`variants` as a type list and `cardmarketProductId` at **card** level, with no
edge from a variant to its price key. Note that the shared product id is *not*
the problem it first appears — both marketplaces price the variants separately
*under one product*, which is exactly why 12% distinct ids (§1) never mattered.

**No new source is needed. No metered call is needed. The data is on disk.**

---

## 4. The pipeline

```
  CAPTURE          photo, or the card code typed by hand
     ↓
  READ             extract the code — client-side OCR, zero server cost
     ↓
  MATCH            code → every printing of it, from local catalogue, 0 calls
     ↓
  CHOOSE           a visual grid; the person taps the one they own
     ↓
  STORE            collection row = (tcg, code, printingId)
     ↓
  ─────────────────  paywall  ─────────────────
     ↓
  ENRICH           eBay tiers, Cardmarket, TCGplayer, history — per card, gated
```

### Why code-first and not image-similarity

The code is a short, fixed-format, high-contrast string printed in a known
position on every card in both games. It is the easiest thing on the card to
read and the most discriminating: it narrows 34,000 cards to typically 1–9.

Image similarity would need an embedding per printing and a vector index — and
it would still land on the same *choose* step. §1 now puts a number on why: for
Pokémon, **0%** of the 10,110 multi-variant cards have a distinct image, so the
embeddings of a normal and a reverse holo are the same vector. Similarity can
help One Piece, where every printing does differ; it cannot help the larger
half. It is a **Phase 7 accelerator**, not a foundation.

### Why OCR runs on the client

GCP Vision's free tier is 1,000 units/month — about 33 scans a day across all
users (`GCP-CONTEXT.md` §4.8). That cannot serve a free tier. Client-side OCR
(Tesseract.js or the browser's own `TextDetector` where available) costs us
nothing per scan and scales with users rather than against them.

And there is always a floor that cannot fail: **typing `OP05-119` reaches the
same matcher.** The scan is a convenience over the keyboard, so a bad photo
degrades to a text field rather than to an error.

---

## 5. The phases

Each is independently shippable and independently useful. None requires the
next. None touches the eBay/Cardmarket/TCGplayer pipeline.

### Phase 0 — Guard rails ✅ *done*

`scripts/check-free-tier.mts`, wired into `prebuild`. Walks the import graph
from all 53 routes and fails the build when one reaches a metered upstream
without being declared.

**Metered is defined, not listed**: `resilientFetch` charges `rateLimitKey ??
host` and `chargeApiBudget` no-ops for a bucket with no ceiling, so a module is
metered exactly when its bucket appears in `BUDGETS`. That is why `lib/tcgdex.ts`
is absent despite making real HTTP calls — `api.tcgdex.net` has no ceiling,
which is why the Pokémon catalogue could be built from it at all.

Baseline on the day it was written:

```
53 routes: 24 free, 28 metered by decision, 1 import-only, 0 leaks
```

Two categories, kept apart because they mean different things:

- **ALLOWED** — metered on purpose: tracked-card pages, the price checker, the
  market APIs, the entity map (`lib/entitymap.ts` really does call
  `getCardBySlug` per ref).
- **IMPORT_ONLY** — reaches a metered module through a module-level import it
  never invokes, so no quota is spent. `okf/about` returns fixed prose and
  reaches PokéWallet only because `lib/okf.ts` imports `cards.ts` on line 1 for
  its *other* functions. This list is a backlog for splitting those modules, not
  a set of decisions to spend.

**Known limitation**: it walks imports, not calls, so it overstates. That is the
right bias for a guard rail, and IMPORT_ONLY is where the overstatement is
recorded rather than hidden.

**Verified by breaking it**: adding `import { getCardBySlug } from "@/lib/cards"`
to the free One Piece sets page failed the build with the exact chain —
`@/lib/cards → @/lib/pokewallet → lib/pokewallet` — then passed again on revert.

### Phase 1 — Variant-correct Pokémon prices ✅ *done*

First because it was the only phase fixing something **already wrong on
screen**, needing no new source, no new call and no new crawl (§3d).

**§3d overstated the gap and is corrected here.** The variant→price-key edge
already existed as `cardmarketPriceFields`; no crawl change was needed. Two real
defects sat on top of it, both measured across the 33,085 card×variant pairs
that have a snapshot row:

| | before | after |
|---|---|---|
| variant resolves to a TCGplayer block that exists | 26,874 (81.2%) | **28,623 (86.5%)** |
| key missed although a block was present | 4,072 (12.3%) | **2,323 (7.0%)** |

1. **The key was a string where the data needed a list.** A block name carries
   the card's *era* as well as its finish, so Base-Set-era printings failed:
   1,391 `normal` cards priced under `unlimited`, 358 `holo` under
   `unlimited-holofoil`. Now an ordered candidate list, first match wins.
2. **Only the headline printing was reachable.** The tile labelled its variant
   honestly but had no way to show the others. `getCatalogPricesByVariant`
   returns every priced printing and the tile renders them.

**Two rules the resolver holds, both load-bearing:**

- **Never cross the foil boundary.** 1,167 pairs are `normal` variants whose
  only block is `holofoil`; they stay unpriced. Substituting there would be the
  same 3.36× class of error this phase exists to remove.
- **Within a finish, the commonest print run leads.** 818 cards hold both a 1st
  Edition and an Unlimited block and 1st Edition is dearer in **98%** of them
  (median 2.61×) — leading with it would overstate all 818. The block that
  answered travels back as `tcgplayer.key` so a caller can name the run.

**Result**: 8,151 cards now show more than one printing's price; **8,028 reverse
figures became reachable** that were not before. Venonat `swsh12-001` renders
EUR 0.04 normal against EUR 0.18 reverse — the documented 4.5× case, both
visible. Build unchanged at 393 pages in 3.1s.

**Short of the original criterion, stated plainly**: this said "all 16,219 rows
that carry one". 16,219 is the count of snapshot rows holding a `-holo`
Cardmarket field; only 8,028 belong to cards whose TCGdex variant list actually
contains `reverse`. The remainder are the orphaned blocks of §3d — 4,497 cards
priced for a reverse holo that upstream does not list as a variant. Closing it
would mean asserting a printing exists that TCGdex does not record — inventing
catalogue data on a source's behalf — so it stays a written gap rather than a
silent inference.

**Budget**: BerryWallet 12/90, PokéWallet 4/60 after a full build — unchanged.
The whole phase reads a local snapshot; it added no fetch path.

### Phase 2 — Unmetered One Piece images ✅ *done*

`/api/one-piece-image/[printingId]?lang=english` resolves a printing to its
Bandai URL through the crawled catalogue, fetches it server-side and serves it
`immutable`. `/sets/onepiece/[packId]` renders it in place of the text tiles.

**Why a proxy is needed, and why it works.** Bandai sends every card image with
`Cross-Origin-Resource-Policy: same-site`, so a browser refuses to paint one on
our domain — all 319 tiles came back `ERR_BLOCKED_BY_RESPONSE.NotSameSite`. That
header constrains *browsers*, not servers: the same URL fetched server-side is a
plain 200 (247,155 bytes, `image/png`). Nothing about it is metered —
`onepiece-cardgame.com` has no ceiling in `BUDGETS`.

**Why the URL is resolved, not constructed.** Both halves are per-language and
neither is derivable from the id:

| | host | extension |
|---|---|---|
| english | `en.onepiece-cardgame.com` | `.png` |
| japanese | `www.onepiece-cardgame.com` | `.png` |
| french | `fr.onepiece-cardgame.com` | **`.webp`** |

`ST01-001.png` is 223,541 bytes on `en` and 218,783 on `www` — *different
bytes*, so a wrong host is a wrong card, not a cosmetic slip. And
`fr/ST01-001.png` 404s while its `.webp` is 200. Only `img_url` knows.

**Resolving through the catalogue is also the security property.** The route
fetches whatever comes back, so returning undefined for an id we do not hold is
what stops a crafted `printingId` from making this an open proxy for arbitrary
paths on Bandai's domain. Verified: `../../etc/passwd` refused, `OP99-999_p9`
refused, an unknown language refused, `OP05-119_p2` resolves.

**Measured**: 4,844 of 4,844 English printings (100%) resolve to a live URL.
Sample fetches return 200 at 283–289 KB. `check-free-tier` reports **54 routes,
25 free** — up from 24, the new route classified free without being allowlisted.
Build holds at 393 pages in 3.1s. BerryWallet and PokéWallet unchanged by the
route; the ±12 per build is the tracked-card prerender, as before.

**Resizing happens in the route, not in `next/image`** — see §7 for why, and
for the measurements. The tile is a plain `<img>` with a `srcset` over the five
widths the route will produce.

### Phase 3 — Free catalogue card pages ✅ *done*

`/card/[tcg]/[code]` renders every printing of a card, for either game, from one
component. `src/lib/card-view.ts` is the actual deliverable: the card→print
shape of §2 made concrete, so the scan's candidate grid and a collection row
later inherit it rather than re-deriving it.

**Verified**:

| | |
|---|---|
| `/card/pokemon/sv08-001` | 2 printings — normal EUR 0.04, reverse EUR 0.15 |
| `/card/onepiece/OP05-119` | 9 printings across OP-05, OP-09, OP-11, PRB-01, each its own artwork |
| `/card/pokemon/base1-4` | 1 printing, holo, EUR 487.19 |
| unknown code / unknown game | not found, no throw |

**The shape holds both games without hiding their difference.** `image` is
per-print for One Piece and shared for Pokémon; `label` is meaningful for
Pokémon and **deliberately absent** for One Piece. Those are not gaps to fill
later, they are what the sources contain (§1).

**Deviation from this plan, on purpose.** The line above used to promise "for
One Piece the treatment from the BerryWallet corpus". It is not there. Joining
a BerryWallet treatment onto a Bandai printing id is precisely the unproven
join of §6, and printing a guessed "Alternate Art" under the wrong picture is
worse than printing nothing. The pack label and the artwork carry it instead.

**Found while building — the Pokémon mirror of the One Piece label gap.** Base
Set Charizard holds **four** `holo` variants pointing at two different
Cardmarket products (273699 and 660224 — 1st Edition against Unlimited). They
are real, separate printings, and TCGdex types all four identically, so nothing
in our data can name which is which. Rendering four tiles all reading "holo"
would show a distinction we cannot explain, so they dedupe to one. The
TCGplayer block names Phase 1 already resolves through
(`1st-edition-holofoil`, `unlimited-holofoil`) are the missing vocabulary; using
them as printing identities is its own piece of work, not smuggled in here.

**Not prerendered, and that is scale not caching.** ~24k cards against a site of
393 pages that builds in 3s. `generateStaticParams` returns nothing, so a page
renders on first request and caches from then on. It costs no quota to render,
so an uncached first hit is slow at worst, never expensive.

**Tiles now link to it**, reversing a decision `catalog-card-tile.tsx` had
documented as deliberate. That comment argued against linking because the only
card page was the premium `/products/[slug]`, and a thin imitation would
advertise a surface it could not deliver. The reasoning was sound and its
premise is now gone: there is a real free destination.

**Route naming**: `/card/onepiece/…`, not the `/card/one-piece/…` this document
first wrote, to match the existing `/sets/onepiece`.

**Budget**: `check-free-tier` reports **55 routes, 26 free** — up from 25, the
card page classified free without being allowlisted. Build holds at 393 pages
in 2.7s. BerryWallet and PokéWallet untouched by the page.

### Phase 4 — Lookup by code *(the scan without the camera)*

- A search box that accepts `OP05-119`, `190/182`, or a name.
- Routes to the Phase 2 page.
- Ships the whole *match → choose* interaction with no OCR risk.

**Exit criteria**: a person can find any of 34,000 cards and pick a printing.

### Phase 5 — Scan

- Camera capture → client-side OCR → extract code → same route as Phase 3.
- On low confidence, show the text field pre-filled with the best guess.

**Exit criteria**: scanning a card lands on its printing grid; a failed read
degrades to typing, never to an error.

### Phase 6 — Collection (free)

- A collection row is a **print identity**: `(tcg, code, printingId, quantity,
  condition, acquiredAt)`.
- Identity-level display only — name, image, set, printing. No value.
- The absence of a total is the paywall, stated honestly rather than teased.

**Exit criteria**: add, list and remove cards, with zero metered calls.

### Phase 7 — Market activation *(paid)*

- A subscriber activates market data on a specific card.
- That, and only that, calls the existing pipeline — untouched.
- Activation is what `card-refs.ts` encodes by hand today: it becomes a row in a
  table rather than a commit.

**Exit criteria**: a free user cannot cause a metered call. A subscriber's
activation produces exactly the data `/products/[slug]` shows today.

---

## 6. The open question that Phase 7 turns on

**For One Piece, the identity plane and the market plane use different ids, and
we have not proved they can be joined.**

**It is smaller than it was.** The 2026-09-07 measurement moved it off the
critical path in two ways. First, the *choose* step is mandatory for both games
anyway (§1), so nothing needs to auto-label `_p2`/`_p3`/`_p4` — the person sees
three pictures and points at theirs. Identity, browsing, scanning and collecting
(Phases 1–6) never need this join. Second, it is now scoped to **cards a paying
user actually owns**, which is the metered boundary already drawn. Pokémon has
no equivalent problem: its variant → price-key edge is direct (§3d).

What remains is genuinely unresolved, and it is worth stating what it is *not*:
not a blocker for the free product, and not something to guess at when it does
arrive.

- `punk-records` gives images, languages and gameplay data, keyed `OP05-119_p4`.
- The BerryWallet corpus gives the treatment (`(Alternate Art) (Manga)`) and the
  Cardmarket/TCGplayer URLs that lead to money, keyed by its own row id.
- A user picking from a *picture* gives us a punk-records id. Pricing it needs
  the BerryWallet row.

There is a promising signal — for OP05-119 in PRB-01, BerryWallet holds three
rows and Bandai holds three printings — but "same count, therefore same order"
is exactly the `(V.N)` assumption this codebase already refuses to make twice
over.

**How to resolve it**: before Phase 7, measure across all codes present in both
catalogues — how often do the counts agree, and where they do, does any
independent signal (rarity, pack, price tier) confirm the alignment? If the
answer is no, the join is a human step too, done once per card at activation,
which is acceptable because activation is already a deliberate act — and it is
the same step `card-refs.ts` encodes by hand for 12 cards today.

**Do not build Phase 7 on an assumed join.**

---

## 7. Who resizes the One Piece images — decided: we do

Bandai publishes exactly one size: ~247–289 KB of PNG per printing, no
thumbnail, and no webp outside the French feed. A 319-tile pack page is **78.8
MB** untouched, so something has to resize. Two candidates, and the decision
went against the one that was already working.

| | `next/image` | **`sharp` in our route** ✅ |
|---|---|---|
| Cost | Vercel Image Optimization | our CPU once per (printing, width), then CDN |
| Visible to `api-budget.ts` | **no** | n/a — nothing to meter |
| Exposure | up to 4,844 English source images | none |
| Precedent here | the BerryWallet proxy | the Pokémon grid's plain `<img>` |

**The deciding argument.** Vercel's image quota is a metered resource that
`lib/api-budget.ts` cannot see. The free tier's whole premise is that a free
surface cannot spend a metered resource, and a meter our own budget report is
blind to is worse than one it tracks — that blind spot is precisely what Phase 0
exists to prevent everywhere else. Shipping the optimizer would have put an
invisible meter on a page any free user can open.

It also makes the site consistent: the Pokémon grid already uses a plain `<img>`
against TCGdex's pre-sized `low.webp`. Bandai simply publishes no such variant,
so we produce one.

**Measured on `OP05-119_p2` (600×838 PNG, 247,155 b):**

| width | webp bytes | vs source | resize |
|---|---|---|---|
| 160 | 14,046 | 17.6× | 15 ms |
| 240 | 29,656 | 8.3× | 18 ms |
| **320** | **48,196** | **5.1×** | 24 ms |
| 480 | 94,052 | 2.6× | 41 ms |
| 640 | 140,464 | 1.8× | 45 ms |

A 319-tile pack page at the grid's 320w tile: **78.8 MB → 15.4 MB**, before
lazy-loading takes most of the rest.

**Two guards worth keeping.** `?w=` is an ALLOWLIST, not a clamp — an open
parameter multiplies CDN cache entries per card by however many integers a
caller sends, and each miss is a real resize. And a source sharp cannot decode
falls back to the original bytes rather than a 500: heavier, but the card stays
visible.

---

## 8. What must not break

The market pipeline is the hardest-won part of this codebase and none of the
above touches it:

- `lib/one-piece-variants.ts` — the four-axis query model (treatment, product,
  rarity, spelling), every rule of it measured against live eBay.
- `data/one-piece-sets.ts` — the vocabulary tables, and the build gate that
  fails when a tracked card's query cannot separate its own printings.
- `lib/graded-market.ts`, `lib/ebay-browse.ts` — the tier fetching and title
  filtering.
- `card-refs.ts` — the 12 hand-resolved cards. Phase 7 generalises this; it does
  not replace it. The existing refs keep working throughout.

The one thing that *should* change, and is worth doing before any of the above:
**`buildCached` caches upstream failures as if they were results.** An exhausted
budget window currently freezes empty markets into a card's page for up to a
day — observed twice in one session. It costs no quota to fix and it protects
everything else.

---

## Related

- `docs/scan-to-collection.md` — the original finding, and the four places
  today's shape assumes a human
- `docs/ebay-market-pipeline.md` — the query model this plan must not disturb
- `docs/pipeline-by-franchise.md` — what each source does and does not carry
- `GCP-CONTEXT.md` — quota and cost constraints for any hosted component
