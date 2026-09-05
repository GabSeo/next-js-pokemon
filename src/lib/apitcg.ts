import { memoizeFetch } from "@/lib/memo-fetch";
import { resilientFetch } from "@/lib/upstream";

const API_BASE = "https://api.apitcg.com/api";

/**
 * Collapses redundant identical requests (including failed ones) across
 * every route needing the same card within a single build/warm instance —
 * see memo-fetch.ts's doc comment for the production incident this fixes.
 * 60s comfortably spans a full `next build` static-generation pass without
 * meaningfully delaying production recovery once apitcg.com is back up.
 */
const MEMO_TTL_MS = 60_000;

/**
 * Fails a hung request fast rather than eating fetch's platform default
 * (10s, confirmed live: a Vercel build where apitcg.com was rate-limited
 * AND TCGdex was unreachable timed out on every single card lookup across
 * every route that needed one — product page, its markdown mirror, JSON
 * API, OKF page, French page, French markdown, collections page, homepage,
 * entitymap page — each paying the full 10s independently, since the
 * request-scoped resolveCardSafe cache doesn't carry across separate
 * top-level page builds. That's dozens of 10s waits stacking into enough
 * dead time to blow a build's time budget and get killed with no clean
 * error, which is exactly what happened. This doesn't change what a caller
 * sees on failure (still the same caught-and-degrades-to-illustrative
 * path) — it just bounds how long any one attempt can cost.
 */
const FETCH_TIMEOUT_MS = 6000;

/**
 * How long Next.js's fetch cache treats apitcg.com responses as fresh.
 * apitcg.com's free tier caps at 1000 calls/month; every request that lands
 * after this window elapses triggers a full-catalog refresh (2 calls per
 * card — product lookup + history), so this number directly controls quota
 * burn rate, not just data freshness.
 *
 * 24h, lowered from 36h on 2026-08-29 so the site refreshes once a day.
 * The arithmetic still holds comfortably: ~2 calls x 9 tracked cards = ~18
 * a day, ~540 a month against the 1,000 cap. (At 36h it was ~12/day, ~360
 * a month — the extra freshness costs roughly 180 calls a month.) The
 * ceiling in lib/api-budget.ts is what enforces this rather than trusting
 * the arithmetic; see its own BUDGETS entry for this host.
 */
const REVALIDATE_SECONDS = 60 * 60 * 24;

export type ApitcgImage = { small?: string; medium?: string; large?: string };

export type ApitcgMarketPrices = {
  low?: number;
  mid?: number;
  high?: number;
  market?: number;
};

export type ApitcgMarkets = {
  tcgplayer?: { id?: string; url?: string; prices?: ApitcgMarketPrices };
  tcgmatch?: { id?: string; url?: string; prices?: ApitcgMarketPrices };
};

export type ApitcgSet = {
  _id: string;
  name: string;
  slug: string;
  code?: string;
};

export type ApitcgTcg = { _id: string; name: string };

export type ApitcgProduct = {
  _id: number;
  type: "card" | "sealed" | "accessory" | "other";
  name: string;
  tcg: ApitcgTcg;
  set?: ApitcgSet | null;
  code?: string;
  images?: ApitcgImage[];
  markets?: ApitcgMarkets;
  attributes?: Record<string, string>;
  updatedAt?: string;
};

export type ApitcgHistoryPrice = {
  _id: string;
  product: string;
  date: string;
  markets?: ApitcgMarkets;
};

type ProductsResponse = {
  success: boolean;
  data: ApitcgProduct[];
  total: number;
  fallback?: boolean;
};

function apiKey(): string {
  const key = process.env.APITCG_API_KEY;
  if (!key) {
    throw new Error(
      "APITCG_API_KEY is not set. Add it in Vercel (Project Settings > Environment Variables) and locally in .env.local for dev."
    );
  }
  return key;
}

