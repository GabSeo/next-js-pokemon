import type { Card } from "@/lib/types";

/**
 * Real Cardmarket EUR figures (card.cardmarket — see its own doc comment,
 * lib/types.ts) in the same panel slot InternationalPricesPanel occupies for
 * a card with no such source. No IllustrativeTag here on purpose — this
 * codebase's own convention is that the *absence* of that tag is what marks
 * a number as real (see graded-market-panel.tsx's ListingRow), and every
 * figure here comes straight from BerryWallet's own Cardmarket block, not a
 * currency-converted estimate.
 *
 * Currently reachable only for a One Piece card with a real BerryWallet
 * match — Pokémon cards never carry card.cardmarket, so
 * ProductPageContent keeps rendering InternationalPricesPanel for them.
 */
export function CardmarketPricesPanel({ card }: { card: Card }) {
  const cardmarket = card.cardmarket;
  if (!cardmarket) return null;

  const rows = [
    { label: "Average", amount: cardmarket.avg },
    { label: "Low", amount: cardmarket.low },
    { label: "Trend", amount: cardmarket.trend },
    // `!= null` (not `!== undefined`) is deliberate: the type says `number`,
    // but BerryWallet has been seen sending an explicit `null` through this
    // exact field before it gets normalized in cards.ts — see
    // BerryWalletCardmarketPrices's doc comment (lib/berrywallet.ts). A stale
    // build cache or a future second cardmarket source could reintroduce a
    // raw null here, and `.toLocaleString()` below would crash the whole
    // page (and the static build) on it rather than just omitting one row.
  ].filter((row): row is { label: string; amount: number } => row.amount != null);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-black tracking-[0.6px] text-muted-text uppercase">
        🇪🇺 Cardmarket
      </div>
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={`flex items-center justify-between py-2 text-sm font-bold ${i > 0 ? "border-t-2 border-dashed border-border-subtle" : ""}`}
        >
          <span>{row.label}</span>
          <b className="text-base font-black tabular-nums">€{row.amount.toLocaleString()}</b>
        </div>
      ))}
      {cardmarket.url && (
        <a
          href={cardmarket.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block border-t-2 border-dashed border-border-subtle pt-2 text-xs font-black text-pokemon-blue uppercase"
        >
          View on Cardmarket ↗
        </a>
      )}
    </div>
  );
}
