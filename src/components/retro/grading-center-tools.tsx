"use client";

import { GradeLadderChart, type GradeLadderRow } from "@/components/retro/grade-ladder-chart";
import { GradePayoffGauges, type GradePayoffRow } from "@/components/retro/grade-payoff-gauges";
import { GradingRoiCard } from "@/components/retro/grading-roi-card";
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
      {/* 01 reads the market: what the grades are worth, and whether the
          other market pays better for them. One column, full width each —
          side by side the narrower block only got squeezed. */}
      <div className="flex flex-col gap-4">
        <StepHeading step="01" title="Grade analysis" tone="red" />

        <GradeLadderChart currency={currency} isReal={ladderIsReal} market={gradedMarket} rows={ladder} />

        <MarketGapRadar currency={currency} isReal={gapIsReal} rows={gapRows} />
      </div>

      {/* 02 answers the question, and it takes both cards to answer it. The
          ROI card prices the outcome everyone hopes for; the payoff rows
          price the ones you might actually get. Split across two steps, the
          verdict read as though PSA 10 were the whole answer and the other
          grades were background reading — which is backwards, since the
          grade is the part you do not choose. */}
      <div className="flex flex-col gap-4">
        <StepHeading step="02" title="The verdict" tone="yellow" />

        <GradingRoiCard
          currency={shownRoi.currency}
          fallbackNote={
            market !== "France" && !roiFollowsMarket && shownRoi.isReal
              ? `No priced ${market} raw and PSA 10 pair today, so English figures are shown.`
              : undefined
          }
          gradingCost={shownRoi.gradingCostUsd}
          isReal={shownRoi.isReal}
          market={roiMarket}
          percent={shownRoi.percent}
          psa10Median={shownRoi.psa10Median}
          rawMedian={shownRoi.rawMedian}
        />

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
    </>
  );
}
