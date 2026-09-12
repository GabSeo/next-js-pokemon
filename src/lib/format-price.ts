/** Above this, a price is abbreviated rather than allowed to grow a cell. */
const MILLIONS = 1_000_000;
const THOUSANDS = 10_000;

/**
 * A price that always fits on one line.
 *
 * Rounded to whole units first, and that is the important half. The raw
 * medians carry three decimals, and this locale formats `2449.995` as
 * "2 449,995" — space for thousands, comma for decimals — so a $2,450 card
 * read as two and a half million to anyone who assumed the other convention.
 * That is what made the numbers look like they needed abbreviating in the
 * first place. Cents are noise on a median of four asks anyway.
 *
 * Abbreviation is the second half and a genuine backstop rather than
 * everyday behaviour: the priciest card currently tracked asks about USD
 * 3,800, so nothing in the live data reaches even the thousands threshold.
 * It exists so a future six-figure grail shortens instead of wrapping or
 * overflowing its cell.
 *
 * Grouped in "en-US" explicitly, which REPLACES an earlier decision to keep
 * the runtime's own locale here. That reasoning was right about the goal —
 * one convention everywhere — and wrong about how to reach it, because the
 * runtime locale is not one convention: it is Node's on the server and the
 * visitor's in the browser. A French machine renders "USD 1 466" where the
 * server rendered "USD 1,466", which is both a visible inconsistency against
 * lib/market-views.ts (already pinned to en-US, for this reason) and a
 * hydration mismatch React reports. Observed live in the grade table.
 *
 * Pinning is also what makes the note above true: the "2 449,995" it
 * describes is exactly this bug, seen before the rounding was added.
 */
export function formatPrice(value: number, currency: string): string {
  const rounded = Math.round(value);
  const magnitude = Math.abs(rounded);

  if (magnitude >= MILLIONS) return `${currency} ${(rounded / MILLIONS).toFixed(2)}M`;
  if (magnitude >= THOUSANDS) return `${currency} ${(rounded / 1000).toFixed(1)}K`;
  return `${currency} ${rounded.toLocaleString("en-US")}`;
}

/**
 * A price for a CATALOGUE GRID, where most cards cost less than a coffee.
 *
 * WHY `formatPrice` CANNOT BE USED HERE. It rounds to whole units, which is
 * right for the graded market it was written for — cents are noise on a median
 * of four asks in the hundreds — and wrong for a catalogue by an order of
 * magnitude. Measured across data/prices/pokemon.json:
 *
 *   median             EUR 0.60
 *   under EUR 1.00     56.6% of priced cards
 *   under EUR 0.50     47.4%
 *
 * Rounded to units, more than half the catalogue reads "EUR 1" or "EUR 0" —
 * the second of which states that a card is free.
 *
 * So: cents below 100, whole units above, where the cent has stopped carrying
 * information and the width starts to. The thousands and millions backstops are
 * `formatPrice`'s, for the same reason they exist there.
 */
export function formatCatalogPrice(value: number, currency: string): string {
  const magnitude = Math.abs(value);
  if (magnitude >= MILLIONS) return `${currency} ${(value / MILLIONS).toFixed(2)}M`;
  if (magnitude >= THOUSANDS) return `${currency} ${(value / 1000).toFixed(1)}K`;
  if (magnitude >= 100) return `${currency} ${Math.round(value).toLocaleString("en-US")}`;
  return `${currency} ${value.toFixed(2)}`;
}

/**
 * The same, as a range — "EUR 0.60 - 2.07".
 *
 * THE CURRENCY IS PRINTED ONCE. Two symbols on one line in a 150px tile is
 * noise, and the caller guarantees both ends came from one marketplace: see
 * getCatalogPriceRanges, which never mixes Cardmarket euros with TCGplayer
 * dollars inside one range.
 *
 * Equal ends collapse to a single figure rather than printing "EUR 2 - 2".
 * That is not a formatting nicety: a card with one printing HAS one price, and
 * a range implies a spread that does not exist.
 */
export function formatCatalogPriceRange(min: number, max: number, currency: string): string {
  if (!(max > min)) return formatCatalogPrice(min, currency);
  const low = formatCatalogPrice(min, currency);
  // The high end drops the currency — it is the same one by construction.
  const high = formatCatalogPrice(max, currency).slice(currency.length + 1);
  return `${low} – ${high}`;
}
