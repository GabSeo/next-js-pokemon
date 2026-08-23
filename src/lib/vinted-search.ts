/**
 * Real Vinted France search-results link — confirmed URL pattern (live
 * fetch, not guessed): vinted.fr/catalog?search_text=<query>. No API key or
 * auth needed for a plain search link, same shape as ebay-search.ts's
 * conditionSearchLink: a real, working URL a human can click through to.
 *
 * This is now doing double duty. It's still the "Search on Vinted" button's
 * destination, and it's ALSO the task URL Lobstr's scraper is pointed at
 * (see lib/vinted-listings.ts's vintedQueryForCard, which is the only
 * caller) — one function, so what gets scraped and what a human clicks
 * through to can never drift apart.
 *
 * Deliberately unfiltered: no condition/status param. The "Très bon état"
 * filter this site applies is enforced on the scraped condition text
 * instead (lib/vinted-listings.ts explains why — Vinted's status ids aren't
 * documented anywhere this integration could verify, and a wrong id would
 * silently scrape the wrong tier). It also means the link a human clicks
 * shows them the whole market, which is the right behaviour for a
 * click-through even though the on-page feed is narrower.
 */
export function vintedSearchLink(query: string): string {
  return `https://www.vinted.fr/catalog?${new URLSearchParams({ search_text: query })}`;
}
