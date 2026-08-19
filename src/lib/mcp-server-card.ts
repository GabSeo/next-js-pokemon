import { MCP_SERVER_INFO, MCP_TOOLS } from "@/lib/mcp";
import { absoluteUrl } from "@/lib/site";

/**
 * The MCP Server Card — served at both the canonical SEP-1649 path
 * (/.well-known/mcp/server-card.json) and the older flat convention
 * (/.well-known/mcp-server.json) some early scanners still check. Built
 * from the same MCP_SERVER_INFO/MCP_TOOLS the live server itself uses, so
 * this discovery document can't describe a server that doesn't match it.
 */
export function mcpServerCard() {
  return {
    serverInfo: MCP_SERVER_INFO,
    description:
      "Tools for listing tracked Pokémon and One Piece cards, checking price ranges, and getting full card detail on CardTrace.",
    transport: {
      type: "streamable-http",
      endpoint: absoluteUrl("/api/mcp"),
    },
    capabilities: { tools: true },
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  };
}
