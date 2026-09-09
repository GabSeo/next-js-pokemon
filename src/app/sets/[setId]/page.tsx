import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
import { CatalogCardTile } from "@/components/catalog-card-tile";
import { getCatalogSet, getCatalogSetCards, getCatalogSets, isDigitalOnlySet, qualify } from "@/lib/catalog";
import { pokemonImageUrl } from "@/lib/pokemon-image";
import { pokemonSeriesLabel, pokemonSetLabel, pokemonSetShortLabel } from "@/lib/pokemon-set-label";
import { absoluteUrl } from "@/lib/site";

/**
 * One set, every card in it, with a live price against each.
 *
 * THE TWO HALVES COME FROM DIFFERENT PLACES ON PURPOSE, and it is the whole
 * reason this page is affordable:
 *
 *   identity  — lib/catalog.ts, off disk, 0 requests, instant
 *
 * Neither half spends metered quota. TCGdex is keyless and is not a bucket in
 * lib/api-budget.ts, so a 300-card set costs nothing against the four budgets
 * the tracked cards live on. The same page built on apitcg or PokéWallet would
 * exhaust an hourly ceiling on a single view.
 *
 * EVERY SET IS PRERENDERED, which is only safe because the build makes no
 * requests. An earlier attempt prerendered these while prices were still
 * fetched live, and it was worse than the slowness it fixed: ~21,000 requests
 * across parallel build workers tripped the circuit breaker and the empty
 * results were frozen into static HTML for 24h (sv08 and base1 shipped with no
 * prices at all, me05 with 1 of 120). Reading a snapshot removes the failure
 * mode rather than tuning it — there is nothing left to fail mid-build.
 *
 * The result is a set page that is static HTML on the CDN: no serverless
 * invocation, no corpus parse, no fetch. It stops being computed at all.
 */

// One year. These pages are built from a local snapshot, so there is nothing
// for a revalidation to discover: the figures change when the snapshot is
// regenerated, which happens at deploy (see package.json's prebuild). A short
// window would spend serverless invocations rebuilding identical HTML.
export const revalidate = 31536000;

export function generateStaticParams() {
  // BOTH CATALOGUES. The Japanese sets were reachable by URL and prerendered
  // for neither, so every one of them was a runtime miss.
  return getCatalogSets({ language: "all" }).map((set) => ({
    setId: qualify(set.language ?? "en", set.id),
  }));
}

type PageProps = { params: Promise<{ setId: string }> };

/**
 * The set this URL names, or undefined when it is not a set this site serves.
 *
 * Digital-only Pokémon TCG Pocket sets resolve in the corpus — identity
 * lookups are deliberately unfiltered (see isDigitalOnlySet) — but they are not
 * browsable here: nothing links to them, none are prerendered, and none of
 * their cards can be owned, graded or priced. A page that renders 286 tiles all
 * reading "No price" is worse than an honest 404, so this is the one place the
 * browse opinion is applied to a direct URL as well as to a listing.
 *
 * Shared by generateMetadata and the page so the two cannot disagree about
 * whether a URL exists.
 */
function servableSet(setId: string) {
  const set = getCatalogSet(decodeURIComponent(setId));
  return set && !isDigitalOnlySet(set) ? set : undefined;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { setId } = await params;
  const set = servableSet(setId);
  if (!set) return {};
  return {
    title: `${pokemonSetLabel(set)} — every card`,
    description: `Every card in ${pokemonSetLabel(set)} (${pokemonSeriesLabel(set)}), with its artwork, number and rarity.`,
    alternates: { canonical: `/sets/${set.id}` },
  };
}

export default async function SetPage({ params }: PageProps) {
  const { setId } = await params;
  const set = servableSet(setId);
  if (!set) notFound();

  // THE LANGUAGE, PASSED. Without it `getCatalogSetCards` infers English from
  // a bare id, so every Japanese set page rendered "0 cards" over a set that
  // has hundreds.
  const entries = getCatalogSetCards(set.id, set.language ?? "en");
  const cards = entries.map((e) => e.card);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: pokemonSetLabel(set),
    url: absoluteUrl(`/sets/${set.id}`),
    numberOfItems: cards.length,
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />

      <Link href="/sets/pokemon" className="text-xs font-bold text-muted-text underline underline-offset-4">
        ← All Pokémon sets
      </Link>

      <div className="mt-4 flex items-start gap-4">
        {set.logo && (
          // eslint-disable-next-line @next/next/no-img-element -- external asset host, no loader configured for it
          <img src={`${set.logo}.png`} alt="" className="hidden h-16 w-auto object-contain sm:block" />
        )}
        <div>
          <EyebrowTitle tone="blue">{pokemonSeriesLabel(set)}</EyebrowTitle>
          <h1 className="mt-2 text-3xl font-black tracking-tight">{pokemonSetLabel(set)}</h1>
          <p className="mt-1 text-xs text-muted-text">
            {cards.length} cards
            {set.releaseDate ? ` · released ${set.releaseDate}` : ""}
            {set.abbreviation?.official ? ` · ${set.abbreviation.official}` : ""}
          </p>
        </div>
      </div>

      {/* No prices here any more: browsing is for finding a card, and a figure
          per tile could not be qualified at that size — a reverse holo is a
          median 3.36x its normal twin. /card/[tcg]/[code] answers it per
          printing, which is the only place it can be answered honestly. */}

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* THE SAME RULES THE SEARCH GRID USES. This page predates both and
            rendered `card.name` and TCGdex's image directly — so a Japanese set
            showed kana names over "No picture published" for cards Limitless
            pictures perfectly well. */}
        {entries.map(({ card, label }) => (
          <li key={card.tcgdexId}>
            <CatalogCardTile
              card={card}
              label={label}
              imageUrl={card.image ? undefined : pokemonImageUrl(card, set, 320)}
              setName={pokemonSetShortLabel(set)}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
