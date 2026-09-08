import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * English species names by National Pokedex number.
 *
 * Every label on this site is Latin. TCGdex romanises only SOME Japanese card
 * names — `Gengar Ex` for PCG1-048, `ナゾノクサ` for SV4a-001 — so a Japanese
 * card's label was Japanese about half the time. A Pokedex number is the same
 * integer in every language and TCGdex publishes it on Japanese cards, so the
 * English label is a lookup rather than a translation.
 *
 * TIER 1: one file, `node:fs` and nothing else.
 */

const FILE = path.join(process.cwd(), "data", "catalog", "pokemon-species.json");

type Loaded = {
  byDex: Map<number, string>;
  /** Japanese spellings, longest first, so the more specific name is tested before one nested in it. */
  japanese: [string, string][];
};

let cache: Loaded | undefined;

function load(): Loaded {
  if (cache) return cache;
  const byDex = new Map<number, string>();
  const japanese: [string, string][] = [];
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as {
        names?: Record<string, string>;
        japanese?: Record<string, string>;
      };
      for (const [dex, name] of Object.entries(parsed.names ?? {})) byDex.set(Number(dex), name);
      for (const [ja, en] of Object.entries(parsed.japanese ?? {})) japanese.push([ja, en]);
      japanese.sort((a, b) => b[0].length - a[0].length);
    }
  } catch {
    // Absent behaves as absent: callers fall back to whatever the catalogue
    // spells, which is the behaviour before this file existed.
  }
  cache = { byDex, japanese };
  return cache;
}

export function speciesName(dexId: number | undefined): string | undefined {
  return dexId === undefined ? undefined : load().byDex.get(dexId);
}

/**
 * The English species named inside a Japanese card title.
 *
 * For the 450 Japanese cards TCGdex publishes no dex number for —
 * `メガユキノオーex`, `ブリガロンV` — the species is still written in the name.
 * Longest match wins, because Japanese species names nest.
 */
export function speciesInJapaneseName(name: string): string | undefined {
  for (const [ja, en] of load().japanese) if (name.includes(ja)) return en;
  return undefined;
}

export function speciesCount(): number {
  return load().byDex.size;
}
