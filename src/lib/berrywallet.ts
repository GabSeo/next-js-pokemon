/**
 * BerryWallet — One Piece Card Game data from pokewallet.io's multi-game
 * card API (sibling product to their Pokémon "PokéWallet" API; one API key
 * works across both — see PokewalletGame below). Picked specifically
 * because it's the only source found with genuinely separate English and
 * Japanese card catalogs (apitcg.ts's One Piece coverage is English/
 * TCGPlayer-only; TCGdex has zero One Piece coverage at all).
 *
 * Schema below is NOT taken from the docs alone — every shape was confirmed
 * against real live responses on 2026-08-27 (see the session that produced
 * this file), because the docs and the live API disagreed on one important
 * point: the docs describe a `language` field on individual card records,
 * but live card objects never carry one. The real language split lives one
 * level up, on *sets* (`GET /op/sets?language=en|jp` returns genuinely
 * different set codes — e.g. `OP09` (English) vs `OP09-JP` (Japanese) are
 * separate sets with separate card lists, not a tag on a shared card row).
 * `findCardInSet` below exists specifically to search *within* one
 * language's set for a given card_number, which is the only reliable way to
 * get a specific language's printing — `searchCards` (`/op/search`) is a
 * flat, language-blind index across every set at once.
 *
 * Confirmed live: no French sets exist at all (`/op/sets?language=fr`
 * returns `{data: [], total: 0}`) — this is English + Japanese only, not a
 * general multi-language source. A One Piece card with no Japanese/English
 * source should fall back to whatever identity is available, same
 * real/illustrative honesty rule the rest of this codebase follows — never
 * fabricate a French printing that doesn't exist here.
 */

const API_BASE = "https://api.pokewallet.io";

/** Same reasoning as apitcg.ts/tcgdex.ts: fail a hung request fast rather than eating fetch's platform default. */
const FETCH_TIMEOUT_MS = 6000;

/** Same 36h window as apitcg.ts/tcgdex.ts, for the same reason — controls quota burn (1,000/day free tier) as much as freshness. */
const REVALIDATE_SECONDS = 60 * 60 * 36;

import { memoizeFetch } from "@/lib/memo-fetch";
import { resilientFetch } from "@/lib/upstream";

/** Only One Piece is wired up here; PokéWallet's Pokémon-side endpoints are a separate, not-yet-built client even though they share a key and host. */
export type BerryWalletLanguage = "en" | "jp";

export type BerryWalletPriceBlock = {
  low_price?: number;
  mid_price?: number;
  high_price?: number;
  market_price?: number;
  direct_low_price?: number | null;
  updated_at?: string;
};

export type BerryWalletCardmarketPrices = {
  avg?: number;
  low?: number;
  trend?: number;
  avg1?: number;
  avg7?: number;
  avg30?: number;
  updated_at?: string;
};

export type BerryWalletCard = {
  /** Carries the `op_` prefix — pass straight through to getCard/getImage, never strip it. */
  id: string;
  card_number: string;
  name: string;
  clean_name?: string;
  sub_type_name?: string | null;
  rarity?: string;
  card_type?: string;
  ext_color?: string;
  ext_cost?: string;
  ext_power?: string;
  ext_life?: string | null;
  ext_counterplus?: string;
  ext_subtypes?: string;
  ext_attribute?: string;
  /** Raw card-text HTML (`<br>` line breaks, the occasional inline `<span style=...>` reprint disclaimer) — confirmed live, needs stripping/sanitizing before rendering, same as apitcg's own HTML description field (see cards.ts's stripHtml). */
  ext_description?: string;
  tcgplayer?: { url?: string; prices?: BerryWalletPriceBlock } | null;
  cardmarket?: { product_name?: string; product_url?: string; prices?: BerryWalletCardmarketPrices } | null;
};

export type BerryWalletSet = {
  name: string;
  set_code: string;
  group_id: string;
  language: BerryWalletLanguage;
  release_date?: string;
};

