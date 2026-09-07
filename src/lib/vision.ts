import { JWT } from "google-auth-library";

import { chargeApiBudget } from "@/lib/api-budget";

/**
 * Google Cloud Vision, used as a FALLBACK for card codes the browser could not
 * read on its own.
 *
 * WHY THIS IS NOT THE PRIMARY OCR. Tesseract runs on the visitor's device: it
 * is unlimited, free, private (the photo never leaves the phone) and reads 5 of
 * 6 real cards after the preprocessing in app/scan. Vision is better but capped
 * at **1,000 units/month across the whole billing account**
 * (GCP-CONTEXT.md §4.8). Making it the default would spend a finite monthly
 * budget on cards that already read for nothing.
 *
 * WHAT IT IS ACTUALLY FOR is the failure Tesseract cannot fix by trying harder:
 * a single misread glyph. Measured 2026-09-07, OP05-119 came back as OP08-119 —
 * one digit wrong, and OP08-119 is itself a real card, so the scan resolved
 * confidently to the wrong one. No crop and no regex repairs that. A stronger
 * engine is the only thing that does, and it is worth a unit precisely because
 * the alternative is a silently wrong answer.
 *
 * SCALE THIS IS BUILT FOR, stated because it decides the design: five people
 * with roughly thirty cards each — about 150 scans in total, not per day.
 * Against 1,000/month that is comfortably free, and the elaborate quota
 * protection a public free tier would need is not built here on purpose.
 *
 * EU ENDPOINT, not the global one. `eu-vision.googleapis.com` keeps the image
 * inside the European Union, which is the same reason GCP-CONTEXT.md §2 puts
 * everything in europe-west1. It is a code-level choice; there is no region to
 * set on a Vision project in the console.
 *
 * The image is sent, read, and not stored by us. Google's own retention for
 * this endpoint is theirs, not ours.
 */

/** `eu-` so the image is processed in the EU. The global host would work and would not. */
const VISION_ENDPOINT = "https://eu-vision.googleapis.com/v1/images:annotate";

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** Vision's own field name for "find text anywhere in this image". */
const FEATURE = "TEXT_DETECTION";

export class VisionNotConfiguredError extends Error {
  constructor() {
    super("GOOGLE_VISION_KEY is not set");
    this.name = "VisionNotConfiguredError";
  }
}

type ServiceAccount = { client_email: string; private_key: string };

let client: JWT | undefined;

/**
 * The signed-in JWT client, built once per server instance.
 *
 * `google-auth-library` rather than hand-rolled JWT signing: this is the one
 * security-sensitive step in the path, it caches and refreshes the access token
 * on its own, and getting RS256 assertion subtly wrong fails in ways that are
 * miserable to debug from a deployed function.
 */
function authClient(): JWT {
  if (client) return client;

  const raw = process.env.GOOGLE_VISION_KEY;
  if (!raw) throw new VisionNotConfiguredError();

  let account: ServiceAccount;
  try {
    account = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_VISION_KEY is not valid JSON — paste the whole service-account file");
  }

  if (!account.client_email || !account.private_key) {
    throw new Error("GOOGLE_VISION_KEY is missing client_email or private_key");
  }

  client = new JWT({
    email: account.client_email,
    // Vercel's env editor can turn the newlines in a PEM into the two literal
    // characters `\` and `n`. Undo that rather than making the person paste it
    // in some special way.
    key: account.private_key.replace(/\\n/g, "\n"),
    scopes: [SCOPE],
  });
  return client;
}

/** True when a key is present, so a caller can skip the whole path rather than catching. */
export function visionConfigured(): boolean {
  return Boolean(process.env.GOOGLE_VISION_KEY);
}

/**
 * Every line of text Vision finds in an image.
 *
 * Returns the full annotation rather than a card code: extracting a code is
 * lib/card-code-ocr.ts's job, it is already measured against real OCR noise,
 * and it must behave identically whichever engine produced the text. An engine
 * swap should not change what counts as a card code.
 */
export async function readTextFromImage(image: Buffer): Promise<string> {
  const auth = authClient();

  // Charged before the call, like every other metered client here — the ledger
  // over-counts a retry rather than under-counting a spend.
  chargeApiBudget("vision.googleapis.com");

  const token = await auth.getAccessToken();
  const response = await fetch(VISION_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: image.toString("base64") },
          features: [{ type: FEATURE }],
          // A card code is Latin characters even on a Japanese card, and saying
          // so stops the detector from reading the surrounding kana as the
          // likelier interpretation of an ambiguous glyph.
          imageContext: { languageHints: ["en"] },
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Vision refused the request (${response.status}): ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    responses?: { fullTextAnnotation?: { text?: string }; error?: { message?: string } }[];
  };

  const first = payload.responses?.[0];
  if (first?.error?.message) throw new Error(`Vision: ${first.error.message}`);

  // No text found is a legitimate answer about a photo, not a failure.
  return first?.fullTextAnnotation?.text ?? "";
}
