import { NextResponse } from "next/server";
import { computeAlertBands, findCard, toPublicCard } from "@/lib/cards";
import { getGradedMarketData } from "@/lib/graded-market";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cardId = searchParams.get("cardId");

  if (!cardId) {
    return NextResponse.json(
      { error: "Missing required query parameter: cardId" },
      { status: 400 }
    );
  }

  const card = await findCard(cardId);
  if (!card) {
    return NextResponse.json(
      { error: `No card found for cardId "${cardId}"` },
      { status: 404 }
    );
  }

  const gradedMarket = await getGradedMarketData(card);
  return NextResponse.json({
    ...toPublicCard(card),
    alertBands: computeAlertBands(card.currentPrice),
    gradedMarket,
  });
}
