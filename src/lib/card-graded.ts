import { getGradedMarketData, type GradedMarketSubject } from "@/lib/graded-market";
import { formatPrice } from "@/lib/format-price";
import type { ConditionEntry, TypeSummary } from "@/components/retro/graded-market-tabs";
import type { GradedMarketTypeData } from "@/lib/graded-market";
import type { CardView } from "@/lib/card-view";


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

/**
 * The graded market in the shape the tracked-card panel already renders.
 *
 * NOT A SECOND DESIGN. This screen grew its own little table — a median per
 * tier and nothing to click — while the tracked-card pages had tabs, an
 * active-versus-sold pair, the real listings with working links, and a
 * see-all button. Two designs for one market, and asked to stop being two:
 * "make sure the eBay functioning is the exact same as in the tracked cards,
 * since all our tests are positive there."
 *
 * So this builds `ConditionEntry[]` — components/retro/graded-market-tabs.tsx's
 * own input — and the scan renders that component. The only change the
 * component needed was for its rows to be DATA rather than rendered JSX, which
 * is what lets one panel serve a server page and a client fetch.
 *
 * ACTIVE AND SOLD, BOTH. The earlier version kept only the live asks, so the
 * one comparison a collector makes first — what people want against what
 * anything actually went for — was the thing missing.
 */
export type GradedFacts = {
  entries: ConditionEntry[];
  /** Raw-to-PSA-10 multiple per language, for the AI's shapes. Not rendered. */
  psa10Multiple: Record<string, number>;
};

/**
 * The minimum `Card` the eBay queries read.
 *
 * Everything absent here is genuinely unread by graded-market.ts's search path —
 * checked field by field rather than assumed, because a plausible-looking
 * placeholder in a field that IS read would produce confident results for the
 * wrong card.
 */
