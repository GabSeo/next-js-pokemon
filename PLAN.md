# Pokémon/One Piece Card Shop — Agent-Readable Commerce MVP

Status: planning complete, implementation starting.
Source material: `docs/research/best code for seo website - Recherche Google next js (exemple).md` (Gemini conversation — originally about a container-rental business; the architectural pattern was extracted and re-applied here).

## 1. Premise

Most commerce sites are legible to humans only. This prototype ships every page as **two synchronized representations of the same content**: a minimal, modern human UI, and a plain-text/JSON machine layer that AI crawlers and AI agents can read or call directly — without executing JavaScript, without guessing at DOM structure, and without being blocked by robots.txt. The goal is to be simultaneously excellent at classic SEO, GEO (citation by ChatGPT/Gemini/Claude/Perplexity), and literal agent tool-use (an agent can call the price tool as an action, not just read about it).

Not a real business — generic ecommerce slugs, Pokémon + One Piece card niche, 3 cards each for the MVP.

## 2. Stack

- **Next.js** (App Router, TypeScript, React Server Components by default)
- **Vercel** (free/Hobby tier) — hosting + Vercel Cron for price refresh
- **GitHub** — repo + Vercel auto-deploy on push
- **Tailwind CSS + shadcn/ui** — minimal/modern design system, near-zero custom CSS
- **No traditional database for the catalog** — the 6 cards live as JSON in the repo (content-as-code)
- **External persistence for price history only** — Upstash Redis or Supabase free tier (Vercel functions have no writable disk)
- **Pricing data source** — PriceCharting API as primary (self-serve, built for graded/TCG card pricing) rather than eBay's Marketplace Insights API (partner-restricted, not self-serve). eBay Browse API can supplement active-listing links. Architected so the backend source is swappable.
- **Resend** (free tier) for price-alert emails

## 3. Site map

| Page | Path | Renders |
|---|---|---|
| Homepage | `/` | Brand framing, links into both collections |
| Collection | `/collections/pokemon` | 3 Pokémon cards, grid |
| Collection | `/collections/one-piece` | 3 One Piece cards, grid |
| Product | `/products/[slug]` | Single card detail + embedded price tool state |
| Price tool (dedicated) | `/tools/price-checker` | Same tool as the footer widget, deep-linkable |
| About | `/about` | Trust/E-E-A-T signal page |

The price-checker **widget** (compact form: card ID input → chart/list/add/alert) is also mounted in the footer on every page, so it's reachable without navigation.

## 4. The AI-accessibility layer

### 4.1 Dual-file pattern per page (the core technique)

For every page above, a parallel machine-readable route exists, generated **dynamically from the same data object** that renders the human page — never hand-maintained separately:

- `app/products/[slug]/page.tsx` → `/products/pikachu-base-set-58` (HTML, humans)
- `app/products/[slug].md/route.ts` → `/products/pikachu-base-set-58.md` (Markdown, agents)
- `app/api/pokemon/[id]/route.ts` → `/api/pokemon/025.json` (JSON, agents/programmatic)

Same pattern for collections (`/collections/pokemon.md`, `/api/pokemon/index.json`) and the homepage (`/index.md`, `/api/site.json`).

`route.ts` = raw data server (no visual rendering); `page.tsx` = visual page for humans. Folder names carry literal dots (`[slug].md`) — this is a supported Next.js routing pattern, not a hack.

### 4.2 Visible-links rule, not `sr-only`

Rejected pattern: hiding a data table with `sr-only` — flirts with cloaking (content shown to bots, hidden from humans), and Google's spam detection specifically watches for this.

Adopted pattern: small, plainly visible, de-emphasized links (e.g. `📄 Markdown` · `⚙️ JSON`) placed near the top of each page and next to the price-checker widget, styled like a "docs/open data" affordance. Same URL, same content, for humans and bots — nothing hidden, nothing cloaked. A curious human can click through to the raw data too.

### 4.3 Discoverability — triple placement, no orphan pages

