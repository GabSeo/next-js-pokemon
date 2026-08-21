# TCGGO integration plan

What data to collect, how to fetch/cache it without burning quota, and which plan to pick. Written before touching code — this is the plan the next product-page reorganization builds against.

## 1. Data catalog — everything the current UI needs, and where it comes from

The product page panels (TCGplayer price, international estimate, PSA graded prices, population, eBay-sold data) currently run on `lib/illustrative.ts` placeholders. Here's what real data replaces each one, and the exact TCGGO endpoint.

| UI needs | TCGGO source | Notes |
|---|---|---|
| Card identity (name, number, rarity, image, set, artist) | `GET /{game}/cards/{cardId}` or `/cards?name=&card_number=` | Same lookup pattern as `apitcg.ts` today |
| **Current USD price** (TCGPlayer market) | `GET /{game}/history-prices?id={id}&sort=desc&per_page=1` → latest `tcg_player_market` | **Not on the card-detail response.** TCGGO's `CardPrices` object only carries `cardmarket` + `ebay`, no `tcgplayer` sub-object — current USD price only exists as "today's" row in the history endpoint. This is the one non-obvious architectural fact the whole plan turns on. |
| **Current EUR price** (Cardmarket) | Card detail's `prices.cardmarket.lowest_near_mint` (+ `_DE`/`_FR`/`_ES`/`_IT` variants) | Already on the card-detail call — free with the identity lookup |
| **Price history** (both currencies, for the chart) | `GET /{game}/history-prices?id={id}&date_from=&date_to=` → `{date, cm_low, tcg_player_market}[]` | One call returns both currencies' daily series — this *is* the "current price" call too (see above), so it's not an extra fetch |
| **PSA/BGS/CGC graded prices** (Cardmarket side — lowest asking price) | Card detail's `prices.cardmarket.graded.{psa,bgs,cgc}.*` | Free with the identity lookup, but only 3 grade tiers (8/9/10) and it's asking price, not sold price |
| **PSA/BGS/CGC/SGC/ACE/TAG graded prices** (eBay — median of actual sales) | `GET /{game}/ebay-sold-prices?id={id}` → `{company, grade, median_price, sample_size}[]` | Richer than the Cardmarket-graded field above — more companies, more grade granularity, real recent-sale medians. **Primary source for the "PSA Graded Prices" panel**; Cardmarket-graded is a fallback if eBay has no sample. |
| **Individual eBay sold listings** ("recent sales" table — date, price, link) | `GET /{game}/ebay-sold-offers?id={id}&company=&grade=&per_page=` | Filterable by company/grade. This is the most expensive-to-justify call per page load — see §2.3 on making it lazy. |
| Population data (PSA pop report, gem rate) | **Not available from TCGGO.** Confirmed earlier this session — no candidate API has it. Stays illustrative until a dedicated PSA population source is found (PSA doesn't offer a cheap public one). |
| GBP / CAD international estimates | **Not directly available** — TCGGO's Cardmarket data is EUR + DE/FR/ES/IT only. Real EUR is available (above); GBP/CAD would need either (a) stay illustrative off the real EUR figure, or (b) layer a free FX-rate API (e.g. exchangerate.host) on top of the real EUR number — cheap, optional, separate from TCGGO entirely. |
| Sealed products (Set EV Calculator, Sealed Products tool) | `GET /{game}/products`, `/products/{productId}` | Own schema, own `prices.cardmarket` by country — same shape as cards |
| Set/episode metadata (if Browse Sets ever grows real catalog breadth) | `GET /{game}/episodes`, `/episodes/{id}`, `/episodes/{id}/cards` | Includes `cards_total`, `cards_printed_total`, release date, per-episode aggregate price totals |
| Artist credits | `GET /artists`, `/artists/{id}/cards` | Optional, low priority |
| "My Collection" server-side persistence | **Not TCGGO's `/inventories` endpoints** — those are scoped to a TCGGO account via a separate Inventory API Key, not a general per-visitor API. A real "My Collection" backend needs our own storage (small KV/Postgres), independent of this integration. |

## 2. Architecture — call budget, caching, and where the quota actually goes

### 2.1 Per-card call budget

To fully refresh one card's data from cold cache:

1. `cards?name=&card_number=` (or `?card_number=code`) — resolve the card → **1 call**
2. `history-prices?id=&per_page=100` — history *and* current USD/EUR price in one shot → **1 call**
3. `ebay-sold-prices?id=` — graded medians, all companies at once → **1 call**
4. `ebay-sold-offers?id=&per_page=20` — individual listings → **1 call, but see 2.3**

**3–4 calls per card**, not the 6+ you'd get calling every endpoint separately, because history-prices already carries both currencies and the card-detail call already carries Cardmarket-graded for free.

### 2.2 Caching — reuse the pattern `apitcg.ts` already uses

Every TCGGO call goes through Next's `fetch(url, { next: { revalidate: N } })`, exactly like `apitcg.ts` does today (and `lib/tcggo.ts`, already scaffolded, already does this). The precise rule this buys, stated carefully: **cost is per distinct (route × card × query) combination within the revalidate window, not per visitor.** Two consequences fall out of that:

- **Static pages are pre-paid at build time, not per click.** `/products/[slug]` and `/collections/[franchise]` use `generateStaticParams`, so their data fetches happen once, during the Vercel build — visiting them afterward (you or 10,000 friends) costs nothing until the revalidate window expires and ISR regenerates in the background.
- **Dynamic routes are pre-paid on first hit, then free for everyone after.** `/tools/price-checker?cardId=X`, `/api/{franchise}/{id}`, and `/okf/*` render per-request, so the *first* visit to a given card through one of these routes is a real cache miss — whether that first visit is you clicking through everything right after deploy, or a friend who happens to get there first. Every visit after that, by anyone, for that same card, within the window, is free. Clicking through everything yourself right after a deploy is actually the cheap way to warm the cache before sharing the link, not an extra cost on top of what friends would trigger anyway.

The one thing this doesn't protect against: a free-text search feature hitting `/cards?search=` with arbitrary strings, if one ever gets built — each distinct search query is its own cache entry, so that's the one shape where visitor *behavior* drives cost rather than catalog size.

Recommended revalidate windows, by volatility:

| Data | Window | Why |
|---|---|---|
| Card identity + Cardmarket EUR/graded | 24–36h | Matches `apitcg.ts`'s existing 36h window |
| History prices (daily granularity) | 24h | The underlying data itself is daily; polling more often buys nothing |
| eBay sold-price medians | 24h | Same reasoning |
| eBay individual offers | 48h+, or lazy (see 2.3) | Past sales don't change; freshness matters least here |

### 2.3 The one real lever for keeping usage low: make eBay *offers* lazy

Card identity, history, and eBay medians are cheap and worth fetching eagerly for every tracked card. Individual eBay offers (the "recent sales" table) are the priciest, least-essential call — recommend fetching those **on demand** behind their own small cached route (e.g. `/api/ebay-offers?cardId=&grade=`) that a product-page tab/expander calls only if a visitor actually opens that section, rather than baking it into every page load. Same "don't fetch what nobody looks at" instinct as the current `PriceDataTabs`' unused eBay-snapshot tab.

### 2.4 Build-time cost — the thing that's easy to miss

`generateStaticParams` pre-builds every product page at deploy time, which means **every deploy** triggers a fresh fetch for every tracked card (Vercel's build environment doesn't share the production Data Cache). At 3–4 calls × 6 cards = 18–24 calls per deploy, frequent deploys during active development add up faster than production traffic ever will. Worth being deliberate about deploy cadence while iterating, same as we've already been doing by working against local/illustrative data during UI passes and only testing real integration deliberately.

### 2.5 Module structure

- `lib/tcggo.ts` (already built, uncommitted) stays the thin typed client — one function per endpoint, no aggregation logic.
- New aggregation layer (mirrors `cards.ts`'s `resolveCard`): resolve → `Promise.all([getHistoryPrices, getEbaySoldPrices])` in parallel (2 concurrent calls, not sequential — same call count, lower latency) → assemble into an extended card shape. `ebay-sold-offers` stays out of this eager path per §2.3.
- Extend `Card` (or a superset type) with `cardmarketEur`, `gradedCardmarket`, `gradedEbay` — nullable, so pages render exactly as they do today if a field comes back empty.
- Run the new resolver **side by side** with `apitcg.ts` (not a rip-and-replace) until verified against a real key with real quota headroom, then cut `cards.ts` over and delete `apitcg.ts`. `lib/illustrative.ts`'s functions get replaced 1:1 at that point — the UI panels don't change, only their data source, which is exactly why that file was built as an isolated swap point.

## 3. Plan recommendation

Total steady-state usage at current scale: **~18–24 calls/day** (one full refresh cycle across 6 cards, every 24h, regardless of visitor count) + occasional price-checker ad-hoc lookups + deploy-time regeneration.

| Plan | Price | Quota | Fits when |
|---|---|---|---|
| **Basic (Free)** | $0/mo | 100/day, 30/min | **Recommended now.** ~18–24/day steady-state leaves 75+/day of headroom — comfortable even with frequent deploys and price-checker traffic, at the current 6-card scope. |
| Pro | $9.90/mo | 3,000/day, 300/min | Once the catalog grows to roughly 100+ actively-cached cards, or revalidate windows need to drop well below 24h |
| Ultra | $24.90/mo | 15,000/day, 300/min | Once eBay-offer lookups become a common on-demand feature at real traffic, or catalog reaches the thousands |
| Mega | $49.50/mo | 50,000/day, 600/min | Not relevant at prototype scale |

**Recommendation: start on Basic (free).** The caching architecture above is what makes that viable — it's specifically designed so visitor traffic never multiplies API cost, only catalog size and revalidate-window tightness do. Revisit Pro only if the catalog genuinely grows past what a 24h-cached free tier can cover, not before.
