#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Fails the build when a tracked One Piece card's query cannot separate it from
 * its own siblings.
 *
 * WHY THIS IS A BUILD GATE AND NOT A WARNING. Everything else about a One Piece
 * eBay query derives itself from the crawled corpus — the treatments, the
 * siblings, the rarities. Two things do not, because they are marketplace
 * vocabulary rather than catalogue data: the short name sellers write for a SET
 * and the one they write for a PRODUCT (see src/data/one-piece-sets.ts).
 *
 * A missing entry does not crash anything. The query simply loses a term and
 * quietly stops telling two printings apart, which surfaces as a median that is
 * wrong for no visible reason — the OP05-074 failure, where a $1,400 card
 * displayed $69.99 asks for weeks because one group was too broad. That class
 * of bug is invisible in review and expensive in production, so it is checked
 * here instead of being left to whoever notices the price looks off.
 *
 * Three failures are possible:
 *
 *   MISSING PRODUCT   a printing of a tracked code sits in a product the table
 *                     does not know, so nothing can name or exclude it.
 *   MISSING SET       same, for the set family.
 *   COLLIDING TERMS   two DIFFERENT products on one code resolve to the same
 *                     term, so excluding one excludes the other. 89 codes in
 *                     the corpus have products that collide under a naive
 *                     first-two-words rule (four separate "Championship 2024"
 *                     products on OP01-077 alone), which is exactly why the
 *                     table exists.
 *
 * Run by `npm run prebuild`, so a card cannot ship with a query that was never
 * able to work.
 */
import { cardRefs } from "../src/data/card-refs";
import { opRowsForCode, opSetFamily } from "../src/lib/one-piece-catalog";
import { productOf } from "../src/lib/one-piece-variants";
import { OP_PRODUCT_VOCABULARY, OP_SET_VOCABULARY } from "../src/data/one-piece-sets";

type Problem = { kind: string; detail: string; cards: string[] };

const problems = new Map<string, Problem>();
function report(kind: string, key: string, detail: string, card: string) {
  const existing = problems.get(key);
  if (existing) {
    if (!existing.cards.includes(card)) existing.cards.push(card);
    return;
  }
  problems.set(key, { kind, detail, cards: [card] });
}

const tracked = cardRefs.filter((r) => r.franchise === "one-piece" && r.lookup.by === "code");
let codesChecked = 0;

for (const ref of tracked) {
  if (ref.lookup.by !== "code") continue;
  const rows = opRowsForCode(ref.lookup.code);
  // A code with a single printing has nothing to be confused with, and a code
  // with no rows at all is resolved through the flat search index instead —
  // neither can be separated wrongly.
  if (rows.length < 2) continue;
  codesChecked++;

  for (const row of rows) {
    const family = opSetFamily(row.set.code).toUpperCase();
    if (!(family in OP_SET_VOCABULARY)) {
      report("MISSING SET", `set:${family}`, `${family} (${row.set.code} = ${row.set.name})`, ref.slug);
    }
    const product = productOf(row.card.name);
    if (product && !(product in OP_PRODUCT_VOCABULARY)) {
      report("MISSING PRODUCT", `product:${product}`, `"${product}"`, ref.slug);
    }
  }

  // Two different products on one code must not resolve to the same term, or
  // the query cannot name one without naming the other.
  const byTerm = new Map<string, Set<string>>();
  for (const row of rows) {
    const product = productOf(row.card.name);
    const entry = product ? OP_PRODUCT_VOCABULARY[product] : undefined;
    if (!product || !entry?.exclude) continue;
    byTerm.set(entry.exclude, new Set([...(byTerm.get(entry.exclude) ?? []), product]));
  }
  for (const [term, products] of byTerm) {
    if (products.size < 2) continue;
    report("COLLIDING TERMS", `collide:${ref.lookup.code}:${term}`, `"${term}" <- ${[...products].join(" | ")}`, ref.slug);
  }
}

if (problems.size === 0) {
  console.log(
    `[one-piece] vocabulary OK — ${tracked.length} tracked card(s), ${codesChecked} multi-printing code(s), ` +
      `${Object.keys(OP_SET_VOCABULARY).length} set families and ${Object.keys(OP_PRODUCT_VOCABULARY).length} products in the table.`
  );
  process.exit(0);
}

console.error(`\n[one-piece] ${problems.size} vocabulary gap(s). Add them to src/data/one-piece-sets.ts.\n`);
for (const { kind, detail, cards } of problems.values()) {
  console.error(`  ${kind.padEnd(16)} ${detail}`);
  console.error(`  ${"".padEnd(16)} needed by: ${cards.join(", ")}`);
}
console.error(
  `\nUntil then those printings cannot be told apart, which shows up as a wrong` +
    ` median rather than an error. See that file's header for what a term should be,` +
    ` and \`exclude: null\` for a catalogue bucket or a deck named after its contents.\n`
);
process.exit(1);
