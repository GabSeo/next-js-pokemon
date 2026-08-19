import { cache } from "react";
import { cardRefs, type CardRef } from "@/data/card-refs";
import {
  findProductByCode,
  findProductByNameAndSet,
  getHistoryPrices,
  type ApitcgProduct,
} from "@/lib/apitcg";
import { absoluteUrl } from "@/lib/site";
import type {
  AlertBand,
  Card,
  Franchise,
  PriceHistoryPoint,
  PriceRange,
  PriceSnapshot,
  PriceTrend,
} from "@/lib/types";

// How many daily records to ask apitcg for per card. Kept modest for a
// prototype — priceRange is computed over whatever this actually returns,
// and computePriceRange() reports the real from/to bounds of that window
// rather than implying a longer (e.g. 1-year) history than we're fetching.
const HISTORY_LOOKBACK_LIMIT = 100;

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

/** Average price over the trailing N days of real daily history. */
function averageOverLastDays(history: PriceHistoryPoint[], days: number): number | null {
  if (history.length === 0) return null;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const window = history.filter((p) => p.date >= cutoffStr);
  const pool = window.length > 0 ? window : history.slice(-1);
  const sum = pool.reduce((total, p) => total + p.price, 0);
  return Math.round((sum / pool.length) * 100) / 100;
}

function computeTrend(history: PriceHistoryPoint[]): PriceTrend {
  return {
    day1: averageOverLastDays(history, 1),
    day7: averageOverLastDays(history, 7),
    day30: averageOverLastDays(history, 30),
    day90: averageOverLastDays(history, 90),
  };
}

/** Low/high over the full history array. Assumes `history` is sorted ascending by date. */
function computePriceRange(history: PriceHistoryPoint[]): PriceRange | null {
  if (history.length === 0) return null;
  let low = history[0];
  let high = history[0];
  for (const point of history) {
    if (point.price < low.price) low = point;
    if (point.price > high.price) high = point;
  }
  return {
    low: low.price,
    high: high.price,
    lowDate: low.date,
    highDate: high.date,
    from: history[0].date,
    to: history[history.length - 1].date,
  };
}

function marketPrice(markets: ApitcgProduct["markets"]): number | undefined {
  const prices = markets?.tcgplayer?.prices;
  return prices?.market ?? prices?.mid ?? prices?.low;
}

async function resolveProduct(ref: CardRef): Promise<ApitcgProduct | undefined> {
  if (ref.lookup.by === "code") {
    return findProductByCode(ref.tcg, ref.lookup.code);
  }
  return findProductByNameAndSet(
    ref.tcg,
    ref.lookup.name,
    ref.lookup.setName,
    ref.lookup.number
  );
}

async function resolveCard(ref: CardRef): Promise<Card | undefined> {
  const product = await resolveProduct(ref);
  if (!product) return undefined;

  const currentPrice = marketPrice(product.markets) ?? 0;
  const history = await getHistoryPrices(product._id, HISTORY_LOOKBACK_LIMIT).catch(() => []);

  const sortedAsc = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const priceHistory: PriceHistoryPoint[] = sortedAsc
    .map((h) => {
      const price = marketPrice(h.markets);
      return price === undefined ? null : { date: h.date.slice(0, 10), price };
    })
    .filter((p): p is PriceHistoryPoint => p !== null);

  const recentSnapshots: PriceSnapshot[] = [...priceHistory]
    .reverse()
    .slice(0, 10)
    .map((p) => ({
      date: p.date,
      price: p.price,
      source: "TCGPlayer",
      sourceUrl: product.markets?.tcgplayer?.url,
    }));

  const rawDescription = product.attributes?.Description;

  return {
    id: String(product._id),
    slug: ref.slug,
    franchise: ref.franchise,
    name: product.name,
    set: product.set?.name ?? "",
    setCode: product.set?.code,
    number: product.attributes?.Number ?? product.code,
    rarity: product.attributes?.Rarity,
    currency: "USD",
    currentPrice,
    asOfDate: (product.updatedAt ?? new Date().toISOString()).slice(0, 10),
    priceHistory,
    recentSnapshots,
    trend: computeTrend(priceHistory),
    priceRange: computePriceRange(priceHistory),
    imageUrl: product.images?.[0]?.large ?? product.images?.[0]?.medium,
    sourceUrl: product.markets?.tcgplayer?.url,
    description: rawDescription ? stripHtml(rawDescription) : undefined,
  };
}

