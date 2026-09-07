#!/usr/bin/env -S npx tsx
/**
 * Writes `data/prices/pokemon.json` — one current price per card, for every
 * physical card in the catalogue.
 *
 * WHY THIS EXISTS: to take the network out of the render path.
 *
 * Before it, a set page fetched one live price per card while a visitor
 * waited. That is fine at 120 requests and untenable at scale, and it failed
 * in three separate ways that all trace to the same cause:
 *
 *   1. A set nobody had opened took 2-10s in production, paid by whoever
 *      clicked first — which, for a link you send someone, is them.
 *   2. /cards is request-time and cannot be page-cached, so any page of
 *      results holding cards nobody had priced yet cost 0.35-1.26s, forever.
 *   3. Prerendering to fix (1) made it WORSE: ~21,000 requests across parallel
 *      build workers tripped the circuit breaker, and the empty results were
 *      frozen into static HTML for 24h. Measured — sv08 and base1 shipped with
 *      zero prices, me05 with 1 of 120. Slow is recoverable; wrong-and-cached
 *      is not.
 *
 * With a snapshot, rendering a page is a map lookup. Set pages prerender
 * deterministically because the build makes no requests at all, /cards answers
 * from memory, and a price sort can order the whole catalogue instead of the
 * 250 rows it could afford to fetch live.
 *
 * THIS IS NOT PRICE HISTORY. One file, overwritten on every run, no time
 * series, no per-day rows. A chart over an arbitrary card is still not
 * available and is still not being built — TCGdex publishes trailing
 * avg1/avg7/avg30 and no series, so it could not be built from here anyway.
 *
 * ON "POINTERS MAY BE STORED, CONTENT MAY NOT": this stores content, and does
 * so deliberately. That rule exists so a figure on the page was read from a
 * source recently and its age is knowable — not to forbid caching. Every entry
 * here is machine-read (never typed), the whole file carries `generatedAt`,
 * and the pages print that date rather than implying the number is live. What
 * the rule actually forbids — a hand-typed price that rots silently — remains
 * impossible.
 *
 * COSTS NO METERED QUOTA. TCGdex only, keyless, not a bucket in
 * lib/api-budget.ts.
 *
 * Usage:
 *
 *   npx tsx scripts/price-refresh.mts                 # every physical card
 *   npx tsx scripts/price-refresh.mts --sets swsh12   # a few sets
 *   npx tsx scripts/price-refresh.mts --concurrency 8 # be gentler
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { recordObservation } from "../src/lib/price-history";

const API_BASE = "https://api.tcgdex.net/v2/en";
const CATALOG_DIR = path.join(process.cwd(), "data", "catalog", "pokemon");
const OUT_DIR = path.join(process.cwd(), "data", "prices");
const OUT_FILE = path.join(OUT_DIR, "pokemon.json");

/**
 * Measured 2026-09-05 against the live host: 8 -> 141 req/s, 16 -> 343,
 * 32 -> 223, 64 -> 232, with zero failures at every level. Throughput plateaus
 * at 16, so anything higher buys nothing and only widens the blast radius if
 * the host does start refusing.
 */
const DEFAULT_CONCURRENCY = 16;

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;

type CatalogCardRow = { tcgdexId: string };
type CatalogSetFile = { set: { id: string; serie?: { name?: string } }; cards: CatalogCardRow[] };

/**
 * ONE HEADLINE FIGURE PER MARKETPLACE PER PRINTING, and no more.
 *
 * This used to keep every field each source published — Cardmarket's avg, low,
 * trend, avg1, avg7 and avg30 plus their `-holo` twins, and TCGplayer's low,
 * mid, high and market per block. Twenty numbers per card. Audited 2026-09-07:
 * across every page, component and API route, exactly two of them are ever
 * read — `cardmarket.avg` and `tcgplayer.market`. The other eighteen were
 * written, committed, deployed and never looked at.
 *
 * Dropping them takes the snapshot from 5.9 MB to 2.4 MB (-59%), which matters
 * more than it sounds: 97% of rows change between refreshes, so this file
 * delta-compresses badly and every price commit carried the full weight.
 *
 * SAFE TO CUT BECAUSE THE SOURCE IS FREE. api.tcgdex.net has no ceiling in
 * lib/api-budget.ts, so if a feature ever needs the spread or a rolling
 * average, one 40-second re-run brings it back. That is the opposite of the
 * price HISTORY in data/prices/history/, where a gap can never be refilled
 * because the source only ever reports today.
 */

/** Cardmarket: `avg` and its `-holo` twin. The suffix pair is load-bearing — see lib/catalog.ts's cardmarketPriceFields. */
type CardmarketSnapshot = Record<string, number>;
/** TCGplayer keyed by printing ("normal", "reverse-holofoil", "holofoil", "1st-edition", …), each with its market price. */
type TcgplayerSnapshot = Record<string, { market?: number }>;

type PriceEntry = {
  /** TCGdex's own stamp on the price block. */
  u?: string;
  cm?: CardmarketSnapshot;
  tp?: TcgplayerSnapshot;
};

