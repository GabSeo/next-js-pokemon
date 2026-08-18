export type Franchise = "pokemon" | "one-piece";

export type PriceHistoryPoint = {
  date: string; // ISO date
  price: number;
};

export type SaleRecord = {
  date: string; // ISO date
  price: number;
  condition: string;
  source: string;
  url: string;
};

export type Card = {
  id: string; // stable card id, e.g. "base1-4"
  slug: string; // URL slug, e.g. "charizard-base-set-4"
  franchise: Franchise;
  name: string;
  set: string;
  setCode: string;
  number: string; // e.g. "4/102"
  rarity: string;
  currency: "EUR";
  currentPrice: number;
  lastSoldDate: string;
  lastSoldPrice: number;
  priceHistory: PriceHistoryPoint[];
  recentSales: SaleRecord[];
  gradientFrom: string;
  gradientTo: string;
  description: string;
};

export type AlertBand = {
  pct: -150 | -100 | -50 | 50 | 100 | 150;
  price: number;
};
