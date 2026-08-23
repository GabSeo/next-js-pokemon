import { computeAlertBands, downsamplePriceHistory, getAllCards, getCardsByFranchise, franchiseLabel } from "@/lib/cards";
import { cardRefs } from "@/data/card-refs";
import { getGradedMarketData } from "@/lib/graded-market";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import type { Card, Franchise } from "@/lib/types";

function priceRangeMarkdown(card: Card): string {
  if (!card.priceRange) return "No price range available yet.";
  const { low, high, lowDate, highDate, from, to } = card.priceRange;
  return `Low: ${card.currency} ${low} (${lowDate}) · High: ${card.currency} ${high} (${highDate})
Covers available history from ${from} to ${to}.`;
}

/**
 * Same data as GradedMarketPanel (components/retro/graded-market-panel.tsx)
 * via lib/graded-market.ts's shared getGradedMarketData — one fetch path,
 * so the markdown mirror can never show different numbers than the HTML
 * page. Every value is explicitly marked Real or Preview so an agent
 * reading this file doesn't need to guess.
 */
async function gradedMarketMarkdown(card: Card): Promise<string> {
  const data = await getGradedMarketData(card);
  const rows = data.conditions
    .flatMap((c) =>
      c.languages.map((l) => {
        const activeSource = l.active.isReal ? `Real, eBay (${l.active.count} total)` : `Preview (${l.active.count} est.)`;
        return `| ${c.condition} | ${l.language} | ${l.active.currency} ${l.active.medianPrice} | ${activeSource} | ${l.sold.currency} ${l.sold.medianPrice} |`;
      })
    )
    .join("\n");

  const { roi } = data;
  const roiSource = roi.isReal ? "real active listings, English" : "preview numbers, eBay not connected yet";

  const vintedRows = data.vinted.rows
    .map(
      (r) =>
        `| ${r.timeAgo || "unknown"} | ${r.condition} | ${r.currency} ${r.price} | ${r.dealPct > 0 ? "+" : ""}${r.dealPct}% (${r.dealTier}) | ${r.url ? `[${r.title ?? "listing"}](${r.url})` : "—"} |`
    )
    .join("\n");

  const vintedSource = data.vinted.isReal
    ? `Real listings, scraped from Vinted via Lobstr.io. Asking prices on active listings, not completed sales.`
    : `Preview — no scraped Vinted listings for this card yet (no finished scrape run, or nothing currently listed in ${data.vinted.conditionFilter}). Every row below is illustrative, not real data.`;

  return `## Pokémon market overview

### English / Japanese (eBay) — up to 4 recent active listings + illustrative sold, per condition x market

| Condition | Market | Active median | Active source | Sold median (illustrative) |
| --- | --- | --- | --- | --- |
${rows}

Grading ROI, raw → PSA 10: ${roi.percent >= 0 ? "+" : ""}${roi.percent.toFixed(0)}% (${roiSource}). ${roi.currency} ${roi.rawMedian} raw + ${roi.currency} ${roi.gradingCostUsd} grading vs ${roi.currency} ${roi.psa10Median} PSA 10. Always computed from English active listings.

Sold data is always illustrative: eBay's sold/completed-listing API (Marketplace Insights) is restricted and closed to new applicants — see lib/ebay-browse.ts.

### France (Vinted) — "${data.vinted.conditionFilter}" listings only

eBay.fr isn't a good fit for the French Pokémon TCG market, so the French market view is a Vinted listing feed instead of PSA grades — no grading, no active/sold split (Vinted has no public sold feed).

**This feed is filtered to one condition: ${data.vinted.conditionFilter}.** Listings in Vinted's other condition tiers (Bon état, Satisfaisant, Neuf avec/sans étiquette) are excluded — by Vinted itself, via the status_ids[]=2 filter on the search this scrapes. It answers "what is listed in ${data.vinted.conditionFilter}", not "what does this market look like".

${vintedSource} Average asking price: ${data.vinted.currency} ${data.vinted.avgPrice} across ${data.vinted.rows.length} listings; ${data.vinted.belowAverageCount} of them priced below it. Listings priced at ${data.vinted.currency} 1 are excluded before this is computed: on Vinted that is a hidden auction soliciting private offers, not an asking price.

| Listed | Condition | Price | vs. average | Listing |
| --- | --- | --- | --- | --- |
${vintedRows}

Search on Vinted (same ${data.vinted.conditionFilter} filter applied): ${data.vinted.searchUrl}`;
}

