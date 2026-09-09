#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Identify a card from a photograph, against the CLIP index.
 *
 * WHAT THIS IS FOR. Every number in docs/clip-scan-research.md was measured on
 * SYNTHETIC degradations — a keystone, a blur, a band of glare — because I have
 * no photographs taken with your phone. This turns that into a real
 * measurement: drop photos in a folder, run this, and see whether the right
 * card comes first and by how much.
 *
 * It needs nothing deployed. The model runs here, the index is a file, and the
 * answer is printed. That is deliberate: validating on real photographs should
 * not wait on a camera UI that does not exist yet.
 *
 *   npx tsx scripts/clip-match.mts photo.jpg
 *   npx tsx scripts/clip-match.mts ~/card-photos            (a whole folder)
 *   npx tsx scripts/clip-match.mts photo.jpg --top 10 --languages en
 *
 * WHEN A FOLDER IS GIVEN and a file is named after the card it shows —
 * `swsh12-186.jpg`, `ja~SV4a-001.png` — the run reports how often the right
 * card was ranked first, which is the number worth having.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { getCatalogCard, type CatalogLanguage } from "../src/lib/catalog";

const CLIP_DIR = path.join(process.cwd(), "data", "catalog", "pokemon-clip");
/** Kept in step with scripts/pokemon-clip-embed.mts — a different recipe is a different space. */
const MODEL = "Xenova/mobileclip_s2";
const DTYPE = "fp16" as const;
const SIDE = 256;
const DIM = 512;

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const top = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) || 5 : 5;
const only = args.includes("--languages") ? args[args.indexOf("--languages") + 1]?.split(",") : undefined;
const languages = (only ?? ["en", "ja"]) as CatalogLanguage[];

if (!target) {
  console.error("Usage: npx tsx scripts/clip-match.mts <image or folder> [--top N] [--languages en,ja]");
  process.exit(1);
}

// --- the index ------------------------------------------------------------

type Index = { ids: string[]; vectors: Int8Array; language: CatalogLanguage };

const indexes: Index[] = [];
for (const language of languages) {
  const manifest = path.join(CLIP_DIR, `${language}.json`);
  const blob = path.join(CLIP_DIR, `${language}.i8`);
  if (!existsSync(manifest) || !existsSync(blob)) {
    console.warn(`[match] no index for ${language} — run npm run catalog:pokemon-clip`);
    continue;
  }
  const ids = (JSON.parse(readFileSync(manifest, "utf8")) as { ids: string[] }).ids;
  const buffer = readFileSync(blob);
  indexes.push({ ids, vectors: new Int8Array(buffer.buffer, buffer.byteOffset, buffer.length), language });
}

if (indexes.length === 0) process.exit(1);
console.log(`[match] ${indexes.reduce((n, i) => n + i.ids.length, 0).toLocaleString("en-US")} cards indexed`);

// --- the model ------------------------------------------------------------

const { CLIPVisionModelWithProjection, Tensor } = await import("@huggingface/transformers");
const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: DTYPE });

/** The model's preprocessing, done with our sharp — see pokemon-clip-embed.mts on why. */
async function embed(image: Buffer): Promise<Float32Array | undefined> {
  try {
    const { data } = await sharp(image)
      .removeAlpha()
      .resize(SIDE, SIDE, { fit: "fill", kernel: "cubic" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Rescale only: MobileCLIP's `do_normalize` is false.
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
  } catch {
    return undefined;
  }
}

/**
 * Top matches, by cosine similarity.
 *
 * The stored vectors are int8 and the query is float32; multiplying them and
 * dividing by 127 is the same dot product with one rescale at the end, which
 * costs nothing and avoids quantising the query too.
 */
function search(query: Float32Array, limit: number): { id: string; score: number; language: string }[] {
  const found: { id: string; score: number; language: string }[] = [];
  for (const index of indexes) {
    for (let card = 0; card < index.ids.length; card++) {
      let total = 0;
      const offset = card * DIM;
      for (let k = 0; k < DIM; k++) total += index.vectors[offset + k] * query[k];
      found.push({ id: index.ids[card], score: total / 127, language: index.language });
    }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, limit);
}

// --- run ------------------------------------------------------------------

const files = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f))
      .map((f) => path.join(target, f))
  : [target];

let ranked = 0;
let labelled = 0;

for (const file of files) {
  const started = performance.now();
  const vector = await embed(readFileSync(file));
  if (!vector) {
    console.log(`\n${path.basename(file)}: unreadable`);
    continue;
  }
  const results = search(vector, top);
  const elapsed = performance.now() - started;

  // A file named after the card it shows lets this report accuracy.
  const expected = path.basename(file).replace(/\.[^.]+$/, "");
  const known = Boolean(getCatalogCard(expected.replace(/^ja~/, "")) ?? getCatalogCard(expected));
  if (known) {
    labelled++;
    if (results[0]?.id === expected.replace(/^ja~/, "")) ranked++;
  }

  console.log(`\n${path.basename(file)}  (${elapsed.toFixed(0)} ms)`);
  for (const [rank, hit] of results.entries()) {
    const entry = getCatalogCard(hit.language === "ja" ? `ja~${hit.id}` : hit.id);
    const name = entry ? `${entry.card.name} — ${entry.set.name}` : "(not in catalogue)";
    const mark = known && rank === 0 ? (hit.id === expected.replace(/^ja~/, "") ? " ✓" : " ✗") : "";
    console.log(`  ${hit.score.toFixed(4)}  ${hit.id.padEnd(16)} ${name}${mark}`);
  }
}

if (labelled > 0) {
  console.log(
    `\ntop-1 correct on ${ranked}/${labelled} labelled photographs ` +
      `(${Math.round((ranked * 100) / labelled)}%)`
  );
  console.log("A gap between the first and second score is the confidence to threshold on.");
}
