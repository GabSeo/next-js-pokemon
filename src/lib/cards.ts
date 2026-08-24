import { cache } from "react";
import { cardRefs, type CardRef } from "@/data/card-refs";
import {
  findProductByCode,
  findProductByNameAndSet,
  getHistoryPrices,
  type ApitcgProduct,
} from "@/lib/apitcg";
import { absoluteUrl } from "@/lib/site";
import { describeUpstreamError, logUpstreamOnce } from "@/lib/upstream";
import { findCardByNameAndSet, getCard, cardImageUrl, tcgplayerSnapshot, type TcgdexCard } from "@/lib/tcgdex";
import type {
  AlertBand,
  Card,
  Franchise,
  PriceHistoryPoint,
  PriceRange,
  PriceSnapshot,
  PriceTrend,
} from "@/lib/types";

// How many daily records to ask apitcg for per card. Kept modest for a
// prototype — priceRange is computed over whatever this actually returns,
// and computePriceRange() reports the real from/to bounds of that window
// rather than implying a longer (e.g. 1-year) history than we're fetching.
const HISTORY_LOOKBACK_LIMIT = 100;

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

/**
 * Evenly-spaced downsample, always keeping the first and last point (so the
 * overall trend/date range stays readable from the reduced set) — used only
 * for the agent-facing JSON/markdown mirrors below. The HTML product page's
 * chart keeps consuming `card.priceHistory` at full resolution directly
 * (see components/product-page-content.tsx); trend/priceRange are already
 * computed from the full history in resolveCard, so downsampling this output
 * field doesn't affect their accuracy.
 */
export function downsamplePriceHistory(history: PriceHistoryPoint[], maxPoints = 25): PriceHistoryPoint[] {
  if (history.length <= maxPoints) return history;
  if (maxPoints <= 1) return history.slice(-1);
  const step = (history.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => history[Math.round(i * step)]);
}

/** Average price over the trailing N days of real daily history. */
function averageOverLastDays(history: PriceHistoryPoint[], days: number): number | null {
  if (history.length === 0) return null;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const window = history.filter((p) => p.date >= cutoffStr);
  const pool = window.length > 0 ? window : history.slice(-1);
  const sum = pool.reduce((total, p) => total + p.price, 0);
  return Math.round((sum / pool.length) * 100) / 100;
}

function computeTrend(history: PriceHistoryPoint[]): PriceTrend {
  return {
    day1: averageOverLastDays(history, 1),
    day7: averageOverLastDays(history, 7),
    day30: averageOverLastDays(history, 30),
    day90: averageOverLastDays(history, 90),
  };
}

/** Low/high over the full history array. Assumes `history` is sorted ascending by date. */
function computePriceRange(history: PriceHistoryPoint[]): PriceRange | null {
  if (history.length === 0) return null;
  let low = history[0];
  let high = history[0];
  for (const point of history) {
    if (point.price < low.price) low = point;
    if (point.price > high.price) high = point;
  }
  return {
    low: low.price,
    high: high.price,
    lowDate: low.date,
    highDate: high.date,
    from: history[0].date,
    to: history[history.length - 1].date,
  };
}

function marketPrice(markets: ApitcgProduct["markets"]): number | undefined {
  const prices = markets?.tcgplayer?.prices;
  return prices?.market ?? prices?.mid ?? prices?.low;
}

async function resolveProduct(ref: CardRef): Promise<ApitcgProduct | undefined> {
  if (ref.lookup.by === "code") {
    return findProductByCode(ref.tcg, ref.lookup.code);
  }
  return findProductByNameAndSet(
    ref.tcg,
    ref.lookup.name,
    ref.lookup.setName,
    ref.lookup.number
  );
}

/**
 * TCGdex match for a Pokémon ref, non-fatal on any failure — same
 * resilience shape as the rest of this file's external calls (apitcg,
 * eBay): a card must still render with apitcg's data if TCGdex is
 * unreachable or has no match, never take the page down. One Piece isn't
 * in TCGdex at all, so this is only ever attempted for `tcg === "pokemon"`,
 * and only for the "nameSet" lookup shape every current Pokémon ref uses
 * (TCGdex has no equivalent to One Piece's terse set-code lookup).
 */
