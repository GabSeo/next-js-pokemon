import { findCard } from "@/lib/cards";
import { priceCheckResultMarkdown, priceCheckerMarkdown } from "@/lib/markdown";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cardId = searchParams.get("cardId");

  if (cardId) {
    const card = await findCard(cardId);
    const body = card
      ? await priceCheckResultMarkdown(card)
      : `# Price checker tool\n\nNo card found for "${cardId}".\n`;
    return new Response(body, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  return new Response(await priceCheckerMarkdown(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
