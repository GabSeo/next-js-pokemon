import { getAllCards, getCardsByFranchise, franchiseLabel } from "@/lib/cards";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import type { Card, Franchise } from "@/lib/types";

export function cardToMarkdown(card: Card): string {
  const history = card.priceHistory
    .map((p) => `- ${p.date}: ${card.currency} ${p.price}`)
    .join("\n");

  const snapshots = card.recentSnapshots
    .map((s) => `| ${s.date} | ${card.currency} ${s.price} | ${s.source} |`)
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

export async function priceCheckerMarkdown(): Promise<string> {
  const cards = await getAllCards();
  const rows = cards
    .map((c) => `- ${c.id} — ${c.name} (${franchiseLabel(c.franchise)})`)
    .join("\n");

  return `# Price checker tool

Human page: ${absoluteUrl("/tools/price-checker")}
API: GET ${absoluteUrl("/api/price-check")}?cardId=<card id>

Call the API with a card ID to receive JSON containing current price,
recent daily price snapshots, price history, and the ±50% alert bands
(from -150% to +150% of the current price).

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
