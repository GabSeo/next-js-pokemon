"use client";

import { useState } from "react";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import type { EbayCondition, EbayLanguage } from "@/lib/ebay-browse";
import { EBAY_LOGO_URL, VINTED_LOGO_URL } from "@/lib/marketplace-logos";

export type TypeSummary = {
  avgLabel: string;
  count: number;
  /** How many rows are actually shown — not always the same fixed number: a rare card can turn up fewer real listings after quality filtering (see lib/ebay-browse.ts's titleMatchesCard). */
  rowCount: number;
  isReal: boolean;
  seeAllHref: string;
  rows: React.ReactNode;
};

export type LanguageEntry = {
  language: EbayLanguage;
  active: TypeSummary;
  sold: TypeSummary;
};

export type ConditionEntry = {
  id: EbayCondition;
  label: string;
  languages: LanguageEntry[];
};

/** One "newly listed" feed row — see lib/graded-market.ts's VintedFeedRow. */
export type VintedFeedRowSummary = {
  timeAgo: string;
  description: string;
  priceLabel: string;
  dealPct: number;
  dealTier: "good" | "fair" | "high";
};

export type VintedSummary = {
  isReal: boolean;
  searchHref: string;
  title: string;
  avgLabel: string;
  belowAverageCount: number;
  totalCount: number;
  rows: VintedFeedRowSummary[];
};

const DEAL_TIER_COLORS: Record<VintedFeedRowSummary["dealTier"], { bg: string; text: string }> = {
  good: { bg: "#e9f8ee", text: "#1f9d55" },
  fair: { bg: "#f4f5f8", text: "#6b7280" },
  high: { bg: "#fbf1e3", text: "#a15c0c" },
};

function dealPctLabel(pct: number): string {
  if (pct === 0) return "±0%";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** A top-level market tab — the two real eBay-backed languages, plus France, which isn't eBay at all (see graded-market-tabs.tsx's file doc comment). */
export type MarketTab = EbayLanguage | "France";

const TYPES = ["active", "sold"] as const;
type ListingType = (typeof TYPES)[number];

/**
 * Top-level Market tabs (English / Japanese / France) select which
 * marketplace's data is shown. English and Japanese keep the original
 * structure underneath — Condition tabs (PSA 10/9/8/Raw), an active/sold
 * toggle, real eBay data — completely unchanged. France is a different
 * marketplace with a different shape: eBay.fr isn't where the French
 * Pokémon TCG market actually trades, so instead of a third eBay language
 * this renders Vinted's own condition tiers (Très bon état/Bon état/
 * Satisfaisant — Vinted's real vocabulary, not PSA grades) with no
 * active/sold split, since Vinted has neither grading nor a public "sold"
 * feed. Every branch is always in the DOM — only the `hidden` attribute
 * changes on click — so an AI crawler reading raw HTML sees every
 * combination regardless of what a human has selected, same pattern as
 * components/price-data-tabs.tsx.
 */
