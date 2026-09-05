"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { SORTS, type Facet, type SortId } from "@/lib/catalog-query";

/**
 * The catalogue's search box, horizontal sort bar and vertical facet panel.
 *
 * EVERY CONTROL WRITES THE URL, and the server does the filtering. Three
 * reasons, in order of how much they matter here:
 *
 * 1. 23,546 cards cannot be shipped to the browser to filter client-side. The
 *    existing CardGridFilter can hide and reorder in the DOM because it works
 *    on a handful of tracked cards; that approach does not survive two more
 *    orders of magnitude.
 * 2. A filtered view is a thing people send each other. `?serie=XY&rarity=Rare`
 *    is a link; component state is not.
 * 3. Sorting by price needs prices the browser does not have — only the server
 *    can decide whether that sort is even affordable (see PRICE_SORT_MAX).
 *
 * Navigation runs inside a transition so the current results stay on screen,
 * dimmed, while the next page renders — rather than blanking on every click.
 */

type Props = {
  facets: { serie: Facet[]; rarity: Facet[]; category: Facet[]; variant: Facet[] };
  total: number;
  priceSortRefused?: string;
};

const FACET_GROUPS = [
  { key: "category", label: "Card type", limit: 5 },
  { key: "serie", label: "Series", limit: 8 },
  { key: "rarity", label: "Rarity", limit: 10 },
  { key: "variant", label: "Printing", limit: 5 },
] as const;

export function CatalogFilters({ facets, total, priceSortRefused }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(params.get("q") ?? "");

  /** Writes one param and resets to page 1 — any filter change invalidates the current page number. */
  function apply(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    startTransition(() => router.push(`/cards?${next.toString()}`, { scroll: false }));
  }

  const activeSort = (params.get("sort") ?? "name") as SortId;
  const activeFilters = FACET_GROUPS.filter((g) => params.get(g.key)).length + (params.get("priced") ? 1 : 0);

  return (
    <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
      {/* ---- search ---- */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply({ q: draft });
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search 23,546 cards by name or number…"
          aria-label="Search cards"
          className="min-w-0 flex-1 rounded-lg border-2 border-black bg-card-surface px-3 py-2 text-sm shadow-hard-sm outline-none focus:-translate-x-0.5 focus:-translate-y-0.5 focus:shadow-hard-md"
        />
        <button
          type="submit"
          className="rounded-lg border-2 border-black bg-pokemon-yellow px-4 py-2 text-sm font-black shadow-hard-sm transition-[transform,box-shadow] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
        >
          Search
        </button>
      </form>

      {/* ---- horizontal: sort ---- */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">Sort</span>
        {SORTS.map((sort) => {
          const active = activeSort === sort.id;
          return (
            <button
              key={sort.id}
              type="button"
              onClick={() => apply({ sort: sort.id === "name" ? undefined : sort.id })}
              aria-pressed={active}
              className={`rounded-full border-2 border-black px-3 py-1 text-xs font-bold shadow-hard-sm transition-[transform,box-shadow] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md ${
                active ? "bg-pokemon-blue text-white" : "bg-card-surface"
              }`}
            >
              {sort.label}
            </button>
          );
        })}
      </div>

      {/* A refused price sort explains itself rather than silently falling back
          to name order — the control was clicked and owes an answer. */}
      {priceSortRefused && (
        <p className="mt-2 rounded-lg border-2 border-black bg-pokemon-yellow/30 p-2 text-xs">{priceSortRefused}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-text">
          {total.toLocaleString("en-US")} card{total === 1 ? "" : "s"}
        </p>
        {(activeFilters > 0 || params.get("q") || params.get("sort")) && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              startTransition(() => router.push("/cards", { scroll: false }));
            }}
            className="text-xs font-bold underline underline-offset-4"
          >
            Clear all
          </button>
        )}
      </div>

      {/* ---- vertical: facets ---- */}
      <div className="mt-4 space-y-5">
        <FacetToggle
          label="Only cards we can price"
          checked={params.get("priced") === "1"}
          onChange={(on) => apply({ priced: on ? "1" : undefined })}
        />
        {FACET_GROUPS.map((group) => (
          <FacetGroup
            key={group.key}
            label={group.label}
            selected={params.get(group.key) ?? undefined}
            options={facets[group.key]}
            limit={group.limit}
            onSelect={(value) => apply({ [group.key]: value })}
          />
        ))}
      </div>
    </div>
  );
}

function FacetToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-black"
      />
      {label}
    </label>
  );
}

/**
 * One facet dimension. Collapsed to `limit` options with a "show all" toggle,
 * because rarity alone has 40 values and a 40-row list buries the four that
 * matter.
 */
function FacetGroup({
  label,
  options,
  selected,
  limit,
  onSelect,
}: {
  label: string;
  options: Facet[];
  selected?: string;
  limit: number;
  onSelect: (value: string | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (options.length === 0) return null;

  // A selected value must stay visible even when it sits outside the top N,
  // or clearing it becomes impossible without expanding a list you cannot see.
  const visible = expanded ? options : options.slice(0, limit);
  const shown = selected && !visible.some((o) => o.value === selected)
    ? [...visible, options.find((o) => o.value === selected) ?? { value: selected, count: 0 }]
    : visible;

  return (
    <div>
      <h3 className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">{label}</h3>
      <ul className="mt-2 space-y-1">
        {shown.map((option) => {
          const active = selected === option.value;
          return (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => onSelect(active ? undefined : option.value)}
                aria-pressed={active}
                className={`flex w-full items-center justify-between gap-2 rounded border-2 px-2 py-1 text-left text-xs transition-colors ${
                  active ? "border-black bg-pokemon-blue font-bold text-white" : "border-transparent hover:border-black hover:bg-muted-surface"
                }`}
              >
                <span className="truncate">{option.value}</span>
                <span className={active ? "text-white/80" : "text-muted-text"}>{option.count.toLocaleString("en-US")}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {options.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-[11px] font-bold underline underline-offset-2"
        >
          {expanded ? "Show fewer" : `Show all ${options.length}`}
        </button>
      )}
    </div>
  );
}
