import { cardRefs } from "@/data/card-refs";
import { okfProductConcept } from "@/lib/okf";

export async function generateStaticParams() {
  return cardRefs.map((ref) => ({ slug: ref.slug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = await okfProductConcept(slug);
  if (!body) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
