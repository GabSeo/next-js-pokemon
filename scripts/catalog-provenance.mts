#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Who gave us each piece of each card — counted, per language.
 *
 * WHY THIS EXISTS. The Pokemon catalogue is assembled from five independent
 * sources and every one of them covers a different slice. Anyone reading the
 * code can see THAT the sources are layered; nobody can see how much each one
 * actually carries without counting, and "TCGdex is the backbone" stops being
 * true the moment you ask about Japanese pictures, where it supplies 16%.
 *
 * A live scan is only as good as the references behind it, so the number that
 * decides the product is "how many cards can be matched at all" — a card with
 * no picture has no embedding and cannot be recognised by anything. This prints
 * that number and its causes.
 *
 * It is the source of the figures in docs/pokemon-catalogue-pipeline.md, so the
 * doc can be re-derived rather than trusted.
 *
 *   npx tsx scripts/catalog-provenance.mts
 *   npx tsx scripts/catalog-provenance.mts --json
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getCatalogEntries, getCatalogSets, type CatalogLanguage } from "../src/lib/catalog";
import { limitlessImageUrl } from "../src/lib/limitless";
import { japaneseOfficialCard } from "../src/lib/pokemon-ja-official";

const asJson = process.argv.includes("--json");
const DATA = path.join(process.cwd(), "data", "catalog");

function countIds(file: string, key: "ids" | "signatures"): number {
  try {
    if (!existsSync(file)) return 0;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return key === "ids" ? (parsed.ids ?? []).length : Object.keys(parsed.signatures ?? {}).length;
  } catch {
    return 0;
  }
}

const report: Record<string, unknown> = {};

for (const language of ["en", "ja"] as CatalogLanguage[]) {
  const entries = getCatalogEntries(language);
  const sets = getCatalogSets({ language }).filter((s) => (s.language ?? "en") === language);

  const c = {
    sets: sets.length,
    cards: entries.length,
    // WHERE THE PICTURE COMES FROM — the field the scan actually depends on.
    imageTcgdex: 0,
    imagePublisher: 0,
    imageLimitless: 0,
    imageNone: 0,
    // WHAT WE KNOW ABOUT THE CARD ITSELF.
    withRarity: 0,
    withVariants: 0,
    withDexId: 0,
    withMarketPointer: 0,
    unresolved: 0,
    // Whether the displayed label is Latin — a Japanese label is unsearchable
    // for a French reader and was the reason lib/card-label.ts exists.
    latinLabel: 0,
  };

  const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;

  for (const { card, set, label } of entries) {
    if (card.image) c.imageTcgdex++;
    else if (language === "ja" && japaneseOfficialCard(set.id, card.localId)?.img) c.imagePublisher++;
    else if (limitlessImageUrl(set, card.localId, language)) c.imageLimitless++;
    else c.imageNone++;

    if (card.rarity) c.withRarity++;
    if (card.variants.length > 0) c.withVariants++;
    if (card.dexId) c.withDexId++;
    if (card.cardmarketProductId || card.tcgplayerProductId) c.withMarketPointer++;
    if (card.unresolved) c.unresolved++;
    if (!JAPANESE.test(label)) c.latinLabel++;
  }

  const pictured = c.cards - c.imageNone;
  const scannable = {
    signatures: countIds(path.join(DATA, "pokemon-art", `${language}.json`), "signatures"),
    vectors: countIds(path.join(DATA, "pokemon-clip", `${language}.json`), "ids"),
  };

  report[language] = { ...c, pictured, ...scannable };

  if (asJson) continue;

  const pct = (n: number) => `${((n * 100) / c.cards).toFixed(1)}%`;
  console.log(`\n${"=".repeat(64)}\n  ${language === "en" ? "ENGLISH" : "JAPANESE"}   ${c.sets} sets, ${c.cards.toLocaleString("en-US")} cards\n${"=".repeat(64)}`);
  console.log(`  PICTURE — the field the scan lives on`);
  console.log(`    TCGdex CDN            ${String(c.imageTcgdex).padStart(6)}  ${pct(c.imageTcgdex)}`);
  console.log(`    official JP publisher ${String(c.imagePublisher).padStart(6)}  ${pct(c.imagePublisher)}`);
  console.log(`    Limitless             ${String(c.imageLimitless).padStart(6)}  ${pct(c.imageLimitless)}`);
  console.log(`    NONE                  ${String(c.imageNone).padStart(6)}  ${pct(c.imageNone)}`);
  console.log(`    => pictured           ${String(pictured).padStart(6)}  ${pct(pictured)}`);
  console.log(`  IDENTITY`);
  console.log(`    rarity                ${String(c.withRarity).padStart(6)}  ${pct(c.withRarity)}`);
  console.log(`    variants (printings)  ${String(c.withVariants).padStart(6)}  ${pct(c.withVariants)}`);
  console.log(`    Pokedex number        ${String(c.withDexId).padStart(6)}  ${pct(c.withDexId)}`);
  console.log(`    Latin label           ${String(c.latinLabel).padStart(6)}  ${pct(c.latinLabel)}`);
  console.log(`    market pointer        ${String(c.withMarketPointer).padStart(6)}  ${pct(c.withMarketPointer)}`);
  console.log(`    crawl unresolved      ${String(c.unresolved).padStart(6)}`);
  console.log(`  DERIVED FOR THE SCAN`);
  console.log(`    artwork signatures    ${String(scannable.signatures).padStart(6)}`);
  console.log(`    MobileCLIP vectors    ${String(scannable.vectors).padStart(6)}`);
}

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  const en = report.en as Record<string, number>;
  const ja = report.ja as Record<string, number>;
  console.log(`\n${"=".repeat(64)}`);
  console.log(`  TOTAL  ${(en.cards + ja.cards).toLocaleString("en-US")} cards, ` +
    `${(en.pictured + ja.pictured).toLocaleString("en-US")} pictured, ` +
    `${(en.vectors + ja.vectors).toLocaleString("en-US")} searchable by a photograph`);
  console.log(`${"=".repeat(64)}`);
}
