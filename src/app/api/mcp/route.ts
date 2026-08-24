import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { findCard, getAllCards, getCardsByFranchise, toPublicCard } from "@/lib/cards";
import { getGradedMarketData } from "@/lib/graded-market";
import { MCP_SERVER_INFO, mcpToolDescription } from "@/lib/mcp";
import { absoluteUrl } from "@/lib/site";

/** Matches the [cards] console convention in cards.ts — enough to root-cause a future quota or usage question from real logs, not full request/response payloads. */
function logMcpTool(name: string, detail: string) {
  console.log(`[mcp] ${name}: ${detail}`);
}

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
            // Only ever true, and only present when no price source could
            // be reached — currentPrice is a placeholder 0 in that case and
            // must not be read as a real valuation.
            priceUnavailable: z.literal(true).optional(),
            productUrl: z.string(),
          })
        ),
      }),
    },
    async ({ franchise }) => {
      const cards = franchise ? await getCardsByFranchise(franchise) : await getAllCards();
      logMcpTool("list_cards", `franchise=${franchise ?? "all"} -> ${cards.length} card(s)`);
      const summary = cards.map((c) => ({
        slug: c.slug,
        name: c.name,
        franchise: c.franchise,
        set: c.set,
        number: c.number,
        rarity: c.rarity,
        currency: c.currency,
        currentPrice: c.currentPrice,
        ...(c.priceUnavailable ? { priceUnavailable: true as const } : {}),
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
      logMcpTool("get_price_range", `cardId=${cardId} -> ${card?.priceRange ? "found" : "not found"}`);
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
      logMcpTool("get_card_info", `cardId=${cardId} -> ${card ? "found" : "not found"}`);
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
            text: card.priceUnavailable
              ? `${card.name} (${card.set}${card.number ? ` ${card.number}` : ""}) — market price temporarily unavailable, no price source could be reached.`
              : `${card.name} (${card.set}${card.number ? ` ${card.number}` : ""}) — ${card.currency} ${card.currentPrice} as of ${card.asOfDate}.`,
          },
        ],
        structuredContent: { found: true, card: toPublicCard(card) },
      };
    }
  );

  const gradedMarketListingSchema = z.object({
    date: z.string(),
    description: z.string(),
    price: z.number(),
    currency: z.string(),
    url: z.string().optional(),
  });
  const gradedMarketTypeSchema = z.object({
    isReal: z.boolean(),
    medianPrice: z.number(),
    currency: z.string(),
    count: z.number(),
    seeAllUrl: z.string(),
    rows: z.array(gradedMarketListingSchema),
  });

  const gradedMarketLanguageSchema = z.object({
    language: z.enum(["English", "Japanese"]),
    active: gradedMarketTypeSchema,
    sold: gradedMarketTypeSchema,
  });

  const vintedFeedRowSchema = z.object({
    timeAgo: z.string().describe("How long ago the listing appeared, e.g. \"12 min\". Empty string when the listing's age isn't known."),
    condition: z.string().describe("Always \"Tr\u00e8s bon \u00e9tat\" — the feed is filtered to that one condition."),
    price: z.number(),
    currency: z.string(),
    dealPct: z.number(),
    dealTier: z.enum(["good", "fair", "high"]),
    title: z.string().optional().describe("Seller-written listing title. Real listings only."),
    url: z.string().optional().describe("Link to the listing on Vinted. Real listings only — never present on preview rows."),
    imageUrl: z.string().optional().describe("The listing's own photo. Real listings only."),
  });
  const vintedMarketSchema = z.object({
    isReal: z.boolean().describe("true = scraped Vinted listings; false = illustrative preview, treat every price as fabricated."),
    searchUrl: z.string().describe("Unfiltered Vinted search for this card — shows all conditions, unlike rows below."),
    title: z.string(),
    imageUrl: z.string().optional(),
    avgPrice: z.number().describe("Mean asking price across the listings. A true average: 1 EUR hidden-auction listings are excluded before it is computed."),
    currency: z.string(),
    rows: z.array(vintedFeedRowSchema),
    belowAverageCount: z.number(),
    conditionFilter: z.string().describe("The single condition every row is filtered to: \"Tr\u00e8s bon \u00e9tat\"."),
  });

  server.registerTool(
    "get_graded_market",
    {
      title: "Get graded market",
      description: mcpToolDescription("get_graded_market"),
      inputSchema: z.object({
        cardId: z.string().describe("Card slug, name, number, or CardTrace numeric id."),
      }),
      outputSchema: z.object({
        found: z.boolean(),
        conditions: z
          .array(
            z.object({
              condition: z.enum(["PSA 10", "PSA 9", "PSA 8", "Raw"]),
              languages: z.array(gradedMarketLanguageSchema),
            })
          )
          .optional(),
        roi: z
          .object({
            isReal: z.boolean(),
            percent: z.number(),
            psa10Median: z.number(),
            rawMedian: z.number(),
            gradingCostUsd: z.number(),
            currency: z.string(),
          })
          .optional(),
        vinted: vintedMarketSchema.optional(),
      }),
    },
    async ({ cardId }: { cardId: string }) => {
      const card = await findCard(cardId);
      logMcpTool("get_graded_market", `cardId=${cardId} -> ${card ? "found" : "not found"}`);
      if (!card) {
        return {
          content: [{ type: "text", text: `No card found for "${cardId}".` }],
          structuredContent: { found: false },
        };
      }
      const data = await getGradedMarketData(card);
      const psa10English = data.conditions.find((c) => c.condition === "PSA 10")!.languages.find((l) => l.language === "English")!;
      return {
        content: [
          {
            type: "text",
            text: `${card.name}: PSA 10 active median ${psa10English.active.currency} ${psa10English.active.medianPrice} (${
              psa10English.active.isReal ? "real, eBay" : "preview, eBay not connected"
            }, English). Grading ROI raw -> PSA 10: ${data.roi.percent >= 0 ? "+" : ""}${data.roi.percent.toFixed(0)}% (${
              data.roi.isReal ? "real" : "preview"
            }). France/Vinted (${data.vinted.conditionFilter} only), avg of ${data.vinted.rows.length} listings: ${data.vinted.currency} ${data.vinted.avgPrice} (${
              data.vinted.isReal ? "real, scraped via Lobstr" : "preview, no scraped listings yet"
            }).`,
          },
        ],
        structuredContent: { found: true, conditions: data.conditions, roi: data.roi, vinted: data.vinted },
      };
    }
  );
}, {
  serverInfo: MCP_SERVER_INFO,
});

export { handler as GET, handler as POST };
