# The eBay market pipeline — how a card's listings are found and filtered

Context document for the graded-market panel: how a query is built, what
gets rejected and why, and which alternatives were measured and rejected.
Written so a fresh session can pick this up without re-deriving it, and
without re-running experiments that already have answers.

Everything here is measured against the live API unless marked otherwise.
The tool that measures it is `scripts/ebay-query-lab.mts`.

---

## 1. The pipeline

`getGradedMarketData(card)` → per tier × language → `fetchActiveTier` →
`searchActiveListings` → `runSearch` → eBay Browse → local filters → 4 rows.

**Tiers.** Pokémon runs PSA 10 / 9 / 8 / Raw. One Piece runs PSA 10 / 9 /
Raw — no PSA 8, the population is too thin. Both run English + Japanese, so
Pokémon costs 8 eBay searches per card and One Piece 6.

**The request.**

| Param | Value |
|---|---|
| `q` | see §2 |
| `category_ids` | `183454` (CCG individual cards) |
| `filter` | `buyingOptions:{FIXED_PRICE}`, `conditionIds:{2750}` graded / `{4000}` raw |
| `aspect_filter` | `Grade:{N}` + `Professional Grader:{PSA}`, or `Graded:{No}`; plus `Language:{…}` |
| `sort` | `price` |
| `limit` | 20 (`FETCH_LIMIT`) — filtering rejects a lot, so the window is wide |

Fixed-price only, because an auction's `price` is the current bid, not an
asking price, and mixing the two into a median compares incompatible numbers.

**The local filters, in order.** `price > 0` → `titleMatchesCard` →
market guard → **local price sort** → first 4 (`DISPLAY_LIMIT`).

---

## 2. Query text — where the franchises diverge

Pokémon sends **name + number**: `Lugia V 186/195 PSA 10`.

One Piece **throws the character name away** and sends **variant words +
code**: `Manga OP09-004 PSA 10`, `Wanted OP09-093 PSA 10`.

Two measured reasons:

- A bare number returns every print sharing that `card_number`. Shanks
  OP09-004 gave 20 results with the tracked Manga print barely represented
  (1 survivor). Adding the variant word narrowed eBay's match set *before*
  its sort and limit applied: 1 → 7 real results.
- Only the **first word** is used (`tagFirstWord`). `"Wanted Poster
  OP09-093 PSA 10"` returns **0**; `"Wanted OP09-093 PSA 10"` returns 6
  (EN) and 14 (JA). Sellers write the short form.

**Where the variant words come from**, in precedence order:

1. `ref.ebayVariantTags[en|jp]` — hand-written, **used verbatim**, per
   language.
2. Otherwise **derived from `card.printName`** (BerryWallet's own
   parenthetical), treated as one tag and first-worded.

The derived value was verified character-for-character identical to the
hand-written `lookup.variantTags` for all five tracked cards, so adding a
card needs **no eBay tuning**. `lookup.variantTags` still exists for its real
job: disambiguating *which* BerryWallet product to resolve.

### Why `ebayVariantTags` is per-language

P-033's two tiers need **opposite** vocabulary — a perfect inversion:

| | `Event Pack Vol. 2` | `Shonen Jump` |
|---|---|---|
| English | **8 raw / 7 real** | 0 |
| Japanese | 0 | **20 raw / 20 real** |

The card shipped as a Weekly Shonen Jump insert in Japan and an event-pack
promo in English. One value cannot serve both; when it held only `Shonen
Jump`, the English tier returned **zero listings**.

---

## 3. Rejection rules

**Grade.** Graded tiers need `\bPSA\s*-?\s*10\b` in the title (tolerates
`PSA10`, `PSA-10`). Raw rejects any grading company mention.

**Number.** `card.number.split("/")[0]` — so Pokémon matches `186`, One
Piece matches the whole `OP09-004`. Letter-prefixed promos also accept the
bare `#033` form, which is real: `"…EVENT PACK VOL.2 #033 MONKEY D. LUFFY
PSA 9"`.

**Variant tags.** Every tag must appear, full phrase *or* first word.

**`japanese` / `\bJP\b` — English tier only.** eBay's `Language` aspect is
seller-declared and unreliable. Not mirrored on the Japanese tier: real
Japanese listings routinely say "EN" too, almost certainly short for OP09's
English set name rather than a language claim.

