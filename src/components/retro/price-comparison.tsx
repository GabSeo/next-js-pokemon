"use client";

import { motion, useReducedMotion, type Transition } from "motion/react";

import type { Currency } from "@/components/product-locale";

import { DEFAULT_CHART_ENTER_TRANSITION } from "@/components/charts/animation";
import type { GradedMarketData, GradedMarketTypeData } from "@/lib/graded-market";
import type { Market } from "@/lib/market-config";
import type { Card } from "@/lib/types";

/**
 * Every real price we hold for one market, as one scannable comparison.
 *
 * Sits beside the market card, driven by the same single toggle — no control
 * of its own. The card answers "what is it worth here" in detail; these bars
 * answer "compared to what" in a glance.
 *
 * ONE CURRENCY PER MARKET, and that is what makes the bars honest. Bar length
 * is the whole point of this layout, and lengths only compare in the same
 * unit. The US and Japanese views are entirely USD (both read US marketplaces
 * — TCGplayer and eBay); the EU view is entirely EUR (Cardmarket). Nothing is
 * ever converted, because a euro figure through an exchange rate is not a
 * dollar price.
 *
 * A ROW WITH NO DATA STILL PRINTS, with a hatched empty track and the reason
 * underneath. "PSA 8 · no active eBay asks" is a real answer about a thin
 * tier, and dropping the row would turn an absence into an omission. It also
 * keeps every figure on screen as TEXT rather than SVG geometry, which is what
 * lets an agent parsing raw HTML read this section — the reason these bars are
 * two divs and a percentage rather than a chart library.
 */

type Row = {
  label: string;
  amount: number | null;
  /**
   * What the median was drawn from, as a chip beside the label: "4/12", or
   * "holofoil" for a printing. It used to be a full sentence on its own line
   * per row — five of them, three of which read "median of the N cheapest of M
   * asks" — which is what made this card twice as tall as the market card it
   * sits beside.
   */
  sample?: string;
  /** The sentence the chip is short for, carried on `title` so the meaning stays in the markup. */
  sampleTitle?: string;
  color: string;
  /** Why this row is empty. Printed once, on the value side — it used to print on both. */
  absent?: string;
};

/**
 * The bars grow rather than appear, because growing IS the comparison — a
 * length arriving from zero is read as a magnitude, where six lengths appearing
 * at once are read as a picture. The stagger says the same thing about order:
 * raw first, then each grade above it.
 *
 * The house chart curve (components/charts/animation.ts) at roughly half its
 * duration. Same easing so this section and the price chart below it move the
 * same way; shorter because that curve was tuned for one long reveal and these
 * are six short ones behind a stagger, which would otherwise run past a second
 * and a half before the last bar settles.
 */
const FILL_TRANSITION: Transition = { ...DEFAULT_CHART_ENTER_TRANSITION, duration: 0.62 };

/** Each bar starts a beat after the one above it, so the eye reads them in order rather than as one block. */
const STAGGER_SECONDS = 0.055;

const RAW_COLOR = "#8a8a8a";
/**
 * Grade is ordinal, so its colours climb rather than being unrelated hues:
 * pale blue, green, then the brand yellow for the top grade. Worth stating
 * because the obvious mistake is giving PSA 8 and PSA 9 one colour, which
 * reads as a single series split across two rows.
 */
const PSA8_COLOR = "color-mix(in srgb, var(--pokemon-blue) 45%, #ffffff)";
const PSA9_COLOR = "#21c45d";
const PSA10_COLOR = "var(--pokemon-yellow)";
const TCGPLAYER_COLOR = "var(--pokemon-blue)";
const WESTERN_COLOR = "var(--pokemon-red)";
const JAPANESE_COLOR = "var(--pokemon-blue)";

/** Two decimals, matching the market card and the marketplaces' own display. */
function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function activeTier(data: GradedMarketData, condition: string, language: string): GradedMarketTypeData | undefined {
  return data.conditions.find((c) => c.condition === condition)?.languages.find((l) => l.language === language)?.active;
}

/**
 * One eBay tier as a row, with the depth behind it.
 *
 * The sample line is the cheapest credibility this section can buy: a median
 * drawn from three asks and one drawn from twenty-eight are different claims,
 * and saying which is the difference between a number and a number a reader
 * can weigh.
 *
 * The wording is exact on purpose. `medianPrice` is the median of the FEW
 * CHEAPEST asks we hold (`rows`), not of every listing eBay reports (`count`)
 * — so "median of 850 live asks" would be a straightforwardly false claim
 * about a figure computed from four. "4 cheapest of 850 asks" is what actually
 * happened.
 */
function ebayRow(data: GradedMarketData, condition: string, language: string, label: string, color: string): Row {
  const tier = activeTier(data, condition, language);
  if (!tier || tier.noListings || tier.medianPrice <= 0) {
    return { label, amount: null, color, absent: "No asks" };
  }
  const held = tier.rows.length;
  const all = held >= tier.count;
  return {
    label,
    amount: tier.medianPrice,
    sample: all ? `${tier.count} asks` : `${held}/${tier.count}`,
    sampleTitle: all
      ? `median of all ${tier.count} asks`
      : `median of the ${held} cheapest of ${tier.count} asks`,
    color,
  };
}

