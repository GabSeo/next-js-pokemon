import type { CatalogCard, CatalogSet } from "@/lib/catalog";
import { limitlessImageUrl, limitlessLargeUrl, limitlessSet } from "@/lib/limitless";
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
  if (!limitless) return undefined;

  // THEIR TWO SIZES ARE 274x381 (59 KB) AND 600x838 (144 KB), and the switch
  // sits at 320 rather than at 274 on purpose. A grid tile asks for 320 and
  // renders nearer 180; serving the large file there costs 2.4x the bytes for
  // an upscale nobody can see — 16 MB against 6.7 MB on a 113-card set page.
  // The card page asks for 480, where the detail is actually looked at.
  return width > 320 ? limitlessLargeUrl(limitless) : limitless;
}

/**
 * The mark shown on a set's tile — its logo, or failing that its symbol.
 *
 * WHY A SECOND SOURCE IS NEEDED HERE TOO. TCGdex publishes a logo for 146 of
 * 203 English sets and for ZERO of 381 Japanese ones, so listing the Japanese
 * catalogue turned the browse page into a wall of lettered squares. Limitless
 * carries a symbol for all 414 sets it holds, at about 1.5 KB each.
 *
 * A SYMBOL IS NOT A LOGO, and the difference is worth stating rather than
 * hiding: TCGdex's is a wordmark that fills a tile, Limitless's is the small
 * expansion mark printed on the card itself. The tile renders whichever it
 * gets. A set's own mark beats its initials; it does not beat its wordmark,
 * which is why TCGdex still goes first.
 */
export function pokemonSetLogo(set: CatalogSet): { url: string; kind: "logo" | "symbol" } | undefined {
  // TCGdex serves this as a bare URL with the extension appended by the caller;
  // `.webp` is 40 KB against `logo.png`'s 131 KB.
  if (set.logo) return { url: `${set.logo}.webp`, kind: "logo" };

  const language = (set.language ?? "en") === "ja" ? "ja" : "en";
  const symbol = limitlessSet(set, language)?.symbol;
  return symbol ? { url: symbol, kind: "symbol" } : undefined;
}
