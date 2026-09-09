import { getCardView, type CardView } from "@/lib/card-view";
import { lookupCards } from "@/lib/card-lookup";
import { codeForPicture } from "@/lib/one-piece-optcg";

/**
 * The card code behind whatever the One Piece matcher returned.
 *
 * Bandai's printing ids carry the code with a suffix; optcgapi's filenames do
 * not carry it reliably at all, so those go through the picture join. Falling
 * back to the id itself keeps a plain code working unchanged.
 */
function onePieceCardCode(id: string): string {
  const stripped = id.replace(/_(?:p|pr|r)\d+$/, "");
  if (/^[A-Z]+\d*-\d+$/i.test(stripped) || /^P-\d+$/i.test(stripped)) return stripped;
  return codeForPicture(id) ?? stripped;
}

/**
 * Turn scanned codes into the actual cards, with every printing of each.
 *
 * WHY THIS RETURNS WHOLE CARDS RATHER THAN A YES/NO. It began as a validity
 * check — "which of these codes are real" — so the scan could decide whether to
 * escalate. That question still gets answered, but answering only that forced
 * the scan to navigate away to /lookup to show anything, which threw away the
 * photo, the context, and the sense of one continuous action. Scanning a card
 * and choosing which printing you own are two halves of one gesture; they
 * belong in one view.
 *
 * So the scan now asks for everything it needs to finish: the card, its name,
 * and its printings with their artwork and prices. Nothing downstream has to
 * fetch again, and nothing has to change page.
 *
 * FREE, which is what lets it sit in the middle of the scan. It reads the
 * catalogues and the price snapshot off disk and touches no metered upstream —
 * `scripts/check-free-tier.mts` enforces that rather than trusting it. A
 * validation step that cost quota would defeat its own purpose.
 *
 * ORDER IS THE CALLER'S. Codes come back in the order they were sent, because
 * the scanner ranks its candidates and that ranking is information this route
 * does not have.
 */

export const runtime = "nodejs";

/** More than a handful means the caller is not a scan. */
const MAX_CODES = 8;

/** A scanned code can match several cards — `190/182` is two — but not dozens. */
const MAX_CARDS_PER_CODE = 6;

export async function POST(request: Request) {
  let payload: { codes?: unknown; ids?: unknown; tcg?: unknown };
  try {
    payload = (await request.json()) as { codes?: unknown; ids?: unknown; tcg?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const codes = Array.isArray(payload.codes)
    ? payload.codes.filter((c): c is string => typeof c === "string").slice(0, MAX_CODES)
    : [];

  // IDS ARE A SECOND, STRONGER KIND OF QUESTION. A code is a printed number and
  // names more than one card half the time, so `codes` fans out through a
  // lookup. An id came from the artwork matcher, which already decided WHICH
  // card — there is nothing left to disambiguate, so it resolves directly.
  // Both live here because the answer is the same shape and the caller mixes
  // them: the client matches locally, then falls back to OCR when unsure.
  const ids = Array.isArray(payload.ids)
    ? payload.ids.filter((c): c is string => typeof c === "string").slice(0, MAX_CODES)
    : [];

  /**
   * WHICH GAME THE IDS BELONG TO, sent rather than guessed. It defaulted to
   * Pokemon while Pokemon was the only indexed game, and a One Piece printing
   * id put through `getCardView("pokemon", …)` resolves to nothing at all —
   * a silent empty result rather than a visible error.
   */
  const tcg: "pokemon" | "onepiece" = payload.tcg === "onepiece" ? "onepiece" : "pokemon";

  const real: string[] = [];
  const cards: CardView[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    // A ONE PIECE MATCH NAMES A PICTURE, and pictures come in two shapes: a
    // Bandai printing id like `ST21-014_p2`, and — for the 970 printings Bandai
    // does not publish — an optcgapi filename like
    // `Monkey.D.Luffy_-_ST21-014_3rd_Anniversary_Treasure_Campaign_Pack_img`.
    // The card view is keyed on the CARD that owns the picture, so both are
    // translated here. Nothing is lost: the view lists every printing and ranks
    // them by the same artwork.
    const code = tcg === "onepiece" ? onePieceCardCode(id) : id;
    const key = `${tcg}:${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const view = await getCardView(tcg, code);
    if (view) {
      real.push(id);
      cards.push(view);
    }
  }

  for (const code of codes) {
    const matches = lookupCards(code).matches.slice(0, MAX_CARDS_PER_CODE);
    if (matches.length === 0) continue;
    real.push(code);

    for (const match of matches) {
      // Two candidates can resolve to the same card — a trimmed prefix variant
      // and the full read, say — and it should appear once.
      const id = `${match.tcg}:${match.code}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const view = await getCardView(match.tcg, match.code);
      if (view) cards.push(view);
    }
  }

  // `real` is kept alongside `cards` because they answer different questions:
  // which codes were readable, and what to show. The scan uses the first to
  // decide whether the read failed at all.
  return Response.json({ real, cards });
}
