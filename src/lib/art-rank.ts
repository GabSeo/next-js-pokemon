import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

/**
 * Order a card's printings by how much they look like the photo.
 *
 * WHY THIS RANKS RATHER THAN DECIDES. A One Piece code can name seven
 * printings, and the only thing separating them is the picture — Bandai records
 * THAT a code has seven and never which is the alt art. Showing seven tiles in
 * catalogue order asks the person to scan a grid; showing them best-first asks
 * them to confirm a guess. The second is a much smaller job, and it is honest
 * about its confidence in a way that auto-selecting would not be.
 *
 * MEASURED, AND THE FIRST MEASUREMENT WAS WRONG. Six experiments concluded this
 * could not work, at a spread of 0.049 between best and worst — indistinguishable
 * from noise. They were comparing a photo of Eustass Kid against printings of
 * Monkey D. Luffy, because the test file was not the card it was assumed to be.
 * Against the right card the same code separates at 0.206, four times wider, and
 * the nearest rival is twice as far as the best match. The lesson is about
 * checking what is in the photo before concluding anything about the method.
 *
 * TWO SIGNALS, deliberately different in kind:
 *
 *   chroma   the artwork's colour balance, normalised so overall brightness
 *            drops out. Survives a dim photo and a bright scan of the same art.
 *   dHash    a perceptual hash of the artwork's structure. Survives a colour
 *            cast that would fool chroma alone.
 *
 * Chroma is weighted double because it proved the more reliable of the two on
 * Bandai's references, whose SAMPLE watermark disturbs structure more than it
 * disturbs colour.
 *
 * WHAT IT CANNOT DO, stated so nobody builds on the wrong assumption: this is
 * useless for Pokémon. 0 of 10,110 multi-variant Pokémon cards have a distinct
 * image — a normal and a reverse holo are the same picture — so there is
 * nothing for any visual method to compare. It runs for One Piece only.
 */

/** A card is 600x838 in Bandai's own scans. */
const CARD_ASPECT = 600 / 838;

/** The artwork, as a fraction of the card: inset from the border, above the text box. */
const ART = { left: 0.08, top: 0.1, width: 0.84, height: 0.45 };

export type ArtSignature = { chroma: [number, number, number]; bits: number[] };

/**
 * Centre-crop to a card's proportions.
 *
 * A photo of a card is rarely card-shaped — it carries background above and
 * below, or to the sides. Without this the art window lands on a different part
 * of the picture in the photo than it does on the reference, and the comparison
 * measures framing rather than artwork.
 *
 * A centre crop assumes the card is roughly centred, which is what a person
 * photographing one card actually does. It is not perspective correction and
 * does not pretend to be.
 */
async function toCardFrame(image: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  if (!width || !height) return image;

  let cropWidth = width;
  let cropHeight = Math.round(width / CARD_ASPECT);
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = Math.round(height * CARD_ASPECT);
  }

  return sharp(image)
    .extract({
      left: Math.round((width - cropWidth) / 2),
      top: Math.round((height - cropHeight) / 2),
      width: cropWidth,
      height: cropHeight,
    })
    .toBuffer();
}

export async function artSignature(image: Buffer, alreadyCardShaped = false): Promise<ArtSignature | undefined> {
  try {
    const framed = alreadyCardShaped ? image : await toCardFrame(image);
    const { width = 0, height = 0 } = await sharp(framed).metadata();
    if (!width || !height) return undefined;

    const art = sharp(framed).extract({
      left: Math.round(width * ART.left),
      top: Math.round(height * ART.top),
      width: Math.round(width * ART.width),
      height: Math.round(height * ART.height),
    });

    const { channels } = await art.clone().stats();
    const [r, g, b] = channels.map((c) => c.mean);
    const total = r + g + b || 1;

    // 9x8 grayscale, each pixel against its right neighbour: 64 bits of
    // structure that survive scaling and moderate blur.
    const grey = await art.clone().resize(9, 8, { fit: "fill" }).grayscale().normalise().raw().toBuffer();
    const bits: number[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) bits.push(grey[y * 9 + x] > grey[y * 9 + x + 1] ? 1 : 0);
    }

    return { chroma: [r / total, g / total, b / total], bits };
  } catch {
    // An image sharp cannot decode is not a reason to fail a scan; the caller
    // falls back to catalogue order.
    return undefined;
  }
}

