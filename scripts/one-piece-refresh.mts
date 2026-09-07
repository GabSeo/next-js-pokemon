#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * The whole One Piece catalogue, refreshed in the one order that works.
 *
 * WHY A SINGLE COMMAND. The catalogue is four passes over two sources and the
 * dependencies between them are real, not stylistic: images can only be
 * repatriated once BOTH card lists are on disk, because the decision "does
 * Bandai already have this printing" is a comparison between them. Signatures
 * can only be computed once the images exist. Run out of order and the result
 * is not an error — it is a quietly incomplete catalogue, which is the failure
 * mode this project keeps hitting.
 *
 *   1  punk-records   what a card IS, in three languages. Identity.
 *   2  optcgapi       what a promo is CALLED, what it is worth, and the 631
 *                     printings Bandai's own list omits.
 *   3  images         the ~550 of those Bandai serves no picture for, fetched
 *                     once into public/ rather than proxied forever.
 *   4  signatures     artwork hashes, so the scan can rank the new printings.
 *   5  aliases        which printings the two sources number differently and
 *                     picture identically, so a card is not listed twice.
 *
 * RUN IT WHEN A SET DROPS. Every pass is incremental — steps 3 and 4 skip what
 * they already have without a request — so a refresh after a new set costs the
 * new set and nothing else. The first run cost ~10,000 images; a run today
 * costs three JSON fetches and a handful of pictures.
 *
 * POLITE BY CONSTRUCTION. optcgapi is one person's donation-supported project:
 * step 2 takes its three bulk endpoints and step 3 asks Bandai first for every
 * single image, so the mirror is only touched for pictures that exist nowhere
 * else. Neither source is metered in lib/api-budget.ts, and neither is
 * affiliated with Bandai — they mirror data Bandai publishes.
 *
 *   npm run catalog:one-piece-refresh
 *   npx tsx scripts/one-piece-refresh.mts --skip-art
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const skipArt = args.includes("--skip-art");

const IMAGE_DIR = path.join(process.cwd(), "public", "card-images", "one-piece");

function countImages(): number {
  return existsSync(IMAGE_DIR) ? readdirSync(IMAGE_DIR).filter((n) => n.endsWith(".webp")).length : 0;
}

const steps = [
  { name: "punk-records (identity)", script: "one-piece-official-crawl.mts" },
  { name: "optcgapi (names, prices, missing printings)", script: "one-piece-optcg-crawl.mts" },
  { name: "images Bandai does not serve", script: "one-piece-image-repatriate.mts" },
  ...(skipArt
    ? []
    : [
        { name: "artwork signatures", script: "one-piece-art-signatures.mts" },
        // Last, and it must be: pairing the two sources by picture needs both
        // sides hashed, which is what the pass above just finished doing.
        { name: "printing aliases (de-duplicate the two numberings)", script: "one-piece-print-aliases.mts" },
      ]),
];

const before = countImages();
const started = Date.now();

for (const [index, step] of steps.entries()) {
  console.log(`\n${"=".repeat(64)}\n[${index + 1}/${steps.length}] ${step.name}\n${"=".repeat(64)}`);
  const result = spawnSync("npx", ["tsx", path.join("scripts", step.script)], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    // Stop rather than continue: every later pass reads what this one wrote, so
    // carrying on would produce a catalogue that looks complete and is not.
    console.error(`\n[refresh] ${step.script} exited ${result.status} — stopping before the passes that depend on it.`);
    process.exit(result.status ?? 1);
  }
}

const after = countImages();
console.log(
  `\n[refresh] done in ${((Date.now() - started) / 1000).toFixed(0)}s — ` +
    `${after} images held locally (${after - before >= 0 ? "+" : ""}${after - before} this run)`
);
console.log("[refresh] commit data/catalog/ and public/card-images/ together: the merge joins them on printing id.");
