#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Run REAL photographs through the whole scan and say where it breaks.
 *
 * WHY. The pipeline is near-perfect on synthetic frames and found one card in
 * twenty on a phone. That gap is the only thing worth working on, and it cannot
 * be reasoned about from here — twice now a change made on a hypothesis
 * measured worse than doing nothing. This is the instrument that replaces the
 * hypothesis.
 *
 * WHAT IT SEPARATES. A scan can fail in four different places and they need
 * different fixes, so each is reported on its own:
 *
 *   whole      the entire photograph, stretched to 256. What the photo upload
 *              does today.
 *   guide      the centre card-shaped crop at several sizes. What the live view
 *              does, and the sizes bracket a bare card against one in a slab —
 *              a slabbed card fills far less of the frame than a naked one.
 *   detected   lib/card-detect.ts finds the corners and the homography
 *              straightens them. Graded at 2/4 against 3/4 for no detector on
 *              handheld photographs; flat slabbed cards are a different problem
 *              and may go the other way.
 *
 * READING IT. If `whole` finds the card and `guide` does not, the crop is wrong.
 * If nothing finds it, the picture is the problem — glare, focus, exposure — and
 * no amount of cropping will help. If a low score appears everywhere, the card
 * may simply not be in the index.
 *
 * NO GROUND TRUTH NEEDED. Name a file after the card and it is graded; leave it
 * unnamed and it still prints what each stage thinks, which is most of the
 * value. `swsh12-150.jpg`, `ja~SM12a-052.png`, `ST21-014_p2.jpeg`.
 *
 *   npx tsx scripts/scan-lab.mts "C:/Users/dinca/Desktop/img test/slabs"
 *   npx tsx scripts/scan-lab.mts <folder> --index ja
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { detectCard, rectify } from "../src/lib/card-detect";
import { getCatalogCard } from "../src/lib/catalog";

const DIM = 512;
const SIDE = 256;

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const indexKey = args.includes("--index") ? args[args.indexOf("--index") + 1] : "en";

if (!target) {
  console.error(
    'Usage: npx tsx scripts/scan-lab.mts <folder or image> [--index en|ja|op-en|op-ja]\n' +
      "Name a file after its card to have it graded — swsh12-150.jpg"
  );
  process.exit(1);
}

const INDEX_FILES: Record<string, string> = {
  en: "pokemon-clip/en",
  ja: "pokemon-clip/ja",
  "op-en": "one-piece-clip/english",
  "op-ja": "one-piece-clip/japanese",
};
const base = path.join(process.cwd(), "data", "catalog", INDEX_FILES[indexKey] ?? INDEX_FILES.en);
const ids = (JSON.parse(readFileSync(`${base}.json`, "utf8")) as { ids: string[] }).ids;
const raw = readFileSync(`${base}.i8`);
const vectors = new Int8Array(raw.buffer, raw.byteOffset, raw.length);

const { CLIPVisionModelWithProjection, Tensor } = await import("@huggingface/transformers");
const vision = await CLIPVisionModelWithProjection.from_pretrained("Xenova/mobileclip_s2", { dtype: "fp16" });

