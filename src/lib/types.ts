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

/**
 * An id this card carries in somebody else's catalog, labelled with whose.
 * Deliberately not a bare string: an unlabelled "44233" is unreadable to an
 * agent and unjoinable to anything, while `{ scheme: "apitcg", value }` says
 * which catalog to resolve it against.
 */
export type CardIdentifier = {
  scheme: "apitcg" | "tcgdex" | "berrywallet";
  value: string;
};

export type Card = {
  /**
   * Canonical identity — always the slug, on every resolution path.
   *
   * It used to hold whichever upstream happened to answer first, so the same
   * card was apitcg's "44233" on one build and TCGdex's "swsh12-186" on the
   * next. That is an unusable identity for anything that persists a reference:
   * JSON-LD `sku`, the saved-collection store, an agent citing a card between
   * sessions. Upstream ids moved to `identifiers`, where they're honest
   * cross-references rather than identity claims.
   *
   * Kept as its own field rather than deleted in favour of `slug` because
   * every consumer already reads `id`; the fix is making them all read the
   * same value every build, not renaming the field.
   */
  id: string;
  slug: string; // URL slug, e.g. "gengar-vmax-271"
  /**
   * Every upstream catalog that resolved this card, not just the one that won
   * the identity race. `/api/{franchise}/{id}` still accepts these values as
   * lookup aliases, so URLs minted before identity was stabilised keep working.
   */
  identifiers?: CardIdentifier[];
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
   * Real Cardmarket EUR figures — separate from `currentPrice`/`currency`
   * above (which prefer TCGPlayer/USD when a real one exists, see cards.ts's
   * berryWalletPrice) so a card WITH a real USD price can still show its real
   * EUR Cardmarket numbers too, rather than the two being mutually exclusive.
   * Powers CardmarketPricesPanel in place of the illustrative
   * InternationalPricesPanel for any card that has this — real data replacing
   * a fabricated currency conversion, not sitting alongside it.
   *
   * Two sources now, one shape: a One Piece card's own BerryWallet match, or
   * a Pokémon card's Western PokéWallet print (CardRef.pokeWalletWesternCardId).
   * Both are the WESTERN Cardmarket product, which is the right one to show
   * next to an English page: Cardmarket sells English, French, Italian,
   * German, Spanish and Portuguese copies as language options WITHIN one
   * listing, and splits only Japanese and Korean off as separate products.
   * `languages` carries that set so the panel can say which copies the price
   * covers instead of implying it is English-only.
   *
   * `avg1`/`avg7`/`avg30` are Cardmarket's own trailing averages, the same
   * three rows its product page prints. Undefined for a card whose source
   * carries no Cardmarket block, which is not rare — BerryWallet returns none
   * at all for some One Piece prints.
   */
  /**
   * The TCGplayer spread behind `currentPrice` — the low, mid, high and
   * direct-low a single market price is the middle of.
   *
   * Always from the SAME source that supplied `currentPrice`, never merged
   * across sources. TCGdex, apitcg and BerryWallet each carry their own copy
   * of this block, and while apitcg and BerryWallet were measured returning
   * identical figures, TCGdex refreshes hourly against apitcg's 24h — so a
   * band from one source beside a market price from another would be two
   * snapshots of the same card quietly disagreeing, the exact thing this
   * codebase already refuses to do for identity fields.
   *
   * `variant` names the printing the numbers describe ("holofoil",
   * "normal", ...), because TCGplayer prices each separately and a spread
   * with no printing attached is not attributable to anything.
   */
  tcgplayer?: {
    low?: number;
    mid?: number;
    high?: number;
    market?: number;
    directLow?: number;
    variant?: string;
  };
  cardmarket?: {
    avg?: number;
    low?: number;
    trend?: number;
    avg1?: number;
    avg7?: number;
    avg30?: number;
    url?: string;
    /**
     * Which of Cardmarket's two products these figures come from.
     *
     * Set from WHICH id we resolved, never inferred from the payload. The
     * obvious-looking source — PokéWallet's `images.languages` — turned out to
     * be image availability, reporting `["en"]` for the Japanese prints, so
     * reading listing coverage off it would have labelled a Japanese page
     * "1 language: EN". Knowing which id was asked for is the one thing that
     * cannot be wrong.
     */
    print?: "western" | "japanese";
  };
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