Crawlers don't guess URLs, they follow links. Every AI-facing resource (the `.md`/`.json` mirrors, and the `/tools/price-checker` page itself) must be linked from:
1. Primary nav / header
2. Footer
3. Natural contextual copy in body text (e.g. the Pokémon collection page textually references the One Piece collection, not just via nav — strengthens the internal semantic mesh)

Also declared in `sitemap.xml` and `llms.txt` so agents that never render a page can still discover the data routes directly.

### 4.4 `llms.txt`

Root-level plain-text file (llmstxt.org emerging standard): one-shot summary of what the business is, its structure, and direct links to every `.md`/`.json` resource. Highest-leverage single file for GEO.

### 4.5 `robots.txt` — explicit, not just permissive

Not just `Allow: /`. Explicit allow-lines for the data surface specifically, for the named AI crawlers:

```
User-agent: GPTBot
Allow: /
Allow: /api/
Allow: /*.md

User-agent: ClaudeBot
Allow: /
Allow: /api/
Allow: /*.md

User-agent: PerplexityBot
Allow: /
Allow: /api/
Allow: /*.md

User-agent: Google-Extended
Allow: /

Sitemap: https://<domain>/sitemap.xml
```

(Exact bot list and directives finalized at implementation time — described here, not written as final code.)

### 4.6 Structured data (JSON-LD)

- `Organization` — sitewide
- `ItemList` — on both collection pages
- `Product` + `Offer` — on product pages, with **exact** `price`, `priceCurrency`, `priceValidUntil` on the last-sold figure (not just a low/high range) — agents need a quotable, unambiguous number
- `AggregateOffer` (lowPrice/highPrice/offerCount) acceptable at the collection level only
- `BreadcrumbList` — product and collection pages
- `FAQPage` — where natural-language Q&A content exists (see 4.8)

### 4.7 Baseline hygiene (non-negotiable, applies to every page)

- Exactly one `<h1>` per page, hierarchical `<h2>`/`<h3>` after it
- `<link rel="canonical">` on every page — including the `.md` mirrors, pointing back to the canonical HTML URL, so the three representations (HTML/MD/JSON) are never read as duplicate content
- Descriptive `alt` text on every card image (not decorative — the image *is* a data point)
- Semantic HTML5 landmarks (`<main>`, `<article>`, `<nav>`, `<header>`, `<footer>`)

### 4.8 Content written for citation (GEO writing style)

- Answer-first paragraphs near the top of product pages (direct, quotable statements: "The last recorded sale for [card] was €X on [date].")
- FAQ blocks answering the natural-language questions a chatbot user would actually ask ("How much is a [card] worth right now?")
- Visible "last updated" timestamps everywhere a price appears — AI engines weight freshness heavily for price data specifically

### 4.9 What bots actually see — the JS-blindness constraint

Crawl-log evidence (cited in source research) shows AI bots largely don't execute JavaScript and don't even request JS bundles. Consequence for the build: **price, last-sold list, and card metadata must exist in server-rendered HTML/JSON** (RSC by default, never client-fetched-only). Only the non-essential interactive layer (chart animation, drag interactions, the "add to collection" click handling) may live in a `"use client"` component — the numbers themselves must already be in the server-rendered markup before any client JS runs.

## 5. The price-checker tool — full spec

**Location:** footer widget (global) + dedicated `/tools/price-checker` page.

**Input:** Pokémon or One Piece card ID (resolved against the 6-card MVP dataset; free-text name search is a stretch goal).

**Output:**
- Price chart — last-sold history over time
- List of individual last-sold items (date, price, condition, source link)
- "Add to my collection" — no auth for MVP; cookie/localStorage-based watchlist (upgradeable to real accounts later)
- Price alert subscription — notify when price moves in 25% bands off the baseline, from −75% (the floor before hitting $0) to +150% (i.e. trigger points at −75/−50/−25/+25/+50/+75/+100/+125/+150%)

