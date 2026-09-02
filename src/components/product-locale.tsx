"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * In-page language switching for a product page — the replacement for the
 * former `/products/[slug]/fr` and `/products/[slug]/ja` routes.
 *
 * Why this exists (API cost, not styling): every localized *route* was a
 * separate static-generation render scope, and `next build` runs those
 * across several worker processes. The Japanese identity resolvers
 * (cards.ts's getJapaneseCardText / getOnePieceJapaneseText) are the only
 * consumers of PokéWallet and BerryWallet's Japanese catalogue, and those
 * two credentials share a 100-calls/hour ceiling. Four extra routes per
 * card (/fr, /fr/index.md, /ja, /ja/index.md — each with its own
 * generateStaticParams *and* its own render) meant the same card's Japanese
 * lookup could be paid for once per worker per route instead of once per
 * card, because memo-fetch.ts's memoization is per-process and Next's own
 * fetch Data Cache does not reliably survive worker parallelism (see
 * build-cache.ts's header comment, which exists for exactly that reason).
 *
 * Collapsing to one route per card removes those scopes outright. The root
 * page already resolved French and Japanese identity anyway — it needed
 * both to know which languages this card genuinely has — so
 * showing the translated content here costs zero additional upstream calls
 * versus what the page was already spending.
 *
 * What this deliberately is NOT: an i18n or hreflang implementation. There
 * is one indexable URL per card and it is English. Real per-language URLs,
 * hreflang annotations and localized chrome are deferred — see
 * docs/i18n-deferred.md for the whole rationale and what has to come back
 * when that work is picked up.
 *
 * Only the active locale's nodes are rendered into the DOM. The other
 * variants still travel in the RSC payload (they are server-rendered nodes
 * passed as props), so switching is instant with no network round trip, but
 * the initial HTML stays exactly the size of the English page — which is
 * also what keeps the canonical English content unambiguous to a crawler
 * that never runs the toggle.
 */

/** ISO 3166-1 alpha-2, matching the flag asset and the visible label. */
export type LocaleCode = "US" | "FR" | "JP";

type LocaleContextValue = {
  active: LocaleCode;
  setActive: (code: LocaleCode) => void;
  /** Every locale the toggle shows, in fixed US -> JP -> FR order. */
  options: { code: LocaleCode; available: boolean }[];
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function useProductLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useProductLocale must be used inside <ProductLocaleProvider>");
  }
  return ctx;
}

/**
 * The same context, for consumers that can still do something useful without
 * it. GradedMarketPanel is rendered on the price checker as well as on the
 * product page, and when the toggle became the panel's market control the
 * throwing hook above turned "this surface has no locale provider" into a
 * failed production build — caught only by `next build`, since the price
 * checker route is prerendered and the dev server never rendered it.
 *
 * Degrading to the English market is the right answer for a surface that
 * never had localized card identity to switch between anyway. The provider is
 * still what any surface WANTS (see price-checker-view.tsx, which now has
 * one); this only means forgetting it costs a missing control rather than a
 * broken build.
 */
export function useProductLocaleOptional(): LocaleContextValue | null {
  return useContext(LocaleContext);
}

/**
 * Wraps the whole product page. `children` is server-rendered content
 * passed straight through, so nothing below this becomes a client component
 * just by being inside it — only the toggle and the slots are interactive.
 */
export function ProductLocaleProvider({
  options,
  children,
}: {
  options: { code: LocaleCode; available: boolean }[];
  children: ReactNode;
}) {
  // Always English first paint, on the server and on the client alike, so
  // there is nothing for hydration to disagree about — and so the canonical
  // content of this URL is the same whether or not JS ever runs.
  const [active, setActive] = useState<LocaleCode>("US");
  return <LocaleContext.Provider value={{ active, setActive, options }}>{children}</LocaleContext.Provider>;
}

/**
 * Flag *emoji* are unreliable cross-platform — Windows in particular often
 * has no real flag glyph for the regional-indicator-letter pairs they're
 * built from, rendering as blank/tofu instead of a flag picture even though
 * the emoji itself is correct. flagcdn.com (the static-asset CDN for the
 * well-known open-source flag-icons project) serves real flags by ISO code,
 * no key needed — verified live to resolve for every code this site uses.
 *
 * SVG specifically, not PNG/WebP/JPEG: at this toggle's small render size
 * (~16x12px) a raster tier would look soft on any 2x/3x display unless a
 * larger tier were fetched, where SVG stays crisp at any zoom/DPI for free.
 * It's also the smallest of the four formats for every flag this site
 * actually uses (verified live: US/JP/FR SVGs are 765/160/191 bytes vs.
 * 252/239/109 for the equivalent 40px-wide PNGs) — flat-color flags are
 * exactly what SVG compresses best and JPEG compresses worst (visible
 * ringing on the hard color edges a flag is made of).
 */
export function flagSvgUrl(isoCode: LocaleCode): string {
  return `https://flagcdn.com/${isoCode.toLowerCase()}.svg`;
}

/**
 * The US/JP/FR toggle — now the product page's single market control, sitting
 * on the right of the Market Overview panel's own heading, where that panel's
 * English/Japanese/France pills used to be (see
 * components/retro/graded-market-panel.tsx). One click both selects the
 * marketplace whose listings are shown and names the card in that language.
 *
 * No visible "Market" label and no caption: the heading it sits opposite
 * already says Market Overview, and the flags need no word to be read as
 * languages. The accessible name stays on the group for anyone who can't see
 * that pairing.
 *
 * THE PAGE'S ONE MARKET CONTROL. It selects a market, and the print follows
 * from it — a reader asking about the Japanese market wants the Japanese
 * print, so making them say both was friction, not precision.
 *
 * It briefly was two controls, market and card language, following the
 * architecture note's "market is not language" split. The distinction is real
 * and the data model still honours it (lib/market-config.ts maps a market to
 * its authoritative source, independently of which print is on screen), but as
 * two toggles it put a nine-cell grid in front of anyone who just wanted a
 * price. The model stayed; the surface collapsed back to one.
 *
 * Why no locale is inert any more: this used to grey out a language with no
 * real translation, so a visitor could never see English text wearing a
 * foreign flag. LocaleSlot still falls back to the US nodes there, so nothing
 * is ever a fabricated translation — but the flag also selects which print's
 * listings the eBay and Vinted sections show, and those exist for every card
 * whether or not PokéWallet/BerryWallet catalogue a foreign print of it.
 * Making those flags inert would have quietly cut off real market data, so
 * all three stay clickable. Only the card's own name and art fall back.
 */
export function ProductLocaleToggle() {
  const ctx = useProductLocaleOptional();
  if (!ctx || ctx.options.length === 0) return null;
  const { active, setActive, options } = ctx;

  return (
    <div aria-label="Market" className="flex overflow-hidden rounded-md border-2 border-black" role="group">
      {options.map((option, i) => {
        const isActive = option.code === active;
        return (
          <button
            key={option.code}
            type="button"
            onClick={() => setActive(option.code)}
            aria-pressed={isActive}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-black tracking-[0.3px] uppercase transition-colors ${
              i > 0 ? "border-l-2 border-black" : ""
            } ${isActive ? "bg-pokemon-red text-white" : "bg-white text-foreground hover:bg-muted-surface"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- external CDN image, domain not allowlisted for next/image */}
            <img src={flagSvgUrl(option.code)} alt="" className="h-3 w-4 rounded-[1px] object-cover" />
            {option.code}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Renders whichever variant matches the active locale, falling back to the
 * US one. Variants are server-rendered nodes, so `next/image` optimization,
 * the tilt card and the price panels all stay exactly as they were on the
 * old per-language routes — this only chooses between them.
 */
export function LocaleSlot({ variants }: { variants: Partial<Record<LocaleCode, ReactNode>> }) {
  const { active } = useProductLocale();
  return <>{variants[active] ?? variants.US}</>;
}
