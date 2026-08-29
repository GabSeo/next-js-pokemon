"use client";

import { useState } from "react";
import { FloatingPreviewChip } from "@/components/retro/floating-preview-chip";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { VintedListingsSection } from "@/components/retro/vinted-listings-section";
import type { EbayCondition, EbayLanguage } from "@/lib/ebay-browse";
import type { GradedMarketRoi } from "@/lib/graded-market";
import { EBAY_LOGO_URL } from "@/lib/marketplace-logos";

export type TypeSummary = {
  avgLabel: string;
  /**
   * The number behind avgLabel, kept alongside the formatted string rather
   * than parsed back out of it — the same rule VintedFeedRowSummary.price
   * follows, and for the same reason: the grading-tier preview does real
   * arithmetic (active vs sold) and a locale-formatted string is not a
   * number you can subtract.
   */
  medianPrice: number;
  currency: string;
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
  /** Raw number backing priceLabel — kept alongside the formatted string rather than parsed back out of it, needed for real arithmetic like "cheapest of the held rows" in vinted-listings-section.tsx. */
  price: number;
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
  /** The real-world character this card depicts (Card.character) — vinted-listings-section.tsx uses it to pick a Pokémon Showdown sprite for the panel's mascot. */
  character: string;
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

/**
 * What a grading-tier pill shows on hover/focus: the tier's current median
 * ask, and how far that sits from what the same tier sells for.
 *
 * On the trend indicator, and why it is active-vs-sold rather than the
 * "vs previous snapshot" a preview card like this usually implies: there is
 * no per-grade price history anywhere in this codebase to compare against.
 * `Card.priceHistory` and `Card.trend` are the RAW card's series from
 * apitcg/TCGdex — labelling those as a PSA 10 movement would be the same
 * class of error as printing a EUR figure with a dollar sign, so they are
 * not used here. Active-vs-sold is the one genuine per-tier comparison the
 * data already carries, it is the comparison the two big buttons below
 * these pills are already making, and it reads the way a trend reads: asks
 * above recent sales, or below them.
 *
 * Colour follows the site's existing deal vocabulary (see
 * vinted-listings-section.tsx): green means the asks are BELOW sold, which
 * is the buyer-favourable direction, red means they are running hot.
 *
 * Sold data is illustrative everywhere on this site — eBay's sold API is
 * closed (lib/illustrative.ts) — so the delta inherits that and says so
 * with the same IllustrativeTag the rest of the panel uses. When a real
 * per-tier series does land, this function is the only thing that changes.
 */
function GradeTierPreview({
  label,
  market,
  active,
  sold,
}: {
  label: string;
  market: EbayLanguage;
  active: TypeSummary;
  sold: TypeSummary;
}) {
  const deltaPct = sold.medianPrice > 0 ? ((active.medianPrice - sold.medianPrice) / sold.medianPrice) * 100 : null;
  const above = (deltaPct ?? 0) >= 0;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">
        {label} · {market}
      </span>

      <div className="flex items-baseline gap-2">
        <span className="text-lg font-black tracking-[-0.4px] text-foreground tabular-nums">{active.avgLabel}</span>
        {deltaPct !== null && (
          <span
            className={`text-xs font-black tabular-nums ${above ? "text-pokemon-red" : "text-success-green"}`}
            /* The arrow is decorative — the sign is already in the text that follows it. */
            aria-hidden="true"
          >
            {above ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(0)}%
          </span>
        )}
      </div>

      <span className="text-[11px] font-bold text-muted-text">
        {deltaPct === null
          ? `Median ask · ${active.count} active`
          : `Median ask, ${Math.abs(deltaPct).toFixed(0)}% ${above ? "above" : "below"} sold · ${active.count} active`}
      </span>

      {(!active.isReal || !sold.isReal) && (
        <span className="mt-0.5">
          <IllustrativeTag label={active.isReal ? "Sold data illustrative" : "Preview — eBay not connected yet"} />
        </span>
      )}
    </div>
  );
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
 *
 * "France" is itself an approximation worth flagging: Vinted listing
 * titles/descriptions don't reliably state the card's print language (an
 * Italian or Japanese print reads the same as a French one to the name+
 * number matching in lib/vinted-listings.ts), so this feed can include
 * foreign-print asks alongside genuine French-market ones. The honest fix is
 * a real per-country price source — TCGGO's Cardmarket data has a
 * lowest_near_mint_FR field (see tcggo-integration-plan.md) — not a title-
 * text guess. Known and accepted for now; update this comment when that
 * lands.
 *
 * One exception to "every branch always in the DOM": the France branch below
 * hands off to VintedListingsSection, whose own doc comment explains why
 * real listings past a free-row cap are genuinely withheld rather than
 * CSS-hidden. English/Japanese eBay data is untouched by that — every row
 * still renders.
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
  /** Lets a caller open this panel straight to a given market instead of defaulting to English. Unset on the product page: the language toggle above deliberately doesn't drive these tabs — which eBay market a visitor wants to read is an independent choice from which language they want the card named in. */
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
          {entries.map((entry) => {
            // The tier's numbers for whichever market is currently selected.
            // France has no eBay language entry (and hides this tablist
            // entirely), so fall back rather than reaching into undefined.
            const tier = entry.languages.find((l) => l.language === market) ?? entry.languages[0];
            return (
              <FloatingPreviewChip
                key={entry.id}
                preview={<GradeTierPreview label={entry.label} market={tier.language} active={tier.active} sold={tier.sold} />}
              >
                {(trigger) => (
                  <button
                    {...trigger}
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
                )}
              </FloatingPreviewChip>
            );
          })}
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
        <VintedListingsSection vinted={vinted} />
      </div>
    </div>
  );
}
