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
 * Deliberately keeps the page's own locale for the grouped case, so this
 * reads the same as every other price on the site rather than introducing a
 * third convention alongside them.
 */
export function formatPrice(value: number, currency: string): string {
  const rounded = Math.round(value);
  const magnitude = Math.abs(rounded);

  if (magnitude >= MILLIONS) return `${currency} ${(rounded / MILLIONS).toFixed(2)}M`;
  if (magnitude >= THOUSANDS) return `${currency} ${(rounded / 1000).toFixed(1)}K`;
  return `${currency} ${rounded.toLocaleString()}`;
}
