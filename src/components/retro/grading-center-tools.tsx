"use client";

import { GradeAnalysisScreen } from "@/components/retro/grade-analysis-screen";
import type { GradeTableRow } from "@/components/retro/grade-rows";
import type { DecisionOutcome } from "@/components/retro/net-outcome-diverging";
import { VerdictScreen } from "@/components/retro/verdict-screen";
import { useSelectedMarket, type MarketTab } from "@/components/retro/market-tab";
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

  const currency = conditions[0].languages[0].active.currency;

  // Every grade, both markets, with the depth behind each price — the one
  // table under the charts. Ladder order (raw first) so the rows read the way
  // the bars do.
  const tableRows: GradeTableRow[] = [...conditions].reverse().map((entry) => {
    const cell = (language: string) => {
      const tier = entry.languages.find((l) => l.language === language)?.active;
      if (!tier) return null;
      // rows[0] is genuinely the cheapest, not merely the first: eBay's own
      // price sort only orders within shards, so searchActiveListings re-sorts
      // locally before slicing (see ebay-browse.ts). Photo and link ride along
      // only for real tiers — never for an illustrative one.
      const cheapest = tier.isReal ? tier.rows[0] : undefined;
      return {
        median: tier.medianPrice,
        count: tier.count,
        imageUrl: cheapest?.imageUrl,
        url: cheapest?.url,
      };
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

  const TARGET_GRADE = "PSA 10";

  // Every outcome of the same decision: each grade it could come back as,
  // then the one that skips grading entirely. Raw is not a grade — it is what
  // happens if you do nothing — which is why it carries `graded: false` and
  // is priced without the submission fee.
  const outcomes: DecisionOutcome[] = [
    ...conditions
      .filter((entry) => entry.condition !== "Raw")
      .map((entry) => {
        const median = entry.languages.find((l) => l.language === roiMarket)?.active.medianPrice ?? 0;
        return {
          label: entry.condition,
          sale: median > 0 ? median : null,
          graded: true,
          target: entry.condition === TARGET_GRADE,
        };
      }),
    { label: "Sell raw", sale: shownRoi.rawMedian > 0 ? shownRoi.rawMedian : null, graded: false },
  ];

  const rawListings =
    conditions.find((c) => c.condition === "Raw")?.languages.find((l) => l.language === roiMarket)?.active.count ?? 0;

  // The ladder plots both markets, so it is only "real" when every tier it
  // draws is — a preview badge on one side would otherwise sit silently under
  // live bars from the other.
  const ladderIsReal = conditions.every((entry) => entry.languages.every((l) => l.active.isReal));

  return (
    <div className="flex flex-col gap-12">
      {/* France is not an eBay grading market — Vinted sells one condition and
          it is not a PSA grade — so the focal premium falls back to English
          there, exactly as the verdict's ROI already does. */}
      <GradeAnalysisScreen
        currency={currency}
        isReal={ladderIsReal}
        market={market === "Japanese" ? "Japanese" : "English"}
        rows={tableRows}
      />

      <VerdictScreen
        currency={shownRoi.currency}
        defaultGradingFee={shownRoi.gradingCostUsd}
        fallbackNote={
          market !== "France" && !roiFollowsMarket && shownRoi.isReal
            ? `No priced ${market} raw and PSA 10 pair today, so English figures are shown.`
            : undefined
        }
        isReal={shownRoi.isReal}
        market={roiMarket}
        outcomes={outcomes}
        rawListings={rawListings}
        rawMedian={shownRoi.rawMedian}
        targetSale={shownRoi.psa10Median}
      />
    </div>
  );
}
