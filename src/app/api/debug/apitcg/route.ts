import { NextResponse } from "next/server";

const API_BASE = "https://api.apitcg.com/api";

/**
 * Temporary diagnostic route — inspects raw apitcg.com search results to
 * debug the Pokémon name/set/number matching logic. Remove once Pokémon
 * card resolution is confirmed working (see PLAN.md real-data integration).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tcg = searchParams.get("tcg") ?? "pokemon";
  const name = searchParams.get("name") ?? "";

  const key = process.env.APITCG_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "APITCG_API_KEY not set" }, { status: 500 });
  }

  const qs = new URLSearchParams({ tcg, type: "card", name, limit: "25" });
  const res = await fetch(`${API_BASE}/products?${qs}`, {
    headers: { "x-api-key": key },
  });

  const body = await res.json();
  const summarized = Array.isArray(body?.data)
    ? body.data.map((p: Record<string, unknown>) => ({
        name: p.name,
        setName: (p.set as { name?: string } | undefined)?.name,
        code: p.code,
        number: (p.attributes as Record<string, string> | undefined)?.Number,
        rarity: (p.attributes as Record<string, string> | undefined)?.Rarity,
      }))
    : body;

  return NextResponse.json({ status: res.status, total: body?.total, results: summarized });
}
