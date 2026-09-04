"use client";

import type { ReactNode } from "react";

import { ListingPhoto } from "@/components/retro/grading-ds";
import { MarketImage } from "@/components/retro/market-image";
import { MARKET_ART, MARKET_LOGOS, type MarketLogoId } from "@/lib/market-assets";
import {
  formatMarketMoney,
  type CollectorInsight,
  type MarketContextChip,
  type MarketCurrency,
  type MarketNote,
  type MarketRegion,
  type MarketScope,
} from "@/lib/market-views";

/**
 * The pieces every tab of the Real-time market data section is built from.
 *
 * The three views publish different figures from different marketplaces and
 * must never be merged into one "global price" — but the SHAPE they are
 * presented in has to be identical, because a reader switching tabs is
 * comparing markets, and any difference in layout would read as a difference
 * in the data.
 *
 * THE ANCHORS BELOW ARE THE WHOLE POINT. Each block of the two cards is
 * pinned to a fixed height at `lg:` and up, so the headline figure, the
 * statistics grid, the explanatory note and the source link land on the same
 * pixel row in all three tabs. Switching tabs then moves content without
 * moving the page — no reflow, no scroll jump, nothing under the cursor
 * changing place. Below `lg:` the anchors are dropped and every block is
 * auto-height: a 375px column cannot honour a desktop rhythm without either
 * clipping a sentence or padding out a card with dead air, and there is no
 * side-by-side comparison to preserve once the cards are stacked.
 */

/** The card headers, at every width — the one anchor that also holds on mobile, because it is the line that names the market. */
export const ANCHOR_HEAD = "min-h-[64px]";
/** Headline figure block. */
export const ANCHOR_VALUE = "lg:h-[140px]";
/**
 * The 2x2 statistics grid, and the LEFT card's elastic block.
 *
 * A minimum plus flex-1, not a fixed height. The two cards are forced to equal
 * height, the right one is always the taller, and the difference used to land
 * as one dead gap above "View on TCGplayer" — 135px of nothing at the bottom
 * of a card that looked finished 135px earlier. Now the four stat cells absorb
 * it: the same slack becomes breathing room INSIDE bordered boxes, which reads
 * as calm rather than as a card that ran out of things to say.
 */
export const ANCHOR_STATS = "lg:min-h-[152px] lg:flex-1";
/** "What this means". Generous: two lines of copy at this column width is ~40px, so nothing is at risk of clipping. */
export const ANCHOR_NOTE = "lg:min-h-[84px]";
/** The visualisation — comparison bars on US/JA, the trend chart on EU. The RIGHT card's elastic block, for the same reason as ANCHOR_STATS. */
export const ANCHOR_VIZ = "lg:min-h-[300px] lg:flex-1";
/** Collector insight. */
/** Kept for the skeleton, which still reserves the insight band's box below the grid. */
export const ANCHOR_INSIGHT = "lg:h-[112px]";
/**
 * The row itself.
 *
 * Sized to what the cards actually hold rather than to a round number. It was
 * 560px against 448px of content, so both columns carried ~100px of reserved
 * emptiness before either card had a chance to fill it — the flat, uniform
 * blankness this section was criticised for. The floor still exists so a tab
 * whose note runs short cannot shrink the panel, it is just no longer larger
 * than every tab's content.
 *
 * 496 is the TALLEST tab measured, not the shortest. Left to their natural
 * heights the three came out 483 / 487 / 496, so the panel stepped 13px as a
 * reader moved between markets. Held at the tallest, the two elastic blocks
 * above absorb that difference on the shorter tabs instead: nothing moves
 * between tabs, and nothing sits empty.
 */
export const ANCHOR_PANEL = "lg:min-h-[496px]";

/**
 * The hard-bordered surface both cards sit on — the site's standard card, not
 * a new one.
 *
 * `tone` adds a coloured spine down the card's leading edge, and is set only
 * on the Japanese view where a European and a US card share one panel. It is
 * confirmation, never information: the card's header names its market in
 * words and its currency badge states the unit, both of which survive the
 * colour being invisible to the reader.
 */
