import type { Metadata } from "next";
import Link from "next/link";
import { SetsBrowser, type BrowseSet } from "@/components/sets-browser";
import { catalogStats, getCatalogSets, getCatalogSetCards } from "@/lib/catalog";
import { absoluteUrl } from "@/lib/site";

/**
 * Browse Sets — every Pokémon set in the crawled catalogue.
 *
 * COSTS NOTHING TO RENDER. Reads `data/catalog/pokemon/` off disk and makes no
 * network call at all (see lib/catalog.ts's header). Digital-only Pokémon TCG
 * Pocket sets are excluded — isDigitalOnlySet — so this is 203 sets, not 218.
 *
 * Every figure below is COUNTED from the corpus rather than written down, so
 * the page cannot drift from the data the way a hardcoded "23,546" already did
 * once.
 */

// One year. Nothing here changes until the corpus is re-crawled, which is a
// commit and therefore a deploy.
export const revalidate = 31536000;

export const metadata: Metadata = {
  title: "Browse Pokémon sets",
  description: "Every Pokémon TCG set, from Base Set to the latest drop — pick one to see every card inside it.",
  alternates: { canonical: "/sets/pokemon" },
};

export default function SetsIndexPage() {
  const stats = catalogStats();

  const browse: BrowseSet[] = getCatalogSets()
    .map((set) => ({
      id: set.id,
      name: set.name,
      serie: set.serie?.name ?? "Other",
      releaseDate: set.releaseDate,
      cardCount: getCatalogSetCards(set.id).length,
      logo: set.logo,
    }))
    .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));

  const newest = browse[0];

  // Eras in the order their newest set appears, so the filter reads
  // newest-first the way the grid does.
  const eras: string[] = [];
  for (const set of browse) if (!eras.includes(set.serie)) eras.push(set.serie);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Pokémon TCG sets",
    url: absoluteUrl("/sets/pokemon"),
    numberOfItems: browse.length,
    itemListElement: browse.slice(0, 50).map((set, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: absoluteUrl(`/sets/${set.id}`),
      name: set.name,
    })),
  };

  return (
    <main className="mx-auto w-full max-w-[1180px] px-6 py-6 pb-24">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />

      <div className="mb-6">
        <Link href="/sets" className="text-xs font-bold text-muted-text underline underline-offset-4">
          ← All games
        </Link>
        <h1 className="mt-3 text-[32px] font-black tracking-[-0.8px]">Pokémon Sets</h1>
        <p className="mt-1 text-sm text-muted-text">
          Every Pokémon TCG set, from the 1999 Base Set to the latest drop — pick one to see every card inside it.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat label="Total Sets" value={String(browse.length)} sub="Catalogued & priced" accent />
        <Stat label="Total Cards" value={stats.cards.toLocaleString("en-US")} sub="Across all sets" />
        <Stat
          label="Newest Set"
          value={newest?.name ?? "—"}
          sub={
            newest?.releaseDate
              ? `Released ${new Date(newest.releaseDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
              : undefined
          }
          small
        />
        {/* The mockup's fourth tile reads "Most Chased — +9.4% this month".
            That needs a price history the catalogue does not have, and this
            codebase does not render a figure it has not measured. So the slot
            is kept and the promise stated, with no number attached. See
            docs/pokemon-catalogue.md §7 on why there is no time series. */}
        <Stat label="Most Chased" value="Coming soon" sub="Trending needs price history" small />
      </div>

      {newest && (
        <section className="relative mb-14 flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-lg border-2 border-black bg-pokemon-red p-10 text-white shadow-hard-lg">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: "radial-gradient(rgba(255,255,255,.18) 1.5px, transparent 1.5px)",
              backgroundSize: "16px 16px",
            }}
          />
          <div className="relative z-10">
            <span className="mb-3 inline-block rounded-full border-2 border-black bg-white px-3 py-1 text-[11px] font-black tracking-[0.6px] text-pokemon-red uppercase">
              🔥 Latest Drop
            </span>
            <h2 className="mb-2 text-[32px] font-black tracking-[-0.8px]">{newest.name}</h2>
            <p className="max-w-[420px] text-sm leading-5 opacity-90">
              {newest.cardCount} cards in {newest.serie}. Freshly indexed, with Cardmarket and TCGplayer prices on every
              card our sources reach.
            </p>
            <Link
              href={`/sets/${newest.id}`}
              className="mt-5 inline-block rounded-md border-2 border-black bg-[#0a0a0a] px-5 py-3 text-sm font-black text-white shadow-[4px_4px_0px_0px_rgba(255,255,255,0.85)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
            >
              Browse this set →
            </Link>
          </div>
          <div className="relative z-10 flex h-[120px] w-[120px] flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-black bg-white shadow-hard-md">
            {newest.logo ? (
              /* eslint-disable-next-line @next/next/no-img-element -- see SetsBrowser's own note: TCGdex serves a bare URL that needs an extension appended, which next/image's loader does not produce */
              <img src={`${newest.logo}.webp`} alt="" className="h-full w-full object-contain p-2" />
            ) : (
              <span className="text-[56px]">⚡</span>
            )}
          </div>
        </section>
      )}

      <SetsBrowser sets={browse} eras={eras} />

      <p className="mt-14 text-xs text-muted-text">
        Looking for one card rather than a set?{" "}
        <Link href="/cards" className="font-bold underline underline-offset-4">
          Search all {stats.cards.toLocaleString("en-US")} cards
        </Link>
        .
      </p>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
  small,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`rounded-lg border-2 border-black p-5 shadow-hard-md ${accent ? "bg-pokemon-blue text-white" : "bg-card-surface"}`}>
      <div className={`mb-3 text-[11px] font-black tracking-[0.6px] uppercase ${accent ? "opacity-75" : "text-muted-text"}`}>
        {label}
      </div>
      <div className={`font-black tracking-[-0.6px] ${small ? "text-xl" : "text-[28px]"}`}>{value}</div>
      {sub && <div className={`mt-1 text-xs font-bold ${accent ? "text-white/75" : "text-muted-text"}`}>{sub}</div>}
    </div>
  );
}
