/**
 * One eBay listing, as a row.
 *
 * EXTRACTED SO TWO SCREENS CANNOT DRIFT. It lived inside
 * graded-market-panel.tsx and the scan's explain panel grew its own, smaller
 * version of the same idea — a median with no listings behind it and nothing to
 * click. Asked for as "make sure the eBay functioning is the exact same as in
 * the tracked cards, since all our tests are positive there", and the only way
 * to mean that literally is for both to render the same component.
 *
 * CLIENT-SAFE BY CONSTRUCTION: plain props, no data loader, no `node:` import.
 * The panel that used to own it pulls in lib/cards.ts, which is metered and
 * server-only, so a shared file is also what lets the scan's client component
 * use it at all.
 */
export type Listing = {
  date: string;
  description: string;
  price: number;
  currency: string;
  /** Real rows get a working per-item link; illustrative rows never do — see lib/illustrative.ts. */
  url?: string;
};

export function ListingRow({ date, description, price, currency, url }: Listing) {
  return (
    <div className="grid grid-cols-[76px_1fr_auto_20px] items-center gap-3 border-t border-dashed border-border-subtle py-3 text-[13px] first:border-t-0">
      <span className="text-[11px] font-bold text-muted-text">{date}</span>
      <span className="truncate font-bold">{description}</span>
      {/* Deliberately NOT formatPrice: this is one seller's actual asking
          price, where 2,599.99 is the real number and rounding it to 2,600
          would be inventing a figure nobody listed. Two fixed decimals rather
          than the locale default, so a row ending .99 and a row ending .00
          line up instead of one showing cents and the next not. */}
      <span className="font-black tabular-nums">
        {currency} {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-text hover:text-pokemon-blue">
          ↗
        </a>
      ) : (
        <span />
      )}
    </div>
  );
}
