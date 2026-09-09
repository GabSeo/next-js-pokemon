#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Precompute an artwork signature for every Pokemon card, in both languages.
 *
 * WHY THIS EXISTS. We hold 10,828 artwork signatures for One Piece and, until
 * this script, zero for Pokemon — so the scan could rank One Piece printings by
 * looking at them and could only ever order Pokemon candidates by the script
 * they are printed in. That is why a photographed Japanese Gengar ex and a Team
 * Rocket Porygon, which share the printed number `048/082`, were separated by
 * "is this text kana" rather than by "do these two pictures look alike".
 *
 * It is also step 1 of docs/live-scan-plan.md. Measured there: a linear match
 * against 60,000 of these signatures takes 0.25 ms in a browser, and the index
 * is 469 KB — so this file is what a live camera view would ship and search,
 * with no server in the loop.
 *
 * WHAT A SIGNATURE IS. `lib/art-rank.ts` crops the artwork region, normalises
 * brightness, and produces three colour numbers plus 64 structure bits. The
 * crop was measured for One Piece and is reused unchanged: it covers 10%–55%
 * of the card's height, which is where Pokemon artwork sits too, and it matters
 * far more that the SAME crop is applied to the reference and to the photograph
 * than that it is perfectly centred on either.
 *
 * TWO IMAGE SOURCES, matching where the catalogue's pictures come from:
 * TCGdex's asset host for the 21,829 English and 3,882 Japanese cards it
 * pictures, and the official Japanese card site for the 4,569 more that only
 * the mirrored official data covers. 4,330 Japanese cards are pictured nowhere
 * public and cannot be signed by anyone.
 *
 * `low.webp` rather than `high`: a 64-bit hash over a 9x8 grid needs no
 * resolution, and the small file is ~10x lighter on a host doing us a favour.
 *
 * INCREMENTAL, so this is runnable per set rather than per afternoon. A card
 * already signed is skipped without a request. `--force` re-signs everything,
 * for when the signature format itself changes.
 *
 *   npm run catalog:pokemon-art
 *   npx tsx scripts/pokemon-art-signatures.mts --languages en
 *   npx tsx scripts/pokemon-art-signatures.mts --force
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { artSignature } from "../src/lib/art-rank";
import { getCatalogEntries, type CatalogLanguage } from "../src/lib/catalog";
import { limitlessImageUrl } from "../src/lib/limitless";
import { japaneseOfficialCard } from "../src/lib/pokemon-ja-official";

const OUT_DIR = path.join(process.cwd(), "data", "catalog", "pokemon-art");

/**
 * TCGdex's CDN takes this happily; the official Japanese site is a publisher
 * doing us a favour, so its requests go through the slower lane below.
 */
const CDN_CONCURRENCY = 12;
const PUBLISHER_CONCURRENCY = 6;

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.includes("--languages") ? args[args.indexOf("--languages") + 1]?.split(",") : undefined;
const languages = (only ?? ["en", "ja"]) as CatalogLanguage[];

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

type Target = { key: string; url: string; publisher: boolean };

for (const language of languages) {
  const file = path.join(OUT_DIR, `${language}.json`);
  const previous: Record<string, StoredSignature> =
    !force && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).signatures ?? {}) : {};

  const signatures: Record<string, StoredSignature> = { ...previous };

  const targets: Target[] = [];
  const current = new Set<string>();
  let unpictured = 0;

  for (const { card, set } of getCatalogEntries(language)) {
    current.add(card.tcgdexId);
    // Keyed on the TCGdex id, which is what a CardView's print carries, so the
    // scan can look a signature up without knowing where the picture came from.
    const key = card.tcgdexId;
    if (signatures[key]) continue;

    if (card.image) {
      targets.push({ key, url: `${card.image}/low.webp`, publisher: false });
      continue;
    }

    const official = language === "ja" ? japaneseOfficialCard(set.id, card.localId) : undefined;
    if (official?.img) {
      targets.push({ key, url: official.img, publisher: true });
      continue;
    }

    // Third and last — 2,521 cards nothing else pictures. Their thumbnail is
    // 274x381, which is far more than a 9x8 hash grid needs.
    const fromLimitless = limitlessImageUrl(set, card.localId, language);
    if (fromLimitless) {
      targets.push({ key, url: fromLimitless, publisher: true });
      continue;
    }

    unpictured++;
  }

  const cdn = targets.filter((t) => !t.publisher);
  const publisher = targets.filter((t) => t.publisher);

  console.log(
    `[art] ${language}: ${Object.keys(previous).length} already signed, ${targets.length} to do ` +
      `(${cdn.length} from TCGdex, ${publisher.length} from the publisher), ${unpictured} pictured nowhere`
  );

  let done = 0;
  let failed = 0;
  const started = Date.now();

  const sign = async (target: Target) => {
    try {
      const response = await fetch(target.url, { headers: { Accept: "image/webp,image/jpeg,*/*" } });
      if (!response.ok) {
        failed++;
        return;
      }
      // `alreadyCardShaped`: these are card scans, with no surrounding
      // photograph to crop away.
      const signature = await artSignature(Buffer.from(await response.arrayBuffer()), true);
      if (!signature) {
        failed++;
        return;
      }
      signatures[target.key] = {
        c: signature.chroma.map((v) => Number(v.toFixed(4))) as [number, number, number],
        h: toHex(signature.bits),
      };
    } catch {
      // One unreachable image is not worth failing a whole pass for; a card
      // with no signature simply leaves its group unranked, which is the
      // behaviour before this file existed.
      failed++;
    }
    if (++done % 1000 === 0) console.log(`[art]   ${done}/${targets.length}…`);
  };

  await pooled(cdn, CDN_CONCURRENCY, sign);
  await pooled(publisher, PUBLISHER_CONCURRENCY, sign);

  // Self-cleaning, for the same reason the CLIP index is: a signature for a
  // card the catalogue no longer offers is a candidate nobody can act on.
  let pruned = 0;
  for (const id of Object.keys(signatures)) {
    if (!current.has(id)) {
      delete signatures[id];
      pruned++;
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify({ computedAt: new Date().toISOString(), language, signatures }));

  const size = JSON.stringify(signatures).length;
  console.log(
    `[art] ${language}: ${Object.keys(signatures).length} signatures, ${failed} unreadable, ${pruned} pruned, ` +
      `${((Date.now() - started) / 1000).toFixed(0)}s, ${(size / 1024).toFixed(0)} KB\n`
  );
}
