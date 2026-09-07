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
treatment in a different product**, the two can be different *markets*, and the
query names the product as a second group:

> **Whether a reprint is the same card depends on the treatment.** A PRB-01
> **SEC Alt Art** is its own artwork — OP05-119's Premium Booster print is a
> different picture from the Awakening one. A PRB-01 **Manga Rare** never is:
> Bandai cannot reissue a manga panel under a code that already has one, so a
> new manga drawing for the same character gets a new code in a new set. See
> "a treatment that reprints unchanged" below.


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

**Both the phrase and one word.** A phrase alone missed this, in the Japanese
tier of the PRB-01 card:

```
PSA 10 GEM MINT JAPANESE ONE PIECE 2022 MONKEY LUFFY OP01-024 ROMANCE SR ALT ART
```

The Romance Dawn card, written without "Dawn". `-"romance dawn"` cannot see it;
`-romance` removes it and its twin and nothing else (Japanese 15 → 13, English
unchanged at 12).

Which word is decided by document frequency across the corpus's own set names,
lowest first, longest as the tie-break — never by splitting the name and
excluding everything. "Awakening of the New Era" would otherwise emit `-new`,
and "new" is also in "Emperors in the New World": a word naming two products
names neither. The measure picks `romance` over `dawn`, `awakening` over `era`,
and `promotion` over `one` and `piece` in "One Piece Promotion Cards" — where
`-one` would have excluded the entire game.

Three guards, each earned:

- Words in the WANTED row's own set name are skipped. Without it, excluding
  "Premium Booster -The Best-" contributes `-best` — fine until we track a card
  from "Premium Card Collection -Best Selection Vol. 2-", and 59 of 100 One
  Piece PSA 10 titles carrying "best" belong to that unrelated line.
- The language suffix is stripped first. "Romance Dawn (Japanese)" offered
  `japanese`, a word `opSetNames` strips and therefore scores at frequency zero
  — the most distinctive word there is. `-japanese` on the Japanese tier
  rejects the entire market.
- A word the corpus has never seen sorts LAST, not first. Unknown is not
  distinctive.

Exclusions take the LONGEST segment of a set name only — "Premium Booster -The
Best-" excludes on `premium booster` and drops `the best`, which a seller might
write about condition. Both segments stay available as positive terms, where
breadth can only add. A family code is excluded only when it is 3+ characters
*and* not a prefix of the card's own code: `-op01` on OP01-024 would fight the
card number itself.

### Parallel and Alternate Art are one treatment

Bandai's early sets say "Parallel", its later ones say "Alternate Art", for the
same thing. Modelling them separately made them look like competing printings
of one code:

- Across 10,689 corpus rows, **no code carries a Parallel row and a separate
  Alt Art row**. Two treatments would collide somewhere; these never do (174
  parallel-only, 504 alt-only).
- The only two rows carrying both say `(Parallel) (Manga) (Alternate Art)` —
  one card named three ways.
- Sellers write them together: `PSA 10 Luffy OP01-024 SR Parallel Alt Art THE
  BEST PRB-01`.

Splitting them meant OP01-024 emitted `-parallel` **against its own card**,
discarding two real Japanese PSA 10 listings. Merging drops `-parallel`
everywhere, which costs nothing: the 2nd Anniversary promo, the one card that
relied on it, returns 32 PSA 10 and 10 raw listings either way.

**The consequence: the product becomes the only discriminator.** OP01-024's OG
Romance Dawn printing and its PRB-01 printing are now the same treatment in two
products, and a PRB-01 alt art is a new picture — confirmed by the card's owner
at SR, and by OP05-119 at SEC. So its query must NAME the product. Without
`(prb,"premium booster","the best")` it returns 26 English PSA 10 listings
instead of 8, the extras all OG Parallels at $135–245 that never say "Romance
Dawn" for an exclusion to catch.

### Only the most specific treatment is searched

Every Manga Rare is an alternate art. So a row labelled `(Alternate Art) (Manga)`
is one thing named twice, and asking for both is worse than redundant — the
terms are ORed, so `alt` admits the **separate plain Alternate Art printing**
that the same code also has.

OP05-074 PSA 10, 2026-09-06:

| asks for | listings | range | median |
|---|---|---|---|
| `(alt,alternate,alternative,altart,manga)` | 22 | $69.99–3,100 | $1,399 |
| `(manga)` | 14 | $1,200–3,100 | $1,475 |

The median barely moves, but the four cheapest — the ones the panel displays —
were $69.99, $80, $84.99 and $120, none of them this card. A `implies` field on
the treatment carries the relation, so this is a subtype rule rather than a
per-card fix.

Note the direction: `implies` only strips POSITIVE terms. The broad treatment is
still what a sibling gets excluded on, and `alternate-art` remains
`excludable: false` for the reasons above.

### A sibling's product is excluded too

The last asymmetry in the model. A sibling's treatment became an exclusion, its
product family became one, its rarity became one — but the **product** never
did, so the OP09-061 Parallel had nothing keeping the 2nd Anniversary Set promo
out. That only worked by accident: the promo's query names a product and the
Parallel's names a treatment, so a listing writing both would have satisfied
both cards.