const SIGNATURE_DIR = path.join(process.cwd(), "data", "catalog", "one-piece-art");

type StoredSignature = { c: [number, number, number]; h: string };
type SignatureFile = { computedAt?: string; signatures?: Record<string, StoredSignature> };

const loaded = new Map<string, Map<string, ArtSignature>>();

function fromHex(hex: string): number[] {
  const bits: number[] = [];
  for (const character of hex) {
    const nibble = parseInt(character, 16);
    bits.push((nibble >> 3) & 1, (nibble >> 2) & 1, (nibble >> 1) & 1, nibble & 1);
  }
  return bits;
}

/**
 * Reference signatures, precomputed by scripts/one-piece-art-signatures.mts.
 *
 * The scan used to derive these at request time: for a card with seven
 * printings, seven sequential fetches of a ~250 KB image from Bandai, each
 * decoded and hashed. At 250–600 ms per fetch that is two to four seconds spent
 * re-deriving something that never changes, and it was the whole of the "works
 * great but very slow" report.
 *
 * A printing's artwork is immutable — Bandai issues a new id rather than
 * repainting one — so it belongs on disk. Cached per language after the first
 * read; the file is a few hundred kilobytes.
 *
 * Missing file means missing map, not an error: the ranking then leaves the
 * printings in catalogue order, which is what it did before any of this existed.
 */
export function referenceSignatures(language: string): Map<string, ArtSignature> {
  const cached = loaded.get(language);
  if (cached) return cached;

  const map = new Map<string, ArtSignature>();
  const file = path.join(SIGNATURE_DIR, `${language}.json`);
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as SignatureFile;
      for (const [id, stored] of Object.entries(parsed.signatures ?? {})) {
        map.set(id, { chroma: stored.c, bits: fromHex(stored.h) });
      }
    } catch {
      // A corrupt file behaves as an absent one.
    }
  }

  loaded.set(language, map);
  return map;
}

/** Lower is more alike. Unbounded in principle, ~0.0 to ~1.5 in practice. */
export function artDistance(a: ArtSignature, b: ArtSignature): number {
  const chroma = Math.sqrt(
    a.chroma.reduce((sum, value, i) => sum + (value - b.chroma[i]) ** 2, 0)
  );
  const structure = a.bits.reduce((d, bit, i) => d + (bit !== b.bits[i] ? 1 : 0), 0) / a.bits.length;
  // Chroma doubled: see this module's header on why it is the sturdier signal
  // against watermarked references.
  return chroma * 2 + structure;
}

/**
 * The rarity marker a card prints next to its code, as our catalogue spells it.
 *
 * Free, because Vision has already read the whole card by the time this is
 * called — on the test photo it returned "SP" and "SR" alongside the code.
 *
 * Narrow in effect and worth knowing why it is still here: measured across
 * 1,148 One Piece codes with more than one printing, rarity differs at all in
 * only 10.6% and identifies a single printing in 1.7%. So it is not a
 * disambiguator. It is a cheap filter that occasionally collapses a list of
 * seven to one, applied only when it does not empty the list entirely.
 */
export function rarityFromText(text: string): string | undefined {
  const upper = text.toUpperCase();
  // Longest first: SEC must not be matched as "SR" inside a longer token.
  if (/\bSEC\b/.test(upper)) return "SecretRare";
  if (/\bSP\b/.test(upper)) return "Special";
  if (/\bSR\b/.test(upper)) return "SuperRare";
  if (/\bUC\b/.test(upper)) return "UncommonCard";
  if (/\bL\b/.test(upper)) return "Leader";
  return undefined;
}
