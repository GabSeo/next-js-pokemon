#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Does the RESAMPLING KERNEL change the answer?
 *
 * WHY THIS DECIDES AN ARCHITECTURE. The index was built with sharp resizing to
 * 256px with a cubic kernel. A browser has no sharp — it has
 * `canvas.drawImage`, whose scaling is implementation-defined and roughly
 * bilinear. So a vector computed in the browser is NOT computed the same way as
 * the vectors it will be compared against, and nothing about the embedding
 * space guarantees that difference is harmless.
 *
 * If it is harmless, the whole matcher can move into the browser and the video
 * feed follows. If it is not, the browser has to ship its own resampler or the
 * index has to be rebuilt to whatever the browser does — both real work, and
 * both worth knowing about before writing the client rather than after.
 *
 * So: embed the same photographs four ways and see whether the identification
 * or the margin moves. `nearest` is deliberately included as the worst case —
 * it is not what any browser does, and it brackets the answer.
 *
 * A lab script. Not part of the build.
 *
 *   npx tsx scripts/clip-resample-lab.mts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const PHOTOS = "C:/Users/dinca/Desktop/img test";
const CLIP_DIR = path.join(process.cwd(), "data", "catalog", "pokemon-clip");
const SIDE = 256;
const DIM = 512;

/** The photographs whose card is known for certain, as elsewhere in this project. */
const TRUTH: { file: string; want: string; language: "en" | "ja" }[] = [
  { file: "pokemon japanese/lugia v 110-098.jpeg", want: "S12-110", language: "ja" },
  { file: "pokemon english/dark-charizard-4-82.jpeg", want: "base5-4", language: "en" },
  { file: "pokemon english/umbreon-32-144.jpeg", want: "ecard3-32", language: "en" },
  { file: "pokemon english/dialga-gg68-gg70.jpeg", want: "swsh12.5gg-GG68", language: "en" },
  { file: "pokemon english/gengar ex 108 112.jpeg", want: "ex6-108", language: "en" },
  { file: "pokemon english/flarean-3-64.jpeg", want: "base2-3", language: "en" },
];

/**
 * `cubic` is what the index was built with. `mitchell` and `lanczos3` bracket it
 * on the smooth side; `nearest` is the pathological case that shows how much
 * headroom there is.
 */
const KERNELS = ["cubic", "mitchell", "lanczos3", "nearest"] as const;

const indexes: Record<string, { ids: string[]; vectors: Int8Array }> = {};
for (const language of ["en", "ja"]) {
  const ids = (JSON.parse(readFileSync(path.join(CLIP_DIR, `${language}.json`), "utf8")) as { ids: string[] }).ids;
  const buffer = readFileSync(path.join(CLIP_DIR, `${language}.i8`));
  indexes[language] = { ids, vectors: new Int8Array(buffer.buffer, buffer.byteOffset, buffer.length) };
}

const { CLIPVisionModelWithProjection, Tensor } = await import("@huggingface/transformers");
const vision = await CLIPVisionModelWithProjection.from_pretrained("Xenova/mobileclip_s2", { dtype: "fp16" });

async function embed(image: Buffer, kernel: (typeof KERNELS)[number]): Promise<Float32Array> {
  const { data } = await sharp(image)
    .removeAlpha()
    .resize(SIDE, SIDE, { fit: "fill", kernel })
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
  return { id, margin: best - second };
}

console.log(`\n${"photograph".padEnd(24)} ${KERNELS.map((k) => k.padEnd(16)).join("")}`);

const hits: Record<string, number> = Object.fromEntries(KERNELS.map((k) => [k, 0]));

let checked = 0;
for (const row of TRUTH) {
  // A missing photograph is not a result. Skipping keeps the run reporting on
  // what it could actually measure rather than dying halfway through a table.
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(PHOTOS, row.file));
  } catch {
    console.log(`${row.want.padEnd(24)} (photograph not on this machine)`);
    continue;
  }
  checked++;
  const cells: string[] = [];
  for (const kernel of KERNELS) {
    const result = search(await embed(bytes, kernel), row.language);
    const ok = result.id === row.want;
    if (ok) hits[kernel]++;
    cells.push(`${ok ? "HIT " : "miss"} m=${result.margin.toFixed(3)}`.padEnd(16));
  }
  console.log(`${row.want.padEnd(24)} ${cells.join("")}`);
}

console.log(`\n${"".padEnd(24)} ${KERNELS.map((k) => `${hits[k]}/${checked}`.padEnd(16)).join("")}`);
console.log(
  `\nIf cubic and the smoother kernels agree, a browser's canvas resampling is safe\n` +
    `and the matcher can run client-side against this index unchanged.`
);