async function apitcgFetch<T>(path: string, revalidateSeconds: number): Promise<T> {
  return memoizeFetch(path, MEMO_TTL_MS, async () => {
    const res = await resilientFetch(
      `${API_BASE}${path}`,
      // cache: "force-cache" is required, not implied by next.revalidate —
      // this Next version's own fetch reference is explicit that caching is
      // opt-in and that a GET request carrying an auth header (x-api-key,
      // here) is exactly the case force-cache exists to cover. Without it,
      // any render path where this request is discovered after a
      // Request-time API (any Route Handler with dynamic params, e.g.
      // /api/mcp, /api/price-check — see fetch.md's "Request-time APIs"
      // rule) refetches apitcg on every single call, silently ignoring
      // revalidateSeconds. Confirmed as a real, not just theoretical, gap by
      // this codebase's own next.config.ts rewrite comment on
      // /tools/price-checker?cardId=, which documented this exact symptom
      // for the same reason before working around it by rewriting to a
      // static path instead of fixing it here.
      { headers: { "x-api-key": apiKey() }, cache: "force-cache", next: { revalidate: revalidateSeconds } },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      throw new Error(`apitcg request failed (${res.status}): ${path}`);
    }
    return res.json() as Promise<T>;
  });
}

/**
 * Exact lookup by card code, e.g. "OP07-113" — reliable for One Piece,
 * where multiple real print variants (Manga, Alternate Art, Wanted Poster,
 * SP Gold/Silver, assorted promo reprints) routinely share one exact code.
 * Confirmed live: OP09-004 alone returns 9 distinct products for one code,
 * which is also why `limit` is 20 here, not 5 — a low limit risked never
 * even seeing the tagged variant a caller actually wants.
 *
 * `variantTags`, when given, picks the product whose name contains every
 * tag (case-insensitive, full combination — not any-of; see
 * lib/berrywallet.ts's pickVariantByTag for the same rule and the reasoning
 * behind it). Falls back to the first exact-code match — the previous,
 * tag-blind behavior — when no tag combination matches or none are given.
 */
export async function findProductByCode(
  tcg: string,
  code: string,
  variantTags?: string[],
  /** See CodeLookup.excludeTags in data/card-refs.ts. Applied here too, or history attaches to the wrong print. */
  excludeTags?: string[]
): Promise<ApitcgProduct | undefined> {
  const qs = new URLSearchParams({ tcg, type: "card", code, limit: "20" });
  const { data } = await apitcgFetch<ProductsResponse>(`/products?${qs}`, REVALIDATE_SECONDS);
  const candidates = data.filter((p) => p.code === code);
  if (variantTags && variantTags.length > 0) {
    const tagged = candidates.find((p) => {
      const lower = p.name.toLowerCase();
      return (
        variantTags.every((tag) => lower.includes(tag.toLowerCase())) &&
        !excludeTags?.some((tag) => lower.includes(tag.toLowerCase()))
      );
    });
    if (tagged) return tagged;
  }
  return candidates[0] ?? data[0];
}

/**
 * Name + set-name search. Used for Pokémon, whose internal `code` format
 * isn't documented — matches on set name and attributes.Number instead.
 *
 * apitcg.com quirks confirmed against the live API: set names carry a set-
 * code prefix (e.g. "SWSH08: Fusion Strike"), and attributes.Number is a
 * full fraction (e.g. "271/264") rather than just the card number.
 */
export async function findProductByNameAndSet(
  tcg: string,
  name: string,
  setName: string,
  number: string
): Promise<ApitcgProduct | undefined> {
  const qs = new URLSearchParams({ tcg, type: "card", name, limit: "25" });
  const { data } = await apitcgFetch<ProductsResponse>(`/products?${qs}`, REVALIDATE_SECONDS);
  return data.find((p) => {
    const setMatches = p.set?.name?.toLowerCase().includes(setName.toLowerCase());
    const cardNumber = p.attributes?.Number?.split("/")[0];
    return setMatches && cardNumber === number;
  });
}

export async function getHistoryPrices(
  productId: number,
  limit = 100
): Promise<ApitcgHistoryPrice[]> {
  return apitcgFetch<ApitcgHistoryPrice[]>(
    `/history-prices/${productId}?limit=${limit}`,
    REVALIDATE_SECONDS
  );
}
