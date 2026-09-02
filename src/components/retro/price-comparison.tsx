"use client";

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
  /** What the median was drawn from, when it came from listings we counted. */
  sample?: string;
  color: string;
  /** Why this row is empty — printed under the label, never left blank. */
  absent?: string;
};

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
    return { label, amount: null, color, absent: "No active eBay asks" };
  }
  const held = tier.rows.length;
  return {
    label,
    amount: tier.medianPrice,
    sample: held >= tier.count ? `median of all ${tier.count} asks` : `median of the ${held} cheapest of ${tier.count} asks`,
    color,
  };
}

/**
 * The one line a reader should leave with, computed from the same figures the
 * bars draw. Dropped entirely rather than padded when the data cannot support
 * it — a sentence that says nothing is worse than no sentence.
 */
function takeaway(rows: Row[], market: Market, currency: string): string | null {
  const find = (needle: string) => rows.find((r) => r.label.toLowerCase().includes(needle) && r.amount != null);

  if (market === "FR") {
    const west = find("western · trend");
    const jp = find("japanese · trend");
    if (!west?.amount || !jp?.amount) return null;
    const ratio = jp.amount / west.amount;
    if (ratio >= 1.15) return `The Japanese print trends ${ratio.toFixed(1)}× the Western one in euros.`;
    if (ratio <= 0.87) return `The Western print trends ${(1 / ratio).toFixed(1)}× the Japanese one in euros.`;
    return "Both prints trend within reach of each other in euros.";
  }

  const raw = find("raw");
  const top = rows.filter((r) => r.label.startsWith("PSA") && r.amount != null).at(-1);
  if (!raw?.amount || !top?.amount) return null;
  const ratio = top.amount / raw.amount;
  const premium = top.amount - raw.amount;
  return `${top.label} asks ${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}× a raw copy — ${money(premium, currency)} of that price is the grade.`;
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
  const views: Record<Market, { label: string; currency: string; intro: string; rows: Row[] }> = {
    US: {
      label: "US · USD",
      currency: "USD",
      intro: "English print · TCGplayer and eBay.",
      rows: [
        {
          label: "TCGplayer",
          amount: card.tcgplayer?.market ?? card.currentPrice ?? null,
          sample: card.tcgplayer?.variant ? `${card.tcgplayer.variant} printing` : undefined,
          color: TCGPLAYER_COLOR,
          absent: "No listing",
        },
        ebayRow(data, "Raw", "English", "eBay · raw", RAW_COLOR),
        ebayRow(data, "PSA 8", "English", "PSA 8", PSA8_COLOR),
        ebayRow(data, "PSA 9", "English", "PSA 9", PSA9_COLOR),
        ebayRow(data, "PSA 10", "English", "PSA 10", PSA10_COLOR),
      ],
    },
    JP: {
      label: "Japanese · USD",
      currency: "USD",
      intro: "Japanese print · same US marketplaces, so it compares with the US view.",
      rows: [
        {
          label: "TCGplayer",
          amount: japaneseCard?.tcgplayer?.market ?? null,
          color: TCGPLAYER_COLOR,
          // "Not in our sources", not "no listing". Only PokéWallet actually
          // establishes the second — it returns an empty `prices` array for a
          // print TCGplayer does not carry. BerryWallet returns
          // `tcgplayer: null` on every Japanese One Piece row, which says
          // BerryWallet has no figures and nothing at all about TCGplayer. The
          // strip under the market card makes the same distinction; this row
          // takes the weaker claim because it has to cover both franchises.
          absent: "Not in our sources for this print",
        },
        ebayRow(data, "Raw", "Japanese", "eBay · raw", RAW_COLOR),
        ebayRow(data, "PSA 8", "Japanese", "PSA 8", PSA8_COLOR),
        ebayRow(data, "PSA 9", "Japanese", "PSA 9", PSA9_COLOR),
        ebayRow(data, "PSA 10", "Japanese", "PSA 10", PSA10_COLOR),
      ],
    },
    FR: {
      label: "Western / EU · EUR",
      currency: "EUR",
      // The one view where the two prints compare directly: Cardmarket sells
      // both, in one currency, to the same buyers.
      intro: "Cardmarket prices both prints for the same buyers — the only direct print-to-print read.",
      rows: [
        { label: "Western · trend", amount: card.cardmarket?.trend ?? null, color: WESTERN_COLOR, absent: "No listing" },
        { label: "Western · from", amount: card.cardmarket?.low ?? null, color: WESTERN_COLOR, absent: "Not published" },
        {
          label: "Western · 30-day",
          amount: card.cardmarket?.avg30 ?? null,
          color: WESTERN_COLOR,
          absent: "Not published",
        },
        {
          label: "Japanese · trend",
          amount: japaneseCard?.cardmarket?.trend ?? null,
          color: JAPANESE_COLOR,
          absent: "No listing",
        },
        {
          label: "Japanese · from",
          amount: japaneseCard?.cardmarket?.low ?? null,
          color: JAPANESE_COLOR,
          absent: "Not published",
        },
        {
          label: "Japanese · 30-day",
          amount: japaneseCard?.cardmarket?.avg30 ?? null,
          color: JAPANESE_COLOR,
          absent: "Not published",
        },
      ],
    },
  };

  const view = views[market] ?? views.US;
  // Scale is the dearest row in THIS view, so every bar is measured against
  // something in its own currency and nothing is compared across views.
  const scale = Math.max(...view.rows.map((r) => r.amount ?? 0), 0);
  const headline = takeaway(view.rows, market, view.currency);

  return (
    <div className="flex flex-col rounded-lg border-2 border-black bg-card-surface p-6 shadow-hard-md">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-black tracking-[0.6px] text-pokemon-blue uppercase">Price comparison</h3>
        <span className="rounded-full border-2 border-black bg-muted-surface px-2 py-0.5 text-[10px] font-black tracking-[0.4px] uppercase">
          {view.label}
        </span>
      </div>

      {/* The takeaway, before the evidence. A reader who reads nothing else
          should still leave with the one fact these bars exist to show. */}
      {headline && <p className="mt-2.5 text-[15px] leading-[21px] font-black text-pretty">{headline}</p>}
      <p className="mt-1.5 mb-4 text-[11px] font-bold text-pretty text-muted-text">{view.intro}</p>

      <dl className="flex-1">
        {view.rows.map((row) => (
          <div className="mb-3.5 last:mb-0" key={row.label}>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm font-black tracking-[-0.2px] whitespace-nowrap">{row.label}</dt>
              <dd
                className={`font-black whitespace-nowrap tabular-nums ${row.amount == null ? "text-[13px] text-muted-text" : "text-[15px]"}`}
              >
                {row.amount == null ? (row.absent ?? "—") : money(row.amount, view.currency)}
              </dd>
            </div>

            {(row.sample || row.amount == null) && (
              <p className="text-[10px] font-bold text-muted-text">{row.amount == null ? row.absent : row.sample}</p>
            )}

            {/* A track behind every bar, so proportion is read against a fixed
                baseline rather than against whichever neighbour happens to sit
                next to it. An absent row keeps the track and hatches it: the
                row rhythm survives, and "nothing here" stays visibly different
                from "a very small number". */}
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full border-2 border-black bg-muted-surface">
              {row.amount != null && scale > 0 && (
                <div
                  className="h-full rounded-full"
                  style={{
                    backgroundColor: row.color,
                    // A floor so the cheapest row stays a visible mark rather
                    // than a sliver that reads as a rendering fault.
                    width: `${Math.max(4, (row.amount / scale) * 100)}%`,
                  }}
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
      <p className="mt-4 border-t-2 border-dashed border-border-subtle pt-3 text-[10px] font-bold text-pretty text-muted-text">
        Dearest row = 100% · one currency per view, never converted · eBay medians are asks, not sales.
      </p>
    </div>
  );
}
