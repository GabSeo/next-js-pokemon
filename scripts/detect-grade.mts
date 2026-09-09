#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Grade the card detector against 1,341 annotated photographs.
 *
 * WHY THIS EXISTS. Every number about the detector so far came from FOUR
 * photographs with corners read off by eye. Two versions of the detector were
 * built and graded on that, and both measured worse than doing nothing — which
 * is a useful result at n=4 and not a trustworthy one. This is the same question
 * asked of a dataset large enough to answer it.
 *
 * THE DATA. "Pokemon Card Detection 3" from Roboflow Universe, CC BY 4.0,
 * exported as COCO segmentation. Each image carries a `Card` polygon, which is
 * the outline a person drew — exactly the ground truth the hand-annotated four
 * were, at three hundred times the sample.
 *
 * WHAT THE EXPORT DOES TO IT, and it matters twice over. Every image is
 * RESIZED TO 432x432 BY STRETCHING, so a card in this set has an aspect near
 * 1.0 rather than 63:88 — the detector's shape test rejects all of them unless
 * it is switched off, which this does explicitly rather than by widening a
 * default. And every image is GREYSCALE, so this set can grade corner-finding
 * and cannot say anything about identification.
 *
 * THE MEASURE IS IoU between the found quadrilateral and the annotated one.
 * Corner distance was the first instinct and is the wrong one here: the polygons
 * have nine points, not four, so "the corresponding corner" is a choice rather
 * than a fact. Overlapping area needs no correspondence.
 *
 *   npx tsx scripts/detect-grade.mts
 *   npx tsx scripts/detect-grade.mts --limit 200 --split valid
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { detectCard, type Point, type Quad } from "../src/lib/card-detect";

const ROOT = "C:/Users/dinca/Desktop/Claudy/roboflow dataset";

const args = process.argv.slice(2);
const split = args.includes("--split") ? args[args.indexOf("--split") + 1] : "train";
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
/** Sweep several edge fractions in one pass, so the comparison is like for like. */
const sweep = args.includes("--sweep")
  ? args[args.indexOf("--sweep") + 1].split(",").map(Number)
  : undefined;

type Coco = {
  categories: { id: number; name: string }[];
  images: { id: number; file_name: string; width: number; height: number }[];
  annotations: { image_id: number; category_id: number; segmentation: number[][]; bbox: number[] }[];
};

const file = path.join(ROOT, split, "_annotations.coco.json");
if (!existsSync(file)) {
  console.error(`No annotations at ${file}`);
  process.exit(1);
}
const coco = JSON.parse(readFileSync(file, "utf8")) as Coco;
const cardCategory = coco.categories.find((c) => c.name.toLowerCase() === "card")?.id;
if (cardCategory === undefined) {
  console.error("No 'Card' category in this export");
  process.exit(1);
}

