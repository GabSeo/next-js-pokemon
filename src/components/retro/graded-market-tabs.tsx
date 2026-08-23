"use client";

import { useState } from "react";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import type { EbayCondition, EbayLanguage } from "@/lib/ebay-browse";
import type { GradedMarketRoi } from "@/lib/graded-market";
import { EBAY_LOGO_URL, VINTED_LOGO_URL } from "@/lib/marketplace-logos";

export type TypeSummary = {
  avgLabel: string;
  count: number;
  /** How many rows are actually shown — not always the same fixed number: a rare card can turn up fewer real listings after quality filtering (see lib/ebay-browse.ts's titleMatchesCard). */
  rowCount: number;
  isReal: boolean;
  seeAllHref: string;
  rows: React.ReactNode;
};

export type LanguageEntry = {
  language: EbayLanguage;
  active: TypeSummary;
  sold: TypeSummary;
};

export type ConditionEntry = {
  id: EbayCondition;
  label: string;
  languages: LanguageEntry[];
};

/** One "newly listed" feed row — see lib/graded-market.ts's VintedFeedRow. */
export type VintedFeedRowSummary = {
  /** Empty string when the listing's age isn't known — a row with an unknown age says nothing rather than claiming to be new. */
  timeAgo: string;
  condition: string;
  priceLabel: string;
  dealPct: number;
  dealTier: "good" | "fair" | "high";
  /** Seller-written title, real rows only. */
  title?: string;
  /** Real per-item Vinted link — real rows only; preview rows never get a fabricated link. */
  url?: string;
  /** The listing's own photo, real rows only; preview rows fall back to VintedSummary.imageUrl. */
  imageUrl?: string;
};

export type VintedSummary = {
  isReal: boolean;
  searchHref: string;
  title: string;
  imageUrl?: string;
  /** The feed's mean asking price, already formatted. A true average — 1 EUR hidden auctions are excluded upstream, so nothing in the sample distorts it. */
  avgLabel: string;
  belowAverageCount: number;
  totalCount: number;
  rows: VintedFeedRowSummary[];
  /** The one condition every row is filtered to — see lib/vinted-listings.ts. Stated on screen, not just applied, so the feed's sparseness reads as deliberate. */
  conditionFilter: string;
  /** How long ago the scrape ran, e.g. "3 h" — describes the whole feed, not any one listing. Absent on the preview, which was never collected. */
  collectedLabel?: string;
};

// One small, deliberately restrained color language, reused for both chip
// systems in the Vinted feed (deal quality and condition) rather than
// inventing a second competing palette — good/Très bon état share the green
// read, high/Satisfaisant share the amber "pay attention" read. Kept as
// resolved hex rather than theme utility classes because these are chip
// *tints*, one step lighter than any --color-* token in the theme, and the
// paired text shade is chosen for contrast at 10-11px, not just borrowed
// from the nearest brand color.
const CHIP_COLORS = {
  green: { bg: "#e9f8ee", text: "#1f9d55" },
  blue: { bg: "#e6f1fb", text: "#185fa5" },
  amber: { bg: "#fbf1e3", text: "#a15c0c" },
  grey: { bg: "#f4f5f8", text: "#6b7280" },
} as const;

const DEAL_TIER_COLORS: Record<VintedFeedRowSummary["dealTier"], (typeof CHIP_COLORS)[keyof typeof CHIP_COLORS]> = {
  good: CHIP_COLORS.green,
  fair: CHIP_COLORS.grey,
  high: CHIP_COLORS.amber,
};

// One tier only. Vinted has three (Très bon état / Bon état /
// Satisfaisant) and this feed shows exclusively the first — see
// lib/vinted-listings.ts. The map is kept rather than inlined so an
// unexpected condition string still renders in neutral grey via the
// CHIP_COLORS.grey fallback below instead of crashing on a missing key.
const CONDITION_COLORS: Record<string, (typeof CHIP_COLORS)[keyof typeof CHIP_COLORS]> = {
  "Très bon état": CHIP_COLORS.green,
};

