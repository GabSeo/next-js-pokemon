"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { SORTS, type SortId } from "@/lib/catalog-query";

/**
 * The search box, sort bar and filters both catalogue searches share.
 *
 * ONE COMPONENT, TWO GAMES, because the two searches are meant to be the same
 * surface with exactly one difference: Pokemon has an English and a Japanese
 * catalogue to choose between and One Piece does not. Bandai publishes the same
 * cards in three languages rather than three catalogues, so there is nothing
 * there to switch. Everything else — the set picker, the four sorts, the layout
 * — is identical, and it is identical because it is literally the same code
 * rather than two copies that will drift apart.
 *
 * SET AND PRICE, and nothing else. Card type, series, rarity and printing each
 * had their own vertical group on the Pokemon side, and together they filled
 * the panel above the one filter people reach for. The set is how a card is
 * placed; the price sort is the only other axis both games can honestly offer,
 * now that One Piece printings carry figures from optcgapi.
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
  /** Pokemon only — see this file's header. */
  showLanguage?: boolean;
};

export function SearchControls({ basePath, total, filter, placeholder, showLanguage }: Props) {
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
          placeholder={placeholder}
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

      <div className="mt-4 space-y-4">
        {showLanguage && (
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
                  // The set is cleared too: a set belongs to one catalogue, so
                  // carrying it across a language switch guarantees no results.
                  onClick={() => apply({ lang: option.value || undefined, [filter.param]: undefined })}
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
        )}

        <div>
          <label
            htmlFor="search-filter"
            className="mb-2 block text-[10px] font-black tracking-[0.6px] text-muted-text uppercase"
          >
            {filter.label}
          </label>
          <select
            id="search-filter"
            value={activeFilter}
            onChange={(event) => apply({ [filter.param]: event.target.value || undefined })}
            className="w-full rounded-lg border-2 border-black bg-card-surface px-3 py-2 text-sm shadow-hard-sm outline-none focus:-translate-x-0.5 focus:-translate-y-0.5 focus:shadow-hard-md"
          >
            <option value="">All {filter.label.toLowerCase()}s</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
                {option.count === undefined ? "" : ` (${option.count.toLocaleString("en-US")})`}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
