# International SEO is deferred — deliberately, and here's the state to come back to

**Status:** the site serves **one indexable URL per card**, and it is English.
French and Japanese identity are still real, still sourced live, and still
shown — they moved from their own routes into a client-side toggle on the
canonical product page.

**There is no hreflang implementation right now, and that is on purpose.**
Real per-language URLs come first; hreflang is an annotation *on top of*
per-language URLs and is meaningless without them. Doing it in the other
order — hreflang tags pointing at URLs that don't exist, or at the same
English page three times — is worse than doing nothing, which is the whole
reason the previous alternates block gated every entry on a confirmed
translation.

---

## What was removed

Four routes per card, plus their sitemap entries:

| Route | What replaced it |
|---|---|
| `/products/[slug]/fr` | The **FR** toggle on `/products/[slug]` |
| `/products/[slug]/fr/index.md` | `/products/[slug]/index.md` (English) |
| `/products/[slug]/ja` | The **JP** toggle on `/products/[slug]` |
| `/products/[slug]/ja/index.md` | `/products/[slug]/index.md` (English) |

All four now `308` to their English counterpart (`next.config.ts` →
`redirects()`), so previously-indexed URLs consolidate onto the canonical
page rather than becoming soft-404s.

Also gone: the `alternates.languages` hreflang block in the product page's
`generateMetadata`, and the French entries in `sitemap.ts`.

**No card data was lost.** `getFrenchCardText`, `getJapaneseCardText` and
`getOnePieceJapaneseText` are all still called, still on every product page,
and their output is still rendered — see `localeVariantsFor()` in
`src/app/products/[slug]/page.tsx`.

## Why — the actual reason, which is API quota, not SEO

This app runs entirely on free tiers:

