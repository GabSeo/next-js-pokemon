import type { Card } from "@/lib/types";

type CardImageProps = {
  card: Card;
  className?: string;
};

/**
 * Generated placeholder artwork (no licensed card artwork is shipped in this
 * prototype). Still carries real alt text describing the card, since the
 * image is a genuine data point for both humans and bots (see PLAN.md §4.7).
 */
export function CardImage({ card, className }: CardImageProps) {
  const gradientId = `grad-${card.id}`;
  return (
    <svg
      viewBox="0 0 300 420"
      role="img"
      aria-label={`${card.name}, ${card.set} ${card.number}, ${card.rarity}`}
      className={className}
    >
      <title>{`${card.name} — ${card.set} (${card.number})`}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={card.gradientFrom} />
          <stop offset="100%" stopColor={card.gradientTo} />
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
        {card.set} · {card.number}
      </text>
      <text
        x="24"
        y="396"
        fontSize="12"
        fill="white"
        fillOpacity="0.75"
        style={{ fontFamily: "var(--font-sans, sans-serif)" }}
      >
        {card.rarity}
      </text>
    </svg>
  );
}
