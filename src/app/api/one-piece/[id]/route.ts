import { NextResponse } from "next/server";
import { getCardByIdOrSlug, getCardsByFranchise, toPublicCard } from "@/lib/cards";
import { getGradedMarketData } from "@/lib/graded-market";

// Same window as the HTML product page this data backs.
export const revalidate = 86400;

export async function generateStaticParams() {
  const cards = await getCardsByFranchise("one-piece");
  // See the /api/pokemon/[id] route's own comment on this same pattern —
  // pre-build by both slug and the resolved apitcg id so an id-based request
  // isn't a guaranteed on-demand cache-miss on its first-ever hit.
  return cards.flatMap((card) => (card.id === card.slug ? [{ id: card.slug }] : [{ id: card.slug }, { id: card.id }]));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const card = await getCardByIdOrSlug("one-piece", id);

  if (!card) {
    return NextResponse.json(
      { error: `No One Piece card found for id "${id}"` },
      { status: 404 }
    );
  }

  // Always undefined for One Piece (getGradedMarketData's own franchise
  // gate) — omitted from the response entirely rather than sent as `null`,
  // so a consumer checking `"gradedMarket" in data` gets a real signal
  // instead of every One Piece card silently carrying a null field forever.
  const gradedMarket = await getGradedMarketData(card);
  return NextResponse.json({ ...toPublicCard(card), ...(gradedMarket ? { gradedMarket } : {}) });
}
