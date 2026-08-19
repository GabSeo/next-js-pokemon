import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { findCard, getAllCards, getCardsByFranchise, toPublicCard } from "@/lib/cards";
import { MCP_SERVER_INFO, mcpToolDescription } from "@/lib/mcp";
import { absoluteUrl } from "@/lib/site";

/**
 * Stateless remote MCP server — the three tools this was actually built for
 * (see the agent-layer plan). Deliberately not WebMCP: these are cold,
 * headless questions ("what's this worth"), not human-in-a-browser actions,
 * so a plain MCP server that any MCP client can call without an open tab is
 * the right shape, not a widget that needs one.
 *
 * Every tool is a thin wrapper over the same cards.ts functions the REST
 * API and the HTML/Markdown pages already use — same cache()-deduped, same
 * 36h-cached resolvers, so MCP traffic costs exactly what a page view costs.
 * No tool re-implements a fetch to apitcg.com.
 */
const handler = createMcpHandler((server) => {
  server.registerTool(
    "list_cards",
    {
      title: "List cards",
      description: mcpToolDescription("list_cards"),
      inputSchema: z.object({
        franchise: z
          .enum(["pokemon", "one-piece"])
          .optional()
          .describe("Restrict to one franchise. Omit to list every tracked card."),
      }),
      outputSchema: z.object({
        cards: z.array(
          z.object({
            slug: z.string(),
            name: z.string(),
            franchise: z.enum(["pokemon", "one-piece"]),
            set: z.string(),
            number: z.string().optional(),
            rarity: z.string().optional(),
            currency: z.string(),
            currentPrice: z.number(),
            productUrl: z.string(),
          })
        ),
      }),
    },
    async ({ franchise }) => {
      const cards = franchise ? await getCardsByFranchise(franchise) : await getAllCards();
      const summary = cards.map((c) => ({
        slug: c.slug,
        name: c.name,
        franchise: c.franchise,
        set: c.set,
        number: c.number,
        rarity: c.rarity,
        currency: c.currency,
        currentPrice: c.currentPrice,
        productUrl: absoluteUrl(`/products/${c.slug}`),
      }));
      return {
        content: [
          {
            type: "text",
            text:
              summary.length > 0
                ? `${summary.length} card(s): ${summary.map((c) => `${c.name} (${c.slug})`).join(", ")}`
                : "No cards found.",
          },
        ],
        structuredContent: { cards: summary },
      };
    }
  );

  server.registerTool(
    "get_price_range",
    {
      title: "Get price range",
      description: mcpToolDescription("get_price_range"),
      inputSchema: z.object({
        cardId: z
          .string()
          .describe('Card slug, name, number, or CardTrace numeric id — e.g. "gengar-vmax-271" or "Gengar VMAX".'),
      }),
      outputSchema: z.object({
        found: z.boolean(),
        slug: z.string().optional(),
        name: z.string().optional(),
        currency: z.string().optional(),
        low: z.number().optional(),
        high: z.number().optional(),
        lowDate: z.string().optional(),
        highDate: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    },
    async ({ cardId }) => {
      const card = await findCard(cardId);
      if (!card || !card.priceRange) {
        return {
          content: [{ type: "text", text: `No price range available for "${cardId}".` }],
          structuredContent: { found: false },
        };
      }
      const { low, high, lowDate, highDate, from, to } = card.priceRange;
      return {
        content: [
          {
            type: "text",
            text: `${card.name}: low ${card.currency} ${low} (${lowDate}), high ${card.currency} ${high} (${highDate}), covering ${from} to ${to}.`,
          },
        ],
        structuredContent: {
          found: true,
          slug: card.slug,
          name: card.name,
          currency: card.currency,
          low,
          high,
          lowDate,
          highDate,
          from,
          to,
        },
      };
    }
  );

  server.registerTool(
    "get_card_info",
    {
      title: "Get card info",
      description: mcpToolDescription("get_card_info"),
      inputSchema: z.object({
        cardId: z.string().describe("Card slug, name, number, or CardTrace numeric id."),
      }),
      // No outputSchema here on purpose — toPublicCard's shape mirrors the
      // Card type in lib/types.ts, and re-declaring it as a second,
      // hand-maintained Zod schema would just be a second place for that
      // shape to drift out of sync. structuredContent is still sent, just
      // not SDK-validated against a duplicate schema.
    },
    async ({ cardId }: { cardId: string }) => {
      const card = await findCard(cardId);
      if (!card) {
        return {
          content: [{ type: "text", text: `No card found for "${cardId}".` }],
          structuredContent: { found: false },
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `${card.name} (${card.set}${card.number ? ` ${card.number}` : ""}) — ${card.currency} ${card.currentPrice} as of ${card.asOfDate}.`,
          },
        ],
        structuredContent: { found: true, card: toPublicCard(card) },
      };
    }
  );
}, {
  serverInfo: MCP_SERVER_INFO,
});

export { handler as GET, handler as POST };
