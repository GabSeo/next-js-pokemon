import type { Metadata } from "next";
import { PriceCheckerView } from "@/components/price-checker-view";
import { findCard } from "@/lib/cards";
import { priceStatement } from "@/lib/price-display";
import { cardRefs } from "@/data/card-refs";

/**
 * The prebuildable twin of `/tools/price-checker?cardId=…`.
 *
 * It exists for one reason: a page whose identity lives in the query string
 * can never be prerendered, and that page is SEO-load-bearing so its URL
 * cannot change. Putting the card in the PATH gives Next a finite list of
 * addresses it can build at deploy time; a `beforeFiles` rewrite in
 * next.config.ts then points the query-string URL here. Visitors and
 * crawlers keep seeing `?cardId=` — this path is plumbing.
 *
 * Because it is plumbing, its canonical points back at the query-string
 * form. Without that, the same content would be indexable at two addresses
 * and the internal one could outrank the real one.
 *
 * Same 36h window as the product pages, and the same reason: this renders
 * the identical GradedMarketPanel from the identical data.
 */

export const revalidate = 129600;

/**
 * Straight from card-refs.ts — static data, no network.
 *
 * Deliberately NOT derived from a live lookup. The French routes take their
 * list from a TCGdex call and set `dynamicParams = false`, so a build that
 * cannot reach TCGdex produces zero pages and 404s every French URL for the
 * life of that deployment. This list cannot empty that way, and
 * `dynamicParams` is left at its default of true regardless, so a card id
 * that is not prebuilt still renders on demand rather than 404ing.
 */
export function generateStaticParams() {
  return cardRefs.map((ref) => ({ cardId: ref.slug }));
}

type PageProps = { params: Promise<{ cardId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { cardId } = await params;
  const card = await findCard(cardId);

  return {
    title: card ? `${card.name} price checker` : "Price checker",
    description: card
      ? `${card.name} — ${priceStatement(card)}`
      : "Enter a Pokémon or One Piece card ID to see current market prices, price history, and set a price alert.",
    alternates: {
      // The indexable address is the query-string one this page is rewritten
      // from, never this path.
      canonical: `/tools/price-checker?cardId=${encodeURIComponent(cardId)}`,
      types: { "text/markdown": `/tools/price-checker.md?cardId=${encodeURIComponent(cardId)}` },
    },
  };
}

export default async function PriceCheckerCardPage({ params }: PageProps) {
  const { cardId } = await params;
  const card = await findCard(cardId);

  return <PriceCheckerView cardId={cardId} card={card} />;
}
