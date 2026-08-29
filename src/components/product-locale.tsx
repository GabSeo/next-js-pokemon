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
 * both to decide whether to render a live or an inert flag toggle — so
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
  /** Every locale the toggle shows, in fixed US -> FR -> JP order. */
  options: { code: LocaleCode; available: boolean }[];
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function useProductLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useProductLocale must be used inside <ProductLocaleProvider>");
  }
  return ctx;
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
 * actually uses (verified live: US/FR/JP SVGs are 765/191/160 bytes vs.
 * 252/109/239 for the equivalent 40px-wide PNGs) — flat-color flags are
 * exactly what SVG compresses best and JPEG compresses worst (visible
 * ringing on the hard color edges a flag is made of).
 */
function flagSvgUrl(isoCode: LocaleCode): string {
  return `https://flagcdn.com/${isoCode.toLowerCase()}.svg`;
}

/**
 * The US/FR/JP toggle. An unavailable locale stays visible but inert —
 * a market the visitor can see is coming, never a switch that would reveal
 * English text wearing a French or Japanese label. Same honesty rule the
 * former per-language routes enforced by simply not existing for a card
 * with no real translation (see cards.ts's getFrenchCardText).
 */
export function ProductLocaleToggle() {
  const { active, setActive, options } = useProductLocale();
  if (options.length === 0) return null;

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Market">
      <span className="text-xs font-black tracking-[0.3px] text-muted-text uppercase">Market</span>
      <div className="flex overflow-hidden rounded-md border-2 border-black">
        {options.map((option, i) => {
          const content = (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- external CDN image, domain not allowlisted for next/image */}
              <img src={flagSvgUrl(option.code)} alt="" className="h-3 w-4 rounded-[1px] object-cover" />
              {option.code}
            </>
          );
          const sharedClassName = `flex items-center gap-1.5 px-3 py-1.5 text-xs font-black tracking-[0.3px] uppercase transition-colors ${
            i > 0 ? "border-l-2 border-black" : ""
          }`;

          if (!option.available) {
            return (
              <span
                key={option.code}
                aria-disabled="true"
                title="Coming soon"
                className={`${sharedClassName} cursor-not-allowed bg-muted-surface text-muted-text opacity-60`}
              >
                {content}
              </span>
            );
          }

          const isActive = option.code === active;
          return (
            <button
              key={option.code}
              type="button"
              onClick={() => setActive(option.code)}
              aria-pressed={isActive}
              className={`${sharedClassName} ${
                isActive ? "bg-pokemon-red text-white" : "bg-white text-foreground hover:bg-muted-surface"
              }`}
            >
              {content}
            </button>
          );
        })}
      </div>
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
