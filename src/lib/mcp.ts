/**
 * Single source of truth for the MCP server's identity and tool
 * descriptions — shared between the live server (app/api/mcp/route.ts) and
 * the discovery documents that describe it (the well-known server-card
 * files), so the two can never drift out of sync.
 */
export const MCP_SERVER_INFO = {
  name: "CardTrace MCP",
  version: "0.1.0",
} as const;

export const MCP_TOOLS = [
  {
    name: "list_cards",
    description:
      "List every Pokémon or One Piece card CardTrace tracks, with current price. Omit franchise to list all tracked cards.",
  },
  {
    name: "get_price_range",
    description:
      "Get the lowest and highest recorded price for a card over its available price history (currently up to ~100 daily records), plus the exact date range that covers — never assumes a longer window than was actually fetched.",
  },
  {
    name: "get_card_info",
    description:
      "Get full detail for one card: current price, trend signal, price range, price history, recent snapshots, set/rarity metadata, and canonical page links.",
  },
  {
    name: "get_graded_market",
    description:
      "Get Pokémon market overview data for a card. Two parts: (1) eBay-backed data by condition tier (PSA 10, PSA 9, PSA 8, Raw) and market (English, Japanese) — up to 4 real active listings (fewer for rare cards where quality-filtered results are sparse) and their median per condition/market (falls back to a clearly-marked illustrative preview if eBay isn't reachable), illustrative sold-listing estimates (eBay's sold-data API is restricted and unavailable), and a grading ROI estimate (raw -> PSA 10) computed from English active-listing medians only; (2) an always-illustrative French market view sourced from Vinted's own condition tiers (Très bon état, Bon état, Satisfaisant) instead of PSA grades — eBay.fr isn't a good fit for this market, so French never goes through eBay.",
  },
] as const;

type McpToolName = (typeof MCP_TOOLS)[number]["name"];

/** Looks up a tool's description by name instead of array position, so reordering MCP_TOOLS can't silently mismatch a tool with the wrong text. */
export function mcpToolDescription(name: McpToolName): string {
  return MCP_TOOLS.find((t) => t.name === name)!.description;
}
