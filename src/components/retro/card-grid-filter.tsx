"use client";

import { useMemo, useState } from "react";
import { CardTile } from "@/components/card-tile";
import type { Card } from "@/lib/types";

type SortId = "name" | "price-high" | "price-low";

/**
 * Every card is already server-rendered below (via CardTile, one per
 * `cards` entry) — this only reorders/hides what's already in the DOM by
 * toggling the `hidden` attribute and re-ordering with CSS `order`, the
 * same pattern PriceDataTabs uses for its tabs. No fetch, nothing an AI
 * crawler with JS disabled would miss: it just sees every card, unsorted.
 */
export function CardGridFilter({ cards }: { cards: Card[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("name");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return new Set(
      cards
        .filter((c) => !q || c.name.toLowerCase().includes(q) || c.set.toLowerCase().includes(q))
        .map((c) => c.id)
    );
  }, [cards, query]);

  const order = useMemo(() => {
    const sorted = [...cards].sort((a, b) => {
      if (sort === "price-high") return b.currentPrice - a.currentPrice;
      if (sort === "price-low") return a.currentPrice - b.currentPrice;
      return a.name.localeCompare(b.name);
    });
    return new Map(sorted.map((c, i) => [c.id, i]));
  }, [cards, sort]);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <label htmlFor="collection-search" className="sr-only">
          Search this collection
        </label>
        <input
          id="collection-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sets by name…"
          className="h-10 min-w-[220px] flex-1 rounded-md border-2 border-black bg-card-surface px-3.5 text-sm shadow-hard-sm outline-none placeholder:text-muted-text"
        />
        <label htmlFor="collection-sort" className="sr-only">
          Sort
        </label>
        <select
          id="collection-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortId)}
          className="h-10 rounded-md border-2 border-black bg-card-surface px-3.5 text-xs font-bold shadow-hard-sm"
        >
          <option value="name">Sort: Name (A–Z)</option>
          <option value="price-high">Sort: Price (high → low)</option>
          <option value="price-low">Sort: Price (low → high)</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        {cards.map((card) => (
          // h-full because THIS div is the grid item, not the tile inside it.
          // The grid stretches its own children to the row height, so without
          // it the wrapper grows and the tile keeps its content height — which
          // is how one long print name made its tile taller than its
          // neighbours' while they all sat in an equal-height row.
          <div className="h-full" key={card.id} hidden={!visible.has(card.id)} style={{ order: order.get(card.id) }}>
            <CardTile card={card} />
          </div>
        ))}
      </div>

      {query && visible.size === 0 && (
        <p className="mt-6 text-sm font-bold text-muted-text">No cards match &ldquo;{query}&rdquo;.</p>
      )}
    </div>
  );
}
