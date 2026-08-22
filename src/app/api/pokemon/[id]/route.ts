import { NextResponse } from "next/server";
import { getCardByIdOrSlug, toPublicCard } from "@/lib/cards";
import { getGradedMarketData } from "@/lib/graded-market";

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

  const gradedMarket = await getGradedMarketData(card);
  return NextResponse.json({ ...toPublicCard(card), gradedMarket });
}
