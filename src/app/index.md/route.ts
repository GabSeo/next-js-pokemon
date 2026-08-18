import { homepageMarkdown } from "@/lib/markdown";

export async function GET() {
  return new Response(homepageMarkdown(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
