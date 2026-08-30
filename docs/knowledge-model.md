# CardTrace knowledge model

The model of record for how a card is identified, related, sourced and dated.
These files are **working memory for agents**, not documentation: an agent
asked "what is this card worth" should get the answer in one fetch, know
where every number came from, and know how stale each one is.

Following vault-ld's serialization model — *prose for humans and LLMs,
triples for machines*. Frontmatter is the graph; the body is prose and
carries no triples by design. Neither face is the source: `card-refs.ts` plus
five upstream APIs are, compiled at build time. Every surface is a
projection.

Measured 2026-08-30 against production unless stated.

---

## 1. Where we are

| Surface | Pokémon `lugia-v-186` | One Piece `shanks-op09-004` |
|---|---|---|
| `/products/{slug}/index.md` | 4,636 B | 5,036 B |
| `/okf/products/{slug}` | 4,963 B | 5,450 B |
| `/api/{franchise}/{id}` | 16,038 B | 12,309 B |
| `/entitymap.json` | 6,863 B (site-wide) | — |
| `/llms.txt` | 2,543 B (site-wide) | — |

md + json per card: **20.7 KB** and **17.3 KB**. Target is 10 KB.

### Five structural defects

**1. Identity is vendor-owned and unstable. — FIXED (`a94479d`).**

| | Pokémon | One Piece |
|---|---|---|
| `id` was | `swsh12-186` (TCGdex) | `op_8121dd7dfaed…` — **103 bytes**, BerryWallet hash |
| Flipped when | TCGdex is down → apitcg's numeric id | BerryWallet re-indexes |

Two franchises, two unrelated vendor schemes, both used as the JSON route key
and both printed on the page as "Card ID", while `slug` — stable in both —
was treated as secondary.

`Card.id` is now `ref.slug` on every resolution path; upstream ids moved to
`Card.identifiers` as scheme-tagged cross-references (§3), and id-form URLs
still resolve as aliases. The defect reproduced while being fixed: apitcg was
rate-limited that day, so P-033 resolved to BerryWallet's hash where an
unthrottled build yields apitcg's numeric id — one card, two identities,
decided by which upstream happened to be reachable.

**2. Everything that is not the organization shares one type.**
`entitymap.json` holds 10 entities — 1 `Organization` and 9 `Concept` — with
predicates `COVERS`, `TRACKED_BY` and `PART_OF`. A franchise and a character
are both `Concept`, so the document cannot distinguish them.

Cards being absent from it is NOT a defect — that is the deferral decided in
§9, and the per-card files carry card-level edges instead. But the map was
missing **Monkey D. Luffy** entirely: `CHARACTER_ENTITIES` listed 6 characters
against 7 in `cardRefs`, and the unmapped case `continue`d silently, so he and
both of his cards vanished while the document still validated. Fixed, and the
silent path now warns.

**3. Frontmatter/body inversion.** Data lives in Markdown body tables;
frontmatter carries `title`, `description`, `tags`.

**4. No per-fact provenance or freshness.** One document fuses five upstreams
whose staleness differs by two orders of magnitude, under a single
`Last updated`. And `okf.ts:73` sets `stale_after = now + 7 days` against a
24-hour revalidate window — the only machine-readable freshness claim the
site makes, overstating by 7×.

**5. No controlled vocabulary.** `PSA 10`, `Raw`, `Manga`, `Wanted Poster`,
`Très bon état` are free strings. They are the product's dimensions.

---

## 2. Entity-relationship model

```
Franchise ──COVERS──> CardSet ──CONTAINS──> Card ──DEPICTS──> Character
                                             │
                        ┌────────────────────┼────────────────────┐
                   HAS_VARIANT           HAS_EDITION         SHARES_NUMBER
                        │                    │                    │
                  PrintVariant        LanguageEdition        CardNumber
                (Manga, Wanted        (en / ja — Pokémon     (OP09-004:
                 Poster, 2nd           has a DIFFERENT        one code,
                 Anniversary)          printed number)        many prints)

Card <──OBSERVES── MarketObservation ──AT──> GradeTier
                          │  │  └──IN──> Market
                          │  └─────SOURCED_FROM──> Source
                          └──EVIDENCED_BY──> Listing
```

Two modelling decisions carry the design:

