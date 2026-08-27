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
      "Get market overview data for a card — Pokémon or One Piece. If the tool is ever run against a build with the target franchise's market tracking switched off, it returns found:true, available:false instead; use get_card_info for that card's own real current price in that case. Two parts: (1) eBay-backed data by condition tier (PSA 10, PSA 9, PSA 8, Raw) and market (English, plus Japanese for Pokémon) — up to 4 real active listings (fewer for rare cards where quality-filtered results are sparse) and their median per condition/market (falls back to a clearly-marked illustrative preview if eBay isn't reachable or has no real match), illustrative sold-listing estimates (eBay's sold-data API is restricted and unavailable), and a grading ROI estimate (raw -> PSA 10) computed from English active-listing medians only; (2) a French market view backed by Vinted rather than eBay (eBay.fr isn't a good fit for this market, so French never goes through eBay): a 'newly listed' feed with no PSA grades and no active/sold split (Vinted has neither), a rolling average, and a per-listing deal rating (good/fair/high) relative to it. That feed is FILTERED TO ONE CONDITION, 'Très bon état' — listings in Vinted's other condition tiers are excluded, so it is deliberately narrower than the unfiltered searchUrl it also returns. Rows are real listings scraped from Vinted via Lobstr.io when vinted.isReal is true, and a clearly-marked illustrative preview when it is false; real rows carry a working per-listing url, preview rows never do.",
  },
] as const;

type McpToolName = (typeof MCP_TOOLS)[number]["name"];

/** Looks up a tool's description by name instead of array position, so reordering MCP_TOOLS can't silently mismatch a tool with the wrong text. */
export function mcpToolDescription(name: McpToolName): string {
  return MCP_TOOLS.find((t) => t.name === name)!.description;
}