**Agent-exploitability (beyond the dual-file pattern above):**
- Documented REST endpoint: `GET /api/price-check?cardId=...` returning clean JSON (price, currency, last-updated, sold-comps array, canonical product URL) — mirrors the container-rental doc's `app/api/devis/route.ts` pattern exactly
- The endpoint's URL and parameter schema is included in `llms.txt` and referenced from the tool's own `.md` mirror, so an agent can learn how to call it without needing an OpenAPI spec fetch
- Stretch: expose the same capability as an **MCP server endpoint** (Vercel supports MCP-over-HTTP functions) so agents like Claude can call it as a first-class tool action, not just an HTTP fetch
- Progressive enhancement: the visual form is a real `<form>` with server-actionable fallback, functional without client JS

**Rejected approach:** hiding the raw price table via `sr-only` next to the visual widget — replaced by the visible-links pattern in §4.2.

## 6. Data layer — the two knowledge groups

Two clearly separated groups, exactly as specified — Pokémon and One Piece are never merged in a single feed, since they're distinct franchises an agent needs to reason about separately:

- `/data/pokemon/index.json` — 3 entries, each: `id`, `name`, `set`, `image`, `currentPrice`, `lastSoldDate`, `priceHistory[]`, `productUrl`
- `/data/one-piece/index.json` — same shape, 3 entries
- Optional per-card file: `/data/pokemon/[id].json`, `/data/one-piece/[id].json`

This JSON is the **single source of truth** — `page.tsx`, the `.md` route, the `/api/*.json` route, and the JSON-LD block on each page all read from it, so nothing can drift out of sync.

## 7. Design principles

- Ultra-minimal, modern: constrained palette, large type, generous whitespace, mobile-first
- shadcn/ui components + Tailwind, dark/light mode
- Performance budget: Lighthouse 95+ (also directly serves the SEO/CWV goal)

## 8. Known constraints / honesty checks

- **Vercel Hobby cron limits**: daily-interval jobs only, small number of cron jobs total — fine for a 6-card MVP refresh cadence, would need Pro for intraday refresh
- **No persistent disk on Vercel functions** — price history requires Upstash Redis or Supabase (free tiers), not local file writes
- **eBay Marketplace Insights API is partner-gated**, not self-serve — PriceCharting API is the realistic MVP data source; architecture keeps this swappable
- **Technical GEO correctness ≠ guaranteed AI citation.** LLMs cross-reference external trust signals (backlinks, mentions, domain history) before citing a source's numbers. A fresh prototype domain will be *machine-readable* and *agent-callable* correctly, but won't necessarily be *cited* by a live chatbot yet — that's an expected, out-of-scope limitation for this MVP, not a build defect.

## 9. Build phases

0. Repo + Next.js init (TypeScript, App Router, Tailwind), Vercel link, GitHub auto-deploy
1. Design system + shell layout (header, footer with tool widget, nav)
2. Static pages using seed JSON for the 6 cards (home, both collections, product pages)
3. Data layer: build `/data/pokemon/index.json` + `/data/one-piece/index.json`, wire all pages to read from them
4. AI-accessibility layer: `.md` route mirrors, `/api/*.json` routes, JSON-LD, `llms.txt`, `robots.txt`, `sitemap.xml`, visible open-data links (§4.2), triple-placement internal linking (§4.3)
5. Price-checker tool UI against seed/mock data (chart, sold list, add-to-collection, alert opt-in) + its own `.md`/`.json` mirrors
6. Real data integration: apitcg.com (products + real daily price history for both franchises in one API) + Next.js ISR (`revalidate`) instead of a custom cron/Supabase pipeline — done for the 6 tracked cards; see §6 note below
7. Email alerts via Resend for the alert-band triggers
8. Agent-exploitability layer: finalize documented REST contract, stretch MCP server exposure
9. SEO/GEO polish: metadata, Core Web Vitals pass, schema validation, sanity-test by asking Claude/ChatGPT/Perplexity to look up one of the 3 seeded Pokémon cards
