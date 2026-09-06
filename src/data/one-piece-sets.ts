/**
 * What sellers call each One Piece product, and the one word safe to exclude on.
 *
 * WHY THIS IS A TABLE AND NOT DERIVED. An earlier version built exclusions out
 * of the set name itself — the longest phrase plus its rarest word — and the
 * queries it produced were both enormous and inconsistent:
 *
 *   -"unnumbered promos" -"one piece promotion cards" -"awakening of the new
 *    era" -awakening -"emperors in the new world" -"a fist of divine speed"
 *
 * Two things were wrong with that. Most of those names are CARDMARKET
 * CATALOGUE BUCKETS — "Unnumbered Promos", "One Piece Promotion Cards", "Judge
 * Promos" — and no seller has ever typed one into a listing title, so every one
 * of them measured zero effect while making the query unreadable. And the ones
 * that ARE real sets were named twice, once as a phrase and once as a word,
 * because nothing knew which form a seller writes.
 *
 * A seller writes one thing: the short name. "Romance Dawn" becomes `romance`,
 * "A Fist of Divine Speed" becomes `divine`. That is marketplace vocabulary,
 * not catalogue data, so it belongs in a table someone can read and correct
 * rather than in a heuristic that guesses.
 *
 * KEYED BY FAMILY, the value opSetFamily returns — `OP05`, `PRB`, `ST`. That
 * collapses each set with its own pre-release, anniversary and release-event
 * printings (`OP02 PRE`, `OP05 ANN`, `OP10 RE` all resolve to their parent),
 * which is right: they are the same product to a seller.
 *
 * `exclude: null` means sellers never name this product, so it must never
 * become an exclusion:
 *
 *   CM, OP, OPDD, OPRP   Cardmarket and Bandai catalogue buckets. A promo's
 *                        real identity is its own product — "2nd Anniversary
 *                        Set" — which productOf already supplies.
 *   ST, LT               Decks are named after their contents: "Starter Deck
 *                        26: PURPLE/BLACK Monkey.D.Luffy", "Starter Deck 23:
 *                        RED Shanks". Their distinctive word is the card's own
 *                        colour or character, and `-purple` was measured to
 *                        cost the OP09-061 Parallel two real listings.
 *   EB, OP16             One family covering three different Extra Boosters,
 *                        and "The Time of Battle", whose only candidate word is
 *                        "battle". Neither can name one product unambiguously.
 */
export type OpSetVocabulary = {
  /** Everything sellers write for this product, ORed when a query must NAME it. */
  terms: string[];
  /** The single token safe to EXCLUDE on, or null when sellers never name it. */
  exclude: string | null;
};

export const OP_SET_VOCABULARY: Record<string, OpSetVocabulary> = {
  // Booster sets. Sellers write the set code and the short name, both.
  OP01: { terms: ["op01", "romance dawn", "romance"], exclude: "romance" },
  OP02: { terms: ["op02", "paramount war", "paramount"], exclude: "paramount" },
  OP03: { terms: ["op03", "pillars of strength", "pillars"], exclude: "pillars" },
  OP04: { terms: ["op04", "kingdoms of intrigue", "kingdoms"], exclude: "kingdoms" },
  OP05: { terms: ["op05", "awakening of the new era", "awakening"], exclude: "awakening" },
  OP06: { terms: ["op06", "wings of the captain", "wings"], exclude: "wings" },
  OP07: { terms: ["op07", "500 years in the future", "500 years"], exclude: "500 years" },
  OP08: { terms: ["op08", "two legends", "legends"], exclude: "legends" },
  OP09: { terms: ["op09", "emperors in the new world", "emperors"], exclude: "emperors" },
  OP10: { terms: ["op10", "royal blood"], exclude: "royal blood" },
  OP11: { terms: ["op11", "a fist of divine speed", "divine"], exclude: "divine" },
  OP12: { terms: ["op12", "legacy of the master", "legacy"], exclude: "legacy" },
  OP13: { terms: ["op13", "carrying on his will", "carrying"], exclude: "carrying" },
  OP14: { terms: ["op14", "azure sea", "azure"], exclude: "azure" },
  OP15: { terms: ["op15", "adventure on kami's island", "kami"], exclude: "kami" },
  // "The Time of Battle" — "battle" is a word half the game's set names could
  // have used, so this product can be searched for but never excluded on.
  OP16: { terms: ["op16", "the time of battle"], exclude: null },

  // Premium Booster. The reprint set, and the one product a query most often
  // has to name POSITIVELY — see deriveQuery. Sellers write all three forms.
  PRB: { terms: ["prb", "premium booster", "the best"], exclude: "prb" },

  // One family, three unrelated Extra Boosters (Memorial Collection, Anime 25th
  // Collection, One Piece Heroines Edition). Nothing here names one of them.
  EB: { terms: ["extra booster"], exclude: null },

  // Decks — see this file's header for why they are never an exclusion.
  ST: { terms: ["starter deck", "ultra deck"], exclude: null },
  LT: { terms: ["learn together"], exclude: null },

  // Catalogue buckets — see this file's header.
  CM: { terms: [], exclude: null },
  OP: { terms: [], exclude: null },
  OPDD: { terms: ["demo deck"], exclude: null },
  OPRP: { terms: ["revision pack"], exclude: null },
};

