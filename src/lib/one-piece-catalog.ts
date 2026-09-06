/**
 * TIER 1 for One Piece — the offline catalogue crawled by
 * scripts/one-piece-crawl.mts.
 *
 * Same discipline as lib/catalog.ts and for the same reasons: this file imports
 * `node:fs` and `node:path` and nothing else, so it cannot reach BerryWallet,
 * apitcg, PokéWallet or eBay, and cannot spend quota by mistake. It holds no
 * prices — those live in `data/prices/one-piece.json`.
 *
 * WHY IT EXISTS AT ALL, beyond speed. One Piece's hard problem is that a card
 * CODE is an identity, not a printing: 1,084 of 2,865 codes (37.8%, measured)
 * carry more than one treatment, and OP05-119 alone spans plain / Alternate Art
 * / Manga / SP / SP Gold / Reprint / Wanted Poster across five sets at EUR 4.49
 * to EUR 7,500. Answering "what else shares this code" used to cost a metered
 * `searchCards` call per card against a 100/hour ceiling. It is now a map
 * lookup, which is what makes deriving an eBay query affordable at all.
 *
 * It also stores each row WITH its set, which `BerryWalletCard` does not carry.
 * `findVariantAcrossProducts` reports the set of ORIGIN for a cross-product
 * match, which is why a PRB-01 reprint could not name itself "PRB" — here it
 * can.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CATALOG_DIR = path.join(process.cwd(), "data", "catalog", "one-piece");

export type OpLanguage = "en" | "jp";

/** One printing, as crawled. No prices — see this file's header. */
export type OpCard = {
  id: string;
  cardNumber: string;
  /** BerryWallet's raw product name. The treatment lives in its parentheticals. */
  name: string;
  rarity?: string;
  /** The `(V.N)` index when present. A PER-SET index, never an identifier — see pickVariantForJapanese. */
  variantIndex?: number;
  cardmarketUrl?: string;
  cardmarketProductName?: string;
  /** Rows sharing a TCGplayer product are the same physical card — the join findCardmarketSiblings uses. */
  tcgplayerUrl?: string;
};

export type OpSet = { code: string; name: string };
export type OpEntry = { card: OpCard; set: OpSet; language: OpLanguage };

type OpSetFile = { crawledAt: string; language: OpLanguage; set: OpSet; cards: OpCard[] };

type Loaded = {
  entries: OpEntry[];
  /** Every row sharing a card code, in both languages. The lookup the whole module exists for. */
  byCode: Map<string, OpEntry[]>;
  byId: Map<string, OpEntry>;
  sets: OpSet[];
  crawledAt?: string;
};

let cache: Loaded | undefined;

/**
 * A row's card code.
 *
 * `cardNumber` is a HINT, not a key — whole sets carry null for it (all 300
 * rows of CM-UNNUMBERED-JP), holding the code only inside `name` as
 * `Monkey.D.Luffy (ST21-014) (V.1)`. So the name is parsed as a fallback, the
 * same way findCardInLanguage matches on `card_number === code || name.includes(code)`.
 */
function codeOf(card: OpCard): string | undefined {
  if (card.cardNumber) return card.cardNumber;
  return card.name.match(/\b([A-Z]{1,4}\d{2}-\d{3}|P-\d{3})\b/)?.[1];
}

function loadCatalog(): Loaded {
  if (cache) return cache;

  const entries: OpEntry[] = [];
  const byCode = new Map<string, OpEntry[]>();
  const byId = new Map<string, OpEntry>();
  const sets: OpSet[] = [];
  let crawledAt: string | undefined;

  if (!existsSync(CATALOG_DIR)) {
    // An absent corpus is an empty catalogue, not a crash — same degradation
    // rule lib/catalog.ts follows for a checkout that has not crawled yet.
    cache = { entries, byCode, byId, sets };
    return cache;
  }

  for (const file of readdirSync(CATALOG_DIR)) {
    if (!file.endsWith(".json")) continue;
    let parsed: OpSetFile;
    try {
      parsed = JSON.parse(readFileSync(path.join(CATALOG_DIR, file), "utf8")) as OpSetFile;
    } catch {
      continue;
    }
    sets.push(parsed.set);
    if (!crawledAt || parsed.crawledAt < crawledAt) crawledAt = parsed.crawledAt;

    for (const card of parsed.cards) {
      const entry: OpEntry = { card, set: parsed.set, language: parsed.language };
      entries.push(entry);
      byId.set(card.id, entry);
      const code = codeOf(card);
      if (!code) continue;
      const list = byCode.get(code);
      if (list) list.push(entry);
      else byCode.set(code, [entry]);
    }
  }

  cache = { entries, byCode, byId, sets, crawledAt };
  return cache;
}

/** Every row sharing this card code, both languages. The competing-print list, for free. */
export function opRowsForCode(code: string): OpEntry[] {
  return loadCatalog().byCode.get(code) ?? [];
}

export function opRowById(id: string): OpEntry | undefined {
  return loadCatalog().byId.get(id);
}

export function opCatalogStats(): { sets: number; rows: number; codes: number; crawledAt?: string } {
  const { sets, entries, byCode, crawledAt } = loadCatalog();
  return { sets: sets.length, rows: entries.length, codes: byCode.size, crawledAt };
}

/**
 * The TREATMENT a row's name describes — "Alternate Art", "Manga", "SP",
 * "Wanted Poster" — or "" for a plain print.
 *
 * The last meaningful parenthetical, matching printDescriptor's rule
 * (lib/ebay-search.ts), with two exclusions: a bare card code (`(119)`,
 * `(OP05-119)`) is not a treatment, and neither is a `(V.N)` index, which is a
 * per-set position rather than a description of the card.
 */
export function opTreatment(name: string): string {
  const inner = [...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  const meaningful = inner.filter((v) => !/^[A-Z]{0,4}\d*-?\d+$/i.test(v) && !/^V\.\d+$/i.test(v));
  return (meaningful[meaningful.length - 1] ?? "").replace(/^(english|japanese)\s+version\s+/i, "").trim();
}

/**
 * The product family a set belongs to, in the vocabulary sellers use: `PRB-01`
 * -> `PRB`, `OP05` -> `OP05`, `ST-21` -> `ST`.
 *
 * This is the token that could not be derived before the corpus existed. A
 * cross-product match reports the set of ORIGIN (OP05 for a PRB-01 reprint),
 * so nothing in the resolved card said "PRB" — the corpus stores the real
 * containing set and this reads it.
 */
export function opSetFamily(setCode: string): string {
  return setCode.split(/[-\s]/)[0].toUpperCase();
}