/**
 * `display` overrides only what's actually shown for the identity fields
 * (name/set/rarity) — everything else (price, history, description,
 * graded-market data) always comes from `card` itself. This is what backs
 * the /products/[slug]/fr/index.md mirror: gradedMarketMarkdown(card) below
 * must keep receiving the real English `card` (its French search term comes
 * from `card.tcgdexId`, not from the display name — see graded-market.ts),
 * so a `display` override is layered on top rather than baked into `card`.
 */
export async function cardToMarkdown(
  card: Card,
  display: Pick<Card, "name" | "set" | "rarity"> = card,
  pagePath: string = `/products/${card.slug}`
): Promise<string> {
  // Downsampled to 25 evenly-spaced points, same as the JSON mirror
  // (toPublicCard) — see downsamplePriceHistory's doc comment.
  const history = downsamplePriceHistory(card.priceHistory)
    .map((p) => `- ${p.date}: ${card.currency} ${p.price}`)
    .join("\n");

  const snapshots = card.recentSnapshots
    .map((s) => `| ${s.date} | ${card.currency} ${s.price} | ${s.source} |`)
    .join("\n");

  const trendRows = (
    [
      { label: "1 day", price: card.trend.day1 },
      { label: "7 days", price: card.trend.day7 },
      { label: "30 days", price: card.trend.day30 },
      { label: "3 months", price: card.trend.day90 },
    ] satisfies { label: string; price: number | null }[]
  )
    .map((row) => `| ${row.label} | ${row.price === null ? "—" : `${card.currency} ${row.price}`} |`)
    .join("\n");

  const gradedMarket = await gradedMarketMarkdown(card);

  return `# ${display.name} — ${display.set} (${card.number ?? ""})

Franchise: ${franchiseLabel(card.franchise)}
Card ID: ${card.id}
Set: ${display.set}${card.setCode ? ` (${card.setCode})` : ""}
Rarity: ${display.rarity ?? "Unknown"}
Canonical page: ${absoluteUrl(pagePath)}
Markdown: ${absoluteUrl(`${pagePath}/index.md`)}
Last updated: ${card.asOfDate}

## Summary

${card.description ?? `${display.name} — ${display.set} (${card.number ?? ""}).`}

## Current price

${card.currency} ${card.currentPrice} as of ${card.asOfDate}. Source: [TCGPlayer](${card.sourceUrl ?? "https://www.tcgplayer.com"}).

## Price history

${history || "No history available yet."}

## Recent price snapshots

Daily market price records (not itemized individual sales):

| Date | Price | Source |
| --- | --- | --- |
${snapshots || "| - | - | - |"}

## Price trend (average price by window)

| Window | Average price |
| --- | --- |
${trendRows}

## Price range

${priceRangeMarkdown(card)}

${gradedMarket}

## Machine-readable data

JSON: ${absoluteUrl(`/api/${card.franchise}/${card.id}`)}
Price-check tool: ${absoluteUrl(`/api/price-check?cardId=${card.id}`)}

## More cards

Collection: ${absoluteUrl(`/collections/${card.franchise}`)} (JSON: ${absoluteUrl(`/api/${card.franchise}`)})
Full agent index (every card, tools, MCP server): ${absoluteUrl("/llms.txt")}
`;
}

export async function collectionToMarkdown(franchise: Franchise): Promise<string> {
  const cards = await getCardsByFranchise(franchise);
  const label = franchiseLabel(franchise);
  const rows = cards
    .map(
      (c) =>
        `- **${c.name}** (${c.number ?? ""}, ${c.rarity ?? "Unknown"}) — ${c.currency} ${c.currentPrice} — ${absoluteUrl(
          `/products/${c.slug}`
        )}`
    )
    .join("\n");

  return `# ${label} Collection

Canonical page: ${absoluteUrl(`/collections/${franchise}`)}
Markdown: ${absoluteUrl(`/collections/${franchise}/index.md`)}
JSON: ${absoluteUrl(`/api/${franchise}`)}

## Cards (${cards.length})

${rows}
`;
}

