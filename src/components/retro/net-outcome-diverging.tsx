"use client";

import { useReducedMotion } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { buildSymlogScale } from "@/lib/symlog";
import { gradedNetProfit, rawNetProfit, type GradingAssumptions } from "@/lib/roi";

/**
 * Net outcome by decision — diverging bars on a symmetric-log scale.
 *
 * The scale itself, and why it is not linear, lives in lib/symlog.ts. This
 * file is the drawing, and the two things it has to get right are the ones a
 * naive bar chart gets wrong.
 *
 * ONE LANE PER ROW, LABEL ABOVE IT. The row label sits over its own
 * full-width lane rather than beside it. Put the label in a left column and
 * the lane loses that width permanently — which the losing side, already the
 * narrow one, cannot afford — and a long label squeezes the very bars it
 * names. Above, every bar gets the whole width in both directions and can
 * never collide with text.
 *
 * VALUE LABELS ARE PLACED BY MEASURED PIXELS, not by percentage guesses. A
 * percentage rule ("inside if the bar is over 25%") breaks the moment the
 * card is narrow or the number is long: USD 1,489 needs about 70px whatever
 * the lane is. So the lane is measured with a ResizeObserver, the label with
 * its own ref, and the three placements are tried in order — inside the bar,
 * at its tip, then pinned inside the lane edge. The last is a fallback rather
 * than a layout: it only happens when neither the bar nor the gutter can hold
 * the text, and it still cannot cross the card border.
 */

/** The brief's palette for this section, kept local until the tokens are adopted site-wide. */
const LOSS = "#DE3122";
const PROFIT = "#0F9E57";
const INK = "#111111";
const LANE_BG = "#F4F4F1";
const LANE_EDGE = "#E2E2DC";
const GRIDLINE = "#CDCDC6";
const META = "#8B8B86";

/**
 * Geometry moves on CSS transitions rather than through Motion, which is also
 * what the reference mockup does.
 *
 * Motion was tried first and silently refused to write `left`: React re-rendered
 * with the correct pixel value every time (verified in the console — lane=676,
 * label=82, kind=inside) while the DOM kept the first render's `left:0`. CSS has
 * no such trouble with a number-to-number transition, and the curve and duration
 * below are the brief's, unchanged. Motion still earns its place for the
 * count-up numbers, which are a value animation rather than a layout one.
 */
const EASE = "cubic-bezier(.2,.8,.2,1)";
const GEOMETRY_MS = 380;
const COLOUR_MS = 200;

/** Breathing room a label needs on each side before it is allowed to sit somewhere. */
const LABEL_PAD = 10;

export type DecisionOutcome = {
  label: string;
  /** Median asking price for this outcome, or null when nothing is listed. */
  sale: number | null;
  /** Raw is the one outcome reached WITHOUT paying the grading fee. */
  graded: boolean;
  /** The grade the ROI headline is about. */
  target?: boolean;
};

/**
 * Always a NUMERIC left, never "auto" — motion cannot animate from `auto` to a
 * pixel value. It bails silently and leaves the element at whatever the first
 * render wrote, which is exactly the bug this shape prevents: every label was
 * stuck ink-black at the lane's start while the logic behind it was correct.
 */
type Placement = { kind: "inside" | "tip" | "pinned"; left: number; color: string };

