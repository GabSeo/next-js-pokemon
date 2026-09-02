/**
 * PokéWallet — Pokémon card data from pokewallet.io, BerryWallet's sibling
 * product (same host, api.pokewallet.io — see berrywallet.ts's file header).
 * Each has its own separate API key (POKEWALLET_API_KEY here,
 * BERRYWALLET_API_KEY there) so Pokémon and One Piece traffic no longer
 * share one quota against pokewallet.io's own per-key rate limit — see
 * RATE_LIMIT_BUCKET below and resilientFetch's `rateLimitKey` doc comment
 * (upstream.ts) for how the two stay independent all the way through the
 * circuit breaker, not just at the credential level.
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

/** Same 24h window as this codebase's other card-identity sources. */
const REVALIDATE_SECONDS = 60 * 60 * 24;

import { cardmarketUrl } from "@/lib/cardmarket-search";
import { memoizeFetch } from "@/lib/memo-fetch";
import { resilientFetch } from "@/lib/upstream";

export type PokeWalletPriceEntry = {
  low_price?: number;
  mid_price?: number;
  high_price?: number;
  market_price?: number;
  direct_low_price?: number | null;
  /** Which printing this row prices, e.g. "Holofoil". Confirmed live; the type was missing it. */
  sub_type_name?: string;
  updated_at?: string;
};

export type PokeWalletCardmarketPrice = {
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  /**
   * Cardmarket's own rolling averages over the trailing 1, 7 and 30 days —
   * the "1-day / 7-days / 30-days average price" rows on a Cardmarket product
   * page, sent verbatim.
   *
   * Confirmed live and previously absent from this type, which is why nothing
   * could read them: the API has been sending three extra numbers per variant
   * that the codebase did not know existed. Null (not omitted) when Cardmarket
   * has no data for that window yet, the same shape as `avg`/`low` above.
   */
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  updated_at?: string;
  /** Which printing these prices belong to — "normal", "holo", ... */
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
  tcgplayer?: { prices?: PokeWalletPriceEntry[]; url?: string } | null;
  cardmarket?: { product_name?: string; prices?: PokeWalletCardmarketPrice[]; product_url?: string } | null;
  /**
   * Which languages PokéWallet holds an IMAGE in — not, as it first appears,
   * which languages the card is sold in. A Western print happens to report
   * `["en","it","fr","de","es","pt"]`, which looks exactly like Cardmarket's
   * Western language set and is tempting to read as one; the Japanese prints
   * report `["en"]`, which settles it. Nothing derives language coverage from
   * this field for that reason.
   */
  images?: { languages?: string[] };
};

/** One card's Cardmarket figures, nulls normalised away and the source's own product URL kept. */
export type PokeWalletCardmarketStats = {
  avg?: number;
  low?: number;
  trend?: number;
  avg1?: number;
  avg7?: number;
  avg30?: number;
  url?: string;
  /** Which printing the figures describe — "normal", "holo". */
  variant?: string;
  updatedAt?: string;
};

/**
 * The Cardmarket block for a PokéWallet card, ready for Card.cardmarket.
 *
 * Prices arrive as an array with one entry per printing ("normal", "holo"),
 * and on every card checked only one of them carries real numbers while the
 * others are all-null placeholders — so this picks the first entry that has
 * any real figure rather than blindly taking `[0]`, which would have returned
 * an empty row on a card whose holo variant happens to be listed first.
 *
 * Every field is normalised from `null` to `undefined` here, the one place
 * this crosses into Card.cardmarket's plain `number` fields — same contract
 * as cards.ts already applies to BerryWallet's identical shape.
 */
export function cardmarketStats(card: PokeWalletCard): PokeWalletCardmarketStats | undefined {
  const prices = card.cardmarket?.prices;
  if (!prices?.length) return undefined;

  const real = prices.find(
    (p) => p.avg != null || p.low != null || p.avg1 != null || p.avg7 != null || p.avg30 != null
  );
  if (!real) return undefined;

  return {
    avg: real.avg ?? undefined,
    low: real.low ?? undefined,
    trend: real.trend ?? undefined,
    avg1: real.avg1 ?? undefined,
    avg7: real.avg7 ?? undefined,
    avg30: real.avg30 ?? undefined,
    url: cardmarketUrl(card.cardmarket?.product_url),
    variant: real.variant_type,
    updatedAt: real.updated_at,
  };
}

type CardResponse = PokeWalletCard;

/**
 * PokéWallet's own credential — separate from BerryWallet's
 * BERRYWALLET_API_KEY (see that file's own apiKey() comment) even though
 * both point at the same host, api.pokewallet.io. Two separate keys means
 * two separate quotas rather than Pokémon and One Piece traffic sharing one
 * — see RATE_LIMIT_BUCKET below and resilientFetch's own `rateLimitKey` doc
 * comment (upstream.ts) for how that's kept true all the way through the
 * circuit breaker, not just at the credential level.
 */
function apiKey(): string {
  const key = process.env.POKEWALLET_API_KEY;
  if (!key) {
    throw new Error(
      "POKEWALLET_API_KEY is not set. Add it in Vercel (Project Settings > Environment Variables) and locally in .env.local for dev."
    );
  }
  return key;
}

/** Keeps this credential's circuit breaker independent from BerryWallet's own (see berrywallet.ts's RATE_LIMIT_BUCKET) despite sharing api.pokewallet.io as a literal host — see resilientFetch's `rateLimitKey` param (upstream.ts). */
const RATE_LIMIT_BUCKET = "api.pokewallet.io#pokewallet";

async function pokeWalletFetch<T>(path: string, revalidateSeconds: number): Promise<T> {
  return memoizeFetch(path, revalidateSeconds * 1000, async () => {
    const res = await resilientFetch(
      `${API_BASE}${path}`,
      // cache: "force-cache" — see apitcg.ts's apitcgFetch for why this is
      // required (not implied by next.revalidate alone) on this Next
      // version, doubly so here: a GET carrying an X-API-Key header is
      // exactly the case the fetch reference calls out as needing it.
      { headers: { "X-API-Key": apiKey() }, cache: "force-cache", next: { revalidate: revalidateSeconds } },
      FETCH_TIMEOUT_MS,
      RATE_LIMIT_BUCKET
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
  const res = await resilientFetch(
    `${API_BASE}/images/${encodeURIComponent(id)}?size=${size}`,
    {
      headers: { "X-API-Key": apiKey() },
      // force-cache — same reasoning as pokeWalletFetch above. This route
      // (app/api/pokewallet-image/[id]/route.ts) already sends a year-long
      // immutable Cache-Control to the browser/CDN, but that only helps
      // once an edge has actually cached the response; force-cache is what
      // keeps *this* server-side fetch from re-hitting pokewallet.io with
      // the API key on every cold/uncached-region request in the meantime.
      cache: "force-cache",
      next: { revalidate: REVALIDATE_SECONDS },
    },
    FETCH_TIMEOUT_MS,
    RATE_LIMIT_BUCKET
  );
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
    return {
      price: cm.avg,
      currency: "EUR",
      url: cardmarketUrl(card.cardmarket?.product_url ?? undefined),
      asOfDate: cm.updated_at,
    };
  }
  return undefined;
}
