import { cardRefs } from "@/data/card-refs";
import { getAllCards, getCardBySlug, getJapaneseCardText, getOnePieceJapaneseText } from "@/lib/cards";
import { cardToMarkdown } from "@/lib/markdown";

// Same window as the base product page — see its own comment.
export const revalidate = 129600;

/**
 * Real Japanese markdown for both franchises now — mirrors /fr/index.md's
 * own pattern. Built only for refs with a real match (a confirmed
 * pokeWalletCardId for Pokémon, berryWalletEnabled for One Piece) — same
 * "only serve what's real" rule /fr/index.md already follows for
 * fr.translated.
 */
export async function generateStaticParams() {
  const cards = await getAllCards();
  const params: { slug: string }[] = [];

  const pokemonRefs = cardRefs.filter((r) => r.franchise === "pokemon" && r.pokeWalletCardId);
  for (const ref of pokemonRefs) {
    const card = cards.find((c) => c.slug === ref.slug);
    if (!card) continue;
    const ja = await getJapaneseCardText(card, ref);
    if (ja.translated) params.push({ slug: ref.slug });
  }

  const oneRefs = cardRefs.filter((r) => r.franchise === "one-piece" && r.berryWalletEnabled);
  for (const ref of oneRefs) {
    const card = cards.find((c) => c.slug === ref.slug);
    if (!card) continue;
    const ja = await getOnePieceJapaneseText(card, ref);
    if (ja.translated) params.push({ slug: ref.slug });
  }

  return params;
}

// Matches the page route's own dynamicParams = false.
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
  const ref = cardRefs.find((r) => r.slug === slug);
  if (!ref) {
    return new Response("Not found", { status: 404 });
  }
  const ja = card.franchise === "one-piece" ? await getOnePieceJapaneseText(card, ref) : await getJapaneseCardText(card, ref);
  if (!ja.translated) {
    return new Response("Not found", { status: 404 });
  }
  const body = await cardToMarkdown(card, { name: ja.name, set: ja.set, rarity: ja.rarity, number: ja.number, setCode: ja.setCode }, `/products/${card.slug}/ja`);
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
