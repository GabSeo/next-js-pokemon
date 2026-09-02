#!/usr/bin/env -S npx tsx
/**
 * What every source actually returns for one tracked card, and which gaps are
 * left — the first step of docs/adding-a-card.md.
 *
 * Calls the same functions the product page calls (getCardBySlug, plus the
 * three localized-text resolvers), so what this prints is what the page would
 * render, not a parallel reimplementation that can drift from it.
 *
 * The point is the GAPS section at the end. Each gap names the escape hatch
 * that closes it, in order of preference, so "the API can't find it" turns
 * into a decision instead of a dead end. A card with no gaps needs no fields
 * on its CardRef at all, which is the outcome to aim for.
 *
 * Deliberately does NOT touch eBay. A graded-market pass costs 6-8 searches
 * per card against the tightest budget this app has, and none of it answers
 * the question this script is for. Use scripts/ebay-query-lab.mts for that.
 *
 * Usage (reads .env.local if present, or already-exported vars):
 *
 *   npx tsx scripts/card-audit.mts <slug>
 *   npx tsx scripts/card-audit.mts monkey-d-luffy-op09-061
 *   npx tsx scripts/card-audit.mts --all
 *
 * `--all` sweeps every ref. It is the expensive form — roughly a dozen
 * upstream calls per card across four APIs — so run it before a deploy, not
 * while iterating on one card.
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

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: npx tsx scripts/card-audit.mts <slug> | --all");
  process.exit(1);
}

const OK = "  ok ";
const NO = "  -- ";

/** The set/card portion of a Cardmarket product URL — the part that identifies the product. */
function product(url: string | undefined): string {
  return url?.split("/Singles/")[1] ?? "none";
}

type Gap = { what: string; fix: string[] };

