# Vinted prices via Lobstr.io

How real Vinted listings reach the **Pokémon Market Overview → France** tab, and what to do when they don't.

## The one product rule

**Only listings clearly described as "Très bon état" are shown.**

Vinted's other condition tiers — Bon état, Satisfaisant, Neuf avec/sans étiquette — are dropped outright. This is a hard filter, not a ranking: the France tab answers *"what can I buy right now that the seller has clearly described as très bon état"*, not *"what does the French market look like"*.

Two consequences worth accepting up front:

- The feed is deliberately sparser than an unfiltered Vinted search. A card whose recent listings are all "Bon état" shows **zero** real rows and falls back to the clearly-marked preview. That's the honest outcome, not a bug to widen the filter for.
- Every row carries the same condition tag, because there is only one condition on screen by construction.

Enforced in two places: Vinted itself filters server-side via `status_ids[]=2` on the scraped URL, and the returned condition text is checked again on our side. The text match is **exact** (accent- and case-insensitively), never a substring — `"bon état"` is a literal substring of `"très bon état"`, so a substring test would let through exactly the tier the filter exists to exclude.

## The URL being scraped

One function builds it — `vintedSearchLink` in `src/lib/vinted-search.ts` — and it is both the Lobstr task URL and the panel's "Search on Vinted" link, so the two can't drift apart:

```
https://www.vinted.be/catalog?search_text=Typhlosion%20de%20Luth%20190%2F182&status_ids[]=2&page=1&order=relevance
```

- `search_text` — the card's French name plus its number, from TCGdex (`vintedQueryForCard`), falling back to English when no French name exists.
- `status_ids[]=2` — **Très bon état**. The whole product rule, applied by Vinted server-side.
- `order=relevance` — with a small `max_pages` budget, spend it on listings that actually match the card rather than on whatever was posted last. The panel still renders newest-first; that ordering happens in our code, not Vinted's.
- `time=<unix>` is deliberately **omitted**. It's a cache-buster Vinted's own UI appends and nothing server-side needs. A URL that changes on every call would churn a statically-generated page's HTML and pile up a fresh Lobstr task per refresh instead of reusing one stable task per card.

Encoding is hand-built with `encodeURIComponent`, not `URLSearchParams`, so spaces come out as `%20` and the key stays a literal `status_ids[]`. `URLSearchParams` would emit `+` and `status_ids%5B%5D`; both are RFC-equivalent and would almost certainly decode the same, but "almost certainly" isn't a reason to send something other than the string confirmed to work.

## Why a scraper at all

Vinted has no usable public API. Its official Pro Integrations API is allowlisted, has no search/catalog endpoint at all, and can't do bulk data. Its internal API (`/api/v2/catalog/items`) is undocumented, Datadome-protected, and IP-bans under load. Lobstr.io's hosted Vinted Products Scraper is the third-party path this integration goes through.

Lobstr reads **search and catalog pages only** — never the individual product page. Every field this integration can ever show is one that appears on a search-results card.

## The asynchronous flow

Lobstr's API does not return prices when you ask for prices. You create a squid (a configured scraper instance), give it tasks (URLs), start a run, wait minutes, then read that run's results.

A page render can never drive that whole cycle — it would block for the length of a scrape and burn a credit per page view. So the work is split, and only the read half is on the render path:

```
WRITE   POST /api/vinted/refresh   (cron or manual, secret-gated)
        addTasks -> startRun -> [Lobstr scrapes, minutes] -> done

READ    product page render        (cached 30 min)
        listRuns -> getResults -> filter to Très bon état -> render
```

| File | Role |
| --- | --- |
| `src/lib/lobstr.ts` | Transport: auth, squids, tasks, runs, stats, results |
| `src/lib/vinted-listings.ts` | Domain: the Très bon état filter, field mapping, per-card bucketing |
| `src/app/api/vinted/refresh/route.ts` | Write path: queue tasks, start a run (POST); run status (GET) |
| `src/lib/graded-market.ts` | Joins real listings into the panel's data, falls back to preview |
| `scripts/lobstr-setup.mjs` | One-time squid creation + result-shape inspection |

## Environment variables