/**
 * The one line a reader should leave with, computed from the same figures the
 * bars draw. Dropped entirely rather than padded when the data cannot support
 * it — a sentence that says nothing is worse than no sentence.
 */
function takeaway(rows: Row[]): string | null {
  const find = (needle: string) => rows.find((r) => r.label.toLowerCase().includes(needle) && r.amount != null);

  // Which sentence applies is a question about the ROWS, not the market: the
  // currency filter means a market can show either shape.
  const west = find("western · trend");
  const jp = find("japanese · trend");
  if (west && jp) {
    if (!west.amount || !jp.amount) return null;
    const ratio = jp.amount / west.amount;
    if (ratio >= 1.15) return `The Japanese print trends ${ratio.toFixed(1)}× the Western one.`;
    if (ratio <= 0.87) return `The Western print trends ${(1 / ratio).toFixed(1)}× the Japanese one.`;
    return "Both prints trend within reach of each other.";
  }

  const raw = find("raw");
  const top = rows.filter((r) => r.label.startsWith("PSA") && r.amount != null).at(-1);
  if (!raw?.amount || !top?.amount) return null;
  // The multiple and nothing else. The premium in currency was true and it was
  // a second clause on a line that had already made its point, on a card whose
  // problem was length.
  const ratio = top.amount / raw.amount;
  return `${top.label} asks ${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}× a raw copy.`;
}

