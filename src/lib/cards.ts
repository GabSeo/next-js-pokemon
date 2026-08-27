import { cache } from "react";
import { cardRefs, type CardRef } from "@/data/card-refs";
import {
  findProductByCode,
  findProductByNameAndSet,
  getHistoryPrices,
  type ApitcgProduct,
} from "@/lib/apitcg";
import { findCardInLanguage, cardImageUrl as berryWalletCardImageUrl, type BerryWalletCard, type BerryWalletSet } from "@/lib/berrywallet";
import { getCard as getPokeWalletCard, cardImageUrl as pokeWalletCardImageUrl } from "@/lib/pokewallet";
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
    return findProductByCode(ref.tcg, ref.lookup.code, ref.lookup.variantTags);
  }
  return findProductByNameAndSet(
    ref.tcg,
    ref.lookup.name,
    ref.lookup.setName,
    ref.lookup.number
  );
}

/**
 * BerryWallet match for a One Piece ref with `berryWalletEnabled` set —
 * always English, the canonical page's language (see CardRef's own doc
 * comment on why); the real Japanese alternate is a separate resolution,
 * getOnePieceJapaneseText below, mirroring how getFrenchCardText is a
 * separate call from the canonical Pokémon resolution rather than baked
 * into this same function. Non-fatal on any failure, same resilience shape
 * as resolveTcgdexCard. Only ever attempted for a "code" lookup (every
 * current One Piece ref), since BerryWallet is keyed by card_number the
 * same way apitcg's code lookup is. This supplies identity only (name/set/
 * rarity/image/current price) — price HISTORY still always comes from
 * apitcg below, since BerryWallet has no history endpoint on its free tier
 * (see lib/berrywallet.ts's file header).
 */
async function resolveBerryWalletCard(ref: CardRef): Promise<{ card: BerryWalletCard; set: BerryWalletSet } | undefined> {
  if (ref.tcg !== "one-piece" || !ref.berryWalletEnabled || ref.lookup.by !== "code") return undefined;
  try {
    return await findCardInLanguage(ref.lookup.code, "en", ref.lookup.variantTags);
  } catch (err) {
    logUpstreamOnce(`berrywallet:${ref.slug}`, `[cards] BerryWallet lookup failed for ${ref.slug} — ${describeUpstreamError(err)}`);
    return undefined;
  }
}

/**
 * BerryWallet's own live price for a matched card — prefers TCGPlayer/USD
 * when present (the same currency every other card on this site uses), and
 * falls back to Cardmarket/EUR when it isn't. That fallback is real, not a
 * gap papered over: confirmed live, a Japanese-print card (e.g. Shanks
 * OP09-004 in BerryWallet's JP catalog) has no `tcgplayer` block at all —
 * TCGPlayer's own catalog simply doesn't carry that print — so EUR is the
 * only real price that exists for it. Showing a fabricated USD conversion
 * would be exactly the kind of invented-precision this site's honesty rules
 * exist to prevent elsewhere (see tcgdex.ts's own note on why GBP/CAD stay
 * illustrative rather than converted); a real EUR number is more honest
 * than a fake USD one.
 */
