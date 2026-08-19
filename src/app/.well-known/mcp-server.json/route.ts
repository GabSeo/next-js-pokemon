import { NextResponse } from "next/server";
import { mcpServerCard } from "@/lib/mcp-server-card";

// Older flat convention some early MCP scanners still check, alongside the
// canonical SEP-1649 path at /.well-known/mcp/server-card.json. Same content.
export async function GET() {
  return NextResponse.json(mcpServerCard());
}