type SearchResponse = { success: boolean; data: BerryWalletCard[]; total: number };
type SetsResponse = { success: boolean; data: BerryWalletSet[] };
type CardResponse = { success: boolean; id: string } & BerryWalletCard;

function apiKey(): string {
  const key = process.env.POKEWALLET_API_KEY;
  if (!key) {
    throw new Error(
      "POKEWALLET_API_KEY is not set. Add it in Vercel (Project Settings > Environment Variables) and locally in .env.local for dev. One key covers both PokéWallet and BerryWallet."
    );
  }
  return key;
}

async function berryWalletFetch<T>(path: string, revalidateSeconds: number): Promise<T> {
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
      throw new Error(`berrywallet request failed (${res.status}): ${path}`);
    }
    return res.json() as Promise<T>;
  });
}

/**
 * Flat, language-blind search across every set at once — confirmed live,
 * results from English and Japanese sets come back interleaved with no way
 * to tell them apart from the row alone. Use this to discover which sets a
 * card_number appears in, then `findCardInSet` to get a specific language's
 * printing. Matches on card name/number per BerryWallet's own docs.
 */
export async function searchCards(query: string, limit = 20): Promise<BerryWalletCard[]> {
  const qs = new URLSearchParams({ q: query, limit: String(limit) });
  const { data } = await berryWalletFetch<SearchResponse>(`/op/search?${qs}`, REVALIDATE_SECONDS);
  return data;
}

/** Every One Piece set, optionally filtered to one language. This is the real language boundary — see this file's header comment. */
export async function getSets(language?: BerryWalletLanguage): Promise<BerryWalletSet[]> {
  const qs = language ? `?${new URLSearchParams({ language })}` : "";
  const { data } = await berryWalletFetch<SetsResponse>(`/op/sets${qs}`, REVALIDATE_SECONDS);
  return data;
}

/** Every card in one set (accepts a set_code like "OP09-JP", confirmed live). */
export async function getSetCards(setCode: string, limit = 200): Promise<BerryWalletCard[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  const { data } = await berryWalletFetch<SearchResponse>(`/op/sets/${encodeURIComponent(setCode)}?${qs}`, REVALIDATE_SECONDS);
  return data;
}

/**
 * When a card_number has multiple print variants, picking the right one
 * matters — apitcg's own catalog shows the same split (see cards.ts's
 * resolveBerryWalletCard / apitcg.ts's findProductByCode): a base print plus
 * named alternates (Manga, Alternate Art, Wanted Poster, SP Gold/Silver,
 * assorted promo reprints), all sharing one card_number.
 *
 * `variantTags`, when given, requires a match against ALL named tags
 * together (e.g. `["SP", "Gold"]` picks the SP Gold print specifically, not
 * any SP or any Gold) — confirmed against real apitcg listings that "SP" and
 * the other named variants (Manga/Alternate Art/Wanted Poster) never
 * co-occur on one card, so a request naming two mutually-exclusive tags has
 * to resolve to whichever one the caller actually means, not a guess made
 * here.
 */
function pickVariantByTag(matches: BerryWalletCard[], variantTags?: string[]): BerryWalletCard | undefined {
  if (!variantTags || variantTags.length === 0) return undefined;
  return matches.find((c) => variantTags.every((tag) => c.name.toLowerCase().includes(tag.toLowerCase())));
}

/**
 * The `(V.N)` rarity-tier index BerryWallet's own `cardmarket.product_name`
 * carries — confirmed to be the reliable cross-language variant identifier,
 * not just an English-side label: it's present, and lines up by price tier,
 * on BOTH languages' rows for a card_number (see pickVariantForJapanese's
 * own comment for the confirmation). Reads `cardmarket.product_name` first
 * since that's where it's most consistently present; the bare `name` field
 * carries the same "(V.N)" on the Japanese side too (though never on the
 * English side, which names variants by tag instead — "Wanted Poster", not
 * "V.3"), so it's a safe second source rather than a second convention.
 */
