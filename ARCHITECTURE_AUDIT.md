# ARCHITECTURE_AUDIT.md

**Living architecture reference.** Started 2026-09-07. Every number here was
measured against the codebase on that date, not estimated. When a figure is a
guess it says so.

Companion documents: `docs/free-tier-catalogue.md` (the plan of record for the
free tier), `docs/pipeline-by-franchise.md` (what each data source does and does
not carry), `docs/ebay-market-pipeline.md` (the eBay query model).

**GCP constraints live outside this repository**, at
`Desktop/Claudy/md ressources/GCP-CONTEXT.md`. Read it before proposing any
cloud storage, cache or scheduling design; it will not show up in a grep of this
codebase. Its own header states it is reference rather than current state —
nothing in it is deployed, and where it disagrees with the code, the code wins.
The constraints that most often decide a design:

| | |
|---|---|
| Region | **`europe-west1` for everything** — same-region traffic is free, mixed regions are not |
| Cloud Storage free tier | **US regions only.** From Belgium, egress bills from the first byte — fine for JSON, **prohibitive for images**. Card images stay on Vercel |
| Vision AI | **1,000 units/month (~33/day)** per billing account. §4.8 of that doc says not to expose it publicly without a limit |
| BigQuery | 10 GiB + 1 TB queries/month. **Never `insertAll`** — streaming is billed; write NDJSON to GCS then batch-load |
| Cloud Scheduler | **3 jobs** |
| Billing | Quotas are per billing account, not per project. Budget alert at 1 EUR; there is **no automatic cutoff** |

Two of that document's highest-priority items — §4.2 catalogue mirror and §4.1
price history — were built here as files on disk instead, and cost nothing. See
§10 and §2.

---

# 1. Executive Summary

## What the system currently is

A **statically-rendered Next.js 16 site with no database, no users and no
authentication**, deployed on Vercel. It serves two card catalogues from JSON
files on disk, and fetches live market data from five metered APIs for **twelve
hand-listed cards**.

That sentence is the most important one in this document, because the brief that
produced the four architecture proposals describes a different system — one with
PostgreSQL, Firebase Auth, user collections, scan jobs and entitlements. None of
that exists. The proposals are answering a question about a system that has not
been built yet.

Verified, 2026-09-07:

| | |
|---|---|
| Database | **none** — no `pg`, `prisma`, `drizzle`, `firebase`, `supabase` in 27 dependencies |
| Authentication | **none** — no `next-auth`, `@clerk`, `firebase-auth` |
| Payments | **none** — no `stripe` |
| GCP | **none** — no `@google-cloud/*` package of any kind |
| "My Collection" | **`localStorage`**, per-browser, client-only, invisible to the server |
| Cards tracked with live market data | **12**, hand-listed in `src/data/card-refs.ts` |

## What is already good — KEEP THIS

1. **The free/paid boundary is enforced by the build, not by discipline.**
   `scripts/check-free-tier.mts` walks the import graph from all 57 routes to any
   module whose bucket has a ceiling in `lib/api-budget.ts`, and fails the build
   on an undeclared one. Current state: *57 routes, 28 free, 28 metered by
   decision, 1 import-only, 0 leaks*. **None of the four proposals contains this
   idea**, and it solves a real problem they all describe.
2. **Tier-1 loaders cannot reach a network.** `lib/catalog.ts`,
   `lib/one-piece-catalog.ts` and `lib/one-piece-official.ts` import `node:fs`
   and `node:path` and nothing else. A whole class of accidental spend is
   structurally impossible, not merely avoided.
3. **The identity/market split already exists** and matches all four proposals'
   central principle — arrived at independently, for cost reasons.
4. **Deterministic-first card matching**, which two of the four proposals
   recommend and two contradict. Already built and measured (§12).
5. **Provenance on catalogue crawls.** Every catalogue file carries `crawledAt`
   and `source`; the One Piece one carries `sourceCommit` — the exact upstream
   git SHA. That is real lineage.

## What is dangerous

1. ~~**Price history is destroyed on every deploy.**~~ **CORRECTED 2026-09-07,
   and fixed.** The original claim was wrong: git had been keeping every old
   snapshot as an ordinary file version, and `git show` reads any of them back.
   History was never destroyed — it was *accidental*, existing at whatever
   cadence someone happened to commit, in a form nobody could query. Now
   recorded deliberately (`lib/price-history.ts`) and backfilled from git.
   See §10 for what that turned out to be worth.
2. **The canonical identity IS a provider ID.** A Pokémon card's primary key is
   its TCGdex id (`sv08-001`). Every one of the four proposals independently
   names this as the mistake to avoid, and they are right.
3. **One Piece has two identity spaces that are provably unjoinable.** Bandai's
   `OP05-119_p2` and BerryWallet's opaque hash both exist; 94.7% of Bandai's
   multi-printing groups are identical in every field but id and image. Measured:
   0 of 9 tracked cards were identifiable from (code + pack + treatment).
4. **Neither game has a print-level identity** — only card-level. A collection
   holds printings, and a reverse holo is a median **3.36×** its normal twin.

## What is missing

Canonical IDs, a print entity, price observations (as opposed to snapshots), any
user concept, any entitlement concept, raw payload preservation.

## What must NOT change

The 12 hand-resolved cards in `card-refs.ts`, the eBay query model in
`lib/one-piece-variants.ts`, and the vocabulary tables in `data/one-piece-sets.ts`.
Weeks of measurement went into these against live marketplaces, and no proposal
here touches them.

## What can wait

