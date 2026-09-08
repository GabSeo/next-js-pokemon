/**
 * The catalogue query VOCABULARY — sort ids, facet shape, page size, limits.
 *
 * Split out of lib/catalog-search.ts for one hard reason: the filter UI is a
 * Client Component and needs these values, while catalog-search.ts reaches
 * lib/catalog.ts, which imports `node:fs`. Importing the two together dragged
 * `node:fs` into the browser chunk and Turbopack refused it outright —
 * "the chunking context does not support external modules (request: node:fs)".
 *
 * That refusal is the tier-1 invariant working, not an obstacle to it (see
 * lib/catalog.ts's header): a Client Component cannot reach the corpus, so it
 * cannot ship 13MB to a browser or make a page think it can filter 23,546
 * cards client-side. The fix is therefore a split, never a `node:fs` shim.
 *
 * SO NOTHING IN THIS FILE MAY IMPORT ANYTHING. It is declarations only, and it
 * has to stay that way to remain safe on both sides of the boundary.
 */

/**
 * Results per page.
 *
 * 20, not 60. The grid shows five cards a row, so twenty is four full rows —
 * about a screenful, which is the amount somebody actually looks at before
 * deciding whether to refine the search or page on. Sixty made the first page a
 * long scroll and tripled the prices resolved for it, most of which were never
 * seen.
 */
export const PAGE_SIZE = 20;

/**
 * Price sort has NO cap any more, and the reason is the price snapshot.
 *
 * It used to be capped at 250 results, because ordering by price meant
 * fetching one live price per card and 21,066 requests could not answer a
 * dropdown. Prices are now a local map (lib/catalog-prices.ts), so sorting the
 * whole catalogue costs a lookup per row and the refusal that used to be
 * displayed has nothing left to refuse.
 */

export type SortId = "name" | "name-desc" | "newest" | "oldest" | "number" | "price-high" | "price-low";

/**
 * TWO, and they are the same on both sides.
 *
 * The two searches are one surface with one difference — Pokemon has an
 * English and a Japanese catalogue and One Piece does not. `newest`, `oldest`
 * and `number` cannot be offered on the One Piece side (Bandai's packs carry no
 * release date we hold, and a One Piece row is a CODE with several printings
 * rather than a numbered card), and the price sorts went with the prices.
 */
export const SORTS: { id: SortId; label: string; needsPrices?: true }[] = [
  { id: "name", label: "Name A–Z" },
  { id: "name-desc", label: "Name Z–A" },
];

/**
 * Sorts that exist but are no longer offered. Kept valid so an old link still
 * sorts rather than silently falling back.
 *
 * The price sorts went with the prices: SEARCH IS FOR FINDING A CARD, and a
 * figure on a tile is a different question — one the card page answers per
 * printing, which is the only place it can be answered honestly. Removing them
 * also removes the only part of a search that reads the price snapshot, which
 * is what made a page of results cost more than the catalogue lookup itself.
 */
const RETIRED: SortId[] = ["newest", "oldest", "number", "price-high", "price-low"];

export function isSortId(value: string | undefined): value is SortId {
  return SORTS.some((s) => s.id === value) || RETIRED.includes(value as SortId);
}

export function sortNeedsPrices(sort: SortId): boolean {
  return SORTS.find((s) => s.id === sort)?.needsPrices === true;
}

export type Facet = { value: string; count: number };

export type CatalogQuery = {
  /**
   * Which catalogue to search: `"en"`, `"ja"`, or undefined for both.
   *
   * The Japanese corpus is a different catalogue rather than a translation —
   * different sets, different numbering, 12,781 cards TCGdex publishes only
   * there. Someone searching for a card they hold usually holds one or the
   * other, and mixing them doubles every result list for no gain.
   */
  language?: "en" | "ja";
  q?: string;
  serie?: string;
  set?: string;
  rarity?: string;
  category?: string;
  variant?: string;
  /** Only cards we hold a marketplace pointer for. */
  priced?: boolean;
  sort?: SortId;
  page?: number;
};
