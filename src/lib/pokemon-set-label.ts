import type { CatalogSet } from "@/lib/catalog";
import { limitlessCode, limitlessSets } from "@/lib/limitless";

/**
 * What to CALL a Pokemon set on screen. The only place that decides.
 *
 * THE PROBLEM, visible in every dropdown on the site. An English set reads
 * "Destined Rivals". Its Japanese siblings read `DPt-EPd (JP)`, `BGSt (JP)`,
 * `X30 (JP)` — publisher codes, because that is all the catalogue had. A list
 * of codes cannot be scanned, cannot be searched by name, and tells a reader
 * nothing about what they are looking at.
 *
 * The Japanese titles exist — `ステラミラクル` — and are not the answer either:
 * every label on this site is Latin (see lib/card-label.ts for the card-level
 * version of the same rule), because a reader who cannot type kana cannot
 * search for it.
 *
 * WHERE THE NAMES COME FROM. Limitless publishes an English name for every
 * Japanese set it carries — `SV7` is "Stellar Miracle", `S9` is "Star Birth",
 * `X30` is "Xerneas Half Deck". That covers 224 of our 381 Japanese sets, which
 * is every set from the HS/BW era forward.
 *
 * WHAT HAPPENS TO THE OTHER 157, stated rather than papered over. Limitless's
 * Japanese catalogue begins around 2010 and ours goes back to 1996, so for the
 * older half no English name exists anywhere we can reach. Those keep their
 * code. Measured before settling for it: matching the leftovers by release date
 * and card count against the 38 unclaimed Limitless sets resolved 0 of them —
 * the sets are genuinely absent, not merely misnamed.
 *
 * ONE FUNCTION, FOR THE SAME REASON `lib/pokemon-image.ts` IS ONE FUNCTION.
 * This rule was inline in four files (the search page twice, the scan lookup,
 * the card view) and improving it meant finding all four. It does not any more.
 */

/** Their code for a Japanese set -> their English name. Built once per process. */
let englishNames: Map<string, string> | undefined;

function namesForJapanese(): Map<string, string> {
  if (!englishNames) {
    englishNames = new Map(limitlessSets("ja").map((set) => [set.code, set.name]));
  }
  return englishNames;
}

/**
 * The set's display name.
 *
 * `(JP)` stays on the Japanese ones even when a real name is found, because
 * "Stellar Miracle" and "Stellar Crown" are different products and a reader
 * choosing between them needs to know which side of the ocean they are on.
 */
export function pokemonSetLabel(set: CatalogSet): string {
  if ((set.language ?? "en") !== "ja") return set.name;

  const code = limitlessCode(set, "ja");
  const english = code ? namesForJapanese().get(code) : undefined;
  if (english) return `${english} (JP)`;

  // No English name published anywhere. The code is not a good label, but it is
  // an honest one — and it is what a Japanese card's number is printed against,
  // so it is at least the thing a reader could look up.
  return `${set.id} (JP)`;
}

/**
 * The short form, for a card tile where the set is context rather than the
 * subject and a long name would push the card's own name out of the row.
 */
export function pokemonSetShortLabel(set: CatalogSet): string {
  if ((set.language ?? "en") !== "ja") return set.name;
  return `${set.id} (JP)`;
}

/** Does this set have a real name, or only a code? For pages that want to say so. */
export function hasPublishedName(set: CatalogSet): boolean {
  if ((set.language ?? "en") !== "ja") return true;
  const code = limitlessCode(set, "ja");
  return Boolean(code && namesForJapanese().get(code));
}

/**
 * The English name of a Japanese SERIES — the era heading a set groups under.
 *
 * A CLOSED LIST, WHICH IS WHY IT IS A TABLE. The Japanese catalogue uses
 * fifteen series names and eight of them are Japanese text. These are not
 * translations invented here: each names a product line that The Pokemon
 * Company itself released internationally under the English name given, and
 * `剣と盾` IS Sword & Shield in the same way that `S9` IS Star Birth. Enumerated
 * from the corpus rather than guessed, so the list is complete as of the
 * catalogue it was read from — a series that appears later falls through and
 * keeps its own name, which is visible rather than silently mislabelled.
 *
 * The alternative was leaving kana in the era filter, and the rule on this site
 * is that no annotation is Japanese: a reader who cannot type kana cannot
 * search for it.
 */
const JAPANESE_SERIES: Record<string, string> = {
  "剣と盾": "Sword & Shield",
  "サン＆ムーン": "Sun & Moon",
  "ポケモンカードゲーム スカーレット&バイオレット": "Scarlet & Violet",
  "ポケモンカードゲーム MEGA": "Mega Evolution",
  "ポケットモンスターカードゲーム": "Pokémon Card Game",
  "ポケモンカードe": "Pokémon-e",
  "ポケモンカード★neo": "Neo",
};

export function pokemonSeriesLabel(set: CatalogSet): string {
  const raw = set.serie?.name?.trim();
  if (!raw) {
    // 197 Japanese sets carry no series at all — decks, promos and campaign
    // products the source never filed under one. "Other" is what they are.
    return "Other";
  }
  if ((set.language ?? "en") !== "ja") return raw;
  return JAPANESE_SERIES[raw] ?? raw;
}
