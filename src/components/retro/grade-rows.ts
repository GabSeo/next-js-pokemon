/**
 * One grade, priced in both eBay markets, with the depth behind each price.
 *
 * In its own module because the chart and the table both take it and the
 * table's card renders the chart — importing the type from either would have
 * made the two files circular.
 *
 * A market with no listings is `null`, never `{ median: 0 }`. Zero is a price
 * and this is an absence; the difference is the whole reason a bar can be
 * missing without the chart looking broken.
 */
/**
 * One market's reading of one grade.
 *
 * `imageUrl` and `url` belong to the CHEAPEST listing in that tier — the one
 * the median is anchored to — and are present only when the tier is real.
 * An illustrative tier must never carry a photo: the whole value of showing
 * one is that it is a copy somebody is selling right now, so a fabricated
 * one would turn decoration into false evidence. Same rule the collector
 * insight's photo follows (see lib/graded-market.ts on GradedMarketListingRow).
 */
export type GradeCell = {
  median: number;
  count: number;
  /** Seller photo of the cheapest listing behind this median. Real tiers only. */
  imageUrl?: string;
  /** That listing's own eBay page. Real tiers only. */
  url?: string;
};

export type GradeTableRow = {
  label: string;
  english: GradeCell | null;
  japanese: GradeCell | null;
};

/** English is blue and Japanese is red everywhere in the Grading Center — bars, legend, table headers. */
export const ENGLISH_COLOR = "var(--pokemon-blue)";
export const JAPANESE_COLOR = "var(--pokemon-red)";
