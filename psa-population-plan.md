# PSA population — parked, waiting on PSA access

**Status: blocked on PSA, not on us.** Nothing in this document has been built.
The Population panel on a product page is still `illustrativePopulation`
(lib/illustrative.ts) and still badged `IllustrativeTag`.

Everything below was measured against the real APIs on 2026-09-03, with real
credentials. It is written down so that the day PSA reopens access, the work
starts from evidence instead of repeating a day of probing.

Source brief: `HTML prototypes/PSA_POPULATION_INTEGRATION.md`. Read this file
first — three of that brief's load-bearing assumptions turned out to be wrong,
and they are corrected here.

## Why it is parked

PSA replied on 2026-09-02:

> Please note that we have discontinued our public API access while we make
> necessary changes to our systems.
>
> If you are looking for an enterprise usage tier, we have paid plans starting
> at 500 calls per day for $2,500 per year.

So the free tier is gone, not merely unapproved. A real, correctly-formed
`PSA_ACCESS_TOKEN` returns, on **every** endpoint — cert, images and pop alike:

```
403 {"Message":"Access to this API is limited to approved customers."}
```

### Telling the three failure states apart

Worth keeping, because they look alike and mean completely different things:

| What you send | What PSA answers | What it means |
|---|---|---|
| `authorization: bearer <token>` | `403 limited to approved customers` | Token is read and rejected — the account is not approved. An email, not a retry. |
| `authorization: <token>`, no prefix | `429 quota exceeded, max 100 per Day` | The prefix is missing, so you fell through to PSA's shared anonymous bucket. |
| No header at all | same `429` | Same anonymous bucket. |

That middle row is the diagnostic: a token that produces a 403 with the prefix
and a 429 without it is a **valid token on an unapproved account**. Do not go
looking for a formatting bug.

## What we asked PSA, and what they did not answer

We asked whether a SpecID can be resolved from card metadata — year, set,
language, number, variant — or whether a searchable specification catalogue
exists. They answered the pricing question instead.

Their own swagger settles it. The entire public surface is six paths:

```
/cert/GetByCertNumber/{certNumber}
/cert/GetByCertNumberForFileAppend/{certNumber}
/cert/GetImagesByCertNumber/{certNumber}
/order/GetProgress/{orderNumber}
/order/GetSubmissionProgress/{submissionNumber}
/pop/GetPSASpecPopulation/{specID}
```

There is no search, no lookup by metadata, no catalogue. **A certificate number
is the only way in.** That is why the eBay-first approach in the brief is the
right shape, and it stays right whenever access reopens.

One thing the brief misses, from the same swagger: `PublicPSACert` already
carries `TotalPopulation`, `TotalPopulationWithQualifier` and
`PopulationHigher`. A cert lookup answers part of the population question on its
own; the pop endpoint is what turns that into the full grade ladder.

## Correction 1 — the cert number is NOT in the eBay search response

The brief says to read `conditionDescriptors` off eBay search results. It is not
there. `item_summary/search` returns 26 fields for a graded item — title, price,
`condition: "Graded"`, `conditionId: "2750"`, epid, seller, itemLocation and so
on — and no descriptors. `fieldgroups=EXTENDED` adds `shortDescription` and
nothing else.

The descriptors exist only on the single-item endpoint,
`/buy/browse/v1/item/{itemId}`. **One extra eBay call per candidate listing**,
which the brief's cost model does not account for, and the reason discovery has
to be an offline pass rather than something a page does while rendering.

## Correction 2 — the descriptor payload is a different dialect

The brief describes numeric descriptor ids with `additionalInfo`
(`27501`/`27502`/`27503`), which is eBay's Trading API shape. The Browse API
returns human-readable names against a `values` array:

```json
[{"name":"Professional Grader",
  "values":[{"content":"Professional Sports Authenticator (PSA)"}]},
 {"name":"Grade","values":[{"content":"10"}]},
 {"name":"Certification Number","values":[{"content":"147840833"}]}]
```

That is item `298575267663` — the brief's own worked example, confirmed end to
end. An extractor written to the brief's spec would have matched nothing.

Read both dialects, gate on the grader, and never scrape digits from a title.
A wrong cert number does not fail loudly: it resolves to a real, different
card's SpecID and publishes that card's population under this card's name.

```ts
const named = (ds: Descriptor[], re: RegExp, numeric: string) =>
  ds.find((d) => re.test(String(d.name ?? "")) || String(d.name) === numeric);

const text = (d?: Descriptor) =>
  d?.values?.[0]?.content
    ?? (Array.isArray(d?.value) ? d.value[0] : d?.value)
    ?? d?.additionalInfo
    ?? null;

const grader = text(named(ds, /professional grader/i, "27501"));
const cert   = text(named(ds, /certification number/i, "27503"));

// 7-10 digits, not a fixed width: of 26 real certs collected, several were
// 8 digits (70221599, 88248552) and the rest 9. A stricter rule drops the
// older ones silently.
const isPsa = /PSA|Professional Sports Authenticator/i.test(grader ?? "");
const certNumber = isPsa
  ? (String(cert ?? "").replace(/\D/g, "").match(/^\d{7,10}$/)?.[0] ?? null)
  : null;
```

