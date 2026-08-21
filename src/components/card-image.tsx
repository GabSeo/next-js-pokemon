import type { Card } from "@/lib/types";

type CardImageProps = {
  card: Card;
  /** Sizing/box classes — applied to the <figure>, not the <img>, since the image itself always fills its figure. */
  className?: string;
  /**
   * Marks this as an above-the-fold / LCP-candidate image (e.g. the hero
   * image on a product page). Skips native lazy loading and hints the
   * browser to fetch it eagerly — the opposite of what you want for an
   * image the user has to scroll to see, which is why this isn't the
   * default. Never set this on grid/list thumbnails.
   */
  priority?: boolean;
  /** Show the figcaption visually (product hero) instead of screen-reader-only (grid tiles, where the name/set/price are already shown as visible text right below). */
  showCaption?: boolean;
};

function imageTitle(card: Card): string {
  return `${card.name} — ${card.set}${card.number ? ` ${card.number}` : ""}`;
}

/** Real product description when we have one (already stripped of HTML), otherwise a plain factual fallback built from fields we always have. */
function imageCaption(card: Card): string {
  if (card.description) return card.description;
  return `${card.name} — ${card.set}${card.number ? ` ${card.number}` : ""}${card.rarity ? `, ${card.rarity}` : ""}.`;
}

/* Monochrome gradient pairs only — no hue outside the FireRed/Sapphire/
   Emerald triad is permitted anywhere on the site, and this placeholder is
   decoration, not franchise/category identity, so it stays grayscale. */
const PALETTE: [string, string][] = [
  ["#3a3a3a", "#101010"],
  ["#555555", "#1c1c1c"],
  ["#454545", "#151515"],
  ["#606060", "#232323"],
  ["#4a4a4a", "#181818"],
  ["#6a6a6a", "#2a2a2a"],
];

function paletteFor(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/**
 * Renders the real card image from apitcg.com when available. Falls back to
 * a generated placeholder (deterministic color per card id) if the image is
 * missing — e.g. a source lookup partially failed. Alt text always describes
 * the card, since the image is a genuine data point for both humans and bots
 * (see PLAN.md §4.7).
 *
 * Always wrapped in a <figure>/<figcaption> — real descriptive text for both
 * humans and crawlers, not just an alt attribute. `showCaption` controls
 * whether it's visible or sr-only; it's never *absent*.
 *
 * Lazy-loading is the default (`priority` unset), which is correct for grid
 * thumbnails but actively harmful for an above-the-fold/LCP image like a
 * product page hero — deferring its fetch behind the lazy-load heuristic
 * delays the largest contentful paint. `priority` opts a specific image out
 * of that default; callers must set it explicitly per-image since the
 * component has no way to know its own position on the page.
 */
export function CardImage({ card, className, priority = false, showCaption = false }: CardImageProps) {
  const alt = `${card.name}, ${card.set}${card.number ? ` ${card.number}` : ""}${card.rarity ? `, ${card.rarity}` : ""}`;
  const title = imageTitle(card);
  const figcaptionClassName = showCaption
    ? "mt-2 text-[10px] tracking-[0.02em] text-muted-foreground"
    : "sr-only";

  if (card.imageUrl) {
    return (
      <figure className={`${className ?? ""} overflow-hidden`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- external CDN image, domain not yet allowlisted for next/image */}
        <img
          src={card.imageUrl}
          alt={alt}
          title={title}
          className="h-full w-full object-cover"
          {...(priority ? { fetchPriority: "high" as const } : { loading: "lazy" as const })}
        />
        <figcaption className={figcaptionClassName}>{imageCaption(card)}</figcaption>
      </figure>
    );
  }

  const [from, to] = paletteFor(card.id);
  const gradientId = `grad-${card.id}`;
  return (
    <figure className={`${className ?? ""} overflow-hidden`}>
      <svg viewBox="0 0 300 420" role="img" aria-label={alt} className="h-full w-full">
        <title>{title}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <rect width="300" height="420" rx="18" fill={`url(#${gradientId})`} />
        <rect
          x="10"
          y="10"
          width="280"
          height="400"
          rx="12"
          fill="none"
          stroke="white"
          strokeOpacity="0.35"
          strokeWidth="2"
        />
        <text
          x="24"
          y="48"
          fontSize="20"
          fontWeight="400"
          fill="white"
          style={{ fontFamily: "var(--font-sans, ui-monospace, monospace)" }}
        >
          {card.name}
        </text>
        <text
          x="24"
          y="72"
          fontSize="13"
          fill="white"
          fillOpacity="0.85"
          style={{ fontFamily: "var(--font-sans, ui-monospace, monospace)" }}
        >
          {card.set}
          {card.number ? ` · ${card.number}` : ""}
        </text>
        <text
          x="24"
          y="396"
          fontSize="12"
          fill="white"
          fillOpacity="0.75"
          style={{ fontFamily: "var(--font-sans, ui-monospace, monospace)" }}
        >
          {card.rarity ?? ""}
        </text>
      </svg>
      <figcaption className={figcaptionClassName}>{imageCaption(card)}</figcaption>
    </figure>
  );
}
