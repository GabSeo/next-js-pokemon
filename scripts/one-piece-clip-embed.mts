#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * A MobileCLIP embedding for every One Piece printing.
 *
 * WHY. The scan matches a photograph against artwork on the device, and there
 * was an index for Pokemon and none for this game — so a photographed
 * Monkey.D.Luffy was searched against 41,500 Pokemon vectors and answered with
 * a Koffing. The scan now asks which game and skips the matcher for One Piece,
 * which is correct and is not the same as working. This is what makes it work.
 *
 * THE UNIT IS A PRINTING, NOT A CARD, and that is the opposite of Pokemon.
 * Measured across both catalogues: 0 of 10,110 multi-variant Pokemon cards have
 * a distinct image per variant, while 945 of 945 multi-printing One Piece codes
 * do. So artwork can only ever name the CARD for Pokemon — the tie between a
 * card and its reprint is unbreakable there — and it names the exact PRINTING
 * here. The One Piece match is the more precise of the two, and the index is
 * keyed accordingly.
 *
 * THE SAME MODEL AND THE SAME RECIPE as scripts/pokemon-clip-embed.mts, down to
 * the resize kernel, because a vector is only comparable to vectors made the
 * same way. Two indexes in one space also means a later version can search both
 * and stop asking which game — which is why the format is identical rather than
 * merely similar.
 *
 * WHERE THE PICTURES COME FROM, in the order the signature script established:
 * the 970 repatriated images in `public/card-images/one-piece` first, because
 * they exist nowhere else and cost no request; then Bandai's card list; then
 * Bandai's host directly for the printings it serves without listing.
 *
 * INCREMENTAL. A printing already embedded is skipped without a fetch.
 *
 *   npm run catalog:one-piece-clip
 *   npx tsx scripts/one-piece-clip-embed.mts --languages english
 *   npx tsx scripts/one-piece-clip-embed.mts --force --limit 200
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { officialCardsInPack, officialImageUrl, officialPacks } from "../src/lib/one-piece-official";
import { isBandaiPicture, optcgRowsForCode } from "../src/lib/one-piece-optcg";

const OUT_DIR = path.join(process.cwd(), "data", "catalog", "one-piece-clip");
const LOCAL_DIR = path.join(process.cwd(), "public", "card-images", "one-piece");

/** Kept in step with the Pokemon index — a different recipe is a different space. */
const MODEL = "Xenova/mobileclip_s2";
const DTYPE = "fp16" as const;
const SIDE = 256;
const DIM = 512;

/** Bandai serves these happily; there is still no reason to be rude about it. */
const CONCURRENCY = 8;

const IMAGE_HOSTS: Record<string, string> = {
  english: "https://en.onepiece-cardgame.com",
  japanese: "https://www.onepiece-cardgame.com",
};

const args = process.argv.slice(2);
const force = args.includes("--force");
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const only = args.includes("--languages") ? args[args.indexOf("--languages") + 1]?.split(",") : undefined;
const languages = only ?? ["english", "japanese"];

console.log(`[op-clip] loading ${MODEL} (${DTYPE})…`);
const { CLIPVisionModelWithProjection, Tensor } = await import("@huggingface/transformers");
const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: DTYPE });

/** Byte-for-byte the Pokemon recipe: 256px, stretch, rescale, no normalisation. */
async function embed(image: Buffer): Promise<Float32Array | undefined> {
  try {
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
  } catch {
    return undefined;
  }
}

/**
 * Printings Bandai SERVES but does not LIST — the same gap the signature script
 * documents. `officialImageUrl` derives from the card list, so a printing absent
 * from it has no URL and would simply never be indexed.
 */
function unlistedBandaiPrintings(language: string): string[] {
  const listed = new Set<string>();
  for (const pack of officialPacks(language)) {
    for (const card of officialCardsInPack(pack.pack.id, language)) listed.add(card.id);
  }
  const extra = new Set<string>();
  for (const id of listed) {
    for (const row of optcgRowsForCode(id.replace(/_(?:p|pr|r)\d+$/, ""))) {
      if (!row.image || !row.imageId || listed.has(row.imageId)) continue;
      if (isBandaiPicture(row.image, row.imageId)) extra.add(row.imageId);
    }
  }
  return [...extra];
}

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

