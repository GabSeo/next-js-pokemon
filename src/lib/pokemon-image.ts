import type { CatalogCard, CatalogSet } from "@/lib/catalog";
import { limitlessImageUrl, limitlessLargeUrl } from "@/lib/limitless";
import { japaneseImageUrl } from "@/lib/pokemon-ja-official";

/**
 * Where a Pokemon card's picture comes from. The only place that decides.
 *
 * WHY IT IS ONE FUNCTION AND NOT THREE. It was three: the card page, the search
 * grid and the scan lookup each carried their own copy of "TCGdex, else the
 * official Japanese site". Adding Limitless as a third source would have meant
 * editing all three and remembering to, which is precisely how the `&w=320` bug
 * shipped twice — a rule held in more than one place is a rule that will
 * disagree with itself. A fourth source should be a change to this file alone.
 *
 * THE ORDER IS BY WHO OWES US NOTHING:
 *
 *   1  TCGdex        an asset CDN with no ceiling, pictures 39,000 of 44,985
 *   2  the official  the Japanese publisher's own site, +15,609 Japanese cards
 *      Japanese data
 *   3  Limitless     +2,521 cards nothing else pictures at all — Crown Zenith's
 *                    Galarian Gallery, SM Black Star Promos, and the whole
 *                    2025-26 Japanese Mega block
 *
 * UNDEFINED IS A REAL ANSWER, and the reason the fallbacks stop rather than
 * degrade: 2,464 cards are pictured nowhere public. Showing a blank beats
 * showing a different card's artwork, which is a confident lie.
 */
export function pokemonImageUrl(
  card: CatalogCard,
  set: CatalogSet,
  width: number
): string | undefined {
  if (card.image) {
    // TCGdex serves quality tiers, not pixel widths. `low` is roughly 245px
    // wide and `high` roughly 600 — anything painted above a thumbnail wants
    // the larger one.
    return `${card.image}/${width > 320 ? "high" : "low"}.webp`;
  }

  const japanese = (set.language ?? "en") === "ja";
  if (japanese) {
    const official = japaneseImageUrl(set.id, card.localId, width);
    if (official) return official;
  }

  const limitless = limitlessImageUrl(set, card.localId, japanese ? "ja" : "en");
  // Their thumbnail is 274 wide; past that, the full-size file is the same
  // picture at 274x381 -> 600x838.
  return limitless ? (width > 274 ? limitlessLargeUrl(limitless) : limitless) : undefined;
}
