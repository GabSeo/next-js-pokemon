import { getAllCards, getCardBySlug, getFrenchCardText } from "@/lib/cards";
import { cardToMarkdown } from "@/lib/markdown";

// Same window as the base product page — see its own comment.
export const revalidate = 129600;

export async function generateStaticParams() {
  const cards = await getAllCards();
  const withFrench = await Promise.all(cards.map(async (card) => ({ slug: card.slug, fr: await getFrenchCardText(card) })));
  return withFrench.filter((c) => c.fr.translated).map((c) => ({ slug: c.slug }));
}

// Matches the page route's own dynamicParams = false — no French markdown
// mirror for a card TCGdex couldn't translate; an on-demand render would
// just 404 anyway, this makes it explicit and avoids the cost of trying.
export const dynamicParams = false;

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
  const body = await cardToMarkdown(card, { name: fr.name, set: fr.set, rarity: fr.rarity, number: fr.number, setCode: fr.setCode }, `/products/${card.slug}/fr`);
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
