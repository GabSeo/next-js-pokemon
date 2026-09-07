import { lookupCards } from "@/lib/card-lookup";

/**
 * Which of these codes are real cards?
 *
 * WHY THE SCAN NEEDS THIS. On-device OCR routinely produces a code-SHAPED
 * string that is not a card. Measured on a real photo (s-l1200.jpg,
 * 2026-09-07): Tesseract returned two candidates, neither of which exists in
 * either catalogue. The scan treated "found something" as success, showed the
 * junk, and never escalated to Vision — because the browser has no way to tell
 * a real code from a plausible one. The catalogue is on the server.
 *
 * So this is the missing question in the middle of the flow:
 *
 *   Tesseract -> candidates -> ARE ANY REAL? -> no -> Vision
 *
 * FREE, and that is the whole reason it can sit on that path. It reads
 * lib/card-lookup, which reads the catalogues off disk and touches no metered
 * upstream — `scripts/check-free-tier.mts` enforces that. A validation step
 * that cost quota would defeat the point of asking before spending a Vision
 * unit.
 */

export const runtime = "nodejs";

/** More than a handful means the caller is not a scan. */
const MAX_CODES = 12;

export async function POST(request: Request) {
  let payload: { codes?: unknown };
  try {
    payload = (await request.json()) as { codes?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const codes = Array.isArray(payload.codes)
    ? payload.codes.filter((c): c is string => typeof c === "string").slice(0, MAX_CODES)
    : [];

  // Ordered as received, so the caller keeps its own ranking — the first real
  // code in ITS order is the one it should prefer, not the first we happen to
  // resolve.
  const real = codes.filter((code) => lookupCards(code).matches.length > 0);

  return Response.json({ real });
}
