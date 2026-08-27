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
  /**
   * "USD" everywhere except one real, deliberate exception: a One Piece
   * card whose only identity source is BerryWallet's Japanese-print catalog
   * has no USD price at all (TCGPlayer's own catalog doesn't carry that
   * print), only Cardmarket's EUR — see cards.ts's berryWalletPrice. A real
   * EUR number beats a fabricated USD conversion, same reasoning tcgdex.ts
   * already documents for why GBP/CAD estimates stay illustrative rather
   * than converted. Kept as a closed union (not a bare `string`) so every
   * currency actually shown anywhere on the site stays a deliberate,
   * type-checked choice, not a typo.
   */
  currency: "USD" | "EUR";
  currentPrice: number;
  /**
   * True when neither price source could be reached and this card is the
   * offline placeholder built from data/card-refs.ts alone (see
   * placeholderCard in lib/cards.ts). `currentPrice` is 0 in that case
   * purely because the field is required — it is not a real market price,
   * so every surface that prints a price checks this flag first rather than
   * publishing "USD 0" as fact.
   */
  priceUnavailable?: boolean;
  asOfDate: string; // ISO date the current price was last updated
  priceHistory: PriceHistoryPoint[];
  recentSnapshots: PriceSnapshot[]; // real daily market-price records, not itemized sales
  trend: PriceTrend; // average price over trailing windows, derived from priceHistory
  priceRange: PriceRange | null; // low/high over all available history, derived from priceHistory
  imageUrl?: string; // real card image; falls back to a generated placeholder if absent
  sourceUrl?: string; // real TCGPlayer product page
  description?: string;
  /**
   * The real, full print/variant name as the data source itself writes it —
   * e.g. BerryWallet's own `"Shanks (004) (Manga)"` for a One Piece card,
   * as opposed to `name` above (`"Shanks"`, ref.displayName — the clean
   * character name used everywhere else: page titles, breadcrumbs, JSON-LD,
   * MCP tool output). Only ever set for a One Piece card with a real
   * BerryWallet match; undefined everywhere else, including every Pokémon
   * card. Rendered as the H1 specifically — see ProductPageContent, which
   * falls back to `name` when this is absent.
   */
  printName?: string;
  /**
   * Real Cardmarket EUR figures for a One Piece card's own BerryWallet
   * match — separate from `currentPrice`/`currency` above (which prefer
   * TCGPlayer/USD when a real one exists, see cards.ts's berryWalletPrice)
   * so a card WITH a real USD price can still show its real EUR Cardmarket
   * numbers too, rather than the two being mutually exclusive. Powers
   * CardmarketPricesPanel in place of the illustrative
   * InternationalPricesPanel for any card that has this — real data
   * replacing a fabricated currency conversion, not sitting alongside it.
   * Undefined for every Pokémon card and any One Piece card whose
   * BerryWallet match carries no Cardmarket block at all.
   */
  cardmarket?: { avg?: number; low?: number; trend?: number; url?: string };
  /**
   * One Piece only — the English BerryWallet match's own `(V.N)` rarity-tier
   * index (see lib/berrywallet.ts's variantIndex), stored here purely so a
   * later Japanese lookup for this same card_number can align by variant
   * without a second live English resolution — see findCardInLanguage's own
   * `knownEnglishVariant` comment for the request-count reasoning. `null`
   * (not `undefined`) means "resolved a real English print, confirmed no
   * V-number" (a promo product outside the normal tiering) — a real,
   * positive answer, distinct from `undefined`'s "not resolved via
   * BerryWallet at all," the same distinction pickVariantForJapanese's own
   * `hasEnglishSignal` parameter carries. Not meaningful to any external
   * consumer (JSON API, MCP, markdown) — internal to the identity-resolution
   * pipeline only.
   */
  printVariantIndex?: number | null;
  /** TCGdex card id (e.g. "swsh3-136"), Pokémon only — lets graded-market.ts fetch a localized name for the French Vinted search (and getFrenchCardText for the /fr page) without re-searching TCGdex. */
  tcgdexId?: string;
  /** The real-world character this card depicts (e.g. "Gengar", "Monkey D. Luffy") — copied straight from CardRef.character. Same value entitymap.ts already keys EntityMap's character entities by, now also available off a resolved Card for anything that needs "which character is this" without re-reading card-refs.ts (e.g. picking a Pokémon Showdown sprite for a Pokémon card). */
  character: string;
};

export type AlertBand = {
  pct: number;
  price: number;
};