function dealPctLabel(pct: number): string {
  if (pct === 0) return "±0%";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/**
 * The rest/hover/pressed states every clickable tab in this file shares —
 * a flat hard-shadow sits under the control at rest, lifts half a step on
 * hover (more shadow shows), and on selection the control sinks flush into
 * the surface (shadow gone, nudged down-right by the same distance the
 * shadow used to occupy) so choosing a tab reads as *pressing* it, not just
 * recoloring it. This is the one interaction pattern applied everywhere
 * instead of every control inventing its own hover/active treatment.
 */
function pressable(isSelected: boolean): string {
  return isSelected
    ? "translate-x-[2px] translate-y-[2px] shadow-none"
    : "shadow-hard-sm hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md";
}

/** A top-level market tab — the two real eBay-backed languages, plus France, which isn't eBay at all (see graded-market-tabs.tsx's file doc comment). */
export type MarketTab = EbayLanguage | "France";

const TYPES = ["active", "sold"] as const;
type ListingType = (typeof TYPES)[number];

/**
 * Top-level Market tabs (English / Japanese / France) select which
 * marketplace's data is shown. English and Japanese keep the original
 * structure underneath — Condition tabs (PSA 10/9/8/Raw), an active/sold
 * toggle, real eBay data — completely unchanged. France is a different
 * marketplace with a different shape: eBay.fr isn't where the French
 * Pokémon TCG market actually trades, so instead of a third eBay language
 * this renders a single Vinted feed filtered to one condition — "Très bon
 * état", Vinted's own vocabulary, not a PSA grade — with no active/sold
 * split, since Vinted has neither grading nor a public "sold" feed. The
 * condition filter is stated on screen rather than silently applied: this
 * tab deliberately answers "what's listed in très bon état", not "what does
 * the French market look like". Every branch is always in the DOM — only the `hidden` attribute
 * changes on click — so an AI crawler reading raw HTML sees every
 * combination regardless of what a human has selected, same pattern as
 * components/price-data-tabs.tsx.
 */
export function GradedMarketTabs({
  entries,
  vinted,
  roi,
  defaultMarket,
}: {
  /** English/Japanese only — see lib/graded-market.ts's GRADED_MARKET_LANGUAGES. */
  entries: ConditionEntry[];
  vinted: VintedSummary;
  /** Only meaningful for the eBay-graded English/Japanese markets (raw vs. PSA 10) — rendered inside the English/Japanese branch below and hidden on France, since Vinted has no PSA grading to compute a grading ROI against. */
  roi: GradedMarketRoi;
  /** Lets a locale-specific product page (/products/[slug]/fr, /products/[slug]/ja) open straight to its own market instead of always defaulting to English. */
  defaultMarket?: MarketTab;
}) {
  // Every condition entry carries the same set of languages (see
  // lib/graded-market.ts), so entries[0]'s is representative of all of them.
  const marketTabs: MarketTab[] = [...entries[0].languages.map((l) => l.language), "France"];
  const [market, setMarket] = useState<MarketTab>(defaultMarket && marketTabs.includes(defaultMarket) ? defaultMarket : marketTabs[0]);

  const [conditionId, setConditionId] = useState<EbayCondition>(entries[0].id);
  const [type, setType] = useState<ListingType>("active");

  const currentCondition = entries.find((e) => e.id === conditionId)!;
  const currentLanguage =
    currentCondition.languages.find((l) => l.language === market) ?? currentCondition.languages[0];
  const selected = currentLanguage[type];

  return (
    <div>
      <div role="tablist" aria-label="Market" className="flex flex-wrap gap-2.5">
        {entries[0].languages.map((l) => {
          const isSelected = market === l.language;
          return (
            <button
              key={l.language}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setMarket(l.language)}
              className={`rounded-full border-2 border-black px-4 py-1.5 text-xs font-black tracking-[0.3px] uppercase transition-all duration-150 ${pressable(
                isSelected
              )} ${isSelected ? "bg-pokemon-blue text-white" : "bg-white text-foreground"}`}
            >
              {l.language}
            </button>
          );
        })}
        {(() => {
          const isSelected = market === "France";
          return (
            <button
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setMarket("France")}
              className={`rounded-full border-2 border-black px-4 py-1.5 text-xs font-black tracking-[0.3px] uppercase transition-all duration-150 ${pressable(
                isSelected
              )} ${isSelected ? "bg-pokemon-blue text-white" : "bg-white text-foreground"}`}
            >
              France <span className="opacity-70">(Vinted)</span>
            </button>
          );
        })()}
      </div>

      <div hidden={market === "France"}>
        <div role="tablist" aria-label="Condition" className="mt-5 flex flex-wrap gap-7 border-b-2 border-border-subtle">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={conditionId === entry.id}
              onClick={() => setConditionId(entry.id)}
              className={`-mb-0.5 border-b-[3px] pb-2.5 text-sm font-black tracking-[0.3px] uppercase transition-colors ${
                conditionId === entry.id
                  ? "border-pokemon-red text-foreground"
                  : "border-transparent text-[#9a9a9a] hover:text-foreground"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="my-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TYPES.map((t) => {
            const summary = currentLanguage[t];
            const isSelected = type === t;
            const fillClass = isSelected ? (t === "active" ? "bg-pokemon-red" : "bg-pokemon-blue") : "bg-white";
            const textClass = isSelected ? "text-white" : "text-foreground";
            const labelClass = isSelected ? "text-white" : "text-muted-text";
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`rounded-md border-2 border-black p-5 text-left transition-all duration-150 ${pressable(isSelected)} ${fillClass}`}
              >
                <div className={`mb-1.5 flex items-center gap-2 text-[11px] font-black tracking-[0.5px] uppercase ${labelClass}`}>
                  {t === "active" ? (
                    <span className={`h-1.5 w-1.5 rounded-full ${summary.isReal ? "bg-success-green" : "bg-[#9a9a9a]"}`} />
                  ) : (
                    <span>✓</span>
                  )}
                  {t === "active" ? "Active" : "Sold"}
                  <span className={`font-bold normal-case ${isSelected ? "text-white/70" : "text-[#9a9a9a]"}`}>({summary.count})</span>
                </div>
                <div className={`text-2xl font-black tracking-[-0.6px] tabular-nums ${textClass}`}>{summary.avgLabel}</div>
              </button>
            );
          })}
        </div>

        <div className="rounded-md bg-white p-5">
          <div className="mb-3">
            <span className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">
              {type === "active" ? "Active listings" : "Sold listings"} · {market}
            </span>
          </div>

          <div className="min-h-[140px]">
            {entries.map((entry) =>
              entry.languages.map((l) =>
                TYPES.map((t) => (
                  <div key={`${entry.id}-${l.language}-${t}`} hidden={!(conditionId === entry.id && market === l.language && type === t)}>
                    {l[t].rows}
                  </div>
                ))
              )
            )}
          </div>
        </div>

        <div className="mt-4">
          <a
            href={selected.seeAllHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border-2 border-black bg-pokemon-red px-3.5 py-2 text-xs font-black tracking-[0.3px] text-white uppercase shadow-hard-sm transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
          >
            See all {selected.count} {type} listings ↗
          </a>
          <div className="mt-2 flex justify-end">
            <span className="flex items-end gap-1.5 text-[10px] font-bold text-muted-text uppercase">
              Powered by
              {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted under /public, not an optimizable remote domain */}
              <img src={EBAY_LOGO_URL} alt="eBay" className="h-5 w-auto" />
            </span>
          </div>
        </div>

        {!selected.isReal && (
          <div className="mt-3">
            <IllustrativeTag label={type === "active" ? "Preview — eBay not connected yet" : "Illustrative — not connected"} />
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-md border-2 border-black bg-pokemon-yellow shadow-hard-md">
          <div className="p-5">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-black tracking-[0.3px] text-[#5a4600] uppercase">
              Grading ROI — raw → PSA 10
              {!roi.isReal && <IllustrativeTag label="Preview — eBay not connected yet" />}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-3xl font-black tracking-[-0.6px] text-foreground tabular-nums">
                {roi.percent >= 0 ? "+" : ""}
                {roi.percent.toFixed(0)}%
              </span>
              <span className="text-xs font-bold text-[#5a4600]">
                {roi.currency} {roi.rawMedian.toLocaleString()} raw + {roi.currency} {roi.gradingCostUsd} grading vs {roi.currency}{" "}
                {roi.psa10Median.toLocaleString()} PSA 10, {roi.isReal ? "today's active listings" : "preview numbers"}.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div hidden={market !== "France"}>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          {/* Not "Just listed": Lobstr reads Vinted's search-results cards,
              which carry no listing date, so nothing here knows how old a
              listing is. Claiming recency we can't measure is the same
              class of error as showing an illustrative price as real. */}
          <span className="text-base font-black tracking-[-0.3px]">Vinted listings — {vinted.title}</span>
          {/* The badge tracks the data, not the layout. Scraped listings get
              the confident solid pill real connected data gets elsewhere on
              this page; the fallback feed gets a dashed "Preview" pill, since
              a "Live" badge over invented numbers would contradict every
              other real/illustrative signal on this site. */}
          {vinted.isReal ? (
            <span className="flex items-center gap-1.5 rounded-full border-2 border-black bg-success-green px-2.5 py-1 text-[11px] font-black tracking-[0.3px] text-white uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              Live
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-dashed border-[#9a9a9a] bg-white px-2.5 py-1 text-[11px] font-black tracking-[0.3px] text-muted-text uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-[#9a9a9a]" />
              Preview
            </span>
          )}
        </div>

        {/* Plain text, not a tooltip or an icon — the filter is the single
            most important thing to understand about this feed, and it has to
            be as visible to an AI agent reading raw HTML as to a human. */}
        <p className="mt-2 text-xs font-bold text-muted-text">
          <span className="text-foreground">{vinted.conditionFilter} only.</span> Vinted&apos;s other condition tiers are excluded from both this
          feed and the search link below, so it&apos;s deliberately narrower than an unfiltered search.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-black bg-pokemon-blue p-5 shadow-hard-md">
          <div>
            <div className="mb-1.5 text-[11px] font-black tracking-[0.5px] text-white/70 uppercase">
              Avg · {vinted.rows.length} listings
            </div>
            <div className="text-3xl font-black tracking-[-0.6px] text-white tabular-nums">{vinted.avgLabel}</div>
          </div>
          <div className="text-right text-[11px] font-bold text-white/70 uppercase">
            {vinted.isReal ? `asking prices${vinted.collectedLabel ? ` · collected ${vinted.collectedLabel} ago` : ""}` : "estimate, not real-time"}
          </div>
        </div>

        <div className="mt-5 rounded-md bg-white p-5">
          <div className="mb-3">
            <span className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">{vinted.conditionFilter} listings</span>
          </div>

          <div>
            {vinted.rows.map((row, i) => {
              const dealColors = DEAL_TIER_COLORS[row.dealTier];
              const conditionColors = CONDITION_COLORS[row.condition] ?? CHIP_COLORS.grey;
              // A real row shows its own scraped photo; a preview row falls
              // back to the card's own image, which is the honest choice —
              // same physical card, different sellers, never a fabricated
              // per-listing photo.
              const thumbnail = row.imageUrl ?? vinted.imageUrl;
              return (
                <div key={row.url ?? i} className="flex items-center gap-3 border-t border-dashed border-border-subtle py-3 first:border-t-0">
                  {thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element -- TCGdex/apitcg or Vinted CDN image, domain not allowlisted for next/image (same as CardImage)
                    <img src={thumbnail} alt="" className="h-14 w-10 flex-none rounded-sm border-2 border-black object-cover shadow-hard-sm" />
                  ) : (
                    <div className="h-14 w-10 flex-none rounded-sm border-2 border-black bg-white shadow-hard-sm" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-black tracking-[0.3px] uppercase"
                        style={{ backgroundColor: conditionColors.bg, color: conditionColors.text }}
                      >
                        {row.condition}
                      </span>
                      {row.timeAgo && <span className="text-[10px] font-bold text-muted-text">{row.timeAgo}</span>}
                    </div>
                    {/* Only real rows carry a title and a link. A preview row
                        gets neither — a fabricated seller title or a dead
                        item link is a worse kind of placeholder than an
                        invented number, since it looks clickable. */}
                    {row.title &&
                      (row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block truncate text-[12px] font-bold hover:text-pokemon-blue hover:underline"
                        >
                          {row.title} ↗
                        </a>
                      ) : (
                        <span className="mt-1 block truncate text-[12px] font-bold">{row.title}</span>
                      ))}
                  </div>
                  <div className="flex flex-none flex-col items-end gap-1">
                    <span className="text-[13px] font-black tabular-nums">{row.priceLabel}</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums"
                      style={{ backgroundColor: dealColors.bg, color: dealColors.text }}
                    >
                      {dealPctLabel(row.dealPct)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <a
            href={vinted.searchHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border-2 border-black bg-pokemon-red px-3.5 py-2 text-xs font-black tracking-[0.3px] text-white uppercase shadow-hard-sm transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
          >
            Search on Vinted ↗
          </a>
          <div className="mt-2 flex justify-end">
            <span className="flex items-end gap-1.5 text-[10px] font-bold text-muted-text uppercase">
              Powered by
              {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted under /public, not an optimizable remote domain */}
              <img src={VINTED_LOGO_URL} alt="Vinted" className="h-5 w-auto" />
              {/* Named, not hidden: these rows are scraped by a third party
                  rather than served by Vinted, and a reader deserves to know
                  which link in the chain produced the number. */}
              {vinted.isReal && <span>via Lobstr.io</span>}
            </span>
          </div>
        </div>

        <div className="mt-5 rounded-md border-2 border-black p-5" style={{ backgroundColor: CHIP_COLORS.green.bg }}>
          <div className="mb-2 text-[11px] font-black tracking-[0.5px] uppercase" style={{ color: CHIP_COLORS.green.text }}>
            Deal density · {vinted.totalCount} listings
          </div>
          <div className="mb-2.5 h-2 overflow-hidden rounded-full border-2 border-black bg-white">
            <span
              className="block h-full bg-success-green"
              style={{ width: `${Math.round((vinted.belowAverageCount / vinted.totalCount) * 100)}%` }}
            />
          </div>
          <p className="text-xs font-bold" style={{ color: CHIP_COLORS.green.text }}>
            <span className="text-foreground">
              {vinted.belowAverageCount} of {vinted.totalCount}
            </span>{" "}
            listings priced below the average.
          </p>
        </div>

        {!vinted.isReal && (
          <div className="mt-3">
            <IllustrativeTag label="Preview — no scraped Vinted listings yet" />
          </div>
        )}
      </div>
    </div>
  );
}
