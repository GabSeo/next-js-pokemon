import type { Metadata } from "next";
import { PriceCheckerView } from "@/components/price-checker-view";
import { findCard } from "@/lib/cards";
import { priceStatement } from "@/lib/price-display";

/**
 * The public price-checker address, `/tools/price-checker?cardId=…`.
 *
 * Reading `searchParams` makes this route request-time by definition, so it
 * cannot be prebuilt. That is why next.config.ts carries a `beforeFiles`
 * rewrite sending any request WITH a cardId to the prebuildable twin at
 * /tools/price-checker/[cardId] — the visible URL is untouched, the server
 * just serves a finished page instead of assembling one.
 *
 * So in practice this file now handles the empty state (no cardId: the form
 * and the card-id list, no upstream calls at all) plus anything the rewrite
 * somehow doesn't cover. Both routes render PriceCheckerView, so they cannot
 * drift.
 */

type PageProps = { searchParams: Promise<{ cardId?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { cardId } = await searchParams;
  const card = cardId ? await findCard(cardId) : undefined;
  const markdownHref = card
    ? `/tools/price-checker.md?cardId=${encodeURIComponent(cardId!)}`
    : "/tools/price-checker.md";

  return {
    title: card ? `${card.name} price checker` : "Price checker",
    description: card
      ? `${card.name} — ${priceStatement(card)}`
      : "Enter a Pokémon or One Piece card ID to see current market prices, price history, and set a price alert.",
    alternates: {
      canonical: "/tools/price-checker",
      types: { "text/markdown": markdownHref },
    },
  };
}

export default async function PriceCheckerPage({ searchParams }: PageProps) {
  const { cardId } = await searchParams;
  const card = cardId ? await findCard(cardId) : undefined;

  return <PriceCheckerView cardId={cardId} card={card} />;
}
