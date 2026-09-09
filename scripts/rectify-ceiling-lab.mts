#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * What would a PERFECT card detector buy us?
 *
 * THE QUESTION THIS ANSWERS, before anyone trains a model. Measured on real
 * photographs, the identification is 2/8 as shot and 4/8 centre-cropped, while
 * a clean publisher scan is 8/8. The suspected cause is framing: a photograph
 * contains a hand, a sleeve and a room, and the embedding is faithful to all of
 * it. If that is right, a detector fixes it. If it is not, a detector is months
 * of work spent on the wrong half.
 *
 * So: the four corners of the card are given BY HAND here, read off each
 * photograph. That is the output a perfect detector would produce, and nothing
 * else about the pipeline changes. Whatever this scores is the ceiling that
 * RF-DETR or YOLO would be climbing towards.
 *
 * THE WARP IS DONE HERE because sharp has no perspective transform — it can
 * scale, rotate and shear, none of which straighten a card held at an angle.
 * A homography is eight unknowns from four point correspondences, solved with
 * Gaussian elimination, then applied backwards per destination pixel with
 * bilinear sampling. That is the whole of `warpPerspective` and it is fifty
 * lines; OpenCV would be an 8 MB dependency for it.
 *
 * A lab script. Not part of the build.
 *
 *   npx tsx scripts/rectify-ceiling-lab.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";


const PHOTOS = "C:/Users/dinca/Desktop/img test";
const CLIP_DIR = path.join(process.cwd(), "data", "catalog", "pokemon-clip");
const SIDE = 256;
const DIM = 512;

/** A card is 63 x 88 mm. The reference scans are 600 x 838, the same ratio. */
const CARD_W = 600;
const CARD_H = 838;

type Point = [number, number];

/**
 * Corners read off each photograph by eye, clockwise from the top left, in the
 * image's own pixels. This is the detector, done by hand.
 */
const ANNOTATED: {
  file: string;
  want: string;
  language: "en" | "ja";
  corners: [Point, Point, Point, Point];
}[] = [
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

// --- the homography -------------------------------------------------------

/**
 * Solve `A x = b` by Gaussian elimination with partial pivoting.
 *
 * Eight equations, eight unknowns — small enough that the direct method is the
 * clear one, and the pivoting is what keeps it stable when a card is nearly
 * axis-aligned and two rows come close to parallel.
 */
function solve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];

    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}

/**
 * The homography taking the four DESTINATION corners back to the four source
 * corners — the inverse direction, because the warp is done by walking the
 * destination and asking where each pixel came from. Sampling forwards would
 * leave holes wherever the source stretches.
 */
function homography(from: Point[], to: Point[]): number[] {
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  return [...solve(rows, rhs), 1];
}

/** Straighten the quadrilateral into a full-frame card, bilinear. */
async function rectify(image: Buffer, corners: Point[]): Promise<Buffer> {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const destination: Point[] = [
    [0, 0],
    [CARD_W, 0],
    [CARD_W, CARD_H],
    [0, CARD_H],
  ];
  const h = homography(destination, corners);

  const out = Buffer.alloc(CARD_W * CARD_H * 3);
  for (let y = 0; y < CARD_H; y++) {
    for (let x = 0; x < CARD_W; x++) {
      const denominator = h[6] * x + h[7] * y + h[8];
      const sx = (h[0] * x + h[1] * y + h[2]) / denominator;
      const sy = (h[3] * x + h[4] * y + h[5]) / denominator;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const target = (y * CARD_W + x) * 3;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) continue;

      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const p = (row: number, col: number) => data[(row * width + col) * 3 + c];
        const top = p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx;
        const bottom = p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx;
        out[target + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }

  return sharp(out, { raw: { width: CARD_W, height: CARD_H, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

// --- the index and the model ---------------------------------------------

const indexes: Record<string, { ids: string[]; vectors: Int8Array }> = {};
for (const language of ["en", "ja"]) {
  const ids = (JSON.parse(readFileSync(path.join(CLIP_DIR, `${language}.json`), "utf8")) as { ids: string[] }).ids;
  const buffer = readFileSync(path.join(CLIP_DIR, `${language}.i8`));
  indexes[language] = { ids, vectors: new Int8Array(buffer.buffer, buffer.byteOffset, buffer.length) };
}

const { CLIPVisionModelWithProjection, Tensor } = await import("@huggingface/transformers");
const vision = await CLIPVisionModelWithProjection.from_pretrained("Xenova/mobileclip_s2", { dtype: "fp16" });

async function embed(image: Buffer): Promise<Float32Array> {
  const { data } = await sharp(image)
    .removeAlpha()
    .resize(SIDE, SIDE, { fit: "fill", kernel: "cubic" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Float32Array(3 * SIDE * SIDE);
  for (let i = 0; i < SIDE * SIDE; i++) {
    for (let c = 0; c < 3; c++) pixels[c * SIDE * SIDE + i] = data[i * 3 + c] / 255;
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
  return { id, best, margin: best - second };
}

// --- run ------------------------------------------------------------------

const scratch = path.join(
  "C:/Users/dinca/AppData/Local/Temp/claude/C--Users-dinca-Desktop-Claudy-Next-js-prototype",
  "57577e80-b3a2-45d1-8d4c-667ad14f0069/scratchpad/rectified"
);

let asShot = 0;
let rectified = 0;

console.log(`\n${"card".padEnd(26)} ${"as shot".padEnd(30)} rectified by hand`);
for (const row of ANNOTATED) {
  const source = readFileSync(path.join(PHOTOS, row.file));

  const before = search(await embed(source), row.language);
  const straight = await rectify(source, row.corners);
  const after = search(await embed(straight), row.language);

  try {
    writeFileSync(path.join(scratch, path.basename(row.file).replace(/\.[^.]+$/, "") + ".jpg"), straight);
  } catch {
    // the scratch directory may not exist; the measurement is the point
  }

  if (before.id === row.want) asShot++;
  if (after.id === row.want) rectified++;

  const show = (r: { id: string; best: number; margin: number }) =>
    `${r.id === row.want ? "HIT " : "miss"} ${r.id.slice(0, 14).padEnd(16)} m=${r.margin.toFixed(3)}`;
  console.log(`${row.want.padEnd(26)} ${show(before).padEnd(30)} ${show(after)}`);
}

console.log(
  `\nas shot ${asShot}/${ANNOTATED.length}   hand-rectified ${rectified}/${ANNOTATED.length}` +
    `\nThe second number is what a perfect detector would deliver. The gap is what one is worth.`
);
