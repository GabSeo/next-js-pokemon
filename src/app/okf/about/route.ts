import { okfAboutConcept } from "@/lib/okf";

export async function GET() {
  return new Response(await okfAboutConcept(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
