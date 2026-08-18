import type { Card } from "@/lib/types";

type CardImageProps = {
  card: Card;
  className?: string;
};

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
 */
export function CardImage({ card, className }: CardImageProps) {
  const alt = `${card.name}, ${card.set}${card.number ? ` ${card.number}` : ""}${card.rarity ? `, ${card.rarity}` : ""}`;

  if (card.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- external CDN image, domain not yet allowlisted for next/image
    return <img src={card.imageUrl} alt={alt} className={className} loading="lazy" />;
  }

  const [from, to] = paletteFor(card.id);
  const gradientId = `grad-${card.id}`;
  return (
    <svg viewBox="0 0 300 420" role="img" aria-label={alt} className={className}>
      <title>{`${card.name} — ${card.set} (${card.number ?? ""})`}</title>
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
  );
}
