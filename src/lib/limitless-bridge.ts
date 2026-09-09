import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { limitlessCode, limitlessSets, type SetLike } from "@/lib/limitless";

/**
 * Which Japanese set an English set came from, and back again.
 *
 * WHY IT MATTERS. A Pokemon card is printed in Japan first and internationally
 * months later, and the two releases are the same card — the same artwork, the
 * same Pokedex number, a different set and a different number. Our catalogue
 * holds them as strangers. That is why scanning a Japanese Lugia can only ever
 * answer `S12-110` and never "this is the one you know as Silver Tempest 138",
 * and why the same photograph is searched against two indexes that both contain
 * it. Nothing upstream carries the relationship: TCGdex does not model it and
 * the Japanese publisher has no reason to.
 *
 * WHERE IT COMES FROM. Limitless lists a card's Japanese printings on its
 * English page. scripts/limitless-bridge.mts samples five cards per English set
 * and records which Japanese sets their siblings live in — 760 requests for a
 * relationship that holds set-wide, rather than 20,315 for one that mostly
 * repeats itself.
 *
 * WHAT IT IS NOT, and this is the important half: this maps SETS, not cards. It
 * narrows a Japanese card's English identity from 21,000 candidates to the
 * hundred-odd in one set. It does not name the card. Narrowing within a set is
 * what the artwork index is for, and pretending this could do it would be
 * exactly the confident wrong answer the rest of this codebase keeps refusing
 * to give.
 *
 * THREE OUTCOMES, all of them real answers:
 *
 *   expansion    83 sets. One to three Japanese sets account for it.
 *   compilation   6 sets. Reprints from everywhere — the Eevee ex starter names
 *                 39 Japanese sets, because its cards were printed in all of
 *                 them. No origin exists to find.
 *   unknown      63 sets. Limitless carries no Japanese data this far back;
 *                their Japanese catalogue starts at the HS/BW era.
 */

const FILE = path.join(process.cwd(), "data", "catalog", "limitless", "bridge.json");

export type BridgeKind = "expansion" | "compilation" | "unknown";

type BridgeRow = {
  votes: Record<string, number>;
  sampled: number;
  kind: BridgeKind;
  origin?: string;
};

type BridgeFile = { sets?: Record<string, BridgeRow> };

type Loaded = {
  /** By their English set code. */
  rows: Map<string, BridgeRow>;
  /** Their Japanese code -> the English codes that name it as an origin. */
  reverse: Map<string, string[]>;
};

let loaded: Loaded | undefined;

function load(): Loaded {
  if (loaded) return loaded;

  let sets: Record<string, BridgeRow> = {};
  try {
    if (existsSync(FILE)) sets = (JSON.parse(readFileSync(FILE, "utf8")) as BridgeFile).sets ?? {};
  } catch {
    // An absent or unreadable bridge means every question below answers
    // "unknown", which is what the product did before it existed.
  }

  const rows = new Map(Object.entries(sets));
  const reverse = new Map<string, string[]>();
  for (const [english, row] of rows) {
    // ONLY EXPANSIONS ARE REVERSED. A compilation names dozens of Japanese
    // sets, so indexing it backwards would make half the Japanese catalogue
    // claim descent from a starter deck.
    if (row.kind !== "expansion") continue;
    for (const [japanese, count] of Object.entries(row.votes)) {
      if (count / row.sampled < 0.4) continue;
      reverse.set(japanese, [...(reverse.get(japanese) ?? []), english]);
    }
  }

  loaded = { rows, reverse };
  return loaded;
}

export type SetOrigin = {
  kind: BridgeKind;
  /** Their Japanese set codes, strongest first. Empty when `kind` is `unknown`. */
  japanese: string[];
  /** The single Japanese set this one came from, when one clearly dominates. */
  origin?: string;
};

/** Where an English set came from. `set` is a `CatalogSet` — passed, not imported. */
export function japaneseOriginOf(set: SetLike): SetOrigin {
  const code = limitlessCode(set, "en");
  const row = code ? load().rows.get(code) : undefined;
  if (!row) return { kind: "unknown", japanese: [] };

  const japanese = Object.entries(row.votes)
    .filter(([, count]) => count / row.sampled >= 0.4)
    .sort((a, b) => b[1] - a[1])
    .map(([jp]) => jp);

  return { kind: row.kind, japanese, origin: row.origin };
}

/**
 * Which English sets came from a Japanese one — the direction a scan asks in,
 * since the card in the sleeve is the Japanese one and the question is what the
 * English world calls it.
 *
 * More than one is normal and not a defect: Japanese sets are smaller, so
 * `SV1a` feeds both `SVI` and `PAF`.
 */
export function englishSetsFrom(set: SetLike): string[] {
  const code = limitlessCode(set, "ja");
  return code ? (load().reverse.get(code) ?? []) : [];
}

/** Their English name for a set code, for reporting — `SV7` reads as "Stellar Miracle". */
export function limitlessSetName(code: string, language: "en" | "ja"): string | undefined {
  return limitlessSets(language).find((set) => set.code === code)?.name;
}
