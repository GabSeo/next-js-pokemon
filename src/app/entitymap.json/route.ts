import { NextResponse } from "next/server";
import { entityMapDocument } from "@/lib/entitymap";

export async function GET() {
  return NextResponse.json(await entityMapDocument());
}
