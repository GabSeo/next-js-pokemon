import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The optcgapi mirror — what a One Piece promo is CALLED, and what it is worth.
 *
 * WHY IT EXISTS ALONGSIDE punk-records. punk-records mirrors Bandai's own card
 * list, which is authoritative about what was printed and silent about what
 * collectors call it: 349 codes arrive filed under "Promotion card", so three
 * physically different P-033 Luffys are one anonymous row. Those are the cards
 * people actually search for.
 *
 * Measured 2026-09-07:
 *
 *   1,082 promo records across 222 distinct named products
 *   65 promo codes named nowhere else we hold
 *   17 codes punk-records does not list in English at all
 *   5,362 rows carrying a price, keyed by CARD CODE rather than a vendor row id
 *
 * That last point is the one that changes what is possible. Our other One Piece
 * prices are keyed on opaque BerryWallet row ids, which makes "what has OP05-119
 * been worth" unanswerable. `card_set_id` is the code.
 *
 * WHAT THIS IS NOT. It is not the identity source — punk-records stays
 * authoritative for what a card is, in three languages — and it is not the
 * image source. optcgapi carries images for 944 of 1,082 promos and hosts them
 * itself; Bandai serves all of them, unmetered, and we already proxy that.
 *
 * ATTRIBUTION, and it matters: optcgapi is an independent project that scrapes
 * Bandai's published data. It is not affiliated with Bandai, and neither is
 * punk-records. Calling either "official" overstates the relationship — the
 * DATA originates with Bandai, the mirrors do not.
 *
 * TIER 1: reads files written by scripts/one-piece-optcg-crawl.mts and imports
 * `node:fs` and nothing else. It cannot reach a network and holds no live
 * prices — the prices here are as of the crawl, like every other catalogue in
 * this project.
 */

const DIR = path.join(process.cwd(), "data", "catalog", "one-piece-optcg");

/** The three bulk endpoints, mirrored as three files. */
const FILES = ["sets", "decks", "promos"] as const;

export type OptcgRow = {
  /** The card code — `OP01-001`, `P-033`. optcgapi's `card_set_id`. */
  code: string;
  /** Carries the product in parentheses: `Monkey.D.Luffy (Event Pack Vol. 2)`. */
  name: string;
  setName: string;
  setId: string;
  rarity?: string;
  imageId?: string;
  image?: string;
  /** USD. As of the crawl, never live. */
  market?: number;
  inventory?: number;
};

type Loaded = { rows: OptcgRow[]; byCode: Map<string, OptcgRow[]>; crawledAt?: string };

let cache: Loaded | undefined;

function load(): Loaded {
  if (cache) return cache;

  const rows: OptcgRow[] = [];
  let crawledAt: string | undefined;

  for (const name of FILES) {
    const file = path.join(DIR, `${name}.json`);
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { crawledAt?: string; rows?: OptcgRow[] };
      crawledAt ??= parsed.crawledAt;
      for (const row of parsed.rows ?? []) if (row.code) rows.push(row);
    } catch {
      // A corrupt or half-written file behaves as an absent one: every caller
      // treats this source as optional.
    }
  }

  const byCode = new Map<string, OptcgRow[]>();
  for (const row of rows) byCode.set(row.code, [...(byCode.get(row.code) ?? []), row]);

  cache = { rows, byCode, crawledAt };
  return cache;
}

export function optcgRowsForCode(code: string): OptcgRow[] {
  return load().byCode.get(code) ?? [];
}

/**
 * The parenthetical a row ends with, or undefined when there is none.
 *
 * Deciding whether that parenthetical is a PRODUCT is not this module's job —
 * `lib/one-piece-variants.ts` already carries a treatment table measured
 * against live eBay listings, and duplicating it here produced exactly the bug
 * that table exists to prevent: `Wanted Poster`, `SP` and `Gold` were admitted
 * as products and appended to OP05-119 as four extra printings, on top of the
 * nine Bandai already lists with their own artwork.
 */
export function optcgParenthetical(name: string): string | undefined {
  const match = name.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : undefined;
}

export function optcgStats(): { rows: number; codes: number; priced: number; crawledAt?: string } {
  const { rows, byCode, crawledAt } = load();
  return {
    rows: rows.length,
    codes: byCode.size,
    priced: rows.filter((r) => typeof r.market === "number").length,
    crawledAt,
  };
}
