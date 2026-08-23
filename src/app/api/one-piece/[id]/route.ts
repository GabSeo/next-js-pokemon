import { NextResponse } from "next/server";
import { getCardByIdOrSlug, getCardsByFranchise, toPublicCard } from "@/lib/cards";
import { getGradedMarketData } from "@/lib/graded-market";

// Same window as the HTML product page this data backs.
export const revalidate = 129600;

export async function generateStaticParams() {
  const cards = await getCardsByFranchise("one-piece");
  return cards.map((card) => ({ id: card.slug }));
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

  const gradedMarket = await getGradedMarketData(card);
  return NextResponse.json({ ...toPublicCard(card), gradedMarket });
}
