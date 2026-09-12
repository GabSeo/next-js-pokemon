import type { CatalogCard, CatalogSet } from "@/lib/catalog";
import { limitlessMatch, type LimitlessLanguage } from "@/lib/limitless";

/**
 * The number as it is PRINTED on the card — `074/073`, not `swsh3.5-74`.
 *
 * WHY IT IS WORTH DERIVING. `swsh3.5-74` is our address for a card; the corner
 * of the card says `074/073`, and those are not the same fact. The printed form
 * is what a collector reads, what the scanner's reader looks for, and — for a
 * secret rare — the thing that says so: a numerator above the denominator is
 * the whole signal, and it is invisible in an internal id.
 *
 * THE HARD PART IS THE PADDING, and the catalogue does not carry it. TCGdex
 * stores `localId: "74"` for this card; 17,490 of the English cards are stored
 * unpadded and the 4,450 that are not are a different era's convention. Pokemon
 * itself is inconsistent by design — Base Set 2 prints `4/130` and Champion's
 * Path prints `074/073` — so there is no rule to apply, only a fact to look up.
 *
 * LIMITLESS CARRIES THAT FACT, in its filenames rather than its data:
 *
 *   Champion's Path   CPA_001_R_EN_SM.png   padded to three
 *   Base Set 2        1.png                 bare
 *   Fossil            1.png                 bare
 *
 * Their file naming tracks the printed convention era by era, so the width of
 * the number in the URL is the width the card uses. That is the only place in
 * anything on disk here where the padding survives.
 *
 * IT DEGRADES RATHER THAN GUESSES. A set Limitless does not cover returns the
 * number unpadded, which is right far more often than a padded guess would be —
 * most sets ever printed do not pad — and a card with no set total returns just
 * the number rather than inventing a denominator.
 *
 * FREE: two files already on disk, no network, no quota.
 */

/** `CPA_074_R_EN_SM.png` -> `074`. Their older sets are just `4.png`. */
function widthFromFilename(url: string, number: string): number {
  const file = url.split("/").pop() ?? "";
  // Their modern scheme is CODE_NNN_RARITY_LANG_SIZE.png; the older one is
  // NNN.png. Both end up as a run of digits that is the number itself.
  for (const run of file.match(/\d+/g) ?? []) {
    if (Number(run) === Number(number)) return run.length;
  }
  return number.length;
}

/**
 * The printed number, or undefined when there is nothing better to show than
 * what the caller already has.
 *
 * Returns `074/073` where the total is known, `074` where it is not.
 */
export function printedNumber(
  card: CatalogCard,
  set: CatalogSet,
  language: LimitlessLanguage = "en"
): string | undefined {
  const raw = String(card.localId ?? "").trim();
  if (!raw) return undefined;

  // A LETTER-PREFIXED NUMBER IS ALREADY THE PRINTED FORM. `GG30` is printed
  // `GG30/GG70`, and padding it would be wrong — those subsets do not pad.
  const subset = /^([A-Za-z]{1,4})(\d{1,3})$/.exec(raw);
  const total = set.cardCount?.official;
  if (subset) {
    return total ? `${raw}/${subset[1]}${total}` : raw;
  }

  if (!/^\d+$/.test(raw)) return raw;

  // The width Limitless prints it at, which is the width the card does.
  const match = limitlessMatch({ id: set.id, name: set.name, abbreviation: set.abbreviation }, raw, language);
  const width = match?.url ? widthFromFilename(match.url, match.number) : raw.length;

  const numerator = raw.padStart(width, "0");
  if (!total) return numerator;
  // THE DENOMINATOR TAKES THE SAME WIDTH. A card printed `074` is printed over
  // `073`, never over `73` — the two halves of a printed number always match.
  return `${numerator}/${String(total).padStart(width, "0")}`;
}
