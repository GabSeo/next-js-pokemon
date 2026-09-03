/**
 * The Real-time market data section's whole data mapping, in one typed place.
 *
 * The section shows three views of one card — the US market, the European
 * market, and the Japanese print across both — and the single thing that
 * makes them readable as one system is that they are all the same SHAPE.
 * Same header, same headline figure, same four statistics, same explanatory
 * note, same collector insight. Only the content changes.
 *
 * That shape is declared here rather than in the components, for two
 * reasons. It keeps every "which field means what" decision in one file a
 * reader can check against lib/types.ts — TCGplayer's `mid` is the typical
 * listing, Cardmarket's `avg` is the average sell, and neither is obvious
 * from the field name alone. And it makes the components dumb: a tab that
 * cannot invent a figure cannot accidentally show a Western number under a
 * Japanese heading, which is the failure this section has hit before — see
 * the `available` comment in app/products/[slug]/page.tsx, written the last
 * time a fallback put Western euros under a Japanese label.
 *
 * THE RULES THIS FILE ENFORCES, all of them load-bearing:
 *
 * - NO CONVERSION, EVER. TCGplayer, eBay and PSA are USD; Cardmarket is
 *   EUR. Each view carries its own currency and the two never share a scale,
 *   a bar chart or a sentence that implies comparability.
 * - ZERO IS NOT A PRICE. Upstreams send `0` and explicit `null` for figures
 *   they do not have (see lib/types.ts on BerryWallet's nulls). Both map to
 *   `null` here with a stated reason, never to a rendered "0.00".
 * - A MISSING FIGURE IS STATED, not dropped. Every absent value carries the
 *   sentence to print in its place, so the layout keeps its shape and the
 *   reader learns something true.
 */

import type { GradedMarketData, GradedMarketTypeData } from "@/lib/graded-market";
import type { MarketArtId, MarketLogoId } from "@/lib/market-assets";
import type { Card } from "@/lib/types";

export type MarketCurrency = "USD" | "EUR";

/** The three views, in tab order. Not the LocaleCode union — these are views of the section, and "EU"/"JA" is how the page words them. */
export type MarketViewId = "US" | "EU" | "JA";

/**
 * The order the three markets are presented in, everywhere.
 *
 * Two Western markets first and the Japanese print last, because the first
 * two are the same card in two currencies and the third is a different print
 * — so the jump a reader makes between neighbours is a small one twice, then
 * a real one once, rather than the largest jump sitting in the middle.
 *
 * buildMarketViews already returned `[us, eu, ja]`; the market filter was
 * drawing US -> JA -> EU because it inherited the provider's array order
 * (US -> JP -> FR, a different thing for a different reason), so the control
 * and the section it controls disagreed. This constant is what they now
 * agree on — exported so the filter orders by it rather than keeping a
 * second copy of the same list.
 */
export const MARKET_VIEW_ORDER: MarketViewId[] = ["US", "EU", "JA"];

/** LocaleCode <-> view id. The market filter writes the page's existing locale context, so choosing a market also moves the card art and the panels below. */
export const VIEW_BY_LOCALE = { US: "US", FR: "EU", JP: "JA" } as const;
export const LOCALE_BY_VIEW = { US: "US", EU: "FR", JA: "JP" } as const;

/**
 * What the market filter calls each view, kept here rather than in the
 * component that draws it.
 *
 * The filter lives in the page's own pinned header (market-filter-band.tsx),
 * far from this file's panels, and it has to name the three markets WITHOUT
 * paying for buildMarketViews — that function needs both cards, the graded
 * market and a price lookup, none of which page chrome should have to hold
 * just to draw three buttons. These four strings are the only part of a view
 * that is constant for every card, so they are the only part the chrome
 * needs. buildMarketViews reads them from here too, which is the point: one
 * source, so a label can never say one thing in the filter and another in
 * the panel it selects.
 */
export const MARKET_TAB_META: Record<MarketViewId, { label: string; hint: string }> = {
  US: { label: "US market", hint: "English print · USD" },
  EU: { label: "EU market", hint: "Western print · EUR" },
  JA: { label: "Japanese card", hint: "EU + US data" },
};

