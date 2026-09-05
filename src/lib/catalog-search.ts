/**
 * Search, filter, sort and facet the catalogue — still TIER 1.
 *
 * Pure functions over the in-memory corpus. No network call, no metered quota,
 * and the same import discipline lib/catalog.ts holds: this file reaches only
 * that module, never a market client. Filtering all 23,546 cards is a few
 * array passes over data already resident, so a query costs nothing but CPU.
 *
 * Sorting by PRICE is the one thing this layer cannot do alone — it holds no
 * prices — so it flags `priceSortPending` and the caller orders the set once
 * it has them. That used to be capped at 250 results because each price was a
 * live request; with the snapshot (lib/catalog-prices.ts) it is a map lookup
 * and the whole catalogue can be ordered.
 */
import { cardmarketProductIdFor, getCatalogSets, getCatalogSetCards, type CatalogEntry } from "@/lib/catalog";
import {
  PAGE_SIZE,
  isSortId,
  sortNeedsPrices,
  type CatalogQuery,
  type Facet,
  type SortId,
} from "@/lib/catalog-query";

export * from "@/lib/catalog-query";

export type CatalogSearchResult = {
  /** The page's entries, already sorted — except by price, which the caller applies (see priceSortPending). */
  entries: CatalogEntry[];
  /** Every entry matching the filters, before pagination. Needed by a price sort, which must order the whole set. */
  matched: CatalogEntry[];
  total: number;
  page: number;
  pageCount: number;
  facets: { serie: Facet[]; rarity: Facet[]; category: Facet[]; variant: Facet[] };
  /**
   * The caller asked to sort by price, so it must resolve prices for `matched`
   * and order them itself — this layer has no prices of its own.
   */
  priceSortPending: boolean;
};

/** Every entry in the corpus, flattened once per call. Cheap: the underlying arrays are already built and cached. */
function allEntries(): CatalogEntry[] {
  return getCatalogSets().flatMap((set) => getCatalogSetCards(set.id));
}

type Predicate = (entry: CatalogEntry) => boolean;

function predicatesFor(query: CatalogQuery): Record<string, Predicate> {
  const needle = query.q?.trim().toLowerCase();
  return {
    q: (e) => !needle || e.card.name.toLowerCase().includes(needle) || e.card.localId.toLowerCase() === needle,
    serie: (e) => !query.serie || e.set.serie?.name === query.serie,
    set: (e) => !query.set || e.set.id === query.set,
    rarity: (e) => !query.rarity || e.card.rarity === query.rarity,
    category: (e) => !query.category || e.card.category === query.category,
    variant: (e) => !query.variant || e.card.variants.some((v) => v.type === query.variant),
    priced: (e) => !query.priced || cardmarketProductIdFor(e.card) !== undefined,
  };
}

/**
 * Facet counts for one dimension, computed against every OTHER filter but not
 * its own.
 *
 * Counting against all filters including the dimension's own would make every
 * unselected option read 0 the moment one is picked — technically true and
 * useless, since the number a person wants there is "how many would I get if I
 * switched to this instead".
 */
function facetCounts(
  entries: CatalogEntry[],
  predicates: Record<string, Predicate>,
  dimension: string,
  valueOf: (entry: CatalogEntry) => string[] | string | undefined
): Facet[] {
  const others = Object.entries(predicates).filter(([key]) => key !== dimension);
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!others.every(([, predicate]) => predicate(entry))) continue;
    const raw = valueOf(entry);
    const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    for (const value of new Set(values)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function compare(sort: SortId, a: CatalogEntry, b: CatalogEntry): number {
  switch (sort) {
    case "name":
      return a.card.name.localeCompare(b.card.name) || a.set.id.localeCompare(b.set.id);
    case "name-desc":
      return b.card.name.localeCompare(a.card.name) || a.set.id.localeCompare(b.set.id);
    case "newest":
      return (b.set.releaseDate ?? "").localeCompare(a.set.releaseDate ?? "") || a.card.name.localeCompare(b.card.name);
    case "oldest":
      return (a.set.releaseDate ?? "").localeCompare(b.set.releaseDate ?? "") || a.card.name.localeCompare(b.card.name);
    case "number":
      // localId is a string that is usually numeric but not always ("SV49",
      // "TG12"), so numeric order where both parse and lexical otherwise —
      // never parseInt alone, which would sort "TG12" as NaN and scatter it.
      return numericThenLexical(a.card.localId, b.card.localId) || a.set.id.localeCompare(b.set.id);
    default:
      // Price sorts are applied by the caller once prices exist; keep a stable
      // order until then rather than pretending to sort by something absent.
      return a.card.name.localeCompare(b.card.name);
  }
}

function numericThenLexical(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return a.localeCompare(b);
}

export function searchCatalogCards(query: CatalogQuery): CatalogSearchResult {
  const entries = allEntries();
  const predicates = predicatesFor(query);
  const checks = Object.values(predicates);

  const matched = entries.filter((entry) => checks.every((predicate) => predicate(entry)));

  const sort: SortId = query.sort && isSortId(query.sort) ? query.sort : "name";
  const wantsPriceSort = sortNeedsPrices(sort);

  const sorted = [...matched].sort((a, b) => compare(sort, a, b));

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page ?? 1), pageCount);
  const start = (page - 1) * PAGE_SIZE;

  return {
    entries: sorted.slice(start, start + PAGE_SIZE),
    matched: sorted,
    total: matched.length,
    page,
    pageCount,
    facets: {
      serie: facetCounts(entries, predicates, "serie", (e) => e.set.serie?.name),
      rarity: facetCounts(entries, predicates, "rarity", (e) => e.card.rarity),
      category: facetCounts(entries, predicates, "category", (e) => e.card.category),
      variant: facetCounts(entries, predicates, "variant", (e) =>
        e.card.variants.map((v) => v.type).filter((t): t is string => t !== undefined)
      ),
    },
    priceSortPending: wantsPriceSort,
  };
}