**`MarketObservation` is separate from `Listing`.** The median and count are
*derived*; the rows are *evidence*. Today they are fused in
`conditions[].languages[].active.{medianPrice, rows}`, which is why
provenance can attach to neither. Splitting them is what lets the markdown
carry the answer and the JSON carry the proof.

**`CardNumber` is a node.** `OP09-004` is not a card — it is a code shared by
Manga, Parallel, Alternate Art and SP prints. Conflating the code with the
print is the root of every One Piece filtering bug documented in
`docs/ebay-market-pipeline.md`.

---

## 3. IRI scheme

Canonical identity never derives from an upstream.

| Class | IRI | Derived from | Why stable |
|---|---|---|---|
| Card | `card:lugia-v-186` | `ref.slug` | hand-authored, already the route and `generateStaticParams` key |
| Character | `character:lugia` | `ref.character` | hand-authored; entitymap already has `e_lugia` |
| CardSet | `set:swsh12`, `set:OP09` | `setCode` | a **published real-world code**, not a vendor id |
| Franchise | `franchise:pokemon` | literal | closed set of two |
| CardNumber | `number:OP09-004` | `ref.lookup.code` | printed on the card |
| Vocabulary term | `ct:PSA-10`, `ct:Manga` | authored | — |

Upstream ids demote to qualified identifiers and never become `@id`:

```yaml
identifier:
  - { scheme: [[TCGdex]], value: "swsh12-186" }
  - { scheme: [[apitcg]], value: "451834" }
sameAs:
  - "https://www.tcgplayer.com/product/451834"
```

`/api/{franchise}/{id}` keeps routing by both slug and upstream id — that is
a **lookup alias**, not an identity claim.

**Shipped shape.** `Card.identifiers` (lib/types.ts) carries
`{ scheme: "apitcg" | "tcgdex" | "berrywallet"; value: string }[]` and records
**every** upstream that answered, not only the one that would have won the old
identity race. The closed union is what TypeScript enforces; the compiler maps
`scheme` onto the `[[wiki-link]]` form above. Lookup matches the canonical id
or any identifier value, so every id ever handed out keeps resolving — it just
stops being the answer given back.

---

## 4. Vocabulary

| Group | Terms |
|---|---|
| Classes | TradingCard, Character, CardSet, Franchise, CardNumber, PrintVariant, LanguageEdition, GradeTier, Market, Source, MarketObservation, Listing |
| Grade tiers | PSA-10, PSA-9, PSA-8, Raw |
| Markets | Market-English, Market-Japanese, Market-France |
| Print variants | Manga, Wanted-Poster, Alternate-Art, Parallel, 2nd-Anniversary-Set, Event-Pack-Vol-2, Jumbo, SP-Gold |
| Sources | TCGdex, apitcg, BerryWallet, PokeWallet, eBay-Browse, Lobstr-Vinted, Illustrative |
| Provenance states | Real, Illustrative, **NoListings**, **SourceUnavailable** |
| Conditions | Tres-Bon-Etat |
| Typed properties | marketPrice (decimal + currency), median, count, printedNumber, depicts, memberOf, hasEdition, variantOf, sourcedFrom, asOf (`xsd:dateTime`), refreshBy |

Reconcile with the existing `COVERS` / `TRACKED_BY` / `PART_OF` predicates
rather than introducing a parallel set.

`NoListings` and `SourceUnavailable` as **types** is what makes the current
`| PSA 8 | English | USD 0 | Real |` bug unrepresentable rather than merely
fixed — an empty market is a real answer, and it is not a price of zero.

### Which nodes get files

| Node | Files? | Reasoning |
|---|---|---|
| **Card** | Yes | the subject |
| **Character** | Yes | already modelled, hand-curated, and the fan-out is real — `OP09-061` and `P-033` are two cards depicting one Luffy, a join nothing currently answers |
| **CardSet** | Yes, generated and minimal | `setCode` is a published code and the natural "what else is in this set" join. Thin today (1–2 cards per set) but **generated, not maintained** — the cost is one serializer, and it grows with the catalogue |
| GradeTier, Market, Source | No | resolve into the vocabulary document; a page per grade tier is inventory with no reader |

---

## 5. Provenance and freshness

