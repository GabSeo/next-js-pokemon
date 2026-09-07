import { artDistance, artSignature, rarityFromText, referenceSignatures } from "@/lib/art-rank";
import { extractCardCodes } from "@/lib/card-code-ocr";
import { lookupCards } from "@/lib/card-lookup";
import { getCardView, type CardPrint, type CardView } from "@/lib/card-view";
import { readTextFromImage, visionConfigured, VisionNotConfiguredError } from "@/lib/vision";

/**
 * Read a card photo with Google Vision, for the codes the browser could not.
 *
 * THE SECOND ATTEMPT, NEVER THE FIRST. The scan page runs Tesseract on the
 * device first — free, unlimited, and the photo never leaves the phone. This
 * route is called only when that produced nothing, or produced something the
 * catalogue does not recognise. On the 5 of 6 real cards the client already
 * reads, Vision is never invoked and no unit is spent.
 *
 * That ordering is the whole cost design. 1,000 units/month is plenty for five
 * people with thirty cards each (~150 scans, total) precisely because most of
 * those scans never reach here.
 *
 * METERED, AND DECLARED AS SUCH. `vision.googleapis.com` has a ceiling in
 * lib/api-budget.ts, so `scripts/check-free-tier.mts` sees this route as
 * spending and requires it to be listed. That is correct rather than
 * unfortunate: the scan is a premium feature and this is the metered half of
 * it.
 *
 * NO ACCOUNT CHECK YET, deliberately and temporarily. Scanning becomes
 * account-gated at launch; today the site is unindexed, the audience is five
 * named people, and building an entitlement system for them would be the
 * over-engineering this project has been avoiding on purpose. `SCAN_SECRET`
 * below is the whole lock: set it and the route requires it, leave it unset and
 * the route is open. When accounts exist, this check is what they replace.
 *
 * The image is read and discarded. Nothing is written to disk and nothing is
 * logged from it.
 */

export const runtime = "nodejs";

/**
 * What is wrong with the key, without ever showing it.
 *
 * Added because diagnosing this by guesswork was costing more than the feature.
 * The 501 the POST returns says only "not configured", which is true for a
 * missing variable and indistinguishable from one that is present but
 * unusable — a truncated paste, a value scoped to the wrong environment, or a
 * PEM whose newlines an editor turned into the characters backslash-n.
 *
 * Everything below is a SHAPE, never a value: whether the variable exists, how
 * long it is, whether it parses, and whether the two fields that matter are
 * present. `client_email` is reported as its domain only, which identifies the
 * project without exposing the account. The private key is reported as a length
 * and a yes/no on looking like a PEM. None of it is a secret, and all of it is
 * enough to tell the four failure modes apart in one request.
 */
export function GET() {
  const raw = process.env.GOOGLE_VISION_KEY;

  if (!raw) {
    return Response.json({
      configured: false,
      problem: "GOOGLE_VISION_KEY is not present on this deployment.",
      likely:
        "The variable exists in Vercel but is not ticked for this environment " +
        "(a branch deploys to Preview, not Production), or it was added after " +
        "this deployment was built. Tick Preview, then redeploy.",
    });
  }

  // Same acceptance as lib/vision.ts: raw JSON, or base64 of it.
  const trimmed = raw.trim();
  const decoded = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");

  let parsed: { client_email?: string; private_key?: string; private_key_id?: string };
  try {
    parsed = JSON.parse(decoded) as typeof parsed;
  } catch {
    return Response.json({
      configured: false,
      length: raw.length,
      encoding: trimmed.startsWith("{") ? "looks like raw JSON" : "not JSON — tried base64 and that failed too",
      problem: "Present, but unreadable.",
      likely:
        raw.length < 200
          ? "Too short to be a service-account file — this looks like a single field (a private_key_id or an API key) rather than the whole JSON."
          : "The paste may be truncated. Copy the entire downloaded .json, braces included.",
    });
  }

  const key = parsed.private_key ?? "";
  return Response.json({
    configured: Boolean(parsed.client_email && parsed.private_key),
    length: raw.length,
    hasClientEmail: Boolean(parsed.client_email),
    // Domain only: identifies the project, exposes no account.
    emailDomain: parsed.client_email?.split("@")[1] ?? null,
    hasPrivateKey: Boolean(parsed.private_key),
    privateKeyLength: key.length,
    privateKeyLooksLikePem: key.includes("BEGIN PRIVATE KEY"),
    // The one mangling that is common and silent.
    privateKeyHasLiteralBackslashN: key.includes("\n"),
    problem:
      parsed.client_email && parsed.private_key
        ? null
        : parsed.private_key_id && !parsed.private_key
          ? "This has private_key_id but no private_key — it is not the full service-account file."
          : "Missing client_email or private_key.",
  });
}

/** Vision's own hard limit is 20 MB base64; a phone photo is 2–6 MB and a card needs far less. */
const MAX_BYTES = 8 * 1024 * 1024;

/** Beyond this, comparing every printing costs more than the ordering is worth. */
const MAX_RANKED_PRINTINGS = 10;

