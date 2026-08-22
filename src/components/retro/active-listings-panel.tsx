import { activeListingSearchLinks } from "@/lib/ebay-search";
import type { Card } from "@/lib/types";

/**
 * Real, working links — not illustrative. No API backs "active eBay
 * listings" (TCGGO only has sold/completed data), so these are plain eBay
 * search-result URLs rather than itemized listings. See
 * tcggo-integration-plan.md §2.4 for why that's the honest ceiling here.
 */
export function ActiveListingsPanel({ card }: { card: Card }) {
  const links = activeListingSearchLinks(card);
  return (
    <div className="rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
      <div className="mb-4 text-xs font-black tracking-[0.6px] text-muted-text uppercase">🛒 Shop Active Listings</div>
      <div className="flex flex-col gap-2">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-md border-2 border-black bg-white px-4 py-2.5 text-sm font-black shadow-hard-sm transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
          >
            {link.label}
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-text">Live eBay search results — not curated picks, always current.</p>
    </div>
  );
}