Everything in all four proposals' GCP stacks. There are no users. Firestore,
BigQuery, Bigtable, Pub/Sub, Cloud Run, Memorystore, API Gateway and Vertex AI
Vector Search would together cost real money per month to serve approximately ten
friends, and would replace a system whose entire hosting cost is currently a
Vercel plan.

```
ARCHITECTURE STATUS: YELLOW
```

**Why not GREEN:** the identity model uses provider IDs as primary keys, and
neither game has a print-level entity — which is the unit a collection actually
holds.

**Why not RED:** nothing is leaking, because there is nothing to leak — no
premium data and no users exist. Every remaining item is cheap to fix *now*
precisely because there are no users, no foreign keys and no migrations. RED
would mean the system is actively harming itself in a way that is expensive to
undo, and after the price-history correction (§10) nothing here is.

**What would move this to GREEN:** canonical print identity plus a provider
mapping table. That is the whole gap, and it is roughly a day's work today
against a migration with downtime once people have collections.

---

# 2. Current System

| Component | Purpose | Technology | Status |
|---|---|---|---|
| Web app | Everything user-facing | Next.js 16.3.1 App Router, React 19, Tailwind 4 | Working, 395 static pages in ~3s |
| Hosting | Deployment | Vercel (`next-js-pokemon`) | Working |
| Pokémon catalogue | Card identity | JSON on disk, `data/catalog/pokemon/` | 203 sets, 21,066 cards |
| One Piece official | Card identity + images | JSON on disk, `data/catalog/one-piece-official/` | 60 packs, 4,844 EN printings; 12,720 across 3 languages |
| One Piece corpus | Treatments + marketplace URLs | JSON on disk, `data/catalog/one-piece/` | 109 sets, 10,689 rows, 2,632 codes |
| Price snapshot | Cheap prices for catalogue pages | JSON on disk, regenerated at build | 20,452 + 10,505 rows |
| Market pipeline | Live prices for tracked cards | 5 metered HTTP APIs | 12 cards |
| Budget ledger | Quota accounting | `lib/api-budget.ts`, file-backed | Working, over-counts (§16) |
| Free-tier gate | Build-time authorization | `scripts/check-free-tier.mts` | Working |
| Image proxy (OP) | Unmetered Bandai images | Next route + `sharp` | Working, 5.1× reduction |
| Scan | Card code from a photo | `tesseract.js`, client-side | Working, unverified on a real phone |
| Collection | "My cards" | **`localStorage`** | Per-browser, not a server concept |
| Database | — | **does not exist** | — |
| Auth | — | **does not exist** | — |
| Entitlements | — | **does not exist** | — |

## Metered upstreams

| Bucket | Ceiling |
|---|---|
| `api.apitcg.com` | 900/month, burst 200/day |
| `api.pokewallet.io#berrywallet` | 90/hour |
| `api.pokewallet.io#pokewallet` | 60/hour |
| `api.ebay.com` | 1200/day |
| `cardmarket-api-tcg.p.rapidapi.com` | 80/day, burst 24/min |

`api.tcgdex.net` and `onepiece-cardgame.com` have **no ceiling** — which is the
entire reason the free catalogue could be built at all.

---

# 3. Actual Data Flow

## Card identity — works, and is genuinely free

```
TCGdex API  ──(scripts/catalog-crawl.mts, manual)──>  data/catalog/pokemon/*.json
punk-records (GitHub) ──(one-piece-official-crawl.mts, manual)──> data/catalog/one-piece-official/*.json
BerryWallet ──(one-piece-crawl.mts, manual)──> data/catalog/one-piece/*.json
                                     │
                                     ▼
                        committed to git, deployed
                                     │
                                     ▼
                   tier-1 loaders (node:fs only, 0 requests)
                                     │
                                     ▼
                    /sets  /cards  /card/[tcg]/[code]  /lookup
```

**No normalization stage, no validation stage, no identity-resolution stage.**
The crawler writes a shape close to the provider's own and the loaders read it.

## Prices — this is the broken one

```
TCGdex API ──(scripts/price-refresh.mts, runs in `prebuild`)──> data/prices/pokemon.json
                                     │
                              REPLACES the file
                                     │
                        previous contents DESTROYED
```

## Market data (metered) — works

```
/products/[slug] for one of 12 refs
        │
        ├─> apitcg      (price history)
        ├─> PokeWallet  (JP/FR prints)
        ├─> BerryWallet (One Piece identity + EU)
        └─> eBay Browse (8 searches/card: 4 conditions x 2 languages)
                          │
                    buildCached  ── caches FAILURES as results (§16)
```

## Scan — works, client-side only

```
Camera/file ─> tesseract.js (browser) ─> extractCardCodes() ─> /lookup?q=CODE
```

**No scan record is stored. NEEDS INVESTIGATION** before any recognition
improvement is attempted — there is no corrections dataset and no way to build
one today.

## Collection

```
Browser ─> localStorage["..."] ─> nothing
```

---

# 4. Current Database Model

**There is no database.** The closest equivalents:

| Entity | Where it lives | Primary key | Problem |
|---|---|---|---|
| Pokémon card | `data/catalog/pokemon/{setId}.json` | `tcgdexId` | **A provider ID** |
| Pokémon variant | array on the card | *none* | Not addressable; 4 Base Set Charizard `holo` variants collapse to one |
| One Piece printing | `data/catalog/one-piece-official/{lang}__{packId}.json` | `id` (`OP05-119_p2`) | **A provider ID** |
| One Piece corpus row | `data/catalog/one-piece/*.json` | BerryWallet hash | **A second provider ID**, unjoinable to the first |
| Price | `data/prices/{game}.json` | card id | One row per card; overwritten |
| Tracked card | `src/data/card-refs.ts` | `slug` | Hand-written; a commit, not a row |
| Collection item | `localStorage` | card id string | No quantity, condition, variant or user |
| Set / pack | inside catalogue files | provider set id | — |
| User, scan, entitlement | — | — | **Do not exist** |

