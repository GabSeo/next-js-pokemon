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
 * The first path segment is taken to be Cardmarket's UI language and nothing
 * else — the PRODUCT identified by the set and card slugs after it, so
 * /it/OnePiece/Products/Singles/... and /en/OnePiece/Products/Singles/... are
 * the same page in two languages.
 *
 * The evidence is ONE product observed under two different locale prefixes
 * with identical slugs after them: Monkey D. Luffy OP09-061's Unnumbered
 * Promos listing, which BerryWallet returns as
 * `/it/OnePiece/Products/Singles/Unnumbered-Promos/MonkeyDLuffy-OP09-061` and
 * which was found by hand on Cardmarket as the same path under `/fr/`. A
 * `-Japanese` set was confirmed the same way, by hand, under `/en/`
 * (`/en/OnePiece/Products/Singles/Promos-Japanese/MonkeyDLuffy-P-033-V2`), so
 * the Japanese sets are reachable in English too and not only in the locale
 * that happened to return them.
 *
 * An earlier version of this comment claimed the same thing on worse evidence
 * — two DIFFERENT products (sv3134 and OBF223) that merely sat under different
 * locales, which shows the site serves both locales, not that one product
 * resolves under either. Recorded because the claim was right and the proof
 * was not, and that is the kind of thing that survives unexamined.
 *
 * Cardmarket cannot be checked from here to re-confirm it: it answers
 * automated requests with a CDN bot challenge (403 to every URL, valid ones
 * included), which is not worked around. If a link is ever reported dead,
 * delete the `.replace(...)` below and return `raw` — the upstream URL is real
 * as given, and the only cost is that One Piece links open in Italian.
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
