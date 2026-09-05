# The Pokémon catalogue — a corpus, and what it changes

**Status: built and wired.** `scripts/catalog-crawl.mts` writes it,
`src/lib/catalog.ts` reads it, and `resolveTcgdexCard` (lib/cards.ts) now goes
through it. Everything below marked *measured* was observed live on 2026-09-05.

The goal it serves: a card should exist because the catalogue has it, not
because someone hand-wrote a ref. This is the first half of that — the corpus
itself, and the identity lookups it makes free.

---

## 1. What it is

`data/catalog/pokemon/`, one JSON file per set, plus `_sets.json`.

```
218 sets · 23,546 cards · 13.1 MB · crawls in 69s · costs zero metered quota
```

TCGdex is keyless, has no published rate limit and is **not** a bucket in
`lib/api-budget.ts`, which is why the whole catalogue is affordable here and
why the same move for One Piece is a different problem — BerryWallet is the
only source with a real Japanese catalogue and it is capped at 100 calls/hour.

### It stores pointers, never prices

TCGdex returns live Cardmarket and TCGplayer figures inline on every card.
None of them are written to disk. Only `cardmarketProductId` and
`tcgplayerProductId` are kept.

That is `docs/adding-a-card.md`'s own rule — *pointers may be stored by hand,
content may not* — applied by machine. A stored figure goes stale silently on
a page whose whole proposition is that its numbers were read today; a stored
id goes stale loudly.

### Nothing is filtered out of the CORPUS — the views filter

The corpus includes 2,480 Pokémon TCG Pocket cards (digital-only, no physical
market), Trainer Kits and deck products. Dropping them at crawl time would be a
judgement baked into the data where nobody can see or revisit it.

**The browse surfaces exclude Pocket**, because none of those cards can be
owned, graded, sold or priced — `isDigitalOnlySet` (lib/catalog.ts) is the one
predicate that does it, and `getCatalogSets` / `catalogStats` take
`includeDigital` for the corpus as crawled. So `/sets` and `/cards` show
**203 sets / 21,066 cards** while the corpus holds 218 / 23,546.

Identity lookups are deliberately NOT filtered: `getCatalogCard("A1-001")` still
resolves. "Which card is this" and "what may a visitor browse" are different
questions, and only the second one has an opinion about Pocket.

---

## 2. The two tiers, and the quota invariant

**The invariant: every metered call is a function of how many cards someone
tracks, never of how many cards the catalogue contains.** Browsing, searching
or rendering all 23,546 costs zero API quota.

| | Tier 1 — catalogue | Tier 2 — market |
|---|---|---|
| Answers | what is this card | what is it worth |
| Cost | a local file read | metered quota |
| Covers | all 23,546 | cards someone tracks |
| Lives in | `lib/catalog.ts` | `lib/apitcg.ts`, `pokewallet.ts`, `ebay-browse.ts`, … |

Two things enforce it, and neither is discipline:

1. **The imports.** `lib/catalog.ts` imports `node:fs` and `node:path` and
   nothing else. It cannot reach a market client, so it cannot spend quota even
   by mistake. *Adding a market client to that import list is the one change
   that breaks this* — that line is the thing to watch in review.
2. **The type.** `CatalogCard` has no price field of any kind. A page holding
   one cannot render a price because there is nothing to render — the same
   separation `lib/types.ts` already keeps between `Card` and
   `LocalizedCardText`.

Measured after building all of tier 1: eBay 395/1200, apitcg 180/900,
BerryWallet 16/90 — all unchanged.

---

## 3. What the wiring changed

`resolveTcgdexCard` used to turn a ref's name + set + number into a TCGdex id
with a live **search**: one `/cards?name=` returning every same-named card,
then one `getCard` per candidate sharing the number until a set name matched.

It now resolves that id from the corpus in memory and fetches only the card.

**Measured, all three tracked cards:**

```
gengar-vmax-271        corpus swsh8-271   ==  live swsh8-271    (live cost 2 requests)
lugia-v-186            corpus swsh12-186  ==  live swsh12-186   (live cost 2 requests)
ethans-typhlosion-190  corpus sv10-190    ==  live sv10-190     (live cost 2 requests)
```

End-to-end resolve of `lugia-v-186` after clearing its cache entry:
**1 TCGdex request** (was 2), card fully resolved — identity, USD 527.13, 100
history points, image, EU Cardmarket block.

Two things were deliberately kept:

- **The live search is still the fallback.** A corpus that is absent, stale, or
  has no row for a card degrades to exactly the behaviour that shipped before
  it existed. Strictly additive.
