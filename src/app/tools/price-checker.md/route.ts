import { priceCheckerMarkdown } from "@/lib/markdown";

export async function GET() {
  return new Response(priceCheckerMarkdown(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
