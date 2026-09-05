#!/usr/bin/env -S npx tsx
/**
 * Crawls TCGdex's English Pokémon catalogue into `data/catalog/pokemon/`, one
 * JSON file per set — the corpus that lets a card exist because the catalogue
 * has it, rather than because someone hand-wrote a ref in card-refs.ts.
 *
 * WHAT IT STORES, AND THE ONE RULE BEHIND THAT CHOICE
 *
 * Identity and POINTERS only. Never prices.
 *
 * TCGdex returns live Cardmarket and TCGplayer figures inline on every card
 * (`variants_detailed[].pricing`), and freezing those into a committed file
 * would be exactly the thing docs/adding-a-card.md forbids: content that goes
 * stale silently, on a site whose whole proposition is that its figures were
 * read from a source today. So every price VALUE is discarded here and only
 * the product IDS are kept — `thirdParty.cardmarket` / `thirdParty.tcgplayer`
 * — which are pointers, go stale loudly, and are what a later live lookup
 * needs anyway.
 *
 * That is the manual "pointers may be stored by hand, content may not" rule,
 * automated. The pointers a person used to confirm by hand for one card are
 * now harvested for all of them.
 *
 * WHY TCGdex AND WHY POKÉMON FIRST
 *
 * No API key, no published rate limit, and it is not in lib/api-budget.ts —
 * so a full 24k-card crawl costs nothing against the four metered quotas this
 * app actually lives on. There is no equivalent for One Piece: BerryWallet is
 * the only source with a real Japanese catalogue and it is capped at 100
 * calls/hour, which is precisely why the same crawl there is a different
 * (and later) problem.
 *
 * SHAPE OF THE CRAWL
 *
 *   GET /v2/en/sets            -> 218 sets  (1 call)
 *   GET /v2/en/sets/{id}       -> card briefs: id, localId, name, image
 *   GET /v2/en/cards/{id}      -> rarity, variants, third-party product ids
 *
 * The per-card call is unavoidable: a set's card list carries no rarity and no
 * third-party ids, and both are load-bearing downstream. That makes the full
 * crawl ~24k requests. Bounded concurrency keeps it to roughly 20 minutes and
 * keeps us a polite client of a free service.
 *
 * RESUMABLE BY SET. Each set writes its own file and a set whose file already
 * matches the live `cardCount` is skipped, so an interrupted crawl resumes
 * where it stopped instead of starting over. `--force` re-crawls anyway.
 *
 * A CARD THAT FAILS IS RECORDED, NOT DROPPED. Same refusal rule the resolvers
 * follow (docs/scan-to-collection.md §5.1): a card whose detail call failed is
 * written with `unresolved: true` and the reason, so a partial crawl is
 * visible in the data rather than looking like a smaller catalogue.
 *
 * NOTHING IS FILTERED OUT. The catalogue includes Pokémon TCG Pocket sets
 * (A1, A3, …), Trainer Kits and deck products, which have no physical market
 * and correspondingly no Cardmarket pricing. Dropping them here would be a
 * guess baked into the corpus; every set record carries `serie` and `id` so a
 * consumer can filter them with a query it can state and change.
 *
 * Usage:
 *
 *   npx tsx scripts/catalog-crawl.mts --sets swsh12,sv10   # validate on a few
 *   npx tsx scripts/catalog-crawl.mts --limit 5            # first 5 sets
 *   npx tsx scripts/catalog-crawl.mts                      # the whole catalogue
 *   npx tsx scripts/catalog-crawl.mts --force              # ignore existing files
 *   npx tsx scripts/catalog-crawl.mts --concurrency 4      # be gentler
 *
 * Probing this API by hand: `api.tcgdex.net` publishes an AAAA record that
 * does not accept connections, so an IPv6-first client with no Happy Eyeballs
 * fallback (python's urllib, for one) hangs ~21s per request before falling
 * back. Node 18+ handles it; `curl -4` is the quick workaround. Measured
 * 2026-09-05 — it is not an outage and not the GeoDNS problem lib/tcgdex.ts's
 * header documents.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const API_BASE = "https://api.tcgdex.net/v2/en";
const OUT_DIR = path.join(process.cwd(), "data", "catalog", "pokemon");

/**
 * Deliberately outside `src/`. A 24k-card corpus that anything can `import`
 * is a 24k-card corpus that eventually ends up in a client bundle; keeping it
 * out of the module graph makes reaching for it a deliberate act with a
 * loader behind it (step 2), not an accident.
 */
