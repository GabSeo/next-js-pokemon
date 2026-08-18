import { pokemonCards } from "@/data/pokemon";
import { onePieceCards } from "@/data/one-piece";
import { absoluteUrl } from "@/lib/site";
import type { AlertBand, Card, Franchise } from "@/lib/types";

export const cardsByFranchise: Record<Franchise, Card[]> = {
  pokemon: pokemonCards,
  "one-piece": onePieceCards,
};

export function getAllCards(): Card[] {
  return [...pokemonCards, ...onePieceCards];
}

export function getCardsByFranchise(franchise: Franchise): Card[] {
  return cardsByFranchise[franchise];
}

export function getCardBySlug(slug: string): Card | undefined {
  return getAllCards().find((card) => card.slug === slug);
}

export function getCardById(id: string): Card | undefined {
  return getAllCards().find((card) => card.id === id);
}

export function findCard(query: string): Card | undefined {
  const q = query.trim().toLowerCase();
  return getAllCards().find(
    (card) =>
      card.id.toLowerCase() === q ||
      card.slug.toLowerCase() === q ||
      card.name.toLowerCase() === q ||
      card.number.toLowerCase() === q
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
    lastSoldDate: card.lastSoldDate,
    lastSoldPrice: card.lastSoldPrice,
    priceHistory: card.priceHistory,
    recentSales: card.recentSales,
    productUrl: absoluteUrl(`/products/${card.slug}`),
    markdownUrl: absoluteUrl(`/products/${card.slug}/index.md`),
  };
}
