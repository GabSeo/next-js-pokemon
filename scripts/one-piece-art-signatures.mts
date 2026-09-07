#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Precompute an artwork signature for every One Piece printing.
 *
 * WHY THIS EXISTS. The scan ranks a card's printings by how much each looks
 * like the photo, and it was computing the reference signatures at request
 * time: for a card with seven printings, seven sequential fetches of a ~250 KB
 * image from Bandai, each decoded and hashed. Measured at 250–600 ms per fetch,
 * that is two to four seconds of a scan spent re-deriving something that never
 * changes. A printing's artwork is immutable — Bandai issues a new id rather
 * than repainting one — so this belongs on disk beside the catalogue.
 *
 * The whole file is a few hundred kilobytes and turns the runtime cost of
 * ranking from "seven downloads" into "one map lookup".
 *
 * UNMETERED. onepiece-cardgame.com has no ceiling in lib/api-budget.ts, which
 * is why the catalogue and its images could be built at all. This is one pass
 * over ~10,000 images, run by hand when the catalogue is re-crawled.
 *
 * INCREMENTAL, which is what makes it part of a per-set routine rather than an
 * afternoon. A printing already signed is skipped without a fetch, so the first
 * run costs ~10,000 downloads and every run after costs only the new set.
 * `--force` re-signs everything, for when the signature format itself changes.
 *
 *   npm run catalog:one-piece-art
 *   npx tsx scripts/one-piece-art-signatures.mts --languages english
 *   npx tsx scripts/one-piece-art-signatures.mts --force
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { artSignature } from "../src/lib/art-rank";
import { officialCardsInPack, officialImageUrl, officialPacks } from "../src/lib/one-piece-official";

const OUT_DIR = path.join(process.cwd(), "data", "catalog", "one-piece-art");

/** Bandai serves these happily, but there is no reason to be rude about it. */
const CONCURRENCY = 12;

const args = process.argv.slice(2);
const only = args.includes("--languages") ? args[args.indexOf("--languages") + 1]?.split(",") : undefined;
const languages = only ?? ["english", "japanese"];
const force = args.includes("--force");

/**
 * The repatriated images, which have no Bandai URL to fetch.
 *
 * They are 541 printings Bandai's card list does not carry, and skipping them
 * here would leave the scan unable to rank exactly the promos that sent us
 * looking for them — a card whose reference exists but whose artwork the ranker
 * has never seen scores as if it were absent.
 */
const LOCAL_DIR = path.join(process.cwd(), "public", "card-images", "one-piece");

/** `[r, g, b]` rounded to four places, and the 64 hash bits as 16 hex characters. */
type StoredSignature = { c: [number, number, number]; h: string };

function toHex(bits: number[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  }
  return hex;
}

async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        await worker(items[index]);
      }
    })
  );
}

for (const language of languages) {
  const ids: string[] = [];
  for (const pack of officialPacks(language)) {
    for (const card of officialCardsInPack(pack.pack.id, language)) ids.push(card.id);
  }

  // Local files are English-side: they come from a mirror that carries one
  // language, and pairing them with the Japanese pass would claim a print we
  // have not seen.
  const local =
    language === "english" && existsSync(LOCAL_DIR)
      ? readdirSync(LOCAL_DIR).filter((n) => n.endsWith(".webp")).map((n) => n.slice(0, -5))
      : [];

  const file = path.join(OUT_DIR, `${language}.json`);
  const previous: Record<string, StoredSignature> =
    !force && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).signatures ?? {}) : {};

  const signatures: Record<string, StoredSignature> = { ...previous };
  const todo = [...ids, ...local].filter((id) => !signatures[id]);
  console.log(
    `[art] ${language}: ${ids.length} printings + ${local.length} repatriated, ` +
      `${Object.keys(previous).length} already signed, ${todo.length} to do`
  );
  let done = 0;
  let failed = 0;
  const started = Date.now();

  await pooled(todo, CONCURRENCY, async (id) => {
    const localFile = path.join(LOCAL_DIR, `${id}.webp`);
    const onDisk = existsSync(localFile);
    const url = onDisk ? undefined : officialImageUrl(id, language);
    if (!onDisk && !url) {
      failed++;
      return;
    }
    try {
      // A file we hold needs no request; only Bandai printings are fetched.
      const source = onDisk ? readFileSync(localFile) : await (async () => {
        const response = await fetch(url!);
        if (!response.ok) return undefined;
        return Buffer.from(await response.arrayBuffer());
      })();
      if (!source) {
        failed++;
        return;
      }
      // `alreadyCardShaped`: Bandai's own scans ARE the card, with no
      // surrounding photo to crop away.
      const signature = await artSignature(source, true);
      if (!signature) {
        failed++;
        return;
      }
      signatures[id] = {
        c: signature.chroma.map((v) => Number(v.toFixed(4))) as [number, number, number],
        h: toHex(signature.bits),
      };
    } catch {
      // A single unreachable image is not worth failing a whole pass for; the
      // scan falls back to catalogue order for anything missing here.
      failed++;
    }
    if (++done % 500 === 0) console.log(`[art]   ${done}/${todo.length}…`);
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify({ computedAt: new Date().toISOString(), language, signatures }));

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  const size = JSON.stringify(signatures).length;
  console.log(
    `[art] ${language}: ${Object.keys(signatures).length} signatures, ${failed} unreadable, ` +
      `${elapsed}s, ${(size / 1024).toFixed(0)} KB\n`
  );
}
