/**
 * One place to decide how a card's price is worded when there *is* no
 * price. A card whose price sources were all unreachable carries
 * `priceUnavailable` and a placeholder `currentPrice` of 0 (see
 * placeholderCard in lib/cards.ts); printing that 0 anywhere — a tile, a
 * meta description, a markdown mirror, an MCP tool result — states as fact
 * that the card is worth nothing. Every surface routes through here
 * instead.
 */

import type { Card } from "@/lib/types";

/**
 * Terse price for a label, table cell or list row. `unavailable` is the
 * text to substitute when there's no price, so each caller can match its
 * own register (a dash in a dense grid, words in prose).
 */
export function priceLabel(card: Card, unavailable = "Unavailable"): string {
  return card.priceUnavailable ? unavailable : `${card.currency} ${card.currentPrice}`;
}

/**
 * Full sentence for prose contexts — meta descriptions, FAQ answers, the
 * markdown mirrors, MCP tool text. Says plainly that the number is missing
 * and why, rather than omitting the subject and leaving a reader (or a
 * model quoting the page) to assume the last price they saw still holds.
 */
export function priceStatement(card: Card): string {
  return card.priceUnavailable
    ? "Market price temporarily unavailable — no price source could be reached for this card."
    : `Current market price: ${card.currency} ${card.currentPrice} as of ${card.asOfDate}.`;
}
