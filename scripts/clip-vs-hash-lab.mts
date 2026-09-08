#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Does CLIP survive a phone photograph where the perceptual hash does not?
 *
 * THE CLAIM UNDER TEST, and it is the whole reason to consider a 15 MB model:
 * the scan works on the HD scans and eBay photographs people import, and fails
 * on anything shot with a phone. Reflections, shadow, an angle and a different
 * white balance move the 64 structure bits enough that the right card stops
 * winning.
 *
 * WHAT THIS MEASURES. A candidate set of real card scans is indexed twice —
 * once as chroma + dHash (`lib/art-rank.ts`, what we ship today) and once as a
 * 512-float CLIP embedding. Each query card is then degraded the way a phone
 * degrades it, and both indexes are asked the same question: is the right card
 * ranked first?
 *
 * THE DEGRADATIONS are applied with sharp and are deliberately not subtle —
 * they are what a card held at arm's length under a ceiling light looks like:
 *
 *   perspective  a keystone from holding the card at an angle
 *   blur         hand shake and autofocus hunting
 *   glare        a bright band across the foil
 *   warmth       a phone's white balance against tungsten light
 *   crop         framing that clips the border
 *   combined     all of the above at once, which is the honest case
 *
 * This is a LAB script: it proves or refutes the direction before 30,000
 * embeddings are computed. It is not part of the build.
 *
 *   npx tsx scripts/clip-vs-hash-lab.mts
 *   npx tsx scripts/clip-vs-hash-lab.mts --candidates 400 --queries 12
 */
import sharp from "sharp";

import { artDistance, artSignature, type ArtSignature } from "../src/lib/art-rank";
import { getCatalogEntries } from "../src/lib/catalog";

const args = process.argv.slice(2);
const numberArg = (flag: string, fallback: number) => {
  const index = args.indexOf(flag);
  return index >= 0 ? Number(args[index + 1]) || fallback : fallback;
};

const CANDIDATES = numberArg("--candidates", 300);
const QUERIES = numberArg("--queries", 12);

// --- the two indexes ------------------------------------------------------

type Card = { id: string; name: string; url: string };

async function fetchImage(url: string): Promise<Buffer | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return undefined;
  }
}

/** Cosine over L2-normalised vectors is a dot product. */
function cosine(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return total;
}

// --- degradations, applied to the query only ------------------------------

/**
 * A keystone, as `sharp.affine` cannot do perspective: the card is resized
 * asymmetrically and re-padded, which reproduces the same effect on the hash —
 * every structural feature moves relative to the grid.
 */
async function perspective(image: Buffer): Promise<Buffer> {
  const { width = 600, height = 838 } = await sharp(image).metadata();
  return sharp(image)
    .resize(Math.round(width * 0.86), height, { fit: "fill" })
    .extend({
      top: 0,
      bottom: 0,
      left: Math.round(width * 0.07),
      right: Math.round(width * 0.07),
      background: { r: 30, g: 30, b: 34 },
    })
    .toBuffer();
}

const blur = (image: Buffer) => sharp(image).blur(3.2).toBuffer();

/** A bright band across the face, the way a ceiling light lands on foil. */
async function glare(image: Buffer): Promise<Buffer> {
  const { width = 600, height = 838 } = await sharp(image).metadata();
  const band = Buffer.from(
    `<svg width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="white" stop-opacity="0"/>` +
      `<stop offset="45%" stop-color="white" stop-opacity="0.55"/>` +
      `<stop offset="60%" stop-color="white" stop-opacity="0"/>` +
      `</linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`
  );
  return sharp(image).composite([{ input: band, blend: "over" }]).toBuffer();
}

/** Tungsten light plus a phone's auto white balance. */
const warmth = (image: Buffer) =>
  sharp(image).modulate({ brightness: 0.82, saturation: 1.25 }).tint({ r: 255, g: 226, b: 190 }).toBuffer();

async function crop(image: Buffer): Promise<Buffer> {
  const { width = 600, height = 838 } = await sharp(image).metadata();
  return sharp(image)
    .extract({
      left: Math.round(width * 0.05),
      top: Math.round(height * 0.04),
      width: Math.round(width * 0.9),
      height: Math.round(height * 0.9),
    })
    .toBuffer();
}

async function combined(image: Buffer): Promise<Buffer> {
  return crop(await warmth(await glare(await blur(await perspective(image)))));
}

const DEGRADATIONS: { name: string; apply: (image: Buffer) => Promise<Buffer> }[] = [
  { name: "none (control)", apply: async (i) => i },
  { name: "perspective", apply: perspective },
  { name: "blur", apply: blur },
  { name: "glare", apply: glare },
  { name: "warmth", apply: warmth },
  { name: "crop", apply: crop },
  { name: "ALL COMBINED", apply: combined },
];

