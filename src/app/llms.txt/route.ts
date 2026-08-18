import { getAllCards } from "@/lib/cards";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/site";

export async function GET() {
  const cards = await getAllCards();
  const cardLines = cards
    .map((c) => `- ${c.name} (${c.id}): ${absoluteUrl(`/products/${c.slug}/index.md`)}`)
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

## Sitemap

${absoluteUrl("/sitemap.xml")}
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
