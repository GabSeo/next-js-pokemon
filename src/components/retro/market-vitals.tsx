import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { trendSignal } from "@/lib/price-signal";
import type { GradedMarketData } from "@/lib/graded-market";
import type { Card } from "@/lib/types";

/**
 * Listing depth past which the market reads as deep rather than thin.
 *
 * Stated as constants because they are a judgement, not a measurement: there
 * is no source that says 200 listings is "deep" for a trading card. The
 * COUNT is the fact and gets the prominent slot; the word is a reading of it
 * and sits underneath, which is the opposite of how the panel this borrows
 * from does it.
 */
const DEEP_LISTINGS = 200;
const MODERATE_LISTINGS = 50;

function liquidityLabel(total: number): string {
  if (total >= DEEP_LISTINGS) return "Deep — easy to buy or sell";
  if (total >= MODERATE_LISTINGS) return "Moderate — a working market";
  return "Thin — few sellers today";
}

/** One cell. `basis` is the number or window the verdict was read from, never decoration. */
function Vital({ label, value, basis }: { label: string; value: string; basis: string }) {
  return (
    <div className="border-border-subtle px-5 py-4 not-last:border-b-2 sm:not-last:border-r-2 sm:not-last:border-b-0">
      <div className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">{label}</div>
      <div className="mt-1 text-lg font-black tracking-[-0.4px] tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] font-bold text-muted-text">{basis}</div>
    </div>
  );
}

/**
 * The four things a buyer asks before anything else: can I get one, how much
 * does the price move, which way is it going, and how old is this page.
 *
 * Every cell shows the number it was read from directly beneath the verdict.
 * That ordering is the whole design. A strip of confident one-word ratings —
 * Excellent, High, 84/100 — reads as authority precisely because it hides
 * what produced it, and two of the four ratings on the panel this is modelled
 * after have no data underneath them at all. Here the word is always the
 * smaller claim and the figure carrying it is on screen.
 *
 * Three deliberate omissions, all of them things that panel shows:
 *
 * - No verified-sales count. eBay's sold API is closed (lib/illustrative.ts),
 *   so this site has no completed-sale data anywhere. The nearest honest
 *   neighbour is live listing depth, which is what LIQUIDITY counts, and it
 *   says "listings" rather than borrowing the word "sales".
 * - No confidence score. A composite out of 100 with no defined inputs is a
 *   number that feels like evidence without being any.
 * - No set popularity. There is no source for it. Printing the set's name
 *   under that heading, as the original does, makes the label do work the
 *   data is not doing.
 */
export function MarketVitals({ card, data }: { card: Card; data: GradedMarketData }) {
  // Real tiers only. An illustrative tier's `count` is an estimate, and
  // summing estimates into a headline depth figure would launder them into a
  // fact. Both eBay markets plus the French feed, because "how many of these
  // can I actually find for sale" is not a per-market question.
  const realTiers = data.conditions.flatMap((c) => c.languages.map((l) => l.active)).filter((t) => t.isReal);
  const ebayListings = realTiers.reduce((sum, t) => sum + t.count, 0);
  const vintedListings = data.vinted.isReal ? data.vinted.rows.length : 0;
  const listings = ebayListings + vintedListings;
  const listingsAreReal = realTiers.length > 0;

  // Peak-to-trough over whatever history exists — deliberately not a standard
  // deviation. A spread between two dates a reader can see quoted underneath
  // is checkable; a sigma is not, and the series is daily closes from one
  // source rather than a return distribution, so the statistic would carry
  // more precision than the data earns.
  const range = card.priceRange;
  const swingPct = range && range.low > 0 ? ((range.high - range.low) / range.low) * 100 : null;

  const trend = trendSignal(card.currentPrice, card.trend?.day90);

  const amount = (n: number) => Math.round(n).toLocaleString();

  return (
    <div className="mb-5 overflow-hidden rounded-md border-2 border-black bg-card-surface shadow-hard-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Vital
          basis={listingsAreReal ? liquidityLabel(listings) : "eBay could not be reached — no live count"}
          label="Listings for sale"
          value={listingsAreReal ? listings.toLocaleString() : "—"}
        />
        <Vital
          basis={
            range ? `${card.currency} ${amount(range.low)}–${amount(range.high)} since ${range.from}` : "Not enough history yet"
          }
          label="Price swing"
          value={swingPct === null ? "—" : `${swingPct.toFixed(0)}%`}
        />
        <Vital
          basis={
            trend.pct === null
              ? "No 3-month average to compare against"
              : `${trend.pct >= 0 ? "+" : ""}${trend.pct.toFixed(1)}% vs the 3-month average`
          }
          label="Price trend"
          value={trend.label}
        />
        <Vital basis="TCGplayer market price, refreshed daily" label="Price updated" value={card.asOfDate} />
      </div>

      {!listingsAreReal && (
        <div className="border-t-2 border-border-subtle px-5 py-2">
          <IllustrativeTag label="Preview — eBay not connected yet" />
        </div>
      )}
    </div>
  );
}