/**
 * Reorder each card's printings so the one that looks like the photo comes
 * first, and drop the ones whose rarity the photo contradicts.
 *
 * ONE PIECE ONLY. Pokémon printings share their artwork — 0 of 10,110
 * multi-variant cards have a distinct image — so there is nothing to compare and
 * catalogue order is already the right order.
 *
 * Mutates in place and never throws: an unreadable image, a reference that will
 * not fetch, or a rarity that matches nothing all leave the list exactly as the
 * catalogue gave it. A worse ordering is a small loss; a failed scan is not.
 */
async function rankPrintings(cards: CardView[], image: Buffer, text: string): Promise<void> {
  const photo = await artSignature(image);
  if (!photo) return;

  const rarity = rarityFromText(text);
  const english = referenceSignatures("english");
  const japanese = referenceSignatures("japanese");
  if (english.size === 0 && japanese.size === 0) return;

  for (const card of cards) {
    if (card.tcg !== "onepiece") continue;
    if (card.prints.length < 2 || card.prints.length > MAX_RANKED_PRINTINGS) continue;

    // Precomputed, read from disk once per process. This used to fetch and hash
    // each reference image per scan -- seven sequential 250 KB downloads for a
    // seven-printing card, which was the entire "works great but very slow".
    const scored: { print: CardPrint; distance: number }[] = [];
    const unpictured: CardPrint[] = [];
    let gap = false;

    for (const print of card.prints) {
      // A printing nobody has published a picture of cannot be compared to a
      // photograph, and that is not a coverage gap — 139 promo printings are
      // named by the mirror and pictured by no one. Sorting them last is the
      // honest place for them: they stay reachable, and they cannot win a
      // comparison they never entered.
      if (!print.image) {
        unpictured.push(print);
        continue;
      }

      // A print whose key is `<printingId>~<product>` is a separate product
      // that the mirror points at an existing printing's picture — a Jumbo, an
      // oversized event print. It has no signature of its own because it has no
      // artwork of its own, so it is compared using the picture it shares.
      const base = print.key.includes("~") ? print.key.slice(0, print.key.indexOf("~")) : print.key;
      const signature = english.get(print.key) ?? japanese.get(print.key) ?? english.get(base) ?? japanese.get(base);
      // A printing that HAS a picture and no signature is a real gap in the
      // catalogue. Ranking the rest would quietly promote whichever printings
      // happened to be covered, so the card keeps catalogue order instead.
      if (!signature) {
        gap = true;
        break;
      }
      scored.push({ print, distance: artDistance(photo, signature) });
    }

    if (gap || scored.length < 2) continue;

    // Rarity BOOSTS, it does not filter, and the difference matters. Vision read
    // both "SP" and "SR" off one real card; had the wrong one won, filtering
    // would have deleted the correct printing from the list entirely and left
    // the person unable to choose it. A misread now costs ordering, which is
    // recoverable by looking, rather than availability, which is not.
    //
    // The bonus is deliberately larger than the widest observed artwork gap
    // (0.206 across seven printings), so a rarity match leads — but everything
    // stays on screen.
    for (const entry of scored) {
      if (rarity && entry.print.rarity === rarity) entry.distance -= 1;
    }

    scored.sort((a, b) => a.distance - b.distance);
    card.prints = [...scored.map((s) => s.print), ...unpictured];
  }
}

export async function POST(request: Request) {
  if (!visionConfigured()) {
    // 501, not 500: nothing is broken, the feature simply is not set up. The
    // client treats this as "stay with what the browser read".
    return Response.json(
      { error: "Vision is not configured on this deployment." },
      { status: 501 }
    );
  }

  // Optional shared secret. Unset means open, which is the current intent.
  const required = process.env.SCAN_SECRET;
  if (required && request.headers.get("x-scan-secret") !== required) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    return Response.json(
      { error: "POST the image bytes with an image/* Content-Type." },
      { status: 415 }
    );
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return Response.json({ error: "Empty body." }, { status: 400 });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return Response.json(
      { error: `Image too large: ${Math.round(bytes.byteLength / 1024)} KB, limit ${MAX_BYTES / 1024} KB.` },
      { status: 413 }
    );
  }

  const image = Buffer.from(bytes);

  try {
    const text = await readTextFromImage(image);
    // The SAME extractor the client uses. An engine swap must not change what
    // counts as a card code, and this one is measured against real OCR noise.
    const candidates = extractCardCodes(text);

    // Resolve to real cards here rather than in a second round trip: the photo
    // is already uploaded, and asking the client to send it twice to rank the
    // printings would double the slowest part of the scan.
    const cards: CardView[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      for (const match of lookupCards(candidate.value).matches.slice(0, 6)) {
        const id = `${match.tcg}:${match.code}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const view = await getCardView(match.tcg, match.code);
        if (view) cards.push(view);
      }
    }

    await rankPrintings(cards, image, text);

    return Response.json({ text, candidates, cards });
  } catch (error) {
    if (error instanceof VisionNotConfiguredError) {
      return Response.json({ error: "Vision is not configured." }, { status: 501 });
    }
    // Budget exhausted, a refused key, a network fault. All the same to the
    // client, which falls back to what the browser read or to typing.
    const message = error instanceof Error ? error.message : "Vision failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
