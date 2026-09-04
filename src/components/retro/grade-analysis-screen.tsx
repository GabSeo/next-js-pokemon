"use client";

import { useId, useState } from "react";

import type { GradeTableRow } from "@/components/retro/grade-rows";
import { GradeHeroCard } from "@/components/retro/grade-hero-card";
import { MarketDataBadge } from "@/components/retro/market-data-badge";
import {
  Caveat,
  CardTag,
  CaveatDisclosure,
  DS,
  FlagMark,
  HoverTip,
  ScreenHeader,
  SlabChip,
  StatCard,
} from "@/components/retro/grading-ds";

/**
 * 01 Grade Analysis — what the grades are worth, and how the two markets
 * differ on them.
 *
 * ONE FOCAL NUMBER. The PSA 10 premium over raw is the number this screen
 * exists to deliver, so it is three to four times the size of anything else
 * and everything below it is support. The previous version gave the premium,
 * the Japanese median and the listing count the same weight, which left a
 * reader to work out which one was the point.
 *
 * Every figure is derived from the live rows — nothing here is a constant.
 */
export function GradeAnalysisScreen({
  rows,
  currency,
  isReal,
  market,
}: {
  rows: GradeTableRow[];
  currency: string;
  isReal: boolean;
  /**
   * Which market the FOCAL figure prices.
   *
   * The ladder and the comparison cards below always show both markets side
   * by side — that is their whole job — but the premium at the top is one
   * market's number, and it used to be English no matter what the page's
   * filter said. Switching to JA changed every other block on the page and
   * left this one quoting English under a heading that said so, which is the
   * failure the market filter exists to prevent.
   */
  market: "English" | "Japanese";
}) {
  const [open, setOpen] = useState(false);
  /**
   * The evidence starts folded away.
   *
   * The focal card answers the question on its own — "PSA 10 asks 18x a raw
   * copy" — and the three comparison cards plus the ladder are how that
   * answer was reached. Most readers want the answer; the ones who doubt it
   * want the workings, and they are the ones who will click. Showing all of
   * it by default made a reader scroll past four blocks of evidence to reach
   * the verdict, which is the question they actually came with.
   */
  const [expanded, setExpanded] = useState(false);
  const distributionId = useId();
  const find = (label: string) => rows.find((r) => r.label.toLowerCase() === label.toLowerCase());
  const raw = find("Raw");
  const psa10 = find("PSA 10");
  const psa9 = find("PSA 9");

  const money = (n: number) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;
  const graded = rows.filter((r) => !/raw/i.test(r.label));
  const totalListings = graded.reduce((s, r) => s + (r.english?.count ?? 0) + (r.japanese?.count ?? 0), 0);

  // The headline: how many times a PSA 10 asks over a raw copy, IN THE
  // SELECTED MARKET. Same market on both sides of the ratio — a Japanese PSA
  // 10 over an English raw would be a currency-clean but meaningless number.
  const side = market === "Japanese" ? "japanese" : "english";
  const focalRaw = raw?.[side];
  const focalPsa10 = psa10?.[side];
  const premium =
    focalRaw?.median && focalPsa10?.median && focalRaw.median > 0 ? focalPsa10.median / focalRaw.median : null;

  const evidence = !isReal ? "preview" : totalListings >= 40 ? "high" : totalListings >= 12 ? "medium" : "low";

  return (
    <section className="flex flex-col gap-3.5">
      <ScreenHeader
        right={
          <>
            <span
              className="inline-flex items-center gap-1.5 border-2 px-2 py-0.5 text-[10px] font-black tracking-[0.1em] uppercase"
              style={{
                borderColor: DS.ink,
                background: evidence === "high" ? DS.green : evidence === "medium" ? DS.yellow : DS.red,
                color: evidence === "medium" ? DS.ink : "#fff",
              }}
            >
              Evidence {evidence}
            </span>
            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.1em]"
              style={{ color: DS.kicker }}
            >
              {/* ASSET SLOT — Pokéball status marker, 16px. Left empty until licensed art exists. */}
              <span
                aria-hidden
                className="h-4 w-4 flex-none rounded-full border-2 border-dashed"
                style={{ borderColor: DS.ink }}
                title="Asset slot — Pokéball status marker, 16px"
              />
              LIVE
            </span>
          </>
        }
        step="01"
        title="GRADE ANALYSIS"
        tone="red"
      />

      <GradeHeroCard
        caption="cheapest live listing in each condition"
        distributionId={distributionId}
        expanded={expanded}
        footnote="↗ photos + asks from the matching live eBay listings"
        gap={
          focalRaw && focalPsa10
            ? `${focalPsa10.median >= focalRaw.median ? "+" : "−"}${Math.abs(
                Math.round(focalPsa10.median - focalRaw.median),
              ).toLocaleString("en-US")}`
            : null
        }
        lead={premium != null ? "what this card sells for graded, vs raw" : "not enough listings to price the premium"}
        market={market}
        multiple={premium != null ? `${premium >= 10 ? premium.toFixed(0) : premium.toFixed(1)}×` : "—"}
        onToggle={() => setExpanded((v) => !v)}
        psa10={{
          price: focalPsa10 ? money(focalPsa10.median) : "—",
          listings: focalPsa10 ? `${focalPsa10.count.toLocaleString("en-US")} listings` : "no listings",
          imageUrl: focalPsa10?.imageUrl,
          href: focalPsa10?.url,
        }}
        raw={{
          price: focalRaw ? money(focalRaw.median) : "—",
          listings: focalRaw ? `${focalRaw.count.toLocaleString("en-US")} listings` : "no listings",
          imageUrl: focalRaw?.imageUrl,
          href: focalRaw?.url,
        }}
      >
        {expanded && (
          <div
            // gap-9 between the two blocks inside, not gap-4. The comparison
            // cards and the ladder are two distinct readings — three summary
            // figures, then the distribution they came from — and at 16px they
            // ran together as one long strip of chart furniture. The gap
            // between them is now wider than the gap BETWEEN the cards (16px),
            // which is what makes them read as two groups rather than four
            // things in a column.
            // px-6 to match the card header's own gutter, pb-6 so the ladder's
            // footnote does not sit on the card's bottom border. Without them the
            // revealed content ran flush into the 2px frame on both sides.
            className="mt-6 flex flex-col gap-9 px-6 pt-6 pb-6"
            id={distributionId}
            style={{ borderTop: `1px solid ${DS.hairline}` }}
          >
            {/* 220px rather than 200: the cards now carry 24px of side padding, and
                at a 200px track that left ~150px for a price and a listing count on
                one line. Raising the floor makes them stack one step earlier and
                keeps the row legible instead of merely fitting. gap-4 to match the
                roomier cards. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
              {/* ~40ms apart so the row reads left to right on arrival rather than
                  appearing as one block. Once, on mount — see globals.css. */}
              <div className="ct-enter" style={{ animationDelay: "0ms" }}>
                <ComparisonCard currency={currency} grade="PSA 10" row={psa10} />
              </div>

              <div className="ct-enter" style={{ animationDelay: "40ms" }}>
                <ComparisonCard currency={currency} grade="PSA 9" row={psa9} />
              </div>

              <div className="ct-enter" style={{ animationDelay: "80ms" }}>
                <StatCard sub="Total listings by grade" tag={<MarketDataBadge isReal={isReal} />}>
                  <div className="mt-4 mb-4 flex flex-col gap-2.5">
                    {graded.map((r) => (
                      <DetailRow
                        key={r.label}
                        name={r.label}
                        value={`${(r.english?.count ?? 0) + (r.japanese?.count ?? 0)}`}
                      />
                    ))}
                  </div>
                  <Kpi clause="graded listings tracked on eBay" figure={String(totalListings)} />
                </StatCard>
              </div>
            </div>

            <GradeLadder currency={currency} rows={rows} />
          </div>
        )}
      </GradeHeroCard>

      <CaveatDisclosure
        aside={`Evidence quality: ${evidence}`}
        onToggle={() => setOpen((v) => !v)}
        open={open}
        title="METHOD &amp; CAVEATS · 3"
      >
        <Caveat claim="Asking prices, not completed sales.">
          Sellers set asks; what a card actually fetched would be firmer evidence.
        </Caveat>
        <Caveat claim="No grade probability.">
          The card&apos;s condition is not assessed, so any return is conditional on the grade, not expected.
        </Caveat>
        <Caveat claim="One currency, one marketplace.">
          Both sides are USD asks on eBay — a premium, never a conversion.
        </Caveat>
      </CaveatDisclosure>
    </section>
  );
}

