#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * What the Limitless mirror actually buys us, per language and per set.
 *
 * WHY A SCRIPT AND NOT A NOTE. The value of a third image source is not the
 * number of cards it holds — it is the number of OUR blind cards it can be
 * matched to, and that second number moves whenever the matching rule in
 * lib/limitless.ts changes or either catalogue grows. Writing it down once
 * would make it wrong by the next crawl.
 *
 * It also names the sets that stay blind, which is the list worth arguing with.
 *
 *   npx tsx scripts/limitless-coverage.mts
 *   npx tsx scripts/limitless-coverage.mts --unmatched
 */
import { getCatalogEntries, getCatalogSets, type CatalogLanguage } from "../src/lib/catalog";
import { limitlessCode, limitlessImageUrl, limitlessSets } from "../src/lib/limitless";
import { japaneseOfficialCard } from "../src/lib/pokemon-ja-official";

const showUnmatched = process.argv.includes("--unmatched");

for (const language of ["en", "ja"] as CatalogLanguage[]) {
  const theirs = limitlessSets(language);
  const ourSets = getCatalogSets({ language }).filter((s) => (s.language ?? "en") === language);

  let mapped = 0;
  const unmatchedSets: string[] = [];
  for (const set of ourSets) {
    if (limitlessCode(set, language)) mapped++;
    else unmatchedSets.push(`${set.id} [${set.abbreviation?.official ?? "-"}] ${set.name}`);
  }

  let total = 0;
  let blind = 0;
  let rescued = 0;
  const stillBlind = new Map<string, { n: number; name: string }>();

  for (const { card, set } of getCatalogEntries(language)) {
    total++;
    const pictured = card.image || (language === "ja" && japaneseOfficialCard(set.id, card.localId)?.img);
    if (pictured) continue;
    blind++;
    if (limitlessImageUrl(set, card.localId, language)) rescued++;
    else {
      const row = stillBlind.get(set.id) ?? { n: 0, name: set.name };
      row.n++;
      stillBlind.set(set.id, row);
    }
  }

  const pictured = total - blind;
  console.log(`\n### ${language.toUpperCase()}`);
  console.log(`  their sets ${theirs.length}   ours ${ourSets.length}   mapped ${mapped} (${Math.round((mapped * 100) / ourSets.length)}%)`);
  console.log(`  cards ${total.toLocaleString("en-US")}`);
  console.log(`    pictured before  ${pictured.toLocaleString("en-US")}  (${((pictured * 100) / total).toFixed(1)}%)`);
  console.log(`    Limitless adds   ${rescued.toLocaleString("en-US")}`);
  console.log(`    still blind      ${(blind - rescued).toLocaleString("en-US")}  (${(((blind - rescued) * 100) / total).toFixed(1)}%)`);
  console.log(`    => pictured now  ${(pictured + rescued).toLocaleString("en-US")}  (${(((pictured + rescued) * 100) / total).toFixed(1)}%)`);

  const worst = [...stillBlind.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10);
  if (worst.length > 0) {
    console.log(`  still blind, worst sets:`);
    for (const [id, row] of worst) console.log(`    ${String(row.n).padStart(5)}  ${id.padEnd(13)} ${row.name}`);
  }

  if (showUnmatched && unmatchedSets.length > 0) {
    console.log(`  our sets with no Limitless counterpart (${unmatchedSets.length}):`);
    for (const line of unmatchedSets) console.log(`      ${line}`);
  }
}
