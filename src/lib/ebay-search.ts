import type { Card } from "@/lib/types";

function ebaySearchUrl(query: string): string {
  const qs = new URLSearchParams({ _nkw: query });
  return `https://www.ebay.com/sch/i.html?${qs}`;
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
  const base = `${card.name} ${card.set}${card.number ? ` ${card.number}` : ""}`.trim();
  return ebaySearchUrl(condition === "Raw" ? base : `${base} ${condition}`);
}
