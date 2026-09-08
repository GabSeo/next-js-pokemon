#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Fill the Japanese sets TCGdex declares and does not deliver.
 *
 * THE GAP, measured 2026-09-09. TCGdex's Japanese set list advertises card
 * counts it then does not serve: 69 sets hold fewer cards than they declare and
 * 68 of those hold NONE at all. 5,250 Japanese cards are missing this way —
 * whole sets that exist, are numbered, and return an empty `cards` array.
 *
 *   CP3   0 of 32     CP4   0 of 131    CP5   0 of 36
 *   ADV1  0 of 55     ADV2  0 of 53     ADV3  0 of 54
 *
 * This is the same upstream behaviour already documented for four English sets
 * (`wp`, `jumbo`, `sp`, `rc`), at 17x the scale.
 *
 * WHAT FIXES IT, and it costs no new source: the official Japanese data we
 * already mirror covers 308 sets against TCGdex's 184, and holds 1,901 of the
 * missing cards. It is keyed by `(set, number)` — the identity actually printed
 * on the card — so the join is exact rather than inferred.
 *
 * WHAT THIS WRITES. Missing cards are appended to the TCGdex set files with
 * `source: "official-jp"` on each, so a reader can always tell which cards came
 * from where and a re-crawl can replace them. Nothing existing is overwritten:
 * where TCGdex delivered a card, TCGdex wins.
 *
 * NO IMAGE FIELD IS SET, deliberately. `lib/card-view.ts` already falls back to
 * `japaneseImageUrl` for a Japanese card with no TCGdex image, and that reads
 * the same official index — so the picture resolves through the path that
 * already exists rather than a second one.
 *
 * IT ALSO CREATES THE SETS TCGdex DOES NOT KNOW AT ALL, which is the larger
 * half. TCGdex publishes 184 Japanese sets; the official mirror covers 308.
 * The 197 it does not list hold 8,891 cards and EVERY ONE OF THEM HAS AN IMAGE
 * — 20th, BKR, BGS, the BW-era decks, a long tail of campaign sets. Our set
 * list was simply the narrowest of the sources we hold.
 *
 * A created set is named by its CODE, because that is all the mirror gives and
 * it is what Japanese sets already display (`SV4a (JP)`). Its declared size is
 * the largest `set_total` its cards report.
 *
 * WHAT IT DOES NOT FIX: sets neither source carries, ADV1-ADV5 among them.
 * Nothing free reaches those today.
 *
 *   npm run catalog:pokemon-ja-fill
 *   npx tsx scripts/pokemon-ja-fill.mts --dry-run
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CATALOG_DIR = path.join(process.cwd(), "data", "catalog", "pokemon-ja");
const OFFICIAL = path.join(process.cwd(), "data", "catalog", "pokemon-ja-official", "index.json");

const dryRun = process.argv.includes("--dry-run");

type OfficialCard = { jpId: string; name: string; en?: string; img: string; fp?: { dex?: number } };
type CatalogCard = {
  tcgdexId: string;
  localId: string;
  name: string;
  dexId?: number;
  category?: string;
  variants: unknown[];
  source?: string;
};
type SetFile = { crawledAt: string; source: string; set: { id: string; cardCount?: { official?: number } }; cards: CatalogCard[] };

if (!existsSync(OFFICIAL)) {
  console.error("[fill] no official Japanese index — run npm run catalog:pokemon-ja-official first.");
  process.exit(1);
}

const official = JSON.parse(readFileSync(OFFICIAL, "utf8")).cards as Record<string, OfficialCard>;

/** `SV4a#1` -> `["SV4a", "1"]`. The number is already an integer in that key. */
const bySet = new Map<string, { number: string; card: OfficialCard }[]>();
for (const [key, card] of Object.entries(official)) {
  const hash = key.lastIndexOf("#");
  if (hash <= 0) continue;
  const set = key.slice(0, hash);
  bySet.set(set, [...(bySet.get(set) ?? []), { number: key.slice(hash + 1), card }]);
}

let filesTouched = 0;
let added = 0;
let created = 0;
let stillMissing = 0;
const report: string[] = [];