export function MarketCard({
  children,
  className = "",
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: MarketRegion["tone"];
}) {
  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface ${className}`}
      style={{
        boxShadow: tone
          ? `inset 5px 0 0 0 ${tone === "eu" ? "var(--pokemon-blue)" : "var(--pokemon-red)"}, var(--shadow-md)`
          : "var(--shadow-md)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * The header strip: who the figures come from, then the badges that qualify
 * them.
 *
 * `flex-nowrap` is load-bearing. Allowed to wrap, the badge group dropped to a
 * second line on whichever card had the longer name — which made that card's
 * header ~12px taller than its neighbour's and pushed everything under it out
 * of alignment, on the one row where the two cards are meant to be read
 * across. The name truncates instead; it is repeated in full by the tab, the
 * panel heading and the source link.
 */
export function MarketCardHead({ children, tint = "" }: { children: ReactNode; tint?: string }) {
  return (
    <div
      className={`flex flex-nowrap items-center justify-between gap-x-3 border-b-2 border-black px-5 py-3 ${tint || "bg-muted-surface"} ${ANCHOR_HEAD}`}
    >
      {children}
    </div>
  );
}

/**
 * A marketplace logo beside its own name.
 *
 * The logo is a real `<img>` in a fixed 36x30 box (see lib/market-assets.ts),
 * so replacing today's placeholder with the licensed artwork changes nothing
 * about the layout. The NAME is always present in text beside it — the mark
 * is recognition, never the only way to know which marketplace this is.
 */
export function SourceLockup({
  logo,
  name,
  context,
}: {
  /**
   * Optional. The valuation card (left panel, every tab) always passes one —
   * that is the one place a TCGplayer/Cardmarket mark belongs. The trend
   * card's own header (EU's right panel) omits it: the source is already
   * named in text here and in full, with its own logo, one column to the
   * left, and repeating the mark on the same card pair said nothing a second
   * time that the first mark hadn't already said.
   */
  logo?: MarketLogoId;
  name: string;
  context: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {logo && <MarketImage asset={MARKET_LOGOS[logo]} className="rounded-sm border-2 border-border-subtle bg-white" />}
      <span className="flex min-w-0 flex-col">
        <b className="truncate text-xs font-black tracking-[0.3px] uppercase">{name}</b>
        <small className="truncate text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">{context}</small>
      </span>
    </span>
  );
}

/**
 * A market's own identity, for the Japanese view where two of them share a
 * panel.
 *
 * Reads as "EUROPEAN MARKET · Cardmarket · Japanese print" — the market in
 * full words, then the source under it, then the source's own mark.
 *
 * NO COLOURED BADGE. It used to lead with a two-letter tinted chip — blue
 * "EU", red "US" — ahead of the title that already says "European market" /
 * "United States market" in full. The chip was a shorthand for words sitting
 * right next to it, never appeared without them, and the tint was
 * "confirmation only" by this file's own original rule (see
 * REGION_HEAD_TINT) — so removing it drops zero information, only the two
 * things restating it.
 */
export function RegionLockup({ region, logo }: { region: MarketRegion; logo: MarketLogoId }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <MarketImage
        asset={MARKET_LOGOS[logo]}
        className="hidden rounded-sm border-2 border-border-subtle bg-white sm:block"
      />
      <span className="flex min-w-0 flex-col">
        <b className="truncate text-xs font-black tracking-[0.3px] uppercase">{region.title}</b>
        <small className="truncate text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">
          {region.subtitle}
        </small>
      </span>
    </span>
  );
}

/** The tint a region's card header takes. Same rule as the spine: confirmation only. */
export const REGION_HEAD_TINT: Record<MarketRegion["tone"], string> = {
  eu: "bg-[color-mix(in_srgb,var(--pokemon-blue)_7%,#ffffff)]",
  us: "bg-[color-mix(in_srgb,var(--pokemon-red)_7%,#ffffff)]",
};

/**
 * The currency, stated on the card that uses it.
 *
 * On every card, on every tab, without exception. This is the one piece of
 * chrome that stops a euro figure and a dollar figure — which never share a
 * scale here — from being read as one series.
 */
export function CurrencyBadge({ currency }: { currency: MarketCurrency }) {
  return (
    <span className="shrink-0 rounded-full border-2 border-black bg-muted-surface px-2 py-0.5 text-[10px] font-black tracking-[0.4px] uppercase">
      <span className="sr-only">{currency === "EUR" ? "Prices in euros: " : "Prices in US dollars: "}</span>
      {currency}
    </span>
  );
}

/** The panel's context chips — market, print, currency, date. */
export function ContextChips({ chips, className = "" }: { chips: MarketContextChip[]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {chips.map((chip) => (
        <span
          className={`inline-flex items-center rounded-full border-2 px-2.5 py-0.5 text-[10px] font-black tracking-[0.4px] uppercase ${CHIP_TONE[chip.tone]}`}
          key={chip.text}
        >
          {/* The visible text is an abbreviation on the region and currency
              chips ("EU market", "USD"); the spoken text is the sentence it
              stands for, so the market and its currency are never announced
              as bare initials. */}
          {chip.srText && <span className="sr-only">{chip.srText}</span>}
          <span aria-hidden={chip.srText ? true : undefined}>{chip.text}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Regional tint, and never the only carrier of meaning: the Europe chip says
 * "Europe · EUR" and the US chip says "United States · USD" in words, so a
 * reader who cannot separate the blue from the red loses decoration rather
 * than information.
 */
const CHIP_TONE: Record<MarketContextChip["tone"], string> = {
  region: "border-pokemon-blue bg-[color-mix(in_srgb,var(--pokemon-blue)_10%,#ffffff)] text-pokemon-blue",
  "region-us": "border-pokemon-red bg-[color-mix(in_srgb,var(--pokemon-red)_10%,#ffffff)] text-[#b92f3c]",
  plain: "border-border-subtle bg-card-surface text-muted-text",
  currency: "border-black bg-nav-dark text-white",
};

/**
 * The headline figure.
 *
 * `data value` carries the exact unformatted number, so an agent parsing the
 * markup reads the precise figure while a person reads the formatted one.
 * The currency code trails the number as a muted suffix rather than leading
 * it — led with "USD", every price on the page starts with the same three
 * characters and the digits arrive late.
 */
export function Headline({
  label,
  amount,
  absent,
  currency,
  basis,
  saleChip,
}: {
  label: string;
  amount: number | null;
  absent: string;
  currency: MarketCurrency;
  basis: string;
  saleChip?: { label: string; amount: number } | null;
}) {
  return (
    <div className={`px-5 pt-5 ${ANCHOR_VALUE}`}>
      <p className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">{label}</p>
      {amount == null ? (
        <p className="mt-1 text-2xl font-black tracking-[-0.6px]">{absent}</p>
      ) : (
        <data
          className="mt-0.5 block text-[clamp(30px,4.2vw,42px)] leading-none font-black tracking-[-1.5px] tabular-nums"
          value={String(amount)}
        >
          {formatMarketMoney(amount, currency)}
          <span className="ml-2 align-middle text-[13px] font-bold tracking-normal text-muted-text">{currency}</span>
        </data>
      )}
      <p className="mt-2 text-[11px] font-bold text-muted-text text-pretty">{basis}</p>
      {saleChip && (
        <span className="mt-2 inline-flex rounded-sm bg-[color-mix(in_srgb,var(--pokemon-blue)_10%,#ffffff)] px-1.5 py-0.5 text-[10px] font-black tracking-[0.3px] text-pokemon-blue uppercase">
          {saleChip.label} · {formatMarketMoney(saleChip.amount, currency)}
        </span>
      )}
    </div>
  );
}

/**
 * The four secondary figures as a hairline 2x2 grid.
 *
 * Fixed at four cells in every tab, which is what lets a reader's eye find
 * "lowest listing" in the same place whichever market they are on. A cell
 * with no figure prints the reason instead of a blank — and never a zero,
 * because upstreams send zeros for absences (see lib/market-views.ts).
 */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <dl className={`mx-5 mt-4 grid grid-cols-2 overflow-hidden rounded-md border-2 border-border-subtle ${ANCHOR_STATS}`}>
      {children}
    </dl>
  );
}

export function Stat({
  label,
  amount,
  absent,
  currency,
  index,
}: {
  label: string;
  amount: number | null;
  absent: string;
  currency: MarketCurrency;
  /** Position in the fixed 2x2 grid — drives the hairlines explicitly rather than through an `nth-` variant, so the rules stay legible next to the layout they draw. */
  index: number;
}) {
  return (
    <div
      className={`flex flex-col justify-center border-border-subtle px-3 py-2.5 ${index % 2 === 0 ? "border-r-2" : ""} ${index < 2 ? "border-b-2" : ""}`}
    >
      <dt className="text-[10px] font-black tracking-[0.4px] text-muted-text uppercase">{label}</dt>
      <dd
        className={`mt-0.5 font-black tabular-nums ${amount == null ? "text-[12px] text-muted-text" : "text-[15px] tracking-[-0.3px]"}`}
      >
        {amount == null ? absent : formatMarketMoney(amount, currency)}
      </dd>
    </div>
  );
}

/**
 * The sentence that stops a number being misread.
 *
 * On a tinted panel with an icon so it reads as commentary rather than as
 * one more figure — it has to be visibly not-a-number. Its live values are
 * bolded inline, which is the point: an abstract explanation of "market
 * value versus asking price" teaches nothing, the same sentence carrying
 * this card's own two figures teaches it in one read.
 *
 * WHERE IT SITS, and why. It began in the valuation card under the figures it
 * names, and now closes the evidence card instead — an explanation lands better
 * once a reader has seen the thing being explained. It carries its own two
 * figures bolded inline, so it stays self-contained a column away from them.
 *
 * FULL BLEED inside that card, not a floating box. It used to be inset by a
 * 20px margin on three sides, which put white gutters either side of a
 * paragraph and made the card look like it had stopped early. Edge to edge, on
 * its own tint, it reads as the card's closing band rather than as something
 * left over at the bottom.
 */
export function WhatThisMeans({ note }: { note: MarketNote }) {
  return (
    <div className="mt-auto border-t-2 border-border-subtle border-l-[6px] border-l-pokemon-blue bg-muted-surface px-5 py-3.5">
      {/* No ⓘ badge. It cost a 24px column plus a gap to restate what the
          label beneath it already says — the badge and the label were two
          renderings of "this is commentary", and the blue left edge alone
          already carries that job everywhere else on the page. Dropping it
          gives the reclaimed height back to the bars/chart above (both are
          `flex-1`, so the space is never simply lost). */}
      <strong className="block text-[10px] font-black tracking-[0.7px] text-pokemon-blue uppercase">
        {note.title}
      </strong>
      <p className="mt-1 text-[12px] leading-[1.45] font-bold text-pretty">
        {note.segments.map((segment, i) =>
          segment.strong ? (
            <b className="font-black tabular-nums" key={i}>
              {segment.text}
            </b>
          ) : (
            <span key={i}>{segment.text}</span>
          )
        )}
      </p>
    </div>
  );
}

/** The link out to the marketplace the figures came from, pinned to the card's floor by `mt-auto`. */
export function SourceAction({ label, url }: { label: string; url?: string }) {
  if (!url) {
    return (
      <p className="mt-auto px-5 pt-4 pb-5 text-[11px] font-bold text-muted-text">
        No product page from this source for this card.
      </p>
    );
  }
  return (
    <a
      className="group mt-auto flex items-center justify-between px-5 pt-4 pb-5 text-[11px] font-black tracking-[0.4px] text-pokemon-blue uppercase hover:underline"
      href={url}
      rel="noopener noreferrer"
      target="_blank"
    >
      {label}
      <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
        ↗
      </span>
    </a>
  );
}

/**
 * The collector insight — the section's conclusion, full width beneath both
 * cards.
 *
 * IT SAT INSIDE THE RIGHT-HAND CARD, and that was the mistake. The claim it
 * makes is about the MARKET on screen — raw against PSA 10, Western against
 * Japanese — not about the contents of one of two side-by-side cards, and
 * nesting it in one of them attributed it to that card's figures alone.
 *
 * Moving it out also fixes the reading order. Figures first (valuation),
 * evidence second (bars or trend), takeaway last and full width, where the eye
 * returns after scanning two columns — instead of a conclusion buried
 * mid-column competing with the bars directly above it.
 *
 * And it takes the layout hack with it: this block used to be pinned to a
 * fixed 112px so its prose could not push the right card taller than the left
 * one. Out of the cards, sentence length stops driving card height at all, and
 * the copy gets the full width it wanted — the support line wrapped to three
 * lines in a 435px column and fits in one here.
 *
 * The ratio dial is a REPEAT of the multiple already in the headline, not a
 * figure of its own — that is why it is `aria-hidden` and why it drops out on
 * small screens without any loss.
 */
export function CollectorInsightBlock({ insight }: { insight: CollectorInsight }) {
  const href = insight.photo?.url;

  const frame = insight.photo ? (
    <ListingPhoto
      alt={insight.photo.alt}
      caption="Live ask"
      className="hidden h-[78px] w-[78px] flex-none rounded-md border-2 border-black bg-nav-dark sm:block"
      fallback={<MarketImage asset={MARKET_ART[insight.art]} className="hidden flex-none rounded-md sm:block" />}
      imageUrl={insight.photo.imageUrl}
    />
  ) : (
    <MarketImage asset={MARKET_ART[insight.art]} className="hidden flex-none rounded-md sm:block" />
  );

  const body = (
    <>
      {frame}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">
          Collector insight
          {/* The arrow is the only thing that says this block leaves the site.
              It appears with the link and never without it, so it can never
              promise a destination that is not there. */}
          {href && <span aria-hidden>↗</span>}
        </span>
        <span className="mt-1 block text-[15px] leading-[19px] font-black tracking-[-0.3px] text-pretty">{insight.headline}</span>
        <span className="mt-1 block text-[11px] leading-[1.4] font-bold text-muted-text text-pretty">{insight.support}</span>
      </span>
      {insight.ratio && (
        <span
          aria-hidden
          className="hidden h-14 w-14 flex-none place-items-center rounded-full bg-nav-dark text-base font-black text-white lg:grid"
        >
          {insight.ratio}
        </span>
      )}
    </>
  );

  const shell =
    "mt-5 flex items-center gap-3.5 rounded-lg border-2 border-black bg-[linear-gradient(100deg,var(--muted-surface),transparent)] px-5 py-4 shadow-hard-sm";

  // A link ONLY when there is a real listing to open. An illustrative tier
  // has no url (see GradedMarketListingRow), and a block that looks clickable
  // and goes nowhere is worse than one that never offered.
  if (!href) return <div className={shell}>{body}</div>;

  return (
    <a
      className={`${shell} transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md`}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {body}
    </a>
  );
}


/**
 * What this tab's figures cover, and what they are not — one line closing the
 * section.
 *
 * ONE LINE, not two. The scope sat inside the right-hand card and the view's
 * footnote sat under the grid, so the same idea — "here is what these numbers
 * are and are not" — was qualified in two places a column apart. They read as
 * one sentence because they are one thought.
 *
 * The trend tab had no scope at all before, which was the half of the old
 * asymmetry that mattered least visually and most factually: Cardmarket's
 * trailing averages are not asks, and nothing on that tab said so.
 */
export function MarketSectionFooter({ footer, footnote }: { footer: MarketScope; footnote: string }) {
  return (
    <p className="mt-3 text-[11px] leading-[1.5] font-bold text-muted-text text-pretty">
      <strong className="font-black text-foreground">{footer.scopeLabel}:</strong> {footer.scope}{" "}
      <span className="text-[#999]">· {footnote}</span>
    </p>
  );
}
