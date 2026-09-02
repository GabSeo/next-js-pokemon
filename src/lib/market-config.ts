/**
 * Which marketplace is authoritative for which market.
 *
 * The toggle picks a MARKET — where a reader is valuing the card — not a
 * marketplace and not a card language. That distinction is the whole point:
 * TCGplayer is the US market's price, Cardmarket is Europe's, and a Japanese
 * print still trades on Cardmarket because Cardmarket is where Europeans buy
 * Japanese cards. So the app decides which source leads; the reader never
 * picks "TCGplayer or Cardmarket".
 *
 * Only the selected market's source is shown. A muted strip of the OTHER
 * marketplace used to sit under it, on the reasoning that a US buyer benefits
 * from seeing the EU number — in practice it earned no attention and cost a
 * third of the card's height, so the toggle carries that job instead. No
 * figure is lost from the page: switching markets shows it in full.
 *
 * NOT a currency conversion table. Each market shows its own source's own
 * figures in that source's own currency — converting EUR into a "US price"
 * would invent a number no marketplace quoted.
 */

/** Same three codes the product locale toggle already uses. */
export type Market = "US" | "FR" | "JP";

export type MarketSource = "tcgplayer" | "cardmarket";

export type MarketConfig = {
  /** Names the market, not the marketplace — "FR / EU" because Cardmarket is European, not French. */
  label: string;
  /** The source that leads this market. The other is reached by switching, not by scrolling. */
  primary: MarketSource;
};

export const MARKET_CONFIG: Record<Market, MarketConfig> = {
  US: { label: "US market", primary: "tcgplayer" },
  FR: { label: "EU market", primary: "cardmarket" },
  // Cardmarket leads here too, on the Japanese print's own listing. Deliberately
  // NOT called a Japanese market index: the product is Japanese, the
  // marketplace is European, and the panel's own label says "Cardmarket ·
  // Japanese" so the reader is never told euros are a Tokyo price.
  JP: { label: "JA market", primary: "cardmarket" },
};

export function marketConfig(code: string): MarketConfig {
  return MARKET_CONFIG[code as Market] ?? MARKET_CONFIG.US;
}
