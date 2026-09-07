"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { printId, readCollection, subscribeToCollection, toggleEntry } from "@/lib/collection";

/**
 * Add one PRINTING to the collection.
 *
 * It used to add a card id and nothing else, which could not say whether you
 * owned the EUR 0.04 Exeggcute or the EUR 0.15 one. See lib/collection.ts for
 * why that mattered and what replaced it.
 *
 * `printKey` is optional, and its absence is meaningful rather than a default:
 * the tracked-card pages know which card they are showing but not which of its
 * printings you hold, so they omit it and the entry records that we do not
 * know. Only the card page, which lists the printings side by side, can pass
 * one honestly.
 */
export function AddToCollectionButton({
  tcg,
  code,
  printKey,
  label,
  size,
}: {
  tcg: "pokemon" | "onepiece";
  code: string;
  printKey?: string;
  /** Overrides the default wording where the surrounding tile already says which printing this is. */
  label?: string;
  size?: "sm";
}) {
  const id = printId(tcg, code, printKey);

  const inCollection = useSyncExternalStore(
    subscribeToCollection,
    () => readCollection().some((entry) => entry.id === id),
    // Server and first client render must agree, so both start false and the
    // real value arrives on hydration. Rendering "in your collection" from a
    // server that cannot see localStorage would flash the wrong state.
    () => false
  );

  if (size === "sm") {
    return (
      <button
        type="button"
        onClick={() => toggleEntry({ id, tcg, code, printKey })}
        aria-pressed={inCollection}
        className={`w-full rounded-md border-2 border-black px-2 py-1 text-[11px] font-black transition-transform hover:-translate-y-0.5 ${
          inCollection ? "bg-accent-surface" : "bg-surface"
        }`}
      >
        {inCollection ? "In collection ✓" : (label ?? "I own this")}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={inCollection ? "secondary" : "outline"}
      aria-pressed={inCollection}
      onClick={() => toggleEntry({ id, tcg, code, printKey })}
    >
      {inCollection ? "In your collection ✓" : (label ?? "Add to my collection")}
    </Button>
  );
}