```
OP09-061 PSA 10 (alt,alternate,alternative,altart,parallel) -jumbo -"2nd anniversary" …
```

Measured free on every tracked card that has such a sibling, PSA 10 and raw:
OP09-061 Parallel 40/40 and 73/73, OP09-004 5/5 and 7/7, OP09-093 5/5 and 7/7,
ST21-014 5/5 and 8/8 — that last carrying `-"luffy deck"` on a Luffy card, safe
only because a quoted phrase demands adjacency.

Products come from the same table as sets, `data/one-piece-sets.ts`, and not
from a heuristic. Shortening a product name to its first two words broke three
ways at once:

- **collisions** — 45 of the 249 products that can generate a term collapsed
  onto another product's, and the truncated part was the discriminator: `Judge
  Pack Vol. 2` through `Vol. 7` all became `judge pack`; `Online Regional 2023`,
  `2024` and `2025 Vol. 1` all became `online regional`.
- **names** — `productOf` returns any non-treatment parenthetical, so alternate
  character names came through as products: Daz.Bonez on 25 rows, Bentham on 23,
  Galdino on 23. The model says names generate nothing; the heuristic couldn't
  tell.
- **tails** — "2nd Anniversary Set" needs its tail dropped (32 listings against
  24) while "Judge Pack Vol. 2" needs its tail kept. No single rule reads both
  ways.

The table stays small because a product only matters when it lands on a code we
track: 405 exist, 249 could ever generate a term, **7** cover the cards tracked
today.

### The vocabulary is a build gate

A missing entry does not crash anything — the query just loses a term and
quietly stops telling two printings apart, surfacing as a median that is wrong
for no visible reason. That is invisible in review and expensive in production,
so `npm run prebuild` runs `scripts/check-one-piece-vocabulary.mts` and the
build fails rather than shipping a card whose query never could have worked.

```
[one-piece] vocabulary OK — 9 tracked card(s), 9 multi-printing code(s),
            24 set families and 7 products in the table.
```

Add a card on one of the 89 codes whose products collide and it stops you,
naming what to add and which card needs it:

```
[one-piece] 6 vocabulary gap(s). Add them to src/data/one-piece-sets.ts.
  MISSING PRODUCT  "Championship 2024 Finalist Card Set"
                   needed by: TEMP-op01-077
  MISSING PRODUCT  "Championship 2024 Top Player Pack Vol. 2"
  ...