function variantIndex(card: BerryWalletCard): number | undefined {
  const source = card.cardmarket?.product_name ?? card.name;
  const match = source.match(/\(V\.(\d+)\)/);
  return match ? Number(match[1]) : undefined;
}

/** Highest parsed V-number, or the last candidate if none parse at all — the fallback both pickVariantByTag's "no tag given" case and pickVariantForJapanese's "nothing to align against" case share. */
function highestVariant(matches: BerryWalletCard[]): BerryWalletCard {
  const withIndex = matches.map((card) => ({ card, index: variantIndex(card) }));
  if (withIndex.every((m) => m.index === undefined)) return matches[matches.length - 1];
  return withIndex.reduce((best, m) => ((m.index ?? -1) > (best.index ?? -1) ? m : best)).card;
}

/**
 * Japanese resolution: no tag words exist on this side at all — BerryWallet
 * only ever labels a Japanese row "(V.N)", never "Manga"/"Wanted Poster"/etc
 * (see this file's own header) — so this used to just guess "highest
 * V-number, always". That guess is silently wrong whenever the wanted
 * English variant ISN'T the rarest one: confirmed live comparing two real
 * cards' full candidate lists (both language sides, both sorted by their own
 * real price) — Shanks OP09-004's requested "Manga" tag happens to BE V.4,
 * the highest, so the old guess got lucky there; Marshall D. Teach
 * OP09-093's requested "Wanted Poster" tag is V.3, and the old guess landed
 * on V.4 (Manga) instead — a real, different, far more expensive print, with
 * a different image. On both cards, the two languages' price-sorted
 * candidate lists lined up index-for-index by V-number exactly (V.1↔V.1
 * cheapest through V.4↔V.4 priciest) — a card_number's variant tiering is
 * evidently a fixed cross-language property, not an English-only label — so
 * matching the Japanese candidate whose OWN `variantIndex` equals the
 * already-resolved English pick's `variantIndex` generalizes correctly to
 * any card sharing this pattern, without a per-card tag table.
 */
function pickVariantForJapanese(matches: BerryWalletCard[], englishTarget: BerryWalletCard | undefined): BerryWalletCard {
  const targetIndex = englishTarget ? variantIndex(englishTarget) : undefined;
  if (targetIndex !== undefined) {
    const aligned = matches.find((c) => variantIndex(c) === targetIndex);
    if (aligned) return aligned;
  }
  return highestVariant(matches);
}

/**
 * Resolves a card_number to one language's real printing — the composition
 * of getSets + getSetCards this file's header comment describes as the only
 * reliable way to pin down a language, since /op/search itself can't.
 * Returns the containing set alongside the card, since BerryWalletCard
 * itself carries no set name/code — cards.ts needs it for Card.set/setCode.
 *
 * Tries the obvious guess first: a card_number's own prefix (`OP09-004` ->
 * `OP09`) is almost always its set's code, `-JP` appended for Japanese
 * (confirmed live: `OP09` (English) / `OP09-JP` (Japanese) is exactly this
 * pattern). One `getSets` call (always needed, to resolve the guessed code
 * to a real BerryWalletSet with a name) plus one `getSetCards` call on that
 * single guessed set covers the overwhelming majority of lookups. Only
 * falls back to walking every other set in the language — genuinely
 * expensive against the free tier's 100/hour limit, confirmed live: a full
 * walk of English's 77 sets exhausted it during this integration's own
 * testing — for the rarer case the guess misses (a starter-deck/promo code
 * that isn't its own set, or a reprint living in a different set).
 *
 * For Japanese with more than one candidate, this also re-resolves the
 * SAME card_number+variantTags in English (one extra, cheap, memoized call —
 * see berryWalletFetch's own 36h dedup) purely to align variant identity by
 * V-number; see pickVariantForJapanese's own comment for why that beats
 * guessing blind. A failure there degrades to the old "highest V-number"
 * guess rather than failing the whole lookup — same non-fatal shape every
 * other cross-source call in this codebase follows.
 */