- **`findCatalogCardByNameAndSet` mirrors the live matcher character for
  character**, including the loose parts (exact `localId`, case-insensitive set
  SUBSTRING). Improving the match here would make a card resolve to one
  printing offline and another on the fallback path — invisible until it prices
  the wrong object.

**Not attempted yet:** serving identity from the corpus while TCGdex is *down*.
That is the real robustness win — it is what would have kept card art and the
French toggle alive through both documented TCGdex outages — but TCGdex also
carries the live price block the US tab reads, so the price path needs its own
answer for that case first.

---

## 4. Measured findings

### a. TCGdex and PokéWallet return identical Cardmarket figures

Verified 2026-09-05 against all three tracked Pokémon cards, `avg` / `low` /
`trend` / `avg1` / `avg7` / `avg30`. **All 18 figures matched to the cent**, and
TCGdex's `idProduct` matched the pointer the corpus stores. They are reselling
the same feed.

So the EU tab's `pokeWalletWesternCardId` — a stored id plus one metered call
per Pokémon card — is in principle redundant.

**It has not been acted on, for two reasons.** Both need closing first:

1. **n=3, and all three are single-variant holo cards.** The multi-variant case
   is untested and is exactly where the two could report *different variants*:
   PokéWallet picks "first price row with data" and carries a `variant_type`;
   TCGdex uses the `-holo` suffix scheme below. That is 42.9% of the corpus.
2. **TCGdex publishes no marketplace URL at all** — checked in the raw
   response, neither `cardmarket.com` nor `tcgplayer.com` appears anywhere, only
   numeric ids. TCGplayer's `/product/{id}` form is confirmed working
   (lib/tcgdex.ts). The EU panel's Cardmarket *link* comes from PokéWallet's
   `product_url`, and whether a numeric-id Cardmarket URL resolves can only be
   checked by a person — Cardmarket answers automated requests with a CDN bot
   challenge.

### b. Print identity is real for Pokémon, and it is derivable

**42.9% of the corpus is multi-variant** (10,110 of 23,546). Normal and
reverse-holo share **the same Cardmarket and TCGplayer product id** — TCGdex
returns the identical price block on both variants. The two printings are
separated by **field suffix inside that block**, not by product:

```
Venonat swsh12-001   normal    avg 0.04      tcgplayer "normal"
                     reverse   avg-holo 0.18 tcgplayer "reverse-holofoil"   (4.5x)
```

The subtlety: on a **holo-only** card the plain fields carry the holo price and
the `-holo` fields are null. So the suffix does not mean "holo" — it means "the
reverse-holo printing of a card that also exists unfoiled". `cardmarketPriceFields`
(lib/catalog.ts) encodes this and branches on the card's own variant list
rather than on the variant type alone.

**Consequence not yet addressed:** `tcgplayerSnapshot` (lib/tcgdex.ts) picks
the *first* variant key the API returns, and its own comment says "most cards
only have one". True of all three tracked cards; false for 42.9% of the
catalogue. Not a bug today. It becomes one the moment an untracked card renders
a price.

### c. `variantId` is not a card identifier

Measured: **18 distinct values across 743 cards.** It names the variant *kind*
("holo/standard") and is reused across every card sharing it. Never use it as a
print key — use `tcgdexId` + variant `type`.

### d. Price-pointer coverage is 95.4% of physical cards

**20,092 of 21,066** cards — that is the whole browsable catalogue, since
Pocket is excluded from it (above). The remaining gaps are small and
explicable: Trainer kits 48%, POP 77%.

**This figure was wrong once and the mistake is worth recording**, because it
would have killed a feature. The first measurement counted
`variants_detailed[].thirdParty.cardmarket` and reported **58%, with four dead
eras — XY, Black & White, Diamond & Pearl and Sun & Moon, 7,186 cards** written
off as unpriceable. Rendering a set page for one of them disproved it
immediately: every card priced. A 12-card-per-era sample confirmed 11–12 of 12
in all four.

The cause is that TCGdex carries the Cardmarket id in **two places, and they are
complementary rather than one superseding the other**:

| | card-level `pricing.cardmarket.idProduct` | per-variant `thirdParty.cardmarket` |
|---|---|---|
| XY, B&W, D&P, Sun & Moon | present | **absent** |
| Gym series | **absent** | present |
| Scarlet & Violet, Sword & Shield | present | present |

Counting only `thirdParty` gave 58% and buried four eras. Counting only the
card-level id gave 94% and dropped the entire Gym series to zero. Neither is the
answer. `cardmarketProductIdFor` (lib/catalog.ts) reads both, and
`catalogStats` counts through it.

