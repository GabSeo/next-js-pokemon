import { okfIndex } from "@/lib/okf";

export async function GET() {
  return new Response(await okfIndex(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
