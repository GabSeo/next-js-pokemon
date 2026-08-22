import type { Card } from "@/lib/types";

/**
 * Real, working eBay search-result links — not itemized data, since no API
 * (TCGGO included) exposes active/open eBay listings, only completed sales.
 * See tcggo-integration-plan.md §2.4: three query variants stand in for
 * "3 links a user can click" without needing eBay's own developer API.
 *
 * Deliberately no `LH_Sold`/`LH_Complete` params — those filter *to*
 * completed listings, the opposite of what "active" means here. Plain
 * `_nkw` search, so the default result set is current/active inventory.
 */
export type EbaySearchLink = { label: string; href: string };

function ebaySearchUrl(query: string): string {
  const qs = new URLSearchParams({ _nkw: query });
  return `https://www.ebay.com/sch/i.html?${qs}`;
}

export function activeListingSearchLinks(card: Card): EbaySearchLink[] {
  const base = `${card.name} ${card.set}${card.number ? ` ${card.number}` : ""}`.trim();
  return [
    { label: "Shop PSA 10 listings", href: ebaySearchUrl(`${base} PSA 10`) },
    { label: "Shop graded listings", href: ebaySearchUrl(`${base} graded`) },
    { label: "Shop raw/ungraded listings", href: ebaySearchUrl(base) },
  ];
}
