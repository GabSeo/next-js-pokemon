import { GradedMarketTabs, type ConditionEntry, type MarketTab, type TypeSummary, type VintedSummary } from "@/components/retro/graded-market-tabs";
import { franchiseLabel } from "@/lib/cards";
import { getGradedMarketData, type GradedMarketTypeData } from "@/lib/graded-market";
import { relativeTimeLabel } from "@/lib/vinted-listings";
import type { Card } from "@/lib/types";

/** One row, real or illustrative — real rows get a working per-item link, illustrative rows never do (see lib/illustrative.ts). */
function ListingRow({ date, description, price, currency, url }: { date: string; description: string; price: number; currency: string; url?: string }) {
  return (
    <div className="grid grid-cols-[76px_1fr_auto_20px] items-center gap-3 border-t border-dashed border-border-subtle py-3 text-[13px] first:border-t-0">
      <span className="text-[11px] font-bold text-muted-text">{date}</span>
      <span className="truncate font-bold">{description}</span>
      <span className="font-black tabular-nums">
        {currency} {price.toLocaleString()}
      </span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-text hover:text-pokemon-blue">
          ↗
        </a>
      ) : (
        <span />
      )}
    </div>
  );
}

function toTypeSummary(data: GradedMarketTypeData): TypeSummary {
  return {
    // An empty tier has no median, and "USD 0" reads as a real price of zero
    // rather than an absence. See GradedMarketTypeData.noListings.
    avgLabel: data.noListings ? "—" : `${data.currency} ${data.medianPrice.toLocaleString()}`,
    medianPrice: data.medianPrice,
    currency: data.currency,
    count: data.count,
    rowCount: data.rows.length,
    isReal: data.isReal,
    noListings: data.noListings,
    seeAllHref: data.seeAllUrl,
    // `noListings` is a real answer, not a failure — eBay was reached and had
    // nothing for this tier today. Saying so beats an empty table, and beats
    // the preview rows that used to fill this space, which told the reader
    // something false about a market that simply has no sellers right now.
    // The distinction from `!isReal` matters: that one means we could not ask.
    rows: data.noListings ? (
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-1 text-center">
        <span className="text-sm font-black tracking-[-0.2px]">No active listings today</span>
        <span className="text-xs font-bold text-muted-text">Nothing is currently for sale in this tier. Check back in 24h :)</span>
      </div>
    ) : (
      <div>
        {data.rows.map((row, i) => (
          <ListingRow key={row.url ?? i} date={row.date} description={row.description} price={row.price} currency={row.currency} url={row.url} />
        ))}
      </div>
    ),
  };
}

/**
 * One shared window: condition tabs (PSA 10/9/8/Raw) plus an active/sold
 * type toggle underneath — only one row-list is visible at a time, but all
 * 4 conditions × 2 types (8 row-sets) are server-rendered in the DOM
 * regardless, same pattern as components/price-data-tabs.tsx, so an AI
 * crawler reading raw HTML sees every combination no matter which tab/type
 * a human has selected.
 *
 * All data comes from lib/graded-market.ts's getGradedMarketData — the same
 * function backing the markdown export, JSON API, and MCP tool, so this
 * component is purely presentational (JSX shaping), not a second place
 * fetch logic or the real/illustrative rules could live.
 */
export async function GradedMarketPanel({ card, defaultMarket }: { card: Card; defaultMarket?: MarketTab }) {
  const data = await getGradedMarketData(card);
  // Defensive only — the real gate is the franchise check at this
  // component's own call site (components/product-page-content.tsx), which
  // is what actually skips the 8 eBay searches getGradedMarketData would
  // otherwise still not make (see its own franchise check). This just means
  // a future direct render of this component for a non-Pokémon card fails
  // silently instead of crashing on the `!` assertions below.
  if (!data) return null;

  const entries: ConditionEntry[] = data.conditions.map((c) => ({
    id: c.condition,
    label: c.condition,
    languages: c.languages.map((l) => ({
      language: l.language,
      active: toTypeSummary(l.active),
      sold: toTypeSummary(l.sold),
    })),
  }));

  const vinted: VintedSummary = {
    isReal: data.vinted.isReal,
    searchHref: data.vinted.searchUrl,
    title: data.vinted.title,
    imageUrl: data.vinted.imageUrl,
    character: data.vinted.character,
    avgLabel: `${data.vinted.currency} ${data.vinted.avgPrice.toLocaleString()}`,
    belowAverageCount: data.vinted.belowAverageCount,
    totalCount: data.vinted.rows.length,
    conditionFilter: data.vinted.conditionFilter,
    collectedLabel: data.vinted.collectedAtMs ? relativeTimeLabel(data.vinted.collectedAtMs) : undefined,
    rows: data.vinted.rows.map((row) => ({
      timeAgo: row.timeAgo,
      condition: row.condition,
      price: row.price,
      priceLabel: `${row.currency} ${row.price.toLocaleString()}`,
      dealPct: row.dealPct,
      dealTier: row.dealTier,
      title: row.title,
      url: row.url,
      imageUrl: row.imageUrl,
    })),
  };

  return (
    <div className="rounded-lg border-2 border-black bg-card-surface p-7 shadow-hard-md">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">📊 {franchiseLabel(card.franchise)} Market Overview</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>

      <GradedMarketTabs entries={entries} vinted={vinted} roi={data.roi} defaultMarket={defaultMarket} />
    </div>
  );
}
