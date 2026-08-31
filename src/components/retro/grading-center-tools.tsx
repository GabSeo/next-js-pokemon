"use client";

import { GradeLadderChart, type GradeLadderRow } from "@/components/retro/grade-ladder-chart";
import { GradePayoffGauges, type GradePayoffRow } from "@/components/retro/grade-payoff-gauges";
import { GradingMarginGauge } from "@/components/retro/grading-margin-gauge";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { MarketGapRadar, type MarketGapRow } from "@/components/retro/market-gap-radar";
import { useSelectedMarket, type MarketTab } from "@/components/retro/market-tab";
import { StepHeading } from "@/components/retro/step-heading";
import type { EbayCondition } from "@/lib/ebay-browse";
import type { GradedMarketData, GradedMarketRoi } from "@/lib/graded-market";
import { gradingRoi } from "@/lib/roi";

/**
 * Everything the panel can say about grading this specific card, in the order
 * a decision actually gets made: what each grade is worth, whether the other
 * market pays better for it, what the raw-to-PSA-10 trade returns, and what
 * happens when the grade that comes back is not the one you hoped for.
 *
 * These four all used to live inside the Market Overview's tab body, below a
 * listings browser they had nothing to do with — you had to scroll past four
 * rows of eBay results to reach the analysis. Splitting them into their own
 * panel leaves Market Overview to do one job (what is for sale, at what
 * price, where) and gives the grading question a section of its own.
 *
 * It reads the same market toggle rather than owning a second one:
 * useSelectedMarket resolves the flag identically for both panels, so a click
 * in either heading moves both. The alternative — a Grading Center with its
 * own market state — would have put two controls on one screen that could
 * disagree about which market the reader is looking at.
 */