const SETS_FILE = path.join(OUT_DIR, "_sets.json");

/** Bounded so a free service is not hit with 24k parallel requests. 8 measured at ~20 min for the full catalogue. */
const DEFAULT_CONCURRENCY = 8;

/** One cheap retry for a transient blip, matching lib/upstream.ts's own shape. Anything worse is recorded as unresolved. */
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

type Args = {
  sets?: string[];
  limit?: number;
  force: boolean;
  concurrency: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { force: false, concurrency: DEFAULT_CONCURRENCY };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") args.force = true;
    else if (arg === "--sets") args.sets = argv[++i]?.split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--concurrency") args.concurrency = Number(argv[++i]) || DEFAULT_CONCURRENCY;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npx tsx scripts/catalog-crawl.mts [--sets a,b] [--limit N] [--concurrency N] [--force]");
      process.exit(0);
    }
  }
  return args;
}

type TcgdexSetRow = {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount?: { total?: number; official?: number };
};

type TcgdexSetDetail = TcgdexSetRow & {
  serie?: { id: string; name: string };
  releaseDate?: string;
  abbreviation?: { official?: string; localized?: string };
  cards?: { id: string; localId: string; name: string; image?: string }[];
};

type TcgdexVariantDetailed = {
  type?: string;
  size?: string;
  variantId?: string;
  thirdParty?: { cardmarket?: number; tcgplayer?: number };
};

type TcgdexCardDetail = {
  id: string;
  localId: string;
  name: string;
  rarity?: string;
  category?: string;
  illustrator?: string;
  image?: string;
  updated?: string;
  variants_detailed?: TcgdexVariantDetailed[];
  /**
   * The CARD-level price block, and the authoritative source of the
   * marketplace product ids.
   *
   * Measured 2026-09-05 and initially got this wrong: `variants_detailed[].
   * thirdParty` looks like the place these live, and it IS on modern sets, but
   * it is empty across XY, Black & White, Diamond & Pearl and most of Sun &
   * Moon — while `pricing.cardmarket.idProduct` is populated for all of them.
   * Counting `thirdParty` produced a "58% coverage, four dead eras, 7,186
   * unusable cards" conclusion that a sample of 12 cards per era then
   * contradicted outright: 11-12 of 12 priced fine in every one of those eras.
   *
   * So the id is read from here, and `thirdParty` is kept only as the
   * per-variant detail it actually is.
   */
  pricing?: {
    cardmarket?: { idProduct?: number };
    tcgplayer?: Record<string, unknown>;
  };
};

/** One card as this corpus stores it: identity plus the third-party pointers, and no price anywhere. */
type CatalogVariant = {
  type?: string;
  size?: string;
  variantId?: string;
  cardmarketProductId?: number;
  tcgplayerProductId?: number;
};

type CatalogCard = {
  tcgdexId: string;
  localId: string;
  name: string;
  rarity?: string;
  category?: string;
  illustrator?: string;
  image?: string;
  /** Cardmarket's product id for this card, from the card-level price block — see TcgdexCardDetail.pricing. */
  cardmarketProductId?: number;
  /** TCGplayer's product id, taken from whichever printing carries one; they agree across a card's printings (measured). */
  tcgplayerProductId?: number;
  /** TCGdex's own last-updated stamp for the card, kept so staleness is a fact in the data rather than a guess about the crawl date. */
  sourceUpdated?: string;
  variants: CatalogVariant[];
  /** Set when the detail call failed. The card is kept so a partial crawl looks partial rather than small. See this file's header. */
  unresolved?: true;
  unresolvedReason?: string;
};

