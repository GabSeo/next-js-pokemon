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

/** ISO 3166-1 alpha-2 of the MARKET, which is the key every variant is stored under. */
export type LocaleCode = "US" | "FR" | "JP";

/**
 * What the reader sees, which is not the code.
 *
 * "EU" rather than "FR": that market was never really France. Cardmarket sells
 * one Western product to English, French, Italian, German, Spanish and
 * Portuguese buyers, and the panel has always said so — the flag was the only
 * thing claiming otherwise. "JA" rather than "JP" for the same reason in
 * reverse: it names the Japanese PRINT, a property of the card, not a country.
 */
export const MARKET_LABEL: Record<LocaleCode, string> = { US: "US", JP: "JA", FR: "EU" };

/** The flag asset per market — EU gets the union's own flag, not one member state's. */
const FLAG_CODE: Record<LocaleCode, string> = { US: "us", JP: "jp", FR: "eu" };

/**
 * Which marketplaces a figure comes from. NEVER a conversion: USD is TCGplayer
 * and eBay, EUR is Cardmarket.
 *
 * NOT a control. It was briefly a second toggle beside the market, and that was
 * one axis too many for what the data actually supports: US is American
 * marketplaces and EU is Cardmarket, so offering the other currency there just
 * gave a reader two ways to reach the same wrong answer. Only the Japanese
 * print is genuinely carried by both, and that view shows both at once rather
 * than asking anyone to choose. See MARKET_CONFIG.
 */
export type Currency = "USD" | "EUR";

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
export function flagSvgUrl(code: LocaleCode): string {
  return `https://flagcdn.com/${FLAG_CODE[code]}.svg`;
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