## Correction 3 — measured fill rate, and it is not uniform

Ten cheapest listings per tier, `getItem` on each:

| Tier | Listings carrying a cert number |
|---|---|
| Gengar VMAX 271, PSA 10 | 9 / 10 |
| Gengar VMAX 271, PSA 9 | 6 / 10 |
| Lugia V 186, PSA 10 | 9 / 10 |
| Monkey D. Luffy OP09-061, PSA 10 | 2 / 10 |

Pokémon resolves off its first search. One Piece frequently will not, and will
need more candidates or repeated attempts across days. Budget for that rather
than reading it as a broken extractor.

An empty result here means **sellers did not fill the field in** — never that
the card has no PSA population. Same distinction the brief draws, and the same
one `noListings` vs `isReal` already draws in graded-market.ts.

## Correction 4 — the brief's persistence model does not fit this repo

The brief assumes a database, a job queue and a large catalogue. This app has
ten hand-curated cards in `src/data/card-refs.ts` and **no database at all** —
`supabase/schema.sql` exists but nothing imports it and no Supabase env vars are
set. Persistence today is `.next/cache` (build-time only, see build-cache.ts)
plus Next's Data Cache.

The brief's two tables are not the same kind of fact and should not both be
tables:

- **card → SpecID is immutable.** A card's PSA specification never changes.
  That is committed repo data, reviewed by a human before it lands — the same
  shape `ebayVariantTags` and `pokeWalletWesternCardId` already have in
  `card-refs.ts`.
- **population counts change**, slowly. That is a runtime fetch cached like
  every other upstream here: `resilientFetch` + `chargeApiBudget` +
  `buildCached` + `cache: "force-cache"`. Ten cards is ten calls, and the
  existing daily `/api/warm` cron already triggers the refresh for free.

That removes the queue, the background jobs, the lock/dedupe layer and the
snapshot table — none of which have anywhere to live here.

## The build, when access reopens

1. `src/lib/psa-cert.ts` — `getItem` + descriptor extraction, per Corrections 1
   and 2. Verified working today; the only piece that needs no PSA access at all.
2. `src/lib/psa.ts` — server-only client (`import "server-only"`, the token is
   an unscoped bearer credential). `getCertificate`, `getSpecPopulation`.
   Validate at runtime rather than casting: a response missing `SpecID` must not
   flow onward as `undefined` and get written into a mapping file or rendered as
   a population of zero.
3. `src/lib/api-budget.ts` — a new `api.psacard.com` bucket. The free cap was
   100/day; enterprise starts at 500/day. Set it from whichever tier is actually
   bought, well under the real cap like every other entry there.
4. `src/lib/psa-match.ts` — the brief's hard gates (card-number core, language,
   set identity, edition, finish) against `Card`. Names are tie-breakers, never
   primary keys.
5. `scripts/psa-spec-discover.mts` — the collection tool, in the
   `card-audit.mts` / `ebay-query-lab.mts` mould: run per slug, print candidates
   and evidence, emit a mapping line to paste after review.
6. `src/data/psa-specs.ts` — the reviewed mapping. Never written by a job.
7. Panel, JSON API and markdown mirror wired to real data, with an explicit
   `unmapped` state. Then delete `illustrativePopulation`, rather than leaving
   it beside the real thing.

Quota shape that makes this affordable: **the cert endpoint is never called from
a rendering path.** Certificate resolution happens once per card, offline, and
the result is committed. Only `getSpecPopulation` runs at build/ISR time, once
per mapped card. Ten cards fit inside even the discontinued free tier.

## The free alternative, if PSA never reopens

eBay's descriptors give grader, grade **and** cert number per listing, which is
enough to accumulate a census of distinct graded copies observed on eBay:
harvest across the graded tiers we already search, dedupe by cert number, append
to a committed JSON per card so it grows with each scan and the growth is
visible in git.

That is a real lower bound and it is citable — every entry points at a listing.
It is **not** a population report and must never be labelled as one. "Distinct
copies observed on eBay since <date>", not "Population"; "share of observed
copies at PSA 10", not "gem rate".

Not recommended: scraping PSA's public population pages. It is the same data
they have just declined to serve while they change systems, and it would be the
one piece of fabricated provenance on a site whose whole premise is that agents
can trust the page.

## Reproducing the probes

Nothing above needs to be taken on faith. eBay costs a handful of calls against
a 5,000/day cap; the PSA calls cost nothing while they 403.

```bash
npx tsx --env-file=.env.local scripts/ebay-query-lab.mts gengar-vmax-271 "PSA 10" English
```

For the descriptor shape, call `/buy/browse/v1/item/v1%7C298575267663%7C0` with
a Browse token and read `conditionDescriptors`. For PSA's surface, fetch
`https://api.psacard.com/publicapi/swagger.json` — it needs no auth and is the
authority on what does and does not exist.
