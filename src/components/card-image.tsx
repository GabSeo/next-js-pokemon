import Image from "next/image";
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
  /**
   * The `sizes` next/image needs to pick a correctly-sized variant instead
   * of defaulting to 100vw for every layout this component appears in
   * (hero, grid tile, homepage feature all render at very different actual
   * widths). Required whenever `card.imageUrl` is set; every current call
   * site passes one tailored to its own layout.
   */
  sizes?: string;
};

function imageTitle(card: Card): string {
  return `${card.name} — ${card.set}${card.number ? ` ${card.number}` : ""}`;
}

/** Real product description when we have one (already stripped of HTML), otherwise a plain factual fallback built from fields we always have. */
function imageCaption(card: Card): string {
  if (card.description) return card.description;
  return `${card.name} — ${card.set}${card.number ? ` ${card.number}` : ""}${card.rarity ? `, ${card.rarity}` : ""}.`;
}

const PALETTE: [string, string][] = [
  ["#f97316", "#dc2626"],
  ["#38bdf8", "#1d4ed8"],
  ["#facc15", "#f59e0b"],
  ["#ef4444", "#7f1d1d"],
  ["#22c55e", "#14532d"],
  ["#fb923c", "#ea580c"],
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
export function CardImage({ card, className, priority = false, showCaption = false, sizes }: CardImageProps) {
  const alt = `${card.name}, ${card.set}${card.number ? ` ${card.number}` : ""}${card.rarity ? `, ${card.rarity}` : ""}`;
  const title = imageTitle(card);
  const figcaptionClassName = showCaption ? "mt-2 text-sm text-muted-foreground" : "sr-only";

  if (card.imageUrl) {
    return (
      <figure className={`${className ?? ""} relative overflow-hidden`}>
        <Image
          src={card.imageUrl}
          alt={alt}
          title={title}
          fill
          sizes={sizes ?? "100vw"}
          className="object-cover"
          priority={priority}
          // `priority` alone only controls eager-vs-lazy loading and
          // whether a preload <link> gets generated at all — it does NOT
          // set fetchPriority on either the <img> or that preload link in
          // this Next version (confirmed against
          // node_modules/next/dist/shared/lib/get-img-props.js: fetchPriority
          // is destructured and passed through as its own independent prop,
          // never derived from `priority`). Lighthouse/PageSpeed flags a
          // priority image's preload request for missing fetchpriority=high
          // specifically, so this has to be set explicitly.
          {...(priority ? { fetchPriority: "high" as const } : {})}
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
          fontWeight="700"
          fill="white"
          style={{ fontFamily: "var(--font-sans, sans-serif)" }}
        >
          {card.name}
        </text>
        <text
          x="24"
          y="72"
          fontSize="13"
          fill="white"
          fillOpacity="0.85"
          style={{ fontFamily: "var(--font-sans, sans-serif)" }}
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
          style={{ fontFamily: "var(--font-sans, sans-serif)" }}
        >
          {card.rarity ?? ""}
        </text>
      </svg>
      <figcaption className={figcaptionClassName}>{imageCaption(card)}</figcaption>
    </figure>
  );
}
