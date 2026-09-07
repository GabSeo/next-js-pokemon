/**
 * What a person owns, stored in their browser.
 *
 * WHY THIS REPLACES A LIST OF STRINGS. The collection used to be
 * `["sv08-001", ...]` — a card id and nothing else. That cannot express the one
 * thing a collection is actually about: WHICH version you own. `sv08-001` is
 * Exeggcute at EUR 0.04 normal and EUR 0.15 reverse holo, and the old format
 * recorded neither — it recorded "an Exeggcute". Across the catalogue that gap
 * is a median 3.36x error on anything that later tries to value a collection
 * (docs/free-tier-catalogue.md §3d).
 *
 * A card is a picture. A PRINT is the thing in the sleeve. This stores prints.
 *
 * THE ID IS DELIBERATELY NOT CANONICAL YET. `pokemon:sv08-001:reverse` still
 * carries TCGdex's name for the card, which ARCHITECTURE_AUDIT.md §5 flags as
 * the wrong long-term identity. That rename is a separate job with a separate
 * cost, and doing the print half first is what makes the collection correct
 * today without waiting for it. When canonical ids land, this is a migration of
 * one field in one array — which is exactly why the id is parsed rather than
 * pattern-matched anywhere it is read.
 *
 * BROWSER-ONLY, AND THAT IS THE CURRENT PRODUCT. There is no account, no
 * server, no sync. It lives in one browser and disappears with its site data.
 * Every function here guards against localStorage being unavailable (private
 * mode, blocked cookies, SSR) by returning an empty collection rather than
 * throwing, because a collection page that crashes is worse than one that is
 * empty.
 */

const STORAGE_KEY = "cardtrace:collection";
export const COLLECTION_CHANGED = "cardtrace:collection-changed";

/** Bumped when the stored SHAPE changes. v1 was a bare array of card-id strings. */
const SCHEMA_VERSION = 2;

export type CollectionEntry = {
  /**
   * Stable within this browser. `{tcg}:{code}:{printKey}` for anything added
   * since printings existed; a bare card id for anything older.
   */
  id: string;
  tcg?: "pokemon" | "onepiece";
  /** The card's address in its own catalogue — a TCGdex id, or a One Piece code. */
  code?: string;
  /**
   * Which printing. "normal" / "reverse" / "holo" for Pokémon, a Bandai
   * printing id for One Piece.
   *
   * **Undefined means we genuinely do not know**, not that it is the default
   * printing — either the entry predates this format, or it was added from a
   * page that knows the card but not the print (the tracked-card pages).
   * Storing a guess here would be the exact error this file exists to remove.
   */
  printKey?: string;
  addedAt: string;
};

type StoredV2 = { v: number; entries: CollectionEntry[] };

/** `pokemon:sv08-001:reverse`. Redundant-looking for One Piece, where printKey contains the code — but unambiguous and parseable by split, which matters more than brevity in a key nothing renders. */
export function printId(tcg: string, code: string, printKey?: string): string {
  return `${tcg}:${code}:${printKey ?? ""}`;
}

/**
 * Where a TRACKED card sits in the collection's id space.
 *
 * The tracked pages (/products, /tools/price-checker) know a `Card`, whose own
 * identity is a slug like `gengar-vmax-271`. Storing that would open a second
 * id space inside one collection — the same physical card recorded two ways
 * depending on which page you added it from. So this maps onto the CATALOGUE
 * code the free pages use: `tcgdexId` for Pokémon, `number` for One Piece
 * (which carries `OP07-113` there), falling back to the slug only when neither
 * resolved, which is a real state for a card no catalogue matched.
 *
 * Structurally typed rather than importing `Card`, so this module stays free of
 * the tier-2 graph — see scripts/check-free-tier.mts.
 */
export function collectionRefForCard(card: {
  franchise: string;
  slug: string;
  number?: string;
  tcgdexId?: string;
}): { tcg: "pokemon" | "onepiece"; code: string } {
  const onePiece = card.franchise === "one-piece";
  return {
    tcg: onePiece ? "onepiece" : "pokemon",
    code: (onePiece ? card.number : card.tcgdexId) ?? card.slug,
  };
}

function parse(raw: string | null): CollectionEntry[] {
  if (!raw) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Corrupt storage is not worth destroying someone's collection over, but it
    // also cannot be read. Empty is the honest answer; the raw string stays on
    // disk untouched in case it is ever worth recovering by hand.
    return [];
  }

  // v1: a bare array of card ids, written before printings were representable.
  // Kept rather than dropped — it is somebody's list — but deliberately NOT
  // upgraded to a printKey, because nothing in the old format said which
  // printing was meant and inventing one would be a lie with a price attached.
  if (Array.isArray(value)) {
    return value
      .filter((id): id is string => typeof id === "string")
      .map((id) => ({ id, addedAt: new Date(0).toISOString() }));
  }

  const stored = value as StoredV2;
  return Array.isArray(stored?.entries) ? stored.entries : [];
}

export function readCollection(): CollectionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function write(entries: CollectionEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredV2 = { v: SCHEMA_VERSION, entries };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new Event(COLLECTION_CHANGED));
  } catch {
    // Quota exceeded, or storage blocked. The in-memory state is already
    // correct for this page; failing loudly would help nobody.
  }
}

export function isInCollection(id: string): boolean {
  return readCollection().some((entry) => entry.id === id);
}

/** Add if absent, remove if present. Returns the collection after the change. */
export function toggleEntry(entry: Omit<CollectionEntry, "addedAt">): CollectionEntry[] {
  const current = readCollection();
  const next = current.some((e) => e.id === entry.id)
    ? current.filter((e) => e.id !== entry.id)
    : [...current, { ...entry, addedAt: new Date().toISOString() }];
  write(next);
  return next;
}

export function removeEntry(id: string): CollectionEntry[] {
  const next = readCollection().filter((entry) => entry.id !== id);
  write(next);
  return next;
}

/** Subscribe to changes — both our own writes and another tab's. */
export function subscribeToCollection(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(COLLECTION_CHANGED, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(COLLECTION_CHANGED, callback);
  };
}
