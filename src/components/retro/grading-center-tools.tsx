"use client";

import { GradeAnalysisCard } from "@/components/retro/grade-analysis-card";
import type { GradeTableRow } from "@/components/retro/grade-rows";
import type { ProfitLadderGrade } from "@/components/retro/profit-ladder";
import { GradingRoiCard } from "@/components/retro/grading-roi-card";
import { MarketDataBadge } from "@/components/retro/market-data-badge";
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

  // Every grade, both markets, with the depth behind each price — the one
  // table under the charts. Ladder order (raw first) so the rows read the way
  // the bars do.
  const tableRows: GradeTableRow[] = [...conditions].reverse().map((entry) => {
    const cell = (language: string) => {
      const tier = entry.languages.find((l) => l.language === language)?.active;
      return tier ? { median: tier.medianPrice, count: tier.count } : null;
    };
    return { label: entry.condition, english: cell("English"), japanese: cell("Japanese") };
  });

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
  // Raw is the input rather than an outcome, so it is the one tier the ladder
  // does not list as a grade — it gets its own "sell raw now" row instead. The
  // target grade IS listed: on a shared scale it is what the weaker rows are
  // read against. A tier with nothing listed comes through as null, which the
  // ladder draws as an empty bar rather than a zero-price one.
  const payoffRows: ProfitLadderGrade[] = conditions
    .filter((entry) => entry.condition !== "Raw")
    .map((entry) => {
      const median = entry.languages.find((l) => l.language === roiMarket)?.active.medianPrice ?? 0;
      return { label: entry.condition, sale: median > 0 ? median : null, target: entry.condition === "PSA 10" };
    });
  const payoffCost = shownRoi.rawMedian + shownRoi.gradingCostUsd;

  // The chart plots both markets, so it is only "real" when both of the tiers
  // it draws are — a preview badge on one side would otherwise sit silently
  // under live bars from the other.
  const ladderIsReal = conditions.every((entry) =>
    entry.languages.every((l) => l.active.isReal)
  );

  return (
    <>
      {/* 01 reads the market: what the grades are worth, and whether the
          other market pays better for them. One column, full width each —
          side by side the narrower block only got squeezed. */}
      <div className="flex flex-col gap-4">
        {/* No market toggle here any more. The bar chart draws English and
            Japanese together, so there is nothing left for this step to
            switch — the Market Overview panel still carries the one toggle on
            the page, and the verdict below names whichever market it read. */}
        <StepHeading action={<MarketDataBadge isReal={shownRoi.isReal} />} step="01" title="Grade analysis" tone="red" />

        <GradeAnalysisCard
          currency={currency}
          ladderIsReal={ladderIsReal}
          market={gradedMarket}
          tableRows={tableRows}
        />
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
          outcomes={shownRoi.isReal && payoffCost > 0 ? payoffRows : []}
          percent={shownRoi.percent}
          psa10Median={shownRoi.psa10Median}
          rawMedian={shownRoi.rawMedian}
        />
      </div>
    </>
  );
}
