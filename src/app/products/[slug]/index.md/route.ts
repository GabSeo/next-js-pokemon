import { getAllCards, getCardBySlug } from "@/lib/cards";
import { cardToMarkdown } from "@/lib/markdown";

// Same window as the HTML page this mirrors — see page.tsx's own comment.
// Without generateStaticParams here, this route defaults to on-demand
// dynamic rendering: a real serverless invocation (possible cold start) on
// every single fetch, including an AI agent's first, one-shot visit,
// instead of being served instantly from Vercel's edge cache like the HTML
// page already is. Same data either way, just slower/less reliable.
export const revalidate = 86400;

export async function generateStaticParams() {
  const cards = await getAllCards();
  return cards.map((card) => ({ slug: card.slug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(await cardToMarkdown(card), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
