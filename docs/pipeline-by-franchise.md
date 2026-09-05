# Pokémon vs One Piece — the same pipeline, and why one of them is hard

Two spreadsheets sit beside this file and carry the detail:

- `docs/pipeline-pokemon.xlsx` — 7 sheets
- `docs/pipeline-one-piece.xlsx` — 9 sheets

Same layout in both (Read me · Pipeline · Market tabs · Rules and exceptions ·
Per card · Budget · Scaling), so they can be read side by side. One Piece adds
two sheets that have no Pokémon counterpart — **Variant resolution** and
**Upstream gaps** — plus a **Case studies** sheet tracing three Monkey D. Luffy
cards end to end.

This file is the narrative for the part that is hardest to hold in your head.
It restates nothing the spreadsheets don't already say; it just says it in the
order a person actually asks it.

---

## The one structural difference

**Pokémon identity is settled before any market lookup. One Piece identity is
the market lookup.**

A Pokémon card is `name + set + number`, which is a unique key, and TCGdex
answers it for free with no API key and no published rate limit. By the time
anything asks about a price, we already know exactly which physical object the
page is about. The two remaining unknowns — the Japanese print and the Western
Cardmarket product — are each closed by one hand-confirmed id stored on the ref
(`pokeWalletCardId`, `pokeWalletWesternCardId`), resolved in one call each.

A One Piece card is a **code**, and a code is an *identity, not a printing*.
`OP05-119` says which card; it says nothing about the artwork, the treatment,
the product it shipped in, or what it is worth. Measured 2026-09-05, that one
code covers **14 catalogued products between EUR 4.49 and EUR 7,500, across five
Cardmarket sets**. So every One Piece lookup starts under-determined, and the
whole `Variant resolution` sheet is the ladder that closes the gap without ever
guessing.

Add to that: the only source with a real Japanese One Piece catalogue
(BerryWallet) is metered at **100 calls/hour**, has **no price-history
endpoint**, and has **no French sets at all**.

| | Pokémon | One Piece |
|---|---|---|
| Identity | TCGdex (free, unmetered) | BerryWallet (100/hr) |
| Identity key | name + set + number — unique | card code — ambiguous by design |
| Price history | apitcg | apitcg (BerryWallet has none) |
| EU / Cardmarket | PokéWallet, stored id | BerryWallet row, or a sibling row joined on the **TCGplayer product URL** |
| JA identity | PokéWallet, stored id, 1 call | BerryWallet, resolved by aligning a `(V.N)` index across languages — and **refused** when it can't be |
| JA card number | genuinely different (190/182 → 070/063) | one universal code across regions |
| FR | TCGdex `/v2/fr` | none — BerryWallet has zero French sets |
| eBay tiers | PSA 10/9/8/Raw × 2 langs = **8 searches** | PSA 10/9/Raw × 2 langs = **6 searches** |
| eBay query | card **name + number** | **variant word + code**, name discarded |
| Per-card human work | one JP id, sometimes | which product the code means, every time |

---

## The three Luffys

All three are special cards, all three resolve their English identity through
the *same* cross-product path, and they end up in three different states. The
difference is never the resolver — it is what exists upstream at two specific
joins.

### `monkey-d-luffy-op09-061` — every market good

- **Set**: stored `OP09` (tier 1, one call).
- **Identity**: OP09 holds the number but not the tag → `findVariantAcrossProducts`
  finds the "English Version 2nd Anniversary Set" promo on the flat index.
  `crossProduct: true`.
- **EU**: that row's `cardmarket` is `null`, so `findCardmarketSiblings` adopts
  the `Unnumbered-Promos` row — joined on the **shared TCGplayer product URL**,
  which is the only thing that proves two rows are the same physical card.
  EUR 485.65.
- **JA identity**: refused (see below). Name and art stay English.
- **JA market**: **still resolves.** `japaneseCardmarketWithoutIdentity` runs on
  the fallback path precisely because *identity and market data are separate
  facts* — it walks from the Western product to `Unnumbered-Promos-Japanese` and
  returns EUR 375.59. The derived URL redirects to root, so
  `cardmarketProductUrl.japanese` pins the real Premium Bandai Asia-region link:
  **corrects the link, keeps the figures**, which is an assertion a person made
  after checking those euros against that page.

**Net**: US + EU + JA all carry real figures. The only gap is the Japanese *name
and art* — a translation gap, not a data gap, and deliberately not hand-typed.

### `monkey-d-luffy-st21-014` — US only

- **Set**: no stored code. `prefixCandidates` offers both `ST21` and `ST-21`;
  the real code is `ST-21`. **This card is why that function exists** — with the
  old single-shape guess it resolved to *nothing at all* in both languages.
