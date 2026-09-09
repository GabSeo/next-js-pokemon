import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Limitless TCG mirror: card pictures for what nobody else pictures, and
 * the bridge between an English set and its Japanese release.
 *
 * WHY IT IS A THIRD SOURCE AND NOT A REPLACEMENT. Measured before any of this
 * was written: their Japanese index holds 262 sets and 19,831 cards, ours holds
 * 341 and 23,919. Limitless begins at the HS/BW era, so the 1996-2010 Japanese
 * corpus — VS, neo, e-Card JP, PCG, PMCG, ADV — exists only in ours. Adopting
 * them as the Japanese backbone would lose 2,184 cards to gain pictures for
 * 2,006. They are better exactly where we are blind and worse everywhere else,
 * which is the definition of a supplement.
 *
 * WHAT THIS MODULE DOES NOT DO: import anything. Not `catalog.ts`, which would
 * be a cycle the moment the catalogue wants a Limitless picture, and not any
 * metered client — this is a tier-1 loader and reads files. The set it is asked
 * about is passed in.
 *
 * THE MATCH IS THE WHOLE PROBLEM. Their codes are not ours:
 *
 *   Japanese   215 of 341 sets share a code outright, because both sides use
 *              the publisher's own — `SV1a`, `MC`, `M2a`. Free.
 *   English    13 share an id. The other 128 are reachable through TCGdex's
 *              `abbreviation.official`, which IS the Limitless code — `SHF`,
 *              `CRZ`, `ASR`.
 *
 * And the case worth spelling out, because it is a third of the English gap:
 * TCGdex splits sub-sets into their own sets while Limitless folds them into
 * the parent. Shining Fates' Shiny Vault is `swsh4.5sv` here and `SHF` there,
 * Crown Zenith's Galarian Gallery is `swsh12.5gg` and `CRZ`. TCGdex writes the
 * relationship into the abbreviation as `SHF:SV` and `CRZ:GG`, so the head
 * before the colon is the parent code and the numbers already carry their own
 * prefix (`SV001`, `GG68`). No hand-maintained table is needed for any of it.
 */

const DIR = path.join(process.cwd(), "data", "catalog", "limitless");

/** Limitless says `jp`; the rest of this codebase says `ja`. Translated at the edge, once. */
export type LimitlessLanguage = "en" | "ja";

export type LimitlessSet = {
  code: string;
  /** Their English name. For a Japanese set this is a Latin label we would otherwise invent. */
  name: string;
  releaseDate?: string;
  cardCount?: number;
  cards: Record<string, string>;
};

/** What a caller passes in place of importing `CatalogSet` and creating a cycle. */
export type SetLike = {
  id: string;
  name?: string;
  abbreviation?: { official?: string; localized?: string };
};

type CatalogueFile = { sets?: LimitlessSet[] };

type Loaded = {
  /** By their own code, lowercased and stripped, which is how every lookup arrives. */
  byCode: Map<string, LimitlessSet>;
  /**
   * By their English set name, and ONLY where that name is theirs alone.
   *
   * This is the last resort in `limitlessCode` and it earns its place: nine
   * English sets have no code we share and no abbreviation that agrees —
   * TCGdex calls Aquapolis `AQ` and Limitless calls it `E2` — yet both write
   * the name identically. A name that names two of their sets is dropped from
   * this map rather than resolved arbitrarily, because the cost of the wrong
   * answer here is a real picture of the wrong card.
   */
  byName: Map<string, LimitlessSet>;
  sets: LimitlessSet[];
};

const loaded = new Map<LimitlessLanguage, Loaded>();

