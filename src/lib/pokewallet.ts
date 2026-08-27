/**
 * PokéWallet — Pokémon card data from pokewallet.io, BerryWallet's sibling
 * product (same host, same API key — see berrywallet.ts's file header).
 * Picked specifically because it's the only source found with a real,
 * separate Japanese Pokémon catalog: TCGdex (this site's existing Pokémon
 * identity/French source) has zero Japanese coverage at all, confirmed live
 * (api.tcgdex.net/v2/ja/... and assets.tcgdex.net/ja/... both 404).
 *
 * Unlike BerryWallet's One Piece side, this client does NOT do a live
 * name/number search to find a card's Japanese counterpart — confirmed live
 * during this integration's own research that it can't be done reliably by
 * automation: English and Japanese Pokémon releases routinely diverge in
 * ways no consistent rule covers. Base-set cards map cleanly by sequence
 * number (English "SV10: Destined Rivals" 001/182 = Japanese "SV9a: Heat
 * Wave Arena" 001/063 — confirmed against multiple cards), but the specific
 * alt-art/secret-rare chase prints this site actually tracks routinely
 * don't: Gengar VMAX's real Japanese counterpart isn't in the mainline set
 * at all, it's a standalone "High-Class Deck" promotional product; Ethan's
 * Typhlosion's is in the mainline Japanese set but at an unrelated number
 * (070/063, not corresponding to its English 190/182 the way base cards
 * do). Each of the 3 tracked cards' real match was confirmed by hand this
 * session — searching by name, then cross-referencing rarity tier and real
 * price against the English card's own known price (e.g. Lugia V:
 * candidate `110/098` at $474.99/€818.50 matches the English card's real
 * $526.43 almost exactly; the same search's other candidate, `109/098`, is
 * a different, unrelated $16 print) — so this file just resolves an
 * already-confirmed id, the same "store the verified answer, don't
 * re-derive a fragile one live" choice card-refs.ts's own pokeWalletCardId
 * field documents.
 */

const API_BASE = "https://api.pokewallet.io";

/** Same reasoning as apitcg.ts/tcgdex.ts/berrywallet.ts: fail a hung request fast rather than eating fetch's platform default. */
const FETCH_TIMEOUT_MS = 6000;

/** Same 36h window as this codebase's other card-identity sources. */
const REVALIDATE_SECONDS = 60 * 60 * 36;

import { memoizeFetch } from "@/lib/memo-fetch";
import { resilientFetch } from "@/lib/upstream";

export type PokeWalletPriceEntry = {
  low_price?: number;
  mid_price?: number;
  high_price?: number;
  market_price?: number;
  updated_at?: string;
};

export type PokeWalletCardmarketPrice = {
  avg?: number | null;
  low?: number | null;
  trend?: number;
  updated_at?: string;
  variant_type?: string;
};

export type PokeWalletCard = {
  id: string;
  card_info: {
    name: string;
    clean_name?: string;
    set_name: string;
    set_code: string;
    card_number: string;
    rarity?: string;
    card_type?: string;
    card_text?: string | null;
  };
  images?: { languages: string[] };
  tcgplayer?: { prices?: PokeWalletPriceEntry[]; url?: string } | null;
  cardmarket?: { product_name?: string; prices?: PokeWalletCardmarketPrice[]; product_url?: string } | null;
};

type CardResponse = PokeWalletCard;

function apiKey(): string {
  const key = process.env.POKEWALLET_API_KEY;
  if (!key) {
    throw new Error(
      "POKEWALLET_API_KEY is not set. Add it in Vercel (Project Settings > Environment Variables) and locally in .env.local for dev. One key covers both PokéWallet and BerryWallet."
    );
  }
  return key;
}

async function pokeWalletFetch<T>(path: string, revalidateSeconds: number): Promise<T> {
  return memoizeFetch(path, revalidateSeconds * 1000, async () => {
    const res = await resilientFetch(
      `${API_BASE}${path}`,
      // cache: "force-cache" — see apitcg.ts's apitcgFetch for why this is
      // required (not implied by next.revalidate alone) on this Next
      // version, doubly so here: a GET carrying an X-API-Key header is
      // exactly the case the fetch reference calls out as needing it.
      { headers: { "X-API-Key": apiKey() }, cache: "force-cache", next: { revalidate: revalidateSeconds } },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      throw new Error(`pokewallet request failed (${res.status}): ${path}`);
    }
    return res.json() as Promise<T>;
  });
}

/** Full detail for one already-known card id (a `pk_`-prefixed id, confirmed and stored on the matching CardRef — see this file's own header comment). */
export async function getCard(id: string): Promise<PokeWalletCard | undefined> {
  try {
    return await pokeWalletFetch<CardResponse>(`/cards/${encodeURIComponent(id)}`, REVALIDATE_SECONDS);
  } catch {
    return undefined;
  }
}

/** Same auth constraint as berrywallet.ts's fetchCardImage — /images/:id needs the X-API-Key header a browser <img> can't send, so this has to be fetched server-side and proxied. See app/api/pokewallet-image/[id]/route.ts. */
export async function fetchCardImage(id: string, size: "low" | "high" = "high"): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | undefined> {
  const res = await fetch(`${API_BASE}/images/${encodeURIComponent(id)}?size=${size}`, {
    headers: { "X-API-Key": apiKey() },
    // force-cache — same reasoning as pokeWalletFetch above. This route
    // (app/api/pokewallet-image/[id]/route.ts) already sends a year-long
    // immutable Cache-Control to the browser/CDN, but that only helps once
    // an edge has actually cached the response; force-cache is what keeps
    // *this* server-side fetch from re-hitting pokewallet.io with the API
    // key on every cold/uncached-region request in the meantime.
    cache: "force-cache",
    next: { revalidate: REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) return undefined;
  return { body: res.body, contentType: res.headers.get("content-type") ?? "image/jpeg" };
}

/** The browser-facing URL for a card's image — our own proxy route, not PokéWallet's directly (see fetchCardImage's doc comment on why). */
export function cardImageUrl(id: string, size: "low" | "high" = "high"): string {
  return `/api/pokewallet-image/${encodeURIComponent(id)}?size=${size}`;
}

/** Prefers TCGPlayer/USD (matches every other card on this site) — same fallback shape as berrywallet.ts's own price picker, though every card confirmed on this file has a real USD price so the EUR branch is defensive, not expected to fire in practice today. */
export function pokeWalletPrice(card: PokeWalletCard): { price: number; currency: "USD" | "EUR"; url?: string; asOfDate?: string } | undefined {
  const tcg = card.tcgplayer?.prices?.[0];
  if (tcg?.market_price !== undefined) {
    return { price: tcg.market_price, currency: "USD", url: card.tcgplayer?.url ?? undefined, asOfDate: tcg.updated_at };
  }
  const cm = card.cardmarket?.prices?.find((p) => p.avg !== null && p.avg !== undefined);
  if (cm?.avg !== undefined && cm?.avg !== null) {
    return { price: cm.avg, currency: "EUR", url: card.cardmarket?.product_url ?? undefined, asOfDate: cm.updated_at };
  }
  return undefined;
}
