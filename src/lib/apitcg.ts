const API_BASE = "https://api.apitcg.com/api";

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
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "x-api-key": apiKey() },
    next: { revalidate: revalidateSeconds },
  });
  if (!res.ok) {
    throw new Error(`apitcg request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

/** Exact lookup by card code, e.g. "OP07-113". Reliable for One Piece. */
export async function findProductByCode(
  tcg: string,
  code: string
): Promise<ApitcgProduct | undefined> {
  const qs = new URLSearchParams({ tcg, type: "card", code, limit: "5" });
  const { data } = await apitcgFetch<ProductsResponse>(`/products?${qs}`, 3600);
  return data.find((p) => p.code === code) ?? data[0];
}

/**
 * Name + set-name search. Used for Pokémon, whose internal `code` format
 * isn't documented — matches on set name and attributes.Number instead.
 */
export async function findProductByNameAndSet(
  tcg: string,
  name: string,
  setName: string,
  number: string
): Promise<ApitcgProduct | undefined> {
  const qs = new URLSearchParams({ tcg, type: "card", name, limit: "25" });
  const { data } = await apitcgFetch<ProductsResponse>(`/products?${qs}`, 3600);
  return data.find(
    (p) =>
      p.set?.name?.toLowerCase() === setName.toLowerCase() &&
      p.attributes?.Number === number
  );
}

export async function getHistoryPrices(
  productId: number,
  limit = 200
): Promise<ApitcgHistoryPrice[]> {
  return apitcgFetch<ApitcgHistoryPrice[]>(
    `/history-prices/${productId}?limit=${limit}`,
    3600
  );
}
