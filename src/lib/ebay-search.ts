import type { Card } from "@/lib/types";

function ebaySearchUrl(query: string): string {
  const qs = new URLSearchParams({ _nkw: query });
  return `https://www.ebay.com/sch/i.html?${qs}`;
}

/**
 * Search terms shared by the real eBay Browse API query (lib/ebay-browse.ts)
 * and the plain search-link fallback below — name + just the card's number
 * (e.g. "271", not "271/264" — sellers virtually never include the set
 * total in their listing titles). Deliberately drops the set name: real
 * listing titles like "Gengar VMAX Fusion Strike 271/264 PSA 9" already
 * exist, but including our own set name in the query (e.g. "SWSH08: Fusion
 * Strike") over-constrains eBay's text match and misses real matches whose
 * titles phrase the set differently or omit it — confirmed by hand-testing
 * real eBay searches, where name + number alone returned better/more
 * results than name + set + number.
 */
export function cardSearchTerms(card: Card): string {
  const primaryNumber = card.number?.split("/")[0];
  return `${card.name}${primaryNumber ? ` ${primaryNumber}` : ""}`.trim();
}

/**
 * Per-condition-tier fallback link — used by GradedMarketPanel when the real
 * eBay Browse API search for that specific tier isn't available (no
 * credentials, request failed, no results), so there's still a real,
 * working place to click through to instead of an empty cell. Deliberately
 * no `LH_Sold`/`LH_Complete` params — those filter *to* completed listings,
 * the opposite of "active"; plain `_nkw` search so the default result set is
 * current/active inventory.
 */
export function conditionSearchLink(card: Card, condition: "PSA 10" | "PSA 9" | "PSA 8" | "Raw"): string {
  const base = cardSearchTerms(card);
  return ebaySearchUrl(condition === "Raw" ? base : `${base} ${condition}`);
}
