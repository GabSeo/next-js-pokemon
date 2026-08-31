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
export type GradeTableRow = {
  label: string;
  english: { median: number; count: number } | null;
  japanese: { median: number; count: number } | null;
};

/** English is blue and Japanese is red everywhere in the Grading Center — bars, legend, table headers. */
export const ENGLISH_COLOR = "var(--pokemon-blue)";
export const JAPANESE_COLOR = "var(--pokemon-red)";
