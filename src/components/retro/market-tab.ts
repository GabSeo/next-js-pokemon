"use client";

import { useProductLocaleOptional, type LocaleCode } from "@/components/product-locale";
import type { EbayLanguage } from "@/lib/ebay-browse";

/** A top-level market — the two real eBay-backed languages, plus France, which isn't eBay at all. */
export type MarketTab = EbayLanguage | "France";

/**
 * Which marketplace each flag of the product page's language toggle reads,
 * in the order the flags appear. US and JP are eBay's English and Japanese
 * markets; FR is Vinted, because eBay.fr isn't where the French market
 * trades (see graded-market-tabs.tsx's file doc comment).
 */
export const MARKET_BY_LOCALE: Record<LocaleCode, MarketTab> = {
  US: "English",
  JP: "Japanese",
  FR: "France",
};

/**
 * The market the visitor has selected, resolved the same way everywhere.
 *
 * Lifted out of graded-market-tabs.tsx when the grading tools moved into
 * their own panel. Both panels read the one toggle, and two copies of this
 * resolution would have been two chances for the Market Overview and the
 * Grading Center to disagree about which market the reader is looking at —
 * on the same screen, from the same click.
 *
 * `marketTabs` is what the card actually has: the fallback covers
 * JAPANESE_MARKET_ENABLED being flipped off (lib/graded-market.ts), which
 * drops "Japanese" from the data while the JP flag itself stays — the card
 * is still shown in Japanese, the listings just stay on the English market
 * rather than on a tab that no longer exists. No provider means no toggle
 * was rendered either, so there is nothing for a visitor to have selected
 * and the first eBay market is the only honest default.
 */
export function useSelectedMarket(marketTabs: MarketTab[]): MarketTab {
  const active = useProductLocaleOptional()?.active;
  const preferred = active ? MARKET_BY_LOCALE[active] : marketTabs[0];
  return marketTabs.includes(preferred) ? preferred : marketTabs[0];
}
