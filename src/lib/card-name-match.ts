import { getCatalogSets, getCatalogSetCards } from "@/lib/catalog";
import { japaneseOfficialCards } from "@/lib/pokemon-ja-official";

/**
 * Which card NAMES appear in a block of scanned text.
 *
 * WHY THE NAME AND NOT JUST THE NUMBER. What is printed on a Pokemon card is
 * `048/082` — a number and a set size, never the set, which is carried by a
 * symbol no OCR reads. 154 of 216 English sets share their printed total with
 * another English set and 152 of 182 Japanese ones do, so the number alone
 * genuinely names several cards: a photographed Japanese Gengar ex is also
 * Team Rocket Porygon. The name is the field that separates them, and Vision
 * has been reading it off the card all along.
 *
 * LONGEST MATCH WINS, because names nest. `ゲンガー` is inside `ゲンガーex`,
 * and `Charizard` is inside `Charizard ex`; taking the longest name the text
 * actually contains picks the more specific card rather than its base form.
 *
 * WHY A LINEAR SCAN IS FINE. ~34,000 distinct names against one short string,
 * built once per process and reused. Measured well under the cost of the Vision
 * call it follows.
 *
 * TIER 1: two catalogue loaders and nothing else, so this cannot spend quota.
 */

/** Latin names shorter than this match too much — "ex", "Bill", "Energy" appear everywhere. */
const MIN_LATIN = 5;

/** Japanese is dense: two characters already carry a name, and OCR clips edges. */
const MIN_JAPANESE = 2;

const JAPANESE_SCRIPT = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/;

export type NameHit = {
  /** `setId#number` for a Japanese card, or a TCGdex id for an English one. */
  key: string;
  name: string;
  language: "en" | "ja";
};

type Index = { japanese: [string, string][]; english: [string, string][] };

let index: Index | undefined;

function build(): Index {
  if (index) return index;

  const japanese: [string, string][] = [];
  for (const [key, card] of japaneseOfficialCards()) {
    if (card.name.length >= MIN_JAPANESE) japanese.push([card.name, key]);
  }

  // One entry per distinct name: a name that matches leads to every card
  // carrying it, and the caller resolves that through its own lookup.
  const seen = new Set<string>();
  const english: [string, string][] = [];
  for (const set of getCatalogSets({ language: "all" })) {
    for (const { card } of getCatalogSetCards(set.id, set.language)) {
      const name = card.name?.trim();
      if (!name || name.length < MIN_LATIN || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      english.push([name, card.tcgdexId]);
    }
  }

  // Longest first, so the specific form is tested before the one nested in it.
  japanese.sort((a, b) => b[0].length - a[0].length);
  english.sort((a, b) => b[0].length - a[0].length);

  index = { japanese, english };
  return index;
}

/**
 * The most specific card names this text contains, longest first.
 *
 * Japanese names are searched only when the text actually carries Japanese
 * script, and Latin names only when it carries Latin — not to filter out an
 * answer, but because a card face is written in one of them and scanning the
 * other list can only add noise. Both are searched when the text has both,
 * which a Japanese card often does (`HP`, `ex`).
 */
export function namesInText(text: string, limit = 4): NameHit[] {
  const { japanese, english } = build();
  const hits: NameHit[] = [];

  if (JAPANESE_SCRIPT.test(text)) {
    for (const [name, key] of japanese) {
      if (!text.includes(name)) continue;
      hits.push({ key, name, language: "ja" });
      if (hits.length >= limit) return hits;
    }
  }

  if (/[A-Za-z]{4}/.test(text)) {
    const haystack = text.toLowerCase();
    for (const [name, key] of english) {
      if (!haystack.includes(name.toLowerCase())) continue;
      hits.push({ key, name, language: "en" });
      if (hits.length >= limit) return hits;
    }
  }

  return hits;
}