| Service | Cap | Backs |
|---|---|---|
| PokéWallet | 100/hour, 1,000/day | Japanese Pokémon identity |
| BerryWallet | 100/hour, 1,000/day | One Piece identity (EN + JA) |
| apitcg | 1,000/**month** | Price history for every card |
| eBay Browse | 5,000/day | Graded-market listings |
| Lobstr.io | 100 results/month | Vinted scrape |

Each localized route was a **separate static-generation render scope**, and
`next build` spreads those across worker processes. The Japanese resolvers'
memoization (`lib/memo-fetch.ts`) is per-process, and Next's own fetch Data
Cache does not reliably survive that parallelism — which is precisely why
`lib/build-cache.ts` exists and says so in its own header.

So four extra routes per card meant the same PokéWallet or BerryWallet
lookup could be paid for once per worker per route instead of once per card.
Each route also had its **own** `generateStaticParams`, which called those
same resolvers again for every card before rendering anything.

Collapsing to one route removed those scopes outright, and — because
nothing's *existence* depends on the translation answer any more — made it
safe to put all three resolvers behind `buildCached`, which was previously
unsafe: a cached fallback would have suppressed a card's real `/ja` page for
the whole cache window even after the upstream recovered. Now the worst case
is an inert JP flag on a page that builds identically either way.

## What has to come back, in order

1. **Per-language URLs.** `/fr/products/[slug]` and `/ja/products/[slug]`
   (locale-first paths, not the old suffix form — a suffix under the
   canonical product path is hard to distinguish from a product variant, and
   makes robots/sitemap segmentation awkward). Remove the matching `308`s in
   `next.config.ts` when this lands.
2. **A real quota budget for them first.** Re-adding routes re-adds render
   scopes. Before doing it, check `scripts/api-budget-report.mjs` output
   against `BUDGETS` in `src/lib/api-budget.ts` and confirm the headroom is
   actually there at the then-current tracked-card count. If it isn't, a
   paid tier is the honest prerequisite, not a cleverer cache.
3. **`hreflang` on top of (1).** Reciprocal `alternates.languages` on all
   three pages, `x-default` on English, and every entry still gated on a
   confirmed translation — a card with no real French source gets no `fr`
   alternate, same rule the removed code already followed.
4. **Sitemap entries** for the new URLs, canonical-only.
5. **Localized chrome.** Still English today, deliberately: labels, price
   panel headings and `card.description` have no French or Japanese source,
   and inventing one is exactly the fabrication `lib/illustrative.ts` exists
   to prevent. Real per-language pages need real translated UI strings, which
   is its own piece of work.
6. **Restore `check-static-routes.mjs` gates** for the new routes, including
   the upstream-outage exemptions that were removed with them — a route whose
   only source is down has legitimately nothing to prerender, and that must
   not fail a deploy.
7. **`cardToMarkdown`'s `display` parameter** (`src/lib/markdown.ts`) is
   already the right shape for localized markdown mirrors and was kept for
   this. It currently has no caller.

## What is genuinely lost until then

Honest accounting, not a list of things that don't matter:

- **No language-targeted organic search.** A French search for "Lugia V prix"
  can only ever land on the English page. Nothing tells Google a French
  rendering exists.
- **The French and Japanese content is not in the initial HTML.** Variants
  travel in the RSC payload and render on toggle, so a crawler that doesn't
  run the toggle never sees them. That is the correct behaviour for a single
  canonical English URL — and it is also exactly why this is deferred work
  rather than finished work.
- **Any accumulated ranking on the old `/fr` URLs** is being consolidated by
  the `308`s, not preserved in place.

This trade was taken with eyes open: with the tracked-card count growing and
every upstream on a free tier, a build that stays inside quota and renders 9
correct cards is worth more right now than three URLs per card that risk
exhausting the Japanese identity source that makes one of them real.

---

## Settled: Japanese promo prints have no available source

Investigated 2026-08-29 after a real PSA-graded Japanese **OP09-061 (2nd
Anniversary Set)** turned up, contradicting the code's assumption that no
such card existed. The card is real. We still cannot show it, and this is
now a closed question rather than an open bug.

**Affected:** `monkey-d-luffy-op09-061` and `monkey-d-luffy-p-033` — both
promo products, both with a permanently inert JP toggle. Every ordinary
tiered print (V.1–V.4) resolves Japanese correctly; only promos are affected.

**What was checked**

| Source | Result |
|---|---|
| BerryWallet `/op/search` | English-only — see below |
| BerryWallet JP promo sets | `CM-PREMIUM-BANDAI`, `CM-UNNUMBERED-JP` (incl. hidden page 2), `CM-PRODUCTS`, `CM-PROMO-JP`, `CM-REPRINTS`, `CM-SPECIAL-PROMOS`, `CM-SPECIAL-PROMOS-JP` — no match |
| BerryWallet `OP09-JP` | Holds only the V.1/V.2 mainline prints, not the promo |
| TCGGO (Cardmarket API) | **No Japanese data at all** |
| Cardmarket website | Has the products — but no API we hold exposes them |

Not exhaustively checked: the 25 numbered JP sets (`OP01-JP`…`OP16-JP`,
`ST-*`, `EB-*`). An anniversary promo living in a numbered mainline set
would be surprising, and the cost to rule it out is ~25 metered calls.

**Two method traps that cost real time — don't repeat them**

1. **`searchCards` does not return Japanese rows.** Its doc comment claimed
   the index was "language-blind" with both languages "interleaved". A
   control disproved it: Shanks OP09-004 has a confirmed Japanese print, yet
   `searchCards` returned 9 rows, all English. Absence there proves nothing.
   The comment is now corrected in `lib/berrywallet.ts`.
2. **Japanese rows have Latin names.** Testing for CJK characters is not a
   language test — `CM-UNNUMBERED-JP` ("Unnumbered Promos (Japanese)")
   contains zero CJK names. Language lives on the **set**, never the row.

**Consequence for the toggle.** Showing nothing is correct, and actively
protects against a real prior bug: the old "highest V-number" guess rendered
the unrelated V.2 Parallel print for OP09-061. An inert flag beats the wrong
card.

**What would change this:** a source with a real Japanese promo catalogue.
TCGGO is not it, and neither is anything currently wired in.