export function NetOutcomeDiverging({
  outcomes,
  assumptions,
  currency,
}: {
  outcomes: DecisionOutcome[];
  assumptions: GradingAssumptions;
  currency: string;
}) {
  const priced = outcomes.filter((o) => o.sale != null && o.sale > 0);
  const rows = priced.map((o) => ({
    ...o,
    sale: o.sale as number,
    net: o.graded ? gradedNetProfit(o.sale as number, assumptions) : rawNetProfit(o.sale as number, assumptions),
  }));

  const [laneWidth, setLaneWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  /**
   * A CALLBACK REF, not useRef plus an effect, and the difference is a real
   * bug rather than a preference.
   *
   * With `useRef` + `useLayoutEffect(…, [])` the measurement runs once, on
   * mount. This chart returns null while it has no priced outcomes, so on a
   * cold page load the first render has no lane at all: the effect fired,
   * found `null`, returned — and never ran again once the data arrived,
   * leaving the width at 0 forever. Every label then fell back to the
   * "unmeasured" branch and rendered ink-black at the lane's left edge. It
   * only looked correct after a hot reload, because by then the data was
   * already there when the component mounted.
   *
   * A callback ref runs whenever the node attaches or detaches, so the
   * measurement cannot miss its own element regardless of render order.
   */
  const laneRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const measure = () => setLaneWidth(node.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    observerRef.current = ro;
  }, []);

  if (rows.length === 0) return null;

  const scale = buildSymlogScale(rows.map((r) => r.net), { currency });
  const money = (n: number) =>
    `${n < 0 ? "−" : "+"}${currency} ${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

  return (
    <section
      aria-labelledby="net-outcome-title"
      className="border-2 border-black bg-white p-5 sm:px-[22px] sm:pt-5 sm:pb-[18px]"
      style={{ boxShadow: "4px 4px 0 #111" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="text-xs font-black tracking-[0.1em] uppercase" id="net-outcome-title">
          Net outcome by decision
        </h3>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <Key color={LOSS} label="Loss" />
          <Key color={PROFIT} label="Profit" />
          <span
            className="border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.1em] uppercase"
            style={{ borderColor: "#C9C9C4", color: "#6E6E68" }}
          >
            Symlog scale
          </span>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] leading-[1.45] font-semibold" style={{ color: META }}>
        What you keep after the card, the grading fee and the marketplace&apos;s cut. One shared scale from zero,
        compressed logarithmically past {currency} 5, so a small loss stays comparable to a large win.
      </p>

      <div className="mt-[18px] flex flex-col gap-4">
        {rows.map((row, i) => (
          <OutcomeRow
            assumptions={assumptions}
            currency={currency}
            key={row.label}
            laneRef={i === 0 ? laneRef : undefined}
            laneWidth={laneWidth}
            money={money}
            row={row}
            scale={scale}
          />
        ))}
      </div>

      {/* The axis. Without the powers of ten a reader has no way to tell the
          lane is compressed rather than linear. */}
      <div className="relative mt-[7px] h-[15px] border-t pt-[3px]" style={{ borderColor: "#DCDCD7" }}>
        <span
          className="absolute top-[3px] -translate-x-1/2 text-[9.5px] font-black tabular-nums"
          style={{ left: `${scale.zeroPct}%` }}
        >
          0
        </span>
        {scale.ticks.map((t) => (
          <span
            className="absolute top-[3px] -translate-x-1/2 text-[9.5px] font-semibold whitespace-nowrap tabular-nums"
            key={t.value}
            style={{ left: `${t.leftPct}%`, color: META }}
          >
            {t.label}
          </span>
        ))}
      </div>

      {/* The same figures as text. A diverging bar chart is unreadable to a
          screen reader however well the bars are labelled. */}
      <table className="sr-only">
        <caption>Net outcome by decision</caption>
        <thead>
          <tr>
            <th scope="col">Decision</th>
            <th scope="col">Sale price</th>
            <th scope="col">Net outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{`${currency} ${Math.round(r.sale).toLocaleString("en-US")}`}</td>
              <td>{money(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-black tracking-[0.08em] uppercase">
      <span className="h-[11px] w-[11px] border-2 border-black" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function OutcomeRow({
  row,
  scale,
  laneWidth,
  laneRef,
  currency,
  assumptions,
  money,
}: {
  row: DecisionOutcome & { sale: number; net: number };
  scale: ReturnType<typeof buildSymlogScale>;
  laneWidth: number;
  laneRef?: (node: HTMLDivElement | null) => void;
  currency: string;
  assumptions: GradingAssumptions;
  money: (n: number) => string;
}) {
  const reduced = useReducedMotion();
  const [labelWidth, setLabelWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const text = money(row.net);

  // Same reasoning as the lane above, plus one of its own: the label's width
  // changes with its text ("+USD 9" against "+USD 1,489"), and re-measuring on
  // attach keeps the three placements honest as the figures move.
  const labelNode = useRef<HTMLSpanElement | null>(null);
  const labelRef = useCallback((node: HTMLSpanElement | null) => {
    labelNode.current = node;
    if (node) setLabelWidth(node.getBoundingClientRect().width);
  }, []);
  useLayoutEffect(() => {
    if (labelNode.current) setLabelWidth(labelNode.current.getBoundingClientRect().width);
  }, [text]);

  const { leftPct, widthPct, positive } = scale.bar(row.net);
  const color = row.net >= 0 ? PROFIT : LOSS;

  const place = useCallback((): Placement => {
    if (laneWidth <= 0 || labelWidth <= 0) return { kind: "tip", left: 0, color: INK };
    const barPx = (widthPct / 100) * laneWidth;
    const barLeftPx = (leftPct / 100) * laneWidth;
    const barRightPx = barLeftPx + barPx;
    const clamp = (x: number) => Math.max(0, Math.min(laneWidth - labelWidth, x));

    // 1. Inside the bar, in white — only when the bar genuinely holds it.
    if (barPx >= labelWidth + LABEL_PAD * 2) {
      return {
        kind: "inside",
        left: clamp(positive ? barLeftPx + LABEL_PAD : barRightPx - LABEL_PAD - labelWidth),
        color: "#ffffff",
      };
    }
    // 2. At the tip, in the bar's own colour, when the gutter beyond it fits.
    const gutter = positive ? laneWidth - barRightPx : barLeftPx;
    if (gutter >= labelWidth + LABEL_PAD) {
      return {
        kind: "tip",
        left: clamp(positive ? barRightPx + LABEL_PAD : barLeftPx - LABEL_PAD - labelWidth),
        color,
      };
    }
    // 3. Last resort: pinned inside the lane edge, in ink, never past the border.
    return {
      kind: "pinned",
      left: clamp(positive ? laneWidth - LABEL_PAD - labelWidth : LABEL_PAD),
      color: INK,
    };
  }, [laneWidth, labelWidth, widthPct, leftPct, positive, color]);

  const placement = place();
  const breakdown = [
    { k: "Sale price", v: `${currency} ${Math.round(row.sale).toLocaleString("en-US")}` },
    { k: "Card cost", v: `− ${currency} ${Math.round(assumptions.cardCost).toLocaleString("en-US")}` },
    ...(row.graded
      ? [{ k: "Grading fee", v: `− ${currency} ${Math.round(assumptions.gradingFee).toLocaleString("en-US")}` }]
      : []),
    {
      k: `Marketplace ${(assumptions.feeRate * 100).toFixed(1)}%`,
      v: `− ${currency} ${Math.round(row.sale * assumptions.feeRate).toLocaleString("en-US")}`,
    },
    { k: "Net", v: money(row.net) },
  ];

  return (
    <div className="relative flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`text-[11.5px] font-black tracking-[0.08em] uppercase transition-colors ${open ? "text-black" : ""}`}
          style={{ color: open ? INK : "#3A3A36" }}
        >
          {row.label}
          {row.target && <span className="ml-1.5 inline-block h-1.5 w-1.5 align-middle" style={{ background: "#FFD400" }} />}
        </span>
        <span className="text-[10.5px] font-semibold tabular-nums" style={{ color: META }}>
          {`sells at ${currency} ${Math.round(row.sale).toLocaleString("en-US")}`}
        </span>
      </div>

      {/* overflow-hidden is load-bearing: it clips the gridlines and the zero
          line to the lane so they cannot bleed into the label row above. */}
      <div
        className="relative h-[30px] overflow-hidden border-t border-b outline-none"
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        ref={laneRef}
        style={{ background: LANE_BG, borderColor: LANE_EDGE }}
        tabIndex={0}
      >
        {scale.ticks.map((t) => (
          <span
            className="absolute top-0 bottom-0 border-l border-dashed"
            key={t.value}
            style={{
              borderColor: GRIDLINE,
              left: `${t.leftPct}%`,
              transition: reduced ? undefined : `left ${GEOMETRY_MS}ms ${EASE}`,
            }}
          />
        ))}

        <span
          className="absolute top-0 bottom-0 w-0.5"
          style={{
            background: INK,
            left: `${scale.zeroPct}%`,
            transition: reduced ? undefined : `left ${GEOMETRY_MS}ms ${EASE}`,
          }}
        />

        {/* Animating left AND width together is what makes a bar travel across
            zero when a value flips sign, rather than vanishing and reappearing
            on the other side. */}
        <div
          className="absolute top-[3px] bottom-[3px] border-2 border-black"
          style={{
            minWidth: 11,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            backgroundColor: color,
            boxShadow: open ? "3px 3px 0 #111" : "none",
            transition: reduced
              ? undefined
              : `left ${GEOMETRY_MS}ms ${EASE}, width ${GEOMETRY_MS}ms ${EASE}, background-color ${COLOUR_MS}ms linear, box-shadow ${COLOUR_MS}ms linear`,
          }}
        />

        <span
          className="absolute top-0 bottom-0 flex items-center text-sm font-black whitespace-nowrap tabular-nums"
          ref={labelRef}
          style={{
            left: placement.left,
            color: placement.color,
            transition: reduced ? undefined : `left ${GEOMETRY_MS}ms ${EASE}, color ${COLOUR_MS}ms linear`,
          }}
        >
          {text}
        </span>
      </div>

      {open && (
        <div
          className="absolute top-full left-0 z-20 mt-1 min-w-[188px] border-2 border-black bg-white p-2.5"
          role="tooltip"
          style={{ boxShadow: "4px 4px 0 #111" }}
        >
          <div className="text-[10px] font-black tracking-[0.08em] uppercase">{row.label}</div>
          <dl className="mt-1.5 flex flex-col gap-1">
            {breakdown.map((b, i) => (
              <div
                className={`flex justify-between gap-4 text-[11px] ${i === breakdown.length - 1 ? "border-t pt-1 font-black" : "font-semibold"}`}
                key={b.k}
                style={i === breakdown.length - 1 ? { borderColor: LANE_EDGE } : undefined}
              >
                <dt style={{ color: i === breakdown.length - 1 ? INK : META }}>{b.k}</dt>
                <dd className="tabular-nums" style={{ color: i === breakdown.length - 1 ? color : INK }}>
                  {b.v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
