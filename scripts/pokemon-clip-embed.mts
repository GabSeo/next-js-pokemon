#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * A CLIP embedding for every Pokemon card we have a picture of.
 *
 * WHY, MEASURED. The 64-bit perceptual hash we ship identifies a card from a
 * publisher scan and falls apart on a photograph. Run against 498 real card
 * scans with the query degraded the way a phone degrades it — keystone, hand
 * shake, a band of glare, tungsten white balance, a clipped border, all at once
 * — the right card was ranked first:
 *
 *   perceptual hash   6 of 15   (40%)
 *   CLIP ViT-B/32    11 of 15   (73%)
 *
 * On any single degradation both are near-perfect; it is the COMBINATION, which
 * is what a real photograph is, that separates them. See
 * `scripts/clip-vs-hash-lab.mts`, which is the experiment, and
 * `docs/live-scan-plan.md` for what it does and does not prove.
 *
 * WHY NODE AND NOT PYTHON. `@huggingface/transformers` runs the same ONNX
 * weights here and in a browser, so the vector this script writes and the
 * vector a phone computes from a video frame come from one implementation
 * rather than two that must be kept agreeing. There is no second service, no
 * Docker, and no Python in the tree.
 *
 * WHY NO VECTOR DATABASE. Measured: a cosine search over 30,000 x 512 floats is
 * 8.2 ms in plain JavaScript, and the int8 index is 15 MB — small enough to
 * send to the browser. pgvector and Qdrant solve a problem that starts a
 * thousand times further up; here they would add a network hop of 20-50 ms to
 * a search that takes 8.
 *
 * INT8, NOT FLOAT32. The vectors are L2-normalised, so every component is in
 * [-1, 1] and quantising to a signed byte costs almost no accuracy while taking
 * the index from 59 MB to 15 MB. That difference is what makes it shippable.
 *
 * OUTPUT is a binary blob plus a manifest, not JSON: 15 MB of numbers as text
 * would be ~90 MB and parse in seconds.
 *
 *   data/catalog/pokemon-clip/<lang>.i8    N x 512 signed bytes
 *   data/catalog/pokemon-clip/<lang>.json  the ids, in the same order
 *
 * INCREMENTAL, so a new set costs the new set. `--force` re-embeds everything,
 * for when the model or the preprocessing changes.
 *
 *   npm run catalog:pokemon-clip
 *   npx tsx scripts/pokemon-clip-embed.mts --languages en --limit 200
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { getCatalogEntries, type CatalogLanguage } from "../src/lib/catalog";
import { japaneseOfficialCard } from "../src/lib/pokemon-ja-official";

const OUT_DIR = path.join(process.cwd(), "data", "catalog", "pokemon-clip");

/** The vision tower of CLIP ViT-B/32. `q8` is 3x faster than fp32 and a third the size. */
const MODEL = "Xenova/clip-vit-base-patch32";
const DTYPE = "q8" as const;

/** CLIP's own preprocessing constants. Not ours to choose. */
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.2613026, 0.27577711];
const SIDE = 224;
const DIM = 512;

const CDN_CONCURRENCY = 10;
const PUBLISHER_CONCURRENCY = 5;

const args = process.argv.slice(2);
const force = args.includes("--force");
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const only = args.includes("--languages") ? args[args.indexOf("--languages") + 1]?.split(",") : undefined;
const languages = (only ?? ["en", "ja"]) as CatalogLanguage[];

console.log(`[clip] loading ${MODEL} (${DTYPE})…`);
const { CLIPVisionModelWithProjection, Tensor } = await import("@huggingface/transformers");
const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: DTYPE });

/**
 * CLIP preprocessing, done with OUR sharp.
 *
 * The library's own image path routes through the sharp bundled inside it,
 * which fails on TCGdex's webp with "colourspace: parameter space not set" — on
 * decode and again on resize. The four steps are not a mystery: resize to 224,
 * rescale to 0..1, subtract the channel means, divide by the deviations. A
 * browser will do exactly this on canvas pixels, which is the point.
 */
