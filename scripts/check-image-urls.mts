#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Nobody may append a width to a One Piece image URL by hand.
 *
 * WHY THIS IS WORTH A CHECK. The same bug shipped twice. A One Piece print
 * carries a COMPLETE image URL, and it is one of two kinds: a proxied route
 * that resizes on demand, or a repatriated file that is one width on disk. Both
 * the card page and the scan grid wrote `${print.image}&w=320`, which is right
 * for the first kind and produces a 404 for the second:
 *
 *   /card-images/one-piece/OP09-061_pr1.webp&w=320
 *
 * Neither tsc nor eslint can see it — it is a valid template string producing a
 * valid string — and it renders as a broken tile only for the promo printings,
 * which is exactly the set nobody has a reference image for. So it hides in the
 * cards this whole catalogue effort exists to fix.
 *
 * `lib/one-piece-image-url.ts` holds the rule and is importable from client and
 * server alike, so there is no reason left to hand-roll it.
 *
 *   npx tsx scripts/check-image-urls.mts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "src");

/** The one file allowed to know how a width is spelled. */
const OWNER = path.join("src", "lib", "one-piece-image-url.ts");

/** `&w=` glued onto something that is not a literal route path. */
const HAND_ROLLED = /\$\{[^}]*\}\s*&w=|&w=\$\{/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const offenders: string[] = [];

for (const file of walk(ROOT)) {
  const relative = path.relative(process.cwd(), file);
  if (relative === OWNER) continue;
  const source = readFileSync(file, "utf8");
  source.split("\n").forEach((line, index) => {
    if (HAND_ROLLED.test(line)) offenders.push(`${relative}:${index + 1}  ${line.trim().slice(0, 90)}`);
  });
}

if (offenders.length > 0) {
  console.error("[image-urls] a width is being appended by hand — use onePieceSrc/onePieceSrcSet:\n");
  for (const offender of offenders) console.error(`   ${offender}`);
  console.error(
    "\n   A repatriated file cannot be resized per request; appending &w= to one produces a 404.\n" +
      `   The rule lives in ${OWNER}.`
  );
  process.exit(1);
}

console.log("[image-urls] OK — no hand-rolled image widths outside the module that owns the rule.");
