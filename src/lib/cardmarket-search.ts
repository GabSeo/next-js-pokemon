import type { Card } from "@/lib/types";

/**
 * Cardmarket search-result link — same "real search, not a fake deep link"
 * pattern as lib/ebay-search.ts. NOT independently verified end-to-end like
 * the eBay link was: Cardmarket's bot-protection returned 403 on both a
 * headless-browser check and a plain curl request while building this, so
 * the URL pattern below is unconfirmed from this environment (a real human
 * browser will very likely get through fine — this is generic anti-
 * automation blocking, not evidence the URL itself is wrong).
 *
 * Pokémon only for now: the `/en/Pokemon/...` path is a well-documented
 * public URL pattern. Cardmarket's exact game-slug for One Piece TCG
 * couldn't be confirmed the same way, so this returns undefined for
 * one-piece cards rather than guess and risk a dead link.
 */
export function cardmarketSearchLink(card: Card): string | undefined {
  if (card.franchise !== "pokemon") return undefined;
  const query = `${card.name} ${card.set}`.trim();
  const qs = new URLSearchParams({ searchString: query });
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?${qs}`;
}
