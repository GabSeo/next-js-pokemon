import { NextResponse } from "next/server";
import { getCardByIdOrSlug, getCardsByFranchise, toPublicCard } from "@/lib/cards";
import { getGradedMarketData } from "@/lib/graded-market";

// Same window as the HTML product page this data backs.
export const revalidate = 86400;

export async function generateStaticParams() {
  const cards = await getCardsByFranchise("pokemon");
  // Pre-build the slug (the canonical id) plus every upstream id the card
  // carries, so a request landing on an alias still hits a prebuilt page
  // instead of rendering on demand. The alias set no longer depends on which
  // upstream won a race at build time — see Card.identifiers (lib/types.ts).
  return cards.flatMap((card) => [
    { id: card.slug },
    ...(card.identifiers ?? [])
      .map((i) => i.value)
      .filter((value) => value !== card.slug)
      .map((value) => ({ id: value })),
  ]);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const card = await getCardByIdOrSlug("pokemon", id);

  if (!card) {
    return NextResponse.json(
      { error: `No Pokémon card found for id "${id}"` },
      { status: 404 }
    );
  }

  // Always real for this route (every card here is Pokémon), but typed
  // optional since getGradedMarketData is shared with the One Piece route —
  // see its own franchise gate (lib/graded-market.ts). Same explicit
  // conditional-spread convention as that route, kept consistent.
  const gradedMarket = await getGradedMarketData(card);
  return NextResponse.json({ ...toPublicCard(card), ...(gradedMarket ? { gradedMarket } : {}) });
}
