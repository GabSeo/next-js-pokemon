import type { Metadata } from "next";
import Link from "next/link";
import { CatalogFilters } from "@/components/catalog-filters";
import { CatalogCardTile } from "@/components/catalog-card-tile";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
import { catalogStats } from "@/lib/catalog";
import { getCatalogPrices } from "@/lib/catalog-prices";
import { PAGE_SIZE, isSortId, searchCatalogCards, type CatalogQuery } from "@/lib/catalog-search";

/**
 * Search the whole physical catalogue, filtered and sorted server-side.
 *
 * REQUEST-TIME BY DEFINITION. Reading `searchParams` makes this route dynamic
 * (the same note /tools/price-checker carries), which is correct here — there
 * is no useful static shell for an arbitrary query, and the filtering itself
 * is free: it runs over the corpus already resident in memory.
 *
 * WHAT COSTS ANYTHING, AND WHAT DOES NOT:
 *
 *   filtering / sorting / facet counts   0 requests — pure, over tier 1
 *   prices for the 60 cards on screen    60 live TCGdex reads, unmetered
 *   prices for a price SORT              the whole result set, capped at 250
 *
 * No metered quota is reachable from this page at all: the only network client
 * in its import graph is lib/catalog-prices.ts, which talks to TCGdex and
 * nothing else. A visitor paging through the entire catalogue cannot move an
 * apitcg, PokéWallet, BerryWallet or eBay counter.
 */
export const metadata: Metadata = {
  title: "Search Pokémon cards",
  description: "Search every Pokémon TCG card by name, set, rarity and printing, with live market prices.",
  alternates: { canonical: "/cards" },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CardsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const sort = one(raw.sort);
  const query: CatalogQuery = {
    q: one(raw.q),
    serie: one(raw.serie),
    set: one(raw.set),
    rarity: one(raw.rarity),
    category: one(raw.category),
    variant: one(raw.variant),
    priced: one(raw.priced) === "1",
    sort: isSortId(sort) ? sort : undefined,
    page: Number(one(raw.page)) || 1,
  };

  const result = searchCatalogCards(query);
  const stats = catalogStats();

  // A price sort has to price the WHOLE result set before it can order it —
  // searchCatalogCards has already refused the request if that set is too
  // large, so reaching here means it is affordable. Everything else prices
  // only what is on screen.
  const toPrice = result.priceSortPending ? result.matched : result.entries;
  const prices = await getCatalogPrices(toPrice.map((e) => e.card));

  let entries = result.entries;
  if (result.priceSortPending) {
    const direction = query.sort === "price-low" ? 1 : -1;
    const value = (id: string): number | undefined => {
      const price = prices.get(id);
      return price?.cardmarket?.avg ?? price?.tcgplayer?.market;
    };
    // Unpriced cards sort to the end in BOTH directions rather than counting
    // as zero — "we have no price" is not "this card is free", and a low-to-
    // high sort led by cards with no price would be actively misleading.
    entries = [...result.matched]
      .sort((a, b) => {
        const av = value(a.card.tcgdexId);
        const bv = value(b.card.tcgdexId);
        if (av === undefined && bv === undefined) return 0;
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return (av - bv) * direction;
      })
      .slice((result.page - 1) * PAGE_SIZE, (result.page - 1) * PAGE_SIZE + PAGE_SIZE);
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
      <EyebrowTitle tone="blue">Catalogue</EyebrowTitle>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Search Pokémon cards</h1>
      <p className="mt-2 text-sm text-muted-text">
        {stats.cards.toLocaleString("en-US")} cards across {stats.sets} sets. Identity is read from our own snapshot;
        prices are read live and are at most 24 hours old.{" "}
        <Link href="/sets" className="font-bold underline underline-offset-4">
          Browse by set
        </Link>
        .
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <CatalogFilters facets={result.facets} total={result.total} priceSortRefused={result.priceSortRefused} />
        </aside>

        <section>
          {entries.length === 0 ? (
            <p className="rounded-lg border-2 border-black bg-muted-surface p-4 text-sm">
              No cards match those filters.
            </p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {entries.map((entry) => (
                  <li key={entry.card.tcgdexId}>
                    <CatalogCardTile
                      card={entry.card}
                      setName={entry.set.name}
                      price={prices.get(entry.card.tcgdexId)}
                    />
                  </li>
                ))}
              </ul>
              <Pagination page={result.page} pageCount={result.pageCount} params={raw} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

/**
 * Plain links, not buttons — a page of results is a URL, and this keeps
 * pagination working with JavaScript disabled, which the rest of this site
 * already takes seriously (see CardGridFilter's own comment).
 */
function Pagination({
  page,
  pageCount,
  params,
}: {
  page: number;
  pageCount: number;
  params: Record<string, string | string[] | undefined>;
}) {
  if (pageCount <= 1) return null;
  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const single = Array.isArray(value) ? value[0] : value;
      if (single !== undefined && key !== "page") next.set(key, single);
    }
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `/cards?${qs}` : "/cards";
  };

  return (
    <nav className="mt-8 flex items-center justify-between gap-4" aria-label="Pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} className="rounded-lg border-2 border-black bg-card-surface px-3 py-1.5 text-xs font-bold shadow-hard-sm">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs text-muted-text">
        Page {page} of {pageCount.toLocaleString("en-US")}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className="rounded-lg border-2 border-black bg-card-surface px-3 py-1.5 text-xs font-bold shadow-hard-sm">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
