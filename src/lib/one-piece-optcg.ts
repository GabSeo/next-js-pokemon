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

/** Built on first use, and only for callers that ask the question backwards. */
let byPicture: Map<string, string> | undefined;

/**
 * WHICH CARD a picture belongs to — `pictureKey` run in reverse.
 *
 * The artwork matcher indexes One Piece by PICTURE, because every One Piece
 * printing has its own and that is the most precise thing it can name. But a
 * picture key is a filename: `Monkey.D.Luffy_-_ST21-014_3rd_Anniversary…`. It
 * addresses nothing. `getCardView` wants the card code that owns the picture,
 * and asked with a filename it silently returns nothing — a match that found
 * the right card and then lost it on the way to the screen.
 *
 * The code is visible inside most of those filenames and reading it out with a
 * pattern would work most of the time, which is the problem: optcgapi names its
 * files however it likes, and "most of the time" here means occasionally
 * showing someone a different card. This is the same join the repatriation runs
 * on, in the other direction, so it is right by construction rather than by
 * resemblance.
 */
export function codeForPicture(key: string): string | undefined {
  if (!byPicture) {
    byPicture = new Map();
    for (const row of load().rows) {
      if (!row.image) continue;
      const picture = pictureKey(row.image);
      // FIRST WRITER WINS. 5,223 URLs give 5,223 keys with zero collisions, so
      // a repeat here means two rows share one picture — and they share a card
      // code too, since that is what sharing a picture means.
      if (!byPicture.has(picture)) byPicture.set(picture, row.code);
    }
  }
  return byPicture.get(key);
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
/**
 * A stable name for the PICTURE a row points at — the identity that actually
 * matters, and the one this catalogue got wrong for a week.
 *
 * `card_image_id` names a FILE, not a printing, and optcgapi reuses it. Measured
 * 2026-09-07: 857 rows share a `card_image_id` with a sibling, and **every one
 * of those 857 carries a different `card_image` URL**. So two genuinely
 * different products arrive under one id, each with its own artwork sitting
 * right there:
 *
 *   ST21-014  base                  ->  ST21-014.jpg
 *   ST21-014  3rd Anniversary Pack  ->  Monkey.D.Luffy_-_ST21-014_3rd_Anni…jpg
 *   OP09-061  Jumbo                 ->  Monkey.D.Luffy_Jumbo_img.jpg
 *
 * Keying repatriation on the id therefore skipped 963 real pictures as
 * "Bandai already has it", and the card page showed the base artwork for
 * printings that look nothing like it — which is worse than showing nothing,
 * because it answers the question wrongly instead of admitting it cannot.
 *
 * The URL's basename is optcgapi's own name for a picture and is unique across
 * their corpus: 5,223 URLs, 5,223 keys, zero collisions. Two rows that share a
 * picture share a key, which is the dedupe we want rather than a clash.
 */
export function pictureKey(imageUrl: string): string {
  const base = imageUrl.split("/").pop()?.replace(/\.[a-z]+$/i, "") ?? "";
  return base.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 110);
}

/**
 * Whether that picture is simply Bandai's own file for this printing, mirrored.
 *
 * When it is, the printing is one Bandai already serves: unmetered, higher
 * resolution, and nothing to repatriate. The trailing token guard is for
 * optcgapi's occasional re-upload suffix (`OP01-033_p5_8AI2ZwU`).
 */
export function isBandaiPicture(imageUrl: string, imageId?: string): boolean {
  if (!imageId) return false;
  return pictureKey(imageUrl).replace(/_[A-Za-z0-9]{6,}$/, "") === imageId;
}

export function optcgParenthetical(name: string): string | undefined {
  const match = name.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : undefined;
}

/**
 * The Bandai printing that shows the same picture as this mirror printing, if
 * one does.
 *
 * The two sources suffix a card code differently — `_p2` against `_pr1` — so
 * 201 codes carry ids in both namespaces with no key to join them on. Artwork
 * joins them instead: scripts/one-piece-print-aliases.mts hashes both sides
 * offline and pairs what looks identical, at a threshold measured against 3,000
 * unrelated pairs.
 *
 * A pair means SAME PICTURE, not same product. An Online Regional Participation
 * Pack and its Finalist counterpart differ by a stamp no 64-bit hash will see.
 * So callers may use this to retire an ANONYMOUS listing in favour of a named
 * one, and never to merge two products that both have names.
 */
export function printAlias(printingId: string): string | undefined {
  return aliases().get(printingId);
}

let aliasCache: Map<string, string> | undefined;

function aliases(): Map<string, string> {
  if (aliasCache) return aliasCache;
  aliasCache = new Map();
  const file = path.join(process.cwd(), "data", "catalog", "one-piece-art", "aliases.json");
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { pairs?: Record<string, string> };
      for (const [from, to] of Object.entries(parsed.pairs ?? {})) aliasCache.set(from, to);
    }
  } catch {
    // Absent or unreadable: the merge simply lists both printings, which is the
    // behaviour before this file existed — verbose rather than wrong.
  }
  return aliasCache;
}

/**
 * What the printings of one code have sold for, low to high.
 *
 * USD, from optcgapi's mirror of TCGplayer, as of the crawl — never live. One
 * number for a code would be the thing this project keeps refusing to print:
 * OP05-119 spans roughly 200x across its printings, so a single figure answers
 * a question nobody asked. The RANGE is honest, and the per-printing figures on
 * the card page are where the actual answer is.
 */
export function optcgPriceRange(code: string): { low: number; high: number; priced: number } | undefined {
  const values = optcgRowsForCode(code)
    .map((row) => row.market)
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return undefined;
  return { low: values[0], high: values[values.length - 1], priced: values.length };
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
