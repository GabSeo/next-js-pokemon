import { cardRefs } from "@/data/card-refs";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl, siteHost } from "@/lib/site";

export async function GET() {
  // Just names + links to the per-card Markdown mirrors — doesn't need live
  // price data, so built from cardRefs instead of resolving the whole
  // catalog against apitcg.com. Matters more than most routes: llms.txt is
  // the entry point AI crawlers check first, so it gets hit disproportionately often.
  //
  // Every reference below uses real Markdown link syntax ([text](url)), per
  // the llms.txt spec (llmstxt.org) — a bare "Label: https://..." line is
  // *technically* still a URL, but link-extraction tooling (and some LLMs)
  // parses for [..](..)  specifically, so a file without it can get flagged
  // as "doesn't seem to contain links" even though the URLs are right there.
  const cardLines = cardRefs
    .map((ref) => `- [${ref.displayName}](${absoluteUrl(`/products/${ref.slug}/index.md`)})`)
    .join("\n");

  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

This site publishes every page in three synchronized formats: HTML for
people, Markdown for language models, and JSON for programmatic/agent use.
All three are generated from the same underlying data and are never hand-
maintained separately.

## Collections

- [Pokémon collection](${absoluteUrl("/collections/pokemon/index.md")}): Markdown mirror — JSON: ${absoluteUrl("/api/pokemon")}
- [One Piece collection](${absoluteUrl("/collections/one-piece/index.md")}): Markdown mirror — JSON: ${absoluteUrl("/api/one-piece")}

## Cards

${cardLines}

## Tools

- [Price checker](${absoluteUrl("/tools/price-checker.md")}): Markdown mirror — accepts \`?cardId={cardId}\`
- [Price checker API](${absoluteUrl("/api/price-check")}): GET with \`?cardId={cardId}\` — returns current price,
  recent daily price snapshots, price history, and alert bands in 25% steps
  from -75% to +150% of current price as JSON

## MCP

- [Remote MCP server](${absoluteUrl("/api/mcp")}): Streamable HTTP, stateless — tools: list_cards, get_price_range, get_card_info
- [MCP server card](${absoluteUrl("/.well-known/mcp/server-card.json")}): full tool descriptions

## Agentic Resource Discovery

- [ARD catalog](${absoluteUrl("/.well-known/ai-catalog.json")})
- [DID document](${absoluteUrl("/.well-known/did.json")}): identity did:web:${siteHost()}

## Sitemap

- [sitemap.xml](${absoluteUrl("/sitemap.xml")})
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
