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

One Piece **throws the character name away** and sends **code, grade, then a
version clause**, in that fixed order:

```
OP05-119 PSA 10 (alt,alternate,alternative,altart) -manga -wanted -sp -gold
OP09-093 PSA 10 (wanted) -manga -sp -silver -gold
OP09-061 PSA 10 ("2nd anniversary") -jumbo -parallel
```

Same shape for every card and both languages. The positive group is always
parenthesised even when it holds one term, so the query stays readable in the
"see all on eBay" link a visitor clicks — a person can see what was asked.
Clause position is cosmetic to eBay and was measured to be so: the group first
and the group last return identical counts (OP09-004 5/5, OP05-074 22/22).

Two measured reasons the code alone is not enough:

- A bare number returns every print sharing that `card_number`. Shanks
  OP09-004 gave 20 results with the tracked Manga print barely represented
  (1 survivor). Adding the variant word narrowed eBay's match set *before*
  its sort and limit applied: 1 → 7 real results.
- Sellers write the **short form**. `"Wanted Poster OP09-093 PSA 10"` returns
  **0**; `"Wanted OP09-093 PSA 10"` returns 6 (EN) and 14 (JA).
- Alternate art has **four** live spellings and no term subsumes another,
  because both the query and the title check work on whole tokens:

  | in titles | matched by | evidence, PSA 10, 2026-09-06 |
  |---|---|---|
  | `Alt Art`, `Alt-Art` | `alt` | both layers split on non-alphanumerics |
  | `Alternate Art` | `alternate` | OP01-024's own sellers |
  | `Alternative Art` | `alternative` | 43 listings |
  | `ALTART`, `AltArt` | `altart` | "…HONESTY IMPACT ALTART PSA 10" |

  `alt` does not match "alternative", and nothing matches the joined form
  whose only token is `altart`. Four listed spellings rather than a prefix
  rule — a prefix broad enough for all four also catches "altered" and "alto".
  Only alternate art is evidenced this way; no other treatment gets extra
  spellings on speculation.

### Where the clause comes from

`lib/one-piece-variants.ts`, from the offline corpus, with one closed
vocabulary of **treatments** — the versions Bandai actually prints. See that
file's header for the model and why products and alternate character names
generate nothing. In short:

- **positive terms** = the wanted row's treatments, ORed;
- **exclusions** = the treatments its SIBLINGS under the same code carry and
  it does not;
- a row with no treatment at all searches on its **product**, shortened to
  the product name's **first two words**.

That last rule is measured, PSA 10 tier, 2026-09-06:

| card | full product name | first two words |
|---|---|---|
| OP09-061 | `("2nd anniversary set")` **24** | `("2nd anniversary")` **32** |
| ST21-014 | `("3rd anniversary treasure")` **4** | `("3rd anniversary")` **5** |
| P-033 | `("event pack vol. 2")` **9** | `("event pack")` **10** |

Sellers write a product's head and vary or drop its tail — `Set`, `Cup`,
`Vol. 2` — so the tail only excludes real listings. One word would not be a
product: it collapses `Event Pack` and `Judge Pack` onto `Pack`, and
`Luffy Deck` onto a bare `luffy` that matches every Luffy card ever listed.

### The product is part of the identity

Treatment alone is not always enough. When another row carries the **same
treatment in a different product**, the two are different cards — the PRB-01
reprints carry different art from the original print — and the query names the
product as a second group:

```
OP05-119 PSA 10 (alt,alternate,alternative,altart) (prb,"premium booster","the best") -manga -wanted -sp -gold
```

The groups are ANDed, in the query and in `titleMatchesCard`: alt art **and**
PRB-01. Measured PSA 10, 2026-09-06 — the PRB print, 6 listings, $175-1,100;
the OP05 print, 51 listings, $250-1,500 and mostly $600-750. A blended median
belongs to neither, and not reliably in one direction: on the English tier the
PRB print's own surviving asks are $400/$875/$1,100 against a blended pool
sitting around $650, so blending *understated* it.

