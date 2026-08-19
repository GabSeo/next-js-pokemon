import { okfPriceCheckerConcept } from "@/lib/okf";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cardId = searchParams.get("cardId") ?? undefined;

  return new Response(await okfPriceCheckerConcept(cardId), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