A pointer existing does not guarantee **figures** exist — a Gym card has an id
and no readable price block, so it is correctly counted as reachable and still
renders "No price".

### e. The set list and the set endpoint disagree, and the endpoint wins

7 of 218 sets. `wp`, `jumbo`, `sp` and `rc` advertise cards in the set list (7,
160, 10, 25) and return an **empty `cards` array** from their own endpoint;
`tk-sm-l`, `swshp` and `mfb` return fewer than advertised. Total: the list
claims 23,776, the endpoints yield 23,546.

Completeness therefore means "nothing failed on our side", never "we hold as
many cards as the list claims" — testing against the claim made those 7 sets
re-crawl on every run, forever, and fixed nothing. The shortfall is printed
per set when a set is crawled.

### f. Probing TCGdex by hand

`api.tcgdex.net` publishes an **AAAA record that does not accept connections**.
An IPv6-first client with no Happy Eyeballs fallback hangs ~21s per request
(python's `urllib` does; `curl` and Node 18+ do not). `curl -4` is the
workaround. This is **not** an outage and **not** the GeoDNS problem
lib/tcgdex.ts's header documents — it cost half an hour of misdiagnosis before
Node was tested and answered in 554ms.

---

## 5. The set pages

`/sets` lists all 218 sets straight off disk — **zero network calls**.
`/sets/[setId]` shows every card in a set with a live price against each.

The two halves come from different places on purpose, and that is what makes it
affordable:

```
identity   lib/catalog.ts        off disk, 0 requests, instant
prices     lib/catalog-prices.ts off disk, from the snapshot (see §7)
```

**Measured, Pitch Black (`me05`, 120 cards):** 120 of 120 priced, 0 "No price"
tiles, and every metered counter identical before and after — apitcg 182,
BerryWallet 16, PokéWallet 4. The invariant demonstrated rather than asserted.
Render time was 1.74s when prices were fetched live; it is 5–8ms now (§7).

**Prerendered at build, all 203.** That was originally refused — prerendering
fired ~23,500 requests per build — and became correct once prices moved to a
local file (§7). Set pages are now static HTML on the CDN, and the route is
correspondingly no longer a zero-page route.

**One number per card is a choice, and it is labelled.** A grid has room for
one price, so `primaryVariantType` quotes the `normal` printing when the card
has one and the sole printing otherwise. Any card with more than one variant
shows which printing the figure belongs to, because the reverse holo of the
same card can trade at 4.5x (Venonat, measured) and a bare number would not say
which one it is.

**No price history, and this source cannot provide it.** TCGdex exposes
trailing `avg1 / avg7 / avg30` and no time series. The product-page chart comes
from apitcg, metered at 1,000/month — which is exactly why that chart exists
for 11 cards and not 23,546. Building history for the catalogue would mean
snapshotting on a schedule into a store of our own; deliberately not done.

---

## 6. Search and filters

`/cards` searches all 23,546 — a horizontal sort bar, a vertical facet panel,
and 60 results a page.

**Every control writes the URL and the server does the filtering.** Three
reasons, and the first is not negotiable: 23,546 cards cannot be shipped to a
browser to filter client-side. `CardGridFilter` can hide and reorder in the DOM
because it works on eleven tracked cards; that does not survive two more orders
of magnitude. Second, a filtered view is a thing people send each other —
`?serie=XY&rarity=Rare` is a link and component state is not. Third, only the
server can tell whether a price sort is affordable at all.

**Facets exclude their own dimension.** Counting every filter including the
one being counted makes each unselected option read 0 the moment one is
picked — true and useless, since the number a person wants is "how many would
I get if I switched to this instead".

**Price sort is capped and says so.** Sorting by price requires pricing the
whole result set, one live request per card, so it is offered only below
`PRICE_SORT_MAX` (250) and refused above it with the reason on screen. A "sort
by price" that silently reordered only the sixty rows already visible would be
a control lying about its own scope. Unpriced cards sort to the END in both
directions — "we have no price" is not "this card is free", and a low-to-high
sort led by cards with no price would be actively misleading.

Verified against the live corpus:

| query | matches |
|---|---|
| none | 23,546 |
| `q=charizard` | 125 |
| `serie=XY` | 1,932 |
| `category=Trainer` | 3,055 |
| `variant=reverse` | 8,193 |
| `priced=1` | 20,092 — the same 95.4% as §4d |

(Totals are over the 21,066 browsable cards, not the 23,546 in the corpus.)

### The split that the boundary forced

`lib/catalog-query.ts` exists because the first version of the filter UI
imported `SORTS` from `catalog-search.ts`, which reaches `catalog.ts`, which
imports `node:fs`. Turbopack refused the build outright: *"the chunking context
does not support external modules (request: node:fs)"*.

**That refusal is §2's invariant working, not an obstacle to it.** A Client
Component genuinely cannot reach the corpus, so it cannot ship 13 MB to a
browser or convince a page it can filter 23,546 cards client-side. The fix is
therefore always a split — the query *vocabulary* (sort ids, facet shape,
limits; imports nothing) apart from the query *execution* (needs the corpus) —
and never a `node:fs` shim or a bundler exception.

---

## 7. Why prices are a local file

The catalogue used to fetch one live price per card while a visitor waited.
That is fine at 120 requests and untenable at scale, and it failed three ways
that all trace to the same cause.

| | measured |
|---|---|
| a set nobody had opened | **2–10s**, paid by whoever clicked first |
| `/cards` on unseen cards | **0.35–1.26s**, every request, forever |
| prerendering to fix it | **strictly worse** — see below |

The third one is the important one. Prerendering all 203 sets fired ~21,000
requests across parallel build workers, tripped the circuit breaker, and
**froze the empty results into static HTML for 24 hours**: `sv08` and `base1`
shipped with no prices at all, `me05` with 1 of 120. Slow is recoverable;
wrong-and-cached is not.

So `scripts/price-refresh.mts` writes `data/prices/pokemon.json` and rendering
became a map lookup:

```
20,452 of 21,066 physical cards · 45s · 5.9 MB · zero metered quota
```

| | before | after |
|---|---|---|
| `/sets/[setId]` | 2–10s first visit | **5–8ms**, prerendered, static on the CDN |
| `/cards` | 0.35–1.26s | **50–100ms** |
| whole-catalogue price sort | capped at 250 results | **all 21,066**, ~100ms |

Prerendering is safe *now* precisely because the build makes no requests —
there is nothing left to fail mid-build and freeze.

### This is not price history

One file, overwritten on each run. No time series, no per-day rows, no charts.
TCGdex publishes trailing `avg1 / avg7 / avg30` and no series, so a history
could not be built from this source even if it were wanted.

### On "pointers may be stored, content may not"

This stores content, deliberately. That rule exists so a figure on the page was
machine-read recently and its age is knowable — not to forbid caching. Every
entry is read from the source and never typed, the file carries `generatedAt`,
and both pages **print that date**. The old copy said *"at most 24 hours"*,
which the snapshot would have made false; it now reads *"as of <date>"*.

What the rule actually forbids — a hand-typed price rotting silently — remains
impossible.

### Freshness is a deploy concern now

`prebuild` regenerates the snapshot, so prices are as of the last deploy.
Refresh without deploying with `npm run prices`. The file is committed as well
as generated, so a deploy never depends on TCGdex being up.

The reader keeps a **per-card** live fallback for a card the snapshot lacks —
added upstream since the last refresh — because a handful of live reads is
cheap and a wrong "No price" is not. There is deliberately no *whole-file*
fallback: 21,066 live reads is the exact failure this removes.

---

## 8. Operating it

```bash
npm run prices                                       # refresh prices, ~45s
npx tsx scripts/catalog-crawl.mts                    # full crawl, ~69s
npx tsx scripts/catalog-crawl.mts --sets swsh12,sv10 # a few sets
npx tsx scripts/catalog-crawl.mts --force            # re-fetch everything
```

A normal re-run **skips** every complete set. `--force` re-fetches but
**rewrites only files whose content actually changed** — `crawledAt` is
excluded from the comparison, so a re-crawl's diff is exactly the sets that
moved rather than all 218.

**The corpus is committed, not gitignored.** Once `resolveTcgdexCard` reads it,
it stops being a build artifact and becomes a build *input*: Vercel builds from
the repo with no prebuild step, so a gitignored corpus is simply absent there
and every Pokémon card silently degrades. Crawling during the build would work
but puts a third party on the deploy path — and per lib/tcgdex.ts's own header
that host has already failed twice in a week, once by routing and once by
certificate. A committed corpus means a TCGdex outage cannot break a deploy.

---

## Related

- `docs/adding-a-card.md` — the manual workflow, and the pointers-not-content rule
- `docs/scan-to-collection.md` — where this is heading, and what still assumes a human
- `docs/pipeline-pokemon.xlsx` — the per-source pipeline this sits inside
- `src/lib/catalog.ts` · `scripts/catalog-crawl.mts`