**Do we have a canonical card identity? No.** We have provider identities used
directly as primary keys.

---

# 5. Canonical Card Identity Audit

```
IDENTITY HEALTH: RED
```

RED, not YELLOW, because of the One Piece half. Detail:

| Question | Pokémon | One Piece |
|---|---|---|
| What identifies a card? | `tcgdexId`, e.g. `sv08-001` | Bandai `OP05-119`, or a BerryWallet hash |
| Internal or provider-dependent? | **Provider** | **Provider, and two of them** |
| Provider ID as primary identity? | **Yes** | **Yes** |
| Variants represented? | `type` string only (`normal`/`reverse`/`holo`) | Not at all in Bandai; text in BerryWallet |
| Languages? | Only English crawled | 3 crawled, keyed per file |
| Printings? | **Not addressable** | Addressable, unlabelled |
| Reprints? | Not distinguished | Distinguished by pack |
| Alternate arts? | n/a | By image only |
| Foil / reverse-holo? | `type` string | Not recorded |
| Multiple providers → one card? | **No mapping table exists** | **No, and proven hard** |
| Can a provider change without destroying identity? | **No** | **No** |

## The two concrete failures

**Base Set Charizard** holds four `holo` variants pointing at two different
Cardmarket products (273699 and 660224 — 1st Edition against Unlimited). They are
real, separately-priced printings. TCGdex types all four identically and
`variantId` is a taxonomy key reused across cards, so nothing in our data can
name which is which. They currently render as one.

**OP05-119** exists as nine Bandai printings across four packs, and separately as
several BerryWallet rows carrying the treatments (`Alternate Art`, `Manga`) and
the marketplace URLs. The join between them is **unproven**. Measured across
Bandai's catalogue: 945 (pack, code) groups hold more than one printing; **895 of
them (94.7%) are identical in every field but the id and the image**; `name`
differs in **0**.

## What should change

A canonical identity, owned by us, at **print** level — not card level:

```
card_id    = {game}:{set}:{number}          the artwork
print_id   = {card_id}:{printKey}:{lang}    the collectible
```

`printKey` is `normal`/`reverse`/`holofoil`/`1st-edition` for Pokémon and the
Bandai printing suffix (`p2`, `r1`) for One Piece. Provider IDs move into a
mapping table keyed by `(provider, external_id) -> print_id`.

**Why now:** it is a rename of ~24k rows with no users, no foreign keys and no
migrations. **Why not later:** every collection row, scan record and price
observation will point at it. **Cost of doing it now:** roughly a day.
**Cost in a year with users:** a migration with downtime and a correctness risk
on people's collections.

---

# 6. Data Classification Audit

| | Currently |
|---|---|
| Public | Card identity, set data, images, snapshot prices, all catalogue pages |
| Premium | **Nothing.** No premium tier exists |
| Internal | API keys in Vercel env; the budget ledger |
| Accidental leaks | **None found**, because there is no premium data to leak |
| Premium images public? | n/a — all images are currently public |
| Can clients bypass the frontend? | **Yes, trivially** — but there is nothing gated to bypass |
| Where is authorization enforced? | **Build time, not request time** |

That last row is the subtle and important one. `check-free-tier.mts` guarantees
*a free route cannot spend metered quota*. It does **not** guarantee *a user
cannot read premium data* — it cannot, because there is no user.

**This is a cost boundary, not a security boundary, and it should not be mistaken
for one.** It is genuinely good at what it does and all four proposals lack it.
It is not a substitute for the entitlement layer they describe.

The brief states "Paid users can access the full image." Today `/api/one-piece-image`
serves any printing at any allowed width to anyone. **DESIGN FOR THIS, IMPLEMENT
LATER** — the route already resolves through a lookup, which is where an
entitlement check would sit.

---

# 7. Entitlement / Authorization Architecture

**None exists.** There is no user, session, token or role anywhere in the
codebase.

All four proposals converge on capability-based entitlements
(`market.read`, `image.full`, `scan.create`, …) rather than `user.isPremium`, and
they are right — that is the standard answer and it is cheap to adopt.

**What to implement now: the shape, not the system.** One function:

```ts
// lib/entitlement.ts
export type Capability = "market.read" | "image.full" | "scan.create" | "collection.write";
export function can(principal: Principal, capability: Capability): boolean;
```

Today it returns `true` for everything except the metered set, and the twelve
`card-refs.ts` entries are the allowlist. It costs an afternoon, and it means
every future call site is already written correctly.

**DO NOT BUILD YET:** Firebase Auth, custom claims, API keys, scopes, rate
limiting, JWTs, an API gateway. All of it presumes users. Build it when the first
person other than you has a password.

---

# 8. Data Pipeline Audit

| Pipeline | Idempotent | Retryable | Observable | Versioned | Reproducible |
|---|---|---|---|---|---|
| Pokémon catalogue crawl | Yes (file replace) | Manual | Partly | `crawledAt`, `source` | **No** — raw payload discarded |
| One Piece official crawl | Yes | Yes (resumable) | Yes | **`sourceCommit`** | **Yes** — upstream is a pinned git SHA |
| One Piece corpus crawl | Yes | Yes | Partly | `crawledAt` | No |
| Price refresh | Yes | Manual | No | `generatedAt` only | **No — destroys the prior state** |
| Market fetch (metered) | No | Partly | Budget report only | No | No |