export async function findCardInLanguage(
  cardNumber: string,
  language: BerryWalletLanguage,
  variantTags?: string[]
): Promise<{ card: BerryWalletCard; set: BerryWalletSet } | undefined> {
  const sets = await getSets(language);
  const guessedCode = language === "jp" ? `${cardNumber.split("-")[0]}-JP` : cardNumber.split("-")[0];
  const ordered = [...sets].sort((a, b) => (a.set_code === guessedCode ? -1 : b.set_code === guessedCode ? 1 : 0));

  for (const set of ordered) {
    const cards = await getSetCards(set.set_code);
    const matches = cards.filter((c) => c.card_number === cardNumber || c.name.includes(cardNumber));
    if (matches.length === 0) continue;
    if (matches.length === 1) return { card: matches[0], set };

    if (language === "en") {
      const card = pickVariantByTag(matches, variantTags) ?? highestVariant(matches);
      return { card, set };
    }

    let englishTarget: BerryWalletCard | undefined;
    try {
      const englishMatch = await findCardInLanguage(cardNumber, "en", variantTags);
      englishTarget = englishMatch?.card;
    } catch {
      // Non-fatal — pickVariantForJapanese's own fallback (highest
      // V-number) covers this exactly the way the old code always did.
    }
    return { card: pickVariantForJapanese(matches, englishTarget), set };
  }
  return undefined;
}

/** Full detail for one card by its `op_`-prefixed id (from searchCards/getSetCards). */
export async function getCard(id: string): Promise<BerryWalletCard | undefined> {
  try {
    const res = await berryWalletFetch<CardResponse>(`/op/cards/${encodeURIComponent(id)}`, REVALIDATE_SECONDS);
    return res;
  } catch {
    return undefined;
  }
}

/**
 * The image endpoint's *real* auth requirement, confirmed live and
 * different from every other image source in this codebase: `/images/:id`
 * 401s without the `X-API-Key` header, and neither `?api_key=` nor `?key=`
 * works as a query-param fallback (both tried live, both 401). TCGdex and
 * apitcg's own image URLs are plain, unauthenticated CDN links a browser
 * `<img src>` can hit directly — this one can't, since a browser can't
 * attach a custom header to an image request. So unlike tcgdex.ts's
 * cardImageUrl (a pure string-building helper), this one has to actually
 * fetch server-side; the URL a browser ends up loading is our own proxy
 * route (see app/api/berrywallet-image/[id]/route.ts), not this one.
 *
 * The response itself already carries `Cache-Control: public,
 * max-age=31536000, immutable` from BerryWallet's own CDN — the proxy route
 * just needs to forward that through, no caching logic of our own to add
 * (unlike the self-hosted Showdown sprites, which needed an explicit header
 * because Vercel's own /public default isn't long-cached — see
 * next.config.ts).
 */
export async function fetchCardImage(id: string, size: "low" | "high" = "high"): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | undefined> {
  const res = await fetch(`${API_BASE}/images/${encodeURIComponent(id)}?size=${size}`, {
    headers: { "X-API-Key": apiKey() },
    // force-cache — same reasoning as pokewallet.ts's fetchCardImage.
    cache: "force-cache",
    next: { revalidate: REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) return undefined;
  return { body: res.body, contentType: res.headers.get("content-type") ?? "image/jpeg" };
}

/** The browser-facing URL for a card's image — our own proxy route, not BerryWallet's directly (see fetchCardImage's doc comment on why). */
export function cardImageUrl(id: string, size: "low" | "high" = "high"): string {
  return `/api/berrywallet-image/${encodeURIComponent(id)}?size=${size}`;
}