function berryWalletPrice(card: BerryWalletCard): { price: number; currency: "USD" | "EUR"; url?: string; asOfDate?: string } | undefined {
  const tcgplayer = card.tcgplayer?.prices;
  if (tcgplayer?.market_price !== undefined) {
    return { price: tcgplayer.market_price, currency: "USD", url: card.tcgplayer?.url, asOfDate: tcgplayer.updated_at };
  }
  const cardmarket = card.cardmarket?.prices;
  if (cardmarket?.avg !== undefined) {
    return { price: cardmarket.avg, currency: "EUR", url: card.cardmarket?.product_url, asOfDate: cardmarket.updated_at };
  }
  return undefined;
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
  const [product, tcgdexCard, berryWalletMatch] = await Promise.all([
    resolveProduct(ref).catch((err) => {
      logUpstreamOnce(
        `apitcg:${ref.slug}`,
        `[cards] apitcg lookup failed for ${ref.slug} (quota exhausted or outage?) — ${describeUpstreamError(err)}`
      );
      return undefined;
    }),
    resolveTcgdexCard(ref),
    resolveBerryWalletCard(ref),
  ]);

  // Genuinely nothing to build a card from — none of the three sources has
  // a match (or all failed). Always true for a franchise/card combination
  // with no real source at all (e.g. One Piece + TCGdex, unconditionally).
  if (!product && !tcgdexCard && !berryWalletMatch) return undefined;

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
  const berryWalletPriceInfo = berryWalletMatch ? berryWalletPrice(berryWalletMatch.card) : undefined;

  // BerryWallet takes precedence over apitcg for a One Piece ref that has
  // one (real English/Japanese identity beats apitcg's English-only
  // TCGPlayer catalog — the whole reason BerryWallet was wired in), then
  // TCGdex (Pokémon only), then apitcg as the final fallback — same
  // "exclusive, never blended field-by-field" rule the TCGdex/apitcg split
  // already followed: no `berryWallet ?? tcgdex ?? apitcg` chains mixing
  // one source's name with another's image.
  const identity = berryWalletMatch
    ? {
        // BerryWallet's own `name` field bakes the card_number/variant into
        // the string in an inconsistent way across cards (e.g. `Shanks
        // (OP09-004) (V.4)`, `Eustass"Captain"Kid (OP05-074) (Manga)` with
        // no space before the quote) — ref.displayName is the clean,
        // curated name used everywhere a plain character name is wanted
        // (page titles, breadcrumbs, JSON-LD, MCP tool output), same role
        // it already plays in llms.txt/entitymap.ts. The raw variant
        // string is kept too, as printName below — the H1 wants the real
        // print name, not the curated one.
        name: ref.displayName,
        printName: berryWalletMatch.card.name,
        set: berryWalletMatch.set.name,
        setCode: berryWalletMatch.set.set_code,
        number: ref.lookup.by === "code" ? ref.lookup.code : berryWalletMatch.card.card_number,
        rarity: berryWalletMatch.card.rarity,
        types: undefined as string[] | undefined,
        imageUrl: berryWalletCardImageUrl(berryWalletMatch.card.id),
        description: berryWalletMatch.card.ext_description ? stripHtml(berryWalletMatch.card.ext_description) : undefined,
        currentPrice: berryWalletPriceInfo?.price ?? 0,
        currency: berryWalletPriceInfo?.currency ?? "USD",
        sourceUrl: berryWalletPriceInfo?.url,
        asOfDate: berryWalletPriceInfo?.asOfDate ?? new Date().toISOString(),
        // Real Cardmarket EUR snapshot, independent of currentPrice/currency
        // above (which prefer TCGPlayer/USD when it's real) — see Card.
        // cardmarket's own doc comment (lib/types.ts) on why these can both
        // be present at once.
        cardmarket: berryWalletMatch.card.cardmarket
          ? {
              avg: berryWalletMatch.card.cardmarket.prices?.avg,
              low: berryWalletMatch.card.cardmarket.prices?.low,
              trend: berryWalletMatch.card.cardmarket.prices?.trend,
              url: berryWalletMatch.card.cardmarket.product_url,
            }
          : undefined,
      }
    : tcgdexCard
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
          currency: "USD" as const,
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
            currency: "USD" as const,
            sourceUrl: product.markets?.tcgplayer?.url,
            asOfDate: product.updatedAt ?? new Date().toISOString(),
          }
        : undefined;

  // Unreachable given the guard above, but keeps the branches above
  // type-safe (TypeScript can't express "at least one of these three is
  // defined" as a single narrowing) without an unsafe `!`.
  if (!identity) return undefined;

  return {
    id: berryWalletMatch ? berryWalletMatch.card.id : product ? String(product._id) : tcgdexCard!.id,
    slug: ref.slug,
    franchise: ref.franchise,
    character: ref.character,
    ...identity,
    asOfDate: identity.asOfDate.slice(0, 10),
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
  /**
   * Left undefined when the real printed number/set code is the same as
   * the canonical card's — true for French Pokémon (confirmed: French and
   * English prints share one international numbering) and for One Piece
   * (which uses one universal card code across every region — see
   * data/card-refs.ts's berryWalletEnabled comment). Set for Japanese
   * Pokémon specifically, where the printed number is genuinely different
   * from the international one (e.g. Ethan's Typhlosion is 190/182
   * internationally but 070/063 in its real Japanese set) — showing the
   * international number on a page presenting itself as the real Japanese
   * card would be exactly the kind of mismatched-field fabrication this
   * site's honesty rules exist to prevent elsewhere.
   */
  number?: string;
  setCode?: string;
  /** One Piece/getOnePieceJapaneseText only — see Card.printName's own doc comment (lib/types.ts). The real BerryWallet print name in this language, e.g. `"Shanks (OP09-004) (V.4)"` for Japanese. */
  printName?: string;
  /** One Piece/getOnePieceJapaneseText only — see Card.cardmarket's own doc comment (lib/types.ts). This print's own Japanese-catalog Cardmarket listing (avg/low/trend, EUR, and its own product_url) — a genuinely different listing from the English print's, not the same numbers relabeled. */
  cardmarket?: { avg?: number; low?: number; trend?: number; url?: string };
  /** True only when a real translation/match was found — false means every field above is just the canonical original echoed back, never a fabricated translation. */
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
 * Japanese display text for a One Piece card — the One Piece counterpart to
 * getFrenchCardText above, same contract (name/set/rarity/image only,
 * `translated: false` echoes the canonical English fields back rather than
 * fabricating anything) and same non-fatal resilience shape.
 *
 * One real structural difference from the French/TCGdex case: TCGdex's `id`
 * is one stable identifier that a different `lang` path re-fetches
 * translated text for, so getFrenchCardText only needs `card.tcgdexId`.
 * BerryWallet has no such thing — confirmed live, an English print and a
 * Japanese print of "the same" card_number are entirely separate catalog
 * entries with unrelated `op_` ids (see berrywallet.ts's file header), so
 * this needs `ref` for a fresh `findCardInLanguage(code, "jp", ...)`
 * search, the same shape resolveBerryWalletCard already does for English.
 */
export async function getOnePieceJapaneseText(card: Card, ref: CardRef): Promise<LocalizedCardText> {
  const fallback: LocalizedCardText = {
    name: card.name,
    set: card.set,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    translated: false,
  };
  if (!ref.berryWalletEnabled || ref.lookup.by !== "code") return fallback;
  try {
    const match = await findCardInLanguage(ref.lookup.code, "jp", ref.lookup.variantTags);
    if (!match) return fallback;
    return {
      name: card.name, // The curated character name (see resolveBerryWalletCard's own comment) — the character's real name doesn't change across languages here anyway. printName below carries the real Japanese print string.
      printName: match.card.name,
      set: match.set.name,
      // number deliberately NOT overridden: One Piece uses one universal
      // card code across every region (see CardRef's own doc comment), so
      // ref.lookup.code (already card.number) is correct for Japanese too —
      // unlike Pokémon, there's no separate real printed number to show.
      setCode: match.set.set_code,
      // BerryWallet's Japanese-side rows carry drastically less than the
      // English side — confirmed live (op_a9fdca0a... Shanks V.4: rarity,
      // card_type, clean_name, sub_type_name and tcgplayer all null, even
      // from the single-card detail endpoint, not just the set listing).
      // Falling back to the English card's own rarity here isn't a
      // guess-fill: it's the same physical rarity tier, just missing from
      // this specific catalog row.
      rarity: match.card.rarity ?? card.rarity,
      imageUrl: berryWalletCardImageUrl(match.card.id),
      // Unlike rarity/card_type, cardmarket IS reliably present on a
      // Japanese row (confirmed live: op_a9fdca0a... Shanks V.4 carried a
      // full real cardmarket block even with rarity/card_type/tcgplayer all
      // null) — and it's a genuinely different real listing from the
      // English print's, not the same numbers relabeled, so no fallback to
      // card.cardmarket here the way rarity falls back above.
      cardmarket: match.card.cardmarket
        ? {
            avg: match.card.cardmarket.prices?.avg,
            low: match.card.cardmarket.prices?.low,
            trend: match.card.cardmarket.prices?.trend,
            url: match.card.cardmarket.product_url,
          }
        : undefined,
      translated: true,
    };
  } catch (err) {
    logUpstreamOnce(`berrywallet-ja:${ref.slug}`, `[cards] BerryWallet Japanese lookup failed for ${ref.slug} — ${describeUpstreamError(err)}`);
    return fallback;
  }
}

/**
 * Japanese display text for a Pokémon card — the Pokémon counterpart to
 * getOnePieceJapaneseText above, same contract (name/set/rarity/image only,
 * `translated: false` echoes the canonical English fields back) and same
 * non-fatal resilience shape, but a simpler lookup: `ref.pokeWalletCardId`
 * is an already-confirmed id (see that field's own doc comment on why this
 * is stored rather than searched live — automated English->Japanese
 * matching isn't reliable for the specific chase cards this site tracks),
 * so this is a single `getCard(id)` call, not a search.
 */
export async function getJapaneseCardText(card: Card, ref: CardRef): Promise<LocalizedCardText> {
  const fallback: LocalizedCardText = {
    name: card.name,
    set: card.set,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    translated: false,
  };
  if (!ref.pokeWalletCardId) return fallback;
  try {
    const match = await getPokeWalletCard(ref.pokeWalletCardId);
    if (!match) return fallback;
    return {
      name: card.name, // Same reasoning as getOnePieceJapaneseText — the character's real name doesn't change across languages here.
      set: match.card_info.set_name,
      // Genuinely different from card.number here, unlike French/One Piece
      // — confirmed live during this integration's own research (e.g.
      // Ethan's Typhlosion: 190/182 internationally, 070/063 in its real
      // Japanese set) — see LocalizedCardText's own doc comment.
      number: match.card_info.card_number,
      setCode: match.card_info.set_code,
      rarity: match.card_info.rarity ?? card.rarity,
      imageUrl: pokeWalletCardImageUrl(match.id),
      translated: true,
    };
  } catch (err) {
    logUpstreamOnce(`pokewallet-ja:${ref.slug}`, `[cards] PokéWallet Japanese lookup failed for ${ref.slug} — ${describeUpstreamError(err)}`);
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