type CatalogSetFile = {
  crawledAt: string;
  source: string;
  set: {
    id: string;
    name: string;
    serie?: { id: string; name: string };
    releaseDate?: string;
    abbreviation?: { official?: string; localized?: string };
    cardCount?: { total?: number; official?: number };
    logo?: string;
    symbol?: string;
  };
  cards: CatalogCard[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Runs `worker` over `items` with at most `limit` in flight. Order of results follows `items`. */
async function pooled<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Identity + pointers, with every price value from `variants_detailed[].pricing` deliberately dropped. */
function toCatalogCard(detail: TcgdexCardDetail): CatalogCard {
  // The first printing that carries a TCGplayer product id. Measured: a card's
  // printings share one TCGplayer product (Venonat's normal and reverse both
  // report 451620), so "first" is not a tie-break between rivals.
  const tcgplayerBlock = Object.values(detail.pricing?.tcgplayer ?? {}).find(
    (v): v is { productId?: number } => typeof v === "object" && v !== null && "productId" in v
  );
  return {
    tcgdexId: detail.id,
    localId: detail.localId,
    name: detail.name,
    rarity: detail.rarity,
    category: detail.category,
    illustrator: detail.illustrator,
    image: detail.image,
    cardmarketProductId: detail.pricing?.cardmarket?.idProduct,
    tcgplayerProductId: tcgplayerBlock?.productId,
    sourceUpdated: detail.updated,
    variants: (detail.variants_detailed ?? []).map((variant) => ({
      type: variant.type,
      size: variant.size,
      variantId: variant.variantId,
      cardmarketProductId: variant.thirdParty?.cardmarket,
      tcgplayerProductId: variant.thirdParty?.tcgplayer,
    })),
  };
}

function setFilePath(setId: string): string {
  // Set ids contain dots and dashes (`sm7.5`, `tk-xy-n`) but no separators, so
  // they are safe as filenames as-is; encoded anyway rather than trusting that
  // of every future id.
  return path.join(OUT_DIR, `${encodeURIComponent(setId)}.json`);
}

/**
 * True when this set's file holds a crawl worth keeping — it parses and every
 * card in it resolved.
 *
 * Deliberately does NOT compare the stored card count against the set list's
 * `cardCount.total`. Measured 2026-09-05: the two disagree on 7 of 218 sets,
 * and the disagreement is upstream's rather than a partial crawl — `wp`,
 * `jumbo`, `sp` and `rc` each advertise cards in the set list (7, 160, 10 and
 * 25) and return an EMPTY `cards` array from their own set endpoint, while
 * `tk-sm-l`, `swshp` and `mfb` return fewer than advertised. Testing against
 * the claim made those 7 sets re-crawl on every single run, forever, and
 * fixed nothing — the missing cards are not there to fetch.
 *
 * So completeness means "nothing failed on our side". Picking up cards ADDED
 * upstream since the last crawl is a freshness question, not a completeness
 * one, and `--force` is what answers it.
 */
function isSetComplete(setId: string): boolean {
  const file = setFilePath(setId);
  if (!existsSync(file)) return false;
  try {
    const existing = JSON.parse(readFileSync(file, "utf8")) as CatalogSetFile;
    return !existing.cards.some((card) => card.unresolved);
  } catch {
    return false;
  }
}

async function crawlSet(row: TcgdexSetRow, concurrency: number): Promise<{ cards: number; unresolved: number; changed: boolean }> {
  const detail = await getJson<TcgdexSetDetail>(`${API_BASE}/sets/${encodeURIComponent(row.id)}`);
  const briefs = detail.cards ?? [];

  const cards = await pooled(briefs, concurrency, async (brief) => {
    try {
      return toCatalogCard(await getJson<TcgdexCardDetail>(`${API_BASE}/cards/${encodeURIComponent(brief.id)}`));
    } catch (err) {
      // Kept, not dropped — see this file's header.
      return {
        tcgdexId: brief.id,
        localId: brief.localId,
        name: brief.name,
        image: brief.image,
        variants: [],
        unresolved: true,
        unresolvedReason: err instanceof Error ? err.message : String(err),
      } satisfies CatalogCard;
    }
  });

  const file: CatalogSetFile = {
    crawledAt: new Date().toISOString(),
    source: API_BASE,
    set: {
      id: detail.id,
      name: detail.name,
      serie: detail.serie,
      releaseDate: detail.releaseDate,
      abbreviation: detail.abbreviation,
      cardCount: detail.cardCount,
      logo: detail.logo,
      symbol: detail.symbol,
    },
    cards,
  };

  // WRITE ONLY WHAT CHANGED. `crawledAt` is the one field that differs on every
  // run by construction, so serialising it into the comparison would make every
  // `--force` re-crawl rewrite all 218 files and show up as a ~14MB diff in
  // which the two sets that actually changed are invisible. Comparing
  // everything EXCEPT the timestamp — and keeping the old timestamp when the
  // content matches — makes a re-crawl's diff exactly the sets that moved.
  const target = setFilePath(detail.id);
  const serialise = (f: CatalogSetFile) => JSON.stringify({ ...f, crawledAt: "" }, null, 2);
  let changed = true;
  if (existsSync(target)) {
    try {
      const previous = JSON.parse(readFileSync(target, "utf8")) as CatalogSetFile;
      if (serialise(previous) === serialise(file)) {
        changed = false;
        file.crawledAt = previous.crawledAt;
      }
    } catch {
      // Unreadable previous file — treat as changed and overwrite it.
    }
  }
  if (changed) writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");

  return { cards: cards.length, unresolved: cards.filter((c) => c.unresolved).length, changed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[catalog] fetching set list from ${API_BASE}/sets`);
  const allSets = await getJson<TcgdexSetRow[]>(`${API_BASE}/sets`);
  writeFileSync(
    SETS_FILE,
    `${JSON.stringify({ crawledAt: new Date().toISOString(), source: `${API_BASE}/sets`, sets: allSets }, null, 2)}\n`,
    "utf8"
  );

  let targets = allSets;
  if (args.sets) targets = allSets.filter((s) => args.sets!.includes(s.id));
  if (args.limit !== undefined) targets = targets.slice(0, args.limit);

  if (args.sets) {
    const missing = args.sets.filter((id) => !allSets.some((s) => s.id === id));
    if (missing.length) console.warn(`[catalog] no such set(s): ${missing.join(", ")}`);
  }

  const totalCards = allSets.reduce((sum, s) => sum + (s.cardCount?.total ?? 0), 0);
  console.log(`[catalog] ${allSets.length} sets, ${totalCards} cards in the catalogue; crawling ${targets.length} set(s) at concurrency ${args.concurrency}`);

  let crawled = 0;
  let skipped = 0;
  let cardsWritten = 0;
  let rewritten = 0;
  let unresolvedTotal = 0;
  const started = Date.now();

  for (const [index, row] of targets.entries()) {
    const position = `${index + 1}/${targets.length}`;
    if (!args.force && isSetComplete(row.id)) {
      skipped++;
      console.log(`[catalog] ${position} ${row.id} — up to date, skipped`);
      continue;
    }
    try {
      const result = await crawlSet(row, args.concurrency);
      crawled++;
      cardsWritten += result.cards;
      unresolvedTotal += result.unresolved;
      if (result.changed) rewritten++;
      const note = result.unresolved ? `, ${result.unresolved} UNRESOLVED` : "";
      const unchanged = result.changed ? "" : " (unchanged, not rewritten)";
      // Stated rather than reconciled: the set list and the set endpoint
      // genuinely disagree on 7 sets and the endpoint is the one holding real
      // cards. See isSetComplete for why this is a note and not a retry.
      const claimed = row.cardCount?.total;
      const shortfall = claimed !== undefined && claimed !== result.cards ? ` (set list claims ${claimed})` : "";
      console.log(`[catalog] ${position} ${row.id} — ${result.cards} cards${shortfall}${note}${unchanged}`);
    } catch (err) {
      // A set that cannot be listed at all writes no file, so the next run
      // retries it. Louder than a card-level miss because it is a whole set.
      console.error(`[catalog] ${position} ${row.id} — FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n[catalog] done in ${elapsed}s — ${crawled} set(s) crawled (${rewritten} file(s) rewritten), ${skipped} skipped, ${cardsWritten} cards seen` +
      (unresolvedTotal ? `, ${unresolvedTotal} unresolved` : "")
  );
  console.log(`[catalog] output: ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