/**
 * Markdown mirror of a single /tools/price-checker?cardId=X result. Mirrors
 * the shape of the /api/price-check JSON response (includes alert bands),
 * rather than duplicating cardToMarkdown verbatim — the tool's answer is a
 * distinct thing from the plain product record. Points back to the product
 * page as the canonical source for the card itself.
 */
export async function priceCheckResultMarkdown(card: Card): Promise<string> {
  const bands = computeAlertBands(card.currentPrice);
  const bandRows = bands
    .map((b) => `| ${b.pct > 0 ? "+" : ""}${b.pct}% | ${card.currency} ${b.price} |`)
    .join("\n");

  const snapshots = card.recentSnapshots
    .map((s) => `| ${s.date} | ${card.currency} ${s.price} | ${s.source} |`)
    .join("\n");

  const trendRows = (
    [
      { label: "1 day", price: card.trend.day1 },
      { label: "7 days", price: card.trend.day7 },
      { label: "30 days", price: card.trend.day30 },
      { label: "3 months", price: card.trend.day90 },
    ] satisfies { label: string; price: number | null }[]
  )
    .map((row) => `| ${row.label} | ${row.price === null ? "—" : `${card.currency} ${row.price}`} |`)
    .join("\n");

  const gradedMarket = await gradedMarketMarkdown(card);

  return `# Price checker result — ${card.name} (${card.number ?? ""})

Card ID: ${card.id}
Franchise: ${franchiseLabel(card.franchise)}
Current price: ${card.currency} ${card.currentPrice} as of ${card.asOfDate}
Product page (canonical): ${absoluteUrl(`/products/${card.slug}`)}
Product markdown: ${absoluteUrl(`/products/${card.slug}/index.md`)}

## Alert bands (25% steps, -75% to +150% of current price)

| Band | Trigger price |
| --- | --- |
${bandRows}

## Recent price snapshots

| Date | Price | Source |
| --- | --- | --- |
${snapshots || "| - | - | - |"}

## Price trend (average price by window)

| Window | Average price |
| --- | --- |
${trendRows}

## Price range

${priceRangeMarkdown(card)}

${gradedMarket}

## Machine-readable data

JSON: ${absoluteUrl(`/api/price-check?cardId=${card.id}`)}
`;
}

/**
 * Just an id+name index — doesn't need live price data, so it's built
 * straight from cardRefs instead of resolving the whole catalog against
 * apitcg.com (this route has no ?cardId, so nothing else on the page would
 * need a live call either).
 */
export async function priceCheckerMarkdown(): Promise<string> {
  const rows = cardRefs
    .map((ref) => `- ${ref.slug} — ${ref.displayName} (${franchiseLabel(ref.franchise)})`)
    .join("\n");

  return `# Price checker tool

Human page: ${absoluteUrl("/tools/price-checker")}
API: GET ${absoluteUrl("/api/price-check")}?cardId=<card id>

Call the API with a card ID to receive JSON containing current price,
recent daily price snapshots, price history, and alert bands in 25% steps
from -75% to +150% of the current price.

## Available card IDs

${rows}
`;
}

export async function homepageMarkdown(): Promise<string> {
  const cards = await getAllCards();
  const rows = cards
    .map(
      (c) =>
        `- ${franchiseLabel(c.franchise)} — **${c.name}** (${c.number ?? ""}) — ${c.currency} ${c.currentPrice} — ${absoluteUrl(`/products/${c.slug}`)}`
    )
    .join("\n");

  return `# ${SITE_NAME}

${SITE_DESCRIPTION}

## Collections

- Pokémon: ${absoluteUrl("/collections/pokemon")} (Markdown: ${absoluteUrl("/collections/pokemon/index.md")}, JSON: ${absoluteUrl("/api/pokemon")})
- One Piece: ${absoluteUrl("/collections/one-piece")} (Markdown: ${absoluteUrl("/collections/one-piece/index.md")}, JSON: ${absoluteUrl("/api/one-piece")})

## All cards (${cards.length})

${rows}

## Price-checker tool

Human page: ${absoluteUrl("/tools/price-checker")}
Markdown: ${absoluteUrl("/tools/price-checker.md")}
API: ${absoluteUrl("/api/price-check?cardId=<card id>")}

## Full agent index

${absoluteUrl("/llms.txt")}
`;
}
