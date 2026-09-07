import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Japanese card data the official site publishes — the picture and the NAME.
 *
 * WHY IT EXISTS BESIDE TCGdex. TCGdex's Japanese catalogue is thin exactly
 * where a scan needs it. Measured 2026-09-08 across our 12,781 Japanese cards:
 * only 3,882 (30%) carry an image, against 92% on the English side, and every
 * Japanese card name is stored romanised — `Gengar Ex`, never `ゲンガーex`.
 *
 * Both gaps break the same thing. A printing with no picture cannot be ranked
 * by artwork; a card whose name we hold only in Latin cannot be matched to the
 * text Vision reads off a Japanese face. That left the printed number as the
 * only handle, and the printed number names several cards — `048/082` is a
 * Japanese Gengar ex and it is also Team Rocket Porygon.
 *
 * This fills 4,569 of the 8,899 missing images and names all 19,640 records in
 * Japanese. It is not a supplement to TCGdex's CDN: sampled 150 of the cards it
 * does NOT cover, zero were available there either.
 *
 * STILL MISSING AFTERWARDS: 4,330 cards, in the MEGA era (1,785), PCG (722),
 * Pokemon-e (492), the 1996 originals (457) and neo (323). The official site's
 * own search does not reach that far back, so no mirror of it can.
 *
 * NOT A DISPLAY SOURCE. Nothing here is rendered. Japanese cards are catalogued
 * so a scan can RECOGNISE what somebody is holding; what they are then shown,
 * track and price is the English print, which is the one with a market behind
 * it. The `img` URL is recorded because it is part of the record and will
 * matter when artwork matching lands — not because a page may point at it.
 *
 * ATTRIBUTION: the data originates with The Pokemon Company's official Japanese
 * card search. type-null/PTCG-database (MIT) mirrors it and is not affiliated
 * with them — the same distinction this project keeps for punk-records and
 * optcgapi against Bandai.
 *
 * TIER 1: reads one file written by scripts/pokemon-ja-official-crawl.mts and
 * imports `node:fs` and nothing else, so it cannot spend quota.
 */

const FILE = path.join(process.cwd(), "data", "catalog", "pokemon-ja-official", "index.json");

export type JapaneseOfficialCard = {
  /** The official site's internal card id. */
  jpId: string;
  /** The name as printed — in Japanese. */
  name: string;
  /** A URL on pokemon-card.com. Recorded, never rendered — see this file's header. */
  img: string;
  total?: number;
  url?: string;
  /**
   * The part of the card that does not change with the language: Pokedex
   * number, HP, stage, types, retreat, and each attack as `cost:damage`.
   *
   * This is the vocabulary a Japanese card will be matched to its English
   * print in — attack NAMES differ across languages, their cost and damage do
   * not. 15,298 of 19,640 records carry one. Nothing reads it yet: the
   * matching is the next piece of work and will be checked against a paid API
   * rather than guessed. See scripts/pokemon-ja-official-crawl.mts.
   */
  fp?: {
    dex?: number;
    hp?: number;
    stage?: string;
    types?: string[];
    retreat?: number;
    attacks?: string[];
  };
};

type Loaded = { cards: Map<string, JapaneseOfficialCard>; crawledAt?: string };

let cache: Loaded | undefined;

function load(): Loaded {
  if (cache) return cache;
  const cards = new Map<string, JapaneseOfficialCard>();
  let crawledAt: string | undefined;
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as {
        crawledAt?: string;
        cards?: Record<string, JapaneseOfficialCard>;
      };
      crawledAt = parsed.crawledAt;
      for (const [key, card] of Object.entries(parsed.cards ?? {})) cards.set(key, card);
    }
  } catch {
    // Absent or unreadable behaves as absent: every caller treats this source
    // as optional and falls back to what TCGdex gave us.
  }
  cache = { cards, crawledAt };
  return cache;
}

/**
 * The key both catalogues can answer: set id plus card number as an integer.
 *
 * TCGdex stores `48` on the English side and `048` on the Japanese one, and the
 * official data is padded too. Comparing the strings finds nothing across that
 * boundary, so the number is always reduced — the same rule card-lookup.ts
 * applies for the same reason.
 */
export function japaneseKey(setId: string, localId: string): string {
  const digits = String(localId).replace(/^0+/, "") || "0";
  return /^\d+$/.test(String(localId)) ? `${setId}#${Number(digits)}` : `${setId}#${localId}`;
}

export function japaneseOfficialCard(setId: string, localId: string): JapaneseOfficialCard | undefined {
  return load().cards.get(japaneseKey(setId, localId));
}

export function japaneseOfficialStats(): { cards: number; crawledAt?: string } {
  const { cards, crawledAt } = load();
  return { cards: cards.size, crawledAt };
}

/** The name as printed on the card, in Japanese, when the official data has it. */
export function japaneseName(setId: string, localId: string): string | undefined {
  return japaneseOfficialCard(setId, localId)?.name;
}

/**
 * Japanese cards whose printed name contains `text` — the lookup the catalogue
 * itself cannot answer.
 *
 * TCGdex romanises every Japanese name, so `searchCatalogCards` indexes
 * `Gengar Ex` and never `ゲンガーex`. That is precisely the string Vision reads
 * off a Japanese card face, so without this the only handle on a Japanese card
 * is its printed number — and that number names several cards.
 *
 * Returns `setId#number` keys; the caller joins them back to its own entries.
 * A substring match, because a card face carries the name among other text and
 * OCR clips edges.
 */
export function searchJapaneseNames(text: string, limit = 30): string[] {
  const needle = text.trim();
  if (needle.length === 0) return [];
  const out: string[] = [];
  for (const [key, card] of load().cards) {
    if (!card.name.includes(needle)) continue;
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

/** Every official Japanese record, keyed by `setId#number`. For building an index once. */
export function japaneseOfficialCards(): Map<string, JapaneseOfficialCard> {
  return load().cards;
}
