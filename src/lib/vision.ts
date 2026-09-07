import { JWT } from "google-auth-library";

import { chargeApiBudget } from "@/lib/api-budget";

/**
 * Google Cloud Vision — the card reader.
 *
 * THE ONLY OCR, since 2026-09-07. This began as a fallback behind Tesseract in
 * the browser, which existed to protect Vision's 1,000 units/month. At this
 * project's real scale — five people, roughly thirty cards each, about 150
 * scans in TOTAL rather than per day — there is no quota to protect, so the
 * second engine bought nothing and cost a multi-megabyte wasm download per
 * visit, three hand-tuned crop regions and two paths to debug.
 *
 * It also removed a class of failure. Tesseract read OP05-119 as OP08-119 —
 * one glyph wrong, and OP08-119 is itself a real card, so the scan resolved
 * confidently to the wrong one. On another photo it returned two code-shaped
 * strings that were not cards at all, which the scan counted as success.
 * Neither is fixable by cropping harder.
 *
 * NOT INFALLIBLE EITHER, which is why `/api/scan/resolve` still asks the
 * catalogue whether a candidate is a real card before it is shown.
 *
 * EU ENDPOINT, not the global one. `eu-vision.googleapis.com` keeps the image
 * inside the European Union, which is the same reason GCP-CONTEXT.md §2 puts
 * everything in europe-west1. It is a code-level choice; there is no region to
 * set on a Vision project in the console.
 *
 * The image is sent, read, and not stored by us. Google's own retention for
 * this endpoint is theirs, not ours — so the page says "sent once, read, and
 * not kept" rather than claiming the photo never leaves the device, which was
 * true of Tesseract and is not true of this.
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

/**
 * A service account from either the raw JSON or a base64 copy of it.
 *
 * BASE64 IS THE RECOMMENDED FORM, and the reason is Vercel's environment
 * editor. A service-account file is multi-line and its `private_key` is a PEM
 * full of newlines; pasting it raw makes the editor warn that the value "starts
 * with whitespace and has return characters", and the newlines survive or do
 * not depending on how it was pasted. Base64 is one line of `A-Za-z0-9+/=` with
 * nothing an editor can normalise, so it either arrives intact or not at all.
 *
 * Raw JSON is still accepted, because it works when it works and telling
 * someone their existing setup is invalid would be a lie.
 */
function parseServiceAccount(raw: string): ServiceAccount {
  const trimmed = raw.trim();

  // A JSON object starts with `{`; anything else that is long is base64.
  const decoded = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");

  let account: ServiceAccount;
  try {
    account = JSON.parse(decoded) as ServiceAccount;
  } catch {
    throw new Error(
      "GOOGLE_VISION_KEY is neither valid JSON nor base64-encoded JSON. " +
        "Paste the whole service-account file, or its base64 (see /api/scan/ocr for what is actually there)."
    );
  }
  return account;
}

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

  const account = parseServiceAccount(raw);

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
