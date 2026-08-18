import { getAllCards, getCardsByFranchise, franchiseLabel } from "@/lib/cards";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import type { Card, Franchise } from "@/lib/types";

export function cardToMarkdown(card: Card): string {
  const history = card.priceHistory
    .map((p) => `- ${p.date}: ${card.currency} ${p.price}`)
    .join("\n");

  const sales = card.recentSales
    .map(
      (s) =>
        `| ${s.date} | ${card.currency} ${s.price} | ${s.condition} | ${s.source} |`
    )
    .join("\n");

  return `# ${card.name} — ${card.set} (${card.number})

Franchise: ${franchiseLabel(card.franchise)}
Card ID: ${card.id}
Set: ${card.set} (${card.setCode})
Rarity: ${card.rarity}
Canonical page: ${absoluteUrl(`/products/${card.slug}`)}
Markdown: ${absoluteUrl(`/products/${card.slug}/index.md`)}
Last updated: ${card.lastSoldDate}

## Summary

${card.description}

## Current price

${card.currency} ${card.currentPrice} as of ${card.lastSoldDate}.

## Price history

${history}

## Last sold items

| Date | Price | Condition | Source |
| --- | --- | --- | --- |
${sales}

## Machine-readable data

JSON: ${absoluteUrl(`/api/${card.franchise}/${card.id}`)}
Price-check tool: ${absoluteUrl(`/api/price-check?cardId=${card.id}`)}
`;
}

export function collectionToMarkdown(franchise: Franchise): string {
  const cards = getCardsByFranchise(franchise);
  const label = franchiseLabel(franchise);
  const rows = cards
    .map(
      (c) =>
        `- **${c.name}** (${c.number}, ${c.rarity}) — ${c.currency} ${c.currentPrice} — ${absoluteUrl(
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

export function priceCheckerMarkdown(): string {
  const cards = getAllCards();
  const rows = cards
    .map((c) => `- ${c.id} — ${c.name} (${franchiseLabel(c.franchise)})`)
    .join("\n");

  return `# Price checker tool

Human page: ${absoluteUrl("/tools/price-checker")}
API: GET ${absoluteUrl("/api/price-check")}?cardId=<card id>

Call the API with a card ID to receive JSON containing current price,
last-sold date, price history, recent sales, and the ±50% alert bands
(from -150% to +150% of the current price).

## Available card IDs

${rows}
`;
}

export function homepageMarkdown(): string {
  const cards = getAllCards();
  const rows = cards
    .map(
      (c) =>
        `- ${franchiseLabel(c.franchise)} — **${c.name}** (${c.number}) — ${c.currency} ${c.currentPrice} — ${absoluteUrl(`/products/${c.slug}`)}`
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
