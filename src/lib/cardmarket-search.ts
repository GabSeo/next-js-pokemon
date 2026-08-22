/**
 * Placeholder Cardmarket link — deliberately just the homepage, not a
 * per-card deep link. A guessed /Products/Search?searchString= URL was
 * tried and confirmed broken by hand; a correct direct product URL
 * (e.g. /Products/Singles/{set-slug}/{card-slug}) needs Cardmarket's own
 * product slugs, which aren't available yet. TCGGO's API already returns
 * a real per-card `links.cardmarket` field (see TcggoCard in lib/tcggo.ts)
 * — swap this constant for that once the TCGGO integration is wired in.
 */
export const CARDMARKET_HOMEPAGE_URL = "https://www.cardmarket.com/en/Pokemon";