/** One card, in the shape lib/catalog.ts reads. */
function toCatalogCard(setId: string, number: string, card: OfficialCard): CatalogCard {
  // Zero-padded to three, matching how TCGdex writes Japanese numbers, so every
  // downstream comparison sees one convention.
  const localId = /^\d+$/.test(number) ? number.padStart(3, "0") : number;
  return {
    tcgdexId: `${setId}-${localId}`,
    localId,
    name: card.name,
    dexId: card.fp?.dex,
    category: card.fp?.dex === undefined ? "Trainer" : "Pokemon",
    variants: [],
    source: "official-jp",
  };
}

for (const file of readdirSync(CATALOG_DIR)) {
  if (!file.endsWith(".json") || file === "_sets.json") continue;

  const full = path.join(CATALOG_DIR, file);
  let parsed: SetFile;
  try {
    parsed = JSON.parse(readFileSync(full, "utf8")) as SetFile;
  } catch {
    continue;
  }

  const declared = parsed.set.cardCount?.official;
  if (!declared || parsed.cards.length >= declared) continue;

  const candidates = bySet.get(parsed.set.id) ?? [];
  if (candidates.length === 0) {
    stillMissing += declared - parsed.cards.length;
    continue;
  }

  // Compare on the NUMBER as an integer: TCGdex pads (`048`) and the official
  // key does not, and one of the two would otherwise look like a new card.
  const have = new Set(parsed.cards.map((c) => Number(c.localId)).filter((n) => Number.isFinite(n)));
  const missing = candidates.filter(({ number }) => !have.has(Number(number)));
  if (missing.length === 0) continue;

  for (const { number, card } of missing) {
    parsed.cards.push(toCatalogCard(parsed.set.id, number, card));
    added++;
  }

  parsed.cards.sort((a, b) => Number(a.localId) - Number(b.localId) || a.localId.localeCompare(b.localId));
  const short = declared - parsed.cards.length;
  if (short > 0) stillMissing += short;

  report.push(
    `${parsed.set.id.padEnd(8)} +${String(missing.length).padStart(3)} -> ${parsed.cards.length}/${declared}`
  );
  filesTouched++;

  if (!dryRun) writeFileSync(full, JSON.stringify(parsed));
}

// --- sets TCGdex does not list at all -------------------------------------

const known = new Set(
  readdirSync(CATALOG_DIR)
    .filter((f) => f.endsWith(".json") && f !== "_sets.json")
    .map((f) => {
      try {
        return (JSON.parse(readFileSync(path.join(CATALOG_DIR, f), "utf8")) as SetFile).set.id;
      } catch {
        return "";
      }
    })
);

for (const [setId, cards] of bySet) {
  if (known.has(setId)) continue;

  // The declared size is the largest total its own cards report — the mirror
  // records it per card rather than per set.
  const declared = Math.max(...cards.map(({ card }) => Number((card as { total?: number }).total ?? 0)), cards.length);

  const file: SetFile = {
    crawledAt: new Date().toISOString(),
    source: "official-jp",
    set: { id: setId, cardCount: { official: declared } },
    cards: cards
      .map(({ number, card }) => toCatalogCard(setId, number, card))
      .sort((a, b) => Number(a.localId) - Number(b.localId) || a.localId.localeCompare(b.localId)),
  };

  // `name` is the code: it is all the mirror gives, and Japanese sets already
  // display their code rather than their title.
  (file.set as { id: string; name?: string }).name = setId;

  added += file.cards.length;
  created++;
  if (!dryRun) writeFileSync(path.join(CATALOG_DIR, `${encodeURIComponent(setId)}.json`), JSON.stringify(file));
}

for (const line of report.slice(0, 15)) console.log("   " + line);
if (report.length > 15) console.log(`   … and ${report.length - 15} more sets`);
console.log(
  `
[fill] ${dryRun ? "would add" : "added"} ${added} cards — ` +
    `${filesTouched} sets filled in, ${created} sets created from scratch; ` +
    `${stillMissing} still missing, in sets neither source carries`
);
