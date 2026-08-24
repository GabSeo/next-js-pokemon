/**
 * TCGdex — free, open, no-API-key REST database for the Pokémon TCG
 * (https://tcgdex.dev). Pokémon only: it has no One Piece coverage, so
 * lib/cards.ts only ever calls this for `tcg === "pokemon"` refs. It also
 * carries no price data at all (that stays apitcg.ts's job) — this client
 * only ever supplies card *metadata*: name, set, number, rarity, image, and
 * localized names in the languages it supports.
 *
 * Card ids are stable across languages (`{setId}-{localId}`, e.g.
 * "swsh3-136") — the same id fetched under a different language path
 * returns the same card with a translated `name`, which is what makes the
 * localized-name lookup below possible without a second search.
 *
 * Confirmed against TCGdex's own docs (tcgdex.dev/reference/card,
 * tcgdex.dev/reference/set, tcgdex.dev/rest/cards, tcgdex.dev/rest/card):
 * supported languages are en/fr/es/de/it/pt — no Japanese, which is why
 * `nameOverride` in ebay-search.ts/ebay-browse.ts is documented as a French
 * (not Japanese) concern. `set.id` (e.g. "swsh3") is the closest thing to a
 * short set code; there's no separate `code` field on the Set object.
 */

const API_BASE = "https://api.tcgdex.net/v2";

/**
 * Fails a hung request fast rather than eating fetch's platform default
 * (10s) — see apitcg.ts's own FETCH_TIMEOUT_MS comment for the production
 * incident that motivated this: TCGdex being unreachable during a build
 * meant every card lookup, across every route needing one, independently
 * paid the full default timeout, stacking into enough dead time to blow
 * the build's time budget. Same value as apitcg.ts, for the same reason.
 */
const FETCH_TIMEOUT_MS = 6000;

/**
 * Matches apitcg.ts's own 36h REVALIDATE_SECONDS — deliberately, even
 * though the identity fields on this same response (name/set/rarity/
 * types/image) change far less often than that. TCGdex bundles identity
 * and live TCGplayer pricing in one combined /cards/{id} response (see
 * tcgplayerSnapshot's doc comment), so a single fetch() only gets one cache
 * window; price is what actually needs to stay fresh, so that's the window
 * that wins. This "wastes" a refetch of unchanged identity data every 36h,
 * but TCGdex has no published rate limit, so that costs nothing real — a
 * true split (identity cached ~1 year, price cached 36h) would need a
 * separate storage layer for identity data, not worth building for a
 * refetch that's free.
 */
const REVALIDATE_SECONDS = 60 * 60 * 36;

/** Languages TCGdex's card database actually supports — see file header. */
export type TcgdexLang = "en" | "fr" | "es" | "de" | "it" | "pt";

export type TcgdexCardBrief = {
  id: string;
  localId: string;
  name: string;
  image?: string;
};

export type TcgdexSetBrief = {
  id: string;
  name: string;
  /**
   * `official` is the set's base print-run size — the denominator printed
   * on the card itself (e.g. Gengar VMAX prints as "271/264": localId 271,
   * `cardCount.official` 264 — a secret rare numbered past the base count).
   * `total` includes secret rares and isn't what's printed on the card.
   * Confirmed against all 3 currently-tracked cards: `official` reproduces
   * apitcg's own full-fraction number exactly (271/264, 190/182, 186/195).
   */
  cardCount?: { official?: number; total?: number };
};

/**
 * One printed variant's TCGplayer snapshot (e.g. under the "holofoil" or
 * "normal" key of `pricing.tcgplayer` — see TcgdexPricing). Confirmed live
 * against api.tcgdex.net: not in TCGdex's published docs, only observed on
 * real card responses.
 */
export type TcgdexTcgplayerVariantPrice = {
  productId?: number;
  lowPrice?: number;
  midPrice?: number;
  highPrice?: number;
  marketPrice?: number;
  directLowPrice?: number;
};

/**
 * `pricing.tcgplayer` is keyed by print variant ("holofoil", "normal",
 * "reverseHolofoil", "1stEditionHolofoil", ...) alongside two fixed
 * metadata fields (`unit`, `updated`) — which variant keys exist depends on
 * how the card was actually printed, so this is a dynamic index rather than
 * a fixed set of named fields. `pricing.cardmarket` (EUR-denominated) is
 * deliberately left untyped/unused here: this site is USD-only throughout
 * (see Card["currency"] in lib/types.ts), and converting EUR to USD would
 * mean showing a number derived from a floating exchange rate as if it were
 * a real market price — not worth the accuracy risk apitcg.ts's own
 * comments are so careful about elsewhere.
 */
export type TcgdexPricing = {
  tcgplayer?: {
    unit?: string;
    updated?: string;
    [variant: string]: TcgdexTcgplayerVariantPrice | string | undefined;
  };
};

