/**
 * Prices for catalogue cards, read from the snapshot at
 * `data/prices/pokemon.json` (written by scripts/price-refresh.mts).
 *
 * THE NETWORK IS NOT IN THE RENDER PATH. This used to fetch one live price per
 * card while a visitor waited, and every performance problem the catalogue had
 * traced to that single fact:
 *
 *   a set nobody had opened     2-10s, paid by whoever clicked first
 *   /cards on unseen cards      0.35-1.26s, on every request, forever
 *   prerendering to fix it      21k build-time requests tripped the circuit
 *                               breaker and froze EMPTY prices into static
 *                               HTML for 24h (measured: sv08 and base1 shipped
 *                               with none, me05 with 1 of 120)
 *
 * Reading a snapshot makes all three go away at once: a page render is a map
 * lookup, set pages can prerender deterministically because the build makes no
 * requests, and a price sort can order all 21,066 cards instead of the 250 it
 * could afford to fetch.
 *
 * FRESHNESS IS NOW A DEPLOY CONCERN, and it is stated rather than implied.
 * Figures are as of `generatedAt`, which pages print — see priceSnapshotDate.
 * Refresh by re-running the script; `prebuild` does it on every deploy.
 *
 * THE LIVE FALLBACK IS PER-CARD AND DELIBERATE. A card the snapshot does not
 * hold — added upstream since the last refresh — is fetched live rather than
 * rendered as "No price", because a handful of live reads is cheap and a wrong
 * absence is not. It is NOT a fallback for a missing FILE: 21,066 live reads is
 * exactly the failure this module exists to remove, so an absent snapshot logs
 * loudly and prices nothing.
 *
 * COSTS NO METERED QUOTA either way. TCGdex is keyless and is not a bucket in
 * lib/api-budget.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { cardmarketPriceFields, type CatalogCard } from "@/lib/catalog";
import { getCard } from "@/lib/tcgdex";

const SNAPSHOT_FILE = path.join(process.cwd(), "data", "prices", "pokemon.json");

type CardmarketSnapshot = Record<string, number>;
type TcgplayerSnapshot = Record<string, { market?: number }>;
type PriceEntry = { u?: string; cm?: CardmarketSnapshot; tp?: TcgplayerSnapshot };
type PriceSnapshotFile = { generatedAt: string; source: string; cards: Record<string, PriceEntry> };

let snapshot: PriceSnapshotFile | undefined;
let snapshotMissingLogged = false;

function loadSnapshot(): PriceSnapshotFile {
  if (snapshot) return snapshot;
  if (!existsSync(SNAPSHOT_FILE)) {
    if (!snapshotMissingLogged) {
      snapshotMissingLogged = true;
      console.warn(
        `[catalog-prices] no price snapshot at ${path.relative(process.cwd(), SNAPSHOT_FILE)} — ` +
          `run "npx tsx scripts/price-refresh.mts". Catalogue pages will render without prices.`
      );
    }
    snapshot = { generatedAt: "", source: "", cards: {} };
    return snapshot;
  }
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as PriceSnapshotFile;
  } catch {
    snapshot = { generatedAt: "", source: "", cards: {} };
  }
  return snapshot;
}

/** When the prices on screen were read, or undefined if there is no snapshot. Pages print this rather than implying the figures are live. */
export function priceSnapshotDate(): string | undefined {
  return loadSnapshot().generatedAt || undefined;
}

/**
 * One printing's figures. Every field optional: absent means the source had
 * none, never zero.
 *
 * ONE NUMBER PER MARKETPLACE. This carried Cardmarket's low/trend/avg1/avg7/
 * avg30 and TCGplayer's low/mid/high as well, until an audit on 2026-09-07
 * found that no page, component or route had ever read one of them — the whole
 * app reads `cardmarket.avg` and `tcgplayer.market` and nothing else. A type
 * that advertises fields the pipeline no longer carries is worse than a narrow
 * one: it invites a caller to use them and then wonder why they are empty.
 *
 * If a feature needs the spread or a rolling average, widen the snapshot in
 * scripts/price-refresh.mts and widen this to match. TCGdex is unmetered, so
 * that costs one re-run rather than lost data.
 */
export type CatalogPrice = {
  /** Which printing these figures describe — "normal", "reverse", "holo". */
  variantType?: string;
  cardmarket?: {
    avg?: number;
    /** EUR, always — Cardmarket is never converted. */
    currency: "EUR";
  };
  tcgplayer?: {
    market?: number;
    /**
     * The block these figures came from — "normal", "holofoil", "1st-edition",
     * … Reported because the candidate list (cardmarketPriceFields) may resolve
     * a printing to its era-named twin, and a caller showing a 1st Edition
     * price should be able to say so rather than implying it is the plain one.
     */
    key?: string;
    /** USD, always. */
    currency: "USD";
  };
  /** The source's own stamp on the price block, distinct from when we snapshotted it. */
  updated?: string;
};