export function PriceComparison({
  card,
  japaneseCard,
  data,
  market,
}: {
  card: Card;
  /** The Japanese print, when this card has one — its own prices, not the Western card's. */
  japaneseCard?: Card;
  data: GradedMarketData;
  /** Driven by the section's single toggle; this component has no control of its own. */
  market: Market;
}) {
  // A property of the market, not a choice: American marketplaces price the US
  // view, Cardmarket prices the EU one. Bars only ever compare inside one
  // currency, which is the whole reason a length here means anything.
  const currency: Currency = market === "FR" ? "EUR" : "USD";

  /** The American marketplaces, for one print. */
  const usdRows = (language: "English" | "Japanese", print: Card | undefined, absent: string): Row[] => [
    {
      label: "TCGplayer",
      amount: print?.tcgplayer?.market ?? null,
      sample: print?.tcgplayer?.variant,
      sampleTitle: print?.tcgplayer?.variant ? `${print.tcgplayer.variant} printing` : undefined,
      color: TCGPLAYER_COLOR,
      absent,
    },
    ebayRow(data, "Raw", language, "eBay · raw", RAW_COLOR),
    ebayRow(data, "PSA 8", language, "PSA 8", PSA8_COLOR),
    ebayRow(data, "PSA 9", language, "PSA 9", PSA9_COLOR),
    ebayRow(data, "PSA 10", language, "PSA 10", PSA10_COLOR),
  ];

  /** Cardmarket, for one print. Trend first, because it is Cardmarket's own considered valuation. */
  const eurRows = (print: Card | undefined, label: string, color: string): Row[] => [
    { label: `${label} · trend`, amount: print?.cardmarket?.trend ?? null, color, absent: "No listing" },
    { label: `${label} · from`, amount: print?.cardmarket?.low ?? null, color, absent: "Not published" },
    { label: `${label} · 30-day`, amount: print?.cardmarket?.avg30 ?? null, color, absent: "Not published" },
  ];

  const views: Record<Market, { intro: string; rows: Row[] }> = {
    US: { intro: "English print · TCGplayer and eBay", rows: usdRows("English", card, "No listing") },
    JP: {
      intro: "Japanese print · bars are US marketplaces, Cardmarket below in EUR",
      // "Not in our sources", not "no listing". Only PokéWallet establishes the
      // second — it returns an empty `prices` array for a print TCGplayer does
      // not carry. BerryWallet returns `tcgplayer: null` on every Japanese One
      // Piece row, which says BerryWallet has no figures and nothing at all
      // about TCGplayer.
      rows: usdRows("Japanese", japaneseCard, "Not in our sources"),
    },
    // The one view where two prints compare directly: Cardmarket sells both, in
    // one currency, to the same buyers.
    FR: {
      intro: "Cardmarket · both prints, same buyers",
      rows: [...eurRows(card, "Western", WESTERN_COLOR), ...eurRows(japaneseCard, "Japanese", JAPANESE_COLOR)],
    },
  };

  // Hook, so it must sit above the early-return-free render below; Motion
  // reads the OS setting rather than a media query we would have to maintain.
  const reduceMotion = useReducedMotion();

  const view = views[market] ?? views.US;
  // Scale is the dearest row in THIS view, so every bar is measured against
  // something in its own currency and nothing is compared across views.
  const scale = Math.max(...view.rows.map((r) => r.amount ?? 0), 0);
  const headline = takeaway(view.rows);

  return (
    <div className="flex flex-col rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">Price comparison</h3>
        {/* States what this card is showing; the page bar is what changes it. */}
        <span className="rounded-full border-2 border-black bg-muted-surface px-2 py-0.5 text-[10px] font-black tracking-[0.4px] uppercase">
          {currency}
        </span>
      </div>

      {/* The takeaway, before the evidence. A reader who reads nothing else
          should still leave with the one fact these bars exist to show. */}
      {headline && <p className="mt-2 mb-3.5 text-[15px] leading-[21px] font-black text-pretty">{headline}</p>}

      {/* `key={market}` remounts the list when the toggle moves, so the bars
          refill instead of silently swapping to different lengths. The lengths
          are the content here, and content that changes without moving is
          content a reader can miss. */}
      <dl className="flex-1" key={`${market}-${currency}`}>
        {view.rows.map((row, index) => (
          <div className="mb-2.5 last:mb-0" key={row.label}>
            {/* One line: what it is on the left, what it costs on the right,
                and the depth behind it as a chip between them. Three lines per
                row is what made this card outgrow the market card beside it. */}
            <div className="flex items-baseline justify-between gap-2">
              <dt className="flex items-baseline gap-1.5 overflow-hidden">
                <span className="truncate text-sm font-black tracking-[-0.2px]">{row.label}</span>
                {row.sample && (
                  <span
                    className="shrink-0 rounded-sm bg-muted-surface px-1 py-px text-[9px] font-black tracking-[0.2px] text-muted-text uppercase"
                    title={row.sampleTitle}
                  >
                    {row.sample}
                  </span>
                )}
              </dt>
              <dd
                className={`shrink-0 font-black whitespace-nowrap tabular-nums ${row.amount == null ? "text-[12px] text-muted-text" : "text-[15px]"}`}
              >
                {row.amount == null ? (row.absent ?? "—") : money(row.amount, currency)}
              </dd>
            </div>

            {/* A track behind every bar, so proportion is read against a fixed
                baseline rather than against whichever neighbour happens to sit
                next to it. An absent row keeps the track and hatches it: the
                row rhythm survives, and "nothing here" stays visibly different
                from "a very small number". */}
            <div className="mt-1 h-2.5 overflow-hidden rounded-full border-2 border-black bg-muted-surface">
              {row.amount != null && scale > 0 && (
                <motion.div
                  // ONLY the fill animates. The labels, the figures and the
                  // sample lines are never hidden, not even for a frame: they
                  // are the content, they are what an agent reads out of the
                  // raw HTML, and animating them means server-rendering them at
                  // opacity 0 and showing a blank card until hydration.
                  animate={{ scaleX: 1 }}
                  className="h-full origin-left rounded-full"
                  // `false` rather than a zero-duration transition: with
                  // reduced motion the bar must be full length on first paint,
                  // not animated quickly.
                  initial={reduceMotion ? false : { scaleX: 0 }}
                  style={{
                    backgroundColor: row.color,
                    // A floor so the cheapest row stays a visible mark rather
                    // than a sliver that reads as a rendering fault.
                    width: `${Math.max(4, (row.amount / scale) * 100)}%`,
                  }}
                  transition={{ ...FILL_TRANSITION, delay: index * STAGGER_SECONDS }}
                />
              )}
              {row.amount == null && (
                <div
                  className="h-full w-full"
                  style={{
                    backgroundImage: "repeating-linear-gradient(135deg, #d8d5cc 0 5px, transparent 5px 10px)",
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </dl>

      {/* Three facts, not three sentences. Everything a reader needs to not
          misread a bar: what full width means, that lengths never cross a
          currency, and that eBay figures are asks rather than sales. */}
      {/* The Japanese print's Cardmarket trend, on the JA view only, and
          DELIBERATELY NOT A BAR. Every bar in that view is USD — TCGplayer and
          eBay — and Cardmarket quotes euros; a euro drawn to a dollar scale is
          a false length, and converting it would invent a number no marketplace
          published. So the figure gets a line of its own outside the scale.

          It earns the space because the Japanese print is the one card two
          marketplaces both really carry: this is the European half of the same
          product the bars above price in America. US and EU need no such line —
          one marketplace each is the whole truth for them. */}
      {market === "JP" && japaneseCard?.cardmarket?.trend != null && (
        <div className="mt-3 flex items-baseline justify-between gap-2 border-t-2 border-dashed border-border-subtle pt-2.5">
          <span className="text-[11px] font-black tracking-[0.3px] text-muted-text uppercase">Cardmarket · trend</span>
          <span className="text-sm font-black tabular-nums">{money(japaneseCard.cardmarket.trend, "EUR")}</span>
        </div>
      )}

      {/* Everything a reader needs to not misread a bar, in one line instead of
          an intro paragraph above and two lines of small print below. `n/m`
          expands on hover via each chip's own title. */}
      <p className="mt-3 border-t-2 border-dashed border-border-subtle pt-2.5 text-[10px] font-bold text-pretty text-muted-text">
        {/* "asks, not sales" is about the eBay rows, so it only appears when
            there are eBay rows — the EUR view is Cardmarket's own published
            figures and the caveat would be describing nothing. */}
        {view.intro} · Dearest = 100% · {currency === "USD" ? "asks, not sales · " : ""}never converted.
      </p>
    </div>
  );
}
