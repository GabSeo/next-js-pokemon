import { NextResponse } from "next/server";
import { ardCatalog } from "@/lib/ard-catalog";

export async function GET() {
  return NextResponse.json(ardCatalog());
}
