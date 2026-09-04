"use client";

import { useState } from "react";

import {
  AnimatedNumber,
  Caveat,
  CaveatDisclosure,
  DS,
  FlagMark,
  FocalCard,
  FocalNumber,
  HoverTip,
  ScreenHeader,
  SourceTag,
  StatCard,
} from "@/components/retro/grading-ds";
import { NetOutcomeDiverging, type DecisionOutcome } from "@/components/retro/net-outcome-diverging";
import {
  breakEvenSalePrice,
  gradedNetProfit,
  normalizeAssumptions,
  roiPercent,
  type GradingAssumptions,
} from "@/lib/roi";

/**
 * 02 The Verdict — what grading returns once the reader's own costs are in it.
 *
 * THE ASSUMPTIONS ARE ALWAYS OPEN. No toggle, no summary line, no expanded
 * and collapsed copies of the same three numbers to keep in sync. They are
 * inputs to everything below them, and an input you have to reveal reads as
 * an advanced option rather than as part of the answer.
 */
export function VerdictScreen({
  outcomes,
  targetSale,
  rawMedian,
  defaultGradingFee,
  rawListings,
  currency,
  market,
  isReal,
  fallbackNote,
}: {
  outcomes: DecisionOutcome[];
  /** Median ask for the target grade — the sale the focal ROI is computed from. */
  targetSale: number;
  rawMedian: number;
  defaultGradingFee: number;
  rawListings: number;
  currency: string;
  market: string;
  isReal: boolean;
  fallbackNote?: string;
}) {
  const [open, setOpen] = useState(false);

  /**
   * RAW TEXT, not number inputs, and parsed only for the maths.
   *
   * A `type="number"` field fights the reader on the way to a value: "12.5"
   * is invalid at "12." and some browsers blank it, an empty field becomes 0
   * rather than staying empty, and the spinners are useless at this size.
   * Holding the text lets someone clear a field and type freely, while the
   * figures below fall back to the default for whatever does not parse — the
   * verdict never blanks out mid-keystroke.
   */
  const [text, setText] = useState<{ card: string; fee: string; sell: string } | null>(null);
  const defaults = {
    card: String(Math.round(rawMedian)),
    fee: String(Math.round(defaultGradingFee)),
    sell: "13",
  };
  const fields = text ?? defaults;

  const parse = (raw: string, fallback: number) => {
    const n = Number.parseFloat(raw.replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };
  const assumptions: GradingAssumptions = normalizeAssumptions({
    cardCost: parse(fields.card, rawMedian),
    gradingFee: parse(fields.fee, defaultGradingFee),
    feeRate: parse(fields.sell, 13) / 100,
  });

  const set = (key: "card" | "fee" | "sell", value: string) => setText({ ...fields, [key]: value });

  const net = gradedNetProfit(targetSale, assumptions);
  const roi = roiPercent(net, assumptions);
  const breakEven = breakEvenSalePrice(assumptions);
  const outlay = assumptions.cardCost + assumptions.gradingFee;
  const feeAmount = targetSale * assumptions.feeRate;

  const money = (n: number) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;
  const signed = (n: number) => `${n < 0 ? "−" : "+"}${money(Math.abs(n))}`;

  // Composition of the sale, as percentages that always total the bar.
  const pct = (n: number) => (targetSale > 0 ? Math.max(0, Math.min(100, (n / targetSale) * 100)) : 0);
  const wCard = pct(assumptions.cardCost);
  const wGrade = pct(assumptions.gradingFee);
  const wFee = pct(feeAmount);

  const gradedNets = outcomes
    .filter((o) => o.graded && !o.target && o.sale != null)
    .map((o) => gradedNetProfit(o.sale as number, assumptions));
  const losers = gradedNets.filter((n) => n <= 0).length;
  const verdict =
    net <= 0
      ? { tone: DS.red, status: "NOT WORTH GRADING TODAY", lead: "Even the top grade sells for less than it costs to get there." }
      : losers === gradedNets.length && gradedNets.length > 0
        ? { tone: DS.red, status: "CONDITIONAL OPPORTUNITY", lead: "The top grade pays. Every grade below it loses money." }
        : losers > 0
          ? { tone: DS.yellow, status: "CONDITIONAL OPPORTUNITY", lead: "The higher grades pay. The lower ones do not." }
          : { tone: DS.green, status: "GRADING PAYS AT EVERY GRADE", lead: "Every grade this could come back as clears its costs." };

  return (
    <section className="flex flex-col gap-3.5">
      <ScreenHeader
        right={
          <span
            className="inline-flex items-center gap-[7px] text-[10px] font-bold tracking-[0.1em]"
            style={{ color: DS.kicker }}
          >
            <FlagMark market="english" />
            {market.toUpperCase()} · RAW → PSA 10
          </span>
        }
        step="02"
        title="THE VERDICT"
        tone="yellow"
      />

      <div className="border-2" style={{ borderColor: DS.ink, background: DS.surface }}>
        <div
          className="flex flex-wrap items-center gap-2.5 border-b-2 px-3.5 py-2.5"
          style={{ background: DS.yellow, borderColor: DS.ink }}
        >
          <span className="h-[11px] w-[11px] flex-none" style={{ background: DS.ink }} />
          <span className="text-[11px] font-black tracking-[0.1em]">YOUR ASSUMPTIONS</span>
          <span className="min-w-2 flex-1" />
          <span
            className="inline-flex items-center gap-[7px] border-2 py-0.5 pr-2 pl-1.5 text-[9.5px] font-black tracking-[0.1em]"
            style={{ borderColor: DS.ink, background: DS.surface }}
          >
            <span className="ct-pulse h-[7px] w-[7px] rounded-full" style={{ background: DS.green }} />
            EVERY FIGURE BELOW RECALCULATES AS YOU TYPE
          </span>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(196px,1fr))]">
          <Field
            hint={`Median raw ${market} ask, ${rawListings.toLocaleString("en-US")} listings today.`}
            label={`CARD COST · ${currency}`}
            onChange={(v) => set("card", v)}
            source="FROM LIVE LISTINGS"
            sourceNote={`The median raw ${market} asking price on eBay, across ${rawListings.toLocaleString("en-US")} listings, read on this build. It is what a copy asks today — not what you paid, which is why this field is yours to change.`}
            value={fields.card}
          />
          <Field
            hint="Published per-card rate, shipping excluded."
            label={`GRADING FEE · ${currency}`}
            onChange={(v) => set("fee", v)}
            source="PSA STANDARD TIER"
            sourceNote="PSA's published per-card rate for the standard tier. Not fetched from anywhere — their real pricing moves with declared value and turnaround, so treat it as an assumption rather than a quote."
            value={fields.fee}
          />
          <Field
            hint="Final-value fee before any store discount."
            label="SELLING FEE · % OF SALE"
            last
            onChange={(v) => set("sell", v)}
            source="EBAY HEADLINE RATE"
            sourceNote="eBay's headline final-value fee for trading cards. Not fetched: the rate you actually pay moves with store subscription and promoted-listing choices."
            value={fields.sell}
          />
        </div>
      </div>

      <FocalCard>
        <div className="flex items-center gap-2 text-[11px] font-black tracking-[0.12em]">
          <span className="h-[11px] w-[11px] border-2" style={{ background: DS.yellow, borderColor: DS.ink }} />
          <span>GRADING ROI · IF IT GRADES PSA 10</span>
        </div>

        <FocalNumber
          arithmetic={`${money(assumptions.cardCost)} card + ${money(assumptions.gradingFee)} grading, sold at ${money(targetSale)} less ${(assumptions.feeRate * 100).toFixed(1)}% fee`}
          cqw="15cqw"
          lead="return on what you spend, after fees"
          max="140px"
          min="70px"
          value={
            roi == null ? (
              "—"
            ) : (
              <AnimatedNumber
                format={(n) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString("en-US")}%`}
                value={roi}
              />
            )
          }
        />

        <div className="mt-6">
          <div className="mb-[7px] flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-[10px] font-black tracking-[0.1em]" style={{ color: DS.kicker }}>
              WHERE THE PSA 10 SALE GOES
            </span>
            <span className="text-[11px] font-semibold tabular-nums" style={{ color: DS.meta }}>
              {money(targetSale)} sale · {money(outlay)} in
            </span>
          </div>
          <div className="flex h-8 overflow-hidden border-2" style={{ borderColor: DS.ink }}>
            <Seg background={DS.ink} width={wCard} />
            <Seg
              background={`repeating-linear-gradient(135deg,${DS.ink} 0 3px,#fff 3px 7px)`}
              bordered
              width={wGrade}
            />
            <Seg background="#DCDCD7" bordered width={wFee} />
            <div className="flex-1 border-l-2" style={{ background: DS.yellow, borderColor: DS.ink }} />
          </div>
          <div className="mt-[9px] flex flex-wrap gap-x-[18px] gap-y-2">
            <Legend background={DS.ink} label={`Card ${money(assumptions.cardCost)}`} />
            <Legend
              background={`repeating-linear-gradient(135deg,${DS.ink} 0 2px,#fff 2px 5px)`}
              bordered
              label={`Grading ${money(assumptions.gradingFee)}`}
            />
            <Legend background="#DCDCD7" bordered label={`Marketplace ${money(feeAmount)}`} />
            <Legend background={DS.yellow} bold bordered label={`You keep ${signed(net)}`} />
          </div>
        </div>
      </FocalCard>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <div className="ct-enter" style={{ animationDelay: "0ms" }}>
        <StatCard label="PSA 10 NET PROFIT">
          <AnimatedNumber
            className="mt-1.5 block text-[30px] font-black tracking-[-0.03em]"
            format={(n) => signed(n)}
            style={{ color: net >= 0 ? DS.greenDeep : DS.red }}
            value={net}
          />
          <div className="mt-1 text-[11px] font-semibold" style={{ color: DS.meta }}>
            {targetSale > 0 ? `${Math.round((net / targetSale) * 100)}% of the sale price` : "no sale to measure"}
          </div>
        </StatCard>
        </div>

        <div className="ct-enter" style={{ animationDelay: "40ms" }}>
        <StatCard label="BREAK-EVEN SALE PRICE">
          <AnimatedNumber
            className="mt-1.5 block text-[30px] font-black tracking-[-0.03em]"
            format={(n) => money(n)}
            value={breakEven}
          />
          <div className="mt-1 text-[11px] font-semibold" style={{ color: DS.meta }}>
            Card + grading + selling fee
          </div>
        </StatCard>
        </div>

        <div className="ct-enter border-2 p-4" style={{ borderColor: DS.ink, animationDelay: "80ms" }}>
          <div
            className="flex items-center gap-[7px] text-[10px] font-black tracking-[0.1em]"
            style={{ color: DS.kicker }}
          >
            <span className="h-[9px] w-[9px] rounded-full" style={{ background: verdict.tone }} />
            {verdict.status}
          </div>
          <div className="mt-[7px] text-sm leading-[1.3] font-bold">{verdict.lead}</div>
          <div className="mt-1.5 text-[11px] font-semibold" style={{ color: DS.meta }}>
            Not an expected return — it needs the odds of the grade.
          </div>
        </div>
      </div>

      <NetOutcomeDiverging assumptions={assumptions} currency={currency} outcomes={outcomes} />

      <CaveatDisclosure
        aside={isReal ? "Asking prices · conditional on grade" : "Preview data"}
        onToggle={() => setOpen((v) => !v)}
        open={open}
        title="HOW THIS IS CALCULATED · 2"
      >
        <Caveat claim="Asks, not completed sales.">
          Revenue uses {market} asking prices; the grading fee and selling fee are your own assumptions rather than
          quotes.{fallbackNote ? ` ${fallbackNote}` : ""}
        </Caveat>
        <Caveat claim="Conditional on the grade.">
          Nothing here estimates the odds of getting PSA 10 — treat the return as the payoff if it lands, not as an
          expectation.
        </Caveat>
      </CaveatDisclosure>
    </section>
  );
}

function Seg({ width, background, bordered }: { width: number; background: string; bordered?: boolean }) {
  return (
    <div
      className={`flex-none ${bordered ? "border-l-2" : ""}`}
      style={{
        width: `${width}%`,
        background,
        borderColor: DS.ink,
        transition: "width 380ms cubic-bezier(.2,.8,.2,1)",
      }}
    />
  );
}

function Legend({
  background,
  label,
  bordered,
  bold,
}: {
  background: string;
  label: string;
  bordered?: boolean;
  bold?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] tabular-nums ${bold ? "font-black" : "font-bold"}`}
    >
      <span
        className="h-2.5 w-2.5"
        style={{ background, border: bordered ? `1px solid ${DS.ink}` : undefined }}
      />
      {label}
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  source,
  sourceNote,
  hint,
  last,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  source: string;
  sourceNote: string;
  hint: string;
  last?: boolean;
}) {
  return (
    <label className={`block min-w-0 px-3.5 pt-3.5 pb-3.5 ${last ? "" : "border-r"}`} style={{ borderColor: DS.hairline }}>
      <span className="block text-[10px] font-black tracking-[0.1em]" style={{ color: DS.kicker }}>
        {label}
      </span>
      <input
        aria-label={label}
        className="ct-input mt-1.5 block w-full border-2 px-2.5 py-1.5 text-[19px] font-black tracking-[-0.01em] tabular-nums"
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        style={{ borderColor: DS.ink, background: DS.surface, color: DS.ink, textOverflow: "ellipsis" }}
        type="text"
        value={value}
      />
      <HoverTip label={sourceNote}>
        <SourceTag>{source}</SourceTag>
      </HoverTip>
      <span className="mt-1.5 block text-[10.5px] leading-[1.45] font-semibold" style={{ color: DS.meta }}>
        {hint}
      </span>
    </label>
  );
}
