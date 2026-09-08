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
import { japaneseImageUrl } from "@/lib/pokemon-ja-official";
import {
  cardmarketProductIdFor,
  getCatalogEntries,
  type CatalogEntry,
  type CatalogLanguage,
} from "@/lib/catalog";
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
  facets: { serie: Facet[]; rarity: Facet[]; category: Facet[]; variant: Facet[]; set: Facet[] };
  /**
   * The caller asked to sort by price, so it must resolve prices for `matched`
   * and order them itself — this layer has no prices of its own.
   */
  priceSortPending: boolean;
};

/** Whether anything can render this card: TCGdex's own asset, or the official Japanese picture. */
function hasPicture(entry: CatalogEntry): boolean {
  if (entry.card.image) return true;
  return entry.set.language === "ja" && japaneseImageUrl(entry.set.id, entry.card.localId) !== undefined;
}

/** Every entry in the corpus, flattened once per call. Cheap: the underlying arrays are already built and cached. */
function allEntries(language: CatalogLanguage): CatalogEntry[] {
  // ONE ARRAY, ALREADY BUILT. This used to flatten `getCatalogSetCards` over
  // every set, which filtered the whole 33,847-entry corpus once per set —
  // 387 x 33,847 comparisons, 82 ms of every single query, to rebuild a
  // grouping that is fixed at load.
  //
  // Scoping to the language here rather than in a predicate also halves what
  // the filters walk: a search never spans the two catalogues, because a
  // result list mixing them makes "which of these is mine" harder, not easier.
  return getCatalogEntries(language);
}

type Predicate = (entry: CatalogEntry) => boolean;

function predicatesFor(query: CatalogQuery): Record<string, Predicate> {
  const needle = query.q?.trim().toLowerCase();
  return {
    // SEARCH WHAT IS SHOWN. A Japanese card is labelled in Latin — `Charizard`
    // for `リザードン` — so matching only the catalogue's own name meant typing
    // the label a person is reading found nothing. Both are tested: the label
    // for what they see, the raw name because the Japanese spelling is also
    // worth being findable by someone who can type it.
    //
    // `entry.label` is computed once at load, not here: deriving it per entry
    // per query cost 73 ms across the corpus for a value fixed between crawls.
    q: (e) =>
      !needle ||
      e.card.name.toLowerCase().includes(needle) ||
      e.label.toLowerCase().includes(needle) ||
      e.card.localId.toLowerCase() === needle,
    serie: (e) => !query.serie || e.set.serie?.name === query.serie,
    // The QUALIFIED id: `neo1` names a set in each catalogue, so the bare one
    // would silently mix two sets' cards under one filter.
    set: (e) => !query.set || `${e.set.language ?? "en"}~${e.set.id}` === query.set,
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

/**
 * The name a row is SORTED by is the name it SHOWS.
 *
 * A Japanese card is labelled in Latin — `Klink` for `ギアル` — so ordering on
 * the catalogue's own name produced a list that was alphabetical in a spelling
 * nobody could see: `Trainer 061` landed before `Klink`.
 */
function sortName(entry: CatalogEntry): string {
  return entry.label;
}

function compare(sort: SortId, a: CatalogEntry, b: CatalogEntry): number {
  switch (sort) {
    case "name":
      return sortName(a).localeCompare(sortName(b)) || a.set.id.localeCompare(b.set.id);
    case "name-desc":
      return sortName(b).localeCompare(sortName(a)) || a.set.id.localeCompare(b.set.id);
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
  const entries = allEntries(query.language ?? "en");
  const predicates = predicatesFor(query);
  const checks = Object.values(predicates);

  const matched = entries.filter((entry) => checks.every((predicate) => predicate(entry)));

  const sort: SortId = query.sort && isSortId(query.sort) ? query.sort : "name";
  const wantsPriceSort = sortNeedsPrices(sort);

  // A CARD NOBODY PICTURES SORTS LAST, whatever the sort — the same rule this
  // file already applies to prices, for the same reason. 4,330 Japanese cards
  // are pictured nowhere public, they cluster in the oldest sets, and
  // alphabetical order put a screenful of them on page one: the catalogue
  // looked broken rather than incomplete. They stay reachable, at the end.
  const sorted = [...matched].sort((a, b) => {
    const pictured = Number(hasPicture(b)) - Number(hasPicture(a));
    return pictured !== 0 ? pictured : compare(sort, a, b);
  });

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
      // Keyed on the QUALIFIED id and labelled with the set name, so the two
      // `neo1`s stay distinguishable in a picker as well as in the filter.
      set: facetCounts(entries, predicates, "set", (e) => `${e.set.language ?? "en"}~${e.set.id}`),
    },
    priceSortPending: wantsPriceSort,
  };
}
