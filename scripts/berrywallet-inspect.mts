#!/usr/bin/env -S npx tsx
/**
 * One-off BerryWallet inspection for a specific card_number (+ optional
 * variant tags) — calls the exact same functions src/lib/cards.ts's
 * resolveBerryWalletCard / getOnePieceJapaneseText call, so whatever this
 * prints is exactly what the app itself would resolve. Built to debug the
 * "card details showing up wrong" issue blocking One Piece's graded-market
 * rollout — prints every raw candidate alongside what pickVariant actually
 * chose, so a mismatch is visible instead of guessed at.
 *
 * Usage (needs POKEWALLET_API_KEY — read from .env.local if present, or
 * already exported):
 *
 *   npx tsx scripts/berrywallet-inspect.mts <card_number> [variantTag...]
 *   npx tsx scripts/berrywallet-inspect.mts OP09-004 Manga
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const [cardNumber, ...variantTags] = process.argv.slice(2);
if (!cardNumber) {
  console.error("Usage: npx tsx scripts/berrywallet-inspect.mts <card_number> [variantTag...]");
  process.exit(1);
}

async function main() {
  const { searchCards, findCardInLanguage } = await import("../src/lib/berrywallet");

  console.log(`\n=== searchCards("${cardNumber}") — flat, language-blind index ===`);
  const all = await searchCards(cardNumber, 50);
  const matching = all.filter((c) => c.card_number === cardNumber);
  console.log(`${all.length} total result(s) for the query, ${matching.length} with an exact card_number match`);
  for (const c of matching) {
    console.log(`\n--- ${c.id} ---`);
    console.log(JSON.stringify(c, null, 2));
  }

  for (const lang of ["en", "jp"] as const) {
    const tags = variantTags.length ? variantTags : undefined;
    console.log(`\n=== findCardInLanguage("${cardNumber}", "${lang}", ${JSON.stringify(tags)}) ===`);
    try {
      const result = await findCardInLanguage(cardNumber, lang, tags);
      if (!result) {
        console.log("undefined — no match found in this language for this card_number");
      } else {
        console.log(`set: ${result.set.name} (${result.set.set_code})`);
        console.log(JSON.stringify(result.card, null, 2));
      }
    } catch (err) {
      console.error("threw:", err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
