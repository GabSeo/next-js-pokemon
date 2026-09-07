"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { SORTS, type SortId } from "@/lib/catalog-query";

/**
 * The search box, filters and sort bar both catalogue searches share.
 *
 * HORIZONTAL, ACROSS THE TOP — not a sidebar. The Pokemon search used a 260px
 * vertical panel, and on a page whose entire job is showing card pictures that
 * panel costs a whole column of them: four cards per row instead of five, each
 * one narrower. The controls are read once and the grid is looked at for the
 * rest of the visit, so the grid gets the width.
 *
 * ONE COMPONENT, TWO GAMES, identical on both sides — they are the same surface
 * because they are the same code rather than two copies that drift.
 *
 * NO LANGUAGE CONTROL. There was one, briefly, and it was a mistake: this app
 * shows English prints. The Japanese Pokemon corpus exists to RECOGNISE a card
 * somebody is holding, and what they are then shown, track and price is the
 * English print — the one with a market behind it. Offering Japanese cards for
 * browsing would offer pages the app deliberately will not render.
 *
 * SET AND PRICE, and nothing else. Card type, series, rarity and printing each
 * had their own group on the Pokemon side and together they filled the panel
 * above the one filter people reach for. The set is how a card is placed; the
 * price sort is the only other axis both games can honestly offer, now that
 * One Piece printings carry figures from optcgapi.
 *
 * EVERY CONTROL WRITES THE URL and the server does the filtering. The corpus
 * cannot be shipped to the browser, a filtered view is a thing people send each
 * other, and a price sort needs prices the browser does not have.
 */

export type SelectOption = { value: string; label: string; count?: number };

type Props = {
  /** Where the controls navigate — `/cards` or `/cards/one-piece`. */
  basePath: string;
  total: number;
  /** The set or pack picker: which query parameter it writes, and what to call it. */
  filter: { param: string; label: string; options: SelectOption[] };
  placeholder: string;
};

const PILL =
  "rounded-full border-2 border-black px-3 py-1 text-xs font-bold shadow-hard-sm transition-[transform,box-shadow] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md";

export function SearchControls({ basePath, total, filter, placeholder }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(params.get("q") ?? "");

  /** Writes one param and resets to page 1 — any change invalidates the current page number. */
  function apply(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    startTransition(() => router.push(`${basePath}?${next.toString()}`, { scroll: false }));
  }

  const activeSort = (params.get("sort") ?? "name") as SortId;
  const activeLanguage = params.get("lang") ?? "";
  const activeFilter = params.get(filter.param) ?? "";
  const dirty = Boolean(activeFilter || activeLanguage || params.get("q") || params.get("sort"));

  return (
    <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
      {/* ---- one row: search, set, language, submit ---- */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply({ q: draft });
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          type="search"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label="Search cards"
          className="min-w-[12rem] flex-1 rounded-lg border-2 border-black bg-card-surface px-3 py-2 text-sm shadow-hard-sm outline-none focus:-translate-x-0.5 focus:-translate-y-0.5 focus:shadow-hard-md"
        />

        <select
          value={activeFilter}
          onChange={(event) => apply({ [filter.param]: event.target.value || undefined })}
          aria-label={`Filter by ${filter.label.toLowerCase()}`}
          className="max-w-[16rem] rounded-lg border-2 border-black bg-card-surface px-3 py-2 text-sm shadow-hard-sm outline-none focus:-translate-x-0.5 focus:-translate-y-0.5 focus:shadow-hard-md"
        >
          <option value="">All {filter.label.toLowerCase()}s</option>
          {filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
              {option.count === undefined ? "" : ` (${option.count.toLocaleString("en-US")})`}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="rounded-lg border-2 border-black bg-pokemon-yellow px-4 py-2 text-sm font-black shadow-hard-sm transition-[transform,box-shadow] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
        >
          Search
        </button>
      </form>

      {/* ---- second row: sort, count, reset ---- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {SORTS.map((sort) => {
          const active = activeSort === sort.id;
          return (
            <button
              key={sort.id}
              type="button"
              onClick={() => apply({ sort: sort.id === "name" ? undefined : sort.id })}
              aria-pressed={active}
              className={`${PILL} ${active ? "bg-pokemon-blue text-white" : "bg-card-surface"}`}
            >
              {sort.label}
            </button>
          );
        })}

        <p className="ml-auto text-xs text-muted-text">
          {total.toLocaleString("en-US")} card{total === 1 ? "" : "s"}
        </p>

        {dirty && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              startTransition(() => router.push(basePath, { scroll: false }));
            }}
            className="text-xs font-bold underline underline-offset-4"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
