import type { Metadata } from "next";
import Link from "next/link";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
import { catalogStats, getCatalogSets, type CatalogSet } from "@/lib/catalog";
import { absoluteUrl } from "@/lib/site";

/**
 * Every Pokémon set in the crawled catalogue.
 *
 * COSTS NOTHING TO RENDER. Reads `data/catalog/pokemon/` off disk and makes no
 * network call at all — the whole point of the tier-1/tier-2 split (see
 * lib/catalog.ts's header). 218 sets and 23,546 cards are listed here without
 * touching a single metered quota, which is what makes browsing at catalogue
 * scale a thing this app can offer.
 *
 * Prices live one level down, on the set page, and are fetched live there.
 */

// 24 hours, matching every other page here. The catalogue itself only changes
// when the corpus is re-crawled (a commit), so this is generous rather than tight.
export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Pokémon sets",
  description: "Every Pokémon TCG set, with card counts and release dates.",
  alternates: { canonical: "/sets" },
};

/**
 * Series in release order, newest first, with digital-only Pokémon TCG Pocket
 * sets last rather than removed.
 *
 * Nothing is filtered out of the corpus (see the crawler's header) and nothing
 * is filtered out here either — a Pocket set is a real thing a person may be
 * looking for, and it is labelled for what it is instead of silently dropped.
 * What it does NOT get is a false promise of prices: those sets have no
 * physical market and correspondingly no marketplace pointers, so the badge
 * says so up front rather than letting someone click into an empty grid.
 */
function isDigitalOnly(set: CatalogSet): boolean {
  return /pocket/i.test(set.serie?.name ?? "");
}

function releaseSortKey(set: CatalogSet): string {
  return set.releaseDate ?? "0000-00-00";
}

export default function SetsIndexPage() {
  const sets = getCatalogSets();
  const stats = catalogStats();

  const physical = sets.filter((s) => !isDigitalOnly(s)).sort((a, b) => releaseSortKey(b).localeCompare(releaseSortKey(a)));
  const digital = sets.filter(isDigitalOnly).sort((a, b) => releaseSortKey(b).localeCompare(releaseSortKey(a)));

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Pokémon TCG sets",
    url: absoluteUrl("/sets"),
    numberOfItems: sets.length,
    itemListElement: physical.slice(0, 50).map((set, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: absoluteUrl(`/sets/${set.id}`),
      name: set.name,
    })),
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />

      <EyebrowTitle tone="blue">Catalogue</EyebrowTitle>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Pokémon sets</h1>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-text">
        {stats.sets} sets and {stats.cards.toLocaleString("en-US")} cards, read from our own catalogue snapshot. Card
        identity is stored locally; prices are read live when you open a set.
      </p>

      <SetGrid heading="Sets" sets={physical} />
      {digital.length > 0 && (
        <SetGrid
          heading="Pokémon TCG Pocket"
          note="Digital-only. These cards have no physical market, so no prices are shown."
          sets={digital}
        />
      )}
    </main>
  );
}

function SetGrid({ heading, sets, note }: { heading: string; sets: CatalogSet[]; note?: string }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-black tracking-tight uppercase">{heading}</h2>
      {note && <p className="mt-1 text-xs text-muted-text">{note}</p>}
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sets.map((set) => (
          <li key={set.id}>
            <Link
              href={`/sets/${set.id}`}
              className="flex h-full items-center gap-3 rounded-lg border-2 border-black bg-card-surface p-3 shadow-hard-sm transition-[transform,box-shadow] duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
            >
              {/* Set symbols are small, decorative and frequently absent — a
                  missing one leaves the row's text alignment untouched. */}
              {set.symbol && (
                // eslint-disable-next-line @next/next/no-img-element -- external asset host, no loader configured for it
                <img src={`${set.symbol}.png`} alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{set.name}</span>
                <span className="block text-xs text-muted-text">
                  {set.serie?.name}
                  {set.releaseDate ? ` · ${set.releaseDate.slice(0, 4)}` : ""}
                </span>
              </span>
              <span className="shrink-0 rounded-full border-2 border-black bg-muted-surface px-2 py-0.5 text-[10px] font-black">
                {set.cardCount?.total ?? "?"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