**`chinese` — every tier.** Chinese prints come through tagged Japanese. For
OP09-061 Raw, `Language:{Japanese}` returns `"One Piece Chinese EN 2nd
Anniversary Special OP09-061 …"` at $204.99 among 16 results; dropping the
aspect entirely surfaces four more. eBay's **website** does not return it for
the equivalent search, so its facet is stricter than the API's. Matters
because Chinese prints trade at $196–205 against $475+ for Japanese, so one
leaking into a cheapest-first tab lands on top and drags the median.

### The market guard

| Tier | Rule |
|---|---|
| English, any condition | drop JP-located; drop below **60% of `card.currentPrice`** |
| Japanese, **graded** | drop below 60% of `card.currentPrice` |
| Japanese, **Raw** | no guard |

`ENGLISH_PRICE_GAP_THRESHOLD = 0.4`, i.e. "40% or more below reference is
not this card". Anchored to a price we already trust, never to the result
set — on P-033, 7 of 12 results were the wrong print, so the result-set
median *was* the wrong cluster and any self-referential rule would have
discarded the five real listings.

The graded floor rests on market structure: a gem-mint graded card does not
sell below 60% of the same card's raw price, in any language. **Not** on a
claim that the Japanese market is cheaper — that is not reliably true and
must not be built on. Japanese Raw is unguarded for a narrow, specific
reason: Ethan's Typhlosion's Japanese Raw returns real listings at $15.96 and
$16.00 against a $26.83 reference, which a 0.60 floor would discard.

---

## 4. Sorting, and an eBay bug

Every tier sorts **cheapest-first**, so every median is a **floor**, not a
market rate. The grading ROI is correspondingly conservative.

**eBay's `sort=price` does not globally order the result set.** P-033's
English PSA 10 came back:

```
1131.91  1220  1350  4499.99 | 1353.73  2000  2000  2500
```

Two ascending runs concatenated — the signature of shard-local sorting. Every
price is already USD and shipping is absent or under $20, so neither currency
nor price-plus-shipping explains it. `priceCurrency` is rejected as a filter
(`errorId 12002`). eBay's own website sorts the identical search correctly
under `_sop=15`, so it is the Browse API specifically.

**So the displayed order and the median come from a local sort**, applied
after all filtering and before the 4-row slice. Without it, which rows a
visitor sees is decided by eBay's sharding.

---

## 5. Thin and empty tiers

Below `MERGE_THRESHOLD = 2` survivors, the search is retried on **Best
Match** and the two sets are merged, deduped by item URL. This changes the
**sort, never the query text** — which is what makes it safe.

An empty tier reports `noListings` and the panel says *"No active listings
today"*. That is distinct from `isReal: false`, which means we could not ask
(outage, quota, open breaker) and shows preview figures. A failed lookup is
not an empty market.

### Measured and rejected: broadening the query

The obvious next step — drop the variant word, retry on number alone — is a
trap:

| Tier | narrow query | number only |
|---|---|---|
| OP09-093 PSA 9 EN | 0 | 6 at **$25–180** |
| OP09-093 PSA 9 JA | 0 | 5 at $116–1770 |
| OP05-074 PSA 9 JA | 0 | 1 at **$35.50** |

Against references of $253 and $884, and Wanted Poster PSA 10s at $299–500,
those are the **ordinary print** of the same `card_number`. The proof is
structural: the narrow query already contains the variant word, so eBay
returning 0 for it while returning 6 for the number alone means none of those
6 carry the word.

**So the empty PSA 9 tiers are correct.** Widening would publish the wrong
card's price.

---

## 6. Open problem

**Seller-mislabelled variants.** A seller writes "Manga" in the title for a
print that isn't Manga, and the variant check passes because the title says
the word. Eustass Kid's Japanese Raw tier carries a $1.39 listing on an $884
card for exactly this reason.

It is *not* a price problem and a price floor is the wrong tool — the fix
has to distinguish a real print from a mislabelled one, and the title is the
only evidence available. Unsolved.

---

## 7. Gotchas that cost real time

- **Restart the dev server before verifying any `src/lib/` change.** A
  long-running `next dev` serves stale modules *and* refills `buildCached`
  with old-code results, so clearing the cache from another terminal does
  nothing. A script and the browser will then agree with each other on stale
  data, which reads as "the code is wrong".
- **`ebayVariantTags` is not `lookup.variantTags`.** Reading the wrong one
  produces query text the app never sends.
- **Scoring must be neutral.** The lab scores on grade + number only, never
  on the variant tags — scoring against the vocabulary under test hands the
  win to whichever strategy echoed it back.