| Fact | Source | Fetch cache | Real refresh | Worst case on screen |
|---|---|---|---|---|
| Pokémon identity, FR text | TCGdex | 24h | page 24h | ~48h |
| Pokémon JA identity + JP number | PokéWallet | 24h | page 24h | ~48h |
| One Piece identity (EN + JA) | BerryWallet | 24h | page 24h | ~48h |
| `currentPrice` | TCGdex / BerryWallet | 24h | page 24h | ~48h |
| History, trend, range, snapshots | apitcg | 24h | page 24h | **currently `[]`** |
| Active listings, median, count | eBay Browse | **1h** | page 24h | ~48h |
| ROI | derived from eBay | — | — | ~48h |
| Vinted rows | Lobstr | reads 6h | **scrape 2×/month** | **~17 days** |
| Sold listings, EUR/GBP/CAD, population | `illustrative.ts` | — | — | **never real** |

Three consequences:

1. **eBay's 1-hour cache is decorative.** The page regenerates every 24h, so
   the tightest window in the system is invisible to readers.
2. **Vinted and eBay differ by two orders of magnitude** — ~17 days versus
   hours — and ship under one `Last updated`. For a market intelligence
   product that is misinformation, not imprecision.
3. **`asOfDate` is neither timestamp anyone wants.** It is the *upstream's*
   pricing time (TCGPlayer's `updated_at`), not our fetch time and not our
   generation time.

---

## 6. Byte budget

Measured composition of the Pokémon JSON (8 tier×language cells, 24 rows):

| Component | Total | Per unit |
|---|---|---|
| `seeAllUrl` | 1,682 B | 236 B × 8 cells |
| row `url` | 2,528 B | 105 B (canonical form is 37 B) |
| row `description` | 1,723 B | 72 B |
| row date/price/`currency` | 1,660 B | 69 B |
| illustrative `sold` | 4,416 B | — |
| `vinted` | 1,802 B | — |
| identity + urls | 866 B | — |

Two-thirds of the row cost is waste rather than data: a row URL is
`…/itm/298590618631?_skw=Lugia+V+186%2F195+PSA+10&hash=item4585634407:g:0aYA…`
where `…/itm/298590618631` says the same thing in 37 bytes, and
`"currency":"USD"` repeats on all 24 rows.

**Dropping to 2 rows alone does not reach budget** — it gives ~8,142 B of
JSON, leaving under 2 KB for markdown. Four cuts together do:

| Cut | Saves |
|---|---|
| Drop illustrative `sold` | 4,416 |
| 4 rows → 2 | ~1,980 |
| Canonicalise item URLs | ~1,100 |
| Hoist `currency` to the observation | ~430 |
| `seeAllUrl` → template + params, or HTML-only | ~1,450 |

### The split

Carrying full listings in both faces pays for them twice.

| Face | Carries | Target |
|---|---|---|
| `index.md` | identity, edges, per-tier **observations** with provenance and asOf | ~2,500 B |
| JSON | the same graph **plus** 2 evidence rows per tier | ~5,900 B |

Combined **~8,400 B**. An agent needing only the number never fetches the
rows.

---

## 7. Shapes

### Card — `/products/{slug}/index.md`

```yaml
---
"@context": https://next-js-pokemon-alpha.vercel.app/ns/v1
"@id": card:lugia-v-186
"@type": [[TradingCard]]

identifier:
  - { scheme: [[TCGdex]], value: "swsh12-186" }
  - { scheme: [[apitcg]], value: "451834" }
sameAs: ["https://www.tcgplayer.com/product/451834"]

depicts: [[character:lugia]]
memberOf: [[set:swsh12]]
franchise: [[franchise:pokemon]]
printedNumber: "186/195"
rarity: [[Ultra-Rare]]
hasEdition:
  - { market: [[Market-Japanese]], printedNumber: "110/098", set: [[set:s12]], source: [[PokeWallet]] }

marketPrice:
  value: 524.60
  currency: USD
  source: [[TCGdex]]
  asOf: 2026-08-29T00:00:00Z

observations:
  - { tier: [[PSA-10]], market: [[Market-English]],  median: 1398, count: 62,  status: [[Real]], source: [[eBay-Browse]], asOf: 2026-08-30T17:16:00Z }
  - { tier: [[PSA-10]], market: [[Market-Japanese]], median: 1275, count: 35,  status: [[Real]], source: [[eBay-Browse]], asOf: 2026-08-30T17:16:00Z }
  - { tier: [[PSA-8]],  market: [[Market-English]],                 count: 0,  status: [[NoListings]], source: [[eBay-Browse]], asOf: 2026-08-30T17:16:00Z }
  - { tier: [[Raw]],    market: [[Market-France]],   median: 410,   count: 6,  status: [[Real]], source: [[Lobstr-Vinted]], condition: [[Tres-Bon-Etat]], asOf: 2026-08-14T03:00:00Z }

generated: 2026-08-30T17:16:00Z
refreshBy: 2026-08-31T17:16:00Z
---

# Lugia V — Silver Tempest (186/195)

Ultra Rare from Silver Tempest. Trades near USD 525 raw; PSA 10 copies list
around USD 1,400 in the English market and USD 1,275 in Japanese. The French
figure comes from a Vinted scrape that runs twice a month and is the oldest
number on this page.
```

Note what the shape makes impossible: a `PSA-8` row cannot claim a median,
because `NoListings` carries none. And the Vinted `asOf` is visibly two weeks
behind the eBay ones instead of hiding under a shared timestamp.

### Character — `/characters/{slug}/index.md`

```yaml
---
"@id": character:monkey-d-luffy
"@type": [[Character]]
name: "Monkey D. Luffy"
franchise: [[franchise:one-piece]]
depictedBy:
  - [[card:monkey-d-luffy-op09-061]]
  - [[card:monkey-d-luffy-p-033]]
generated: 2026-08-30T17:16:00Z
---
```

### CardSet — `/sets/{setCode}/index.md`

```yaml
---
"@id": set:OP09
"@type": [[CardSet]]
name: "Emperors in the New World"
setCode: "OP09"
franchise: [[franchise:one-piece]]
contains:
  - [[card:shanks-op09-004]]
  - [[card:marshall-d-teach-op09-093]]
  - [[card:monkey-d-luffy-op09-061]]
generated: 2026-08-30T17:16:00Z
---
```

---

## 8. Compiler architecture

`markdown.ts`, `okf.ts`, `toPublicCard` and `entitymap.ts` each hand-build
their own view today, so they can drift.

```
card-refs.ts + 5 upstreams
         │  (build, 24h — this is already the LLM Wiki compile step)
         ▼
   cardGraph(card)          one typed fact/edge set, provenance per fact
         │
    ┌────┼────┬─────────┬──────────┐
    ▼    ▼    ▼         ▼          ▼
   md   OKF  JSON   entitymap    MCP
```

Any field present in one face and absent from another must be a deliberate
projection decision, not an accident.

---

## 9. Decided / open

**Decided.** Slug-derived IRIs — **shipped** in `a94479d`; see §3 and defect 1. `Listing` survives at 2 rows per tier.
Illustrative `sold` dropped from the JSON. Files for Card, Character and
CardSet; vocabulary-only for GradeTier, Market and Source. Markdown carries
observations, JSON carries evidence.

**`entitymap.json` DEFERS to the per-card files — it does not absorb cards.**
Decided after building both. The map stays org + franchises + characters,
and reaches cards through the `sourceUrl` on a character's evidence chunks.

Absorbing was measured at **934 B per card entity, of which 381 B (41%) was
`hasChunks`** — a prose sentence restating a price the card's own page
already carries, now with per-fact provenance the chunk does not have. So the
duplicated copy was also the worse copy. Projected to 100 cards: ~97 KB
absorbed against ~7 KB deferring.

The distinction that settles it is what each document answers:

| Question | Answered by |
|---|---|
| "What is Lugia V worth?" | the card file — entitymap is irrelevant |
| "What do you track, and how does it relate?" | entitymap, in one fetch |

Absorbing bloated the second to badly duplicate the first. Deferring keeps
entitymap a small, stable index whose size tracks CHARACTERS, not cards.

Note this is not a general rule against duplication: `entitymap.ts` reads the
same `cardRefs` and `getCardBySlug` the pages do, so a duplicated fact would
be a projection, not a copy, and could not drift. It was rejected on size and
on the chunk being a degraded restatement, not on drift risk.

**Still open.** Whether `PrintVariant` and `CardNumber` get files or stay
terms — the least-evidenced part of the model.

**Explicitly out of scope.** Full RDF/Turtle roundtrip. It pays off with many
editors and an ontology lifecycle; there are nine curated cards and five APIs.
Stable IRIs, per-fact provenance, typed vocabulary and one compiler are what
make the data trustworthy and joinable. Turtle can come later, or never, at
no cost.

**Separate bug, diagnose before modelling around it.** `priceHistory` and
`recentSnapshots` are `[]` in production because apitcg was unreachable at
build.