**Can we rebuild derived data from raw source data? Mostly no.** The crawlers
write normalized shapes; the provider's original response is discarded. The One
Piece official crawl is the exception and the model to copy: because it records
`sourceCommit`, the exact upstream state is re-fetchable forever.

**RAW → NORMALIZED → CANONICAL → DERIVED**: we have NORMALIZED and DERIVED. RAW
is not kept. CANONICAL does not exist (§5).

---

# 9. Raw Data Preservation

| Question | Answerable today? |
|---|---|
| Where did this card come from? | **Yes** — `source` per file |
| When did we ingest it? | **Yes** — `crawledAt` |
| Which provider supplied it? | **Yes** |
| What did the provider originally return? | **No, except One Piece official** |
| Which transformation modified it? | **No** — no normalizer version recorded |
| Which resolver version processed it? | **No** |

**Consequence:** if a normalization bug is found, it cannot be corrected by
reprocessing — only by re-crawling, which for BerryWallet costs metered quota at
90/hour against 10,689 rows.

**Recommendation (P1, not P0):** write the untouched provider response beside the
normalized file. At this size it is megabytes on disk, not an infrastructure
project. It does **not** require Cloud Storage.

---

# 10. Price Data Architecture

**Rewritten 2026-09-07 after the original section's premise failed inspection.**

## What was actually true

`data/prices/*.json` is one row per card with a single `generatedAt`, replaced by
`prebuild` on every run. That much was right, and it is genuinely a
*current-state* model pretending to be a series.

What was **wrong** was the conclusion. Git had been versioning the file all
along: twelve commits carry it, and every one is a readable dated snapshot. The
data was never lost. It was *accidental* — captured at commit cadence rather than
observation cadence, and unqueryable without checking out twelve blobs.

Checking that before writing "unrecoverable" would have cost one `git log`.

## What was built instead

`src/lib/price-history.ts` writes an append-only observation beside the snapshot,
and `scripts/price-history-backfill.mts` reconstructs the past from git.

| | |
|---|---|
| Per-day file | `data/prices/history/{game}-YYYY-MM-DD.json.gz` |
| Granularity | **per printing**, not per card — a reverse holo is a median 3.36× its normal twin |
| Size | 20,443 printings → **180 KB gzipped** |
| Cost | ~64 MB/year for Pokémon at a daily cadence |
| Recovered from git | 2 distinct Pokémon observation days, 1 One Piece |

Only **two** distinct Pokémon days exist, not the twelve the commit count
suggests: three commits dated 09-06 all carried a snapshot generated on the 5th.
Observations are dated by when the prices were *read*, never by when they were
committed — anything else claims prices were seen on a day nobody looked.

**Why git and not a database:** not recording is irreversible; recording is
reversible. The files are independent, so they can be pruned, thinned to weekly,
or imported into Postgres later without touching anything that reads them.
Revisit at ~500 MB or when a database arrives.

**The snapshot itself was trimmed too, 2026-09-07.** It carried every field each
source published — 20 numbers per card — and an audit of every page, component
and route found exactly **two** were ever read: `cardmarket.avg` and
`tcgplayer.market`. The other eighteen were written, committed and deployed
without ever being looked at. Now 4 numbers per card, **5.9 MB → 2.4 MB (-59%)**,
which compounds because 97% of rows change per refresh so the file
delta-compresses badly and every price commit carried the full weight. Safe
because TCGdex is unmetered: widening it again costs one 40-second re-run,
unlike the history, where a gap can never be refilled.

**What it does not promise:** `prebuild` also runs on Vercel, where the
filesystem is discarded. An observation is recorded when the refresh runs
somewhere its output is committed — in practice a local build. This makes the
observation explicit and dated; it does not make it daily. A guaranteed cadence
needs a scheduled job, deliberately not built.

## What it should be

```
price_observations                      append-only
  observed_at, print_id, marketplace, condition,
  language, currency, price, source, ingestion_run_id
```

plus a derived `market_current` for page loads. That is exactly what three of the
four proposals describe, and they are right — but **not the infrastructure they
attach to it.**

## Is PostgreSQL sufficient? Yes, comfortably. Is BigQuery needed? No.

The ChatGPT document computes 55,000 cards × 10 marketplaces × hourly = 4.8
billion rows/year, and concludes BigQuery. That arithmetic is correct and the
premise is not ours:

| | Their model | Ours |
|---|---|---|
| Cards observed | 55,000 | **12** |
| Marketplaces | 10 | 3 |
| Frequency | hourly | per deploy |
| Rows/year | 4.8 billion | **~40,000** |

We do not observe 55,000 cards because **we cannot afford to** — apitcg is
900/month. The budget ceiling is the real constraint, and it caps observation
volume far below anything PostgreSQL would notice. Even snapshotting all 20,452
free TCGdex prices daily is 7.5M rows/year, which a single Postgres table with a
`(print_id, observed_at)` index handles without complaint for years.

**BigQuery trigger, stated explicitly:** when a single analytical query over
price history exceeds ~2s on Postgres, *or* the observations table passes ~500M
rows. Neither is on the horizon. **DESIGN FOR THIS, IMPLEMENT LATER.**

**What to do this week (P0):** stop destroying history. Append each refresh to a
dated file — `data/prices/history/pokemon-YYYY-MM-DD.json` — instead of replacing
one file. That is a change to one script, costs nothing, needs no database, and
every day it is delayed is a day of history that cannot be recovered.

---

# 11. Scaling Analysis

