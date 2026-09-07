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
 * 1. The corpus cannot be shipped to the browser to filter client-side. The
 *    existing CardGridFilter can hide and reorder in the DOM because it works
 *    on a handful of tracked cards; that approach does not survive two more
 *    orders of magnitude.
 * 2. A filtered view is a thing people send each other. `?serie=XY&rarity=Rare`
 *    is a link; component state is not.
 * 3. Sorting by price needs prices the browser does not have at all.
 *
 * Navigation runs inside a transition so the current results stay on screen,
 * dimmed, while the next page renders — rather than blanking on every click.
 */

type Props = {
  facets: { serie: Facet[]; rarity: Facet[]; category: Facet[]; variant: Facet[]; set: Facet[] };
  total: number;
  /** `${qualifiedId}` -> the name to show. Built by the page, which holds the catalogue. */
  setNames: Record<string, string>;
};

/**
 * SET ONLY, deliberately.
 *
 * Card type, series, rarity and printing each had their own vertical group, and
 * together they filled the panel before the one filter people actually reach
 * for. A set is how a card is placed — you know which pack it came from — and with
 * 387 sets across two languages it needs a picker rather than a list of
 * toggles. The others are removed rather than hidden; bringing one back is
 * adding its group here again.
 */

export function CatalogFilters({ facets, total, setNames }: Props) {
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
  const activeLanguage = params.get("lang") ?? "";
  const activeSet = params.get("set") ?? "";
  const activeFilters = (activeSet ? 1 : 0) + (activeLanguage ? 1 : 0);

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
          placeholder="Search by card name or number…"
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

      {/* ---- vertical: language, then set ---- */}
      <div className="mt-4 space-y-4">
        <div>
          <p className="mb-2 text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">Language</p>
          <div className="flex flex-wrap gap-2">
            {[
              { value: "", label: "Both" },
              { value: "en", label: "English" },
              { value: "ja", label: "Japanese" },
            ].map((option) => (
              <button
                key={option.value || "all"}
                type="button"
                onClick={() => apply({ lang: option.value || undefined, set: undefined })}
                aria-pressed={activeLanguage === option.value}
                className={`rounded-full border-2 border-black px-3 py-1 text-xs font-bold shadow-hard-sm transition-[transform,box-shadow] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md ${
                  activeLanguage === option.value ? "bg-pokemon-blue text-white" : "bg-card-surface"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="set-filter"
            className="mb-2 block text-[10px] font-black tracking-[0.6px] text-muted-text uppercase"
          >
            Set
          </label>
          <select
            id="set-filter"
            value={activeSet}
            onChange={(event) => apply({ set: event.target.value || undefined })}
            className="w-full rounded-lg border-2 border-black bg-card-surface px-3 py-2 text-sm shadow-hard-sm outline-none focus:-translate-x-0.5 focus:-translate-y-0.5 focus:shadow-hard-md"
          >
            <option value="">All sets</option>
            {facets.set.map((option) => (
              <option key={option.value} value={option.value}>
                {setNames[option.value] ?? option.value} ({option.count.toLocaleString("en-US")})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
