/**
 * TCGGO's "CardMarket API TCG" (multi-game) product on RapidAPI — the
 * planned replacement for apitcg.ts. Not wired into cards.ts yet; this file
 * only exists so the client can be written and typechecked ahead of having
 * a real key. See design-loop-progress.md / chat history for the decision:
 * single multi-game API over a Pokémon-only one + apitcg.com hybrid, since
 * this product covers both Pokémon and One Piece at the same price.
 *
 * Schema confirmed against TCGGO's own OpenAPI spec (the Pokémon-only
 * "Pokémon TCG API" listing's full YAML/JSON, cross-checked against the
 * multi-game listing's server/auth/tag headers before the doc fetch got
 * rate-limited) — both listings share identical schema/field names, the
 * only difference is every path here is prefixed with the game slug.
 */

import { memoizeFetch } from "@/lib/memo-fetch";
import { resilientFetch } from "@/lib/upstream";

const API_BASE = "https://cardmarket-api-tcg.p.rapidapi.com";

/** Same reasoning as apitcg.ts/tcgdex.ts/berrywallet.ts: fail a hung request fast rather than eating fetch's platform default. */
const FETCH_TIMEOUT_MS = 6000;

/**
 * This host is one credential, so the breaker's default host key is already
 * right — named explicitly only so the string that api-budget.ts's BUDGETS
 * is keyed by lives next to the client that spends it, the same way
 * berrywallet.ts/pokewallet.ts name theirs.
 */
const RATE_LIMIT_BUCKET = "cardmarket-api-tcg.p.rapidapi.com";

/** Matches CardRef["tcg"] in @/data/card-refs — same slug format TCGGO uses. */
export type TcggoGame = "pokemon" | "one-piece";

/**
 * Same 24h window as apitcg.ts's REVALIDATE_SECONDS, for the same reason:
 * controls quota burn against the free tier's 100 req/day, not just
 * freshness. Revisit once real traffic patterns are known.
 */
const REVALIDATE_SECONDS = 60 * 60 * 24;

export type TcggoPaging = { current: number; total: number; per_page: number };

export type TcggoGradedPrices = Record<string, Record<string, number>>;

export type TcggoCardmarketPrices = {
  currency?: string;
  lowest_near_mint?: number;
  lowest_near_mint_EU_only?: number;
  lowest_near_mint_DE?: number;
  lowest_near_mint_DE_EU_only?: number;
  lowest_near_mint_FR?: number;
  lowest_near_mint_FR_EU_only?: number;
  lowest_near_mint_ES?: number;
  lowest_near_mint_ES_EU_only?: number;
  lowest_near_mint_IT?: number;
  lowest_near_mint_IT_EU_only?: number;
  /** Grouped by grading company (psa/bgs/cgc), e.g. graded.psa.psa10 */
  graded?: TcggoGradedPrices;
};

export type TcggoEbayGradedEntry = { median_price: number; sample_size: number };

export type TcggoEbayPrices = {
  currency?: string;
  /** Grouped by company (psa/bgs/cgc/sgc/ace/tag), then grade ("10", "9", ...) */
  graded?: Record<string, Record<string, TcggoEbayGradedEntry>>;
};

export type TcggoCardPrices = {
  cardmarket?: TcggoCardmarketPrices;
  ebay?: TcggoEbayPrices | null;
};

export type TcggoEpisode = {
  id: number;
  name: string;
  slug: string;
  released_at?: string;
  logo?: string;
  code?: string;
  cards_total?: number;
  cards_printed_total?: number;
};

export type TcggoArtist = { id: number; name: string; slug: string };

export type TcggoCard = {
  id: number;
  name: string;
  name_numbered?: string;
  slug: string;
  type?: string;
  card_number?: string;
  hp?: number;
  rarity?: string;
  supertype?: string;
  tcgid?: string;
  cardmarket_id?: number;
  tcgplayer_id?: number | null;
  flavor_text?: string | null;
  prices?: TcggoCardPrices;
  episode?: TcggoEpisode;
  artist?: TcggoArtist | null;
  image?: string;
  tcggo_url?: string;
  links?: { cardmarket?: string; tcgplayer?: string };
};

export type TcggoHistoryPrice = {
  date: string;
  cm_low?: number;
  tcg_player_market?: number | null;
};

export type TcggoEbaySoldPrice = {
  company: string;
  grade: string;
  median_price: number;
  sample_size: number;
};

export type TcggoEbaySoldOffer = {
  ebay_item_id: string;
  title: string;
  price: number;
  currency: string;
  company: string;
  grade: string;
  image_url?: string | null;
  url: string;
  ended_at?: string | null;
};

type CardsResponse = { data: TcggoCard[]; paging: TcggoPaging; results: number };
type CardResponse = { data: TcggoCard };
type HistoryPricesResponse = { data: Record<string, TcggoHistoryPrice>; paging: TcggoPaging; results: number };
type EbaySoldPricesResponse = { data: TcggoEbaySoldPrice[]; item_id: number; results: number };
type EbaySoldOffersResponse = { data: TcggoEbaySoldOffer[]; paging: TcggoPaging; results: number };

function apiKey(): string {
  const key = process.env.TCGGO_API_KEY;
  if (!key) {
    throw new Error(
      "TCGGO_API_KEY is not set. Add it in Vercel (Project Settings > Environment Variables) and locally in .env.local for dev."
    );
  }
  return key;
}

