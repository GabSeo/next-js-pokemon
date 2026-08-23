import { NextResponse } from "next/server";
import { getAllCards, toPublicCard } from "@/lib/cards";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/site";

export async function GET() {
  const cards = await getAllCards();
  return NextResponse.json({
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: absoluteUrl("/"),
    llmsTxt: absoluteUrl("/llms.txt"),
    collections: [
      {
        franchise: "pokemon",
        url: absoluteUrl("/collections/pokemon"),
        json: absoluteUrl("/api/pokemon"),
      },
      {
        franchise: "one-piece",
        url: absoluteUrl("/collections/one-piece"),
        json: absoluteUrl("/api/one-piece"),
      },
    ],
    tools: [
      {
        name: "price-checker",
        url: absoluteUrl("/tools/price-checker"),
        api: absoluteUrl("/api/price-check?cardId={cardId}"),
      },
    ],
    mcp: {
      url: absoluteUrl("/api/mcp"),
      transport: "streamable-http",
      serverCard: absoluteUrl("/.well-known/mcp/server-card.json"),
      tools: ["list_cards", "get_price_range", "get_card_info", "get_graded_market"],
    },
    cards: cards.map(toPublicCard),
  });
}
