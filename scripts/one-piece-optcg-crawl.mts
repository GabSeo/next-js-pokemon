#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Mirror optcgapi's One Piece catalogue into data/catalog/one-piece-optcg/.
 *
 * WHY A THIRD SOURCE. punk-records mirrors Bandai's own card list, which is
 * authoritative about what Bandai printed and useless about what collectors
 * call it: 349 codes arrive filed under "Promotion card", so three physically
 * different P-033 Luffys are one anonymous row. Those are exactly the cards
 * people search for.
 *
 * optcgapi names them. Measured 2026-09-07 against our data:
 *
 *   1,082 promo records across 222 distinct named products
 *   495 promo codes, of which 65 are named nowhere else we hold
 *   17 codes punk-records does not list in English at all
 *   5,187 of 5,362 records carry a market price, keyed by CARD CODE
 *
 * That last one matters more than it looks. Our existing One Piece prices are
 * keyed on opaque BerryWallet row ids, so the question "what has OP05-119 been
 * worth" is unanswerable. optcgapi keys on `card_set_id`, which is the code.
 *
 * THREE REQUESTS, NOT THOUSANDS. The whole catalogue comes from three bulk
 * endpoints. optcgapi is one person's donation-supported project and the
 * per-card endpoints would mean hundreds of calls; these three are the polite
 * way to take the same data, and this script never uses anything else.
 *
 * NOT AN IDENTITY SOURCE. punk-records stays authoritative for what a card IS
 * and Bandai stays the source of images. This adds the two things neither
 * provides: what a promo product is CALLED, and what a card is worth.
 *
 *   npm run catalog:one-piece-optcg
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "data", "catalog", "one-piece-optcg");
const BASE = "https://www.optcgapi.com/api";

/** The three bulk endpoints, and nothing else. See this file's header. */
const SOURCES = [
  { name: "sets", url: `${BASE}/allSetCards/` },
  { name: "decks", url: `${BASE}/allSTCards/` },
  { name: "promos", url: `${BASE}/allPromos/` },
];

/** Only the fields we actually use, so a schema change upstream is visible rather than silently carried. */
type OptcgRecord = {
  card_set_id?: string;
  card_name?: string;
  set_name?: string;
  set_id?: string;
  rarity?: string;
  card_image_id?: string;
  card_image?: string | null;
  market_price?: number | null;
  inventory_price?: number | null;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return (await response.json()) as T;
}

const started = Date.now();
mkdirSync(OUT_DIR, { recursive: true });

let total = 0;
let priced = 0;
const codes = new Set<string>();

for (const source of SOURCES) {
  const rows = await getJson<OptcgRecord[]>(source.url);

  const kept = rows
    .filter((row) => typeof row.card_set_id === "string")
    .map((row) => ({
      code: row.card_set_id!,
      name: row.card_name ?? "",
      setName: row.set_name ?? "",
      setId: row.set_id ?? "",
      rarity: row.rarity ?? undefined,
      imageId: row.card_image_id ?? undefined,
      image: row.card_image ?? undefined,
      market: typeof row.market_price === "number" ? row.market_price : undefined,
      inventory: typeof row.inventory_price === "number" ? row.inventory_price : undefined,
    }));

  for (const row of kept) {
    codes.add(row.code);
    if (row.market !== undefined) priced++;
  }
  total += kept.length;

  writeFileSync(
    path.join(OUT_DIR, `${source.name}.json`),
    JSON.stringify({ crawledAt: new Date().toISOString(), source: source.url, rows: kept })
  );
  console.log(`[optcg] ${source.name.padEnd(7)} ${kept.length} rows`);
}

console.log(
  `[optcg] done in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
    `${total} rows, ${priced} priced, ${codes.size} distinct codes, 3 requests`
);