/**
 * cache()-wrapped so every caller resolving the same ref within one request
 * shares a single in-flight/completed attempt — including a *failed* one.
 * Confirmed via production logs: a product page's generateMetadata and its
 * page body both call getCardBySlug(slug) independently, and plain fetch()
 * memoization doesn't reliably collapse that pair when the underlying call
 * is erroring (a 429 from apitcg, in the log that prompted this), so a
 * single visit was making two real apitcg requests instead of one. cache()
 * keys on the `ref` object itself, which is safe here because every caller
 * gets it from the same module-level `cardRefs` array (same object
 * reference for the same slug every time), not a freshly constructed one.
 */
const resolveCardSafe = cache(async (ref: CardRef): Promise<Card | undefined> => {
  try {
    const card = await resolveCard(ref);
    if (!card) {
      console.error(`[cards] no apitcg match for ${ref.slug} (${JSON.stringify(ref.lookup)})`);
    }
    return card;
  } catch (err) {
    console.error(`[cards] failed to resolve ${ref.slug}:`, err);
    return undefined;
  }
});

export async function getAllCards(): Promise<Card[]> {
  const cards = await Promise.all(cardRefs.map(resolveCardSafe));
  return cards.filter((c): c is Card => c !== undefined);
}

export async function getCardsByFranchise(franchise: Franchise): Promise<Card[]> {
  const refs = cardRefs.filter((r) => r.franchise === franchise);
  const cards = await Promise.all(refs.map(resolveCardSafe));
  return cards.filter((c): c is Card => c !== undefined);
}

export async function getCardBySlug(slug: string): Promise<Card | undefined> {
  const ref = cardRefs.find((r) => r.slug === slug);
  if (!ref) return undefined;
  return resolveCardSafe(ref);
}

/**
 * Single-card lookup by apitcg numeric id OR slug, without resolving the
 * rest of the franchise. Slugs are known upfront (in cardRefs), so that
 * case resolves just the one matching ref (2 apitcg calls). The apitcg id
 * is only known *after* resolving a card, so an id lookup still has to scan
 * — but slug is the key every internal link/API route actually uses, so
 * this keeps the common case cheap instead of always paying for the whole
 * franchise like a plain `getCardsByFranchise(...).find(...)` would.
 */
export async function getCardByIdOrSlug(
  franchise: Franchise,
  idOrSlug: string
): Promise<Card | undefined> {
  const bySlug = cardRefs.find((r) => r.franchise === franchise && r.slug === idOrSlug);
  if (bySlug) return resolveCardSafe(bySlug);

  const cards = await getCardsByFranchise(franchise);
  return cards.find((c) => c.id === idOrSlug);
}

export async function getCardById(id: string): Promise<Card | undefined> {
  const cards = await getAllCards();
  return cards.find((c) => c.id === id);
}

export async function findCard(query: string): Promise<Card | undefined> {
  const q = query.trim().toLowerCase();

  // Fast path: query matches a statically-known slug — resolve just that
  // one card (2 apitcg calls) instead of the whole catalog.
  const bySlug = cardRefs.find((r) => r.slug.toLowerCase() === q);
  if (bySlug) return resolveCardSafe(bySlug);

  // Slow path: query only matches a resolve-time field (live apitcg id,
  // display name, or card number) — has to scan the full catalog.
  const cards = await getAllCards();
  return cards.find(
    (card) =>
      card.id.toLowerCase() === q ||
      card.slug.toLowerCase() === q ||
      card.name.toLowerCase() === q ||
      (card.number ?? "").toLowerCase() === q
  );
}

// -100% is the floor (price can't drop below $0); anything past that is
// meaningless, so the downside stops at -75%. Upside is uncapped, so it
// runs further, in the same 25% steps.
const ALERT_PCTS = [-75, -50, -25, 25, 50, 75, 100, 125, 150] as const;

export function computeAlertBands(basePrice: number): AlertBand[] {
  return ALERT_PCTS.map((pct) => ({
    pct,
    price: Math.max(0, Math.round(basePrice * (1 + pct / 100) * 100) / 100),
  }));
}

export function franchiseLabel(franchise: Franchise): string {
  return franchise === "pokemon" ? "Pokémon" : "One Piece";
}

export function toPublicCard(card: Card) {
  return {
    id: card.id,
    slug: card.slug,
    franchise: card.franchise,
    name: card.name,
    set: card.set,
    setCode: card.setCode,
    number: card.number,
    rarity: card.rarity,
    currency: card.currency,
    currentPrice: card.currentPrice,
    asOfDate: card.asOfDate,
    priceHistory: card.priceHistory,
    recentSnapshots: card.recentSnapshots,
    trend: card.trend,
    priceRange: card.priceRange,
    imageUrl: card.imageUrl,
    sourceUrl: card.sourceUrl,
    productUrl: absoluteUrl(`/products/${card.slug}`),
    markdownUrl: absoluteUrl(`/products/${card.slug}/index.md`),
  };
}
