import { computeAlertBands, getAllCards, getCardsByFranchise, franchiseLabel } from "@/lib/cards";
import { cardRefs } from "@/data/card-refs";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import type { Card, Franchise } from "@/lib/types";

function priceRangeMarkdown(card: Card): string {
  if (!card.priceRange) return "No price range available yet.";
  const { low, high, lowDate, highDate, from, to } = card.priceRange;
  return `Low: ${card.currency} ${low} (${lowDate}) · High: ${card.currency} ${high} (${highDate})
Covers available history from ${from} to ${to}.`;
}

export function cardToMarkdown(card: Card): string {
  const history = card.priceHistory
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

  return `# ${card.name} — ${card.set} (${card.number ?? ""})

Franchise: ${franchiseLabel(card.franchise)}
Card ID: ${card.id}
Set: ${card.set}${card.setCode ? ` (${card.setCode})` : ""}
Rarity: ${card.rarity ?? "Unknown"}
Canonical page: ${absoluteUrl(`/products/${card.slug}`)}
Markdown: ${absoluteUrl(`/products/${card.slug}/index.md`)}
Last updated: ${card.asOfDate}

## Summary

${card.description ?? `${card.name} — ${card.set} (${card.number ?? ""}).`}

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

## Machine-readable data

JSON: ${absoluteUrl(`/api/${card.franchise}/${card.id}`)}
Price-check tool: ${absoluteUrl(`/api/price-check?cardId=${card.id}`)}
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
export function priceCheckResultMarkdown(card: Card): string {
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
