#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * What does the matcher say when there is NO CARD in front of the camera?
 *
 * WHY THIS DECIDES WHETHER A LIVE VIEW IS POSSIBLE. A cosine search always
 * returns a nearest neighbour. Point a phone at a carpet and the index will
 * name its closest card and hand back a score, and nothing in the arithmetic
 * says "that was a carpet". A photo scan hides this because a person only
 * presses the button when a card is in frame; a video feed runs thirty times a
 * second whether or not anything is there, so the first thing it needs is a way
 * to say NOTHING.
 *
 * Two numbers could do it and they are not the same:
 *
 *   the SCORE   how much the frame looks like its best match at all
 *   the MARGIN  how much better that match is than the runner-up
 *
 * The margin is what the photo scan thresholds on, and on its own it is not
 * enough here: a frame of nothing can easily be nearer one card than any other
 * by a comfortable margin while looking like no card whatsoever.
 *
 * So this measures the SCORE floor — what a non-card frame scores — against the
 * score a real card gets. The gap between them, if there is one, is the test a
 * live view uses to decide there is nothing to identify.
 *
 * SYNTHETIC FRAMES, deliberately. Flat colours, noise and blur are not what a
 * living room looks like, but they bracket it: a real scene is more structured
 * than noise and less structured than a card. Anything this says is a floor, not
 * a calibration, and it is labelled that way in the output.
 *
 * A lab script. Not part of the build.
 *
 *   npx tsx scripts/clip-floor-lab.mts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const DIM = 512;
const SIDE = 256;
const CLIP_DIR = path.join(process.cwd(), "data", "catalog", "pokemon-clip");

const ids = (JSON.parse(readFileSync(path.join(CLIP_DIR, "en.json"), "utf8")) as { ids: string[] }).ids;
const raw = readFileSync(path.join(CLIP_DIR, "en.i8"));
const vectors = new Int8Array(raw.buffer, raw.byteOffset, raw.length);

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

/** A flat field of one colour, as a JPEG. */
async function flat(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 600, height: 838, channels: 3, background: { r, g, b } } })
    .jpeg()
    .toBuffer();
}

/** Uniform noise — the least card-like thing that still has structure. */
async function noise(): Promise<Buffer> {
  const pixels = Buffer.alloc(600 * 838 * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(Math.random() * 256);
  return sharp(pixels, { raw: { width: 600, height: 838, channels: 3 } }).jpeg().toBuffer();
}

const frames: { label: string; bytes: Buffer }[] = [
  { label: "flat grey", bytes: await flat(128, 128, 128) },
  { label: "flat white", bytes: await flat(245, 245, 245) },
  { label: "flat dark", bytes: await flat(24, 24, 28) },
  { label: "flat wood-ish", bytes: await flat(150, 111, 66) },
  { label: "random noise", bytes: await noise() },
];

// A real card, for the other end of the scale.
const card = Buffer.from(
  await (await fetch("https://assets.tcgdex.net/en/swsh/swsh12/150/high.webp")).arrayBuffer()
);
frames.push({ label: "A REAL CARD (swsh12-150)", bytes: card });

// The same card blurred until it is unreadable — what a moving phone produces.
frames.push({ label: "the card, heavily blurred", bytes: await sharp(card).blur(18).jpeg().toBuffer() });

// The card occupying a fifth of the frame, the rest flat — a card held far away.
const small = await sharp(card).resize(240, 335).toBuffer();
frames.push({
  label: "the card small in a big frame",
  bytes: await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 90, g: 90, b: 96 } } })
    .composite([{ input: small, top: 430, left: 330 }])
    .jpeg()
    .toBuffer(),
});

console.log(`\nindex: ${ids.length} English cards\n`);
console.log(`${"frame".padEnd(30)} ${"score".padEnd(9)} ${"margin".padEnd(9)} nearest`);
console.log("-".repeat(78));
for (const frame of frames) {
  const result = search(await embed(frame.bytes));
  console.log(
    `${frame.label.padEnd(30)} ${result.score.toFixed(4).padEnd(9)} ${result.margin.toFixed(4).padEnd(9)} ${result.id}`
  );
}

console.log(
  `\nThe SCORE column is the one a live view needs. If the non-card frames sit\n` +
    `clearly below the real card, that gap is the "nothing in front of the camera"\n` +
    `test. Synthetic frames are a FLOOR, not a calibration — a real room is more\n` +
    `structured than noise and less structured than a card.`
);
