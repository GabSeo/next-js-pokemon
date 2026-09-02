/**
 * Fallback Cardmarket link, for a card whose upstream carries no real product
 * URL of its own. A game landing page on purpose: a guessed
 * /Products/Search?searchString= URL was tried and confirmed broken by hand.
 *
 * Per franchise, because it was previously a single Pokémon constant and every
 * One Piece card without a mapped product sent its reader to the Pokémon
 * catalogue — a wrong page dressed as a working link.
 *
 * Most cards never reach this. BerryWallet and PokéWallet both return a real
 * per-product `product_url`, which `cardmarketUrl` below normalises.
 */
export function cardmarketHomepage(franchise: "pokemon" | "one-piece"): string {
  return franchise === "one-piece"
    ? "https://www.cardmarket.com/en/OnePiece"
    : "https://www.cardmarket.com/en/Pokemon";
}

/**
 * Cardmarket's own product URL, forced onto the English locale.
 *
 * The first path segment is Cardmarket's UI language and nothing else — the
 * PRODUCT is identified by the set and card slugs after it, so
 * /it/OnePiece/Products/Singles/... and /en/OnePiece/Products/Singles/... are
 * the same page in two languages. Confirmed against Cardmarket's own URLs for
 * one card in two locales: only the leading segment differs.
 *
 * It has to be normalised because the upstreams disagree. BerryWallet returns
 * Italian URLs (`/it/…`) for One Piece while PokéWallet returns English ones,
 * so links on this site landed in different languages depending on which API
 * happened to answer — with no relationship to the reader or the card.
 *
 * Anything that is not a recognisable Cardmarket product URL is returned
 * untouched rather than rewritten on a guess.
 */
export function cardmarketUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/^(https:\/\/(?:www\.)?cardmarket\.com)\/[a-z]{2}\//i, "$1/en/");
}