export type PriceSnapshotFile = {
  generatedAt: string;
  source: string;
  cards: Record<string, PriceEntry>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      last = err;
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        await worker(items[i]);
      }
    })
  );
}

/** Digital-only sets have no physical market and no prices — skipping them saves 2,480 pointless requests. Mirrors lib/catalog.ts's isDigitalOnlySet. */
function isDigitalOnly(serie: string | undefined): boolean {
  return /pocket/i.test(serie ?? "");
}

function numbersOnly(
  source: Record<string, unknown> | undefined,
  keep: (key: string) => boolean = () => true
): Record<string, number> | undefined {
  if (!source) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keep(key)) continue;
    // Explicit null is what these sources send for a stat they have no data
    // for; 0 is the same absence wearing a number. Neither belongs in a
    // snapshot a page will read as a real figure.
    if (typeof value === "number" && value !== 0) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes("--sets") ? argv[argv.indexOf("--sets") + 1]?.split(",") : undefined;
  const concurrency = argv.includes("--concurrency")
    ? Number(argv[argv.indexOf("--concurrency") + 1]) || DEFAULT_CONCURRENCY
    : DEFAULT_CONCURRENCY;

  const ids: string[] = [];
  let skippedDigital = 0;
  for (const file of readdirSync(CATALOG_DIR)) {
    if (file === "_sets.json" || !file.endsWith(".json")) continue;
    const parsed = JSON.parse(readFileSync(path.join(CATALOG_DIR, file), "utf8")) as CatalogSetFile;
    if (isDigitalOnly(parsed.set.serie?.name)) {
      skippedDigital += parsed.cards.length;
      continue;
    }
    if (only && !only.includes(parsed.set.id)) continue;
    for (const card of parsed.cards) ids.push(card.tcgdexId);
  }

  console.log(`[prices] ${ids.length} physical cards to price (${skippedDigital} digital-only skipped), concurrency ${concurrency}`);

  const cards: Record<string, PriceEntry> = {};
  let done = 0;
  let failed = 0;
  let withCm = 0;
  let withTp = 0;
  const started = Date.now();

  await pooled(ids, concurrency, async (id) => {
    try {
      const card = await getJson<{
        updated?: string;
        pricing?: { cardmarket?: Record<string, unknown>; tcgplayer?: Record<string, unknown> };
      }>(`${API_BASE}/cards/${encodeURIComponent(id)}`);

      // `avg` and `avg-holo` only. `idProduct` is a pointer rather than a price
      // and already lives in the corpus; the rest is measured-unread (see
      // CardmarketSnapshot above).
      const cm = numbersOnly(card.pricing?.cardmarket, (key) => key === "avg" || key === "avg-holo");

      const tpRaw = card.pricing?.tcgplayer;
      let tp: TcgplayerSnapshot | undefined;
      if (tpRaw) {
        for (const [key, value] of Object.entries(tpRaw)) {
          if (key === "unit" || key === "updated" || typeof value !== "object" || value === null) continue;
          const v = value as Record<string, unknown>;
          if (typeof v.marketPrice === "number") (tp ??= {})[key] = { market: v.marketPrice };
        }
      }

      if (cm || tp) {
        cards[id] = {
          u: (card.pricing?.cardmarket?.updated ?? card.pricing?.tcgplayer?.updated) as string | undefined,
          cm: cm && Object.keys(cm).length > 0 ? cm : undefined,
          tp,
        };
        if (cm) withCm++;
        if (tp) withTp++;
      }
    } catch {
      // A card that could not be read is simply absent from the snapshot, and
      // the reader falls back to a live fetch for it. Recording a failure as an
      // empty price would turn a transient blip into a rendered "No price".
      failed++;
    }
    if (++done % 2500 === 0) console.log(`[prices]   ${done}/${ids.length}…`);
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const observedAt = new Date();
  const file: PriceSnapshotFile = { generatedAt: observedAt.toISOString(), source: API_BASE, cards };
  writeFileSync(OUT_FILE, `${JSON.stringify(file)}\n`, "utf8");

  // AND an append-only observation, which the snapshot above is not. That file
  // holds the CURRENT price of every card and this run has just overwritten the
  // previous one; without this line, the reading it replaced is written down
  // nowhere we chose to write it. See lib/price-history.ts for what is kept,
  // what it costs, and what it deliberately does not promise.
  const observation = recordObservation("pokemon", API_BASE, cards, observedAt);
  console.log(
    `[prices] ${path.relative(process.cwd(), observation.file)} — ` +
      `${observation.cards} printings observed, ${(observation.bytes / 1024).toFixed(0)} KB gzipped`
  );

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const bytes = readFileSync(OUT_FILE).length;
  console.log(
    `\n[prices] done in ${elapsed}s — ${Object.keys(cards).length} priced ` +
      `(${withCm} cardmarket, ${withTp} tcgplayer), ${failed} unreadable`
  );
  console.log(`[prices] ${path.relative(process.cwd(), OUT_FILE)} — ${(bytes / 1048576).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