| Dimension | Current | Real risk | When it bites | Do now | Postpone |
|---|---|---|---|---|---|
| **Database** | 0 rows | None | Not visible | — | Everything |
| **Catalogue** | 25,910 identities | None. This is small | 1M+ cards | — | Sharding, search infra |
| **Storage** | ~11 MB catalogues | None | GBs of scan images | — | Cloud Storage |
| **Compute** | Static + on-demand ISR | None | — | — | Cloud Run, K8s |
| **Pipeline** | Manual crawls | Low | More games/languages | Document the runbook | Pub/Sub, Dataflow |
| **API quota** | **The actual bottleneck** | **High, today** | Already binding | Keep the build gate | — |
| **Analytics** | None | Low | 500M observations | Append-only history | BigQuery |
| **Scan** | Client-side, free | None (costs us nothing) | — | **Store scan records** | Vertex AI, vector search |
| **Users** | Zero | — | First real user | Entitlement shape | Auth, billing |

**The bottleneck is not scale. It is quota.** 90 BerryWallet calls/hour and 900
apitcg calls/month are what actually constrain this product. Every proposal here
optimizes for a scale dimension that is not binding, and none addresses the one
that is.

---

# 12. Scanner Architecture

## What exists

Camera or file → `tesseract.js` in the browser → `extractCardCodes()` →
`/lookup?q=CODE` → candidate cards → the person picks the printing.

Verified with the real engine against rendered card corners: `OP05-119`, `P-033`,
`190/182` and `4/102` all extracted and resolved. OCR confusion is repaired
positionally (`0`→`O` in letter slots, `O`→`0` in digit slots), so `0P05-119`,
`OPO5—1I9` and `19O/1B2` all recover.

## What is missing

**Scan records.** Nothing is stored — no image, OCR text, candidate list,
selection or confidence. Three proposals call this out and they are right. It is
not needed for the scan to work; it is needed for the scan to ever *improve*.

## Where Cloud Vision fits: it does not, yet

GCP Vision's free tier is 1,000 units/month ≈ 33 scans/day across all users.
Client-side Tesseract costs zero and scales with users. Vision becomes
interesting only if measured client OCR accuracy proves unacceptable.

## Is a dedicated visual model necessary? No — and for Pokémon it cannot work

Both Google documents recommend Vertex AI Vector Search on card image embeddings,
one claiming a match in "<10ms" and calling OCR *proscrit* (forbidden).

**This is measurably wrong for the larger half of our catalogue.** Of 10,110
multi-variant Pokémon cards, **0 have a distinct image per variant** — a reverse
holo is the same artwork with a different foil pattern. Two independent free
catalogues confirm it, and per-variant asset paths 404. So the embedding of a
normal Charizard and its reverse holo is **the same vector**. Vector search
cannot separate the one distinction that determines price — a median 3.36×, p90
10.7×.

Vector search would help One Piece, where all 945 multi-printing groups do differ
by image. It cannot help Pokémon. Recommending it as *the* recognition strategy
misreads the domain.

**Confidence policy** — adopt the shape the proposals give, with our own
thresholds set from real data once scan records exist. Today the code is
deliberately binary: exactly one candidate auto-navigates, anything else asks.
That is the honest version when you have no data to calibrate with.

---

# 13. AI-Agent Architecture

Better than expected. Already present: `/api/mcp` (a real MCP server),
`/.well-known/mcp-server.json`, `/.well-known/ai-catalog.json`, `llms.txt`, an
`/okf/*` machine-readable mirror, and `.md` twins of major pages.

| Property | State |
|---|---|
| Stable IDs | **Provider IDs** — works, but §5 |
| Structured JSON | Yes |
| Predictable resources | Partly — `/api/pokemon`, `/api/one-piece` are game-split, not resource-split |
| Consistent errors | **Not audited. NEEDS INVESTIGATION** |
| Pagination / filtering | Partly, on `/cards` only |
| Capability auth | **None** |
| Versioning | **None — no `/v1` prefix anywhere** |
| Discoverability | **Yes, unusually good** |

**Do now (cheap, expensive later):** add `/v1`. Renaming a public API that agents
have already discovered is a breaking change; adding the prefix before anyone
depends on it costs nothing. This is the single highest ratio of
future-pain-avoided to work-required in this document.

**Later:** scopes, rate limits, API keys — all presume users.

---

# 14. API Contract Audit

31 route handlers. Grouped rather than listed one by one:

| Group | Auth | Data class | Problems |
|---|---|---|---|
| `/api/pokemon`, `/api/one-piece` (+`/[id]`) | none | public + market | Metered by decision; no versioning |
| `/api/one-piece-image/[printingId]` | none | public | Would need the entitlement hook for "full image" |
| `/api/berrywallet-image`, `/api/pokewallet-image` | none | public | **Charge metered quota per image** |
| `/api/price-check`, `/api/price-alerts` | none | market | Unauthenticated metered endpoints — **abuse surface** |
| `/api/mcp` | none | mixed | Agent entry point, unversioned |
| `/api/vinted/publish`, `/refresh` | **NEEDS INVESTIGATION** | writes? | The only write-shaped routes; audit before any launch |
| `/okf/*`, `.md`, `.well-known/*` | none | public | Fine |

**Two things worth acting on:** `/api/price-check` is an unauthenticated route
that spends eBay quota — a stranger can drain 1200 searches/day. And
`/api/vinted/publish` is the only endpoint whose name implies an outbound side
effect; it should be audited before this is public.

---

# 15. Image Architecture

