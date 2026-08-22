import { getCardBySlug, getFrenchCardText } from "@/lib/cards";
import { cardToMarkdown } from "@/lib/markdown";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) {
    return new Response("Not found", { status: 404 });
  }
  const fr = await getFrenchCardText(card);
  if (!fr.translated) {
    // Matches the page route's own dynamicParams = false — no French
    // markdown mirror for a card TCGdex couldn't translate.
    return new Response("Not found", { status: 404 });
  }
  const body = await cardToMarkdown(card, { name: fr.name, set: fr.set, rarity: fr.rarity }, `/products/${card.slug}/fr`);
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
