export type Franchise = "pokemon" | "one-piece";

export type PriceHistoryPoint = {
  date: string; // ISO date
  price: number;
};

export type PriceSnapshot = {
  date: string; // ISO date
  price: number;
  source: string; // e.g. "TCGPlayer"
  sourceUrl?: string;
};

export type PriceTrend = {
  day1: number | null;
  day7: number | null;
  day30: number | null;
  day90: number | null;
};

export type Card = {
  id: string; // apitcg.com numeric product id, as a string
  slug: string; // URL slug, e.g. "gengar-vmax-271"
  franchise: Franchise;
  name: string;
  set: string;
  setCode?: string;
  number?: string; // e.g. "271" or "OP07-113"
  rarity?: string;
  currency: "USD";
  currentPrice: number;
  asOfDate: string; // ISO date the current price was last updated
  priceHistory: PriceHistoryPoint[];
  recentSnapshots: PriceSnapshot[]; // real daily market-price records, not itemized sales
  trend: PriceTrend; // average price over trailing windows, derived from priceHistory
  imageUrl?: string; // real card image; falls back to a generated placeholder if absent
  sourceUrl?: string; // real TCGPlayer product page
  description?: string;
};

export type AlertBand = {
  pct: number;
  price: number;
};