async function embed(image: Buffer): Promise<Float32Array | undefined> {
  try {
    const { data } = await sharp(image)
      .removeAlpha()
      .resize(SIDE, SIDE, { fit: "fill", kernel: "cubic" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = new Float32Array(3 * SIDE * SIDE);
    for (let i = 0; i < SIDE * SIDE; i++) {
      for (let c = 0; c < 3; c++) pixels[c * SIDE * SIDE + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    }

    const output = await vision({ pixel_values: new Tensor("float32", pixels, [1, 3, SIDE, SIDE]) });
    const raw = output.image_embeds.data as Float32Array;

    // L2-normalise, so a cosine similarity is a plain dot product downstream.
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

type Target = { id: string; url: string; publisher: boolean };

async function pooled<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        await worker(items[index]);
      }
    })
  );
}

for (const language of languages) {
  const manifestFile = path.join(OUT_DIR, `${language}.json`);
  const vectorFile = path.join(OUT_DIR, `${language}.i8`);

  // Existing work, so a re-run costs only what is new.
  const held = new Map<string, Int8Array>();
  if (!force && existsSync(manifestFile) && existsSync(vectorFile)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { ids?: string[] };
      const bytes = new Int8Array(readFileSync(vectorFile).buffer);
      (manifest.ids ?? []).forEach((id, index) => {
        held.set(id, bytes.slice(index * DIM, (index + 1) * DIM));
      });
    } catch {
      // A half-written pair behaves as none: everything is recomputed.
      held.clear();
    }
  }

  const targets: Target[] = [];
  let unpictured = 0;

  for (const { card, set } of getCatalogEntries(language)) {
    if (held.has(card.tcgdexId)) continue;
    if (card.image) {
      targets.push({ id: card.tcgdexId, url: `${card.image}/high.webp`, publisher: false });
      continue;
    }
    const official = language === "ja" ? japaneseOfficialCard(set.id, card.localId) : undefined;
    if (official?.img) {
      targets.push({ id: card.tcgdexId, url: official.img, publisher: true });
      continue;
    }
    unpictured++;
  }

  const work = targets.slice(0, limit);
  console.log(
    `[clip] ${language}: ${held.size} already embedded, ${work.length} to do, ${unpictured} pictured nowhere`
  );

  let done = 0;
  let failed = 0;
  const started = Date.now();

  const run = async (target: Target) => {
    try {
      const response = await fetch(target.url, { headers: { Accept: "image/webp,image/jpeg,*/*" } });
      if (!response.ok) {
        failed++;
        return;
      }
      const vector = await embed(Buffer.from(await response.arrayBuffer()));
      if (!vector) {
        failed++;
        return;
      }
      // Quantise: the vector is L2-normalised, so every component is in
      // [-1, 1] and a signed byte holds it at 1/127 resolution.
      const quantised = new Int8Array(DIM);
      for (let i = 0; i < DIM; i++) quantised[i] = Math.max(-127, Math.min(127, Math.round(vector[i] * 127)));
      held.set(target.id, quantised);
    } catch {
      failed++;
    }
    if (++done % 250 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      console.log(`[clip]   ${done}/${work.length}  (${rate.toFixed(1)}/s)`);
    }
  };

  await pooled(
    work.filter((t) => !t.publisher),
    CDN_CONCURRENCY,
    run
  );
  await pooled(
    work.filter((t) => t.publisher),
    PUBLISHER_CONCURRENCY,
    run
  );

  const ids = [...held.keys()].sort();
  const blob = new Int8Array(ids.length * DIM);
  ids.forEach((id, index) => blob.set(held.get(id)!, index * DIM));

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(vectorFile, Buffer.from(blob.buffer));
  writeFileSync(
    manifestFile,
    JSON.stringify({ computedAt: new Date().toISOString(), model: MODEL, dtype: DTYPE, dim: DIM, ids })
  );

  console.log(
    `[clip] ${language}: ${ids.length} vectors, ${failed} unusable, ` +
      `${((Date.now() - started) / 1000).toFixed(0)}s, ${(blob.length / 1048576).toFixed(1)} MB\n`
  );
}
