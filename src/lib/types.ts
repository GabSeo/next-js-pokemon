export type Franchise = "pokemon" | "one-piece";

export type PriceHistoryPoint = {
  date: string; // ISO date
  price: number;
};

export type PriceSnapshot = {
  date: string; // ISO date
  price: number;
  source: string; // e.g. "TCGPlayer"
  sourceUrl?: string;
};

export type PriceTrend = {
  day1: number | null;
  day7: number | null;
  day30: number | null;
  day90: number | null;
};

/**
 * Low/high over whatever daily history is actually available — not
 * hard-labeled "1 year" because apitcg's retention for a given product may
 * be shorter than that. `from`/`to` are the real bounds of the data behind
 * the numbers, so nothing claims more coverage than it has.
 */
export type PriceRange = {
  low: number;
  high: number;
  lowDate: string;
  highDate: string;
  from: string;
  to: string;
};

export type Card = {
  id: string; // apitcg.com numeric product id, as a string
  slug: string; // URL slug, e.g. "gengar-vmax-271"
  franchise: Franchise;
  name: string;
  set: string;
  setCode?: string;
  number?: string; // e.g. "271/264" (Pokémon, TCGdex-matched, "localId/set official count"), "190" (bare fallback), or "OP07-113" (One Piece)
  rarity?: string;
  /** Pokémon TCG energy types (Fire, Water, Darkness, ...) — TCGdex-only, Pokémon-category cards only. See lib/pokemon-types.ts. */
  types?: string[];
  currency: "USD";
  currentPrice: number;
  asOfDate: string; // ISO date the current price was last updated
  priceHistory: PriceHistoryPoint[];
  recentSnapshots: PriceSnapshot[]; // real daily market-price records, not itemized sales
  trend: PriceTrend; // average price over trailing windows, derived from priceHistory
  priceRange: PriceRange | null; // low/high over all available history, derived from priceHistory
  imageUrl?: string; // real card image; falls back to a generated placeholder if absent
  sourceUrl?: string; // real TCGPlayer product page
  description?: string;
  /** TCGdex card id (e.g. "swsh3-136"), Pokémon only — lets graded-market.ts fetch a localized name for the French Vinted search (and getFrenchCardText for the /fr page) without re-searching TCGdex. */
  tcgdexId?: string;
  /** The real-world character this card depicts (e.g. "Gengar", "Monkey D. Luffy") — copied straight from CardRef.character. Same value entitymap.ts already keys EntityMap's character entities by, now also available off a resolved Card for anything that needs "which character is this" without re-reading card-refs.ts (e.g. picking a Pokémon Showdown sprite for a Pokémon card). */
  character: string;
};

export type AlertBand = {
  pct: number;
  price: number;
};
