import { Suspense } from "react";
import Link from "next/link";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import { AlertSubscribe } from "@/components/alert-subscribe";
import { OpenDataLinks } from "@/components/open-data-links";
import { PriceCheckerForm } from "@/components/price-checker-form";
import { PriceChart } from "@/components/price-chart";
import { PriceDataTabs } from "@/components/price-data-tabs";
import { StructuredData } from "@/components/structured-data";
import { ConditionFilterChips } from "@/components/retro/condition-filter-chips";
import { GradedMarketPanel } from "@/components/retro/graded-market-panel";
import { InternationalPricesPanel } from "@/components/retro/international-prices-panel";
import { PopulationPanel } from "@/components/retro/population-panel";
import { computeAlertBands, franchiseLabel } from "@/lib/cards";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import { cardRefs } from "@/data/card-refs";
import type { Card } from "@/lib/types";

/**
 * The price checker's entire body, shared by both routes that serve it.
 *
 * There are two, and deliberately so. `/tools/price-checker?cardId=x` is the
 * public, SEO-load-bearing address and cannot change. But a page that reads
 * `searchParams` is a request-time page by definition — Next cannot prebuild
 * something whose identity arrives in the query string — so that route
 * re-ran every eBay/Vinted/TCGdex call on every single visit while
 * /products/[slug], rendering the SAME panel from the SAME data, served a
 * prebuilt file in single-digit milliseconds.
 *
 * `/tools/price-checker/[cardId]` is the prebuildable twin, and a
 * `beforeFiles` rewrite in next.config.ts points the query-string URL at it.
 * The visible address never changes; only what the server reaches for does.
 * Both routes render this component, so they cannot drift apart.
 *
 * The rewrite has to be `beforeFiles`: `afterFiles` is consulted only after
 * the filesystem, and `/tools/price-checker` is a real page that would match
 * first — the rewrite would silently never fire.
 */

/**
 * Everything above and below the market panel is either static markup or a
 * pure component (InternationalPricesPanel, PopulationPanel and the chart
 * all take the already-resolved card). GradedMarketPanel is the only async
 * one, and it is the expensive one: four eBay searches plus the Vinted read
 * plus a TCGdex lookup.
 *
 * So it gets a Suspense boundary of its own. On the prebuilt route this
 * costs nothing — it resolves at build. It earns its keep on every path that
 * still renders on demand (a card id outside card-refs.ts, a cold ISR
 * regeneration), where the shell now paints immediately instead of the whole
 * page waiting on eBay.
 */
function MarketPanelSkeleton({ franchise }: { franchise: Card["franchise"] }) {
  return (
    <div className="rounded-lg border-2 border-black bg-card-surface p-7 shadow-hard-md">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">📊 {franchiseLabel(franchise)} Market Overview</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>
      <p className="text-sm font-bold text-muted-text">Loading live marketplace data…</p>
    </div>
  );
}

export function PriceCheckerView({ cardId, card }: { cardId?: string; card?: Card }) {
  const bands = card && !card.priceUnavailable ? computeAlertBands(card.currentPrice) : [];

  const webAppJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${SITE_NAME} price checker`,
    url: absoluteUrl("/tools/price-checker"),
    applicationCategory: "Price tracking tool",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    potentialAction: {
      "@type": "SearchAction",
      target: `${absoluteUrl("/tools/price-checker")}?cardId={cardId}`,
      "query-input": "required name=cardId",
    },
  };

  return (
    <div className="min-h-screen bg-muted-surface">
      <StructuredData data={webAppJsonLd} />

      <div className="mx-auto max-w-[1180px] px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-[32px] leading-tight font-black tracking-[-1px] sm:text-[40px]">Price checker</h1>
          <p className="mt-3 text-base leading-6 text-muted-text">
            Enter a card ID (see the list below) to see current market prices. Works without JavaScript — this is
            a standard HTML form.
          </p>

          <div className="mt-6 flex justify-center">
            <PriceCheckerForm defaultValue={cardId} />
          </div>

          <OpenDataLinks
            markdownHref={`/tools/price-checker.md${cardId ? `?cardId=${encodeURIComponent(cardId)}` : ""}`}
            jsonHref={`/api/price-check${cardId ? `?cardId=${encodeURIComponent(cardId)}` : ""}`}
            okfHref={`/okf/tools/price-checker${cardId ? `?cardId=${encodeURIComponent(cardId)}` : ""}`}
            className="mt-5 justify-center"
          />
        </div>

        {cardId && !card && (
          <p className="mx-auto mt-8 max-w-xl rounded-lg border-2 border-black bg-pokemon-red/10 px-4 py-3 text-center text-sm font-bold text-pokemon-red shadow-hard-sm">
            No card found for &ldquo;{cardId}&rdquo;. Try one of the IDs listed below.
          </p>
        )}

        {card && (
          <div className="mt-14 space-y-6 border-t-2 border-black pt-10">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
              <div>
                <h2 className="text-2xl font-black tracking-[-0.6px]">
                  <Link href={`/products/${card.slug}`} className="hover:underline">
                    {card.name}
                  </Link>
                </h2>
                <p className="mt-1 text-sm font-bold text-muted-text">
                  {franchiseLabel(card.franchise)} · {card.set} · {card.number ?? ""}
                </p>
              </div>
              {card.priceUnavailable ? (
                <p className="text-base font-black tracking-[-0.3px]">Price temporarily unavailable</p>
              ) : (
                <data value={String(card.currentPrice)} className="text-3xl font-black tracking-[-1px] tabular-nums">
                  {card.currency} {card.currentPrice}
                </data>
              )}
            </div>

            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">Real-time market data</span>
              <span className="h-px flex-1 bg-border-subtle" />
            </div>

            <InternationalPricesPanel card={card} />

            <Suspense fallback={<MarketPanelSkeleton franchise={card.franchise} />}>
              <GradedMarketPanel card={card} />
            </Suspense>

            <div>
              <h3 className="mb-3 flex items-center gap-2 text-lg font-black tracking-[-0.45px]">📈 Raw Card Price History</h3>
              <ConditionFilterChips />
              {card.priceHistory.length > 0 && (
                <PriceChart history={card.priceHistory} currency={card.currency} trend={card.trend} className="w-full" />
              )}
            </div>

            <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
              <PriceDataTabs
                currency={card.currency}
                recentSnapshots={card.recentSnapshots}
                trend={card.trend}
                priceRange={card.priceRange}
              />
            </div>

            <div className="mb-1 flex items-center gap-2 pt-4">
              <span className="text-xs font-black tracking-[0.6px] text-muted-text uppercase">Grading &amp; population — still illustrative</span>
              <span className="h-px flex-1 bg-border-subtle" />
            </div>
            <PopulationPanel card={card} />

            <AddToCollectionButton cardId={card.id} />

            <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
              <h3 className="mb-3 text-lg font-black tracking-[-0.5px]">Price alerts</h3>
              <AlertSubscribe cardId={card.id} currency={card.currency} bands={bands} />
            </div>
          </div>
        )}

        <div className="mt-16 border-t-2 border-black pt-8">
          <h3 className="text-lg font-black tracking-[-0.5px]">Available card IDs</h3>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold text-muted-text sm:grid-cols-3">
            {cardRefs.map((ref) => (
              <li key={ref.slug}>
                {/* Always the query-string form: that is the public, indexed
                    address, and the rewrite is what makes it fast. Linking to
                    the internal path would put a second URL for the same
                    content into the crawl graph. */}
                <Link href={`/tools/price-checker?cardId=${ref.slug}`} className="hover:text-foreground hover:underline">
                  {ref.slug} — {ref.displayName}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