async function auditOne(slug: string): Promise<number> {
  const { cardRefs } = await import("../src/data/card-refs");
  const { getCardBySlug, getFrenchCardText, getJapaneseCardText, getOnePieceJapaneseText } = await import(
    "../src/lib/cards"
  );

  const ref = cardRefs.find((r) => r.slug === slug);
  if (!ref) {
    console.error(`No CardRef with slug "${slug}". Known slugs:\n  ${cardRefs.map((r) => r.slug).join("\n  ")}`);
    return 1;
  }

  console.log(`\n${"=".repeat(72)}\n${slug}  —  ${ref.displayName}  (${ref.franchise})\n${"=".repeat(72)}`);

  const card = await getCardBySlug(slug);
  if (!card) {
    console.log("\nNo card resolved at all. Every source missed, or every source is down.");
    console.log("Re-run when quotas reset before concluding anything about the card itself.");
    return 1;
  }

  const gaps: Gap[] = [];

  // --- identity -------------------------------------------------------
  console.log("\nIDENTITY");
  console.log(`  answered by: ${(card.identifiers ?? []).map((i) => i.scheme).join(", ") || "nothing"}`);
  console.log(`  ${card.name} — ${card.set} #${card.number ?? "?"} (${card.rarity ?? "no rarity"})`);
  console.log(`${card.imageUrl ? OK : NO}image`);
  if (!card.imageUrl) {
    gaps.push({
      what: "no image",
      fix: ["Check the lookup: a wrong `lookup.code`/`variantTags` usually shows up here first.", "No escape hatch exists for this — the ref is probably pointing at the wrong product."],
    });
  }

  // --- prices ---------------------------------------------------------
  console.log("\nPRICE (Western)");
  console.log(`${card.currentPrice ? OK : NO}current price: ${card.currentPrice ? `${card.currency} ${card.currentPrice}` : "none"}`);
  console.log(`${card.tcgplayer ? OK : NO}TCGplayer spread${card.tcgplayer?.variant ? ` (${card.tcgplayer.variant})` : ""}`);
  console.log(`${card.priceHistory.length ? OK : NO}price history: ${card.priceHistory.length} point(s)`);
  if (!card.priceHistory.length) {
    gaps.push({
      what: "no price history",
      fix: ["History is apitcg-only and needs `lookup.code` to match its catalogue.", "Often an exhausted api budget rather than a missing card — check scripts/api-budget-report.mjs before changing the ref."],
    });
  }

  // --- cardmarket, western --------------------------------------------
  const cm = card.cardmarket;
  const pinnedEn = ref.berryWalletCardmarketId?.en;
  const linkEn = ref.cardmarketProductUrl?.western;
  console.log("\nCARDMARKET (Western)");
  console.log(`${cm ? OK : NO}block: ${product(cm?.url)}`);
  console.log(`       figures: ${cm?.trend != null ? `trend €${cm.trend}` : "none"}`);
  if (pinnedEn) console.log(`       PINNED to BerryWallet row ${pinnedEn} — see below for whether that is still needed`);
  if (linkEn) console.log(`       LINK-ONLY pin (${product(linkEn)}) — no figures by design`);
  if (!cm) {
    gaps.push({
      what: "no Western Cardmarket block",
      fix: [
        "1. Confirm the product really exists on cardmarket.com. If it doesn't, this is not a gap.",
        "2. Look for a row sharing this card's TCGplayer product — the derivation already does this (findCardmarketSiblings); if one exists and is being missed, fix the rule, don't pin.",
        "3. If a row exists but nothing links it: `berryWalletCardmarketId.en`.",
        "4. If no row exists anywhere: `cardmarketProductUrl.western` (link only).",
      ],
    });
  }

  // --- japanese --------------------------------------------------------
  const ja =
    ref.franchise === "one-piece"
      ? ref.berryWalletEnabled
        ? await getOnePieceJapaneseText(card, ref)
        : undefined
      : ref.pokeWalletCardId
        ? await getJapaneseCardText(card, ref)
        : undefined;
  const pinnedJp = ref.berryWalletCardmarketId?.jp;
  const linkJp = ref.cardmarketProductUrl?.japanese;
  console.log("\nJAPANESE");
  if (!ja) {
    console.log(`${NO}not enabled for this ref (no berryWalletEnabled / pokeWalletCardId)`);
  } else {
    console.log(`${ja.translated ? OK : NO}identity: ${ja.translated ? `${ja.printName ?? ja.name} — ${ja.set}` : "not found — JP toggle renders inert"}`);
    console.log(`${ja.cardmarket ? OK : NO}cardmarket: ${product(ja.cardmarket?.url)}`);
    if (pinnedJp) console.log(`       PINNED to BerryWallet row ${pinnedJp}`);
    if (linkJp) console.log(`       LINK-ONLY pin (${product(linkJp)}) — no figures by design`);
  }
  if (ja && !ja.translated) {
    gaps.push({
      what: "no Japanese identity — the JP toggle stays inert",
      fix: [
        "Confirm a Japanese print exists at all before treating this as a bug.",
        ref.franchise === "one-piece"
          ? "One Piece: a real `berryWalletSetCode.jp` makes the lookup one call instead of a bounded walk, and is worth adding when the set is known."
          : "Pokémon: `pokeWalletCardId` is exactly this escape hatch — find it by hand (see the field's own doc comment).",
        "There is deliberately NO override for identity text. Nothing on the page may be hand-typed prose; an inert toggle is the honest state.",
      ],
    });
  }
  if (ja?.translated && !ja.cardmarket) {
    gaps.push({
      what: "Japanese identity resolved but no Japanese Cardmarket product",
      fix: [
        "Often correct: Cardmarket may genuinely list no Japanese product for this print. The page falls back to the Western block, which the panel labels for what it is.",
        "If the product does exist: `berryWalletCardmarketId.jp`, or `cardmarketProductUrl.japanese` when no row carries it.",
      ],
    });
  }

  // --- french ----------------------------------------------------------
  const fr = await getFrenchCardText(card);
  console.log("\nFRENCH");
  console.log(`${fr.translated ? OK : NO}identity: ${fr.translated ? `${fr.name} — ${fr.set}` : "not found — FR toggle renders inert"}`);
  if (!fr.translated && ref.franchise === "one-piece") {
    console.log("       expected: BerryWallet has zero French sets, so One Piece FR is always inert.");
  }

  // --- verdict ---------------------------------------------------------
  console.log(`\nGAPS: ${gaps.length === 0 ? "none — this card needs no escape hatch" : gaps.length}`);
  for (const gap of gaps) {
    console.log(`\n  • ${gap.what}`);
    for (const line of gap.fix) console.log(`      ${line}`);
  }
  console.log();
  return 0;
}

async function main() {
  if (args[0] === "--all") {
    const { cardRefs } = await import("../src/data/card-refs");
    let failed = 0;
    for (const ref of cardRefs) failed += await auditOne(ref.slug);
    process.exit(failed > 0 ? 1 : 0);
  }
  process.exit(await auditOne(args[0]));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
