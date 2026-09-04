"use client";

import { useState } from "react";

import type { GradeTableRow } from "@/components/retro/grade-rows";
import {
  Caveat,
  CaveatDisclosure,
  ChartCard,
  DS,
  FlagMark,
  FocalCard,
  FocalNumber,
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
}: {
  rows: GradeTableRow[];
  currency: string;
  isReal: boolean;
}) {
  const [open, setOpen] = useState(false);
  const find = (label: string) => rows.find((r) => r.label.toLowerCase() === label.toLowerCase());
  const raw = find("Raw");
  const psa10 = find("PSA 10");
  const psa9 = find("PSA 9");

  const money = (n: number) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;
  const graded = rows.filter((r) => !/raw/i.test(r.label));
  const totalListings = graded.reduce((s, r) => s + (r.english?.count ?? 0) + (r.japanese?.count ?? 0), 0);

  // The headline: how many times a PSA 10 asks over a raw copy, same market.
  const premium =
    raw?.english?.median && psa10?.english?.median && raw.english.median > 0
      ? psa10.english.median / raw.english.median
      : null;

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

      <FocalCard>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black tracking-[0.12em]">
          <FlagMark market="english" />
          <span>PSA 10 PREMIUM · ENGLISH · CHEAPEST LIVE ASKS</span>
          <span className="min-w-2 flex-1" />
          <span className="inline-flex items-center gap-2">
            {/* ASSET SLOT — Pokémon sprite, 38px, card identity only. */}
            <span
              aria-hidden
              className="h-[38px] w-[38px] flex-none border-2 border-dashed"
              style={{ borderColor: DS.ink }}
              title="Asset slot — sprite, 38px"
            />
            <span
              className="text-[8.5px] leading-[1.35] font-bold tracking-[0.1em]"
              style={{ color: DS.meta }}
            >
              ASSET SLOT
              <br />
              SPRITE 38px
            </span>
          </span>
        </div>

        <FocalNumber
          arithmetic={
            premium != null && raw?.english && psa10?.english ? (
              <>
                {money(raw.english.median)} raw &nbsp;→&nbsp; {money(psa10.english.median)} at PSA 10
              </>
            ) : (
              "No priced raw and PSA 10 pair in English today"
            )
          }
          lead={premium != null ? "what the same card asks raw" : "not enough listings to price the premium"}
          value={premium != null ? `${premium >= 10 ? premium.toFixed(0) : premium.toFixed(1)}×` : "—"}
        />
      </FocalCard>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {/* ~40ms apart so the row reads left to right on arrival rather than
            appearing as one block. Once, on mount — see globals.css. */}
        <div className="ct-enter" style={{ animationDelay: "0ms" }}>
        <StatCard label="JAPANESE PSA 10">
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[30px] font-black tracking-[-0.03em] tabular-nums">
              {psa10?.japanese ? money(psa10.japanese.median) : "—"}
            </span>
            {psa10?.japanese && (
              <span className="text-[11px] font-semibold tabular-nums" style={{ color: DS.meta }}>
                {psa10.japanese.count} listings
              </span>
            )}
          </div>
          <div className="mt-1 text-xs font-bold" style={{ color: DS.text2 }}>
            {psa10?.japanese && psa10.english
              ? psa10.japanese.median < psa10.english.median
                ? `${Math.round((1 - psa10.japanese.median / psa10.english.median) * 100)}% under English`
                : `${Math.round((psa10.japanese.median / psa10.english.median - 1) * 100)}% over English`
              : "No Japanese listings at PSA 10"}
          </div>
        </StatCard>
        </div>

        <div className="ct-enter" style={{ animationDelay: "40ms" }}>
        <StatCard label="PSA 9 CROSSOVER">
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[30px] font-black tracking-[-0.03em] tabular-nums">
              {psa9?.english && psa9.japanese
                ? `${(Math.max(psa9.english.median, psa9.japanese.median) / Math.min(psa9.english.median, psa9.japanese.median)).toFixed(1)}×`
                : "—"}
            </span>
            {psa9?.english && psa9.japanese && (
              <span className="text-[11px] font-semibold tabular-nums" style={{ color: DS.meta }}>
                {psa9.english.count} vs {psa9.japanese.count} listings
              </span>
            )}
          </div>
          <div className="mt-1 text-xs font-bold" style={{ color: DS.text2 }}>
            {psa9?.english && psa9.japanese
              ? psa9.japanese.median > psa9.english.median
                ? `Japanese asks more — ${money(psa9.japanese.median)} vs ${Math.round(psa9.english.median).toLocaleString("en-US")}`
                : `English asks more — ${money(psa9.english.median)} vs ${Math.round(psa9.japanese.median).toLocaleString("en-US")}`
              : "Only one market has PSA 9 listings"}
          </div>
        </StatCard>
        </div>

        <div className="ct-enter" style={{ animationDelay: "80ms" }}>
        <StatCard label="GRADED LISTINGS BEHIND THESE MEDIANS">
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[30px] font-black tracking-[-0.03em] tabular-nums">{totalListings}</span>
            <span className="text-[11px] font-semibold" style={{ color: DS.meta }}>
              total
            </span>
          </div>
          <div className="mt-1 text-[11px] font-semibold tabular-nums" style={{ color: DS.meta }}>
            {graded
              .map((r) => `${r.label} · ${(r.english?.count ?? 0) + (r.japanese?.count ?? 0)}`)
              .join("  |  ")}
          </div>
        </StatCard>
        </div>
      </div>

      <GradeLadder currency={currency} rows={rows} />

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

  const gap = (r: GradeTableRow) => {
    if (!r.english || !r.japanese) return { text: r.english ? "no JP listings" : "no EN listings", dim: true };
    const en = r.english.median;
    const jp = r.japanese.median;
    if (jp < en) return { text: `JP ${Math.round((1 - jp / en) * 100)}% cheaper`, dim: false };
    if (en < jp) return { text: `EN ${Math.round((1 - en / jp) * 100)}% cheaper`, dim: false };
    return { text: "price parity", dim: false };
  };

  return (
    <ChartCard>
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

      <div
        className="mt-[9px] grid items-start gap-2"
        style={{ gridTemplateColumns: `repeat(${rows.length}, 1fr)` }}
      >
        {rows.map((r) => {
          const g = gap(r);
          return (
            <div className="text-center" key={r.label}>
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
              <div
                className="mt-1 text-[10px] font-bold"
                style={{ color: g.dim ? DS.disabled : DS.meta }}
              >
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
    </ChartCard>
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
