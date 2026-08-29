import { NextResponse } from "next/server";
import { getCardByIdOrSlug, getCardsByFranchise, toPublicCard } from "@/lib/cards";
import { getGradedMarketData } from "@/lib/graded-market";

// Same window as the HTML product page this data backs.
export const revalidate = 86400;

export async function generateStaticParams() {
  const cards = await getCardsByFranchise("pokemon");
  // Pre-build by both slug (the documented, stable entry point) and by
  // whichever id happened to resolve at build time (apitcg's numeric id when
  // apitcg has a match, TCGdex's id otherwise — see cards.ts's resolveCard).
  // Without this, any request that lands on the id form instead of the slug
  // is a guaranteed cache-miss on its very first hit ever, rendered on-demand
  // instead of served instantly from the prebuilt static page.
  return cards.flatMap((card) => (card.id === card.slug ? [{ id: card.slug }] : [{ id: card.slug }, { id: card.id }]));
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
