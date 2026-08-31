import { IllustrativeTag } from "@/components/retro/illustrative-tag";

/**
 * The verdict: what grading this card returns, as one number with its
 * arithmetic shown.
 *
 * Replaces a solid-yellow banner that had two hero numbers competing — a
 * +649% ROI and an 87% margin dial of the same size — plus a footer sentence
 * explaining that both described the same USD 287 over different
 * denominators. Four problems, all fixed by the same change of shape:
 *
 * ONE primary number. The ROI is the headline because it is the actionable
 * one: it answers "is this worth doing" in a form a reader can compare
 * against any other use of the same money. The margin share is now a
 * supporting figure on the line under the bar, at body size.
 *
 * NO DIAL. The old radial gauge encoded nothing the text did not already
 * say — it drew one percentage as an arc and stopped. The bar below replaces
 * it with something that genuinely encodes: its full width is the PSA 10
 * ask, the dark segment is what you actually pay, and the yellow remainder
 * IS the margin. The 87% is that yellow segment, so the relationship the
 * footer used to spell out is now visible rather than described.
 *
 * YELLOW AS ACCENT. A saturated field with dark text on it is hard to read
 * at any length, and it made the card read as a marketing banner rather than
 * a figure worth trusting. White surface, yellow on the rail, the eyebrow
 * marker and the profit segment — where it now means something.
 *
 * ONE EXPLANATION. "Return on what you spend" and the footer sentence were
 * the same sentence twice. The headline's own caption carries it, and the
 * footnote keeps only what nothing else on the card can say: these are asks,
 * not completed sales.
 */
export function GradingRoiCard({
  percent,
  rawMedian,
  gradingCost,
  psa10Median,
  currency,
  market,
  isReal,
  fallbackNote,
}: {
  percent: number;
  rawMedian: number;
  gradingCost: number;
  psa10Median: number;
  currency: string;
  market: string;
  isReal: boolean;
  /** Set only when the selected market could not price the trade and English figures stand in. */
  fallbackNote?: string;
}) {
  const cost = rawMedian + gradingCost;
  const margin = psa10Median - cost;
  const money = (n: number) => `${currency} ${Math.round(n).toLocaleString()}`;

  // Clamped because a grade that sells below cost would otherwise draw a
  // segment wider than the bar. At 100% the yellow remainder disappears on
  // its own, which is the correct picture: nothing left over.
  const costShare = psa10Median > 0 ? Math.min(100, (cost / psa10Median) * 100) : 100;
  const marginShare = Math.max(0, 100 - costShare);

  return (
    <div className="overflow-hidden rounded-lg border-2 border-black bg-card-surface shadow-hard-md">
      {/* The rail is the only large area of colour left. It marks the card as
          the panel's conclusion without putting text on top of yellow. */}
      <div className="h-1.5 bg-pokemon-yellow" />

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-2.5 w-2.5 border-2 border-black bg-pokemon-yellow" />
          <span className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">
            Grading ROI · {market} · raw → PSA 10
          </span>
          {!isReal && <IllustrativeTag label="Preview — eBay not connected yet" />}
        </div>

        {/* Eyebrow < body < headline. The number is the only thing at this
            size anywhere on the card. */}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[44px] leading-none font-black tracking-[-1.6px] tabular-nums sm:text-5xl">
            {percent >= 0 ? "+" : ""}
            {percent.toFixed(0)}%
          </span>
          <span className="text-sm font-bold text-muted-text">return on what you spend</span>
        </div>

        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[10px] font-black tracking-[0.5px] uppercase">
            <span>You pay {money(cost)}</span>
            <span className="text-muted-text">PSA 10 asks {money(psa10Median)}</span>
          </div>

          {/* Full width = the sale. Dark = your outlay. Yellow = what is left. */}
          <div className="mt-1.5 flex h-5 overflow-hidden rounded-[3px] border-2 border-black">
            <div
              className={margin >= 0 ? "bg-foreground" : "bg-pokemon-red"}
              style={{ width: `${costShare}%` }}
            />
            <div className="flex-1 bg-pokemon-yellow" />
          </div>

          <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] font-bold text-muted-text">
            <span>
              {money(rawMedian)} card + {money(gradingCost)} grading
            </span>
            {margin >= 0 ? (
              <span>
                <span className="font-black text-foreground">{money(margin)} profit</span> · {marginShare.toFixed(0)}% of the
                sale
              </span>
            ) : (
              <span className="font-black text-pokemon-red">{money(Math.abs(margin))} short of what you paid</span>
            )}
          </div>
        </div>

        <p className="mt-4 border-t-2 border-border-subtle pt-3 text-[11px] font-bold text-muted-text">
          {isReal ? `${market} asking prices, not completed sales.` : "Preview numbers, not a real market reading."}
          {fallbackNote ? ` ${fallbackNote}` : ""}
        </p>
      </div>
    </div>
  );
}
