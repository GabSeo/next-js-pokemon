import { getGradedMarketData } from "@/lib/graded-market";
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

export type GradedCell = {
  /** Median asking price of live listings. Absent when eBay returned none that were real. */
  median?: number;
  currency?: string;
  /**
   * How many live listings the median rests on.
   *
   * SHOWN, NOT HIDDEN. A median of two asks is not a market, and a reader given
   * a bare figure has no way to tell that from a median of sixty. It is the
   * difference between a price and an anecdote.
   */
  count?: number;
};

export type GradedRow = {
  /** "PSA 10", "PSA 9", "PSA 8", "Raw". */
  condition: string;
  /** Keyed by language — "English", "Japanese". */
  cells: Record<string, GradedCell>;
};

export type GradedFacts = {
  /** The languages that produced at least one reading, in column order. */
  languages: string[];
  /** One row per condition tier, in the order graded-market.ts queries them. */
  rows: GradedRow[];
  /**
   * Raw to PSA 10, as a multiple, per language.
   *
   * A MULTIPLE RATHER THAN A PERCENTAGE, because the reader is comparing two
   * prices they can both see in the table. "4.2x" is read instantly; "320%" has
   * to be unpacked and half of readers unpack it wrong.
   *
   * It is NOT a recommendation and the prompt forbids presenting it as one:
   * grading costs money and takes months, and neither is in this figure.
   */
  psa10Multiple: Record<string, number>;
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

/**
 * The eBay market that belongs to the card in the reader's hand.
 *
 * ONE LANGUAGE, NEVER BOTH, and the reason is the same one that governs every
 * other price on this screen. A Japanese print and its English release are
 * different objects trading in different markets; showing both columns beside a
 * card that is only one of them offers a figure that does not describe anything
 * the reader owns, and the person holding it has no way to know which column is
 * theirs.
 *
 * It was built with both columns because the tracked-card panel shows both —
 * which is right THERE, where the page is a market overview and the comparison
 * is the point. Here the card is already identified and the comparison is noise.
 *
 * THE `ja~` PREFIX IS THE AUTHORITY for Pokemon, because lib/card-view.ts puts
 * it there when it resolves a Japanese card and it survives every hop. One Piece
 * carries no such marker, so the caller's own choice decides — the rail's EN/JP
 * toggle, which is the only thing that knows.
 */
function marketLanguage(card: CardView, chosen?: "en" | "ja"): string {
  if (card.code.startsWith("ja~")) return "Japanese";
  if (card.tcg === "onepiece" && chosen === "ja") return "Japanese";
  return "English";
}

export async function gradedFactsFor(
  card: CardView,
  /** The rail's language toggle. Only consulted where the code cannot say. */
  chosen?: "en" | "ja"
): Promise<GradedFacts | undefined> {
  const data = await getGradedMarketData(asTrackedCard(card)).catch(() => undefined);
  if (!data) return undefined;

  // NOTE ON COST: graded-market.ts queries both languages internally, so this
  // filters rather than saves the calls. Narrowing the query itself would mean
  // changing a module the tracked-card pages depend on, and halving eight eBay
  // searches is not worth that risk today — it is written here so the next
  // person sees the saving is available rather than absent.
  const wanted = marketLanguage(card, chosen);

  const languages: string[] = [];
  const rows: GradedRow[] = [];

  for (const condition of data.conditions) {
    const cells: Record<string, GradedCell> = {};
    for (const entry of condition.languages) {
      if (entry.language !== wanted) continue;
      // ONLY REAL LISTINGS. graded-market.ts falls back to illustrative preview
      // figures when eBay returns nothing, which is right for a panel labelled
      // as a preview and wrong for anything a model will read or a table will
      // present as a market reading.
      const active = entry.active;
      if (!active?.isReal || !(active.medianPrice > 0)) continue;
      cells[entry.language] = {
        median: active.medianPrice,
        currency: active.currency,
        count: active.count,
      };
      if (!languages.includes(entry.language)) languages.push(entry.language);
    }
    // A tier nobody is selling in either language is left out entirely rather
    // than shown as an empty row — the table is evidence, and a row of dashes
    // is not evidence of anything.
    if (Object.keys(cells).length > 0) rows.push({ condition: condition.condition, cells });
  }

  if (rows.length === 0) return undefined;

  const psa10 = rows.find((row) => row.condition === "PSA 10");
  const raw = rows.find((row) => row.condition === "Raw");
  const psa10Multiple: Record<string, number> = {};
  for (const language of languages) {
    const ten = psa10?.cells[language]?.median;
    const bare = raw?.cells[language]?.median;
    if (ten !== undefined && bare !== undefined && bare > 0) {
      psa10Multiple[language] = Number((ten / bare).toFixed(1));
    }
  }

  return {
    languages,
    rows,
    psa10Multiple,
    note:
      `Median asking price of live eBay listings for the ${wanted} print — what sellers want today, not what ` +
      "anything sold for. The count is how many listings each median rests on.",
  };
}
