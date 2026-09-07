import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { onePieceSrc } from "@/lib/one-piece-image-url";

/**
 * Which card images live in this repository rather than at Bandai.
 *
 * WHY ANY LIVE HERE. 551 One Piece printings are known to optcgapi and absent
 * from Bandai's card list — regional promos, judge packs, anniversary sets. For
 * 523 of them Bandai serves no image at all, so a person scanning one of those
 * cards was shown somebody else's artwork. They were downloaded once
 * (scripts/one-piece-image-repatriate.mts) rather than proxied, so nothing at
 * request time depends on a donation-supported server that may not outlive the
 * project.
 *
 * WHY A DIRECTORY LISTING RATHER THAN A MANIFEST. The files ARE the manifest.
 * A separate JSON index would be a second thing to keep in step, and the one
 * failure mode it introduces — index says yes, file says no — is exactly the
 * broken image this module exists to prevent.
 *
 * Read once per process. `public/` is served straight from the CDN, so nothing
 * here is on a request path; this only answers "which URL should the page
 * point at".
 */

const DIR = path.join(process.cwd(), "public", "card-images", "one-piece");

/** Matches where the repatriation script writes, and the URL `public/` implies. */
const PUBLIC_PREFIX = "/card-images/one-piece";

let index: Set<string> | undefined;

function load(): Set<string> {
  if (index) return index;
  index = new Set<string>();
  try {
    if (existsSync(DIR)) {
      for (const name of readdirSync(DIR)) {
        if (name.endsWith(".webp")) index.add(name.slice(0, -".webp".length));
      }
    }
  } catch {
    // No directory, or unreadable: every caller falls back to Bandai, which is
    // what happened before any image was repatriated.
  }
  return index;
}

/**
 * Where to point at this printing's artwork.
 *
 * Repatriated file first — it exists precisely because Bandai has nothing —
 * then the Bandai proxy, which resizes and caches and covers everything else.
 *
 * Never returns undefined: a printing with no image anywhere still gets the
 * proxy URL, and the route answers 404 rather than the page rendering a hole
 * it cannot explain.
 */
export function onePieceImageUrl(
  printingId: string,
  options: { language?: string; width?: number } = {}
): string {
  // A repatriated file is stored at one width and cannot be resized per
  // request, so `width` is deliberately ignored rather than appended — a query
  // string a static file cannot honour would only mislead the next reader.
  if (load().has(printingId)) return `${PUBLIC_PREFIX}/${encodeURIComponent(printingId)}.webp`;

  const language = options.language ?? "english";
  const url = `/api/one-piece-image/${encodeURIComponent(printingId)}?lang=${language}`;
  return options.width ? onePieceSrc(url, options.width) : url;
}

/**
 * The same question for a printing Bandai's card list does not carry — where
 * the answer may honestly be "nowhere".
 *
 * Measured 2026-09-07: of the 631 such printings, 541 were repatriated, 10 turn
 * out to be at Bandai anyway, and 80 have no picture anywhere public. Those 80
 * are real cards — `EB01-043_pr4`, the Offline Regional Participation Pack
 * Spandine — and optcgapi names them while carrying no image.
 *
 * Returning the proxy URL for those would render a broken tile; returning
 * undefined lets the page say "this printing exists, we have no picture", which
 * is both true and more useful than a 404. A printing we cannot picture and a
 * printing that does not exist are different claims — the same rule this
 * project already applies to prices.
 *
 * `upstream` is whether the mirror holds an image at all. When it does and we
 * hold no file, repatriation skipped it precisely because Bandai serves it, so
 * the proxy is the right answer.
 */
export function onePieceImageUrlOrNone(printingId: string, upstream: boolean): string | undefined {
  if (load().has(printingId)) return `${PUBLIC_PREFIX}/${encodeURIComponent(printingId)}.webp`;
  return upstream ? onePieceImageUrl(printingId) : undefined;
}

/** True when the artwork is a file we hold, so a caller knows not to append a width. */
export function isRepatriated(printingId: string): boolean {
  return load().has(printingId);
}

export function repatriatedCount(): number {
  return load().size;
}

// The width rule lives in one-piece-image-url.ts so client components can
// share it: this module reads the filesystem and they cannot import it.
export { ONE_PIECE_IMAGE_WIDTHS, onePieceSrc, onePieceSrcSet } from "@/lib/one-piece-image-url";