async function resolveTcgdexCard(ref: CardRef): Promise<TcgdexCard | undefined> {
  if (ref.tcg !== "pokemon" || ref.lookup.by !== "nameSet") return undefined;
  try {
    return await findCardByNameAndSet(ref.lookup.name, ref.lookup.setName, ref.lookup.number);
  } catch (err) {
    logUpstreamOnce(`tcgdex:${ref.slug}`, `[cards] TCGdex lookup failed for ${ref.slug} — ${describeUpstreamError(err)}`);
    return undefined;
  }
}

async function resolveCard(ref: CardRef): Promise<Card | undefined> {
  // apitcg failure (quota exhausted, outage, etc.) must never take the
  // whole card down when TCGdex already has a match — resolveProduct throws
  // on a non-2xx response (see apitcg.ts's apitcgFetch), and an uncaught
  // rejection inside Promise.all rejects the *whole* Promise.all, discarding
  // resolveTcgdexCard's already-successful result along with it. Caught
  // right here, at the source, rather than relying on resolveCardSafe's
  // outer try/catch — that outer catch is a last-resort safety net for
  // *this function* failing outright, not a substitute for handling one of
  // two independent sources failing while the other succeeds.
  const [product, tcgdexCard] = await Promise.all([
    resolveProduct(ref).catch((err) => {
      logUpstreamOnce(
        `apitcg:${ref.slug}`,
        `[cards] apitcg lookup failed for ${ref.slug} (quota exhausted or outage?) — ${describeUpstreamError(err)}`
      );
      return undefined;
    }),
    resolveTcgdexCard(ref),
  ]);

  // Genuinely nothing to build a card from — apitcg has no match (or
  // failed) and TCGdex has no match either (always true for One Piece).
  if (!product && !tcgdexCard) return undefined;

  // apitcg's product record is the only source with a numeric product id,
  // which price history below needs regardless of franchise (TCGdex has no
  // history endpoint; see tcgplayerSnapshot's doc comment) — but its
  // *identity fields* (name, set, rarity, image, current price, TCGplayer
  // link, description) are used only when TCGdex has no match for this card
  // (One Piece, always; a Pokémon card TCGdex couldn't find, or apitcg being
  // down while TCGdex is up). TCGdex is exclusive where it applies, not
  // blended field-by-field with apitcg's — no more `tcgdex ?? apitcg`
  // chains, since a mix would mean showing e.g. TCGdex's French-adjacent
  // English name next to apitcg's own separately-sourced image, two
  // different snapshots of "the same" card pretending to agree.
  //
  // When apitcg is unavailable, price history/trend/range/recentSnapshots
  // simply come back empty rather than blocking the card — the page already
  // renders "No historical data available yet" for that case.
  const history = product ? await getHistoryPrices(product._id, HISTORY_LOOKBACK_LIMIT).catch(() => []) : [];

  const sortedAsc = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const priceHistory: PriceHistoryPoint[] = sortedAsc
    .map((h) => {
      const price = marketPrice(h.markets);
      return price === undefined ? null : { date: h.date.slice(0, 10), price };
    })
    .filter((p): p is PriceHistoryPoint => p !== null);

  // Price history itself (the chart/trend/range/condition-chips section)
  // stays 100% apitcg-sourced regardless of TCGdex — TCGdex has no
  // time-series equivalent, so this per-row link describes apitcg's own
  // data and correctly stays apitcg's URL even on an otherwise
  // TCGdex-exclusive Pokémon card.
  const recentSnapshots: PriceSnapshot[] = [...priceHistory]
    .reverse()
    .slice(0, 10)
    .map((p) => ({
      date: p.date,
      price: p.price,
      source: "TCGPlayer",
      sourceUrl: product?.markets?.tcgplayer?.url,
    }));

  const tcgdexPrice = tcgdexCard ? tcgplayerSnapshot(tcgdexCard) : undefined;

  const identity = tcgdexCard
    ? {
        name: tcgdexCard.name,
        set: tcgdexCard.set.name,
        setCode: tcgdexCard.set.id,
        // The full printed fraction (e.g. "271/264") when the set's base
        // print-run size is known, falling back to the bare localId
        // otherwise — see TcgdexSetBrief's doc comment on `cardCount`.
        number: tcgdexCard.set.cardCount?.official
          ? `${tcgdexCard.localId}/${tcgdexCard.set.cardCount.official}`
          : tcgdexCard.localId,
        rarity: tcgdexCard.rarity,
        types: tcgdexCard.types,
        imageUrl: tcgdexCard.image ? cardImageUrl(tcgdexCard.image) : undefined,
        // TCGdex has no card-description field at all — rather than
        // borrowing apitcg's generic-catalog description text alongside
        // otherwise-exclusively-TCGdex fields, a TCGdex-matched card simply
        // has none. The page already renders this paragraph conditionally.
        description: undefined as string | undefined,
        currentPrice: tcgdexPrice?.price ?? 0,
        sourceUrl: tcgdexPrice?.url,
        asOfDate: tcgdexPrice?.updated ?? new Date().toISOString(),
      }
    : product
      ? {
          name: product.name,
          set: product.set?.name ?? "",
          setCode: product.set?.code,
          number: product.attributes?.Number ?? product.code,
          rarity: product.attributes?.Rarity,
          // apitcg has no energy-type field — One Piece and any unmatched
          // Pokémon card simply have none, rather than a fabricated guess.
          types: undefined as string[] | undefined,
          imageUrl: product.images?.[0]?.large ?? product.images?.[0]?.medium,
          description: product.attributes?.Description ? stripHtml(product.attributes.Description) : undefined,
          currentPrice: marketPrice(product.markets) ?? 0,
          sourceUrl: product.markets?.tcgplayer?.url,
          asOfDate: product.updatedAt ?? new Date().toISOString(),
        }
      : undefined;

  // Unreachable given the `!product && !tcgdexCard` guard above, but keeps
  // the branches above type-safe (TypeScript can't express "at least one of
  // these two is defined" as a single narrowing) without an unsafe `!`.
  if (!identity) return undefined;

  return {
    id: product ? String(product._id) : tcgdexCard!.id,
    slug: ref.slug,
    franchise: ref.franchise,
    character: ref.character,
    ...identity,
    asOfDate: identity.asOfDate.slice(0, 10),
    currency: "USD",
    priceHistory,
    recentSnapshots,
    trend: computeTrend(priceHistory),
    priceRange: computePriceRange(priceHistory),
    tcgdexId: tcgdexCard?.id,
  };
}