/** `M-P` and `MP`, `BW1-Bb` and `BW1b` are the same set on the two sides. */
function normalise(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function load(language: LimitlessLanguage): Loaded {
  const held = loaded.get(language);
  if (held) return held;

  const file = path.join(DIR, `${language === "ja" ? "jp" : "en"}.json`);
  const empty: Loaded = { byCode: new Map(), byName: new Map(), sets: [] };

  let sets: LimitlessSet[] = [];
  try {
    if (existsSync(file)) sets = (JSON.parse(readFileSync(file, "utf8")) as CatalogueFile).sets ?? [];
  } catch {
    // An unreadable mirror behaves as an absent one: every caller falls back to
    // the source it used before this file existed.
    loaded.set(language, empty);
    return empty;
  }

  const byCode = new Map<string, LimitlessSet>();
  for (const set of sets) byCode.set(normalise(set.code), set);

  const byName = new Map<string, LimitlessSet>();
  const ambiguous = new Set<string>();
  for (const set of sets) {
    const key = normalise(set.name);
    if (!key) continue;
    if (byName.has(key)) ambiguous.add(key);
    byName.set(key, set);
  }
  for (const key of ambiguous) byName.delete(key);

  const result = { byCode, byName, sets };
  loaded.set(language, result);
  return result;
}

/**
 * Which Limitless set holds this one's cards, if any.
 *
 * Tried in order of how much is being assumed: their code and ours being the
 * same word, then TCGdex's official abbreviation, then that abbreviation's
 * parent — `SHF:SV` -> `SHF` — and only then the set's English name. Nothing
 * here guesses from a date or a card count, because a wrong set is worse than
 * no set: it puts a real picture of the wrong card in front of someone holding
 * the right one.
 */
export function limitlessCode(set: SetLike, language: LimitlessLanguage): string | undefined {
  const { byCode, byName } = load(language);

  const direct = byCode.get(normalise(set.id));
  if (direct) return direct.code;

  const official = set.abbreviation?.official;
  if (official) {
    const whole = byCode.get(normalise(official));
    if (whole) return whole.code;

    // `CRZ:GG` — the sub-set marker TCGdex uses and Limitless does not have.
    const parent = official.split(":")[0];
    if (parent && parent !== official) {
      const folded = byCode.get(normalise(parent));
      if (folded) return folded.code;
    }
  }

  // Last, and only for a name they use once: Aquapolis is `AQ` to TCGdex and
  // `E2` to Limitless, and nothing but the name connects the two.
  if (set.name) {
    const named = byName.get(normalise(set.name));
    if (named) return named.code;
  }

  return undefined;
}

export function limitlessSet(set: SetLike, language: LimitlessLanguage): LimitlessSet | undefined {
  const code = limitlessCode(set, language);
  return code ? load(language).byCode.get(normalise(code)) : undefined;
}

/** `SV001` -> `["sv", 1]`, `12a` -> `["", NaN]` when there is no clean split. */
function split(localId: string): { prefix: string; number: number } | undefined {
  const parts = localId.match(/^([A-Za-z]*)(\d+)$/);
  if (!parts) return undefined;
  return { prefix: parts[1].toLowerCase(), number: Number(parts[2]) };
}

/**
 * The picture Limitless serves for one card, or nothing.
 *
 * THE NUMBERING DISAGREES IN TWO DIFFERENT WAYS and they must not be conflated,
 * which is the entire reason this is longer than a map lookup. Measured across
 * the sets where matching failed:
 *
 *   padding       Shining Fates' Shiny Vault is `SV001` here and `SV1` there.
 *                 Same prefix, same card, different zeros.
 *   a dropped     SM Black Star Promos is `SM01` here and plain `1` there.
 *   prefix        Verified on four cards including `SM110` / #110, Ash's
 *                 Pikachu, which is the kind of card a coincidence would miss.
 *
 * The second rule is the dangerous one: applied to Shining Fates it would let
 * `SV001` match their `1`, which is a completely different card that also
 * exists in that set. So it is tried ONLY when their set has no number sharing
 * our prefix at all — when there is no `SV`-anything to be confused with.
 */
export type LimitlessMatch = {
  /** Their set code, e.g. `SHF`. */
  code: string;
  /** THEIR number for the card, which is often not ours: our `SM01` is their `1`. */
  number: string;
  /** The thumbnail, 274x381. `limitlessLargeUrl` gives the full-size one. */
  url: string;
};

export function limitlessMatch(
  set: SetLike,
  localId: string,
  language: LimitlessLanguage
): LimitlessMatch | undefined {
  const found = limitlessSet(set, language);
  if (!found) return undefined;
  const hit = (number: string): LimitlessMatch => ({ code: found.code, number, url: found.cards[number] });

  if (found.cards[localId]) return hit(localId);

  const numbers = Object.keys(found.cards);
  const wanted = localId.toLowerCase();
  for (const number of numbers) if (number.toLowerCase() === wanted) return hit(number);

  const mine = split(localId);
  if (!mine) return undefined;

  // Same prefix, same number, whatever the padding. Covers `001`/`1` too,
  // where the prefix is empty on both sides.
  let prefixShared = false;
  for (const number of numbers) {
    const theirs = split(number);
    if (!theirs || theirs.prefix !== mine.prefix) continue;
    prefixShared = true;
    if (theirs.number === mine.number) return hit(number);
  }

  // Their set drops the prefix ours carries — but only if nothing over there
  // wears it, so there is no `SV1` for our `SV001` to be mistaken for.
  if (mine.prefix && !prefixShared) {
    for (const number of numbers) {
      const theirs = split(number);
      if (theirs && theirs.prefix === "" && theirs.number === mine.number) return hit(number);
    }
  }

  return undefined;
}

export function limitlessImageUrl(
  set: SetLike,
  localId: string,
  language: LimitlessLanguage
): string | undefined {
  return limitlessMatch(set, localId, language)?.url;
}

/** Their page for a card, which is where a picture came from and how to check it. */
export function limitlessCardPage(match: LimitlessMatch, language: LimitlessLanguage): string {
  return `https://limitlesstcg.com/cards/${language === "ja" ? "jp/" : ""}${match.code}/${match.number}`;
}

/**
 * Their thumbnail is 274x381. The same file at full size differs only in the
 * suffix, and is what a card page should paint — 144 KB against 59.
 *
 * A URL that does not look like theirs is returned untouched rather than
 * rewritten, so passing the wrong thing here degrades to a working image.
 */
export function limitlessLargeUrl(url: string): string {
  return url.replace(/_SM\.png$/, "_LG.png");
}

/** Every set they hold, for scripts and diagnostics. */
export function limitlessSets(language: LimitlessLanguage): LimitlessSet[] {
  return load(language).sets;
}
