import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Which Japanese Pokemon card images live in this repository.
 *
 * WHY ANY LIVE HERE. Whole Japanese sets from 1996 to 2004 are pictured by no
 * free source at all — VS1's 143 cards, E1's 128, E3's 90 (the Wind from the Sea
 * Lugia), PCG2's 82 (the Clash of the Blue Sky Rayquaza). TCGdex publishes those
 * sets and returns zero image URLs for them; Limitless Japanese begins at
 * September 2010; the official Japanese site covers current formats only. That
 * is an absence at the source, not an ingestion gap, and a card with no picture
 * cannot be scanned, cannot be compared, and ranks behind anything that can.
 *
 * They were downloaded once (scripts/tcgc-japanese.mts) rather than
 * proxied, so nothing at request time depends on a donation-supported server.
 *
 * WHY A DIRECTORY LISTING RATHER THAN A MANIFEST — the same reason as
 * lib/one-piece-images.ts, which this deliberately mirrors: the files ARE the
 * manifest, and the one failure mode an index introduces is the broken image
 * this module exists to prevent.
 *
 * Read once per process. `public/` is served from the CDN, so nothing here sits
 * on a request path; this only answers "which URL should the page point at".
 */

const DIR = path.join(process.cwd(), "public", "card-images", "pokemon-ja");

/** Matches where the fetch script writes, and the URL `public/` implies. */
const PUBLIC_PREFIX = "/card-images/pokemon-ja";

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
    // No directory, or unreadable: every caller falls back to nothing, which is
    // what the page showed before any image was fetched.
  }
  return index;
}

/**
 * The stored picture for one Japanese card, or nothing.
 *
 * Keyed by set and printed number because that is what both sides of the join
 * agree on — their page carries the printed number in every tile, and it is the
 * only field a 2003 card and a 2026 database share.
 *
 * A stored file is one fixed size (320px wide, as served), so callers must not
 * append a width: a query string a static file cannot honour would only mislead
 * the next reader.
 */
export function pokemonJapaneseStoredImage(setId: string, localId: string): string | undefined {
  const key = `${setId}-${localId}`;
  return load().has(key) ? `${PUBLIC_PREFIX}/${encodeURIComponent(key)}.webp` : undefined;
}

export function pokemonJapaneseStoredCount(): number {
  return load().size;
}
