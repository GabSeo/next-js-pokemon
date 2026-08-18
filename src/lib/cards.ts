import { cardRefs, type CardRef } from "@/data/card-refs";
import {
  findProductByCode,
  findProductByNameAndSet,
  getHistoryPrices,
  type ApitcgProduct,
} from "@/lib/apitcg";
import { absoluteUrl } from "@/lib/site";
import type { AlertBand, Card, Franchise, PriceHistoryPoint, PriceSnapshot } from "@/lib/types";

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
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
  const history = await getHistoryPrices(product._id, 200).catch(() => []);

  const sortedAsc = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const priceHistory: PriceHistoryPoint[] = sortedAsc
    .map((h) => {
      const price = marketPrice(h.markets);
      return price === undefined ? null : { date: h.date.slice(0, 10), price };
    })
    .filter((p): p is PriceHistoryPoint => p !== null);

  const recentSnapshots: PriceSnapshot[] = [...priceHistory]
    .reverse()
    .slice(0, 8)
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
    imageUrl: product.images?.[0]?.large ?? product.images?.[0]?.medium,
    sourceUrl: product.markets?.tcgplayer?.url,
    description: rawDescription ? stripHtml(rawDescription) : undefined,
  };
}

async function resolveCardSafe(ref: CardRef): Promise<Card | undefined> {
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
}

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

export async function getCardById(id: string): Promise<Card | undefined> {
  const cards = await getAllCards();
  return cards.find((c) => c.id === id);
}

export async function findCard(query: string): Promise<Card | undefined> {
  const q = query.trim().toLowerCase();
  const cards = await getAllCards();
  return cards.find(
    (card) =>
      card.id.toLowerCase() === q ||
      card.slug.toLowerCase() === q ||
      card.name.toLowerCase() === q ||
      (card.number ?? "").toLowerCase() === q
  );
}

const ALERT_PCTS = [-150, -100, -50, 50, 100, 150] as const;

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
    imageUrl: card.imageUrl,
    sourceUrl: card.sourceUrl,
    productUrl: absoluteUrl(`/products/${card.slug}`),
    markdownUrl: absoluteUrl(`/products/${card.slug}/index.md`),
  };
}
