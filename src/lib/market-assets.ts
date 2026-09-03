/**
 * Every image slot the Real-time market data section draws, in one place.
 *
 * WHY A REGISTRY AND NOT INLINE PATHS. Two of these are real files
 * (eBay's own wordmark, already self-hosted for the Grading Center) and the
 * rest are neutral placeholders waiting on final artwork. Which is which has
 * to be visible at a glance when the real assets land, and every slot has to
 * carry its intrinsic box with it — an image whose width and height arrive
 * only in CSS re-lays the row out the moment the file changes size, which is
 * exactly the layout shift this section is built to avoid.
 *
 * So each entry carries `src`, `alt` and the box it occupies. Replacing a
 * placeholder means changing `src` and nothing else: the box stays, the
 * alt text stays, and no consumer moves.
 *
 * ALT TEXT RULE, applied per slot rather than per file: a source logo in a
 * card header is informative (it names the marketplace the figures came
 * from) and gets real alt text; the collector-insight artwork is decoration
 * beside a sentence that already states the fact, and gets `alt=""`. Both
 * are spelled out below so neither is a judgement call at the call site.
 *
 * NO BRAND LETTERFORMS IN THE PLACEHOLDERS. The stand-in SVGs are a hatched
 * box and an outline — deliberately not "TCG" or "CM" set in type, which
 * would be a home-made imitation of a wordmark this project does not own.
 */

import { CARDMARKET_LOGO_URL, EBAY_LOGO_URL, TCGPLAYER_LOGO_URL } from "@/lib/marketplace-logos";

export type MarketAsset = {
  src: string;
  /** Empty string marks a decorative slot — see the alt-text rule above. */
  alt: string;
  /** Intrinsic box in CSS pixels. Rendered as width/height attributes, so the space is reserved before the file loads. */
  width: number;
  height: number;
  /** True while `src` is a stand-in. Drives the muted placeholder tint, and is the one flag to flip when real artwork lands. */
  placeholder: boolean;
};

/** The neutral file every slot falls back to if its own image fails to load. */
export const MARKET_ASSET_FALLBACK = "/market/logo-placeholder.svg";

/**
 * Source logos, at the size the card headers draw them.
 *
 * TODO(assets): replace `src` with the final licensed logo files. Keep the
 * width/height — they are the reserved box, not a guess at the artwork.
 */
export const MARKET_LOGOS = {
  /** Real wordmark, self-hosted. The box below is unchanged from the placeholder's on purpose — see this file's header. */
  tcgplayer: {
    src: TCGPLAYER_LOGO_URL,
    alt: "TCGplayer",
    width: 36,
    height: 30,
    placeholder: false,
  },
  /** Real logo, self-hosted. Square, so object-contain fills the box's height rather than its width. */
  cardmarket: {
    src: CARDMARKET_LOGO_URL,
    alt: "Cardmarket",
    width: 36,
    height: 30,
    placeholder: false,
  },
  psa: {
    src: "/market/psa-logo.svg",
    alt: "PSA",
    width: 36,
    height: 30,
    placeholder: true,
  },
  /** Real, already self-hosted under /public for the Grading Center — not a placeholder. */
  ebay: {
    src: EBAY_LOGO_URL,
    alt: "eBay",
    width: 36,
    height: 30,
    placeholder: false,
  },
} as const satisfies Record<string, MarketAsset>;

export type MarketLogoId = keyof typeof MARKET_LOGOS;

/**
 * Collector-insight artwork. Decorative by the rule above: the headline and
 * the supporting sentence beside each one already carry the fact in text, so
 * a screen reader that announced the picture too would hear it twice.
 *
 * TODO(assets): replace with the final illustrations — a graded PSA slab, a
 * fan of raw cards, and the Western/Japanese print comparison. The 58x78 box
 * is what the layout reserves; supply artwork at that ratio (2x is fine) and
 * nothing reflows.
 */
export const MARKET_ART = {
  "psa-slab": { src: "/market/psa-slab.svg", alt: "", width: 58, height: 78, placeholder: true },
  "raw-cards": { src: "/market/raw-cards.svg", alt: "", width: 58, height: 78, placeholder: true },
  "print-comparison": {
    src: "/market/print-comparison.svg",
    alt: "",
    width: 58,
    height: 78,
    placeholder: true,
  },
} as const satisfies Record<string, MarketAsset>;

export type MarketArtId = keyof typeof MARKET_ART;
