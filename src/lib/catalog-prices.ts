/**
 * TIER 2 for the catalogue — live prices for cards the corpus knows about.
 *
 * Separate from lib/catalog.ts on purpose. That module holds the invariant
 * that it cannot make a network call (it imports `node:fs` and nothing else);
 * this one is where a call is allowed to happen, so every crossing from
 * "what is this card" to "what is it worth" goes through an import of THIS
 * file and is greppable.
 *
 * COSTS NO METERED QUOTA. TCGdex is keyless and is not a bucket in
 * lib/api-budget.ts, unlike apitcg / PokéWallet / BerryWallet / eBay. That is
 * the only reason pricing a whole 120-card set on demand is reasonable at all
 * — the same page against any of the other four would be unthinkable.
 *
 * FRESHNESS IS ALREADY SOLVED, and not here. `getCard` goes through
 * tcgdexFetch, which sets `next: { revalidate: 60 * 60 * 24 }` — so a price is
 * at most 24 hours old and refreshes itself with no scheduled job, no snapshot
 * store and nothing to operate. Do not add a cache layer on top; it would only
 * make the real age of a figure harder to reason about.
 *
 * NO HISTORY, and it cannot be added from this source. TCGdex exposes trailing
 * `avg1 / avg7 / avg30` snapshots and no time series, so a price chart over an
 * arbitrary card is not available here at any price — the product-page chart
 * for the tracked cards comes from apitcg, which is metered at 1,000/month and
 * is exactly why that chart exists for 11 cards and not 23,546.
 *
 * Measured 2026-09-05: all 120 cards of `me05` (Pitch Black) priced in 1.23s
 * at concurrency 8, 100% coverage, zero metered quota.
 */
import { cardmarketPriceFields, type CatalogCard } from "@/lib/catalog";
import { getCard } from "@/lib/tcgdex";

/**
 * Bounded rather than firing one request per card at once.
 *
 * Not politeness alone: every one of these goes through resilientFetch, whose
 * circuit breaker opens after 4 consecutive failures against a host and is
 * shared with the tracked-card resolution path. 300 simultaneous requests into
 * a hiccuping TCGdex would trip that breaker and take card ART and the French
 * toggle down across the whole site — an unrelated blast radius for a set page
 * nobody may be looking at. 8 matches the crawler and measured 1.23s for 120.
 */
const CONCURRENCY = 8;

/** One printing's live figures. Every field optional: absent means the source had none, never zero. */
export type CatalogPrice = {
  /** Which printing these figures describe — "normal", "reverse", "holo". */
  variantType?: string;
  cardmarket?: {
    avg?: number;
    low?: number;
    trend?: number;
    avg1?: number;
    avg7?: number;
    avg30?: number;
    /** EUR, always — Cardmarket is never converted. */
    currency: "EUR";
  };
  tcgplayer?: {
    low?: number;
    mid?: number;
    high?: number;
    market?: number;
    /** USD, always. */
    currency: "USD";
  };
  /** TCGdex's own stamp on the price block, so the age of a figure is a fact rather than an assumption. */
  updated?: string;
};

/**
 * The printing a set grid should quote when it has room for exactly one price.
 *
 * `normal` when the card has one, otherwise the first variant. That is the
 * conventional headline — Cardmarket's own product page leads with the
 * unfoiled price for a card that exists unfoiled — and it is derived from the
 * card rather than guessed per set.
 *
 * It is a CHOICE, not a fact, which is why the chosen variant is returned on
 * every CatalogPrice: a grid that shows one number owes the reader which
 * printing it belongs to, especially when the reverse holo of the same card
 * trades at 4.5x (Venonat swsh12-001, measured).
 */
export function primaryVariantType(card: CatalogCard): string | undefined {
  return (card.variants.find((v) => v.type === "normal") ?? card.variants[0])?.type;
}

function readNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key];
  // `!= null` rather than `!== undefined`: these sources send explicit null for
  // a stat they have no data for, the same way BerryWallet does (see
  // lib/types.ts). Zero is discarded too — a Cardmarket average of exactly 0 is
  // an absent figure, not a free card.
  return typeof value === "number" && value !== 0 ? value : undefined;
}

/**
 * Live prices for one card, for the printing named by `variantType`.
 *
 * The Cardmarket half is the part that is not obvious: normal and reverse-holo
 * share ONE Cardmarket product and one price block, and are told apart by a
 * field SUFFIX inside it — see cardmarketPriceFields (lib/catalog.ts) for the
 * measurement and for why the suffix does not simply mean "holo".
 */
export async function getCatalogPrice(card: CatalogCard, variantType?: string): Promise<CatalogPrice | undefined> {
  const chosen = variantType ?? primaryVariantType(card);
  const full = await getCard(card.tcgdexId, "en").catch(() => undefined);
  if (!full) return undefined;

  const pricing = full.pricing;
  if (!pricing) return undefined;

  const { cardmarketSuffix, tcgplayerKey } = cardmarketPriceFields(card, chosen);

  const cm = pricing.cardmarket;
  const cardmarket = cm
    ? {
        avg: readNumber(cm, `avg${cardmarketSuffix}`),
        low: readNumber(cm, `low${cardmarketSuffix}`),
        trend: readNumber(cm, `trend${cardmarketSuffix}`),
        avg1: readNumber(cm, `avg1${cardmarketSuffix}`),
        avg7: readNumber(cm, `avg7${cardmarketSuffix}`),
        avg30: readNumber(cm, `avg30${cardmarketSuffix}`),
        currency: "EUR" as const,
      }
    : undefined;

  const tpBlock = pricing.tcgplayer?.[tcgplayerKey] as Record<string, unknown> | undefined;
  const tcgplayer = tpBlock
    ? {
        low: readNumber(tpBlock, "lowPrice"),
        mid: readNumber(tpBlock, "midPrice"),
        high: readNumber(tpBlock, "highPrice"),
        market: readNumber(tpBlock, "marketPrice"),
        currency: "USD" as const,
      }
    : undefined;

  // A block that resolved but carries no figure at all is an absence, not a
  // price of nothing — report it as such so a caller renders the stated gap.
  const hasAny =
    (cardmarket && Object.values(cardmarket).some((v) => typeof v === "number")) ||
    (tcgplayer && Object.values(tcgplayer).some((v) => typeof v === "number"));
  if (!hasAny) return undefined;

  return { variantType: chosen, cardmarket, tcgplayer, updated: cm?.updated ?? pricing.tcgplayer?.updated };
}

/**
 * Prices for many cards, at bounded concurrency — what a set page needs.
 *
 * Returns a Map keyed by `tcgdexId`. A card that could not be priced is simply
 * absent from the map rather than present with an empty value, so a caller
 * cannot accidentally render a zero.
 */
export async function getCatalogPrices(cards: CatalogCard[]): Promise<Map<string, CatalogPrice>> {
  const out = new Map<string, CatalogPrice>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cards.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= cards.length) return;
        const card = cards[index];
        const price = await getCatalogPrice(card).catch(() => undefined);
        if (price) out.set(card.tcgdexId, price);
      }
    })
  );
  return out;
}
