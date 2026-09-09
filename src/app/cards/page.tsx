import type { Metadata } from "next";
import Link from "next/link";
import { SearchControls } from "@/components/search-controls";
import { CatalogCardTile } from "@/components/catalog-card-tile";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
import { catalogStats, getCatalogSets } from "@/lib/catalog";
import { isSortId, searchCatalogCards, type CatalogQuery } from "@/lib/catalog-search";
import { latinCardLabel } from "@/lib/card-label";
import { pokemonImageUrl } from "@/lib/pokemon-image";

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
 *   rendering a page of results          the catalogue, and nothing else
 *
 * Nothing here touches the network in the normal case, which is what makes a
 * request-time page acceptable at this size — it was 0.35-1.26s per page of
 * unseen cards when each price was fetched live. NO PRICES AT ALL NOW: browsing
 * is for finding a card, and a figure per tile is a question the card page
 * answers per printing. No metered quota is reachable
 * from this page at all either: the only client in its import graph is
 * lib/catalog-prices.ts, which reads a file and, for a card the snapshot
 * lacks, talks to TCGdex and nothing else.
 */
export const metadata: Metadata = {
  title: "Search Pokémon cards",
  description: "Search every Pokémon TCG card by name, in English or Japanese, filtered by set.",
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
  // ONE LANGUAGE, NEVER BOTH, defaulting to English — see SearchControls.
  const language = one(raw.lang) === "ja" ? "ja" : "en";
  const query: CatalogQuery = {
    q: one(raw.q),
    set: one(raw.set),
    language,
    sort: isSortId(sort) ? sort : undefined,
    page: Number(one(raw.page)) || 1,
  };

  const result = searchCatalogCards(query);
  const stats = catalogStats({ language });

  // The picker shows names, the URL carries qualified ids. Built here because
  // this is the layer that holds the catalogue; the filter panel is a client
  // component and must not read it.
  const setNames: Record<string, string> = {};
  for (const set of getCatalogSets({ language })) {
    // The set CODE for Japanese sets: `SV4a (JP)` reads and searches where the
    // Japanese title does not.
    setNames[`${language}~${set.id}`] = language === "ja" ? `${set.id} (JP)` : set.name;
  }
  const entries = result.entries;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
      <EyebrowTitle tone="blue">Catalogue</EyebrowTitle>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Search Pokémon cards</h1>
      <p className="mt-2 text-sm text-muted-text">
        {stats.cards.toLocaleString("en-US")} cards across {stats.sets} sets. Identity is read from our own snapshot;
        every printing of it is one click away.{" "}
        <Link href="/sets/pokemon" className="font-bold underline underline-offset-4">
          Browse by set
        </Link>
        .
      </p>

      <div className="mt-6">
        <SearchControls
          basePath="/cards"
          total={result.total}
          placeholder="Search by card name or number…"
          showLanguage
          filter={{
            param: "set",
            label: "Set",
            options: result.facets.set.map((f) => ({
              value: f.value,
              label: setNames[f.value] ?? f.value,
              count: f.count,
            })),
          }}
        />
      </div>

      <div className="mt-6">
        {entries.length === 0 ? (
          <p className="rounded-lg border-2 border-black bg-muted-surface p-4 text-sm">No cards match those filters.</p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {entries.map((entry) => (
                <li key={entry.card.tcgdexId}>
                  <CatalogCardTile
                    card={entry.card}
                    label={latinCardLabel(entry.card, entry.set.id, entry.set.language === "ja")}
                    imageUrl={entry.card.image ? undefined : pokemonImageUrl(entry.card, entry.set, 320)}
                    setName={entry.set.language === "ja" ? `${entry.set.id} (JP)` : entry.set.name}
                  />
                </li>
              ))}
            </ul>
            <Pagination page={result.page} pageCount={result.pageCount} params={raw} />
          </>
        )}
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
        <Link
          href={href(page - 1)}
          className="rounded-lg border-2 border-black bg-card-surface px-3 py-1.5 text-xs font-bold shadow-hard-sm"
        >
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs text-muted-text">
        Page {page} of {pageCount.toLocaleString("en-US")}
      </span>
      {page < pageCount ? (
        <Link
          href={href(page + 1)}
          className="rounded-lg border-2 border-black bg-card-surface px-3 py-1.5 text-xs font-bold shadow-hard-sm"
        >
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
