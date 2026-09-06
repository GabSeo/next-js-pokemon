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