export type LocalizedCardText = {
  name: string;
  set: string;
  rarity?: string;
  imageUrl?: string;
  /** Localized energy-type labels (e.g. "Obscurité" for "Darkness"), same order as `card.types` — color for each badge still comes from the English `card.types[i]`, since color is keyed by the canonical name, not the display label. */
  types?: string[];
  /** True only when a real TCGdex French match was found — false means every field above is just the English original echoed back, never a fabricated translation. */
  translated: boolean;
};

/**
 * French display text for a card's identity fields — name/set/rarity/image
 * only, never price/history/description, which have no French source and
 * stay whatever `card` already carries. Deliberately returns a small text
 * bundle rather than a full spliced `Card`: the /products/[slug]/fr route
 * needs these fields for what's actually *visible*, but must keep passing
 * the original English `card` into getGradedMarketData/eBay search — those
 * already special-case French via `card.tcgdexId` (see graded-market.ts),
 * and would silently search eBay's English/Japanese tabs for the French
 * name if a fully-overridden Card leaked into them instead.
 *
 * One Piece cards (no tcgdexId — TCGdex has no coverage) and any Pokémon
 * card TCGdex couldn't match both fall through to `translated: false`,
 * echoing the English fields back rather than fabricating a translation —
 * same non-fatal resilience shape as resolveTcgdexCard above.
 */
export async function getFrenchCardText(card: Card): Promise<LocalizedCardText> {
  const fallback: LocalizedCardText = {
    name: card.name,
    set: card.set,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    types: card.types,
    translated: false,
  };
  if (!card.tcgdexId) return fallback;
  try {
    const localized = await getCard(card.tcgdexId, "fr");
    if (!localized) return fallback;
    return {
      name: localized.name,
      set: localized.set.name,
      rarity: localized.rarity ?? card.rarity,
      imageUrl: localized.image ? cardImageUrl(localized.image) : card.imageUrl,
      types: localized.types ?? card.types,
      translated: true,
    };
  } catch (err) {
    logUpstreamOnce(`tcgdex-fr:${card.slug}`, `[cards] French TCGdex lookup failed for ${card.slug} — ${describeUpstreamError(err)}`);
    return fallback;
  }
}