Named **only** when treatment cannot separate the rows, because a term that
repeats work can only lose listings:

| card | same treatment elsewhere? | product named |
|---|---|---|
| OP05-119 | alt art in OP05 **and** PRB | yes |
| OP01-024 | alt art in PRB only | no |
| OP09-061 Parallel | parallel in OP09 only | no |
| OP05-074 | alt art + manga in OP05 only | no |
| OP09-061, ST21-014, P-033 | base prints | no — `productOf` already does it |

OP01-024 is the card where a hand-written `["PRB","alt"]` returned **zero**
PSA 10 listings against 19 for the plain query. That was never evidence against
naming the product; it is evidence against naming it where nothing competes.

**The other product is excluded by SET NAME, not by treatment.** OP01-024 is
why. BerryWallet calls the Romance Dawn printing `(Parallel)`; every seller
calls it "Alt Art" — so the query sent `-parallel`, aimed at a word nobody
writes, and the original sailed through the search for the reprint. Three
vocabularies for one treatment, across two catalogues and a marketplace.

A set name survives that, because sellers of the original write it and sellers
of the reprint do not. Measured PSA 10, 2026-09-06:

| query | listings | dropped |
|---|---|---|
| OP01-024 EN, no set exclusion | 19 | — |
| + `-"romance dawn"` | 12 | 7, all titled Romance Dawn, none naming PRB |
| OP01-024 JA + `-"romance dawn"` | 15 | 4, same shape |
| OP05-119 EN + `-"awakening of the new era"` | 6 | 0 — the positive PRB term already did it |

Two different markets either side of that cut: $505-2,000 against $148-719.

Exclusions take the LONGEST segment of a set name only — "Premium Booster -The
Best-" excludes on `premium booster` and drops `the best`, which a seller might
write about condition. Both segments stay available as positive terms, where
breadth can only add. A family code is excluded only when it is 3+ characters
*and* not a prefix of the card's own code: `-op01` on OP01-024 would fight the
card number itself.

### Rarity: excluded, never required

Required, a rarity term is destructive — most sellers do not write it, so
ANDing it on throws away the ones who did not. Measured PSA 10, 2026-09-06:

| card | without | with |
|---|---|---|
| OP09-093 | 5 | **1** with `(sr)` |
| OP05-119 | 6 | 5 with `(sec)` |
| OP09-061 Parallel | 40 | 23 with `(l,leader)` |

Excluded, it is free: excluding every rarity the card is not cost **nothing**
on all eight cards measured, single-letter tokens included. So it is excluded —
and, like every other exclusion here, only for what a SIBLING carries, not for
the whole vocabulary. That is where it discriminates: **86 of the 2,622 codes
that carry a rarity carry two**, always `PR` against the set's own (OP01-120 is
PR/SEC, OP01-001 is PR/L). The promo printing versus the set printing of one
code.

```
OP01-120 PSA 10 ("championship 2023") -parallel -manga -sec   <- the PR promo
OP01-120 PSA 10 (parallel,alt,...)    -manga    -pr           <- the SEC set print
```

It fires on none of the nine tracked cards, because every OP09-061 row is `L`
and every OP05-119 row is `SEC`. It is a guard for the 86, not a change to the
nine.

Rarity is absent far more often than it is present: **all 3,644 Japanese rows
carry none**, plus 579 English promos. `DON!!` is an explicit value on 244
rows, so a missing rarity does **not** mean a DON card — reading absence that
way would mislabel the entire Japanese side.

Which side of the split a row sits on decides the shape. A row in its code's
**own** family is the original and *excludes* the rivals; a row in any other
family is the reprint and must *name itself*, because a listing that mentions no
product is far likelier to be the original — that is where the volume is.
Exclusions use the family code only, and only at 3+ characters: `OP`, `ST`,
`LT`, `CM` are prefixes of the tokens sellers really write (`OP05`, `ST21`).

A hand-written `ref.ebayVariantTags[en|jp]` still wins over all of it, and is
rendered through the same clause builder so its shape matches everything else.

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
