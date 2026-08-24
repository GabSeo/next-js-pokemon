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
 * burn rate, not just data freshness. 36h keeps a full month of steady
 * traffic well under budget without needing per-route logic.
 */
const REVALIDATE_SECONDS = 60 * 60 * 36;

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
      { headers: { "x-api-key": apiKey() }, next: { revalidate: revalidateSeconds } },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      throw new Error(`apitcg request failed (${res.status}): ${path}`);
    }
    return res.json() as Promise<T>;
  });
}

/** Exact lookup by card code, e.g. "OP07-113". Reliable for One Piece. */
export async function findProductByCode(
  tcg: string,
  code: string
): Promise<ApitcgProduct | undefined> {
  const qs = new URLSearchParams({ tcg, type: "card", code, limit: "5" });
  const { data } = await apitcgFetch<ProductsResponse>(`/products?${qs}`, REVALIDATE_SECONDS);
  return data.find((p) => p.code === code) ?? data[0];
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
