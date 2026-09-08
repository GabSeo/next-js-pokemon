import type { CatalogCard } from "@/lib/catalog";
import { japaneseEnglishLabel } from "@/lib/pokemon-ja-official";
import { speciesInJapaneseName, speciesName } from "@/lib/pokemon-species";

/**
 * The Latin label for a Pokemon card. EVERY label on this site is Latin.
 *
 * TCGdex romanises SOME Japanese card names and not others — `Gengar Ex` for
 * PCG1-048, `ナゾノクサ` for SV4a-001 — so a Japanese card read as Japanese
 * about half the time. Nothing here translates anything; it looks things up.
 *
 * FOUR SOURCES, in order of how much they know:
 *
 *   1. the catalogue, when the name is already Latin
 *   2. the species from the card's National Pokedex number, which is the same
 *      integer in every language and which TCGdex publishes on Japanese cards.
 *      76% of the Japanese catalogue carries one
 *   3. the official Japanese data's own English label, for sets TCGdex gives no
 *      dex number for
 *   4. the card's KIND and number — `Trainer 023`. Trainers and Energy depict
 *      no Pokemon, so there is no dex to look up and nothing free and legal
 *      names them in English without translating the card. That is not the
 *      card's name and does not pretend to be; printing `アクア団のしたっぱ` on
 *      an English-language page would be worse.
 *
 * Measured 2026-09-08: 12,781 of 12,781 Japanese cards get a Latin label.
 *
 * The suffix (`ex`, `VMAX`) is written in Latin on the card itself, so it is
 * carried across from the Japanese name rather than invented.
 */

const JAPANESE_SCRIPT = /[぀-ゟ゠-ヿ一-鿿]/;
/**
 * The mechanic a card carries, written in Latin even on a Japanese face.
 *
 * Matched case-insensitively and then CANONICALISED, because the same mechanic
 * is spelled three ways across the catalogues — `EX`, `ex` and `Ex` all appear,
 * and an exact-case list silently dropped the third: `Aggron Ex` came out as
 * plain `Aggron`.
 */
const SUFFIX = /(?<![A-Za-z])(?:VMAX|VSTAR|V-UNION|BREAK|LEGEND|GX|EX|V)(?![A-Za-z])/gi;

/** `ex` lower-case is the modern spelling; the rest are upper. */
const CANONICAL: Record<string, string> = {
  ex: "ex",
  gx: "GX",
  v: "V",
  vmax: "VMAX",
  vstar: "VSTAR",
  "v-union": "V-UNION",
  break: "BREAK",
  legend: "LEGEND",
};

function suffixesOf(name: string): string[] {
  const found = (name.match(SUFFIX) ?? []).map((token) => CANONICAL[token.toLowerCase()] ?? token);
  return [...new Set(found)];
}

export function latinCardLabel(card: CatalogCard, setId: string, japanese = true): string {
  // English cards are named by their own catalogue and nothing else.
  if (!japanese) return card.name;

  // THE SPECIES WINS ON A JAPANESE CARD, even when the catalogue already spells
  // the name in Latin. TCGdex's Latin spellings on that side are unreliable
  // where they exist at all — `aipom` in lower case, `a` for a card whose name
  // did not survive — and a card labelled `a` is worse than one labelled from
  // its Pokedex number. The catalogue name is kept only when nothing else can
  // name the card.
  const species = speciesName(card.dexId);
  if (species) {
    const suffixes = suffixesOf(card.name);
    return suffixes.length > 0 ? `${species} ${suffixes.join(" ")}` : species;
  }

  // TCGdex publishes no dex for 450 Japanese cards, and the official data has
  // none for them either — but the species is still written in the name.
  const named = speciesInJapaneseName(card.name);
  if (named) {
    const suffixes = suffixesOf(card.name);
    const mega = /^mega|^メガ/i.test(card.name) ? "M " : "";
    return `${mega}${named}${suffixes.length > 0 ? ` ${suffixes.join(" ")}` : ""}`;
  }

  const official = japaneseEnglishLabel(setId, card.localId);
  if (official) return official;

  // Nothing named it. A Latin name from the catalogue, however scruffy, still
  // beats a category — but a Japanese one does not.
  if (!JAPANESE_SCRIPT.test(card.name)) return card.name;

  const kind = card.category?.trim();
  return kind ? `${kind} ${card.localId}` : card.localId;
}
