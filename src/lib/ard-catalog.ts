import { MCP_SERVER_INFO } from "@/lib/mcp";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl, siteHost } from "@/lib/site";

/**
 * Agentic Resource Discovery catalog. Two traps confirmed by the field-test
 * source material, both worth stating explicitly since they're easy to get
 * wrong and fail validation silently otherwise:
 *   - specVersion is the literal string "1.0" — the spec *document* is a
 *     v0.9 draft, but the schema pins the wire format to 1.0.
 *   - every identifier is a URN: urn:ai:<publisher>:<namespace>:<name>,
 *     where the publisher segment is the bare domain.
 *
 * Only one entry: the MCP server. No entry references the REST API or
 * api-catalog — neither exists as a discovery document yet (api-catalog is
 * still on the plan's "optional, later" list), and this file should never
 * point at something that isn't actually live.
 */
export function ardCatalog() {
  const host = siteHost();
  return {
    specVersion: "1.0",
    host: {
      displayName: SITE_NAME,
      identifier: `did:web:${host}`,
      documentationUrl: absoluteUrl("/llms.txt"),
    },
    entries: [
      {
        identifier: `urn:ai:${host}:server:price-mcp`,
        displayName: MCP_SERVER_INFO.name,
        type: "application/mcp-server-card+json",
        url: absoluteUrl("/.well-known/mcp/server-card.json"),
        description: `${SITE_DESCRIPTION} MCP server exposes tools to list tracked cards, check price ranges, and get full card detail.`,
        representativeQueries: [
          "check the current price of a Pokémon card",
          "find an MCP server for TCG card price history",
          "what's the lowest and highest price of a One Piece card this year",
        ],
        version: MCP_SERVER_INFO.version,
      },
    ],
  };
}