// --- run ------------------------------------------------------------------

console.log("[lab] loading CLIP (first run downloads the model)…");
// The VISION tower alone. `AutoModel` loads the full CLIP and then demands
// `input_ids` it has no text for; only the image side is ever used here.
const { CLIPVisionModelWithProjection, Tensor } = await import("@huggingface/transformers");
const vision = await CLIPVisionModelWithProjection.from_pretrained("Xenova/clip-vit-base-patch32", { dtype: "fp32" });

/**
 * CLIP's own preprocessing, done with OUR sharp.
 *
 * The library's `RawImage` and its image processor both route through the sharp
 * bundled inside the transformers package, which fails on TCGdex's webp with
 * "colourspace: parameter space not set" — on decode AND again on resize. Doing
 * the four steps here avoids that path entirely, and they are not a mystery:
 * resize to 224 bicubic, rescale to 0..1, subtract CLIP's channel means, divide
 * by its channel deviations. The browser will do exactly this on canvas pixels.
 */
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.2613026, 0.27577711];
const SIDE = 224;

async function embed(image: Buffer): Promise<Float32Array> {
  const { data } = await sharp(image)
    .removeAlpha()
    .resize(SIDE, SIDE, { fit: "fill", kernel: "cubic" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // NCHW, which is what the vision tower expects.
  const pixels = new Float32Array(3 * SIDE * SIDE);
  for (let i = 0; i < SIDE * SIDE; i++) {
    for (let c = 0; c < 3; c++) {
      pixels[c * SIDE * SIDE + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    }
  }

  const output = await vision({ pixel_values: new Tensor("float32", pixels, [1, 3, SIDE, SIDE]) });
  const raw = (output.image_embeds ?? output.last_hidden_state).data as Float32Array;

  // L2-normalise so cosine is a dot product.
  let norm = 0;
  for (const value of raw) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] / norm;
  return out;
}

const entries = getCatalogEntries("en").filter((e) => e.card.image);
const step = Math.max(1, Math.floor(entries.length / CANDIDATES));
const cards: Card[] = [];
for (let i = 0; i < entries.length && cards.length < CANDIDATES; i += step) {
  const { card } = entries[i];
  cards.push({ id: card.tcgdexId, name: card.name, url: `${card.image}/high.webp` });
}

console.log(`[lab] indexing ${cards.length} card scans, two ways…`);
const hashIndex: { card: Card; signature: ArtSignature }[] = [];
const clipIndex: { card: Card; vector: Float32Array }[] = [];
const sources = new Map<string, Buffer>();

let indexed = 0;
for (const card of cards) {
  const image = await fetchImage(card.url);
  if (!image) continue;
  const signature = await artSignature(image, true);
  if (!signature) continue;
  hashIndex.push({ card, signature });
  clipIndex.push({ card, vector: await embed(image) });
  sources.set(card.id, image);
  if (++indexed % 50 === 0) console.log(`[lab]   ${indexed}/${cards.length}…`);
}
console.log(`[lab] indexed ${hashIndex.length}\n`);

const queries = hashIndex.slice(0, QUERIES).map((row) => row.card);
const results: Record<string, { hash: number; clip: number }> = {};

for (const degradation of DEGRADATIONS) {
  let hashHits = 0;
  let clipHits = 0;

  for (const query of queries) {
    const source = sources.get(query.id);
    if (!source) continue;
    const degraded = await degradation.apply(source);

    const signature = await artSignature(degraded, true);
    if (signature) {
      const best = hashIndex
        .map((row) => ({ id: row.card.id, d: artDistance(signature, row.signature) }))
        .sort((a, b) => a.d - b.d)[0];
      if (best?.id === query.id) hashHits++;
    }

    const vector = await embed(degraded);
    const bestClip = clipIndex
      .map((row) => ({ id: row.card.id, s: cosine(vector, row.vector) }))
      .sort((a, b) => b.s - a.s)[0];
    if (bestClip?.id === query.id) clipHits++;
  }

  results[degradation.name] = { hash: hashHits, clip: clipHits };
  console.log(
    `${degradation.name.padEnd(16)} hash ${String(hashHits).padStart(2)}/${queries.length}   ` +
      `CLIP ${String(clipHits).padStart(2)}/${queries.length}`
  );
}

const total = queries.length * DEGRADATIONS.length;
const hashTotal = Object.values(results).reduce((n, r) => n + r.hash, 0);
const clipTotal = Object.values(results).reduce((n, r) => n + r.clip, 0);
console.log(
  `\noverall: hash ${hashTotal}/${total} (${Math.round((hashTotal * 100) / total)}%), ` +
    `CLIP ${clipTotal}/${total} (${Math.round((clipTotal * 100) / total)}%)`
);