| Variable | Required | What it is |
| --- | --- | --- |
| `LOBSTR_API_KEY` | yes | From the Lobstr dashboard. Sent as `Authorization: Token <key>`. |
| `LOBSTR_VINTED_SQUID` | yes | The reused squid's hash, printed by `scripts/lobstr-setup.mjs --create`. |
| `LOBSTR_REFRESH_SECRET` | yes | Gates `/api/vinted/refresh`. `CRON_SECRET` is accepted as a fallback so Vercel Cron works unchanged. |
| `LOBSTR_VINTED_RUN` | no | Pins the read path to one run hash instead of resolving the squid's latest run. |
| `VINTED_DOMAIN` | no | Which Vinted marketplace to search. Defaults to `www.vinted.be`. Each country is a separate site with its own sellers and shipping, so this changes which listings come back. |

Without any of these the site still builds and renders — the France tab just stays on its clearly-marked preview.

## First-time setup

```bash
export LOBSTR_API_KEY=...

node scripts/lobstr-setup.mjs            # verify the key, list crawlers
node scripts/lobstr-setup.mjs --create   # create the squid, prints LOBSTR_VINTED_SQUID
export LOBSTR_VINTED_SQUID=...           # and add it in Vercel
node scripts/lobstr-setup.mjs --settings # apply recommended crawler settings
```

Then trigger the first run:

```bash
curl -X POST https://<host>/api/vinted/refresh -H "Authorization: Bearer $LOBSTR_REFRESH_SECRET"
curl      https://<host>/api/vinted/refresh -H "Authorization: Bearer $LOBSTR_REFRESH_SECRET"  # status
```

Squids are **not** created per request — you create one and reuse it. That's why creation lives in a script a human runs, not in app code.

### Scheduling it

`vercel.json`, if you want it on a schedule (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`):

```json
{ "crons": [{ "path": "/api/vinted/refresh", "schedule": "0 */6 * * *" }] }
```

Every run costs credits (Lobstr: 100 free results/month, then from $1 per 1k). One run covers all tracked cards, so the cost scales with cards × pages, not with site traffic.

## The part that is still a guess

Lobstr's **per-item output field names** aren't in the walkthrough this was built from, and couldn't be confirmed against a live run. `FIELD_ALIASES` in `src/lib/vinted-listings.ts` therefore reads each field from a short list of plausible names (`status` / `condition` / `item_condition` …) and takes the first present one.

To replace the guess with fact:

```bash
node scripts/lobstr-setup.mjs --sample <run_hash>
```

It prints the real keys on a result row, plus every distinct value of any condition-looking field — which is exactly what tells "no très bon état listings right now" apart from "the condition field isn't named what we guessed". Correct `FIELD_ALIASES` against that output; nothing else needs to change.

Two smaller unverified spots, both marked in the code and both failing soft (they degrade to the preview, never to a wrong number):

- `listRuns` reads `GET /v1/runs?squid=<hash>`, a conventional REST reading of the documented `POST /v1/runs`. Set `LOBSTR_VINTED_RUN` to bypass it.
- The results envelope (`[...]` vs `{data: [...]}` vs `{results: [...]}`) is unwrapped defensively rather than assumed.

## Deliberate design choices

**The condition filter is applied twice, in two independent places.** Vinted applies it server-side from `status_ids[]=2` on the task URL, so the scrape only ever visits pages of très bon état listings and no credits go on tiers we'd discard. The returned condition text is then checked again on our side, as a guard against a stale task queued before the filter existed. A row whose condition field can't be read at all is *kept* (and logged once): it came back from a search Vinted itself restricted to status 2, and dropping it would let one wrong guess in `FIELD_ALIASES` silently empty the whole feed.

**Real and preview never mix.** A card's feed is entirely scraped or entirely illustrative. Real rows carry a working per-listing link and the seller's title; preview rows carry neither, because a dead item link is a worse placeholder than an invented number — it looks clickable.

**Prices are per-listing currency, not the card's.** Vinted trades in euros on the `.fr`/`.be` sites while `card.currentPrice` is TCGPlayer USD. Mislabelling € as $ on a price-comparison page is a real error, not a cosmetic one.

**These are asking prices on active listings, not completed sales.** Vinted has no public sold feed, so there's no sold/active split to render — the same reason the eBay side keeps sold data illustrative.

## Rate limits

Documented per-endpoint caps: `/v1/squids` 120/min, `/v1/tasks` 90/min, `/v1/results` **2/sec**. Responses carry `X-RateLimit-Remaining` and `Retry-After`, and `lobstr.ts` includes both in its error text so a 429 reads as "back off" rather than as a generic failure.

The read path caches results for 30 minutes and run listings for 5, which keeps product pages statically renderable and well clear of the results cap under real traffic.