export function GradedMarketTabs({
  entries,
  vinted,
  defaultMarket,
}: {
  /** English/Japanese only — see lib/graded-market.ts's GRADED_MARKET_LANGUAGES. */
  entries: ConditionEntry[];
  vinted: VintedSummary;
  /** Lets a locale-specific product page (/products/[slug]/fr, /products/[slug]/ja) open straight to its own market instead of always defaulting to English. */
  defaultMarket?: MarketTab;
}) {
  // Every condition entry carries the same set of languages (see
  // lib/graded-market.ts), so entries[0]'s is representative of all of them.
  const marketTabs: MarketTab[] = [...entries[0].languages.map((l) => l.language), "France"];
  const [market, setMarket] = useState<MarketTab>(defaultMarket && marketTabs.includes(defaultMarket) ? defaultMarket : marketTabs[0]);

  const [conditionId, setConditionId] = useState<EbayCondition>(entries[0].id);
  const [type, setType] = useState<ListingType>("active");

  const currentCondition = entries.find((e) => e.id === conditionId)!;
  const currentLanguage =
    currentCondition.languages.find((l) => l.language === market) ?? currentCondition.languages[0];
  const selected = currentLanguage[type];

  return (
    <div>
      <div role="tablist" aria-label="Market" className="flex flex-wrap gap-2">
        {entries[0].languages.map((l) => (
          <button
            key={l.language}
            type="button"
            role="tab"
            aria-selected={market === l.language}
            onClick={() => setMarket(l.language)}
            className={`rounded-full border-2 px-3 py-1 text-xs font-black tracking-[0.3px] uppercase transition-colors ${
              market === l.language
                ? "border-black bg-pokemon-blue text-white"
                : "border-border-subtle bg-muted-surface text-muted-text hover:border-black hover:text-foreground"
            }`}
          >
            {l.language}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={market === "France"}
          onClick={() => setMarket("France")}
          className={`rounded-full border-2 px-3 py-1 text-xs font-black tracking-[0.3px] uppercase transition-colors ${
            market === "France"
              ? "border-black bg-pokemon-blue text-white"
              : "border-border-subtle bg-muted-surface text-muted-text hover:border-black hover:text-foreground"
          }`}
        >
          France (Vinted)
        </button>
      </div>

      <div hidden={market === "France"}>
        <div role="tablist" aria-label="Condition" className="mt-4 flex flex-wrap gap-7 border-b-2 border-border-subtle">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={conditionId === entry.id}
              onClick={() => setConditionId(entry.id)}
              className={`-mb-0.5 border-b-[3px] pb-2.5 text-sm font-black tracking-[0.3px] uppercase transition-colors ${
                conditionId === entry.id
                  ? "border-pokemon-red text-foreground"
                  : "border-transparent text-[#9a9a9a] hover:text-foreground"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="my-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TYPES.map((t) => {
            const summary = currentLanguage[t];
            const isSelected = type === t;
            const borderClass = isSelected ? (t === "active" ? "border-pokemon-red" : "border-pokemon-blue") : "border-border-subtle";
            const labelClass = isSelected ? (t === "active" ? "text-pokemon-red" : "text-pokemon-blue") : "text-muted-text";
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`rounded-md border-2 p-4 text-left transition-[transform,border-color,background-color] duration-150 hover:-translate-y-0.5 ${borderClass} ${
                  isSelected ? "bg-card-surface" : "bg-muted-surface"
                }`}
              >
                <div className={`mb-1.5 flex items-center gap-2 text-[11px] font-black tracking-[0.5px] uppercase ${labelClass}`}>
                  {t === "active" ? (
                    <span className={`h-1.5 w-1.5 rounded-full ${summary.isReal ? "bg-success-green" : "bg-[#9a9a9a]"}`} />
                  ) : (
                    <span>✓</span>
                  )}
                  {t === "active" ? "Active" : "Sold"}
                  <span className="font-bold text-[#9a9a9a] normal-case">({summary.count})</span>
                </div>
                <div className={`text-2xl font-black tracking-[-0.6px] tabular-nums ${isSelected ? "text-foreground" : "text-[#9a9a9a]"}`}>
                  {summary.avgLabel}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[11px] font-black tracking-[0.5px] text-muted-text uppercase">
            {type === "active" ? "Active listings" : "Sold listings"} · {market}
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-[10px] font-bold text-muted-text uppercase">
              via
              {/* eslint-disable-next-line @next/next/no-img-element -- external CDN image, domain not allowlisted for next/image */}
              <img src={EBAY_LOGO_URL} alt="eBay" className="h-[13px] w-auto opacity-70 grayscale" />
            </span>
            <span className="text-[11px] font-black tracking-[0.5px] text-muted-text uppercase">
              {selected.rowCount === 1 ? "1 listing" : `last ${selected.rowCount}`}
            </span>
          </span>
        </div>

        <div className="min-h-[140px]">
          {entries.map((entry) =>
            entry.languages.map((l) =>
              TYPES.map((t) => (
                <div key={`${entry.id}-${l.language}-${t}`} hidden={!(conditionId === entry.id && market === l.language && type === t)}>
                  {l[t].rows}
                </div>
              ))
            )
          )}
        </div>

        <a
          href={selected.seeAllHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-sm font-black text-pokemon-red underline underline-offset-2 hover:text-foreground"
        >
          See all {selected.count} {type} listings ↗
        </a>

        {!selected.isReal && (
          <div className="mt-3">
            <IllustrativeTag label={type === "active" ? "Preview — eBay not connected yet" : "Illustrative — not connected"} />
          </div>
        )}
      </div>

      <div hidden={market !== "France"}>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-black tracking-[0.2px]">Just listed — {vinted.title}</span>
          {/* Not "Live": every number here is illustrative (no real Vinted
              source yet) — a pulsing "Live" badge on fabricated data would
              contradict every other real/illustrative signal on this site.
              Same slot, honest label instead. */}
          <span className="flex items-center gap-1.5 rounded-full bg-muted-surface px-2.5 py-1 text-[11px] font-black tracking-[0.3px] text-muted-text uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-[#9a9a9a]" />
            Preview
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-black bg-muted-surface p-4">
          <div>
            <div className="mb-1.5 text-[11px] font-black tracking-[0.5px] text-muted-text uppercase">
              Avg · last {vinted.rows.length} new listings
            </div>
            <div className="text-3xl font-black tracking-[-0.6px] tabular-nums">
              {vinted.avgLabel}
            </div>
          </div>
          <div className="text-right text-[11px] font-bold text-muted-text uppercase">estimate, not real-time</div>
        </div>

        <div className="mt-5 mb-1 flex items-center justify-between gap-3">
          <span className="text-[11px] font-black tracking-[0.5px] text-muted-text uppercase">Newly listed</span>
          <span className="flex items-center gap-1 text-[10px] font-bold text-muted-text uppercase">
            via
            {/* eslint-disable-next-line @next/next/no-img-element -- external CDN image, domain not allowlisted for next/image */}
            <img src={VINTED_LOGO_URL} alt="Vinted" className="h-[13px] w-auto opacity-70 grayscale" />
          </span>
        </div>

        <div>
          {vinted.rows.map((row, i) => {
            const colors = DEAL_TIER_COLORS[row.dealTier];
            return (
              <div
                key={i}
                className="grid grid-cols-[52px_1fr_auto_auto] items-center gap-3 border-t border-dashed border-border-subtle py-3 text-sm first:border-t-0"
              >
                <span className="text-xs font-bold text-muted-text">{row.timeAgo}</span>
                <span className="truncate font-bold">{row.description}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums"
                  style={{ backgroundColor: colors.bg, color: colors.text }}
                >
                  {dealPctLabel(row.dealPct)}
                </span>
                <span className="font-black tabular-nums">{row.priceLabel}</span>
              </div>
            );
          })}
        </div>

        <a
          href={vinted.searchHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-sm font-black text-pokemon-red underline underline-offset-2 hover:text-foreground"
        >
          Search on Vinted ↗
        </a>

        <div className="mt-5 rounded-md border-2 border-black bg-muted-surface p-4">
          <div className="mb-2 text-[11px] font-black tracking-[0.5px] text-muted-text uppercase">Deal density · last {vinted.totalCount} listings</div>
          <div className="mb-2.5 h-2 overflow-hidden rounded-full border border-black bg-white">
            <span
              className="block h-full bg-success-green"
              style={{ width: `${Math.round((vinted.belowAverageCount / vinted.totalCount) * 100)}%` }}
            />
          </div>
          <p className="text-xs font-bold text-muted-text">
            <span className="text-foreground">
              {vinted.belowAverageCount} of {vinted.totalCount}
            </span>{" "}
            listings priced below the rolling average.
          </p>
        </div>

        <div className="mt-3">
          <IllustrativeTag label="Preview — Vinted not connected yet" />
        </div>
      </div>
    </div>
  );
}
