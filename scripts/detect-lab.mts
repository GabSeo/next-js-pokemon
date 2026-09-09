#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Does the automatic detector find the corners a person would?
 *
 * WHY THIS IS THE ONLY QUESTION THAT MATTERS. scripts/rectify-ceiling-lab.mts
 * measured what a PERFECT detector buys, by reading four corners off each
 * photograph by hand: 3/4 as shot became 4/4 rectified. Those hand-read corners
 * are still here, and they are ground truth. So the detector can be graded
 * rather than admired — how far are its corners from the ones a person picked,
 * and does the card still identify afterwards.
 *
 * TWO NUMBERS, and the second is the one that counts:
 *
 *   corner error   mean distance from the hand-read corner, as a % of the
 *                  card's own size. Under ~4% is invisible after warping.
 *   identification whether the rectified crop still finds the right card
 *
 * A detector can be geometrically sloppy and still identify perfectly — the
 * embedding does not care about a few pixels of border. It can also be tidy and
 * useless, by finding a beautiful quadrilateral around the wrong object. Only
 * the second column says which happened.
 *
 * A lab script. Not part of the build.
 *
 *   npx tsx scripts/detect-lab.mts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { detectCard, rectify, type Point } from "../src/lib/card-detect";

const PHOTOS = "C:/Users/dinca/Desktop/img test";
const CLIP_DIR = path.join(process.cwd(), "data", "catalog", "pokemon-clip");
const SIDE = 256;
const DIM = 512;

/** The same photographs and the same hand-read corners as the ceiling lab. */
const TRUTH: { file: string; want: string; language: "en" | "ja"; corners: [Point, Point, Point, Point] }[] = [
  {
    file: "pokemon japanese/lugia v 110-098.jpeg",
    want: "S12-110",
    language: "ja",
    corners: [
      [196, 318],
      [896, 306],
      [915, 1298],
      [203, 1312],
    ],
  },
  {
    file: "pokemon english/dark-charizard-4-82.jpeg",
    want: "base5-4",
    language: "en",
    corners: [
      [105, 118],
      [650, 122],
      [657, 905],
      [108, 900],
    ],
  },
  {
    file: "pokemon english/umbreon-32-144.jpeg",
    want: "ecard3-32",
    language: "en",
    corners: [
      [225, 278],
      [1790, 312],
      [1750, 2513],
      [252, 2486],
    ],
  },
  {
    file: "pokemon english/dialga-gg68-gg70.jpeg",
    want: "swsh12.5gg-GG68",
    language: "en",
    corners: [
      [252, 103],
      [952, 262],
      [790, 1245],
      [88, 1085],
    ],
  },
];

const indexes: Record<string, { ids: string[]; vectors: Int8Array }> = {};
for (const language of ["en", "ja"]) {
  const ids = (JSON.parse(readFileSync(path.join(CLIP_DIR, `${language}.json`), "utf8")) as { ids: string[] }).ids;
  const buffer = readFileSync(path.join(CLIP_DIR, `${language}.i8`));
  indexes[language] = { ids, vectors: new Int8Array(buffer.buffer, buffer.byteOffset, buffer.length) };
}

const { CLIPVisionModelWithProjection, Tensor } = await import("@huggingface/transformers");
const vision = await CLIPVisionModelWithProjection.from_pretrained("Xenova/mobileclip_s2", { dtype: "fp16" });

/** Embed a 256x256 RGBA buffer with the ingestion recipe. */
async function embedRgba(rgba: Uint8ClampedArray): Promise<Float32Array> {
  const pixels = new Float32Array(3 * SIDE * SIDE);
  const plane = SIDE * SIDE;
  for (let i = 0; i < plane; i++) {
    const at = i * 4;
    pixels[i] = rgba[at] / 255;
    pixels[plane + i] = rgba[at + 1] / 255;
    pixels[2 * plane + i] = rgba[at + 2] / 255;
  }
  const output = await vision({ pixel_values: new Tensor("float32", pixels, [1, 3, SIDE, SIDE]) });
  const raw = output.image_embeds.data as Float32Array;
  let norm = 0;
  for (const value of raw) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] / norm;
  return out;
}

function search(query: Float32Array, language: string) {
  const index = indexes[language];
  let best = -Infinity;
  let second = -Infinity;
  let id = "";
  for (let card = 0; card < index.ids.length; card++) {
    let total = 0;
    const offset = card * DIM;
    for (let k = 0; k < DIM; k++) total += index.vectors[offset + k] * query[k];
    total /= 127;
    if (total > best) {
      second = best;
      best = total;
      id = index.ids[card];
    } else if (total > second) second = total;
  }
  return { id, score: best, margin: best - second };
}

/** Mean corner distance, as a percentage of the card's own diagonal. */
function cornerError(found: Point[], truth: Point[]): number {
  const diagonal = Math.hypot(truth[2][0] - truth[0][0], truth[2][1] - truth[0][1]);
  let total = 0;
  for (let i = 0; i < 4; i++) total += Math.hypot(found[i][0] - truth[i][0], found[i][1] - truth[i][1]);
  return ((total / 4) / diagonal) * 100;
}

console.log(
  `\n${"card".padEnd(20)} ${"detected".padEnd(10)} ${"corner err".padEnd(12)} ${"automatic".padEnd(24)} by hand`
);
console.log("-".repeat(92));

let detected = 0;
let autoHits = 0;
let handHits = 0;

for (const row of TRUTH) {
  const bytes = readFileSync(path.join(PHOTOS, row.file));
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);

  const found = detectCard(rgba, info.width, info.height);

  // The same photograph through the hand-read corners, as the control.
  const handWarp = rectify(rgba, info.width, info.height, row.corners, SIDE)!;
  const hand = search(await embedRgba(handWarp), row.language);
  if (hand.id === row.want) handHits++;

  let autoCell = "not detected";
  let errCell = "—";
  if (found) {
    detected++;
    errCell = `${cornerError(found.corners, row.corners).toFixed(1)}%`;
    const warp = rectify(rgba, info.width, info.height, found.corners, SIDE);
    if (warp) {
      const auto = search(await embedRgba(warp), row.language);
      if (auto.id === row.want) autoHits++;
      autoCell = `${auto.id === row.want ? "HIT " : "miss"} ${auto.id.slice(0, 14).padEnd(15)} m=${auto.margin.toFixed(3)}`;
    }
  }

  console.log(
    `${row.want.padEnd(20)} ${(found ? "yes" : "no").padEnd(10)} ${errCell.padEnd(12)} ${autoCell.padEnd(24)} ` +
      `${hand.id === row.want ? "HIT" : "miss"} m=${hand.margin.toFixed(3)}`
  );
}

console.log(
  `\ndetected ${detected}/${TRUTH.length}   automatic ${autoHits}/${TRUTH.length}   ` +
    `hand-read corners ${handHits}/${TRUTH.length}\n` +
    `The last column is the ceiling. The middle one is what the detector actually delivers.`
);