/**
 * The printing a grid should quote when it has room for exactly one price.
 *
 * `normal` when the card has one, otherwise the first variant — the same
 * headline Cardmarket's own product page leads with. It is a CHOICE, not a
 * fact, which is why the chosen variant travels on every CatalogPrice: the
 * reverse holo of the same card can trade at 4.5x (Venonat swsh12-001,
 * measured), so a bare number owes the reader which object it prices.
 */
export function primaryVariantType(card: CatalogCard): string | undefined {
  return (card.variants.find((v) => v.type === "normal") ?? card.variants[0])?.type;
}

function pick(source: Record<string, number> | undefined, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === "number" && value !== 0 ? value : undefined;
}

/**
 * The first candidate block the snapshot actually holds.
 *
 * Candidates all describe one finish and differ only by print run, so taking
 * the first present is a spelling choice rather than a pricing one — see
 * cardmarketPriceFields for why the list may never cross that boundary.
 */
function firstBlock(
  tp: TcgplayerSnapshot | undefined,
  keys: readonly string[]
): { key: string; block: TcgplayerSnapshot[string] } | undefined {
  if (!tp) return undefined;
  for (const key of keys) {
    const block = tp[key];
    if (block) return { key, block };
  }
  return undefined;
}

/**
 * Turn one snapshot entry into the figures for `variantType`.
 *
 * The Cardmarket half is the part that is not obvious: normal and reverse-holo
 * share ONE product and one block, told apart by a field SUFFIX inside it —
 * see cardmarketPriceFields (lib/catalog.ts) for the measurement, and for why
 * the suffix does not simply mean "holo".
 */
function toPrice(card: CatalogCard, entry: PriceEntry, variantType?: string): CatalogPrice | undefined {
  const chosen = variantType ?? primaryVariantType(card);
  const { cardmarketSuffix, tcgplayerKeys } = cardmarketPriceFields(card, chosen);

  const cm = entry.cm;
  const cardmarket = cm ? { avg: pick(cm, `avg${cardmarketSuffix}`), currency: "EUR" as const } : undefined;

  const found = firstBlock(entry.tp, tcgplayerKeys);
  const tcgplayer = found ? { market: found.block.market, key: found.key, currency: "USD" as const } : undefined;

  // A block that resolved but carries no figure is an absence, not a price of
  // nothing — report it as such so a caller renders the stated gap.
  const hasAny =
    (cardmarket && Object.values(cardmarket).some((v) => typeof v === "number")) ||
    (tcgplayer && Object.values(tcgplayer).some((v) => typeof v === "number"));
  if (!hasAny) return undefined;

  return { variantType: chosen, cardmarket, tcgplayer, updated: entry.u };
}

/** The live shape of one card's price block, for the per-card fallback only. */
async function fetchEntry(card: CatalogCard): Promise<PriceEntry | undefined> {
  const full = await getCard(card.tcgdexId, "en").catch(() => undefined);
  const pricing = full?.pricing;
  if (!pricing) return undefined;

  const cm: Record<string, number> = {};
  for (const [key, value] of Object.entries(pricing.cardmarket ?? {})) {
    if (key !== "idProduct" && typeof value === "number" && value !== 0) cm[key] = value;
  }

  const tp: TcgplayerSnapshot = {};
  for (const [key, value] of Object.entries(pricing.tcgplayer ?? {})) {
    if (key === "unit" || key === "updated" || typeof value !== "object" || value === null) continue;
    const v = value as Record<string, unknown>;
    // Same narrowing as the snapshot writer, so the live fallback and the file
    // produce identical shapes — a card fetched live must not quietly carry
    // fields a cached one lacks.
    tp[key] = { market: typeof v.marketPrice === "number" ? v.marketPrice : undefined };
  }

  return {
    u: (pricing.cardmarket?.updated ?? pricing.tcgplayer?.updated) as string | undefined,
    cm: Object.keys(cm).length > 0 ? cm : undefined,
    tp: Object.keys(tp).length > 0 ? tp : undefined,
  };
}

/**
 * Just the headline number for each card, for ORDERING a result set.
 *
 * A price sort needs one comparable figure per row and nothing else. Going
 * through `getCatalogPrices` to get it built a full CatalogPrice for all 21,066
 * matches — measured at 1.31s for a whole-catalogue sort, entirely in object
 * allocation rather than IO. This reads the two fields the sort actually
 * compares and skips the rest, and the page then resolves full prices only for
 * the sixty rows it will show.
 *
 * Cards with no price are ABSENT from the map, never zero. The caller sorts
 * them to the end in both directions — "we have no price" is not "this card is
 * free", and a low-to-high sort led by unpriced cards would be misleading.
 *
 * Snapshot only, with no live fallback: a sort is a bulk operation over a set
 * that may be the entire catalogue, which is exactly where per-card fetches
 * must not happen.
 */
