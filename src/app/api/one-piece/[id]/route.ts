import { NextResponse } from "next/server";
import { getCardsByFranchise, toPublicCard } from "@/lib/cards";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cards = await getCardsByFranchise("one-piece");
  const card = cards.find((c) => c.id === id || c.slug === id);

  if (!card) {
    return NextResponse.json(
      { error: `No One Piece card found for id "${id}"` },
      { status: 404 }
    );
  }

  return NextResponse.json(toPublicCard(card));
}