export function GradingCenterTools({
  conditions,
  roi,
}: {
  /**
   * Straight off getGradedMarketData, not the tab list's ConditionEntry:
   * nothing here needs the rendered row JSX that shape carries, only the
   * medians, counts and real/illustrative flags underneath it.
   */
  conditions: GradedMarketData["conditions"];
  /** Computed from English by lib/graded-market.ts; recomputed below for whichever market is selected. */
  roi: GradedMarketRoi;
}) {
  const marketTabs: MarketTab[] = [...conditions[0].languages.map((l) => l.language), "France"];
  const market = useSelectedMarket(marketTabs);

  // The tier the ladder and the payoff rows price against. France is not an
  // eBay market and has no grading tiers at all, so the whole panel falls
  // back to English there rather than rendering empty — Vinted sells one
  // condition and it is not a PSA grade.
  const gradedMarket: MarketTab = market === "France" ? marketTabs[0] : market;
  const currency = conditions[0].languages[0].active.currency;

  // Ladder order, raw first — `entries` arrives graded-first (PSA 10 down to
  // Raw) because that is the order the tabs read in, but a grading ladder
  // only tells its story from what you start with to what you could get.
  // Active asks only, and always the currently selected market's own numbers.
  const ladder: GradeLadderRow[] = [...conditions].reverse().map((entry) => {
    const tier = (entry.languages.find((l) => l.language === gradedMarket) ?? entry.languages[0]).active;
    return { label: entry.condition, median: tier.medianPrice, count: tier.count, noListings: tier.noListings };
  });
  const ladderIsReal = ladder.length > 0 && [...conditions].every((entry) => (entry.languages.find((l) => l.language === gradedMarket) ?? entry.languages[0]).active.isReal);

  // Same tiers, both eBay markets side by side. Unlike the ladder this does
  // NOT follow the toggle — it is the comparison between the two markets, so
  // it would be the same picture whichever flag is selected.
  //
  // Every tier goes in, including ones with no listings on one or both sides:
  // an empty market is drawn at the centre and named in words below the chart,
  // because "nobody is selling this grade here" is itself a market gap.
  // Filtering those out kept collapsing three-tier One Piece cards below the
  // three axes a polygon needs, taking the whole chart with them. See
  // MarketGapRadar's comment.
  const gapTiers = [...conditions]
    .reverse()
    .map((entry) => ({
      label: entry.condition,
      en: entry.languages.find((l) => l.language === "English")?.active,
      ja: entry.languages.find((l) => l.language === "Japanese")?.active,
    }))
    .filter((t) => t.en && t.ja);
  const gapRows: MarketGapRow[] = gapTiers.map((t) => ({ label: t.label, english: t.en!.medianPrice, japanese: t.ja!.medianPrice }));
  const gapIsReal = gapTiers.every((t) => t.en!.isReal && t.ja!.isReal);

  // Grading economics for the market the visitor is actually looking at.
  //
  // lib/graded-market.ts computes `roi` from English only, deliberately: it is
  // the one market guaranteed to resolve for every card, and the ROI there
  // never mixes a real median with an illustrative one. That was invisible
  // while the panel had its own market pills, and became misleading once the
  // flag toggle started driving everything else on the card — switch to JP and
  // every block re-read except this one, which kept quoting English without
  // saying so.
  //
  // So it is recomputed here for the selected market whenever that market has
  // BOTH tiers real and priced, using the same gradingRoi() the server used.
  // When it does not — a Japanese raw or PSA 10 tier with no listings — the
  // English figures stand rather than a half-Japanese hybrid, and the footnote
  // below says which market the reader is being shown. Falling back silently
  // is the exact failure this block is fixing.
  const activeTier = (condition: EbayCondition, language: MarketTab) =>
    conditions.find((c) => c.condition === condition)?.languages.find((l) => l.language === language)?.active;
  const roiPsa10 = activeTier("PSA 10", market);
  const roiRaw = activeTier("Raw", market);
  const roiFollowsMarket =
    !!roiPsa10?.isReal &&
    !!roiRaw?.isReal &&
    roiPsa10.medianPrice > 0 &&
    roiRaw.medianPrice > 0;
  const shownRoi = roiFollowsMarket
    ? {
        isReal: true,
        percent: gradingRoi(roiPsa10!.medianPrice, roiRaw!.medianPrice, roi.gradingCostUsd) * 100,
        psa10Median: roiPsa10!.medianPrice,
        rawMedian: roiRaw!.medianPrice,
        gradingCostUsd: roi.gradingCostUsd,
        currency: roiPsa10!.currency,
      }
    : roi;
  const roiMarket: MarketTab = roiFollowsMarket ? market : "English";

  // The same bet, priced for every grade it could come back as. Raw is not an
  // outcome of grading — it is the input — so it is the one tier excluded.
  // Read from roiMarket rather than `market` so the payoff rows and the ROI
  // callout above can never quote different markets at each other.
  const payoffRows: GradePayoffRow[] = conditions
    .filter((entry) => entry.condition !== "Raw")
    .map((entry) => ({
      label: entry.condition,
      sale: entry.languages.find((l) => l.language === roiMarket)?.active.medianPrice ?? 0,
    }));
  const payoffCost = shownRoi.rawMedian + shownRoi.gradingCostUsd;

  return (
    <>
      {/* One column. The two-column arrangement asked each block to be read
          against the one beside it, which is not how these are used — they
          are three separate readings taken in order, and side by side the
          narrower one just got squeezed. Full width each, stacked. */}
      <div className="flex flex-col gap-4">
        <StepHeading step="01" title="Grade analysis" tone="red" />

        <GradeLadderChart currency={currency} isReal={ladderIsReal} market={gradedMarket} rows={ladder} />

        <MarketGapRadar currency={currency} isReal={gapIsReal} rows={gapRows} />

        {shownRoi.isReal && payoffCost > 0 && (
          <GradePayoffGauges
            cost={payoffCost}
            currency={shownRoi.currency}
            isReal={shownRoi.isReal}
            market={roiMarket}
            rows={payoffRows}
          />
        )}
      </div>

      {/* 02 — the verdict. Its own step because everything above is a reading
          and this is the answer they add up to. */}
      <div className="flex flex-col gap-4">
        <StepHeading step="02" title="The verdict" tone="yellow" />

        <div className="overflow-hidden rounded-lg border-2 border-black bg-pokemon-yellow shadow-hard-md">
        {/* The gauge shares this callout rather than taking a card of its
            own: it is the same raw / grading / PSA 10 arithmetic read over
            the sale price instead of over the outlay, and splitting one
            decision across two boxes would have said "grading" three times
            in a row down the panel. Two columns on wide screens, stacked
            below the figures on narrow ones. */}
        {/* Both figures spelled out in words, because "ROI" and "margin"
            are trade terms and a visitor pricing their first card should
            not have to already know them. Whole units, not the raw
            medians: "USD 756,475" is 756 dollars and 47 cents under this
            locale's decimal comma, and it reads as three-quarters of a
            million to anyone who assumes otherwise. Cents are noise on a
            median of four asks anyway. */}
        <div className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              {/* The market is named here, not left implied. Every other
                  block on this panel is titled with the market it reads, and
                  this one is the only place the two can disagree. */}
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-black tracking-[0.3px] text-[#5a4600] uppercase">
                Grading ROI · {roiMarket} — raw → PSA 10
                {!shownRoi.isReal && <IllustrativeTag label="Preview — eBay not connected yet" />}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-3xl font-black tracking-[-0.6px] text-foreground tabular-nums">
                  {shownRoi.percent >= 0 ? "+" : ""}
                  {shownRoi.percent.toFixed(0)}%
                </span>
                <span className="text-xs font-black tracking-[0.3px] text-[#5a4600] uppercase">Return on what you spend</span>
              </div>
              <p className="mt-1.5 max-w-[46ch] text-xs font-bold text-[#5a4600]">
                {shownRoi.currency} {Math.round(shownRoi.rawMedian + shownRoi.gradingCostUsd).toLocaleString()} in (card +{" "}
                {shownRoi.currency} {shownRoi.gradingCostUsd} grading) · a PSA 10 asks {shownRoi.currency}{" "}
                {Math.round(shownRoi.psa10Median).toLocaleString()}
              </p>
            </div>

            <GradingMarginGauge
              currency={shownRoi.currency}
              gradingCostUsd={shownRoi.gradingCostUsd}
              psa10Median={shownRoi.psa10Median}
              rawMedian={shownRoi.rawMedian}
            />
          </div>

          {/* The two figures are the same money measured against different
              things, and saying so is the only way the pair reads as one
              answer rather than two competing ones. They are not
              independent readings either — one is a fixed rearrangement of
              the other — so presenting them as a cross-check would be a
              lie by implication. */}
          {/* Kept to the one thing neither figure says on its own — that they
              are the same money over different denominators. The grading-fee
              caveat lives in the panel's context row now instead of being
              repeated here. */}
          <p className="mt-4 border-t-2 border-black/15 pt-3 text-[11px] font-bold text-[#5a4600]">
            Same {shownRoi.currency}{" "}
            {Math.round(shownRoi.psa10Median - shownRoi.rawMedian - shownRoi.gradingCostUsd).toLocaleString()} either way —
            measured against what you spend, then against what you sell for.{" "}
            {shownRoi.isReal ? `${roiMarket} asking prices, not completed sales.` : "Preview numbers, not a real market reading."}{" "}
            {market !== "France" && !roiFollowsMarket && shownRoi.isReal
              ? `No priced ${market} raw and PSA 10 pair today, so English figures are shown.`
              : ""}
          </p>
        </div>
      </div>
      </div>
    </>
  );
}
