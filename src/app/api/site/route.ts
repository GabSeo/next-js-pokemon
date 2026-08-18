import { NextResponse } from "next/server";
import { getAllCards, toPublicCard } from "@/lib/cards";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/site";

export async function GET() {
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
    cards: getAllCards().map(toPublicCard),
  });
}