/** The ingestion recipe, on an RGBA buffer that is already 256x256. */
async function embedSquare(rgba: Uint8ClampedArray): Promise<Float32Array> {
  const pixels = new Float32Array(3 * SIDE * SIDE);
  const plane = SIDE * SIDE;
  for (let i = 0; i < plane; i++) {
    const at = i * 4;
    pixels[i] = rgba[at] / 255;
    pixels[plane + i] = rgba[at + 1] / 255;
    pixels[2 * plane + i] = rgba[at + 2] / 255;
  }
  const output = await vision({ pixel_values: new Tensor("float32", pixels, [1, 3, SIDE, SIDE]) });
  const vector = output.image_embeds.data as Float32Array;
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

function search(query: Float32Array) {
  let best = -Infinity;
  let second = -Infinity;
  let id = "";
  for (let card = 0; card < ids.length; card++) {
    let total = 0;
    const offset = card * DIM;
    for (let k = 0; k < DIM; k++) total += vectors[offset + k] * query[k];
    total /= 127;
    if (total > best) {
      second = best;
      best = total;
      id = ids[card];
    } else if (total > second) second = total;
  }
  return { id, score: best, margin: best - second };
}

/** Crop a centred card-shaped region at `fill`, then stretch it to 256. */
async function guideCrop(bytes: Buffer, width: number, height: number, fill: number) {
  const aspect = 63 / 88;
  const h = Math.min(height * fill, (width * fill) / aspect);
  const w = h * aspect;
  const region = {
    left: Math.round((width - w) / 2),
    top: Math.round((height - h) / 2),
    width: Math.round(w),
    height: Math.round(h),
  };
  const { data } = await sharp(bytes)
    .extract(region)
    .resize(SIDE, SIDE, { fit: "fill", kernel: "cubic" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
}

const files = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .map((f) => path.join(target, f))
  : [target];

if (files.length === 0) {
  console.error(`No images in ${target}`);
  process.exit(1);
}

console.log(`\n${ids.length.toLocaleString("en-US")} cards in the "${indexKey}" index · ${files.length} photograph(s)\n`);

const FILLS = [0.95, 0.82, 0.65];
const tally = { whole: 0, detected: 0, graded: 0 } as Record<string, number>;
const byFill: Record<number, number> = Object.fromEntries(FILLS.map((f) => [f, 0]));

for (const file of files) {
  const bytes = readFileSync(file);
  const meta = await sharp(bytes).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const expected = path.basename(file).replace(/\.[^.]+$/, "").replace(/^ja~/, "");
  const known = Boolean(getCatalogCard(expected) ?? getCatalogCard(`ja~${expected}`));
  if (known) tally.graded++;

  const mark = (r: { id: string }) => (known ? (r.id === expected ? " ✓" : " ✗") : "");
  console.log(`${path.basename(file)}  ${width}x${height}${known ? `  → expecting ${expected}` : ""}`);

  // whole photograph
  const { data: wholeData } = await sharp(bytes)
    .resize(SIDE, SIDE, { fit: "fill", kernel: "cubic" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const whole = search(await embedSquare(new Uint8ClampedArray(wholeData.buffer, wholeData.byteOffset, wholeData.length)));
  if (known && whole.id === expected) tally.whole++;
  console.log(`   whole     ${whole.score.toFixed(3)}  m=${whole.margin.toFixed(3)}  ${whole.id}${mark(whole)}`);

  // the guide, at several sizes
  for (const fill of FILLS) {
    const crop = await guideCrop(bytes, width, height, fill);
    const result = search(await embedSquare(crop));
    if (known && result.id === expected) byFill[fill]++;
    console.log(
      `   guide ${String(Math.round(fill * 100)).padStart(3)}% ${result.score.toFixed(3)}  m=${result.margin.toFixed(3)}  ${result.id}${mark(result)}`
    );
  }

  // the automatic detector
  const { data: fullData } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const full = new Uint8ClampedArray(fullData.buffer, fullData.byteOffset, fullData.length);
  const found = detectCard(full, width, height);
  if (found) {
    const straight = rectify(full, width, height, found.corners, SIDE);
    if (straight) {
      const result = search(await embedSquare(straight));
      if (known && result.id === expected) tally.detected++;
      console.log(
        `   detected  ${result.score.toFixed(3)}  m=${result.margin.toFixed(3)}  ${result.id}${mark(result)}` +
          `   (covers ${(found.coverage * 100).toFixed(0)}%)`
      );
    }
  } else {
    console.log(`   detected  — no card found`);
  }
  console.log("");
}

if (tally.graded > 0) {
  console.log(`Graded on ${tally.graded} named photograph(s):`);
  console.log(`   whole photograph   ${tally.whole}/${tally.graded}`);
  for (const fill of FILLS) console.log(`   guide at ${String(Math.round(fill * 100)).padStart(3)}%      ${byFill[fill]}/${tally.graded}`);
  console.log(`   auto-detected      ${tally.detected}/${tally.graded}`);
  console.log(
    `\nWhichever column wins is the one to ship. If none of them do, the picture is\n` +
      `the problem rather than the crop, and cropping harder will not help.`
  );
} else {
  console.log(
    `Nothing was graded — name a file after its card to score it, e.g. swsh12-150.jpg.\n` +
      `The scores above are still the useful part: a card in frame reads above 0.5.`
  );
}