function subjectFor(card: CardView): GradedMarketSubject {
  const print = card.prints[0];
  const eur = print?.price?.cardmarket?.avg;
  const usd = print?.price?.tcgplayer?.market;
  // `code` is `ja~SM12a-052` for Japanese Pokemon; the number the search wants
  // is the printed one, which is the tail.
  const bare = card.code.slice(card.code.lastIndexOf("-") + 1);

  return {
    /**
     * THE PRINTING, NOT THE CARD. `OP09-061_p2` rather than `OP09-061`.
     *
     * The matcher resolves a photograph to a PRINTING, and that is a sharper
     * identity than the code: the code names four versions of one picture and
     * the eBay query has to say which. graded-market.ts reads this to look the
     * printing up by id and derive both halves of a real query — the clause
     * naming this version and the terms excluding its siblings. Everything else
     * that reads `id` uses it for log lines, where a printing is also the more
     * useful thing to see.
     */
    id: print?.key ?? card.code,
    slug: card.code,
    // `"one-piece"`, WITH THE HYPHEN — the Franchise union's own spelling. It
    // was written `"onepiece"` here, which is the CardView spelling, and the
    // `as unknown as Card` cast below let it through: every franchise branch in
    // graded-market.ts then took the Pokemon path for a One Piece card, which
    // is why the scan's eBay query never looked like the tracked pages'.
    franchise: card.tcg === "onepiece" ? "one-piece" : "pokemon",
    name: card.name,
    character: card.name,
    set: print?.origin ?? "",
    number: card.tcg === "onepiece" ? card.code : bare,
    /**
     * WHICH PRINTING, which is the field the whole eBay query hangs on.
     *
     * `deriveQueryForCard` reads this to find the card's row among its
     * siblings, and from there builds both halves of a real query: the positive
     * clause naming this version — `("2nd anniversary")` — and the negative
     * terms excluding the others — `-jumbo -emperors -uc -r -sr -sec`. Without
     * it the search asks for every printing of the code at once and reports
     * their prices as one market.
     *
     * The scan knows it wherever the printing is a NAMED promo — the resolver
     * returns this card's printings ranked by how much each looks like the
     * photo, and the first one's label is "2nd Anniversary Set" or "Jumbo".
     *
     * `label` ONLY, never `origin` as a fallback: a set code like "ST-26"
     * matches no row in the corpus and would be a worse guess than none. Bandai
     * records that a code has four printings and not which is the Alternate
     * Art — 0 of 945 multi-printing groups differ by name — so those keep the
     * broad query, which is the honest result rather than a wrong narrow one.
     */
    printName: card.tcg === "onepiece" ? print?.label : undefined,
    currency: eur !== undefined ? "EUR" : "USD",
    currentPrice: eur ?? usd ?? 0,
    priceUnavailable: eur === undefined && usd === undefined,
    // FIVE EMPTY FIELDS WERE HERE — asOfDate, priceHistory, recentSnapshots,
    // trend, priceRange — invented so a hand-built object would look like a
    // `Card`. None was ever read by anything this calls. They are gone with the
    // cast that demanded them.
    imageUrl: print?.image,
    rarity: print?.rarity,
  };
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

/**
 * One tier's figures, exactly as graded-market-panel.tsx maps them.
 *
 * KEPT IN STEP BY BEING THE SAME MAPPING, not by intention. If this drifts from
 * the panel's `toTypeSummary` the two screens quote different numbers for one
 * market, which is the failure this whole change exists to end.
 */
function toTypeSummary(data: GradedMarketTypeData): TypeSummary {
  return {
    // An empty tier has no median, and "USD 0" reads as a real price of zero
    // rather than an absence.
    avgLabel: data.noListings ? "—" : formatPrice(data.medianPrice, data.currency),
    medianPrice: data.medianPrice,
    currency: data.currency,
    count: data.count,
    rowCount: data.rows.length,
    isReal: data.isReal,
    noListings: data.noListings,
    seeAllHref: data.seeAllUrl,
    rows: data.noListings
      ? []
      : data.rows.map((row) => ({
          date: row.date,
          description: row.description,
          price: row.price,
          currency: row.currency,
          url: row.url,
        })),
  };
}

export async function gradedFactsFor(
  card: CardView,
  /** The rail's language toggle. Only consulted where the code cannot say. */
  chosen?: "en" | "ja"
): Promise<GradedFacts | undefined> {
  const data = await getGradedMarketData(subjectFor(card)).catch(() => undefined);
  if (!data) return undefined;

  const wanted = marketLanguage(card, chosen);

  const entries: ConditionEntry[] = [];
  for (const condition of data.conditions) {
    const languages = condition.languages
      .filter((entry) => entry.language === wanted)
      .map((entry) => ({
        language: entry.language,
        active: toTypeSummary(entry.active),
        sold: toTypeSummary(entry.sold),
      }));
    // A tier with no reading in the reader's own market is left out rather than
    // shown as a tab that opens on nothing.
    if (languages.length > 0) entries.push({ id: condition.condition, label: condition.condition, languages });
  }

  // ONLY REAL READINGS REACH THE PANEL. graded-market.ts falls back to
  // illustrative preview figures when eBay returns nothing, which is right for
  // a panel labelled as a preview and wrong here: this one sits under an answer
  // and beside an AI that will read it.
  const real = entries.filter((entry) => entry.languages.some((l) => l.active.isReal || l.sold.isReal));
  if (real.length === 0) return undefined;

  const psa10 = real.find((entry) => entry.id === "PSA 10");
  const raw = real.find((entry) => entry.id === "Raw");
  const psa10Multiple: Record<string, number> = {};
  for (const language of real[0].languages.map((l) => l.language)) {
    const ten = psa10?.languages.find((l) => l.language === language)?.active.medianPrice;
    const bare = raw?.languages.find((l) => l.language === language)?.active.medianPrice;
    if (ten && bare && bare > 0) psa10Multiple[language] = Number((ten / bare).toFixed(1));
  }

  return { entries: real, psa10Multiple };
}
