#!/usr/bin/env -S npx tsx
/**
 * Live end-to-end check of the new bare-number query + variantTags title
 * filter: calls the real searchActiveListings (real eBay Browse API call,
 * real EBAY_CLIENT_ID/SECRET) for a card, and prints what survives
 * titleMatchesCard's variantTags check vs what the raw broad query found.
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

console.log(`\n=== WITHOUT variantTags (raw broad match) ===`);
const broad = await searchActiveListings(fakeCard, typedCondition, typedLanguage, "", undefined, undefined);
console.log(`total=${broad.total}, shown=${broad.listings.length}`);
broad.listings.forEach((l) => console.log(`  - ${l.title}`));

console.log(`\n=== WITH variantTags=${JSON.stringify(variantTags)} ===`);
const filtered = await searchActiveListings(fakeCard, typedCondition, typedLanguage, "", undefined, variantTags.length ? variantTags : undefined);
console.log(`total=${filtered.total}, shown=${filtered.listings.length}`);
filtered.listings.forEach((l) => console.log(`  - ${l.title}`));
