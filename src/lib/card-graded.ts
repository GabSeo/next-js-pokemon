import { getGradedMarketData, GRADED_MARKET_CONDITIONS } from "@/lib/graded-market";
import type { CardView } from "@/lib/card-view";
import type { Card } from "@/lib/types";

/**
 * What a card is actually asking on eBay right now — graded and raw, in both
 * languages.
 *
 * THE THIRD KIND OF PRICE, and the one a collector reaches for first. The
 * catalogue snapshot says what a loose copy averages on Cardmarket. This says
 * what people are asking TODAY, and — the part no catalogue can give — what the
 * same card asks once it is in a PSA 10 slab. The gap between those two numbers
 * is the single figure that decides whether a card is worth grading, and it is
 * invisible in every other panel this product has.
 *
 * BOTH LANGUAGES, WHICH IS WHY THIS MATTERS MORE THAN IT LOOKS. A Japanese
 * print is a different object with a different market, and our own price
 * snapshot covers English only. For a Japanese card this is not a third opinion
 * — it is the first one.
 *
 * NOTHING NEW IS BUILT HERE. lib/graded-market.ts already resolves exactly this
 * for tracked cards: four condition tiers, two languages, real active listings
 * with medians. It wants a `Card`, which is the tracked-card shape, so this
 * adapts a scanned catalogue card into the handful of fields its eBay queries
 * actually read — measured from the source: character, number, franchise, slug,
 * and the price fields, nothing else.
 *
 * THE SLUG IS THE CACHE KEY, so passing the catalogue code means one scanned
 * card resolves once and is reused. That matters: a resolution is up to eight
 * eBay searches (four tiers times two languages), against a budget of 1,200 a
 * day — about 150 cards. Behind a button and a cache that is comfortable; fired
 * automatically it would not be.
 *
 * IT IS ALLOWED TO RETURN NOTHING. No eBay credentials on the deployment, an
 * open circuit breaker, a card nobody is selling — all of it resolves to
 * undefined and the sheet simply lacks the field, which the prompt already
 * handles as an absence like any other.
 */

export type GradedFigure = {
  /** "English" or "Japanese". */
  language: string;
  /** Median asking price of live listings, or absent when eBay returned none. */
  psa10?: number;
  raw?: number;
  currency?: string;
  /**
   * What grading would gain, as a multiple of the raw price.
   *
   * A MULTIPLE RATHER THAN A PERCENTAGE, because the reader is comparing two
   * prices they can both see. "4.2x" is read instantly; "320%" has to be
   * unpacked, and half of readers will unpack it wrong.
   *
   * It is NOT a recommendation and the prompt forbids presenting it as one:
   * grading costs money and takes months, and neither is in this figure.
   */
  psa10Multiple?: number;
};

/** How many listings each median rests on — a median of two asks is not a market. */
export type GradedFacts = {
  figures: GradedFigure[];
  /** Live eBay asking prices, not sales. Said plainly because the two are often confused. */
  note: string;
};

/**
 * The minimum `Card` the eBay queries read.
 *
 * Everything absent here is genuinely unread by graded-market.ts's search path —
 * checked field by field rather than assumed, because a plausible-looking
 * placeholder in a field that IS read would produce confident results for the
 * wrong card.
 */
function asTrackedCard(card: CardView): Card {
  const print = card.prints[0];
  const eur = print?.price?.cardmarket?.avg;
  const usd = print?.price?.tcgplayer?.market;
  // `code` is `ja~SM12a-052` for Japanese Pokemon; the number the search wants
  // is the printed one, which is the tail.
  const bare = card.code.slice(card.code.lastIndexOf("-") + 1);

  return {
    id: card.code,
    slug: card.code,
    franchise: card.tcg === "onepiece" ? "onepiece" : "pokemon",
    name: card.name,
    character: card.name,
    set: print?.origin ?? "",
    number: card.tcg === "onepiece" ? card.code : bare,
    currency: eur !== undefined ? "EUR" : "USD",
    currentPrice: eur ?? usd ?? 0,
    priceUnavailable: eur === undefined && usd === undefined,
    asOfDate: new Date().toISOString(),
    priceHistory: [],
    recentSnapshots: [],
    trend: { avg1: 0, avg7: 0, avg30: 0 },
    priceRange: null,
    imageUrl: print?.image,
  } as unknown as Card;
}

export async function gradedFactsFor(card: CardView): Promise<GradedFacts | undefined> {
  const data = await getGradedMarketData(asTrackedCard(card)).catch(() => undefined);
  if (!data) return undefined;

  const psa10 = data.conditions.find((c) => c.condition === "PSA 10");
  const raw = data.conditions.find((c) => c.condition === "Raw");
  if (!psa10 && !raw) return undefined;

  const languages = new Set<string>();
  for (const condition of [psa10, raw]) {
    for (const entry of condition?.languages ?? []) languages.add(entry.language);
  }

  const figures: GradedFigure[] = [];
  for (const language of languages) {
    // ONLY REAL LISTINGS. graded-market.ts falls back to illustrative preview
    // figures when eBay returns nothing, which is right for a panel labelled as
    // a preview and wrong for anything a model will read: an estimate presented
    // as a market reading is exactly the confident wrongness this whole feature
    // is built to avoid.
    const ten = psa10?.languages.find((l) => l.language === language)?.active;
    const bare = raw?.languages.find((l) => l.language === language)?.active;
    const tenPrice = ten?.isReal && ten.medianPrice > 0 ? ten.medianPrice : undefined;
    const rawPrice = bare?.isReal && bare.medianPrice > 0 ? bare.medianPrice : undefined;
    if (tenPrice === undefined && rawPrice === undefined) continue;

    figures.push({
      language,
      psa10: tenPrice,
      raw: rawPrice,
      currency: ten?.currency ?? bare?.currency,
      psa10Multiple:
        tenPrice !== undefined && rawPrice !== undefined && rawPrice > 0
          ? Number((tenPrice / rawPrice).toFixed(1))
          : undefined,
    });
  }

  if (figures.length === 0) return undefined;

  return {
    figures,
    note:
      "Median asking price of live eBay listings — what sellers want today, not what anything sold for. " +
      `Tiers read: ${GRADED_MARKET_CONDITIONS.join(", ")}.`,
  };
}
