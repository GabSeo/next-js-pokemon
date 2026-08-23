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

export type EbayConditionTier = "PSA 10" | "PSA 9" | "PSA 8" | "Raw";

export type IllustrativeListingRow = { date: string; description: string; price: number };
export type IllustrativeListingSet = { rows: IllustrativeListingRow[]; total: number };

const MULTIPLIER_RANGE: Record<EbayConditionTier, [number, number]> = {
  "PSA 10": [7, 10],
  "PSA 9": [1.8, 2.6],
  "PSA 8": [1.1, 1.6],
  Raw: [0.9, 1.2],
};
const CONDITION_LABEL: Record<EbayConditionTier, string> = {
  "PSA 10": "PSA 10 Gem Mint",
  "PSA 9": "PSA 9 Mint",
  "PSA 8": "PSA 8 NM-Mint",
  Raw: "Near Mint, ungraded",
};
const ACTIVE_BUYING_OPTIONS = ["Buy It Now", "Best Offer", "Buy It Now"];
const ACTIVE_SALT: Record<EbayConditionTier, number> = { "PSA 10": 20, "PSA 9": 21, "PSA 8": 22, Raw: 23 };
const SOLD_SALT: Record<EbayConditionTier, number> = { "PSA 10": 11, "PSA 9": 13, "PSA 8": 17, Raw: 15 };

function relativeDateLabel(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * UI preview for GradedMarketPanel's active-listing rows before
 * EBAY_CLIENT_ID/SECRET exist — lets the panel's full layout (rows, avg
 * price, total count, ROI) be reviewed in the browser ahead of the real API
 * being wired in, same reasoning as everything else in this file. GradedMarketPanel
 * swaps this out automatically the moment a real eBay fetch for that tier
 * succeeds.
 */
export function illustrativeActiveListings(card: Card, condition: EbayConditionTier): IllustrativeListingSet {
  const base = card.currentPrice;
  const [lo, hi] = MULTIPLIER_RANGE[condition];
  const salt = ACTIVE_SALT[condition];
  const rows = [0, 1, 2].map((i) => ({
    date: relativeDateLabel(i + Math.round(seedFraction(card.id, salt * 10 + i + 5) * 2)),
    description: `${CONDITION_LABEL[condition]} · ${ACTIVE_BUYING_OPTIONS[i]}`,
    price: Math.round(base * (lo + seedFraction(card.id, salt * 10 + i) * (hi - lo))),
  }));
  const total = 8 + Math.round(seedFraction(card.id, salt * 10 + 9) * 25);
  return { rows, total };
}

/**
 * Stand-ins for `GET /{game}/ebay-sold-offers?id=&per_page=3` (see
 * tcggo-integration-plan.md §2.4) — deliberately carries NO `url` field per
 * row. A fabricated eBay item link would be an actually-broken/misleading
 * link, not just a placeholder number, which is a different and worse kind
 * of dishonesty than an illustrative price. Real per-item links only appear
 * once this is backed by the real endpoint — which, per lib/ebay-browse.ts's
 * comment, is currently gated behind eBay's restricted Marketplace Insights
 * API, so this stays illustrative regardless of eBay credentials.
 */
export function illustrativeSoldListings(card: Card, condition: EbayConditionTier): IllustrativeListingSet {
  const base = card.currentPrice;
  const [lo, hi] = MULTIPLIER_RANGE[condition];
  const salt = SOLD_SALT[condition];
  const rows = [0, 1, 2].map((i) => ({
    date: relativeDateLabel(2 + i * 4 + Math.round(seedFraction(card.id, salt * 10 + i + 5) * 3)),
    description: `${CONDITION_LABEL[condition]} · Sold`,
    price: Math.round(base * (lo * 0.95 + seedFraction(card.id, salt * 10 + i) * (hi - lo) * 1.05)),
  }));
  const total = 6 + Math.round(seedFraction(card.id, salt * 10 + 9) * 20);
  return { rows, total };
}

/**
 * Vinted's own real condition vocabulary (its actual French-UI options,
 * confirmed live at vinted.fr/help/50) includes Très bon état, Bon état and
 * Satisfaisant — but this feed deliberately shows only the first one.
 *
 * That's a product decision, not a data limitation: the France tab exists
 * to surface listings a seller has *clearly described* as très bon état,
 * so the lower tiers are filtered out of the real feed entirely
 * (lib/vinted-listings.ts) and never invented here either. A preview that
 * showed three condition tags would advertise a filter the real feed
 * doesn't apply — the preview's job is to look like the real thing, minus
 * the honesty of real numbers.
 */
export const VINTED_TRES_BON_ETAT = "Très bon état";

export type VintedFeedListing = {
  minutesAgo: number;
  condition: typeof VINTED_TRES_BON_ETAT;
  price: number;
};

// Fixed recency spread (not random) so the feed always reads newest-first
// with a believable, increasing gap — matches how a real "just listed"
// feed would look, without needing wall-clock state. Length matches
// VINTED_RESULTS_PER_CARD (lib/lobstr.ts), so the preview is the same shape
// as the real feed it stands in for rather than a shorter stub.
const VINTED_MINUTES_AGO = [0, 4, 11, 19, 27, 38, 52, 70, 95, 128];

/**
 * Illustrative "newly listed" feed — same placeholder-until-a-real-source
 * pattern as illustrativeActiveListings above, but shaped for a
 * fundamentally different marketplace: no PSA grading, no active/sold
 * split (Vinted has no public "sold" feed the way eBay does), just a
 * single rolling list of recent listings a buyer would actually scroll
 * through, every one of them très bon état. Price spread is wider and skews
 * lower than eBay's graded tiers (0.5x-1.15x of the real current price) —
 * casual peer-to-peer resale genuinely prices lower and more
 * inconsistently than a curated/graded market. The card itself is shown
 * once via the panel's real image, not repeated per row.
 *
 * This is now the FALLBACK path, not the only path: real listings come from
 * Lobstr's Vinted Products Scraper (lib/lobstr.ts, lib/vinted-listings.ts),
 * and this feed renders only when that returns nothing — no API key, no
 * finished run yet, or no très bon état listing for this card right now.
 */
export function illustrativeVintedFeed(card: Card): VintedFeedListing[] {
  const base = card.currentPrice;
  return VINTED_MINUTES_AGO.map((minutesAgo, i) => {
    const multiplier = 0.5 + seedFraction(card.id, 60 + i) * 0.65;
    return {
      minutesAgo,
      condition: VINTED_TRES_BON_ETAT,
      price: Math.round(base * multiplier),
    };
  });
}
