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

/** Results per page. 60 prices fetch in well under a second at the concurrency lib/catalog-prices.ts uses. */
export const PAGE_SIZE = 60;

/**
 * The largest result set that may be sorted by price.
 *
 * Every card has to be priced before the set can be ordered, so this is a
 * request budget rather than a UI preference: 250 cards is ~2.5s against a
 * free, unmetered source. Above it the sort is refused with a reason, because
 * a "sort by price" that silently reordered only the sixty rows already on
 * screen would be a control lying about its own scope.
 */
export const PRICE_SORT_MAX = 250;

export type SortId = "name" | "name-desc" | "newest" | "oldest" | "number" | "price-high" | "price-low";

export const SORTS: { id: SortId; label: string; needsPrices?: true }[] = [
  { id: "name", label: "Name A–Z" },
  { id: "name-desc", label: "Name Z–A" },
  { id: "newest", label: "Newest set" },
  { id: "oldest", label: "Oldest set" },
  { id: "number", label: "Card number" },
  { id: "price-high", label: "Price high → low", needsPrices: true },
  { id: "price-low", label: "Price low → high", needsPrices: true },
];

export function isSortId(value: string | undefined): value is SortId {
  return SORTS.some((s) => s.id === value);
}

export function sortNeedsPrices(sort: SortId): boolean {
  return SORTS.find((s) => s.id === sort)?.needsPrices === true;
}

export type Facet = { value: string; count: number };

export type CatalogQuery = {
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