/**
 * Every TCGGO call goes through here, and it deliberately looks exactly
 * like berrywallet.ts's and pokewallet.ts's equivalents rather than the
 * plain `fetch` this file was scaffolded with. Three things that plain
 * fetch was missing, each one already load-bearing elsewhere in this
 * codebase:
 *
 * - `resilientFetch` (lib/upstream.ts) — bounded timeout, one retry, and
 *   the per-host circuit breaker. Without it a TCGGO outage would be
 *   retried once per route x card with no backoff, the exact failure that
 *   module was written for.
 * - `chargeApiBudget`, which resilientFetch applies for us. This matters
 *   more here than anywhere else: TCGGO's free tier (100/day, 30/min) is
 *   the tightest quota in the system, and a raw fetch bypasses metering
 *   entirely — the calls would be invisible to
 *   scripts/api-budget-report.mjs and unstoppable by the ceiling.
 * - `cache: "force-cache"` — required, not implied by `next.revalidate`
 *   alone on this Next version, and doubly so for a GET carrying an API-key
 *   header. This is the same defect the API audit found in every other
 *   client; the scaffold predates that fix and never received it.
 *
 * memoizeFetch keyed by the full path (not just the id) collapses the
 * repeat identical lookups a build makes for one card across routes, and
 * caches failures too — see that module's own header on why the failure
 * half matters against a metered upstream.
 */
async function tcggoFetch<T>(
  game: TcggoGame,
  path: string,
  revalidateSeconds: number
): Promise<T> {
  const url = `${API_BASE}/${game}${path}`;
  return memoizeFetch(url, revalidateSeconds * 1000, async () => {
    const res = await resilientFetch(
      url,
      {
        headers: { "x-rapidapi-key": apiKey() },
        cache: "force-cache",
        next: { revalidate: revalidateSeconds },
      },
      FETCH_TIMEOUT_MS,
      RATE_LIMIT_BUCKET
    );
    if (!res.ok) {
      throw new Error(`tcggo request failed (${res.status}): /${game}${path}`);
    }
    return res.json() as Promise<T>;
  });
}

/**
 * Exact lookup by card_number (e.g. "OP07-113" for One Piece). Mirrors
 * apitcg's findProductByCode — same CardRef["lookup"]["by"] === "code" case.
 */
export async function findCardByCode(
  game: TcggoGame,
  code: string
): Promise<TcggoCard | undefined> {
  const qs = new URLSearchParams({ card_number: code, per_page: "5" });
  const { data } = await tcggoFetch<CardsResponse>(game, `/cards?${qs}`, REVALIDATE_SECONDS);
  return data.find((c) => c.card_number === code) ?? data[0];
}

/**
 * name + card_number combo — TCGGO's docs call this out as the reliable
 * combo for ambiguous numbering. Mirrors apitcg's findProductByNameAndSet
 * (CardRef["lookup"]["by"] === "nameSet" case), but TCGGO's own numbering
 * doesn't need a separate set-name filter the way apitcg's did.
 */
export async function findCardByNameAndNumber(
  game: TcggoGame,
  name: string,
  number: string
): Promise<TcggoCard | undefined> {
  const qs = new URLSearchParams({ name, card_number: number, per_page: "5" });
  const { data } = await tcggoFetch<CardsResponse>(game, `/cards?${qs}`, REVALIDATE_SECONDS);
  return data[0];
}

export async function getCard(game: TcggoGame, cardId: number): Promise<TcggoCard | undefined> {
  const { data } = await tcggoFetch<CardResponse>(game, `/cards/${cardId}`, REVALIDATE_SECONDS);
  return data;
}

/** Daily cm_low + tcg_player_market history, keyed by date. */
export async function getHistoryPrices(
  game: TcggoGame,
  itemId: number,
  limit = 100
): Promise<TcggoHistoryPrice[]> {
  const qs = new URLSearchParams({ id: String(itemId), per_page: String(limit) });
  const { data } = await tcggoFetch<HistoryPricesResponse>(
    game,
    `/history-prices?${qs}`,
    REVALIDATE_SECONDS
  );
  return Object.values(data);
}

/** Median graded prices from recent eBay sold listings, one entry per company+grade. */
export async function getEbaySoldPrices(
  game: TcggoGame,
  itemId: number
): Promise<TcggoEbaySoldPrice[]> {
  const qs = new URLSearchParams({ id: String(itemId) });
  const { data } = await tcggoFetch<EbaySoldPricesResponse>(
    game,
    `/ebay-sold-prices?${qs}`,
    REVALIDATE_SECONDS
  );
  return data;
}

/** Individual eBay sold listings (graded), newest first. */
export async function getEbaySoldOffers(
  game: TcggoGame,
  itemId: number,
  opts: { company?: string; grade?: string; perPage?: number } = {}
): Promise<TcggoEbaySoldOffer[]> {
  const qs = new URLSearchParams({ id: String(itemId) });
  if (opts.company) qs.set("company", opts.company);
  if (opts.grade) qs.set("grade", opts.grade);
  if (opts.perPage) qs.set("per_page", String(opts.perPage));
  const { data } = await tcggoFetch<EbaySoldOffersResponse>(
    game,
    `/ebay-sold-offers?${qs}`,
    REVALIDATE_SECONDS
  );
  return data;
}
