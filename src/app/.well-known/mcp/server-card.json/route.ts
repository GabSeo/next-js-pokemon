import { NextResponse } from "next/server";
import { mcpServerCard } from "@/lib/mcp-server-card";

export async function GET() {
  return NextResponse.json(mcpServerCard());
}
