/**
 * Real Vinted France search-results link — confirmed URL pattern (live
 * fetch, not guessed): vinted.fr/catalog?search_text=<query>. No API key or
 * auth needed for a plain search link, same shape as ebay-search.ts's
 * conditionSearchLink: a real, working URL a human can click through to,
 * not itemized data.
 */
export function vintedSearchLink(query: string): string {
  return `https://www.vinted.fr/catalog?${new URLSearchParams({ search_text: query })}`;
}
