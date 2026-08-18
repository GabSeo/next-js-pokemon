import { getCardBySlug } from "@/lib/cards";
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
  return new Response(cardToMarkdown(card), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