```

Three failures are checked, all on codes with more than one printing — a card
with nothing to be confused with cannot be confused:

| | |
|---|---|
| **missing product** | a printing sits in a product the table does not know |
| **missing set** | same, for the set family |
| **colliding terms** | two different products on one code resolve to the same term, so excluding one excludes the other |

### Rarity: excluded, never required

Required, a rarity term is destructive — most sellers do not write it, so
ANDing it on throws away the ones who did not. Measured PSA 10, 2026-09-06:

| card | without | with |
|---|---|---|
| OP09-093 | 5 | **1** with `(sr)` |
| OP05-119 | 6 | 5 with `(sec)` |
| OP09-061 Parallel | 40 | 23 with `(l,leader)` |

Excluded, it catches what nothing else does. The **tier** rarities are mutually
exclusive — a card is exactly one of C, UC, R, SR, SEC, L, TR, DON!! — so a
listing naming a different one is a different card, whatever else it says. No
sibling is needed to justify that, and requiring one was measurably too narrow.
OP09-061 is a Leader and nothing sharing its code is an SR, so a sibling-scoped
rule stayed silent while these sat in its raw tier:

```
Bandai One Piece CCG Monkey.D.Luffy OP09-061 Alt Art Holo SR English 5000
Bandai One Piece CCG Monkey D. Luffy OP09-061 Leader Alt Art Foil SR ENG
```

`-sr` removes exactly those two and nothing else (74 → 72).

**PR is not a tier and is handled apart.** It says where a card was given out,
not how rare it is, so a promo printing carries a tier as well — real titles say
"SR" and "Promo" together. So a PR card excludes no tiers at all, and `-pr` is
added only when a SIBLING carries PR. That is the 86 of 2,622 codes carrying two
rarities, always PR against the set's own:

```
OP01-120 PSA 10 ("championship 2023") -parallel -manga            <- the PR promo
OP01-120 PSA 10 (parallel,alt,…)      -manga -uc -r -sr -l -tr -don -pr
```

**`c` is searchable but never excludable**, the same asymmetry treatments use.
Cost is written in titles as "3000 2c", and every tokeniser here splits that
into "2" and "c" — `-c` deleted `Monkey D. Luffy OP01-024 Premium Booster -The
Best- SR Foil Alt Art 3000 2c`, a real listing of the very card that query is
for. Every other tier token was measured individually against the same result
set and dropped nothing.

A row with no rarity asserts nothing: all 3,644 Japanese rows carry none, plus
579 English promos. `DON!!` is an explicit value on 244 rows, so a missing
rarity does **not** mean a DON card.

**Every rival product is named, not just the origin.** A code can be printed in
six products — OP05-119 is in OP-PR, OP05, OP09, OP11, PRB-01 and CM — and
naming one leaves the rest to treatment terms that may not separate them.
Measured free on the cards where nothing competed (OP05-119 6/6, 13/13, 9/9;
OP09-061 40/40, 72/72), and decisive on the one where something did:

| OP05-074 | before | after |
|---|---|---|
| PSA 10 | 22 | 18 |
| Raw | 64 | 54 |

...but OP05-074 is also where the rule needed a second half.

### A treatment that reprints unchanged groups its products

Not every PRB-01 reprint is a new card. A **Manga Rare** reprinted into a
Premium Booster keeps the original artwork; what changes is production — a
"One Piece" logo stamped into the texture, slightly different text ink, a
smoother foil. Collectors tell them apart and price them together, and the
market agrees. OP05-074 PSA 10, 2026-09-06:

| printing | listings | range | median |
|---|---|---|---|
| OG, Awakening of the New Era | 10 | $1,200–2,500 | $1,475 |
| PRB-01 reprint | 4 | $1,399–3,100 | $1,600 |

Overlapping ranges, medians 8% apart: one market. So a treatment carrying
`reprintedIdentically` suppresses the product split for the families that share
it — OP05-074 keeps `-op07` for the SP printing and drops `-prb`.

OP05-119's SEC Alt Art stays split, because a Premium Booster SEC Alt Art is
its own artwork rather than a restamp. The market agrees, and the contrast with
the Manga Rare above is stark:

| OP05-119 SEC Alt Art | OG (Awakening) | PRB-01 |
|---|---|---|
| English PSA 10 | 45 listings, median **$790** | 6 listings, median **$400** |
| Japanese PSA 10 | 28 listings, median **$542** | 13 listings, median **$211** |

Half the money, consistently, on both language tiers. A Manga Rare's reprint
sells for what the original does; a SEC Alt Art's — a different picture — does
not.

**A "Reprint" row counts as the same artwork too.** OP09-004's only PRB-01 row
is labelled plain `(Reprint)` rather than `(Manga)`, and a reprint is by
definition an existing artwork printed again, so it groups as well. Without
that arm a Manga Rare whose reprint BerryWallet happened to file under
"Reprint" would be split from itself. Safe because grouping only ever *removes*
an exclusion — the positive `(manga)` term still gates, so admitting the family
cannot let a base-card reprint in.

Verified across the whole corpus: 9 codes carry a manga printing, 14 manga rows
in total, and none of them excludes a family holding the same manga artwork.

The default is to split, and the flag is the exception, because the two errors
are not symmetric: splitting a printing that should be grouped narrows its
search, while grouping printings that should be split quotes one price as
another's. Only Manga carries the flag.

**One token per rival product, from a static table.** `data/one-piece-sets.ts`
holds what sellers actually call each product — `OP01` -> `romance`, `OP11` ->
`divine`, `PRB` -> `prb` — keyed by the family `opSetFamily` returns, so a set
and its pre-release, anniversary and release-event printings collapse together.

That table replaced a derivation that emitted a long phrase *and* a rare word
for every rival:

```
before  -"unnumbered promos" -"one piece promotion cards" -"awakening of the new era"
        -awakening -"emperors in the new world" -"a fist of divine speed"
after   -awakening -emperors -divine
```

Most of those names are **Cardmarket catalogue buckets** — "Unnumbered Promos",
"One Piece Promotion Cards", "Judge Promos" — that no seller has ever typed into
a title. Every one measured zero effect while making the query unreadable. They
are marked `exclude: null` in the table, along with:

- **decks** (`ST`, `LT`), named after their contents: "Starter Deck 26:
  PURPLE/BLACK Monkey.D.Luffy", "Starter Deck 23: RED Shanks". Their
  distinctive word is the card's own colour or character, and `-purple` was
  measured to cost the OP09-061 Parallel two real listings.
- **`EB` and `OP16`**, where one family covers three different Extra Boosters,
  and where "The Time of Battle" offers only the word "battle".

A token is also dropped when the card's own code contains it, so `-op01` can
never fight `OP01-024`'s card number.

**Base prints get this too.** The rule used to be gated on the card carrying a
treatment, so the 2nd Anniversary Set promo — a base print, identified by its
product phrase — never excluded "Emperors in the New World", the set its own
code belongs to. That was an inconsistency, not a decision. Measured harmless:
32, 19 and 10 listings unchanged across English PSA 10, Japanese PSA 10 and
English raw, because no real 2nd Anniversary listing names the origin set.

A base print AT home still gets nothing, and that gate stays: its same-treatment
rivals are every other base print of the code, whose set names include things
like "Starter Deck 26: PURPLE/BLACK Monkey.D.Luffy" — excluding on `purple`
would fight the card's own colour, which sellers write.

*Known gap:* a starter-deck code never recognises itself as at home, because
`ST21-014` yields the prefix `ST21` while the set code `ST-21` yields the family
`ST`. ST21-014 therefore gets no family exclusions at all. Harmless today, and
not blindly fixable — its home set is "Starter Deck EX: Gear 5", whose most
distinctive word is `gear`, and half the Luffy listings on eBay say "Gear 5".

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