/** The annotated outline for each image — `Card` only, ignoring the `Name` boxes. */
const truth = new Map<number, Point[]>();
for (const annotation of coco.annotations) {
  if (annotation.category_id !== cardCategory) continue;
  const flat = annotation.segmentation?.[0];
  if (!flat || flat.length < 8) continue;
  const polygon: Point[] = [];
  for (let i = 0; i < flat.length; i += 2) polygon.push([flat[i], flat[i + 1]]);
  // ONE CARD PER IMAGE, the largest. A handful of images annotate several; the
  // detector returns one, so grading it against the biggest is the only
  // comparison that means anything.
  const previous = truth.get(annotation.image_id);
  if (!previous || polygonArea(polygon) > polygonArea(previous)) truth.set(annotation.image_id, polygon);
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * Intersection over union of two convex polygons, by clipping one against the
 * other (Sutherland-Hodgman) and comparing areas.
 */
function clip(subject: Point[], a: Point, b: Point): Point[] {
  const inside = (p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
  const intersect = (p: Point, q: Point): Point => {
    const a1 = q[1] - p[1];
    const b1 = p[0] - q[0];
    const c1 = a1 * p[0] + b1 * p[1];
    const a2 = b[1] - a[1];
    const b2 = a[0] - b[0];
    const c2 = a2 * a[0] + b2 * a[1];
    const det = a1 * b2 - a2 * b1;
    if (det === 0) return p;
    return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
  };

  const out: Point[] = [];
  for (let i = 0; i < subject.length; i++) {
    const current = subject[i];
    const previous = subject[(i + subject.length - 1) % subject.length];
    if (inside(current)) {
      if (!inside(previous)) out.push(intersect(previous, current));
      out.push(current);
    } else if (inside(previous)) {
      out.push(intersect(previous, current));
    }
  }
  return out;
}

/** Counter-clockwise, so the clipper's half-plane test has a consistent sign. */
function counterClockwise(points: Point[]): Point[] {
  let signed = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    signed += x1 * y2 - x2 * y1;
  }
  return signed < 0 ? [...points].reverse() : points;
}

function iou(found: Quad, annotated: Point[]): number {
  const a = counterClockwise(found);
  const b = counterClockwise(annotated);
  let clipped: Point[] = a;
  for (let i = 0; i < b.length && clipped.length > 0; i++) {
    clipped = clip(clipped, b[i], b[(i + 1) % b.length]);
  }
  const overlap = clipped.length >= 3 ? polygonArea(clipped) : 0;
  const union = polygonArea(a) + polygonArea(b) - overlap;
  return union > 0 ? overlap / union : 0;
}

const images = coco.images.filter((image) => truth.has(image.id)).slice(0, limit);
console.log(`\n${split}: ${images.length} annotated images (of ${coco.images.length})\n`);

const fractions = sweep ?? [undefined];
const results: { fraction?: number; scores: number[]; missed: number }[] = [];

// The pixels are decoded ONCE and reused across the sweep. Decoding per setting
// would make a four-way comparison four times the wait for no extra fact.
const decoded: { rgba: Uint8ClampedArray; width: number; height: number; truth: Point[] }[] = [];
for (const image of images) {
  const full = path.join(ROOT, split, image.file_name);
  if (!existsSync(full)) continue;
  const { data, info } = await sharp(full).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  decoded.push({
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    width: info.width,
    height: info.height,
    truth: truth.get(image.id)!,
  });
}

for (const fraction of fractions) {
  const scores: number[] = [];
  let missed = 0;
  for (const item of decoded) {
    // The shape test is off: this export stretches every card to a square.
    const found = detectCard(item.rgba, item.width, item.height, {
      aspectTolerance: 1,
      ...(fraction !== undefined ? { edgeFraction: fraction } : {}),
    });
    if (!found) {
      missed++;
      continue;
    }
    scores.push(iou(found.corners, item.truth));
  }
  scores.sort((a, b) => a - b);
  results.push({ fraction, scores, missed });
}

if (sweep) {
  console.log(`${"edge %".padEnd(9)} ${"found".padEnd(9)} ${"IoU>=.8".padEnd(10)} ${"IoU>=.5".padEnd(10)} median`);
  console.log("-".repeat(52));
  for (const row of results) {
    const total = row.scores.length + row.missed;
    const above = (t: number) => row.scores.filter((s) => s >= t).length;
    const median = row.scores.length ? row.scores[Math.floor(row.scores.length / 2)] : 0;
    console.log(
      `${String(((row.fraction ?? 0) * 100).toFixed(1)).padEnd(9)} ` +
        `${`${((row.scores.length * 100) / total).toFixed(0)}%`.padEnd(9)} ` +
        `${`${((above(0.8) * 100) / total).toFixed(0)}%`.padEnd(10)} ` +
        `${`${((above(0.5) * 100) / total).toFixed(0)}%`.padEnd(10)} ${median.toFixed(3)}`
    );
  }
  process.exit(0);
}

const scores = results[0].scores;
const missed = results[0].missed;

scores.sort((a, b) => a - b);
const found = scores.length;
const total = found + missed;
const at = (q: number) => (found > 0 ? scores[Math.min(found - 1, Math.floor(found * q))] : 0);
const above = (t: number) => scores.filter((s) => s >= t).length;

console.log(`\n${"".padEnd(28)} count      share`);
console.log("-".repeat(52));
console.log(`${"found a quadrilateral".padEnd(28)} ${String(found).padStart(5)}      ${((found * 100) / total).toFixed(1)}%`);
console.log(`${"found nothing".padEnd(28)} ${String(missed).padStart(5)}      ${((missed * 100) / total).toFixed(1)}%`);
console.log("");
console.log(`${"IoU >= 0.9  (excellent)".padEnd(28)} ${String(above(0.9)).padStart(5)}      ${((above(0.9) * 100) / total).toFixed(1)}%`);
console.log(`${"IoU >= 0.8  (usable)".padEnd(28)} ${String(above(0.8)).padStart(5)}      ${((above(0.8) * 100) / total).toFixed(1)}%`);
console.log(`${"IoU >= 0.5  (roughly right)".padEnd(28)} ${String(above(0.5)).padStart(5)}      ${((above(0.5) * 100) / total).toFixed(1)}%`);
console.log("");
console.log(`median IoU ${at(0.5).toFixed(3)}   p25 ${at(0.25).toFixed(3)}   p75 ${at(0.75).toFixed(3)}`);
console.log(
  `\nIoU is over ALL ${total} images, so "found nothing" counts against it —\n` +
    `a detector that answers rarely and well is not better than one that answers.`
);
