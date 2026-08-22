"use client";

import { useState } from "react";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import type { EbayCondition } from "@/lib/ebay-browse";

export type TypeSummary = {
  avgLabel: string;
  count: number;
  isReal: boolean;
  seeAllHref: string;
  rows: React.ReactNode;
};

export type ConditionEntry = {
  id: EbayCondition;
  label: string;
  active: TypeSummary;
  sold: TypeSummary;
};

const TYPES = ["active", "sold"] as const;
type ListingType = (typeof TYPES)[number];

/**
 * Condition tabs (PSA 10/9/8/Raw) plus an active/sold toggle underneath —
 * one control switching which single row-list shows, not two permanent
 * columns competing for space. All 4 conditions × 2 types (8 row-sets) are
 * passed in already server-rendered and stay in the DOM at all times; only
 * the `hidden` attribute changes on click, so an AI crawler reading raw
 * HTML sees every combination regardless of which tab/type a human has
 * selected — same pattern as components/price-data-tabs.tsx.
 */
export function GradedMarketTabs({ entries }: { entries: ConditionEntry[] }) {
  const [conditionId, setConditionId] = useState<EbayCondition>(entries[0].id);
  const [type, setType] = useState<ListingType>("active");

  const current = entries.find((e) => e.id === conditionId)!;
  const selected = current[type];

  return (
    <div>
      <div role="tablist" aria-label="Condition" className="flex flex-wrap gap-7 border-b-2 border-border-subtle">
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

      <div className="my-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TYPES.map((t) => {
          const summary = current[t];
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

      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-black tracking-[0.5px] text-muted-text uppercase">
          {type === "active" ? "Active listings" : "Sold listings"}
        </span>
        <span className="text-[11px] font-black tracking-[0.5px] text-muted-text uppercase">last 3</span>
      </div>

      <div className="min-h-[140px]">
        {entries.map((entry) =>
          TYPES.map((t) => (
            <div key={`${entry.id}-${t}`} hidden={!(conditionId === entry.id && type === t)}>
              {entry[t].rows}
            </div>
          ))
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
  );
}
