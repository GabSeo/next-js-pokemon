"use client";

import { useSyncExternalStore } from "react";
import { Gauge } from "@/components/charts/gauge";

const GAUGE_WIDTH = 190;
const GAUGE_HEIGHT = 112;

const subscribe = () => () => {};

/**
 * True only after the component is running in the browser, without the
 * setState-in-an-effect that this project's react-hooks config rejects.
 *
 * The gauge cannot be server-rendered. Bklit computes each notch's path from
 * trigonometry and emits full-precision floats, and the last unit in the last
 * place does not always agree between V8 on Node and V8 in Chrome — the
 * server sends `53.81143880104836` and the client renders
 * `53.81143880104837`, which React reports as a hydration mismatch and
 * repairs by throwing away and re-rendering the whole tree. Confirmed live
 * against the dev overlay, on the notch paths specifically.
 *
 * The other two charts on this panel do not hit it because both animate in
 * from a collapsed origin, so their first painted geometry is literally
 * `M 0,0` on either side. This one draws its real arc immediately.
 *
 * Nothing is lost by skipping SSR here: everything the dial encodes is
 * already text in the callout beside it — the ROI percentage, the raw and
 * PSA 10 medians, the grading fee, and the margin line below the gauge — so
 * an agent parsing raw HTML still reads the whole story. The rule this site
 * holds to is that data must be in the markup, not that every decoration must.
 */
function useIsBrowser(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}

/**
 * How much of a PSA 10 sale is margin, once the raw card and the grading are
 * paid for.
 *
 * Deliberately NOT the +214% beside it. That figure is return on cost —
 * margin over outlay — and it is unbounded, which is exactly why it cannot be
 * a dial: a gauge needs a full, and "+214% of a possible what?" has no
 * answer. This is the same three numbers over the other denominator, the sale
 * price, which is bounded by construction. A card can post an enormous return
 * on a tiny outlay while leaving little room in the sale, and the two
 * framings say so differently.
 *
 * Shares gradingRoi's inputs exactly (lib/roi.ts), so it inherits their
 * caveat: both medians are medians of the CHEAPEST active asks rather than of
 * the whole tier, and neither is a sold price. This is the spread at the
 * floor of the market today, not realised profit.
 *
 * A negative margin pins the dial at empty rather than drawing backwards, and
 * the line underneath states the loss in full. Grading is not always worth
 * it, and a gauge that could not show that would only be honest on the cards
 * where the answer was yes.
 */
export function GradingMarginGauge({
  psa10Median,
  rawMedian,
  gradingCostUsd,
  currency,
}: {
  psa10Median: number;
  rawMedian: number;
  gradingCostUsd: number;
  currency: string;
}) {
  const isBrowser = useIsBrowser();

  // No sale price, no share of it to show. Guards a PSA 10 tier that came back
  // empty, where the division below would be against zero.
  if (psa10Median <= 0) return null;

  const margin = psa10Median - rawMedian - gradingCostUsd;
  const sharePct = Math.max(0, Math.min(100, (margin / psa10Median) * 100));

  return (
    <div className="flex flex-col items-center">
      {/* Reserved at the gauge's own size so the callout does not jump height
          when the dial mounts. */}
      <div className="flex items-center justify-center" style={{ height: GAUGE_HEIGHT, width: GAUGE_WIDTH }}>
        {isBrowser && (
          <Gauge
            /* Near-black notches rather than the chart palette's red: this
               sits on the yellow callout, where --chart-1 would be the one
               red thing on the card competing with the CTA red used
               everywhere else. The inactive track is the same ink at low
               opacity, not bklit's default --border, which this project
               never defines as a raw custom property. */
            activeFill="var(--foreground)"
            /* The percentage, not the money: the fill IS this number, so the
               centre should read as the thing the dial is drawing. The
               currency figure gets the line below, where it has room to be
               formatted the way the rest of the page formats prices. */
            centerValue={Math.round(sharePct)}
            /* One word. An arc gauge always overlays its label on the centre,
               so it competes with the value for the same few pixels: "of PSA
               10 ask" collided with the number and ran under the notches on
               the left, and omitting the label entirely is not an opt-out —
               bklit falls back to the word "Total", which is wrong here. The
               qualifier it needs sits below the dial instead. */
            defaultLabel="margin"
            height={GAUGE_HEIGHT}
            inactiveFill="var(--foreground)"
            inactiveFillOpacity={0.16}
            suffix="%"
            totalNotches={28}
            value={sharePct}
            width={GAUGE_WIDTH}
          />
        )}
      </div>

      {/* `${currency} ${n}` rather than Intl currency formatting, which
          rendered "1 669 $US" here — correct for the locale and wrong for this
          site, where every other price on the page reads "USD 1 669". */}
      <span className="text-center text-[10px] font-bold text-[#5a4600]">
        {margin >= 0 ? (
          <>
            of the PSA 10 ask — {currency} {Math.round(margin).toLocaleString()}
          </>
        ) : (
          <>
            Grading loses {currency} {Math.abs(Math.round(margin)).toLocaleString()} at today&apos;s asks
          </>
        )}
      </span>
    </div>
  );
}