const SYMBOL: Record<MarketCurrency, string> = { USD: "$", EUR: "€" };

/**
 * Prices, always two decimals, always en-US grouping.
 *
 * The fixed locale is deliberate and is a bug fix, not a style choice. This
 * section renders inside a client component, so the same string is produced
 * once by Node during the build and again by the browser on hydration — and
 * `toLocaleString(undefined, …)` reads a different default in each, so a
 * visitor with a French locale hydrated "1,045.17" onto server HTML that
 * said the same thing and React reported a mismatch. One locale on both
 * sides removes the disagreement.
 *
 * The symbol leads and the ISO code sits beside the figure in the card's own
 * currency badge, so "$" is never the only thing separating dollars from
 * euros.
 */
export function formatMarketMoney(amount: number, currency: MarketCurrency): string {
  return `${SYMBOL[currency]}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A real, positive figure, or null. `0` from an upstream means "no data", never "free". */
function priceOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** One line of the explanatory note. `strong` marks the live figures the sentence is about. */
export type NoteSegment = { text: string; strong?: boolean };

export type MarketNote = { title: string; segments: NoteSegment[] };

/**
 * A regional identity for one card, used only where two regions share a tab.
 *
 * The Japanese view puts a European valuation and a US comparison side by
 * side, and a reader has to tell them apart INSTANTLY and without being told
 * which is which by position — the cards stack on a narrow screen, so "left"
 * and "right" are not facts about this layout. So each card names its own
 * market in words, carries its own currency badge, and takes a restrained
 * regional tint. The words and the currency are what carry the meaning; the
 * colour only confirms it, which is why nothing here depends on seeing it.
 */
export type MarketRegion = {
  /** Two letters, as a coloured index — a shorthand for the title beside it, never a replacement for it. */
  badge: string;
  title: string;
  subtitle: string;
  tone: "eu" | "us";
};

export type ValuationStat = {
  label: string;
  amount: number | null;
  /** What to print when there is no figure. Never a blank, never a zero. */
  absent: string;
};

export type MarketValuation = {
  logo: MarketLogoId;
  /** Set only on the Japanese view, where two regions share the panel. */
  region?: MarketRegion;
  /** The marketplace, as it names itself. */
  sourceName: string;
  /** What this card's figures cover — "US market · Holofoil", "EU market · Western print". */
  sourceContext: string;
  currency: MarketCurrency;
  headlineLabel: string;
  headline: number | null;
  /** Printed in place of the headline when there is none. */
  headlineAbsent: string;
  /** One line under the headline saying where it came from. */
  headlineBasis: string;
  /** Cardmarket's average sell, as a chip beside the trend. Null on the US view, which has no equivalent. */
  saleChip: { label: string; amount: number } | null;
  /** Exactly four, so the 2x2 grid is the same block in every tab. */
  stats: ValuationStat[];
  note: MarketNote;
  /** The marketplace's own page for this card, when we hold one. */
  url?: string;
  actionLabel: string;
};

export type ComparisonRow = {
  label: string;
  /** A small marketplace mark beside the label, where it aids recognition. Grades carry none — PSA's mark on four rows would be noise. */
  logo: MarketLogoId | null;
  amount: number | null;
  /** Depth behind the figure — "4/231", "Holofoil". */
  sample?: string;
  /** The sentence the chip is short for, carried on `title`. */
  sampleTitle?: string;
  color: string;
  /** Why this row is empty. "No asks" is a real answer about a thin tier. */
  absent: string;
};

/**
 * The cheapest live listing behind the insight's own sentence, as a picture.
 *
 * Real eBay data or nothing. There is no illustrative variant of this and
 * there must not be: the whole value of the photo is that it is a copy
 * somebody is selling right now, so a fabricated one would turn the block's
 * decoration into false evidence. When it is absent — preview data, an empty
 * tier, or an item summary eBay returned without an image — the block keeps
 * its existing MarketArt illustration, which reads as decoration precisely
 * because it always has.
 */
export type InsightPhoto = {
  imageUrl: string;
  /** Describes what the picture IS, not the seller's keyword-stuffed title. */
  alt: string;
  /**
   * The eBay page for THIS listing — the one the photo shows and the one the
   * headline's graded figure came from. Carrying it here rather than beside
   * it keeps the picture and the destination the same object, so the block
   * can never link to one listing while showing another.
   */
  url?: string;
};

export type CollectorInsight = {
  art: MarketArtId;
  /** The cheapest real listing's own photo, when the tier the headline names has one. */
  photo?: InsightPhoto;
  /** The one line a reader should leave with. */
  headline: string;
  /** The two figures the headline was computed from, in words. */
  support: string;
  /** The multiple, for the ratio dial. Null when the comparison could not be made. */
  ratio: string | null;
};

/**
 * What every tab says under its insight — one slot, the same on all three.
 *
 * It used to be one slot each and a different one: `bars` carried a scope line
 * and no action, `trend` carried a cross-link to the other print and no scope.
 * So two tabs ended in a grey sentence and one ended in an illustrated block
 * with a button, and the same section read as three different features
 * depending on which toggle was open.
 *
 * The cross-link is gone rather than copied to the other two. It was a card-
 * sized restatement of the market toggle sitting a few hundred pixels above it
 * — a second way to do the one thing that control already does, taking the
 * space of a real figure to do it.
 */
export type MarketScope = { scopeLabel: string; scope: string };

/** One window of Cardmarket's own trailing averages. */
export type TrendPoint = { label: string; shortLabel: string; amount: number | null };

export type BarsIntelligence = {
  kind: "bars";
  /** Set only on the Japanese view, where two regions share the panel. */
  region?: MarketRegion;
  title: string;
  subtitle: string;
  vizLabel: string;
  vizTitle: string;
  currency: MarketCurrency;
  rows: ComparisonRow[];
  /** False when eBay could not be reached and the tiers are illustrative previews. */
  isReal: boolean;
  insight: CollectorInsight;
  footer: MarketScope;
};

export type TrendIntelligence = {
  kind: "trend";
  title: string;
  subtitle: string;
  vizLabel: string;
  vizTitle: string;
  currency: MarketCurrency;
  points: TrendPoint[];
  /** Spoken description of the chart for a screen reader — the chart itself is geometry. */
  chartDescription: string;
  insight: CollectorInsight;
  footer: MarketScope;
};

export type MarketIntelligence = BarsIntelligence | TrendIntelligence;

export type MarketContextChip = {
  text: string;
  tone: "region" | "region-us" | "plain" | "currency";
  /** Read out instead of `text` where the chip is an abbreviation. */
  srText?: string;
};

export type MarketView = {
  id: MarketViewId;
  tabLabel: string;
  tabHint: string;
  heading: string;
  chips: MarketContextChip[];
  valuation: MarketValuation;
  intelligence: MarketIntelligence;
  /** The line under the whole panel. States the scope of the view in one sentence. */
  footnote: string;
};

/* ------------------------------------------------------------------ *
 * Colours. Grade is ordinal, so its bars climb rather than being      *
 * unrelated hues — the obvious mistake is giving PSA 8 and PSA 9 one  *
 * colour, which reads as a single series split across two rows.       *
 * ------------------------------------------------------------------ */
const TCGPLAYER_COLOR = "var(--pokemon-blue)";
const RAW_COLOR = "#8a8a8a";
const PSA8_COLOR = "color-mix(in srgb, var(--pokemon-blue) 45%, #ffffff)";
const PSA9_COLOR = "#21c45d";
const PSA10_COLOR = "var(--pokemon-yellow)";

function activeTier(
  data: GradedMarketData | null,
  condition: string,
  language: string
): GradedMarketTypeData | undefined {
  return data?.conditions
    .find((c) => c.condition === condition)
    ?.languages.find((l) => l.language === language)?.active;
}

/**
 * One eBay tier as a comparison row, with the depth behind it.
 *
 * The wording of the sample chip is exact on purpose. `medianPrice` is the
 * median of the FEW CHEAPEST asks we hold (`rows`), not of every listing eBay
 * reports (`count`) — so "median of 850 live asks" would be a false claim
 * about a figure computed from four. "4 cheapest of 850 asks" is what
 * actually happened.
 */
function ebayRow(
  data: GradedMarketData | null,
  condition: string,
  language: string,
  label: string,
  color: string,
  logo: MarketLogoId | null
): ComparisonRow {
  const tier = activeTier(data, condition, language);
  const amount = tier && !tier.noListings ? priceOrNull(tier.medianPrice) : null;
  if (!tier || amount == null) {
    return {
      label,
      logo,
      amount: null,
      color,
      absent: !data ? "Not available" : tier?.noListings ? "No asks" : "No asks",
    };
  }
  const held = tier.rows.length;
  const all = held >= tier.count;
  return {
    label,
    logo,
    amount,
    sample: all ? `${tier.count} asks` : `${held}/${tier.count}`,
    sampleTitle: all
      ? `median of all ${tier.count} asks`
      : `median of the ${held} cheapest of ${tier.count} asks`,
    color,
    absent: "No asks",
  };
}

/** Whether the eBay tiers behind a view were genuinely fetched, or are illustrative previews. */
function ebayIsReal(data: GradedMarketData | null, language: string): boolean {
  if (!data) return false;
  return data.conditions.some((c) => c.languages.find((l) => l.language === language)?.active.isReal);
}

/** "holofoil" -> "Holofoil", "reverseHolofoil" -> "Reverse holofoil". */
function variantLabel(variant: string): string {
  const spaced = variant.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The American marketplaces for one print: TCGplayer's market price, then
 * eBay raw, then the graded ladder. Always five rows in this order, so the
 * US and Japanese tabs draw the same bars in the same places.
 */
function usdRows(
  data: GradedMarketData | null,
  print: Card | undefined,
  language: "English" | "Japanese",
  tcgplayerAbsent: string
): ComparisonRow[] {
  const band = print?.tcgplayer;
  return [
    {
      label: "TCGplayer",
      logo: "tcgplayer",
      amount: priceOrNull(band?.market),
      sample: band?.variant ? variantLabel(band.variant) : undefined,
      sampleTitle: band?.variant ? `${variantLabel(band.variant)} printing` : undefined,
      color: TCGPLAYER_COLOR,
      absent: tcgplayerAbsent,
    },
    ebayRow(data, "Raw", language, "eBay · raw", RAW_COLOR, "ebay"),
    ebayRow(data, "PSA 8", language, "PSA 8", PSA8_COLOR, null),
    ebayRow(data, "PSA 9", language, "PSA 9", PSA9_COLOR, null),
    ebayRow(data, "PSA 10", language, "PSA 10", PSA10_COLOR, null),
  ];
}

/** One decimal below 10x, none above — "17× a raw copy" reads better than "17.0×". */
function multiple(ratio: number): string {
  return ratio >= 10 ? `${ratio.toFixed(0)}×` : `${ratio.toFixed(1)}×`;
}

/**
 * The graded-versus-raw insight, computed from the bars the reader is
 * looking at rather than from a second source.
 *
 * The top grade is whichever PSA row actually has asks — usually PSA 10,
 * but a thin ladder can leave only PSA 8, and the sentence has to name the
 * grade it really used or the multiple is unattributable.
 */
/**
 * The photo of the cheapest listing in the tier the insight is about.
 *
 * `rows[0]` is genuinely the cheapest and not merely the first: eBay's Browse
 * API returns price-sorted results that are only sorted WITHIN shards (see
 * ebay-browse.ts, which measured two ascending runs concatenated), so
 * searchActiveListings re-sorts locally before slicing. That local sort is
 * what makes "cheapest" a fact here rather than a hope.
 *
 * Gated on `isReal` as well as on the row: an illustrative tier has rows and
 * prices but must never have a photo (see GradedMarketListingRow.imageUrl).
 */
function insightPhoto(
  data: GradedMarketData | null,
  top: ComparisonRow | undefined,
  language: "English" | "Japanese"
): InsightPhoto | undefined {
  if (!top) return undefined;
  const tier = activeTier(data, top.label, language);
  if (!tier?.isReal) return undefined;
  const cheapest = tier.rows[0];
  if (!cheapest?.imageUrl) return undefined;
  return {
    imageUrl: cheapest.imageUrl,
    alt: `Seller photo of the cheapest ${top.label} copy listed on eBay`,
    url: cheapest.url,
  };
}

function gradedInsight(
  rows: ComparisonRow[],
  currency: MarketCurrency,
  data: GradedMarketData | null,
  language: "English" | "Japanese"
): CollectorInsight {
  const raw = rows.find((r) => r.label.toLowerCase().includes("raw"));
  const top = rows.filter((r) => r.label.startsWith("PSA") && r.amount != null).at(-1);
  // Computed before the branch: a tier with no raw copy to compare against
  // still has a cheapest listing, and that listing still has a photo.
  const photo = insightPhoto(data, top, language);

  if (!raw?.amount || !top?.amount) {
    return {
      art: "psa-slab",
      photo,
      headline: "No graded-versus-raw comparison today",
      support:
        raw?.amount == null && top?.amount == null
          ? "Neither a raw nor a graded copy has an active ask on eBay right now."
          : raw?.amount == null
            ? "No raw copy is on the market to compare a graded one against."
            : "No graded copy has an active ask to compare against the raw one.",
      ratio: null,
    };
  }

  const ratio = top.amount / raw.amount;
  return {
    art: "psa-slab",
    photo,
    headline: `${top.label} asks ${multiple(ratio)} a raw copy`,
    support: `${formatMarketMoney(top.amount, currency)} graded versus ${formatMarketMoney(raw.amount, currency)} raw on eBay.`,
    ratio: multiple(ratio),
  };
}

/**
 * The print comparison, and the one place two prints genuinely compare:
 * Cardmarket sells both, in one currency, to the same buyers. Nothing is
 * converted and nothing crosses a marketplace.
 */
function printInsight(westernTrend: number | null, japaneseTrend: number | null): CollectorInsight {
  if (!westernTrend || !japaneseTrend) {
    return {
      art: "print-comparison",
      headline: "No print comparison available",
      support: !japaneseTrend
        ? "Cardmarket publishes no trend for the Japanese print of this card."
        : "Cardmarket publishes no trend for the Western print of this card.",
      ratio: null,
    };
  }

  const ratio = japaneseTrend / westernTrend;
  const both = `${formatMarketMoney(japaneseTrend, "EUR")} versus ${formatMarketMoney(westernTrend, "EUR")} for the Western print.`;

  if (ratio >= 1.15) {
    return {
      art: "print-comparison",
      headline: `Japanese print trends ${multiple(ratio)} higher`,
      support: both,
      ratio: multiple(ratio),
    };
  }
  if (ratio <= 0.87) {
    return {
      art: "print-comparison",
      headline: `Western print trends ${multiple(1 / ratio)} higher`,
      support: both,
      ratio: multiple(1 / ratio),
    };
  }
  return {
    art: "print-comparison",
    headline: "Both prints trend within reach of each other",
    support: both,
    ratio: null,
  };
}

/* ------------------------------------------------------------------ *
 * Valuation cards                                                     *
 * ------------------------------------------------------------------ */

/**
 * TCGplayer's spread, mapped to the words a collector uses.
 *
 * `mid` is TCGplayer's own mid-point of the live listings, which is the
 * TYPICAL ask rather than a second market price — the distinction the note
 * under this block exists to make. `directLow` is the cheapest copy sold
 * through TCGplayer Direct, so it is labelled by who is selling it rather
 * than by its rank.
 */
function tcgplayerValuation(card: Card, priceKnown: boolean, unlisted: boolean): MarketValuation {
  const band = card.tcgplayer;
  // `currentPrice` is only a USD figure when the card's own currency is USD:
  // a One Piece card whose only source is BerryWallet's Japanese catalogue
  // carries a real EUR price there (see lib/types.ts), and printing it under
  // a dollar sign would relabel a euro.
  const headline = priceOrNull(band?.market) ?? (card.currency === "USD" && priceKnown ? priceOrNull(card.currentPrice) : null);

  const headlineAbsent = unlisted
    ? "Not listed"
    : priceKnown
      ? "Not published"
      : "Temporarily unavailable";

  const headlineBasis = unlisted
    ? "TCGplayer carries no listing for this print"
    : priceKnown
      ? "What buyers recently paid on TCGplayer"
      : "Our price sources could not be reached for this card";

  return {
    logo: "tcgplayer",
    sourceName: "TCGplayer",
    sourceContext: `US market${band?.variant ? ` · ${variantLabel(band.variant)}` : ""}`,
    currency: "USD",
    headlineLabel: "Current market value",
    headline,
    headlineAbsent,
    headlineBasis,
    saleChip: null,
    stats: [
      { label: "Lowest listing", amount: priceOrNull(band?.low), absent: "No asks" },
      { label: "Typical listing", amount: priceOrNull(band?.mid), absent: "No asks" },
      { label: "Direct seller", amount: priceOrNull(band?.directLow), absent: "No Direct copy" },
      { label: "Highest listing", amount: priceOrNull(band?.high), absent: "No asks" },
    ],
    // A real title per case, not the generic "What this means" repeated on
    // every tab — the label is a caption now that the ⓘ badge is gone (see
    // WhatThisMeans), so it has to carry the point on its own.
    note: {
      title: headline == null ? "Why there's no price" : "Recent sales vs. asks",
      segments:
        headline == null
          ? [
              {
                text: unlisted
                  ? "TCGplayer has no product for this print, so there is no market value to quote. Its price on the English print is a different card."
                  : "No market value could be read for this card today. The listing prices above, where present, are seller asks rather than sales.",
              },
            ]
          : [
              { text: formatMarketMoney(headline, "USD"), strong: true },
              { text: " is what buyers recently paid. The four prices above are seller asks, so they may be higher." },
            ],
    },
    url: card.sourceUrl,
    actionLabel: "View on TCGplayer",
  };
}

/**
 * Cardmarket's own rows, in Cardmarket's own words.
 *
 * `trend` is Cardmarket's considered valuation and leads; `low` is whatever
 * the cheapest seller happens to be asking today and sits in the grid. The
 * note between them exists because a reader who takes the trend for a buy-now
 * price is the single most likely misreading on this tab.
 */
function cardmarketValuation(
  card: Card | undefined,
  print: "western" | "japanese",
  { hasWestern, region }: { hasWestern: boolean; region?: MarketRegion }
): MarketValuation {
  const cm = card?.cardmarket;
  const trend = priceOrNull(cm?.trend);
  const low = priceOrNull(cm?.low);
  const avg = priceOrNull(cm?.avg);

  const absentReason = !card
    ? print === "japanese"
      ? "No Japanese print resolved for this card."
      : "No Western print resolved for this card."
    : !cm
      ? print === "japanese"
        ? hasWestern
          ? "No Japanese Cardmarket product resolved for this print. The Western listing prices a different product, so its figures are not repeated here."
          : "No Japanese Cardmarket product resolved for this print."
        : "No Cardmarket product resolved for this card."
      : "Cardmarket lists this print, but no price feed we use publishes a trend for it yet.";

  const segments: NoteSegment[] =
    trend == null
      ? [{ text: absentReason }]
      : print === "japanese"
        ? [
            { text: formatMarketMoney(trend, "EUR"), strong: true },
            { text: " comes from European Cardmarket data. US marketplace and graded-card prices are shown separately in " },
            { text: "USD", strong: true },
            { text: "." },
          ]
        : low != null
          ? [
              { text: formatMarketMoney(trend, "EUR"), strong: true },
              { text: " is Cardmarket’s reference trend — not today’s cheapest offer. If you are buying now, listings start at " },
              { text: formatMarketMoney(low, "EUR"), strong: true },
              { text: "." },
            ]
          : [
              { text: formatMarketMoney(trend, "EUR"), strong: true },
              { text: " is Cardmarket’s reference trend — not today’s cheapest offer. No live listing price is published for this card right now." },
            ];

  // A real title per case, same reasoning as tcgplayerValuation's own note:
  // the JA branch is not "trend vs. cheapest" at all, it is two currencies
  // side by side, and the old shared "What this means" said neither.
  const noteTitle =
    trend == null ? "Why there's no price" : print === "japanese" ? "Two currencies, not converted" : "Trend vs. cheapest offer";

  return {
    logo: "cardmarket",
    region,
    sourceName: "Cardmarket",
    sourceContext: print === "japanese" ? "EU market · Japanese print" : "EU market · Western print",
    currency: "EUR",
    headlineLabel: "Current market trend",
    headline: trend,
    headlineAbsent: card && cm ? "Not published" : "No listing",
    headlineBasis:
      print === "japanese"
        ? "The Japanese print’s own European listing"
        : "One European listing, covering EN · FR · IT · DE · ES · PT copies",
    saleChip: avg == null ? null : { label: "Average sell", amount: avg },
    stats: [
      { label: "Lowest listing", amount: low, absent: "No asks" },
      { label: "30-day avg", amount: priceOrNull(cm?.avg30), absent: "Not published" },
      { label: "7-day avg", amount: priceOrNull(cm?.avg7), absent: "Not published" },
      { label: "1-day avg", amount: priceOrNull(cm?.avg1), absent: "Not published" },
    ],
    note: { title: noteTitle, segments },
    url: cm?.url,
    actionLabel: "View on Cardmarket",
  };
}

/* ------------------------------------------------------------------ *
 * The three views                                                     *
 * ------------------------------------------------------------------ */

export type MarketViewInput = {
  /** The Western print — the card this page is about. Always present. */
  westernCard: Card;
  /** The Japanese print, when this card has one resolved. */
  japaneseCard?: Card;
  /** Fetched once in page.tsx; null when eBay could not be reached at all. */
  gradedMarket: GradedMarketData | null;
  /** Whether a canonical price resolved at all — a fact about the card, not about the tab. */
  priceKnown: boolean;
};

export function buildMarketViews({
  westernCard,
  japaneseCard,
  gradedMarket,
  priceKnown,
}: MarketViewInput): MarketView[] {
  const asOf = westernCard.asOfDate;

  /* ---- US ---- */
  const usRows = usdRows(gradedMarket, westernCard, "English", "No listing");
  const us: MarketView = {
    id: "US",
    tabLabel: MARKET_TAB_META.US.label,
    tabHint: MARKET_TAB_META.US.hint,
    heading: "US market valuation",
    chips: [
      { text: "US market", tone: "region-us" },
      { text: "English print", tone: "plain" },
      { text: "USD", tone: "currency", srText: "Prices in US dollars" },
      { text: `Priced ${asOf}`, tone: "plain" },
    ],
    valuation: tcgplayerValuation(westernCard, priceKnown, false),
    intelligence: {
      kind: "bars",
      title: "Market comparison",
      subtitle: "Raw and graded references",
      vizLabel: "Price position",
      vizTitle: "US marketplace asks",
      currency: "USD",
      rows: usRows,
      isReal: ebayIsReal(gradedMarket, "English"),
      insight: gradedInsight(usRows, "USD", gradedMarket, "English"),
      footer: { scopeLabel: "Scope", scope: "English print · US sources · asks unless marked as sales." },
    },
    footnote: "One regional market · one print scope · one currency.",
  };

  /* ---- EU ---- */
  const euValuation = cardmarketValuation(westernCard, "western", { hasWestern: Boolean(westernCard.cardmarket) });
  const euTrend = priceOrNull(westernCard.cardmarket?.trend);
  const jaTrend = priceOrNull(japaneseCard?.cardmarket?.trend);
  const points: TrendPoint[] = [
    { label: "30-day average", shortLabel: "30-day", amount: priceOrNull(westernCard.cardmarket?.avg30) },
    { label: "7-day average", shortLabel: "7-day", amount: priceOrNull(westernCard.cardmarket?.avg7) },
    { label: "1-day average", shortLabel: "1-day", amount: priceOrNull(westernCard.cardmarket?.avg1) },
  ];
  const plotted = points.filter((p) => p.amount != null);

  const eu: MarketView = {
    id: "EU",
    tabLabel: MARKET_TAB_META.EU.label,
    tabHint: MARKET_TAB_META.EU.hint,
    heading: "EU market valuation",
    chips: [
      { text: "EU market", tone: "region" },
      { text: "Western print", tone: "plain" },
      { text: "EUR", tone: "currency", srText: "Prices in euros" },
      { text: `Priced ${asOf}`, tone: "plain" },
    ],
    valuation: euValuation,
    intelligence: {
      kind: "trend",
      title: "Market trend",
      subtitle: "European price momentum",
      vizLabel: "Average price",
      vizTitle: "European trend at a glance",
      currency: "EUR",
      points,
      chartDescription:
        plotted.length === 0
          ? "Cardmarket publishes no trailing averages for this card yet, so there is no trend to plot."
          : `Cardmarket’s average price for this card: ${plotted
              .map((p) => `${p.label} ${formatMarketMoney(p.amount as number, "EUR")}`)
              .join(", ")}.`,
      insight: printInsight(euTrend, jaTrend),
      footer: {
        scopeLabel: "Scope",
        scope: "Western print · Cardmarket's own trailing averages, not asks.",
      },
    },
    footnote: "EU valuation stays in EUR · US figures live on their own tabs and are never converted.",
  };

  /* ---- JA ---- */
  const jaRows = usdRows(
    gradedMarket,
    japaneseCard,
    "Japanese",
    // "Not in our sources", not "no listing". Only PokéWallet establishes the
    // second — it returns an empty `prices` array for a print TCGplayer does
    // not carry. BerryWallet returns `tcgplayer: null` on every Japanese One
    // Piece row, which says BerryWallet has no figures and nothing at all
    // about TCGplayer.
    japaneseCard?.franchise === "one-piece" ? "Not in our sources" : "No listing"
  );
  const ja: MarketView = {
    id: "JA",
    tabLabel: MARKET_TAB_META.JA.label,
    tabHint: MARKET_TAB_META.JA.hint,
    heading: "Japanese market valuation",
    chips: [
      { text: "Europe · EUR", tone: "region", srText: "European market, prices in euros" },
      { text: "Japanese print", tone: "plain" },
      { text: "United States · USD", tone: "region-us", srText: "United States market, prices in US dollars" },
      { text: `Priced ${asOf}`, tone: "plain" },
    ],
    valuation: cardmarketValuation(japaneseCard, "japanese", {
      hasWestern: Boolean(westernCard.cardmarket),
      region: { badge: "EU", title: "European market", subtitle: "Cardmarket · Japanese print", tone: "eu" },
    }),
    intelligence: {
      kind: "bars",
      region: { badge: "US", title: "United States market", subtitle: "TCGplayer · eBay · PSA", tone: "us" },
      title: "United States market",
      subtitle: "TCGplayer · eBay · PSA",
      vizLabel: "Price position",
      vizTitle: "US marketplace asks",
      currency: "USD",
      rows: jaRows,
      isReal: ebayIsReal(gradedMarket, "Japanese"),
      insight: gradedInsight(jaRows, "USD", gradedMarket, "Japanese"),
      footer: {
        scopeLabel: "European reference",
        scope:
          jaTrend == null
            ? "Cardmarket publishes no trend for this print."
            : `Cardmarket trend ${formatMarketMoney(jaTrend, "EUR")} EUR, shown in full under European market.`,
      },
    },
    footnote: "Same Japanese print · each region keeps its own source and its own currency.",
  };

  return [us, eu, ja];
}