| | State |
|---|---|
| Pokémon images | TCGdex CDN, public, pre-sized tiers, unmetered |
| One Piece images | Bandai via our proxy, resized with `sharp` to webp |
| Thumbnails | Yes — 3 widths, 5.1× smaller at the grid size |
| Premium images | **Do not exist** |
| Storage | **None** — nothing is stored; everything is proxied or hot-linked |
| CDN | Vercel |
| Signed URLs | None |
| Deduplication / hashes | **None** |
| **Can premium images be accessed without authorization?** | **There are none. Every image is public.** |

The brief says full-resolution images are a paid feature. Today `?w=` omitted
returns Bandai's original bytes to anyone. The place to enforce that is the route
that already exists — not a new bucket, not signed URLs, not yet.

**One risk no proposal but Perplexity raises, and it is the real one: licensing.**
We proxy and re-encode Bandai's and TCGdex's images. Whether we may cache, resize
and serve them — let alone behind a paywall — is a licensing question, not a
technical one. **STOP AND CHECK THIS before charging money for images.** No
architecture fixes a rights problem.

---

# 16. Observability

| Question | Answerable? |
|---|---|
| What failed? | Partly — build logs |
| Where? | Partly |
| When? | No |
| Which card? | Sometimes — some failures name the card |
| Which provider? | Yes — budget report is per bucket |
| Which pipeline version? | **No** |
| How many cards failed? | **No** |
| How many scans failed? | **No — scans are not recorded** |

**Two known defects, both already documented and both worth fixing before any new
infrastructure:**

1. **`buildCached` caches PARTIALLY degraded results as successes.** The
   original claim here — that it caches failures outright — was overstated and is
   corrected. Outright failures are handled: `resolveCardSafe` marks the offline
   placeholder negative, and `getGradedMarketData` marks a result negative when
   `allIllustrative` holds. The gap is narrower: `allIllustrative` requires
   **every** tier to have failed, so a budget ceiling tripping partway through a
   card's 8 eBay searches leaves some tiers real and some empty, `every()`
   returns false, and that half-broken result takes the full 24h TTL. Still worth
   fixing; not the emergency first described.
2. **The budget ledger over-counts** — it charges at attempt time, so
   Data-Cache-served requests still count. It reports pessimistically, which is
   the safe direction, but it means the numbers are not exact.

**Minimum useful observability now:** a per-run ingestion log (`run_id`,
`started_at`, `source`, `rows_in`, `rows_out`, `errors`) written beside the data.
A JSON file. Not Cloud Monitoring.

---

# 17. Security Audit

| Area | State |
|---|---|
| Authentication | **None** |
| Authorization | **Build-time cost gate only** (§6) |
| Premium data leakage | No premium data exists |
| API keys (ours) | Vercel env vars — appropriate |
| Provider credentials | Server-side only; image proxies exist because a browser cannot send them — **correct** |
| Rate limiting | **None** |
| Abuse prevention | **None** — `/api/price-check` can drain eBay quota |
| User data isolation | No user data |
| Scan image privacy | **Best-in-class by accident**: images never leave the device |

**The most exposed thing today is not data — it is quota.** Unauthenticated
metered endpoints are the one live security-shaped issue, and the mitigation is a
rate limit or an entitlement check on three routes.

---

# 18. Architecture Decisions

### ADR-001: Canonical print identity, owned by us
**Status:** Proposed · **Date:** 2026-09-07
**Context:** Primary keys are provider IDs (`sv08-001`, `OP05-119_p2`). One Piece
has two unjoinable provider spaces. Neither game addresses printings.
**Options:** (a) keep provider IDs; (b) internal UUID; (c) deterministic
`{game}:{set}:{number}:{printKey}:{lang}`.
**Decision:** (c), with a `(provider, external_id) -> print_id` mapping table.
Deterministic keys stay debuggable and diffable in git, which matters while the
"database" is JSON files.
**Consequences:** one rename now; every future row points at something we own.
**Revisit when:** a provider needs two different prints to share a key.

### ADR-002: No database yet
**Status:** Accepted · **Date:** 2026-09-07
**Context:** All four proposals assume Postgres or Firestore. We have 25,910
read-only identities, zero users, and a build that prerenders 395 pages in 3s.
**Decision:** Keep JSON on disk. Adopt Postgres when the first *write* from a
real user must survive a deploy.
**Why:** files in git give us versioning, diffing, review and rollback for free —
properties a database would have to re-earn. The catalogue is read-only and
changes only when we re-crawl, which is a commit.
**Revisit when:** user collections must persist server-side. That is the trigger,
and it is a product decision, not a scale one.

### ADR-003: Append-only price observations
**Status:** **Accepted, implemented** · **Date:** 2026-09-07
**Context:** `prebuild` replaces `data/prices/*.json`. Originally filed as
"history is destroyed and unrecoverable"; measurement showed git had been
versioning the file all along, so the real problem was that history was
*accidental and unqueryable*, not absent.
**Decision:** Write a compact per-printing observation per day
(`data/prices/history/`), gzipped, in git. Backfill the past from git. Move to a
table with `observed_at` when Postgres arrives.
**Why git:** not recording is irreversible; recording is reversible, and daily
files are independently prunable. 180 KB/day.
**Consequences:** ~64 MB/year; the series spans two snapshot formats, normalised
in `compactRow`.
**Revisit when:** ~500 MB, or a real database.

### ADR-004: Build-time free/paid enforcement
**Status:** Accepted, keep · **Date:** 2026-09-05
**Decision:** Keep `check-free-tier.mts` as the cost boundary. It is not an
authorization boundary and must not be described as one.

