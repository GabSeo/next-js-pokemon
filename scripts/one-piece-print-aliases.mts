#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Find the printings our two sources number differently but picture identically.
 *
 * THE PROBLEM THIS SOLVES. punk-records and optcgapi both extend a card code
 * with a suffix, and they do not agree on the suffix. Measured 2026-09-07:
 * 201 codes carry ids in BOTH namespaces that the other source lacks —
 *
 *   EB01-043   punk-records  _p1 … _p6      six rows, all named "Promotion card"
 *              optcgapi      _pr1 … _pr7    seven rows, every one named
 *
 * Merging on id alone therefore lists Spandine fifteen times: once per real
 * printing, plus a second anonymous copy of several of them. That is complete
 * and wrong, and "complete and wrong" is the failure this catalogue keeps
 * producing.
 *
 * WHY ARTWORK DECIDES IT. There is no shared key to join on — that is the whole
 * problem — but there IS a shared picture, and both sides are already hashed
 * into data/catalog/one-piece-art/. So the question "is `EB01-043_pr1` the same
 * printing as `EB01-043_p2`" is answered by looking, not by guessing at
 * suffixes.
 *
 * THE THRESHOLD IS MEASURED, NOT PICKED. Across 3,000 random pairs of unrelated
 * printings the 1st percentile distance is 0.393; among same-code cross-source
 * pairs, 195 sit below 0.05 and the median is 0.086. Two of 3,000 unrelated
 * pairs fall under 0.10. At 0.05 the margin to the control distribution is
 * roughly eightfold, so a false pairing is far less likely than the duplicate
 * listing it prevents.
 *
 * WHAT A PAIR MEANS, precisely: the two ids show the same picture. It does NOT
 * mean they are the same product — an Online Regional Participation Pack and
 * its Finalist counterpart share artwork and differ by a stamp too small to
 * survive a 64-bit hash. So the merge uses this in one direction only: a NAMED
 * printing may retire an ANONYMOUS one that looks identical. A name is never
 * dropped, and two named products are never collapsed into one.
 *
 *   npm run catalog:one-piece-aliases
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { officialRowsForCode } from "../src/lib/one-piece-official";
import { isBandaiPicture, optcgRowsForCode, pictureKey } from "../src/lib/one-piece-optcg";

const ART_DIR = path.join(process.cwd(), "data", "catalog", "one-piece-art");
const OUT = path.join(ART_DIR, "aliases.json");

/** See the header: 8x the margin to the control distribution. */
const THRESHOLD = 0.05;

type Stored = { c: [number, number, number]; h: string };

const file = path.join(ART_DIR, "english.json");
if (!existsSync(file)) {
  console.error("[aliases] no signatures yet — run catalog:one-piece-art first.");
  process.exit(1);
}
const signatures = JSON.parse(readFileSync(file, "utf8")).signatures as Record<string, Stored>;

function bits(hex: string): number[] {
  const out: number[] = [];
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    out.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1);
  }
  return out;
}

/** Same weighting as lib/art-rank.ts, so a pair here means what it means there. */
function distance(a: string, b: string): number | undefined {
  const A = signatures[a];
  const B = signatures[b];
  if (!A || !B) return undefined;
  const chroma = Math.sqrt(A.c.reduce((sum, v, i) => sum + (v - B.c[i]) ** 2, 0));
  const x = bits(A.h);
  const y = bits(B.h);
  const structure = x.reduce((d, bit, i) => d + (bit !== y[i] ? 1 : 0), 0) / x.length;
  return chroma * 2 + structure;
}

const codes = new Set<string>();
for (const id of Object.keys(signatures)) codes.add(id.replace(/_(?:p|pr|r)\d+$/, ""));

const pairs: Record<string, string> = {};
let considered = 0;

for (const code of codes) {
  const punk = officialRowsForCode(code, "english")
    .map((row) => row.card.id)
    .filter((id) => signatures[id]);
  if (punk.length === 0) continue;

  for (const row of optcgRowsForCode(code)) {
    // Only pictures held HERE can duplicate a Bandai printing: one that IS
    // Bandai's own file is that printing, not a second copy of it.
    if (!row.image || isBandaiPicture(row.image, row.imageId)) continue;
    const id = pictureKey(row.image);
    if (punk.includes(id) || pairs[id] || !signatures[id]) continue;
    considered++;

    const best = punk
      .map((target) => [target, distance(id, target)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
      .sort((a, b) => a[1] - b[1])[0];

    if (best && best[1] <= THRESHOLD) pairs[id] = best[0];
  }
}

mkdirSync(ART_DIR, { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ computedAt: new Date().toISOString(), threshold: THRESHOLD, pairs }, null, 0)
);

console.log(
  `[aliases] ${considered} cross-source printings compared, ` +
    `${Object.keys(pairs).length} share a picture with one Bandai lists (threshold ${THRESHOLD})`
);
