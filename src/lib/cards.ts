import { cache } from "react";
import { cardRefs, type CardRef } from "@/data/card-refs";
import {
  findProductByCode,
  findProductByNameAndSet,
  getHistoryPrices,
  type ApitcgProduct,
} from "@/lib/apitcg";
import {
  findCardInLanguage,
  findCardmarketSiblings,
  getCard as getBerryWalletCard,
  findJapaneseCardmarket,
  hasCardmarketPrices,
  isJapaneseProduct,
  cardImageUrl as berryWalletCardImageUrl,
  variantIndex as berryWalletVariantIndex,
  type BerryWalletCard,
  type BerryWalletSet,
} from "@/lib/berrywallet";
import {
  getCard as getPokeWalletCard,
  cardImageUrl as pokeWalletCardImageUrl,
  cardmarketStats as pokeWalletCardmarketStats,
} from "@/lib/pokewallet";
import { buildCached } from "@/lib/build-cache";
import { cardmarketUrl } from "@/lib/cardmarket-search";
import { absoluteUrl, freshness } from "@/lib/site";
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
    return findProductByCode(ref.tcg, ref.lookup.code, ref.lookup.variantTags, ref.lookup.excludeTags);
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
async function resolveBerryWalletCard(
  ref: CardRef
): Promise<{ card: BerryWalletCard; set: BerryWalletSet; crossProduct?: boolean } | undefined> {
  if (ref.tcg !== "one-piece" || !ref.berryWalletEnabled || ref.lookup.by !== "code") return undefined;
  try {
    // knownSetCode turns the set search into a single getSetCards call
    // instead of a prefix guess that can miss and fall into a walk — see
    // CardRef.berryWalletSetCode (data/card-refs.ts) for what a miss cost
    // before this existed. Undefined is fine and stays the guess path.
    return await findCardInLanguage(ref.lookup.code, "en", ref.lookup.variantTags, {
      excludeTags: ref.lookup.excludeTags,
      knownSetCode: ref.berryWalletSetCode?.en,
    });
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
  // `!= null` (not `!== undefined`) — BerryWallet sends explicit null, not
  // omission, for a stat it has no data for yet (see
  // BerryWalletCardmarketPrices's doc comment, lib/berrywallet.ts).
  if (cardmarket?.avg != null) {
    return {
      price: cardmarket.avg,
      currency: "EUR",
      url: cardmarketUrl(card.cardmarket?.product_url),
      asOfDate: cardmarket.updated_at,
    };
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
  const [product, tcgdexCard, berryWalletMatch, westernCardmarket, pinnedWestern] = await Promise.all([
    resolveProduct(ref).catch((err) => {
      logUpstreamOnce(
        `apitcg:${ref.slug}`,
        `[cards] apitcg lookup failed for ${ref.slug} (quota exhausted or outage?) — ${describeUpstreamError(err)}`
      );
      return undefined;
    }),
    resolveTcgdexCard(ref),
    resolveBerryWalletCard(ref),
    resolveWesternCardmarket(ref),
    pinnedCardmarket(ref.berryWalletCardmarketId?.en, "western"),
  ]);

  // A One Piece card whose own row has no usable Cardmarket block borrows one
  // from a sibling row that is provably the same TCGplayer product — see
  // findCardmarketSiblings. Sequential rather than in the batch above because
  // it needs the matched row to look up, and it only runs for the cards that
  // actually need it.
  const berryWalletCardmarket =
    berryWalletMatch && !hasCardmarketPrices(berryWalletMatch.card)
      ? (
          await findCardmarketSiblings(berryWalletMatch.card).catch(() => ({
            western: undefined,
            japanese: undefined,
          }))
        ).western
      : undefined;

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
  const history = product
    ? await getHistoryPrices(product._id, HISTORY_LOOKBACK_LIMIT).catch((err) => {
        // Logged rather than swallowed. Falling back to [] is still correct —
        // a card renders fine without a chart, and history is the least
        // important thing on the page — but doing it silently is what made an
        // exhausted api-budget ceiling look like an apitcg outage for weeks:
        // the thrown error was ApiBudgetExceededError, and nothing said so.
        // See docs/knowledge-model.md, "Separate bug".
        logUpstreamOnce(
          `apitcg-history:${ref.slug}`,
          `[cards] apitcg price history failed for ${ref.slug} (chart omitted) — ${describeUpstreamError(err)}`
        );
        return [];
      })
    : [];

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
        // BerryWallet's own TCGplayer block, matching berryWalletPrice's own
        // preference for it. Measured identical to apitcg's figures on every
        // One Piece card checked, which is expected — one upstream, two
        // resellers of it — but taking it from the source that set
        // `currentPrice` keeps that a fact rather than a coincidence to rely on.
        tcgplayer: berryWalletMatch.card.tcgplayer?.prices && {
          low: berryWalletMatch.card.tcgplayer.prices.low_price,
          mid: berryWalletMatch.card.tcgplayer.prices.mid_price,
          high: berryWalletMatch.card.tcgplayer.prices.high_price,
          market: berryWalletMatch.card.tcgplayer.prices.market_price,
          directLow: berryWalletMatch.card.tcgplayer.prices.direct_low_price ?? undefined,
        },
        // Real Cardmarket EUR snapshot, independent of currentPrice/currency
        // above (which prefer TCGPlayer/USD when it's real) — see Card.
        // cardmarket's own doc comment (lib/types.ts) on why these can both
        // be present at once.
        // Prefer a sibling row's Cardmarket block when this row has no usable
        // one — see findCardmarketSiblings. Strictly additive: with no sibling
        // found, this row's own block is used exactly as before, so a card can
        // never lose data it already had by passing through here.
        cardmarket: cardmarketBlock(
          hasCardmarketPrices(berryWalletMatch.card)
            ? berryWalletMatch.card
            : (berryWalletCardmarket ?? berryWalletMatch.card)
        ),
        // The English match's own (V.N) index, computed here since the raw
        // BerryWalletCard is already in hand — see Card.printVariantIndex's
        // own doc comment (lib/types.ts) for why this exists at all and why
        // `null` (a real print, confirmed no V-number) is kept distinct from
        // `undefined` (not resolved via BerryWallet here).
        // `null` when the match came from another product: the index is
        // readable but belongs to that product's tiering, so aligning a
        // Japanese lookup against it compares numbers from two different
        // sets. null is already the documented "resolved, but no index worth
        // aligning" value, so this needs no new state — see
        // pickVariantForJapanese (lib/berrywallet.ts) for what it refuses.
        printVariantIndex: berryWalletMatch.crossProduct ? null : (berryWalletVariantIndex(berryWalletMatch.card) ?? null),
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
          // Straight from the variant tcgplayerSnapshot already chose, so the
          // spread and the headline price are the same reading of the same
          // printing at the same moment.
          tcgplayer: tcgdexPrice?.band,
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
            // apitcg carries no printing name on its price block, so `variant`
            // stays undefined rather than being guessed — the panel simply
            // omits that line instead of attributing the spread to a printing
            // nobody told us about.
            tcgplayer: product.markets?.tcgplayer?.prices && {
              low: product.markets.tcgplayer.prices.low,
              mid: product.markets.tcgplayer.prices.mid,
              high: product.markets.tcgplayer.prices.high,
              market: product.markets.tcgplayer.prices.market,
            },
          }
        : undefined;

  // Unreachable given the guard above, but keeps the branches above
  // type-safe (TypeScript can't express "at least one of these three is
  // defined" as a single narrowing) without an unsafe `!`.
  if (!identity) return undefined;

  return {
    // Identity is the slug here for the same reason placeholderCard already
    // gives it below: it's the only identifier that survives a card resolving
    // through a different upstream next build. Which of the three answered is
    // recorded in `identifiers` instead of quietly becoming the card's name.
    id: ref.slug,
    slug: ref.slug,
    identifiers: [
      ...(berryWalletMatch ? [{ scheme: "berrywallet" as const, value: berryWalletMatch.card.id }] : []),
      ...(product ? [{ scheme: "apitcg" as const, value: String(product._id) }] : []),
      ...(tcgdexCard ? [{ scheme: "tcgdex" as const, value: tcgdexCard.id }] : []),
    ],
    franchise: ref.franchise,
    character: ref.character,
    ...identity,
    // After `...identity` because only the BerryWallet branch sets a
    // `cardmarket` of its own, and only for One Piece — while westernCardmarket
    // is only ever resolved for a Pokémon ref carrying a Western PokéWallet id.
    // The two cannot both be present, and resolving them into one value here
    // keeps that true rather than relying on it.
    //
    // Precedence, highest first: a pinned row, then whichever source resolved
    // one, then a link-only pin. See CardRef's two escape-hatch fields — the
    // link-only one is last so it can never displace real figures.
    ...(() => {
      const cardmarket = withPinnedUrl(
        pinnedWestern ?? westernCardmarket ?? ("cardmarket" in identity ? identity.cardmarket : undefined),
        ref.cardmarketProductUrl?.western,
        "western"
      );
      return cardmarket ? { cardmarket } : {};
    })(),
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
  /**
   * This print's OWN Cardmarket listing — see Card.cardmarket's doc comment
   * (lib/types.ts). Set for both franchises' Japanese text now, and the
   * distinction is the whole point: Cardmarket sells the Japanese print as a
   * separate product from the Western one, so these are genuinely different
   * numbers behind a different product_url, never the Western figures
   * relabeled.
   *
   * French deliberately leaves this undefined. A French copy is not a
   * separate Cardmarket product — it is a language option inside the same
   * Western listing — so the FR page shows the canonical card's Cardmarket
   * block unchanged, which is the correct one for it.
   */
  cardmarket?: Card["cardmarket"];
  /**
   * This print's own TCGplayer figures — market price, the spread behind it,
   * and when the source last refreshed.
   *
   * Japanese Pokémon only. A Japanese card is a separate TCGplayer product
   * with its own price, so a page presenting itself as that card must not
   * quote the Western print's. One Piece leaves these undefined: BerryWallet's
   * Japanese rows carry `tcgplayer: null` outright (see resolveOnePieceJapanese),
   * so those pages fall back to the canonical figures, which is the honest
   * result rather than a gap.
   *
   * French deliberately sets none either — a French copy IS the Western
   * product, so the canonical price is already its own.
   */
  tcgplayer?: Card["tcgplayer"];
  currentPrice?: number;
  sourceUrl?: string;
  asOfDate?: string;
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
 *
 * cache()- and buildCached-wrapped, same pair and same reasoning as
 * resolveCardSafe below — see the LOCALIZED_TEXT_CACHING note on
 * getOnePieceJapaneseText further down for why caching the *fallback*
 * outcome became safe once the per-language routes went away.
 */
/**
 * `translated: false` means no real source answered — which, for these three
 * resolvers, is far more often a network fact than a fact about the card
 * (an upstream timeout, an exhausted budget, an open breaker). Marking it
 * negative keeps it out of the 24h cache tier and re-asks on the next
 * deploy. See NEGATIVE_TTL_MS in lib/build-cache.ts, which exists because
 * this exact case was confirmed live: one TCGdex connect timeout otherwise
 * pinned a card's FR toggle inert for a full day.
 */
const untranslated = (text: LocalizedCardText) => !text.translated;

export const getFrenchCardText = cache((card: Card): Promise<LocalizedCardText> =>
  buildCached(`fr:${card.slug}`, () => resolveFrenchCardText(card), untranslated)
);

async function resolveFrenchCardText(card: Card): Promise<LocalizedCardText> {
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
 *
 * Passes `card.printVariantIndex` straight through as the Japanese
 * search's `knownEnglishVariant` — resolveCard already computed this once,
 * when it resolved the English side to build `card` in the first place, so
 * this call skips a second live English resolution entirely (see
 * findCardInLanguage's own comment on why that's the expensive part, not a
 * nicety). `null` vs `undefined` here matters — see Card.printVariantIndex's
 * own doc comment (lib/types.ts) — so the conversion to
 * findCardInLanguage's `{ index: number | undefined }` shape stays explicit
 * rather than a bare `?? undefined` collapsing the distinction back out.
 */
/**
 * LOCALIZED_TEXT_CACHING — applies to this resolver, getJapaneseCardText
 * below, and getFrenchCardText above.
 *
 * cache()-wrapped for the same reason resolveCardSafe is (see its own
 * comment) — `ref` is always the same object reference (from the shared
 * cardRefs array) and `card` is always resolveCardSafe's own cached result
 * for that ref, so repeat calls within one request/render pass (a page's
 * generateMetadata and its body) share one resolution instead of each
 * re-running the search.
 *
 * ALSO buildCached now, which it deliberately was not before. The old
 * objection was a real correctness problem: /products/[slug]/ja's
 * generateStaticParams only emitted a param when `ja.translated` was true,
 * so a cached *fallback* (from a build where BerryWallet happened to be
 * rate-limited) would keep suppressing that card's real /ja page in every
 * build for the rest of the cache window, even after BerryWallet recovered.
 *
 * That route no longer exists — Japanese identity is rendered into the
 * canonical English page behind a client-side toggle (see
 * components/product-locale.tsx). Nothing's *existence* depends on this
 * answer any more, only whether one flag in a toggle is live or inert on a
 * page that builds identically either way. So the worst case for a cached
 * fallback dropped from "this card has no Japanese page until the cache
 * expires" to "this card's JP toggle is inert for up to ENTRY_TTL_MS", and
 * that is comfortably worth paying: PokéWallet and BerryWallet are the two
 * tightest quotas this app has (100 calls/hour each), and without
 * buildCached this lookup is paid once per static-generation worker rather
 * than once per card, because memo-fetch.ts's memoization is per-process
 * and Next's own fetch Data Cache does not reliably survive worker
 * parallelism (see build-cache.ts's header comment).
 */
export const getOnePieceJapaneseText = cache((card: Card, ref: CardRef): Promise<LocalizedCardText> =>
  buildCached(`ja-one-piece:${ref.slug}`, () => resolveOnePieceJapaneseText(card, ref), untranslated)
);

async function resolveOnePieceJapaneseText(card: Card, ref: CardRef): Promise<LocalizedCardText> {
  const fallback: LocalizedCardText = {
    name: card.name,
    set: card.set,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    // Carried on the FALLBACK too, not only on a resolved match. A hand-pinned
    // Japanese Cardmarket product is the answer for exactly the cards whose
    // identity BerryWallet cannot resolve — monkey-d-luffy-op09-061 and
    // monkey-d-luffy-p-033 both have a real Japanese product and no Japanese
    // identity row — so building it only inside the success path put the
    // escape hatch out of reach of every card that needs one.
    //
    // `translated` stays false: the name and art really are still English, and
    // this says nothing about them. It only means the Japanese LISTING is real
    // and was pinned by hand.
    cardmarket: await japaneseCardmarketWithoutIdentity(card, ref),
    translated: false,
  };
  if (!ref.berryWalletEnabled || ref.lookup.by !== "code") return fallback;
  try {
    const knownEnglishVariant =
      card.printVariantIndex === undefined ? undefined : { index: card.printVariantIndex === null ? undefined : card.printVariantIndex };
    const match = await findCardInLanguage(ref.lookup.code, "jp", ref.lookup.variantTags, {
      excludeTags: ref.lookup.excludeTags,
      knownEnglishVariant,
      // Unset on every ref today — see berryWalletSetCode's own comment on
      // why no Japanese code has been confirmed yet. The `-JP` prefix guess
      // covers the ordinary numbered sets meanwhile, and the walk behind it
      // is bounded now either way.
      knownSetCode: ref.berryWalletSetCode?.jp,
      knownEnglishSetCode: ref.berryWalletSetCode?.en,
    });
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
      // ...but the Cardmarket PRODUCT this row points at is not always the
      // Japanese one. Confirmed live: BerryWallet's Japanese rows for Shanks
      // OP09-004 and Marshall D. Teach OP09-093 both carry an
      // "Emperors-in-the-New-World-Non-English" product — and "-Non-English"
      // is a WESTERN product (the FR/DE/IT/ES printings), not the Japanese
      // one, which Cardmarket suffixes "-Japanese".
      //
      // So resolve it the same way the English branch does: keep this row's
      // block when it already is the Japanese product, else take the
      // "-Japanese" sibling reachable through the shared TCGplayer product.
      cardmarket: withPinnedUrl(
        (await pinnedCardmarket(ref.berryWalletCardmarketId?.jp, "japanese")) ??
          (await japaneseCardmarket(match.card, card, ref.lookup.code)),
        ref.cardmarketProductUrl?.japanese,
        "japanese"
      ),
      // NOTE for whoever adds a card: nothing below falls back to the Western
      // block. A Japanese view showing the Western listing's euros is the one
      // thing this section must never do, however honestly the panel labels
      // it — see page.tsx, where that fallback used to live.
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
 *
 * cache()- and buildCached-wrapped for the same reasons
 * getOnePieceJapaneseText is — see LOCALIZED_TEXT_CACHING on that resolver.
 */
/**
 * A Pokémon card's WESTERN Cardmarket figures, from the same PokéWallet
 * catalog the Japanese toggle already reads.
 *
 * PokéWallet is not a Japanese-only source — it simply only ever got asked
 * for Japanese cards, because `pokeWalletCardId` was the one id this codebase
 * stored and its job was the JP toggle. The Western print is a second stored
 * id away, and it carries the Cardmarket block a Pokémon page had no source
 * for until now: avg, low, trend and Cardmarket's own 1/7/30-day averages.
 *
 * One extra request per Pokémon card per build, against a 60/hour ceiling
 * that three cards were nowhere near (see lib/api-budget.ts). Runs inside
 * resolveCard's existing Promise.all, so it costs latency only if it is the
 * slowest of the four.
 *
 * Errors are already swallowed by getCard, which returns undefined rather
 * than throwing; a card with no Cardmarket block simply renders the panel it
 * rendered before.
 */
/**
 * The Cardmarket block for the Japanese view — the Japanese PRODUCT, which is
 * not always the product BerryWallet's Japanese row points at.
 *
 * Keeps that row's own block whenever it is one — Eustass "Captain" Kid
 * OP05-074 lands on `Awakening-of-the-New-Era-Japanese` and Shanks OP09-004 on
 * `Emperors-in-the-New-World-Non-English`, and isJapaneseProduct accepts both
 * spellings. Only a row carrying neither walks to findJapaneseCardmarket.
 *
 * No fallback to a Western product: labelling one `japanese` would put French
 * and Italian asks under a Japanese heading. An absent block renders as a
 * stated absence, and page.tsx then falls back to the English card's own
 * Cardmarket block, which the panel labels for what it is.
 */
async function japaneseCardmarket(
  japaneseRow: BerryWalletCard,
  english: Card,
  code: string
): Promise<Card["cardmarket"] | undefined> {
  const product = isJapaneseProduct(japaneseRow)
    ? japaneseRow
    : await findJapaneseCardmarket(code, english.cardmarket?.url).catch(() => undefined);
  const block = product && cardmarketBlock(product);
  return block && { ...block, print: "japanese" as const };
}

/**
 * One BerryWallet row's Cardmarket block, in Card.cardmarket's shape.
 *
 * BerryWallet sends explicit null (not omission) for a stat Cardmarket has no
 * data for yet, so every field is normalised here — the one place this crosses
 * into Card.cardmarket's plain `number` fields. See
 * BerryWalletCardmarketPrices's own doc comment (lib/berrywallet.ts).
 */
function cardmarketBlock(card: BerryWalletCard): Card["cardmarket"] | undefined {
  if (!card.cardmarket) return undefined;
  const prices = card.cardmarket.prices;
  return {
    avg: prices?.avg ?? undefined,
    low: prices?.low ?? undefined,
    trend: prices?.trend ?? undefined,
    avg1: prices?.avg1 ?? undefined,
    avg7: prices?.avg7 ?? undefined,
    avg30: prices?.avg30 ?? undefined,
    // Forced onto /en/ — BerryWallet hands back Italian URLs.
    url: cardmarketUrl(card.cardmarket.product_url),
    print: "western" as const,
  };
}

/**
 * The Cardmarket block of one hand-pinned BerryWallet row — CardRef's
 * `berryWalletCardmarketId`, the first of the two escape hatches, used when a
 * real row exists upstream but nothing links it to this card.
 *
 * A pin that resolves to a row with no Cardmarket figures returns undefined
 * rather than an empty block, so a stale or mistyped id degrades to the
 * ordinary derivation instead of blanking a panel that was working.
 */
async function pinnedCardmarket(
  id: string | undefined,
  print: "western" | "japanese"
): Promise<Card["cardmarket"] | undefined> {
  if (!id) return undefined;
  const card = await getBerryWalletCard(id).catch(() => undefined);
  if (!card || !hasCardmarketPrices(card)) return undefined;
  const block = cardmarketBlock(card);
  return block && { ...block, print };
}

/**
 * Applies CardRef's hand-verified `cardmarketProductUrl` to whatever block the
 * pipeline resolved — correcting the LINK and keeping the figures.
 *
 * The upstream failure this exists for is narrow and real: BerryWallet prices
 * the right card and hands back a `product_url` that does not survive contact
 * with Cardmarket. Confirmed by hand on both One Piece promo cards — the
 * OP09-061 row's URL redirects to root, and the P-033 row's opens a different
 * variant listing Chinese copies (the real Japanese product is `-V2`) — while
 * the euros on both rows check out against the real product pages.
 *
 * So this replaces the URL and nothing else. Keeping the figures is a
 * deliberate assertion by whoever adds the pin, that the row prices THIS
 * product; the comment beside each pin has to say it was checked, because
 * nothing in the code can check it (Cardmarket answers automated requests with
 * a CDN bot challenge).
 *
 * With no block to correct, the result is the URL alone — the "Cardmarket
 * lists this print, no price feed we use covers it" state, for a product no
 * source carries a row for.
 */
function withPinnedUrl(
  block: Card["cardmarket"] | undefined,
  url: string | undefined,
  print: "western" | "japanese"
): Card["cardmarket"] | undefined {
  if (!url) return block;
  return { ...block, url: cardmarketUrl(url), print };
}

/**
 * The Japanese Cardmarket product for a One Piece card whose Japanese IDENTITY
 * could not be resolved — the two facts are independent, and treating them as
 * one is what hid real data behind a missing name.
 *
 * Both Luffys are the case in point. BerryWallet has no Japanese identity row
 * for either, so the resolver above returns its fallback before ever asking
 * about Cardmarket — yet `Unnumbered-Promos-Japanese/MonkeyDLuffy-OP09-061`
 * and `Promos-Japanese/MonkeyDLuffy-P-033-V1` both exist and both share a
 * TCGplayer product with the Western listing this page already quotes, which
 * is exactly the link findJapaneseCardmarket walks. The data was reachable the
 * whole time; nothing was asking.
 *
 * A pinned row wins over the derivation, and a pinned URL is then applied to
 * whichever of them answered — see withPinnedUrl.
 */
async function japaneseCardmarketWithoutIdentity(card: Card, ref: CardRef): Promise<Card["cardmarket"] | undefined> {
  const resolved =
    (await pinnedCardmarket(ref.berryWalletCardmarketId?.jp, "japanese")) ??
    (await derivedJapaneseCardmarket(card, ref));
  return withPinnedUrl(resolved, ref.cardmarketProductUrl?.japanese, "japanese");
}

/** The Japanese product reachable from the Western one, for a card with no Japanese identity row. */
async function derivedJapaneseCardmarket(card: Card, ref: CardRef): Promise<Card["cardmarket"] | undefined> {
  if (!ref.berryWalletEnabled || ref.lookup.by !== "code") return undefined;
  const product = await findJapaneseCardmarket(ref.lookup.code, card.cardmarket?.url).catch(() => undefined);
  const block = product && cardmarketBlock(product);
  return block && { ...block, print: "japanese" as const };
}

/** The Pokémon side of the above — pins only; the BerryWallet walk is One Piece's. */
async function pinnedJapaneseCardmarket(ref: CardRef): Promise<Card["cardmarket"] | undefined> {
  return withPinnedUrl(
    await pinnedCardmarket(ref.berryWalletCardmarketId?.jp, "japanese"),
    ref.cardmarketProductUrl?.japanese,
    "japanese"
  );
}

async function resolveWesternCardmarket(ref: CardRef): Promise<Card["cardmarket"] | undefined> {
  if (!ref.pokeWalletWesternCardId) return undefined;
  const match = await getPokeWalletCard(ref.pokeWalletWesternCardId);
  if (!match) return undefined;
  const stats = pokeWalletCardmarketStats(match);
  return stats && { ...stats, print: "western" as const };
}

export const getJapaneseCardText = cache((card: Card, ref: CardRef): Promise<LocalizedCardText> =>
  buildCached(`ja-pokemon:${ref.slug}`, () => resolveJapaneseCardText(card, ref), untranslated)
);

async function resolveJapaneseCardText(card: Card, ref: CardRef): Promise<LocalizedCardText> {
  const fallback: LocalizedCardText = {
    name: card.name,
    set: card.set,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    // Same reason as the One Piece resolver's own fallback above.
    cardmarket: await pinnedJapaneseCardmarket(ref),
    translated: false,
  };
  if (!ref.pokeWalletCardId) return fallback;
  try {
    const match = await getPokeWalletCard(ref.pokeWalletCardId);
    if (!match) return fallback;

    // The Japanese print's own TCGplayer listing. All four price fields below
    // come from this one block or none of them do — PokéWallet returns an
    // EMPTY `prices` array for a Japanese print TCGplayer does not carry
    // (confirmed live: Gengar VMAX's High-Class Deck promo, `tcgplayer: []`,
    // while Lugia V and Ethan's Typhlosion both have real ones), and the page
    // then falls back to the canonical Western figures as a set rather than
    // showing a Japanese price above a Western spread.
    //
    // Deliberately NOT pokeWalletPrice(), which falls back to Cardmarket/EUR
    // when TCGplayer has nothing. That returned €2,200 for Gengar, and the
    // panel — which reads its currency from the card, not the price — printed
    // it as "USD 2 200,00" over the Western spread. Reading the TCGplayer
    // block directly is what makes USD structurally true here.
    const jaTcg = match.tcgplayer?.prices?.[0];
    const jaBand = jaTcg?.market_price === undefined ? undefined : jaTcg;
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
      // The Japanese print's own Cardmarket product, which is a different
      // listing from the Western one this card's page otherwise shows — same
      // catalog, same call, and it was being discarded until now.
      // Same precedence as the Western side and the One Piece Japanese side:
      // PokéWallet's own figures when it has them, then a link-only pin. No
      // BerryWallet pin here — that escape hatch is One Piece's, and a Pokémon
      // card's Japanese row is already pinned by `pokeWalletCardId` itself.
      cardmarket: withPinnedUrl(
        (() => {
          const stats = pokeWalletCardmarketStats(match);
          return stats && { ...stats, print: "japanese" as const };
        })(),
        ref.cardmarketProductUrl?.japanese,
        "japanese"
      ),
      currentPrice: jaBand?.market_price,
      sourceUrl: jaBand && match.tcgplayer?.url,
      asOfDate: jaBand?.updated_at,
      tcgplayer: jaBand && {
        low: jaBand.low_price,
        mid: jaBand.mid_price,
        high: jaBand.high_price,
        market: jaBand.market_price,
        directLow: jaBand.direct_low_price ?? undefined,
        variant: jaBand.sub_type_name,
      },
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
 *
 * The whole outcome (a real card OR the placeholder fallback) is also
 * wrapped in buildCached — see that module's own header comment for why:
 * cache() above only shares one *request's* worth of calls, but this same
 * ref gets independently re-resolved by roughly a dozen different routes
 * during static generation, and buildCached is what collapses that back
 * down to one real resolution per card per build.
 */
const resolveCardSafe = cache(async (ref: CardRef): Promise<Card> => {
  return buildCached(`card:${ref.slug}`, async () => {
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
  },
  // Two shapes of degraded result, both taking build-cache.ts's short TTL
  // rather than the 24h one.
  //
  // 1. The offline placeholder. `priceUnavailable` means no source could be
  //    reached — a fact about the network, not the card. Pinning it for a
  //    day would keep showing "temporarily unavailable" long after the
  //    upstream recovered.
  //
  // 2. A Pokémon card with no `tcgdexId`. This one is subtler and was
  //    missed the first time, with a confirmed consequence: a build during
  //    a TCGdex outage resolves the card from apitcg instead, which yields
  //    a REAL price and so looked like a success worth caching for 24h —
  //    but with no tcgdexId, and getFrenchCardText short-circuits on
  //    exactly that field. The result was French staying inert for a full
  //    day after TCGdex came back, on a card that otherwise looked fine.
  //    Degraded, not failed, is still not worth a day of trust.
  //
  // The cost of being wrong here is bounded and asymmetric, which is why
  // this errs toward re-asking: TCGdex itself is free and unmetered. The
  // one thing to know is that re-resolving replays the whole fan-out,
  // including apitcg's 2 metered calls — so a Pokémon ref that TCGdex
  // genuinely cannot match (none today; all three are confirmed matches)
  // would re-resolve every NEGATIVE_TTL_MS during builds. If that ever
  // happens, give that ref a real TCGdex id rather than loosening this.
  (card) => card.priceUnavailable === true || (card.franchise === "pokemon" && !card.tcgdexId));
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
/**
 * True when `query` names this card — by its canonical id (the slug) or by any
 * upstream id it carries. The identifier arm is what keeps `/api/pokemon/44233`
 * and `/api/pokemon/swsh12-186` alive now that neither is the card's identity:
 * an id that was ever handed out has to keep resolving, it just stops being the
 * answer we give back.
 */
function matchesIdentity(card: Card, query: string): boolean {
  return (
    card.id === query ||
    card.slug === query ||
    (card.identifiers?.some((i) => i.value === query) ?? false)
  );
}

export async function getCardByIdOrSlug(
  franchise: Franchise,
  idOrSlug: string
): Promise<Card | undefined> {
  const bySlug = cardRefs.find((r) => r.franchise === franchise && r.slug === idOrSlug);
  if (bySlug) return resolveCardSafe(bySlug);

  const cards = await getCardsByFranchise(franchise);
  return cards.find((c) => matchesIdentity(c, idOrSlug));
}

export async function getCardById(id: string): Promise<Card | undefined> {
  const cards = await getAllCards();
  return cards.find((c) => matchesIdentity(c, id));
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
    // Published so a consumer can join this card to apitcg/TCGdex/BerryWallet
    // without guessing which catalog an id came from — and so it's visible
    // that `id` is ours and these are theirs.
    ...(card.identifiers?.length ? { identifiers: card.identifiers } : {}),
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
    // When this copy was built and when to come back. asOfDate above is the
    // upstream's pricing date and answers a different question — see
    // freshness() in lib/site.ts.
    ...freshness(),
  };
}