export type TcgdexCard = {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: "Pokemon" | "Trainer" | "Energy";
  rarity?: string;
  set: TcgdexSetBrief;
  pricing?: TcgdexPricing;
  /**
   * Only present on `category: "Pokemon"` cards (a Trainer/Energy card has
   * none) — and these are the Pokémon *TCG*'s own 11-type set, not the
   * video games' 18: confirmed live, TCGdex returns "Darkness" (not "Dark")
   * and "Fire". The TCG also uses "Lightning" (not Electric), "Metal" (not
   * Steel), and folds every game type outside its 11 into "Colorless" — see
   * lib/pokemon-types.ts for the full mapping this feeds into.
   */
  types?: string[];
};

/**
 * TCGdex's own docs (tcgdex.dev/markets-prices) say TCGplayer pricing here
 * is refreshed hourly — a tighter loop than apitcg.ts's 36h fetch window —
 * so this is the preferred `currentPrice` source for a Pokémon card when a
 * TCGdex match exists. apitcg.ts stays wired for the one thing TCGdex has
 * no equivalent for: a real daily price-history time series (TCGdex only
 * ever exposes trailing avg1/avg7/avg30 snapshots, not a raw series), which
 * is what the product-page chart and trend/priceRange calculations need.
 *
 * Picks the first variant (in whatever order the API returns them — most
 * cards only have one) with any of market/mid/low defined, then applies the
 * same market ?? mid ?? low fallback apitcg.ts's own `marketPrice()` uses,
 * for consistency between the two sources.
 *
 * Also returns a real TCGplayer product URL built from that same variant's
 * `productId` (`tcgplayer.com/product/{id}`, confirmed live to resolve —
 * TCGplayer accepts the bare numeric id with no slug) — this is what lets
 * apitcg's own `markets.tcgplayer.url` stop being needed for a Pokémon card
 * once TCGdex has matched it.
 */
export function tcgplayerSnapshot(card: TcgdexCard): { price?: number; updated?: string; url?: string } {
  const tcgplayer = card.pricing?.tcgplayer;
  if (!tcgplayer) return {};
  for (const [key, value] of Object.entries(tcgplayer)) {
    if (key === "unit" || key === "updated") continue;
    if (typeof value !== "object" || value === null) continue;
    const price = value.marketPrice ?? value.midPrice ?? value.lowPrice;
    if (price !== undefined) {
      return {
        price,
        updated: tcgplayer.updated,
        url: value.productId ? `https://www.tcgplayer.com/product/${value.productId}` : undefined,
      };
    }
  }
  return {};
}

async function tcgdexFetch<T>(lang: TcgdexLang, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${lang}${path}`, {
    next: { revalidate: REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`tcgdex request failed (${res.status}): /${lang}${path}`);
  }
  return res.json() as Promise<T>;
}

export async function getCard(id: string, lang: TcgdexLang = "en"): Promise<TcgdexCard | undefined> {
  try {
    return await tcgdexFetch<TcgdexCard>(lang, `/cards/${id}`);
  } catch {
    return undefined;
  }
}

/**
 * name + set-name + number lookup — mirrors apitcg.ts's
 * findProductByNameAndSet, which is the shape every current Pokémon CardRef
 * already provides (lookup.by === "nameSet"). Two-step: search by name
 * (fast, but the search endpoint only returns CardBrief — id/localId/
 * name/image, no set or rarity), then fetch the full card for the localId
 * match(es) to confirm the set name and get the rest of the fields.
 */
export async function findCardByNameAndSet(
  name: string,
  setName: string,
  number: string
): Promise<TcgdexCard | undefined> {
  const qs = new URLSearchParams({ name });
  const briefs = await tcgdexFetch<TcgdexCardBrief[]>("en", `/cards?${qs}`);
  const candidates = briefs.filter((b) => b.localId === number);

  for (const candidate of candidates) {
    const full = await getCard(candidate.id, "en");
    if (full?.set.name.toLowerCase().includes(setName.toLowerCase())) {
      return full;
    }
  }
  return undefined;
}

/**
 * The localized `name` for an already-known card id, in a language TCGdex
 * supports (see TcgdexLang) — used to build a more precise eBay search
 * query for non-English graded-market tabs than searching on the English
 * name would produce. Returns undefined (rather than throwing) on any
 * failure, same resilience shape as the rest of this file's callers expect:
 * a caller that can't get a localized name should silently fall back to the
 * English one, not break the page.
 */
export async function getLocalizedName(id: string, lang: TcgdexLang): Promise<string | undefined> {
  const card = await getCard(id, lang);
  return card?.name;
}

/**
 * TCGdex's `image` field is a base URL with no extension
 * (`https://assets.tcgdex.net/en/swsh/swsh3/136`) — quality and format are
 * chosen by appending `/{quality}.{ext}`, confirmed against TCGdex's own
 * example URLs (`.../136/high.webp`, `.../136/low.png`). "high"+"webp" is
 * the best real-world quality/size tradeoff for a card image shown at
 * product-page size.
 */
export function cardImageUrl(image: string, quality: "high" | "low" = "high", ext: "webp" | "png" = "webp"): string {
  return `${image}/${quality}.${ext}`;
}