export function getCatalogPriceValues(cards: CatalogCard[]): Map<string, number> {
  const { cards: entries } = loadSnapshot();
  const out = new Map<string, number>();
  for (const card of cards) {
    const entry = entries[card.tcgdexId];
    if (!entry) continue;
    const { cardmarketSuffix, tcgplayerKeys } = cardmarketPriceFields(card, primaryVariantType(card));
    const value = pick(entry.cm, `avg${cardmarketSuffix}`) ?? firstBlock(entry.tp, tcgplayerKeys)?.block.market;
    if (typeof value === "number" && value !== 0) out.set(card.tcgdexId, value);
  }
  return out;
}

/** Prices for one card. Snapshot first; a card the snapshot lacks is fetched live. */
export async function getCatalogPrice(card: CatalogCard, variantType?: string): Promise<CatalogPrice | undefined> {
  const entry = loadSnapshot().cards[card.tcgdexId] ?? (await fetchEntry(card));
  return entry ? toPrice(card, entry, variantType) : undefined;
}

/**
 * The raw snapshot entry for each card, filling misses from the live fallback.
 *
 * Shared by both readers below so the fallback policy is written once. Snapshot
 * hits resolve synchronously in a single pass; only the misses cost anything,
 * and they are normally none — a snapshot refreshed at deploy covers every card
 * the corpus knows about, so this only fires for cards added upstream since.
 */
async function entriesFor(cards: CatalogCard[]): Promise<Map<string, PriceEntry>> {
  const { cards: snapshotEntries } = loadSnapshot();
  const out = new Map<string, PriceEntry>();
  const misses: CatalogCard[] = [];

  for (const card of cards) {
    const entry = snapshotEntries[card.tcgdexId];
    if (entry) out.set(card.tcgdexId, entry);
    else misses.push(card);
  }

  if (misses.length > 0) {
    const CONCURRENCY = 16;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, misses.length) }, async () => {
        while (true) {
          const i = next++;
          if (i >= misses.length) return;
          const card = misses[i];
          const entry = await fetchEntry(card).catch(() => undefined);
          if (entry) out.set(card.tcgdexId, entry);
        }
      })
    );
  }

  return out;
}

/**
 * Prices for many cards — the headline printing only.
 *
 * Returns a Map keyed by `tcgdexId`, with a card that has no price simply
 * absent rather than present-and-empty, so a caller cannot accidentally render
 * a zero.
 */
export async function getCatalogPrices(cards: CatalogCard[]): Promise<Map<string, CatalogPrice>> {
  const entries = await entriesFor(cards);
  const out = new Map<string, CatalogPrice>();
  for (const card of cards) {
    const entry = entries.get(card.tcgdexId);
    const price = entry && toPrice(card, entry);
    if (price) out.set(card.tcgdexId, price);
  }
  return out;
}

/**
 * EVERY priced printing of each card, headline first.
 *
 * The reason this exists: a card's printings are separately priced and far
 * apart — measured across the snapshot, 16,219 of 20,451 rows (79.3%) carry a
 * distinct reverse-holo figure, a median 3.36x from the normal one and 10.7x at
 * the 90th percentile. A grid that can only reach the headline leaves the other
 * number unreachable, which for a reverse holo is most of its value.
 *
 * Ordered by `card.variants`, so index 0 is what `getCatalogPrices` would have
 * returned and any tail is genuinely additional. Variants the snapshot cannot
 * price are omitted rather than included empty — an absent printing and a
 * worthless one are not the same claim.
 *
 * Costs no metered quota: same snapshot, same per-card TCGdex fallback.
 */
export async function getCatalogPricesByVariant(cards: CatalogCard[]): Promise<Map<string, CatalogPrice[]>> {
  const entries = await entriesFor(cards);
  const out = new Map<string, CatalogPrice[]>();

  for (const card of cards) {
    const entry = entries.get(card.tcgdexId);
    if (!entry) continue;

    const headline = primaryVariantType(card);
    const ordered = [
      ...card.variants.filter((v) => v.type === headline),
      ...card.variants.filter((v) => v.type !== headline),
    ];

    const seen = new Set<string>();
    const prices: CatalogPrice[] = [];
    for (const variant of ordered) {
      if (variant.type && seen.has(variant.type)) continue;
      if (variant.type) seen.add(variant.type);
      const price = toPrice(card, entry, variant.type);
      if (price) prices.push(price);
    }
    if (prices.length > 0) out.set(card.tcgdexId, prices);
  }

  return out;
}
