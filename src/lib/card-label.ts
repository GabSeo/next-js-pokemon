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
const SUFFIX = /(?:VMAX|VSTAR|V-UNION|BREAK|LEGEND|GX|EX|ex|V)/g;

export function latinCardLabel(card: CatalogCard, setId: string): string {
  if (!JAPANESE_SCRIPT.test(card.name)) return card.name;

  const species = speciesName(card.dexId);
  if (species) {
    const suffixes = [...new Set(card.name.match(SUFFIX) ?? [])];
    return suffixes.length > 0 ? `${species} ${suffixes.join(" ")}` : species;
  }

  // TCGdex publishes no dex for 450 Japanese cards, and the official data has
  // none for them either — but the species is still written in the name.
  const named = speciesInJapaneseName(card.name);
  if (named) {
    const suffixes = [...new Set(card.name.match(SUFFIX) ?? [])];
    const mega = /^mega|^メガ/i.test(card.name) ? "M " : "";
    return `${mega}${named}${suffixes.length > 0 ? ` ${suffixes.join(" ")}` : ""}`;
  }

  const official = japaneseEnglishLabel(setId, card.localId);
  if (official) return official;

  const kind = card.category?.trim();
  return kind ? `${kind} ${card.localId}` : card.localId;
}
