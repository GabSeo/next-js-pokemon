import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
import { CatalogCardTile } from "@/components/catalog-card-tile";
import { getCatalogSet, getCatalogSetCards } from "@/lib/catalog";
import { getCatalogPrices } from "@/lib/catalog-prices";
import { absoluteUrl } from "@/lib/site";

/**
 * One set, every card in it, with a live price against each.
 *
 * THE TWO HALVES COME FROM DIFFERENT PLACES ON PURPOSE, and it is the whole
 * reason this page is affordable:
 *
 *   identity  — lib/catalog.ts, off disk, 0 requests, instant
 *   prices    — lib/catalog-prices.ts, live TCGdex, ~1.2s for 120 cards
 *
 * Neither half spends metered quota. TCGdex is keyless and is not a bucket in
 * lib/api-budget.ts, so a 300-card set costs nothing against the four budgets
 * the tracked cards live on. The same page built on apitcg or PokéWallet would
 * exhaust an hourly ceiling on a single view.
 *
 * NOT PRERENDERED AT BUILD. `generateStaticParams` returns an empty array
 * deliberately — prerendering all 218 sets would fire ~23,500 requests into
 * every `next build`. The empty array plus `revalidate` is what Next requires
 * to get on-demand ISR instead (see its generateStaticParams reference: "You
 * must return an empty array ... in order to revalidate (ISR) paths at
 * runtime"), so a set is built the first time somebody opens it and then
 * served from cache for 24h.
 *
 * This route is deliberately NOT in scripts/check-static-routes.mjs's
 * REQUIRED_PATTERNS. That gate exists to catch routes that should be static
 * and silently stopped being; this one prerenders zero pages by design and
 * would fail it for doing the right thing.
 */

// 24 hours — the same window tcgdexFetch already applies to the price data
// underneath, so the page and its figures age at the same rate.
export const revalidate = 86400;

export function generateStaticParams() {
  return [];
}

type PageProps = { params: Promise<{ setId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { setId } = await params;
  const set = getCatalogSet(decodeURIComponent(setId));
  if (!set) return {};
  return {
    title: `${set.name} — card list and prices`,
    description: `Every card in ${set.name}${set.serie?.name ? ` (${set.serie.name})` : ""}, with live Cardmarket and TCGplayer prices.`,
    alternates: { canonical: `/sets/${set.id}` },
  };
}

export default async function SetPage({ params }: PageProps) {
  const { setId } = await params;
  const set = getCatalogSet(decodeURIComponent(setId));
  if (!set) notFound();

  const entries = getCatalogSetCards(set.id);
  const cards = entries.map((e) => e.card);

  // The one network step on this page. Bounded concurrency lives inside
  // getCatalogPrices — see its own comment on why an unbounded fan-out here
  // could trip a circuit breaker shared with the tracked-card path.
  const prices = await getCatalogPrices(cards);

  const pricedCount = prices.size;

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: set.name,
    url: absoluteUrl(`/sets/${set.id}`),
    numberOfItems: cards.length,
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />

      <Link href="/sets" className="text-xs font-bold text-muted-text underline underline-offset-4">
        ← All sets
      </Link>

      <div className="mt-4 flex items-start gap-4">
        {set.logo && (
          // eslint-disable-next-line @next/next/no-img-element -- external asset host, no loader configured for it
          <img src={`${set.logo}.png`} alt="" className="hidden h-16 w-auto object-contain sm:block" />
        )}
        <div>
          <EyebrowTitle tone="blue">{set.serie?.name ?? "Set"}</EyebrowTitle>
          <h1 className="mt-2 text-3xl font-black tracking-tight">{set.name}</h1>
          <p className="mt-1 text-xs text-muted-text">
            {cards.length} cards
            {set.releaseDate ? ` · released ${set.releaseDate}` : ""}
            {set.abbreviation?.official ? ` · ${set.abbreviation.official}` : ""}
          </p>
        </div>
      </div>

      {/* A stated absence rather than an empty grid. Coverage is 95.4% of
          physical cards but genuinely uneven — Trainer kits sit at 48%, and a
          card can carry a marketplace pointer while that marketplace publishes
          no figures (the whole Gym series does exactly this, see
          docs/pokemon-catalogue.md). A reader deserves to know they are
          looking at a real gap rather than a page that failed to load. */}
      <p className="mt-6 rounded-lg border-2 border-black bg-muted-surface p-3 text-xs">
        {pricedCount === 0 ? (
          <>No marketplace prices are available for this set. Our sources carry no Cardmarket or TCGplayer product for these cards.</>
        ) : (
          <>
            Prices for {pricedCount} of {cards.length} cards. Cardmarket figures are EUR, TCGplayer USD, and neither is
            ever converted into the other. Refreshed at most every 24 hours.
          </>
        )}
      </p>

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {entries.map(({ card }) => (
          <li key={card.tcgdexId}>
            <CatalogCardTile card={card} price={prices.get(card.tcgdexId)} />
          </li>
        ))}
      </ul>
    </main>
  );
}
