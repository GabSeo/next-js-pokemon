import { NextResponse } from "next/server";
import { getCardsByFranchise, toPublicCard } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";

export async function GET() {
  const cards = await getCardsByFranchise("pokemon");
  return NextResponse.json({
    franchise: "pokemon",
    canonicalUrl: absoluteUrl("/collections/pokemon"),
    markdownUrl: absoluteUrl("/collections/pokemon/index.md"),
    count: cards.length,
    cards: cards.map(toPublicCard),
  });
}
