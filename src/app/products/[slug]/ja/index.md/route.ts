import { cardRefs } from "@/data/card-refs";
import { getAllCards, getCardBySlug, getOnePieceJapaneseText } from "@/lib/cards";
import { cardToMarkdown } from "@/lib/markdown";

// Same window as the base product page — see its own comment.
export const revalidate = 129600;

/**
 * One Piece only, for now — mirrors /fr/index.md's own pattern, but for
 * /ja. Pokémon's /ja page has no real Japanese source yet (see that page's
 * own doc comment) and no markdown mirror ever existed for it even
 * hypothetically, so a Pokémon slug here 404s, same as an untranslated
 * French card does on /fr/index.md — consistent "only serve what's real"
 * rule, not a gap specific to this route.
 */
export async function generateStaticParams() {
  const cards = await getAllCards();
  const oneRefs = cardRefs.filter((r) => r.franchise === "one-piece" && r.berryWalletEnabled);
  const withJapanese = await Promise.all(
    oneRefs.map(async (ref) => {
      const card = cards.find((c) => c.slug === ref.slug);
      if (!card) return undefined;
      return { slug: ref.slug, ja: await getOnePieceJapaneseText(card, ref) };
    })
  );
  return withJapanese.filter((c): c is NonNullable<typeof c> => !!c && c.ja.translated).map((c) => ({ slug: c.slug }));
}

// Matches the page route's own dynamicParams = false.
export const dynamicParams = false;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card || card.franchise !== "one-piece") {
    return new Response("Not found", { status: 404 });
  }
  const ref = cardRefs.find((r) => r.slug === slug);
  if (!ref) {
    return new Response("Not found", { status: 404 });
  }
  const ja = await getOnePieceJapaneseText(card, ref);
  if (!ja.translated) {
    return new Response("Not found", { status: 404 });
  }
  const body = await cardToMarkdown(card, { name: ja.name, set: ja.set, rarity: ja.rarity }, `/products/${card.slug}/ja`);
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
