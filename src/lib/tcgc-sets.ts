import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Which set of TCG Collector's is which set of ours.
 *
 * WHY THIS IS A MODULE AND NOT A LINE IN A SCRIPT. Every Japanese card we do
 * not have — a whole set's worth or one secret rare — is reachable only through
 * this join, and getting it wrong is worse than the gap it fixes: importing
 * eighty cards onto the wrong set writes eighty confident lies into the
 * catalogue, where nothing downstream can tell them from the truth. It is
 * written once, here, so that every importer makes the same claim.
 *
 * THE THREE RULES, IN THE ORDER THEY ARE TRUSTED.
 *
 * 1. THE PRINTED SET CODE. Both sides carry it and it is the same fact: their
 *    `XY9` and our `XY9` are the sheet of cardboard Creatures printed in
 *    December 2015. 322 of their 462 sets publish one. Where several of their
 *    sets share a code — `L2` names Reviving Legends AND two 19-card starter
 *    decks — the declared card count separates them, because a code identifies
 *    a release and not a product.
 *
 * 2. THE TEN PAIRED SETS, by hand and deliberately so. Five Japanese releases
 *    shipped as two simultaneous halves: HeartGold and SoulSilver, Collection X
 *    and Y, Gaia Volcano and Tidal Storm, Blue Shock and Red Flash,
 *    Fever-Burst Fighter and Cruel Traitor. Both halves share a date, a size
 *    and a base code, so nothing mechanical can tell `XY8a` from `XY8b` — the
 *    only discriminator is the name, and ours are `青い衝撃` and `赤い閃光`
 *    against their `Blue Shock` and `Red Flash`. A translation table is data,
 *    not a special case; inventing a transliterator to guess at five pairs
 *    would be a machine that can be wrong.
 *
 * 3. THE RELEASE DATE, for the sets printed before codes existed. Their 2003
 *    sets carry no code at all, and ours join on the day: `ADV Expansion Pack`
 *    is the only 55-card set published on 2003-01-31. A date alone is not
 *    enough — four products shipped that day — so the nearest size wins and
 *    must win clearly, by more than five cards over the runner-up. Measured,
 *    all five ADV sets and the World Champions Pack resolve, and no set
 *    resolves to something a human reading both names would reject.
 *
 * WHAT IT REFUSES TO ANSWER. 70 of our 366 Japanese sets come from the official
 * Japanese site rather than TCGdex, carry no code and no release date, and
 * resolve to nothing. They already hold their cards; an unresolved set is a
 * set this module has no opinion about, never a licence to guess.
 */

export type TcgcSet = {
  /** Their numeric set id — the path segment, and the page cache's filename. */
  id: string;
  slug: string;
  /** Their English name. Ours are Japanese, so this is for a human to check. */
  name: string;
  /** The printed set code, or "" for the sets printed before codes existed. */
  code: string;
  /** As they print it: "Mar 18, 2016". */
  date: string;
  /** Distinct cards on their set page — verified equal to the numbers listed. */
  cards: number;
};

const FILE = path.join(process.cwd(), "data", "catalog", "tcgc-sets.json");

const MONTH: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** "Mar 18, 2016" -> "2016-03-18", the shape TCGdex publishes. */
export function tcgcIsoDate(date: string): string {
  const m = /^(\w{3}) (\d{2}), (\d{4})$/.exec(date);
  return m ? `${m[3]}-${MONTH[m[1]]}-${m[2]}` : "";
}

/**
 * Codes compare case-insensitively and without punctuation, but NOT without
 * `+`: `SM1+` and `SM1` are two different sets four weeks apart.
 */
const norm = (code: string) => code.toLowerCase().replace(/[^a-z0-9+]/g, "");

/** See rule 2. The key is our set id; the value is their printed code. */
const PAIRED: Record<string, string> = {
  L1a: "L1-Bhg",    // ハートゴールドコレクション  HeartGold Collection
  L1b: "L1-Bss",    // ソウルシルバーコレクション  SoulSilver Collection
  XY1a: "XY1-Bx",   // コレクションX              Collection X
  XY1b: "XY1-By",   // コレクションY              Collection Y
  XY5a: "XY5-Bg",   // ガイアボルケーノ            Gaia Volcano
  XY5b: "XY5-Bt",   // タイダルストーム            Tidal Storm
  XY8a: "XY8-Bb",   // 青い衝撃                   Blue Shock
  XY8b: "XY8-Br",   // 赤い閃光                   Red Flash
  XY11a: "XY11-Bb", // 爆熱の闘士                 Fever-Burst Fighter
  XY11b: "XY11-Br", // 冷酷の反逆者                Cruel Traitor
};

let cache: { all: TcgcSet[]; byCode: Map<string, TcgcSet[]> } | undefined;

function load() {
  if (cache) return cache;
  const all = JSON.parse(readFileSync(FILE, "utf8")) as TcgcSet[];
  const byCode = new Map<string, TcgcSet[]>();
  for (const set of all) {
    if (!set.code) continue;
    const key = norm(set.code);
    const bucket = byCode.get(key);
    if (bucket) bucket.push(set);
    else byCode.set(key, [set]);
  }
  cache = { all, byCode };
  return cache;
}

export function tcgcSets(): TcgcSet[] {
  return load().all;
}

export type TcgcMatch = { set: TcgcSet; how: "code" | "code+size" | "pair" | "date" };

/**
 * Their set for one of ours, or nothing.
 *
 * `size` is how many cards the set is declared to hold — TCGdex's total where
 * there is one, otherwise how many we actually hold. It is a tie-break, never
 * a test: they list more cards than TCGdex declares in 119 of our sets, which
 * is the entire reason this join exists.
 */
export function tcgcCounterpart(
  ourSetId: string,
  size: number,
  releaseDate: string
): TcgcMatch | undefined {
  const paired = PAIRED[ourSetId];
  const coded = load().byCode.get(norm(paired ?? ourSetId));
  if (coded?.length) {
    const nearest = [...coded].sort((a, b) => Math.abs(a.cards - size) - Math.abs(b.cards - size))[0];
    return { set: nearest, how: paired ? "pair" : coded.length > 1 ? "code+size" : "code" };
  }

  if (!releaseDate) return undefined;
  const sameDay = load()
    .all.filter((t) => tcgcIsoDate(t.date) === releaseDate)
    .sort((a, b) => Math.abs(a.cards - size) - Math.abs(b.cards - size));
  const [best, next] = sameDay;
  if (!best || Math.abs(best.cards - size) > 10) return undefined;
  // A day with two products of similar size cannot be resolved by size, and a
  // wrong set is worse than an unmatched one.
  if (next && Math.abs(next.cards - size) <= Math.abs(best.cards - size) + 5) return undefined;
  return { set: best, how: "date" };
}