/**
 * The card as we can state it with no network at all: everything here comes
 * from the hand-authored CardRef in data/card-refs.ts, so nothing is
 * guessed and nothing is stale — it is simply the subset of a Card that
 * doesn't depend on apitcg or TCGdex. Price, image, rarity and history have
 * no offline source, so they are absent and the card is flagged
 * `priceUnavailable` rather than being shown as a $0 market price.
 *
 * This exists so that an upstream outage degrades the catalog instead of
 * emptying it. Before it, both upstreams being unreachable meant
 * getAllCards() returned `[]`, which meant every generateStaticParams
 * returned no params, which meant the postbuild static-route gate failed
 * the whole deploy (scripts/check-static-routes.mjs) — an outage at a third
 * party could block shipping unrelated work. Worse, the same emptiness at
 * *runtime* turned an ISR revalidation into notFound(), replacing a
 * perfectly good cached product page with a 404 until the upstream came
 * back. A placeholder page keeps the URL, the metadata, the machine-readable
 * mirrors and the internal links alive, and the next successful
 * revalidation fills the prices back in.
 */
function placeholderCard(ref: CardRef): Card {
  return {
    // No apitcg product id exists to use here; the slug is the only stable
    // identifier this card has offline, and it's already what every
    // internal link and /api/{franchise}/{id} lookup accepts.
    id: ref.slug,
    slug: ref.slug,
    franchise: ref.franchise,
    name: ref.displayName,
    // A "nameSet" ref carries the real set name and printed number; a
    // "code" ref (One Piece) carries only the code, which is exactly what
    // Card.number holds for those cards anyway.
    set: ref.lookup.by === "nameSet" ? ref.lookup.setName : "",
    number: ref.lookup.by === "nameSet" ? ref.lookup.number : ref.lookup.code,
    currency: "USD",
    // Kept a number (rather than making Card["currentPrice"] optional and
    // touching every consumer) but never presented as a real price:
    // `priceUnavailable` is what every price-rendering surface checks.
    currentPrice: 0,
    priceUnavailable: true,
    asOfDate: new Date().toISOString().slice(0, 10),
    priceHistory: [],
    recentSnapshots: [],
    trend: computeTrend([]),
    priceRange: null,
    character: ref.character,
  };
}

/**
 * cache()-wrapped so every caller resolving the same ref within one request
 * shares a single in-flight/completed attempt — including a *failed* one.
 * Confirmed via production logs: a product page's generateMetadata and its
 * page body both call getCardBySlug(slug) independently, and plain fetch()
 * memoization doesn't reliably collapse that pair when the underlying call
 * is erroring (a 429 from apitcg, in the log that prompted this), so a
 * single visit was making two real apitcg requests instead of one. cache()
 * keys on the `ref` object itself, which is safe here because every caller
 * gets it from the same module-level `cardRefs` array (same object
 * reference for the same slug every time), not a freshly constructed one.
 */
const resolveCardSafe = cache(async (ref: CardRef): Promise<Card> => {
  try {
    const card = await resolveCard(ref);
    if (card) return card;
    logUpstreamOnce(
      `unmatched:${ref.slug}`,
      `[cards] no data source matched ${ref.slug} (${JSON.stringify(ref.lookup)}) — serving the offline placeholder`
    );
  } catch (err) {
    logUpstreamOnce(`resolve:${ref.slug}`, `[cards] failed to resolve ${ref.slug} — ${describeUpstreamError(err)}`);
  }
  return placeholderCard(ref);
});

export async function getAllCards(): Promise<Card[]> {
  return Promise.all(cardRefs.map(resolveCardSafe));
}

export async function getCardsByFranchise(franchise: Franchise): Promise<Card[]> {
  const refs = cardRefs.filter((r) => r.franchise === franchise);
  return Promise.all(refs.map(resolveCardSafe));
}

export async function getCardBySlug(slug: string): Promise<Card | undefined> {
  const ref = cardRefs.find((r) => r.slug === slug);
  if (!ref) return undefined;
  return resolveCardSafe(ref);
}

