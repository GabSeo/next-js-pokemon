import { absoluteUrl } from "@/lib/site";

/**
 * Manual route instead of Next's typed robots() metadata convention, kept
 * for the explicit per-bot Allow blocks below (the typed convention can
 * express this too, but this was already hand-built before that was
 * confirmed, and there's no reason to churn it back).
 *
 * Previously also emitted a custom "Agentmap:" directive pointing at the
 * ARD catalog — not part of RFC 9309 (robots.txt only defines User-agent/
 * Allow/Disallow/Sitemap/Crawl-delay), and real validators flag unknown
 * directives as errors. Dropped: the same catalog URL is already
 * discoverable two spec-compliant ways — llms.txt's "ARD catalog" entry,
 * and the <link rel="ai-catalog"> tag in every page's <head> (layout.tsx).
 */
const dataPaths = ["/api/", "/*.md", "/llms.txt", "/.well-known/"];
const NAMED_BOTS = ["Googlebot", "GPTBot", "ClaudeBot", "PerplexityBot"];

export async function GET() {
  const lines: string[] = [];

  for (const bot of NAMED_BOTS) {
    lines.push(`User-Agent: ${bot}`);
    lines.push("Allow: /");
    for (const path of dataPaths) lines.push(`Allow: ${path}`);
    lines.push("");
  }

  lines.push("User-Agent: Google-Extended");
  lines.push("Allow: /");
  lines.push("");

  lines.push("User-Agent: *");
  lines.push("Allow: /");
  lines.push("");

  lines.push(`Sitemap: ${absoluteUrl("/sitemap.xml")}`);

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
