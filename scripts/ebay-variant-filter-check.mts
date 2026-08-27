#!/usr/bin/env -S npx tsx
/**
 * Live end-to-end check of the real query shape (see graded-market.ts's own
 * comment: number + variantTags in the query text, not just as a title
 * filter) — calls the real searchActiveListings (real eBay Browse API call,
 * real EBAY_CLIENT_ID/SECRET) for a card, comparing a bare number-only
 * query against number+variantTags, both still passed through
 * titleMatchesCard's own variantTags check.
 *
 * Usage: npx tsx scripts/ebay-variant-filter-check.mts <number> <condition> <language> [variantTag...]
 *   npx tsx scripts/ebay-variant-filter-check.mts OP09-093 "PSA 10" English "Wanted Poster"
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const [number, condition, language, ...variantTags] = process.argv.slice(2);
if (!number || !condition || !language) {
  console.error('Usage: npx tsx scripts/ebay-variant-filter-check.mts <number> <condition> <language> [variantTag...]');
  process.exit(1);
}

const { searchActiveListings } = await import("../src/lib/ebay-browse");
import type { EbayCondition, EbayLanguage } from "../src/lib/ebay-browse";
const { tagFirstWord } = await import("../src/lib/ebay-search");
import type { Card } from "../src/lib/types";

if (!["PSA 10", "PSA 9", "PSA 8", "Raw"].includes(condition)) {
  console.error(`Invalid condition "${condition}" — expected "PSA 10", "PSA 9", "PSA 8", or "Raw".`);
  process.exit(1);
}
if (!["English", "Japanese", "French"].includes(language)) {
  console.error(`Invalid language "${language}" — expected "English", "Japanese", or "French".`);
  process.exit(1);
}
const typedCondition = condition as EbayCondition;
const typedLanguage = language as EbayLanguage;

const fakeCard: Card = {
  id: "test", slug: "test", franchise: "one-piece", name: "test",
  set: "test", number,
  currency: "USD", currentPrice: 0, asOfDate: "2026-08-27",
  priceHistory: [], recentSnapshots: [],
  trend: { day1: null, day7: null, day30: null, day90: null },
  priceRange: null, character: "test",
};

console.log(`\n=== Bare number query, no variantTags anywhere ===`);
const bare = await searchActiveListings(fakeCard, typedCondition, typedLanguage, "", undefined, undefined);
console.log(`total=${bare.total}, shown=${bare.listings.length}`);
bare.listings.forEach((l) => console.log(`  - ${l.title}`));

// Matches graded-market.ts's own oneNameOverride exactly: tagFirstWord per
// tag, not the tags verbatim (confirmed live the full phrase performs worse
// — see that file's own comment).
const tagsForQuery = variantTags.length ? variantTags.map(tagFirstWord).join(" ") : "";
console.log(`\n=== Real query shape: variantTags in the query text ("${tagsForQuery || "(none)"}") + title filter ===`);
const withTags = await searchActiveListings(
  fakeCard,
  typedCondition,
  typedLanguage,
  tagsForQuery,
  undefined,
  variantTags.length ? variantTags : undefined
);
console.log(`total=${withTags.total}, shown=${withTags.listings.length}`);
withTags.listings.forEach((l) => console.log(`  - ${l.title}`));