### ADR-005: Client-side OCR
**Status:** Accepted · **Date:** 2026-09-07
**Decision:** Tesseract in the browser, not Cloud Vision.
**Why:** Vision's free tier is ~33 scans/day across all users. Client OCR costs
zero and scales with users. Scan images never leave the device, which is also the
strongest privacy position available.
**Revisit when:** measured client accuracy is unacceptable — which requires scan
records to measure (§12).

### ADR-006: No vector search for recognition
**Status:** Accepted · **Date:** 2026-09-07
**Decision:** Reject Vertex AI Vector Search as the recognition strategy.
**Why:** 0 of 10,110 multi-variant Pokémon cards have a per-variant image. The
embeddings of a normal and a reverse holo are identical vectors. It cannot
resolve the distinction that sets price.
**Revisit when:** One Piece-only recognition becomes a priority, where it would
genuinely help.

---

# 19. Keep / Refactor / Replace / Defer

| Component | Recommendation | Reason | Priority |
|---|---|---|---|
| `check-free-tier.mts` | **KEEP** | Best idea in the codebase; absent from all four proposals | — |
| Tier-1 loaders | **KEEP** | Structurally cannot spend quota | — |
| eBay query model | **KEEP** | Weeks of live measurement | — |
| `card-refs.ts` (12 cards) | **KEEP** | Becomes the entitlement seed | — |
| One Piece official crawl | **KEEP** | `sourceCommit` lineage is the model to copy | — |
| Card identity keys | **REFACTOR** | Provider IDs as primary identity | **P0** |
| Print-level entity | **ADD** | Collections hold printings, not cards | **P0** |
| Price snapshot | **REFACTOR** | Destroys history every deploy | **P0** |
| Unauthenticated metered routes | **REFACTOR** | Quota abuse surface | **P1** |
| API versioning | **ADD** | `/v1` free now, breaking later | **P1** |
| Entitlement function | **ADD** | Shape only, not the system | **P1** |
| Scan records | **ADD** | No corrections dataset exists | **P1** |
| Raw payload archive | **ADD** | Cannot reprocess | **P1** |
| `buildCached` failure caching | **REFACTOR** | Freezes empty markets for a day | **P1** |
| `localStorage` collection | **REPLACE** | When users exist, not before | **P2** |
| Database | **DEFER** | No writes to persist | **P2** |
| Image licensing | **INVESTIGATE** | Blocks charging for images | **P1** |
| `/api/vinted/publish` | **INVESTIGATE** | Only outbound-side-effect route | **P1** |
| Firestore / BigQuery / Bigtable / Pub/Sub / Cloud Run / Memorystore / API Gateway / Vertex AI | **DEFER** | No users, no volume, no trigger met | **P3** |

---

# 20. Priorities

## P0 — expensive or impossible to fix later

1. ~~Append-only price history~~ — **DONE 2026-09-07.** Smaller than billed once
   measured (§10), but the series is now explicit, dated, per-printing, and
   backfilled from git.
2. **Canonical print identity + provider mapping table.** ~24k rows, no users, no
   migration. A day now; a migration with downtime later. **Now the top item.**
3. **Print-level entity.** Same change, same reason.

## P1 — soon

4. `/v1` on the API. 5. Entitlement *function* (not system). 6. Scan records.
7. Raw payload archive. 8. Rate-limit the metered public routes. 9. Fix
`buildCached` failure caching. 10. Resolve image licensing. 11. Audit
`/api/vinted/publish`.

## P2 — when the product grows

Postgres (trigger: first persisted user write). Server-side collections. Search
infrastructure (trigger: in-memory filtering exceeds ~200ms).

## P3 — not now

Everything else in the four proposals.

---

# 21. Do Not Build Yet

| Technology | Why it is tempting | Why we do not need it | What would justify it |
|---|---|---|---|
| **Firestore** | 3 of 4 docs recommend it | No user data to store; catalogue is read-only and better in git | First persisted user write |
| **BigQuery** | "Prices are time-series" | ~40k observations/year, not 4.8B | >500M rows, or a query >2s on Postgres |
| **Bigtable** | One doc recommends it for prices | Wildly beyond our volume | Never, at any plausible scale |
| **Pub/Sub** | All 4 recommend it | Three crawlers we run by hand. A queue with no producers | Ingestion exceeds one machine, or stages need independent retry |
| **Cloud Run** | All 4 recommend it | Vercel already serves this | Leaving Vercel, or long-running workloads |
| **Vertex AI Vector Search** | 2 docs call it essential | **Cannot work for Pokémon** — 0/10,110 variants have distinct images | One-Piece-only recognition, with measured OCR failure rates |
| **Cloud Vision** | Standard OCR answer | 1,000/month ≈ 33 scans/day; client OCR is free and private | Measured client OCR accuracy proving unacceptable |
| **Memorystore / Redis** | Caching, rate limiting | No traffic. Vercel CDN + Data Cache suffice | Sustained traffic where CDN caching is insufficient |
| **API Gateway** | Auth, rate limits | No auth to gate | Real API customers |
| **Kubernetes / Spanner / microservices** | Scale-readiness | 25,910 read-only rows | Nothing foreseeable |

---

# 22. Migration Plan

Each step leaves a working system.

**Step 1 — Stop losing prices.** `price-refresh.mts` appends
`data/prices/history/{game}-YYYY-MM-DD.json` and *also* writes the current
snapshot the pages already read. Nothing downstream changes. *One file.*

**Step 2 — Introduce `print_id` alongside existing IDs.** `lib/card-view.ts`
already normalises both games into a `CardPrint` shape; give it a deterministic
`print_id` and keep the provider id as a field. Nothing breaks; both work.

