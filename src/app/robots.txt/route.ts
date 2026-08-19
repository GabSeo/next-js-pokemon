import { absoluteUrl } from "@/lib/site";

/**
 * Manual route instead of Next's typed robots() metadata convention — that
 * convention's type only supports rules/sitemap/host, with no escape hatch
 * for a custom top-level directive. Agentmap: (the ARD discovery signal)
 * needs exactly that, so this builds the file by hand. Output is otherwise
 * identical to what the typed convention produced.
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
  lines.push(`Agentmap: ${absoluteUrl("/.well-known/ai-catalog.json")}`);

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