- **Identity**: `getSetCards("ST-21")` lists only `(014)` and `(014) (Parallel)`.
  The Campaign Pack is a separate product → cross-product match, one of four rows
  sharing the code across a **200× spread** (USD 1,747.19 / 29.51 / 8.67 / 8.58).
- **EU**: **missing.** The row's Cardmarket block is null and no sibling shares
  its TCGplayer product. The two Cardmarket products BerryWallet does know for
  this code are *different printings* — the deck common at EUR 4.87 and an
  Unnumbered-Promos-Japanese `-V1` at EUR 169.53. Pricing either here is the
  merge this codebase refuses.
- **JA**: **missing, twice over.** Identity is refused, and the market walk
  cannot even start — `findJapaneseCardmarket` needs the *Western* product URL
  as its entry point and there isn't one.

**Net**: US only. The real product (`Special-Tournaments-Promos/MonkeyDLuffy-ST21-014-V1`)
exists and BerryWallet *tracks that Cardmarket set* as `CM-SPECIAL-PROMOS` — 21
rows, all pointing at that slug — but holds only 20 `DON!!` prints plus one Luffy.
The missing thing is a **row inside a set they already have**, so a backfill was
requested upstream on 2026-09-05 rather than a pin being written.

### `monkey-d-luffy-op01-024` — no JA

- **Set**: prefix `OP01` (Romance Dawn) resolves.
- **Identity**: the tag is the full `(OP01-024) (Alternate Art)`, because the
  origin set names this card `(024)` and every reprint set names it `(OP01-024)`
  — the parenthesised code is the entire disambiguation. Cross-product match in
  `The-Best`.
- **EU**: **works** — the `The-Best/-V2` row carries its own Cardmarket block.
- **JA**: **missing, and upstream.** PRB-01 holds exactly one `OP01-024` row
  (the Western one) and there is no `The-Best-Non-English` row for this code at
  all. Nothing to derive and nothing honest to pin.

**Net**: US + EU. Worth noting the risk here inverts: the contaminant is the
*expensive* one (Romance-Dawn Parallel at USD 240.03 against this card's USD
73.23), so a mixed tier overstates the card ~3× — and an overstated card reads
as a find rather than as a bug.

### What actually separates them

Every one of the three fails the Japanese *identity* step for the same reason:
a cross-product English match has `printVariantIndex: null`, and
`pickVariantForJapanese` refuses to align a `(V.N)` that belongs to another
product's tiering. `(V.N)` is a **per-set index, not an identifier** — six
OP05-119 products carry the Cardmarket name `(OP05-119) (V.2)` across five sets.
That refusal has now been confirmed correct three separate times by a person
opening Cardmarket.

So the three differ only at the **two Cardmarket joins**:

| | Western Cardmarket row reachable? | Japanese row reachable from it? |
|---|---|---|
| OP09-061 | yes (sibling on shared TCGplayer product) | yes → EUR 375.59 |
| ST21-014 | **no** (no sibling shares the product) | **no** — the walk has no starting point |
| OP01-024 | yes (own row) | **no** — the row does not exist upstream |

A Western Cardmarket product is not just the EU tab. **It is also the entry
point for the JA tab.** Losing it loses two markets, which is exactly what
ST21-014 shows.

---

## What this means for the scan / portfolio product

Both `Scaling` sheets answer this per franchise. The short version:

1. **Per-card live lookups do not scale.** At 100 calls/hour on the only source
   with a Japanese catalogue, a 10,000-card database is not a rate-limit problem
   to tune — crawling the catalogue into our own store is a *precondition*, not
   an optimisation. Both `getSets` and `getSetCards` are bounded, one-time costs
   when done that way.

2. **Variant selection stays a human decision, but stops being an API problem.**
   With the catalogue local, "which of these four ST21-014 rows is your card"
   becomes four rows with prices in front of an operator, not six speculative
   HTTP calls.

3. **Coverage must be a field, not an error.** The page already treats a stated
   absence as a first-class render state. A portfolio needs the same: *"we do not
   price this printing"* is a valid, honest cell, and the ST21-014 shape (real
   card, real market, no row anywhere we can read) will keep recurring.

4. **"Which market's card do I own" is only answerable where the JP counterpart
   is.** For Pokémon that is a stored id per card; for One Piece it is a `(V.N)`
   alignment that is valid within one product and meaningless across products.
   Anything better needs a real cross-language product mapping — image hashing
   plus price tier, which is the same evidence used by hand today.

5. **Two things can never be automated away.** Which product a code refers to,
   when several are real; and whether a pinned Cardmarket URL is the right
   variant — Cardmarket answers automated requests with a CDN bot challenge, so
   nothing in the code can ever check it.

---

See also: `docs/adding-a-card.md` (the procedure and the two escape hatches),
`docs/ebay-market-pipeline.md` (the graded-market query and its filters),
`docs/knowledge-model.md` (real vs illustrative).
