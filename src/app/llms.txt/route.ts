import { cardRefs } from "@/data/card-refs";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/site";

export async function GET() {
  // Just names + links to the per-card Markdown mirrors — doesn't need live
  // price data, so built from cardRefs instead of resolving the whole
  // catalog against apitcg.com. Matters more than most routes: llms.txt is
  // the entry point AI crawlers check first, so it gets hit disproportionately often.
  const cardLines = cardRefs
    .map((ref) => `- ${ref.displayName}: ${absoluteUrl(`/products/${ref.slug}/index.md`)}`)
    .join("\n");

  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

This site publishes every page in three synchronized formats: HTML for
people, Markdown for language models, and JSON for programmatic/agent use.
All three are generated from the same underlying data and are never hand-
maintained separately.

## Collections

- Pokémon collection — Markdown: ${absoluteUrl("/collections/pokemon/index.md")} — JSON: ${absoluteUrl("/api/pokemon")}
- One Piece collection — Markdown: ${absoluteUrl("/collections/one-piece/index.md")} — JSON: ${absoluteUrl("/api/one-piece")}

## Cards

${cardLines}

## Tools

- Price checker — Markdown: ${absoluteUrl("/tools/price-checker.md")} — API: GET ${absoluteUrl("/api/price-check")}?cardId={cardId}
  Returns current price, recent daily price snapshots, price history, and
  alert bands in 25% steps from -75% to +150% of current price as JSON.
  The Markdown mirror also accepts ?cardId={cardId} and returns that same
  data as Markdown instead of JSON.

## MCP

- Remote MCP server (Streamable HTTP, stateless): ${absoluteUrl("/api/mcp")}
  Tools: list_cards, get_price_range, get_card_info — see the server card
  for full descriptions: ${absoluteUrl("/.well-known/mcp/server-card.json")}

## Sitemap

${absoluteUrl("/sitemap.xml")}
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
