#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Bring the card pictures only optcgapi has into this repository, once.
 *
 * WHY THIS EXISTS. Hundreds of One Piece printings — regional promos, judge
 * packs, anniversary sets, campaign cards — are absent from Bandai's own card
 * list. Without their artwork a person scans a card they are holding and the
 * grid shows them somebody else's picture, which is the failure this whole
 * exercise is about.
 *
 * KEYED ON THE PICTURE, NOT ON `card_image_id`. This is the correction that
 * matters and the one an earlier version of this script got wrong. optcgapi's
 * `card_image_id` names a FILE and is REUSED across genuinely different
 * products: 857 rows share one with a sibling, and every one of those 857
 * carries a different `card_image` URL. Selecting candidates by id therefore
 * concluded "Bandai already has this" for 963 real pictures and skipped them —
 *
 *   ST21-014  3rd Anniversary Treasure Campaign Pack   its own artwork, skipped
 *   OP09-061  Jumbo                                    its own artwork, skipped
 *
 * — so the card page showed the base printing's picture for both, which is
 * worse than showing nothing: it answers the question wrongly rather than
 * admitting it cannot answer. The unit of work here is a distinct PICTURE.
 *
 * BANDAI FIRST, ALWAYS. A picture whose filename is Bandai's own for that
 * printing is theirs to serve: unmetered, higher resolution, already proxied.
 * Only what Bandai genuinely lacks is taken from optcgapi, and every candidate
 * is HEAD-checked against both Bandai hosts before the mirror is touched.
 *
 * IDEMPOTENT AND INCREMENTAL, which is what makes it runnable on every new set.
 * A picture whose file already exists is skipped without a request, so the
 * first run fetches hundreds and every run after fetches only what is new.
 *
 * WHERE THEY LAND. `public/card-images/one-piece/{pictureKey}.webp`, served
 * straight from the CDN as static files — no route, no serverless bundle
 * weight. One width, because a static file cannot be resized per request.
 *
 *   npm run catalog:one-piece-images
 *   npx tsx scripts/one-piece-image-repatriate.mts --dry-run
 *   npx tsx scripts/one-piece-image-repatriate.mts --limit 20
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { officialRowsForCode } from "../src/lib/one-piece-official";
import { isBandaiPicture, pictureKey } from "../src/lib/one-piece-optcg";

const OUT_DIR = path.join(process.cwd(), "public", "card-images", "one-piece");
const OPTCG_DIR = path.join(process.cwd(), "data", "catalog", "one-piece-optcg");

/** The card grid paints at 320 CSS pixels and the card page at up to 480. */
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
    rows.push(...((JSON.parse(readFileSync(p, "utf8")) as { rows?: OptcgRow[] }).rows ?? []));
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

// --- one entry per distinct picture ---------------------------------------

const rows = optcgRows();

type Candidate = { url: string; key: string; imageId?: string; label: string };

const byPicture = new Map<string, Candidate>();
for (const row of rows) {
  if (!row.image) continue;
  const key = pictureKey(row.image);
  if (!byPicture.has(key)) byPicture.set(key, { url: row.image, key, imageId: row.imageId, label: row.name });
}

const candidates = [...byPicture.values()];

/**
 * A Bandai-style filename is a HYPOTHESIS, not a fact.
 *
 * `EB02-041_pr2` and `OP07-116_pr1` are named exactly like Bandai's own files
 * and Bandai answers 404 for both. Trusting the name alone dropped them from
 * this pass, and the card page then pointed at a URL that does not exist. Only
 * a printing Bandai's card list actually CARRIES is safe to leave to Bandai;
 * everything else is HEAD-checked below before the mirror is spared.
 */
function bandaiListsIt(c: Candidate): boolean {
  if (!c.imageId) return false;
  const code = c.imageId.replace(/_(?:p|pr|r)\d+$/, "");
  return (
    officialRowsForCode(code, "english").some((r) => r.card.id === c.imageId) ||
    officialRowsForCode(code, "japanese").some((r) => r.card.id === c.imageId)
  );
}

const mirrorOnly = candidates.filter((c) => !(isBandaiPicture(c.url, c.imageId) && bandaiListsIt(c)));
const pending = mirrorOnly.filter((c) => !existsSync(path.join(OUT_DIR, `${c.key}.webp`)));

console.log(`[images] optcgapi rows: ${rows.length}`);
console.log(`[images] distinct pictures: ${candidates.length}`);
console.log(`[images] not simply Bandai's own file: ${mirrorOnly.length}`);
console.log(`[images] already held: ${mirrorOnly.length - pending.length}`);
console.log(`[images] to consider this run: ${Math.min(pending.length, limit)}\n`);

if (dryRun) {
  for (const c of pending.slice(0, 20)) console.log(`  would fetch ${c.key.slice(0, 60).padEnd(62)} ${c.label.slice(0, 44)}`);
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
// donation-supported server and this walks through hundreds of their pictures.
await pooled(work, 6, async (candidate) => {
  // Bandai may serve it under the printing id after all, in which case theirs
  // is better and free. This is the check the filename alone cannot replace.
  if (candidate.imageId && (await bandaiHas(candidate.imageId))) {
    skippedBandai++;
    return;
  }

  try {
    const response = await fetch(candidate.url);
    if (!response.ok) {
      failed++;
      return;
    }
    const out = await sharp(Buffer.from(await response.arrayBuffer()))
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
    writeFileSync(path.join(OUT_DIR, `${candidate.key}.webp`), out);
    saved++;
    bytes += out.length;
  } catch {
    failed++;
  }

  const done = saved + skippedBandai + failed;
  if (done % 100 === 0) console.log(`[images]   ${done}/${work.length}…`);
});

console.log(
  `\n[images] done in ${((Date.now() - started) / 1000).toFixed(0)}s — ` +
    `${saved} repatriated (${(bytes / 1048576).toFixed(1)} MB), ` +
    `${skippedBandai} already at Bandai, ${failed} unavailable`
);
