import type { Card } from "@/lib/types";

/**
 * Placeholder data for panels the mockups show (PSA/eBay graded prices,
 * population, international pricing) that no connected API currently
 * provides — apitcg.com only has TCGPlayer USD. Nothing here is fetched;
 * every value is derived deterministically from the card's real
 * `currentPrice` so numbers scale sensibly per-card instead of being an
 * identical static figure copy-pasted across six different cards, but
 * they are NOT real sales data. Every consumer of these functions must
 * pair the rendered value with the `IllustrativeTag` component — see
 * components/retro/illustrative-tag.tsx — so nothing here is mistaken for
 * a real fetched fact, on a site whose whole premise is that AI agents can
 * trust what's on the page.
 *
 * This is intentionally the single place these numbers get invented, so
 * swapping in a real provider (TCGGO — see lib/tcggo.ts) later means
 * deleting this file and rewiring its call sites, not hunting for
 * fabricated numbers scattered across components.
 */

/** Stable per-card variance so illustrative figures aren't identical across cards, without being a real fetched value. */
function seedFraction(id: string, salt: number): number {
  let hash = 0;
  const salted = `${id}:${salt}`;
  for (let i = 0; i < salted.length; i++) hash = (hash * 31 + salted.charCodeAt(i)) >>> 0;
  return (hash % 1000) / 1000; // 0..1
}

export type IllustrativeGradedPrice = { grade: string; price: number; sales: number };

/** PSA/eBay-style graded price tiers — real graders charge a premium for higher grades, so the multipliers only reflect that general shape, not any specific card's real graded market. */
export function illustrativePsaGraded(card: Card): IllustrativeGradedPrice[] {
  const base = card.currentPrice;
  return [
    { grade: "PSA 10", price: Math.round(base * (7 + seedFraction(card.id, 1) * 3)), sales: 2 + Math.round(seedFraction(card.id, 4) * 4) },
    { grade: "PSA 9", price: Math.round(base * (1.8 + seedFraction(card.id, 2) * 0.8)), sales: 15 + Math.round(seedFraction(card.id, 5) * 40) },
    { grade: "PSA 8", price: Math.round(base * (1.1 + seedFraction(card.id, 3) * 0.5)), sales: 10 + Math.round(seedFraction(card.id, 6) * 30) },
  ];
}

export type IllustrativePopulation = {
  total: number;
  gemRatePct: number;
  bars: { grade: string; count: number; widthPct: number }[];
};

/** Grading-population shape (more low/mid grades than gem-mint 10s) — not a real PSA population report. */
export function illustrativePopulation(card: Card): IllustrativePopulation {
  const scale = 300 + Math.round(seedFraction(card.id, 7) * 800);
  const bars = [
    { grade: "10", count: Math.round(scale * 0.15) },
    { grade: "9", count: Math.round(scale * 1.0) },
    { grade: "8", count: Math.round(scale * 1.05) },
    { grade: "7", count: Math.round(scale * 0.85) },
    { grade: "6", count: Math.round(scale * 0.8) },
  ];
  const total = bars.reduce((sum, b) => sum + b.count, 0);
  const max = Math.max(...bars.map((b) => b.count));
  return {
    total,
    gemRatePct: Math.round((bars[0].count / total) * 1000) / 10,
    bars: bars.map((b) => ({ ...b, widthPct: Math.round((b.count / max) * 100) })),
  };
}

export type IllustrativeIntlPrice = { label: string; currency: string; amount: number };

/** Rough static FX multipliers off the real USD price — not a live conversion rate. */
export function illustrativeInternational(card: Card): IllustrativeIntlPrice[] {
  if (card.currency !== "USD") return [];
  return [
    { label: "Euro", currency: "€", amount: Math.round(card.currentPrice * 0.92 * 100) / 100 },
    { label: "Pound", currency: "£", amount: Math.round(card.currentPrice * 0.79 * 100) / 100 },
    { label: "CAD", currency: "CA$", amount: Math.round(card.currentPrice * 1.44 * 100) / 100 },
  ];
}

/** Condition tiers the price-history chart's filter chips reference — every one currently maps to the same real Near Mint series, since that's the only condition apitcg.com tracks. */
export const ILLUSTRATIVE_CONDITIONS = ["Damaged", "Heavily Played", "Moderately Played", "Near Mint"] as const;

export type IllustrativeSoldListing = { grade: string; price: number; daysAgo: number };

/**
 * Stand-ins for `GET /{game}/ebay-sold-offers?id=&per_page=3` (see
 * tcggo-integration-plan.md §2.4) — deliberately carries NO `url` field.
 * A fabricated eBay item link would be an actually-broken/misleading link,
 * not just a placeholder number, which is a different and worse kind of
 * dishonesty than an illustrative price. Real per-item links only appear
 * once this is backed by the real endpoint.
 */
export function illustrativeSoldListings(card: Card): IllustrativeSoldListing[] {
  const base = card.currentPrice;
  return [
    { grade: "PSA 10", price: Math.round(base * (7 + seedFraction(card.id, 11) * 3)), daysAgo: 2 + Math.round(seedFraction(card.id, 12) * 5) },
    { grade: "PSA 9", price: Math.round(base * (1.8 + seedFraction(card.id, 13) * 0.8)), daysAgo: 6 + Math.round(seedFraction(card.id, 14) * 10) },
    { grade: "Raw · NM", price: Math.round(base * (0.9 + seedFraction(card.id, 15) * 0.3)), daysAgo: 1 + Math.round(seedFraction(card.id, 16) * 4) },
  ];
}