/**
 * Single-card lookup by apitcg numeric id OR slug, without resolving the
 * rest of the franchise. Slugs are known upfront (in cardRefs), so that
 * case resolves just the one matching ref (2 apitcg calls). The apitcg id
 * is only known *after* resolving a card, so an id lookup still has to scan
 * — but slug is the key every internal link/API route actually uses, so
 * this keeps the common case cheap instead of always paying for the whole
 * franchise like a plain `getCardsByFranchise(...).find(...)` would.
 */
export async function getCardByIdOrSlug(
  franchise: Franchise,
  idOrSlug: string
): Promise<Card | undefined> {
  const bySlug = cardRefs.find((r) => r.franchise === franchise && r.slug === idOrSlug);
  if (bySlug) return resolveCardSafe(bySlug);

  const cards = await getCardsByFranchise(franchise);
  return cards.find((c) => c.id === idOrSlug);
}

export async function getCardById(id: string): Promise<Card | undefined> {
  const cards = await getAllCards();
  return cards.find((c) => c.id === id);
}

export async function findCard(query: string): Promise<Card | undefined> {
  const q = query.trim().toLowerCase();

  // Fast path: query matches a statically-known slug — resolve just that
  // one card (2 apitcg calls) instead of the whole catalog.
  const bySlug = cardRefs.find((r) => r.slug.toLowerCase() === q);
  if (bySlug) return resolveCardSafe(bySlug);

  // Slow path: query only matches a resolve-time field (live apitcg id,
  // display name, or card number) — has to scan the full catalog.
  const cards = await getAllCards();
  return cards.find(
    (card) =>
      card.id.toLowerCase() === q ||
      card.slug.toLowerCase() === q ||
      card.name.toLowerCase() === q ||
      (card.number ?? "").toLowerCase() === q
  );
}

// -100% is the floor (price can't drop below $0); anything past that is
// meaningless, so the downside stops at -75%. Upside is uncapped, so it
// runs further, in the same 25% steps.
const ALERT_PCTS = [-75, -50, -25, 25, 50, 75, 100, 125, 150] as const;

export function computeAlertBands(basePrice: number): AlertBand[] {
  return ALERT_PCTS.map((pct) => ({
    pct,
    price: Math.max(0, Math.round(basePrice * (1 + pct / 100) * 100) / 100),
  }));
}

export function franchiseLabel(franchise: Franchise): string {
  return franchise === "pokemon" ? "Pokémon" : "One Piece";
}

export function toPublicCard(card: Card) {
  return {
    id: card.id,
    slug: card.slug,
    franchise: card.franchise,
    name: card.name,
    set: card.set,
    setCode: card.setCode,
    number: card.number,
    rarity: card.rarity,
    // Identity/URL fields grouped here, before priceHistory — an agent
    // reading this response streamed/truncated should hit "what page is
    // this and where's the rest of the catalog" before it hits the price
    // history array, matching how the markdown/OKF mirrors put the same
    // info (title, "Canonical page:", frontmatter `resource:`) in their
    // first few lines rather than after the data tables.
    productUrl: absoluteUrl(`/products/${card.slug}`),
    markdownUrl: absoluteUrl(`/products/${card.slug}/index.md`),
    collectionUrl: absoluteUrl(`/collections/${card.franchise}`),
    collectionJsonUrl: absoluteUrl(`/api/${card.franchise}`),
    agentIndexUrl: absoluteUrl("/llms.txt"),
    currency: card.currency,
    currentPrice: card.currentPrice,
    // Present (and true) only when no price source could be reached, so a
    // consumer never reads the 0 above as "this card is worth nothing".
    ...(card.priceUnavailable ? { priceUnavailable: true as const } : {}),
    asOfDate: card.asOfDate,
    // Downsampled to 25 evenly-spaced points — see downsamplePriceHistory's
    // own doc comment on why the full-resolution field stays on the HTML
    // chart only, not this public/agent-facing serialization.
    priceHistory: downsamplePriceHistory(card.priceHistory),
    recentSnapshots: card.recentSnapshots,
    trend: card.trend,
    priceRange: card.priceRange,
    imageUrl: card.imageUrl,
    sourceUrl: card.sourceUrl,
  };
}
