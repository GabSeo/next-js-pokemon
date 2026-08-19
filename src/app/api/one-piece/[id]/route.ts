import { NextResponse } from "next/server";
import { getCardByIdOrSlug, toPublicCard } from "@/lib/cards";

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

  return NextResponse.json(toPublicCard(card));
}
