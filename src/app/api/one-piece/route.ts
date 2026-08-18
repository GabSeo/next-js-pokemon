import { NextResponse } from "next/server";
import { getCardsByFranchise, toPublicCard } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";

export async function GET() {
  const cards = await getCardsByFranchise("one-piece");
  return NextResponse.json({
    franchise: "one-piece",
    canonicalUrl: absoluteUrl("/collections/one-piece"),
    markdownUrl: absoluteUrl("/collections/one-piece/index.md"),
    count: cards.length,
    cards: cards.map(toPublicCard),
  });
}