/** What sellers write for a product family, or undefined when it is unknown. */
export function opSetVocabulary(family: string): OpSetVocabulary | undefined {
  return OP_SET_VOCABULARY[family.toUpperCase()];
}

/**
 * The same thing for PRODUCTS — the promos, packs and decks a card was given
 * out in, as opposed to the set it belongs to.
 *
 * This used to be derived by taking a product name's first two words, and that
 * heuristic broke in three ways the table fixes:
 *
 *   COLLISIONS   45 of the 249 products that can generate a term shorten to
 *                something another product already owns, and the truncated part
 *                is exactly the discriminator: "Judge Pack Vol. 2" through
 *                "Vol. 7" all became `judge pack`, "Online Regional 2023",
 *                "2024" and "2025 Vol. 1" all became `online regional`, and
 *                "Treasure Cup 2024/2025/2026" all became `treasure cup`.
 *                Different cards, one term.
 *
 *   NAMES        productOf returns any parenthetical that is not a treatment,
 *                which includes ALTERNATE CHARACTER NAMES — Daz.Bonez on 25
 *                rows, Bentham on 23, Galdino on 23, Zala on 14. This file's
 *                own model says names generate nothing; the heuristic did not
 *                know the difference. Absent from this table, they now do.
 *
 *   TAILS        "2nd Anniversary Set" needs its tail dropped (`2nd anniversary`
 *                finds 32 listings against 24) while "Judge Pack Vol. 2" needs
 *                its tail kept. No rule reads both ways; a table just says.
 *
 * ONLY 249 OF 405 PRODUCTS CAN EVER MATTER — a product generates a term only
 * when its code has more than one printing — and only 6 of those touch the nine
 * cards tracked today. The table grows by a line or two per card added, and
 * `npm run crawl:one-piece` names anything missing rather than leaving a query
 * quietly unable to separate a printing.
 *
 * Keyed by the exact product string productOf returns.
 */
export const OP_PRODUCT_VOCABULARY: Record<string, OpSetVocabulary> = {
  // Measured: `("2nd anniversary")` finds 32 PSA 10 listings, `("2nd
  // anniversary set")` 24 — the container noun costs eight.
  "2nd Anniversary Set": { terms: ["2nd anniversary"], exclude: "2nd anniversary" },

  // P-033's three products all contain "Event Pack", so the volume is the
  // whole identity here and truncating it merges three different cards.
  "Event Pack Vol. 2": { terms: ["event pack vol. 2"], exclude: "event pack vol. 2" },
  "CS 2023 Event Pack": { terms: ["cs 2023 event pack"], exclude: "cs 2023 event pack" },
  "CS 2023 Event Pack Finalist Ver.": { terms: ["cs 2023 event pack finalist"], exclude: "cs 2023 event pack finalist" },

  "Championship 25-26 Offline Regionals Season 2": {
    terms: ["championship 25-26", "offline regionals"],
    exclude: "championship 25-26",
  },

  // ST21-014's Campaign Pack, which exists only in BerryWallet's flat search
  // index and not in any crawled set, so this string comes from the ref's own
  // variantTags rather than a corpus row. Measured: `("3rd anniversary")` finds
  // 5 PSA 10 listings, `("3rd anniversary treasure")` 4 — the fifth is titled
  // "3rd Anniversary CP Pack", the same card in a neighbouring pack.
  "3rd Anniversary Treasure": { terms: ["3rd anniversary"], exclude: "3rd anniversary" },

  // A deck named after a character, so the same hazard the ST sets have: the
  // head word alone is the card's own name. Excludable only as a phrase, where
  // adjacency is required — measured free on ST21-014.
  "Luffy Deck": { terms: ["luffy deck"], exclude: "luffy deck" },
};

/** What sellers write for a product, or undefined when it is not in the table. */
export function opProductVocabulary(product: string): OpSetVocabulary | undefined {
  return OP_PRODUCT_VOCABULARY[product];
}
