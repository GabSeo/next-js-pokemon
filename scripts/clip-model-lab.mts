#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * CLIP ViT-B/32 against MobileCLIP-S2, on real photographs.
 *
 * WHY. The author of mypokemonscanner tried SigLIP, OpenCLIP, several ViTs and
 * MobileCLIP, and settled on MobileCLIP-S2 for exactly this task. That is a
 * strong signal and it is still somebody else's measurement on somebody else's
 * data. Before re-embedding 50,000 cards, this checks it against the eight
 * photographs whose card we know for certain.
 *
 * FAIR BY CONSTRUCTION: both models index the SAME pool of cards — the eight
 * ground truths plus a common set of distractors — and answer the same
 * question. A model cannot win by being asked an easier one.
 *
 * THE PREPROCESSING IS NOT SHARED, and getting that wrong would silently
 * decide the result. Read from each model's own `preprocessor_config.json`:
 *
 *   CLIP ViT-B/32    224 px, rescale, then subtract channel means and divide
 *                    by channel deviations
 *   MobileCLIP-S2    256 px, rescale ONLY — `do_normalize` is false
 *
 * A lab script. Not part of the build.
 *
 *   npx tsx scripts/clip-model-lab.mts
 *   npx tsx scripts/clip-model-lab.mts --pool 4000
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { getCatalogCard, getCatalogEntries } from "../src/lib/catalog";
import { japaneseOfficialCard } from "../src/lib/pokemon-ja-official";

const args = process.argv.slice(2);
const POOL = args.includes("--pool") ? Number(args[args.indexOf("--pool") + 1]) || 3000 : 3000;
const PHOTOS = "C:/Users/dinca/Desktop/img test";

/** Photographs whose card is known for certain, read off the card in the picture. */
const TRUTH: Record<string, string> = {
  "blaines charizard 2-132": "gym2-2",
  "charizard-vstar-swsh262": "swshp-SWSH262",
  "dark-charizard-4-82": "base5-4",
  "flarean-3-64": "base2-3",
  "gengar ex 108 112": "ex6-108",
  "umbreon-32-144": "ecard3-32",
  "dialga-gg68-gg70": "swsh12.5gg-GG68",
  "lugia v 110-098": "ja~S12-110",
};

const { CLIPVisionModelWithProjection, Tensor } = await import("@huggingface/transformers");

type Model = {
  name: string;
  side: number;
  /** MobileCLIP rescales only; CLIP also standardises per channel. */
  mean?: number[];
  std?: number[];
  run: (t: unknown) => Promise<{ image_embeds: { data: Float32Array } }>;
};

console.log("[lab] loading both models…");
const models: Model[] = [
  {
    name: "CLIP ViT-B/32 (q8)",
    side: 224,
    mean: [0.48145466, 0.4578275, 0.40821073],
    std: [0.26862954, 0.2613026, 0.27577711],
    run: (await CLIPVisionModelWithProjection.from_pretrained("Xenova/clip-vit-base-patch32", {
      dtype: "q8",
    })) as never,
  },
  {
    name: "MobileCLIP-S2 (fp16)",
    side: 256,
    run: (await CLIPVisionModelWithProjection.from_pretrained("Xenova/mobileclip_s2", {
      dtype: "fp16",
    })) as never,
  },
];

async function embed(model: Model, image: Buffer): Promise<Float32Array | undefined> {
  try {
    const side = model.side;
    const { data } = await sharp(image)
      .removeAlpha()
      .resize(side, side, { fit: "fill", kernel: "cubic" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = new Float32Array(3 * side * side);
    for (let i = 0; i < side * side; i++) {
      for (let c = 0; c < 3; c++) {
        const value = data[i * 3 + c] / 255;
        pixels[c * side * side + i] = model.mean ? (value - model.mean[c]) / model.std![c] : value;
      }
    }

    const output = await model.run({ pixel_values: new Tensor("float32", pixels, [1, 3, side, side]) });
    const raw = output.image_embeds.data;
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

/** The publisher scan for a card id, however we hold it. */
function scanUrl(id: string): string | undefined {
  const entry = getCatalogCard(id);
  if (!entry) return undefined;
  if (entry.card.image) return `${entry.card.image}/high.webp`;
  return entry.set.language === "ja" ? japaneseOfficialCard(entry.set.id, entry.card.localId)?.img : undefined;
}

// --- the shared pool ------------------------------------------------------

const wanted = new Set(Object.values(TRUTH));
const pool: string[] = [...wanted];
for (const language of ["en", "ja"] as const) {
  const entries = getCatalogEntries(language).filter((e) => scanUrl(language === "ja" ? `ja~${e.card.tcgdexId}` : e.card.tcgdexId));
  const step = Math.max(1, Math.floor((entries.length * 2) / POOL));
  for (let i = 0; i < entries.length && pool.length < POOL; i += step) {
    const id = language === "ja" ? `ja~${entries[i].card.tcgdexId}` : entries[i].card.tcgdexId;
    if (!wanted.has(id)) pool.push(id);
  }
}
console.log(`[lab] pool: ${pool.length} cards, including all ${wanted.size} ground truths\n`);

// --- index both, from the same downloaded bytes ---------------------------

const scans = new Map<string, Buffer>();
for (const id of pool) {
  const url = scanUrl(id);
  if (!url) continue;
  try {
    const response = await fetch(url);
    if (response.ok) scans.set(id, Buffer.from(await response.arrayBuffer()));
  } catch {
    // one unreachable scan is not worth failing the run for
  }
  if (scans.size % 500 === 0 && scans.size > 0) console.log(`[lab]   fetched ${scans.size}/${pool.length}…`);
}
console.log(`[lab] fetched ${scans.size}\n`);

const photos = readdirSync(PHOTOS).flatMap((dir) =>
  existsSync(path.join(PHOTOS, dir))
    ? readdirSync(path.join(PHOTOS, dir))
        .filter((f) => TRUTH[f.replace(/\.[^.]+$/, "")])
        .map((f) => ({ file: path.join(PHOTOS, dir, f), want: TRUTH[f.replace(/\.[^.]+$/, "")] }))
    : []
);

for (const model of models) {
  const started = performance.now();
  const index: { id: string; vector: Float32Array }[] = [];
  for (const [id, bytes] of scans) {
    const vector = await embed(model, bytes);
    if (vector) index.push({ id, vector });
  }

  let hits = 0;
  const margins: number[] = [];
  const detail: string[] = [];

  for (const { file, want } of photos) {
    const query = await embed(model, readFileSync(file));
    if (!query) continue;
    const scored = index
      .map((row) => {
        let total = 0;
        for (let i = 0; i < query.length; i++) total += query[i] * row.vector[i];
        return { id: row.id, score: total };
      })
      .sort((a, b) => b.score - a.score);
    const right = scored[0]?.id === want;
    if (right) {
      hits++;
      margins.push(scored[0].score - scored[1].score);
    }
    detail.push(`   ${right ? "HIT " : "miss"}  ${path.basename(file).slice(0, 30).padEnd(32)} -> ${scored[0]?.id}`);
  }

  const avg = margins.length > 0 ? (margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(4) : "—";
  console.log(`${model.name}   ${hits}/${photos.length}   avg margin ${avg}   (${((performance.now() - started) / 1000).toFixed(0)}s)`);
  for (const line of detail) console.log(line);
  console.log("");
}