**Step 3 — Provider mapping table.** `data/identity/mappings.json`:
`(provider, external_id) -> print_id`. Generated by the crawlers. This is where
the One Piece BerryWallet↔Bandai join lives *when* it is proven — one row per
resolved pair, human-confirmed at first, exactly as `card-refs.ts` is today.

**Step 4 — Move consumers onto `print_id`.** Pages, lookup, scan, collection.
Provider IDs become mapping inputs only.

**Step 5 — Entitlement function.** `can(principal, capability)`, returning `true`
for free capabilities and checking `card-refs.ts` for metered ones. No users yet.

**Step 6 — `/v1` prefix**, old paths redirecting.

**Step 7 — Scan records.** `localStorage` first; server-side when users exist.

**Step 8 — Postgres.** Only when a real user's write must survive a deploy. The
schema is already implied by steps 2–4, so this becomes an import, not a redesign.

**Step 9 — Everything else, on its stated trigger.**

Steps 1–3 are the ones that stop the bleeding. Steps 4–9 can follow at any pace.

---

# 23. Where the four proposals agree, conflict, and are wrong

| Recommendation | Verdict |
|---|---|
| Canonical identity, not provider IDs (all 4) | **MISSING FROM EXISTING SYSTEM — adopt.** The most valuable thing the four agree on |
| Separate free/premium as *resources*, not fields (all 4) | **AGREES** — and we go further, enforcing at build |
| Raw data preservation (3 of 4) | **MISSING — adopt cheaply**, as files |
| Idempotent pipelines (all 4) | **PARTLY PRESENT** — crawls are; prices are not |
| Capability entitlements over `isPremium` (ChatGPT, Perplexity) | **IMPORTANT FOR FUTURE — adopt the shape now** |
| Deterministic-first matching (Perplexity, ChatGPT) | **AGREES** — already built and measured |
| Confidence thresholds (Perplexity, ChatGPT) | **DESIGN FOR THIS** — cannot calibrate without scan records |
| Do not build CV before real scan data (Perplexity) | **AGREES — strongly.** Directly contradicts both Google docs |
| Licensing is a first-class decision (Perplexity only) | **MISSING, and it is a real risk** (§15) |
| Vector search as the recognition strategy (both Google docs) | **WRONG for this domain.** Measured: 0/10,110 Pokémon variants have distinct images |
| "OCR is *proscrit*" (Google doc 2) | **WRONG.** Our OCR path is measured working; theirs is untested |
| Bigtable for price history (both Google docs) | **PREMATURE by orders of magnitude** |
| Pub/Sub between ingestion stages (all 4) | **PREMATURE.** Three hand-run crawlers |
| BigQuery for price history (3 of 4) | **PREMATURE.** Their math assumes 55,000 observed cards; we observe 12 |
| Firestore for the catalogue (2 of 4) | **UNNECESSARY.** Read-only data is better in git |

**Where the two Google documents diverge from the other two**, the other two are
right. They are more infrastructure-forward and less evidence-driven, and both
lead with a recognition strategy that cannot work on the larger half of this
catalogue. That is not a close call — it is measurable.

**Why all four lean heavy:** the brief that produced them said *"I'm planning to
use Google cloud features"* and *"Pokémon is 50000 cards"*. Both premises shaped
every answer. The first invited a GCP architecture; the second inflated the
catalogue by 2.4× (real: 21,066). An audit's job is to check the premises, and
these two did not survive it.

---

# 24. Learning Notes

### Why canonical identity matters — in this project's own terms

A provider ID is a **name someone else controls**. TCGdex could renumber
`sv08-001` tomorrow and every collection row pointing at it would be orphaned.
That is not hypothetical here: One Piece already has two provider ID spaces, and
we have **proven** they cannot be joined automatically — 94.7% of Bandai's
multi-printing groups are identical in every field but id and image.

**Why now:** the cost is a rename. There are no users, no foreign keys, no
migrations, no downtime. **Why not later:** every collection row, scan record and
price observation will point at it, and changing it then means migrating people's
collections — the one dataset where being wrong is unforgivable.
**Simpler alternative:** keep provider IDs and add a mapping table only when a
provider actually breaks. **Trade-off:** you are betting no provider changes
before you have users. **Trigger to revisit:** any provider renumbering, or
adding a third source for either game.

### Why "design for it, don't build it" is the whole discipline here

The four documents describe a system that would work. It would also cost real
money monthly to serve ten friends, and require operating eight services you have
never run. The distinction that matters is not *good architecture vs bad* — it is
**decisions that are expensive to reverse** (identity, price observations, API
versioning) versus **decisions that are cheap to defer** (which database, which
queue, which cloud). Get the first kind right now. Postpone the second kind until
a measurement forces it.

That is why this audit has a "Do Not Build Yet" table with explicit triggers.
A trigger converts "later" from a vague intention into a decision you will
actually notice arriving.

---

# 25. Definition of Success — where we stand

| | Target | Status |
|---|---|---|
| **Today** — one developer, cheap to operate | Yes | ✅ Vercel + files; quota is the only real cost |
| **Soon** — tens of thousands of cards, multi-TCG, multi-provider | Yes | ✅ 25,910 identities, 2 games, 4 providers |
| **Soon** — collections, scanning, premium | Partly | ⚠️ Scanning works; collections are `localStorage`; premium does not exist |
| **Later** — millions of cards, billions of observations, no rewrite | **Blocked on identity** | ❌ Provider IDs as primary keys is the one dead end in the current design |

Fix identity and price history, and the "Later" row becomes reachable without a
rewrite. That is the whole point of this document.

---

## Change log

- **2026-09-07** — First audit. Codebase measured; four external proposals
  compared. Status YELLOW, identity RED.