mkdirSync(OUT_DIR, { recursive: true });

for (const language of languages) {
  const manifestFile = path.join(OUT_DIR, `${language}.json`);
  const vectorFile = path.join(OUT_DIR, `${language}.i8`);

  const held = new Map<string, Int8Array>();
  if (!force && existsSync(manifestFile) && existsSync(vectorFile)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { ids?: string[] };
      const bytes = new Int8Array(readFileSync(vectorFile).buffer);
      (manifest.ids ?? []).forEach((id, index) => held.set(id, bytes.slice(index * DIM, (index + 1) * DIM)));
    } catch {
      held.clear();
    }
  }

  const ids: string[] = [];
  for (const pack of officialPacks(language)) {
    for (const card of officialCardsInPack(pack.pack.id, language)) ids.push(card.id);
  }
  for (const id of unlistedBandaiPrintings(language)) ids.push(id);

  // The repatriated mirror is English-side: it came from a source carrying one
  // language, and pairing it with the Japanese pass would claim a print we have
  // not actually seen.
  const local =
    language === "english" && existsSync(LOCAL_DIR)
      ? readdirSync(LOCAL_DIR)
          .filter((name) => name.endsWith(".webp"))
          .map((name) => name.slice(0, -".webp".length))
      : [];

  const current = new Set([...ids, ...local]);
  const work = [...current].filter((id) => !held.has(id)).slice(0, limit);

  console.log(
    `[op-clip] ${language}: ${ids.length} listed + ${local.length} repatriated, ` +
      `${held.size} already embedded, ${work.length} to do`
  );

  let done = 0;
  let failed = 0;
  const started = Date.now();

  await pooled(work, CONCURRENCY, async (id) => {
    try {
      const localFile = path.join(LOCAL_DIR, `${id}.webp`);
      let bytes: Buffer | undefined;

      if (existsSync(localFile)) {
        bytes = readFileSync(localFile);
      } else {
        const url = officialImageUrl(id, language) ?? `${IMAGE_HOSTS[language]}/images/cardlist/card/${id}.png`;
        const response = await fetch(url, { headers: { Accept: "image/webp,image/png,*/*" } });
        if (response.ok) bytes = Buffer.from(await response.arrayBuffer());
      }
      if (!bytes) {
        failed++;
        return;
      }

      const vector = await embed(bytes);
      if (!vector) {
        failed++;
        return;
      }
      const quantised = new Int8Array(DIM);
      for (let i = 0; i < DIM; i++) quantised[i] = Math.max(-127, Math.min(127, Math.round(vector[i] * 127)));
      held.set(id, quantised);
    } catch {
      failed++;
    }
    if (++done % 250 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      console.log(`[op-clip]   ${done}/${work.length}  (${rate.toFixed(1)}/s)`);
    }
  });

  // Self-cleaning, for the reason the Pokemon index is: a vector for a printing
  // the catalogue no longer offers is a candidate nobody can act on.
  let pruned = 0;
  for (const id of [...held.keys()]) {
    if (!current.has(id)) {
      held.delete(id);
      pruned++;
    }
  }

  const finalIds = [...held.keys()].sort();
  const blob = new Int8Array(finalIds.length * DIM);
  finalIds.forEach((id, index) => blob.set(held.get(id)!, index * DIM));

  writeFileSync(vectorFile, Buffer.from(blob.buffer));
  writeFileSync(
    manifestFile,
    JSON.stringify({ computedAt: new Date().toISOString(), model: MODEL, dtype: DTYPE, dim: DIM, ids: finalIds })
  );

  console.log(
    `[op-clip] ${language}: ${finalIds.length} vectors, ${failed} unusable, ${pruned} pruned, ` +
      `${((Date.now() - started) / 1000).toFixed(0)}s, ${(blob.length / 1048576).toFixed(1)} MB\n`
  );
}
