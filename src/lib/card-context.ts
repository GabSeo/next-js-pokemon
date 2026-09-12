import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { getCatalogCard, getCatalogSetCards } from "@/lib/catalog";
import { getCatalogPriceValues } from "@/lib/catalog-prices";

/**
 * Everything ELSE we know about a card, for the explainer to reason from.
 *
 * WHY THIS EXISTS, AND IT IS A QUOTA ARGUMENT RATHER THAN A PRODUCT ONE. The
 * free tier's binding limit is REQUESTS per minute, not tokens — five requests
 * against a 250,000-token minute. A fact sheet of 445 tokens therefore used
 * 0.2% of the room available to it, and the way to a better answer was never to
 * ask for more words out; it was to put more in.
 *
 * WHAT IS NOT DONE WITH THAT ROOM. Padding. Fifty thousand tokens of headroom
 * is not a reason to invent context — a sheet stuffed with filler produces a
 * worse answer than a short true one, and every field here is something we
 * measured and hold on disk. The honest total is closer to a thousand tokens
 * than fifty thousand, and that is the right number rather than a shortfall.
 *
 * WHAT IS DELIBERATELY ABSENT: the Japanese twin. The Limitless bridge maps SET
 * to SET, not card to card, so naming a specific Japanese counterpart would be
 * an inference dressed as a fact. A gap is better than a wrong twin, and the
 * explainer is told what it does not know rather than left to guess.
 *
 * FREE AND LOCAL. Catalogue files, the price snapshot and the history archives —
 * no network, no metered call, nothing for scripts/check-free-tier.mts to object
 * to. The metered part is the model, and it lives in card-explain.ts.
 */

const HISTORY_DIR = path.join(process.cwd(), "data", "prices", "history");

export type CardContext = {
  set?: {
    name: string;
    releaseDate?: string;
    /** How many cards the set officially declares. */
    cardCount?: number;
  };
  /**
   * Where this card sits among the priced cards of its own set.
   *
   * THE ANSWER TO "IS IT EXPENSIVE", which a bare figure cannot give. EUR 63.82
   * means nothing on its own to somebody who has never bought a card; "the 2nd
   * dearest of 70" means something immediately, and it is arithmetic over our
   * own snapshot rather than a judgement.
   */
  standing?: {
    rank: number;
    outOf: number;
    /** The cheapest, middle and dearest card of the set, as a scale to read the rank against. */
    setLowEur: number;
    setMedianEur: number;
    setHighEur: number;
  };
  /**
   * What this card cost at each price snapshot we kept, oldest first.
   *
   * TWO POINTS TODAY, and they are two days apart — this says almost nothing
   * about a trend yet and the explainer is told so. It is here because it is the
   * one field that grows on its own: every refresh adds a reading, and the same
   * shape carries a year of them later without a change here or in the prompt.
   */
  history?: { date: string; eur?: number }[];
};

type HistoryFile = { observedAt?: string; cards?: Record<string, Record<string, number>> };

/** Snapshot archives for one game, oldest first. Read once and kept. */
let archives: { date: string; file: HistoryFile }[] | undefined;

function loadArchives(): { date: string; file: HistoryFile }[] {
  if (archives) return archives;
  archives = [];
  if (!existsSync(HISTORY_DIR)) return archives;
  const names = readdirSync(HISTORY_DIR)
    .filter((name) => name.startsWith("pokemon-") && name.endsWith(".json.gz"))
    .sort();
  for (const name of names) {
    try {
      const raw = gunzipSync(readFileSync(path.join(HISTORY_DIR, name))).toString("utf8");
      archives.push({ date: name.slice("pokemon-".length, -".json.gz".length), file: JSON.parse(raw) as HistoryFile });
    } catch {
      // A truncated or half-written archive is skipped rather than fatal — the
      // context is an enrichment, and losing one reading is not worth a 500.
    }
  }
  return archives;
}

export function contextFor(tcgdexId: string): CardContext {
  const entry = getCatalogCard(tcgdexId);
  if (!entry) return {};

  const context: CardContext = {
    set: {
      name: entry.set.name,
      releaseDate: entry.set.releaseDate,
      cardCount: entry.set.cardCount?.official,
    },
  };

  // WHERE IT STANDS IN ITS OWN SET. One pass over the set's snapshot values —
  // the same function the price sort uses, so a card's rank here and its
  // position in a price-sorted set page cannot disagree.
  const siblings = getCatalogSetCards(entry.set.id, entry.set.language).map((e) => e.card);
  const values = getCatalogPriceValues(siblings);
  const mine = values.get(tcgdexId);
  if (mine !== undefined && values.size > 1) {
    const sorted = [...values.values()].sort((a, b) => b - a);
    context.standing = {
      rank: sorted.findIndex((v) => v <= mine) + 1,
      outOf: sorted.length,
      setLowEur: sorted[sorted.length - 1],
      setMedianEur: sorted[sorted.length >> 1],
      setHighEur: sorted[0],
    };
  }

  const readings: { date: string; eur?: number }[] = [];
  for (const { date, file } of loadArchives()) {
    const row = file.cards?.[tcgdexId];
    // `_` is the snapshot's short key for the plain printing's Cardmarket
    // average — see scripts/price-history.ts, which writes it.
    const eur = row?.["_"];
    if (typeof eur === "number") readings.push({ date, eur });
  }
  if (readings.length > 0) context.history = readings;

  return context;
}