/**
 * The grade ladder: vertical paired bars on a log scale.
 *
 * The log is what keeps the ladder's SHAPE readable. Linear, a PSA 10 asking
 * 18x a raw copy takes the full height and the three grades below it are
 * indistinguishable stubs — the chart then only says "PSA 10 is worth more",
 * which the focal number above already said in larger type. Log spends the
 * height on the steps between grades, which is the part that is actually in
 * question.
 *
 * The mapping puts the cheapest bar at 15% and the dearest at 96% of the plot
 * and interpolates the rest by log10 — derived from the reference, and
 * dynamic rather than fixed, so a card whose grades sit close together still
 * fills the plot instead of huddling at the bottom.
 */
function GradeLadder({ rows, currency }: { rows: GradeTableRow[]; currency: string }) {
  const values = rows.flatMap((r) => [r.english?.median, r.japanese?.median]).filter((v): v is number => !!v && v > 0);
  if (values.length === 0) return null;

  const lo = Math.log10(Math.min(...values));
  const hi = Math.log10(Math.max(...values));
  const MIN_H = 15;
  const MAX_H = 96;
  const height = (v: number | undefined) => {
    if (!v || v <= 0) return null;
    if (hi === lo) return MAX_H;
    return MIN_H + ((Math.log10(v) - lo) / (hi - lo)) * (MAX_H - MIN_H);
  };

  /**
   * How far apart the two markets are on this grade.
   *
   * Expressed as a percentage while that reads sensibly, and as a MULTIPLE
   * once it does not. "100% cheaper" means free, which is never what the data
   * says — it is what `Math.round` does to a 99.5% gap, and it appeared on a
   * real card the moment a Japanese PSA 8 came in far under the English one.
   * Past a 10x spread the multiple is both true and more informative.
   */
  const gap = (r: GradeTableRow) => {
    if (!r.english || !r.japanese)
      return {
        text: r.english ? "no JP listings" : "no EN listings",
        dim: true,
      };
    const en = r.english.median;
    const jp = r.japanese.median;
    if (en <= 0 || jp <= 0) return { text: "no comparison", dim: true };
    const [cheapLabel, ratio] = jp < en ? ["JP", en / jp] : ["EN", jp / en];
    if (ratio < 1.005) return { text: "price parity", dim: false };
    if (ratio >= 10)
      return {
        text: `${cheapLabel} ${Math.round(ratio)}× cheaper`,
        dim: false,
      };
    const pct = Math.round((1 - 1 / ratio) * 100);
    return { text: `${cheapLabel} ${Math.min(pct, 99)}% cheaper`, dim: false };
  };

  return (
    // No ChartCard around it any more. The ladder now renders inside the
    // focal card's own expansion, and a 2px-bordered, hard-shadowed box
    // nested inside another one read as a card stuck inside a card rather
    // than as this card's own chart. The container above it is the frame.
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="text-xs font-black tracking-[0.1em]">GRADE LADDER · MEDIAN ASK BY GRADE</div>
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-black tracking-[0.08em]">
            <FlagMark market="english" />
            ENGLISH
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-black tracking-[0.08em]">
            <FlagMark market="japanese" />
            JAPANESE
          </span>
          <span
            className="border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.1em]"
            style={{ borderColor: DS.rule, color: DS.kicker }}
          >
            LOG SCALE
          </span>
        </div>
      </div>

      <div className="relative mt-12 h-[216px]">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {[0, 33, 66].map((t) => (
            <div
              className="absolute right-0 left-0 border-t border-dashed"
              key={t}
              style={{ top: `${t}%`, borderColor: "#D8D8D3" }}
            />
          ))}
        </div>
        <div
          className="relative grid h-full items-end gap-2"
          style={{ gridTemplateColumns: `repeat(${rows.length}, 1fr)` }}
        >
          {rows.map((r, i) => (
            <div
              className="ct-bar-enter flex h-full items-end justify-center gap-[5px]"
              key={r.label}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <LadderBar
                color={DS.blue}
                count={r.english?.count}
                currency={currency}
                heightPct={height(r.english?.median)}
                market="English"
                tier={r.label}
                value={r.english?.median}
              />
              <LadderBar
                color={DS.red}
                count={r.japanese?.count}
                currency={currency}
                heightPct={height(r.japanese?.median)}
                market="Japanese"
                tier={r.label}
                value={r.japanese?.median}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="h-0.5" style={{ background: DS.ink }} />

      <div className="mt-[9px] grid items-start gap-2" style={{ gridTemplateColumns: `repeat(${rows.length}, 1fr)` }}>
        {rows.map((r) => {
          const g = gap(r);
          return (
            // A flex COLUMN, not a text-align:center block. The chips are
            // inline-flex boxes, and an inline-flex baseline depends on its
            // own contents — RAW's single centred line and the PSA chips'
            // two-row stack produce different baselines, so the whole cell
            // (chip and caption together) sat a few pixels higher under RAW
            // than under the grades beside it. As flex items there is no
            // baseline to disagree about.
            <div className="flex flex-col items-center text-center" key={r.label}>
              <HoverTip
                align="center"
                label={
                  <>
                    <b style={{ color: DS.ink }}>{r.label}</b>
                    <br />
                    English:{" "}
                    {r.english
                      ? `${currency} ${Math.round(r.english.median).toLocaleString("en-US")} · ${r.english.count} listings`
                      : "no listings"}
                    <br />
                    Japanese:{" "}
                    {r.japanese
                      ? `${currency} ${Math.round(r.japanese.median).toLocaleString("en-US")} · ${r.japanese.count} listings`
                      : "no listings"}
                  </>
                }
              >
                <SlabChip grade={r.label} />
              </HoverTip>
              <div className="mt-1 text-[10px] font-bold" style={{ color: g.dim ? DS.disabled : DS.meta }}>
                {g.text}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3.5 text-[11px] font-semibold" style={{ color: DS.meta }}>
        Median asking price in {currency}, both markets on eBay. Log scale so every grade stays readable next to PSA 10.
        Grey figures under each price are the number of listings behind that median.
      </div>
    </div>
  );
}

/** One bar, with its price above and the depth behind that price under it. */
function LadderBar({
  value,
  count,
  heightPct,
  color,
  tier,
  market,
  currency,
}: {
  value: number | undefined;
  count: number | undefined;
  heightPct: number | null;
  color: string;
  tier: string;
  market: string;
  currency: string;
}) {
  // No bar at all when the market has nothing listed. A stub would read as a
  // very cheap copy and a zero-height bar as a rendering fault.
  if (heightPct == null || !value) {
    return (
      <div className="flex flex-1 items-end justify-center" style={{ maxWidth: 44 }}>
        <span className="pb-1 text-[9px] leading-tight font-bold" style={{ color: DS.disabled }}>
          NO
          <br />
          LISTINGS
        </span>
      </div>
    );
  }
  return (
    <div
      className="relative flex-1 border-2"
      style={{
        maxWidth: 44,
        height: `${heightPct}%`,
        background: color,
        borderColor: DS.ink,
        borderBottom: "none",
      }}
      title={`${tier} · ${market} · ${currency} ${Math.round(value).toLocaleString("en-US")}${count ? ` · ${count} listings` : ""}`}
    >
      <span className="absolute right-[-6px] bottom-full left-[-6px] pb-[5px] text-center text-xs font-black tabular-nums">
        {Math.round(value).toLocaleString("en-US")}
        {count != null && (
          <span
            className="mt-px block text-[10.5px] font-semibold"
            style={{ color: DS.metaSoft, background: DS.surface }}
          >
            {count}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The two markets on one grade, with the CONCLUSION as the focal element.
 *
 * The card used to lead on a raw median — "USD 288", 30px — and bury the
 * comparison underneath it in small text. But the median is not what this
 * card is for: it is already in the ladder below, twice, with its own axis.
 * What only this card says is which market is dearer and by how much, so
 * that is the figure at 26px and the medians are demoted to the two rows
 * that support it.
 */
function ComparisonCard({ row, grade, currency }: { row: GradeTableRow | undefined; grade: string; currency: string }) {
  const en = row?.english;
  const jp = row?.japanese;
  const money = (n: number) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;
  const price = (cell: GradeTableRow["english"] | undefined) =>
    cell && cell.median > 0 ? money(cell.median) : "no listings";
  const listings = (cell: GradeTableRow["english"] | undefined) =>
    cell && cell.median > 0 ? `${cell.count} listings` : undefined;

  /**
   * Percent while that reads naturally, a multiple once it does not. "190%
   * more expensive" is arithmetic a reader has to unpack; "2.9× higher" is
   * the same fact already unpacked. The cut is at 2x, where the two phrasings
   * cross over in legibility.
   */
  const kpi = (() => {
    if (!en || !jp || en.median <= 0 || jp.median <= 0) {
      return {
        figure: "—",
        clause: en || jp ? "only one market has listings" : "no listings either side",
      };
    }
    const dearerIsJp = jp.median > en.median;
    const ratio = dearerIsJp ? jp.median / en.median : en.median / jp.median;
    const dearer = dearerIsJp ? "Japanese" : "English";
    if (ratio < 1.005) return { figure: "1.0×", clause: "price parity" };
    if (ratio >= 2)
      return {
        figure: `${ratio.toFixed(1)}×`,
        clause: `${dearer} asks are higher`,
      };
    return {
      figure: `${Math.round((ratio - 1) * 100)}%`,
      clause: `${dearer} is more expensive`,
    };
  })();

  return (
    <StatCard sub="Japanese vs English" tag={<CardTag>{grade}</CardTag>}>
      <div className="mt-4 mb-4 flex flex-col gap-2.5">
        <DetailRow name="Japanese" note={listings(jp)} value={price(jp)} />
        <DetailRow name="English" note={listings(en)} value={price(en)} />
      </div>
      <Kpi clause={kpi.clause} figure={kpi.figure} />
    </StatCard>
  );
}

/**
 * One supporting fact, on a two-column grid every card shares.
 *
 * The right-hand cell holds the price and the listing count as separate
 * spans on ONE baseline: different sizes and colours so the eye can tell the
 * money from the sample size, but sitting on the same line so the column
 * still scans downward as a column. Concatenating them into a single string
 * — "USD 1,238 · 38 listings" — read as one long value and made the widest
 * card in the row.
 */
function DetailRow({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4">
      <span className="truncate text-[12px] font-medium" style={{ color: DS.text2 }}>
        {name}
      </span>
      <span className="flex items-baseline gap-2 tabular-nums">
        <span className="text-[13px] font-medium" style={{ color: DS.ink }}>
          {value}
        </span>
        {note && (
          <span className="text-[11px] font-medium" style={{ color: DS.meta }}>
            {note}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The line the eye is meant to land on.
 *
 * `mt-auto` is doing real work: StatCard is a flex column filling its grid
 * cell, so pushing this block to the bottom lands every card's conclusion on
 * the same line however many supporting rows sit above it. The slack between
 * cards is absorbed above the rule rather than between the rule and the
 * figure, so the divider keeps the same clearance on both sides in every
 * card.
 *
 * items-center, not items-baseline: a 28px figure and a 12px clause sitting
 * on a shared baseline leaves the clause hanging off the bottom of the
 * number. Centred, they read as one unit — which is what they are.
 */
function Kpi({ figure, clause }: { figure: string; clause: string }) {
  return (
    // min-h so the block is the same height whether its clause runs to one
    // line or two — otherwise the rule above it lands at a different height
    // in each card, which is the misalignment this whole row keeps being
    // caught by.
    <div
      className="mt-auto flex min-h-[34px] items-center gap-3 pt-4"
      style={{ borderTop: `1px solid ${DS.hairline}` }}
    >
      <span className="text-[28px] leading-none font-black tracking-[-0.03em] tabular-nums">{figure}</span>
      {/* Two lines reserved, and centred inside them. "English is more
          expensive" runs to two lines where "total listings" runs to one, and
          without the reservation that difference moved the rule above by 4px
          from one card to the next. Centring keeps a one-line clause level
          with the figure instead of sitting at the top of its reserved box. */}
      <span
        className="flex min-h-[2lh] items-center text-[12px] leading-[1.35] font-medium text-pretty"
        style={{ color: DS.text2 }}
      >
        {clause}
      </span>
    </div>
  );
}
