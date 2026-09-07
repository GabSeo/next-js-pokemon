"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  readCollection,
  removeEntry,
  subscribeToCollection,
  type CollectionEntry,
} from "@/lib/collection";

/**
 * What is actually in the collection, read from this browser.
 *
 * CLIENT-ONLY BY NECESSITY, not by preference: the collection lives in
 * localStorage, so no server render can know it. The empty first paint is
 * deliberate — `useSyncExternalStore`'s server snapshot returns an empty list
 * so that the server HTML and the first client render agree, and the real
 * contents arrive on hydration. Rendering a guess would flash the wrong list.
 *
 * IT SHOWS WHAT WE KNOW AND ADMITS WHAT WE DO NOT. An entry added from the card
 * page carries a printing; one added from a tracked-card page, or saved before
 * printings were representable at all, does not. Those are rendered as "printing
 * not recorded" rather than silently shown as the default printing, because the
 * whole reason this format changed is that guessing there is a median 3.36x
 * error (lib/collection.ts).
 *
 * NO VALUE TOTAL, and that is honest rather than unfinished. Pricing a
 * collection means pricing each printing, which is a metered lookup per card —
 * exactly the boundary docs/free-tier-catalogue.md draws between the free
 * catalogue and the paid market data. The absence of a total is the paywall,
 * stated plainly instead of teased.
 */

const GAME_LABEL: Record<string, string> = { pokemon: "Pokémon", onepiece: "One Piece" };

function PRINT_LABEL(entry: CollectionEntry): string {
  if (!entry.printKey) return "printing not recorded";
  // One Piece printKeys are Bandai printing ids that already contain the code
  // (`OP05-119_p2`); showing the whole thing twice in one row reads as noise.
  if (entry.code && entry.printKey.startsWith(entry.code)) {
    const suffix = entry.printKey.slice(entry.code.length).replace(/^_/, "");
    return suffix ? `printing ${suffix}` : "base printing";
  }
  return entry.printKey;
}

export function CollectionList() {
  const entries = useSyncExternalStore(
    subscribeToCollection,
    () => JSON.stringify(readCollection()),
    () => "[]"
  );
  const parsed = JSON.parse(entries) as CollectionEntry[];

  if (parsed.length === 0) {
    return (
      <div className="mt-6 rounded-lg border-2 border-black bg-muted-surface p-4 text-sm">
        <p className="font-black">Nothing here yet.</p>
        <p className="mt-1 text-muted-text">
          Find a card and add the printing you own —{" "}
          <Link href="/scan" className="font-black underline underline-offset-4">
            scan one
          </Link>
          ,{" "}
          <Link href="/lookup" className="font-black underline underline-offset-4">
            look it up by code
          </Link>
          , or{" "}
          <Link href="/sets" className="font-black underline underline-offset-4">
            browse the sets
          </Link>
          .
        </p>
      </div>
    );
  }

  const withoutPrinting = parsed.filter((entry) => !entry.printKey).length;

  return (
    <>
      <p className="mt-6 rounded-lg border-2 border-black bg-muted-surface p-3 text-xs">
        {parsed.length} printing{parsed.length === 1 ? "" : "s"}, saved in this browser only — there is no account
        yet, so clearing your site data clears this.
        {withoutPrinting > 0 ? (
          <>
            {" "}
            <b>{withoutPrinting}</b> of them {withoutPrinting === 1 ? "was" : "were"} saved without a printing. Open
            the card and add the exact one you own — a reverse holo is worth a median 3.4× its normal twin, so which
            one it is decides the value.
          </>
        ) : null}
      </p>

      <ul className="mt-4 grid gap-2">
        {parsed.map((entry) => (
          <li
            key={entry.id}
            className="flex items-center justify-between gap-3 rounded-lg border-2 border-black bg-surface p-3"
            style={{ boxShadow: "3px 3px 0 0 #000" }}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-black">{entry.code ?? entry.id}</div>
              <div className="mt-0.5 text-[11px] text-muted-text">
                {entry.tcg ? GAME_LABEL[entry.tcg] ?? entry.tcg : "saved before games were recorded"}
                {" · "}
                <span className={entry.printKey ? "" : "font-bold"}>{PRINT_LABEL(entry)}</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {entry.tcg && entry.code ? (
                <Link
                  href={`/card/${entry.tcg}/${encodeURIComponent(entry.code)}`}
                  className="rounded-md border-2 border-black bg-muted-surface px-2 py-1 text-[11px] font-black"
                >
                  Open
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                aria-label={`Remove ${entry.code ?? entry.id}`}
                className="rounded-md border-2 border-black bg-surface px-2 py-1 text-[11px] font-black"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
