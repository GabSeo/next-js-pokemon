import { homepageMarkdown } from "@/lib/markdown";

export async function GET() {
  return new Response(await homepageMarkdown(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
