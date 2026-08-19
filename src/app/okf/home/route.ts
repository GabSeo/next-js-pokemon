import { okfHomeConcept } from "@/lib/okf";

export async function GET() {
  return new Response(await okfHomeConcept(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
