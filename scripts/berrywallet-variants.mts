#!/usr/bin/env -S npx tsx
/**
 * Dumps every same-card_number candidate BerryWallet returns for BOTH
 * languages' guessed set, with a computed "rank price" (cardmarket avg,
 * falling back to tcgplayer market_price) for each — to check whether
 * price-rank alignment between English and Japanese candidate lists is a
 * reliable, general way to match variants (no tags exist on the JP side at
 * all, see berrywallet.ts's own file header).
 *
 * Usage: npx tsx scripts/berrywallet-variants.mts <card_number>
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

const [cardNumber] = process.argv.slice(2);
if (!cardNumber) {
  console.error("Usage: npx tsx scripts/berrywallet-variants.mts <card_number>");
  process.exit(1);
}

const { getSets, getSetCards } = await import("../src/lib/berrywallet");
import type { BerryWalletCard } from "../src/lib/berrywallet";

function rankPrice(card: BerryWalletCard): number | undefined {
  const cm = card.cardmarket?.prices?.avg;
  if (cm !== undefined && cm !== null) return cm;
  const tp = card.tcgplayer?.prices?.market_price;
  return tp !== undefined && tp !== null ? tp : undefined;
}

for (const language of ["en", "jp"] as const) {
  const guessedCode = language === "jp" ? `${cardNumber.split("-")[0]}-JP` : cardNumber.split("-")[0];
  const sets = await getSets(language);
  const set = sets.find((s) => s.set_code === guessedCode);
  console.log(`\n=== ${language} set ${guessedCode} -> ${set ? set.name : "NOT FOUND"} ===`);
  if (!set) continue;
  // allPages: this is a hand-run diagnostic, so seeing the whole set matters
  // more than the extra request (see getSetCards' own doc comment).
  const cards = await getSetCards(set.set_code, { allPages: true });
  const matches = cards.filter((c) => c.card_number === cardNumber || c.name.includes(cardNumber));
  const ranked = [...matches].sort((a, b) => (rankPrice(a) ?? 0) - (rankPrice(b) ?? 0));
  console.log(`${matches.length} candidate(s), sorted by rank price ascending:`);
  ranked.forEach((c, i) => {
    console.log(`  [${i}] ${c.name} — rankPrice=${rankPrice(c)} — cardmarket.product_name=${c.cardmarket?.product_name ?? "none"}`);
  });
}
