#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Bring the card images only optcgapi has into this repository, once.
 *
 * WHY THIS EXISTS. 631 One Piece printings are known to optcgapi and absent
 * from Bandai's own card list — regional promos, judge packs, anniversary sets,
 * campaign cards. Measured on a 25-printing sample, Bandai serves the image for
 * about 7 in 25 anyway; the rest exist nowhere else public. Without them a
 * person scans a card they are holding and the grid shows them somebody else's
 * artwork, which is the failure this whole exercise is about.
 *
 * WHY REPATRIATE RATHER THAN PROXY. A proxy would touch optcgapi once per image
 * per deployment and cost us nothing to run, which is defensible. Downloading
 * once costs them one request per image, ever, and costs us disk. That is the
 * trade the owner of this project chose: no standing dependency on somebody
 * else's donation-supported server, and a catalogue that keeps working if that
 * project ever stops.
 *
 * IDEMPOTENT AND INCREMENTAL, which is what makes it runnable on every new set.
 * A printing whose file already exists is skipped without a request. So the
 * first run fetches hundreds and every run after fetches only what is new —
 * which is the point, because a new set arrives with new promos.
 *
 * BANDAI FIRST, ALWAYS. Every candidate is checked against Bandai before
 * optcgapi is touched: their images are unmetered, higher resolution, and
 * theirs to serve. Only what Bandai genuinely lacks is taken from optcgapi.
 *
 * WHERE THEY LAND. `public/card-images/one-piece/`, served straight from the
 * CDN as static files — no route, no serverless bundle weight, no request-time
 * work. Stored as webp at a single width, because a static file cannot be
 * resized per request and this is the width the card grid actually paints.
 *
 *   npm run catalog:one-piece-images
 *   npx tsx scripts/one-piece-image-repatriate.mts --dry-run
 *   npx tsx scripts/one-piece-image-repatriate.mts --limit 20
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { officialRowsForCode } from "../src/lib/one-piece-official";

const OUT_DIR = path.join(process.cwd(), "public", "card-images", "one-piece");
const OPTCG_DIR = path.join(process.cwd(), "data", "catalog", "one-piece-optcg");

/**
 * One width, chosen rather than assumed. The card grid paints tiles at 320 CSS
 * pixels and the card page at up to 480; 480 covers both without storing a
 * second copy, and a card code needs far less detail than a card face.
 */
const WIDTH = 480;

/** webp at this quality is visually clean on card art and roughly 5x lighter than the source. */
const QUALITY = 78;

/** Bandai's two hosts, English first — the same order the image route uses. */
const BANDAI_HOSTS = ["https://en.onepiece-cardgame.com", "https://www.onepiece-cardgame.com"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

type OptcgRow = { code: string; name: string; image?: string; imageId?: string };

function optcgRows(): OptcgRow[] {
  const rows: OptcgRow[] = [];
  for (const file of ["sets", "decks", "promos"]) {
    const p = path.join(OPTCG_DIR, `${file}.json`);
    if (!existsSync(p)) continue;
    const parsed = JSON.parse(readFileSync(p, "utf8")) as { rows?: OptcgRow[] };
    rows.push(...(parsed.rows ?? []));
  }
  return rows;
}

/** Does Bandai serve this printing? A HEAD is enough and costs them almost nothing. */
async function bandaiHas(printingId: string): Promise<boolean> {
  for (const host of BANDAI_HOSTS) {
    try {
      const response = await fetch(`${host}/images/cardlist/card/${printingId}.png`, { method: "HEAD" });
      if (response.ok) return true;
    } catch {
      // Network fault: treat as absent and let optcgapi answer. A false
      // negative costs one download; a false positive costs a missing image.
    }
  }
  return false;
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

// --- what needs an image at all -------------------------------------------

const rows = optcgRows();
const candidates = rows.filter((row) => {
  if (!row.imageId || !row.image) return false;
  // Already ours, via Bandai, through the catalogue we trust for identity.
  const known =
    officialRowsForCode(row.code, "english").some((r) => r.card.id === row.imageId) ||
    officialRowsForCode(row.code, "japanese").some((r) => r.card.id === row.imageId);
  return !known;
});

const pending = candidates.filter((row) => !existsSync(path.join(OUT_DIR, `${row.imageId}.webp`)));

console.log(`[images] optcgapi rows: ${rows.length}`);
console.log(`[images] printings punk-records lacks, with an image: ${candidates.length}`);
console.log(`[images] already repatriated: ${candidates.length - pending.length}`);
console.log(`[images] to consider this run: ${Math.min(pending.length, limit)}\n`);

if (dryRun) {
  for (const row of pending.slice(0, 20)) console.log(`  would fetch ${row.imageId}  ${row.name.slice(0, 50)}`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

const work = pending.slice(0, limit);
let saved = 0;
let skippedBandai = 0;
let failed = 0;
let bytes = 0;
const started = Date.now();

// Modest concurrency: Bandai tolerates far more, but optcgapi is one person's
// donation-supported server and this walks through hundreds of their images.
await pooled(work, 6, async (row) => {
  const printingId = row.imageId!;

  if (await bandaiHas(printingId)) {
    // Bandai has it after all — the image route will find it there, unmetered
    // and at full resolution. Nothing to store.
    skippedBandai++;
    return;
  }

  try {
    const response = await fetch(row.image!);
    if (!response.ok) {
      failed++;
      return;
    }
    const source = Buffer.from(await response.arrayBuffer());
    const out = await sharp(source)
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
    writeFileSync(path.join(OUT_DIR, `${printingId}.webp`), out);
    saved++;
    bytes += out.length;
  } catch {
    failed++;
  }

  if ((saved + skippedBandai + failed) % 50 === 0) {
    console.log(`[images]   ${saved + skippedBandai + failed}/${work.length}…`);
  }
});

console.log(
  `\n[images] done in ${((Date.now() - started) / 1000).toFixed(0)}s — ` +
    `${saved} repatriated (${(bytes / 1048576).toFixed(1)} MB), ` +
    `${skippedBandai} already at Bandai, ${failed} unavailable`
);
