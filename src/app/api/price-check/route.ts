import { NextResponse } from "next/server";
import { computeAlertBands, findCard, toPublicCard } from "@/lib/cards";

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

  return NextResponse.json({
    ...toPublicCard(card),
    alertBands: computeAlertBands(card.currentPrice),
  });
}
