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
 *
 * Exported so cards.ts can compute and store a resolved English card's own
 * index on Card.printVariantIndex at the point it's already being read
 * (resolveCard, One Piece identity) — letting a later Japanese lookup for
 * that same card skip re-fetching and re-resolving English from scratch
 * just to re-derive a number already sitting in memory. See
 * findCardInLanguage's own `knownEnglishVariant` parameter.
 */
export function variantIndex(card: BerryWalletCard): number | undefined {
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
 *
 * Returns undefined — no guess at all — when the English side is a
 * confirmed promo product (findVariantAcrossProducts' own case: a real
 * match, just outside the normal V.1-V.4 tiering, so it has no parseable
 * variantIndex). That's a different situation from "nothing known about the
 * English side at all" (still worth a best-guess fallback, same as before
 * this function existed): here we positively know the requested print
 * doesn't follow the guessed set's ordinary tiering, so assuming its
 * Japanese counterpart is simply "whichever ordinary variant is priciest"
 * would be a fabricated pairing, not a real one — confirmed live, OP09-061's
 * English "2nd Anniversary Set" promo has no Japanese counterpart
 * discoverable this way, and the old blind guess landed on the unrelated
 * V.2 Parallel print instead. "No real Japanese match for this card" is the
 * honest answer, matching every other real/illustrative honesty rule in
 * this codebase — not a print that merely happens to share the card_number.
 *
 * Takes the target as a plain `number | undefined` index rather than a full
 * BerryWalletCard — see findCardInLanguage's own `knownEnglishVariant`
 * comment for why: the caller normally already has this number in hand
 * (Card.printVariantIndex) without needing the whole English card object.
 * `hasEnglishSignal` distinguishes "the index is undefined because we
 * positively resolved a promo with no V-number" from "the index is
 * undefined because we don't know anything about the English side at all"
 * — the same distinction the old englishTarget-or-undefined parameter used
 * to carry via its own presence, now carried explicitly since a bare
 * `undefined` number can no longer speak for both.
 */
function pickVariantForJapanese(matches: BerryWalletCard[], targetIndex: number | undefined, hasEnglishSignal: boolean): BerryWalletCard | undefined {
  if (!hasEnglishSignal) return highestVariant(matches);
  if (targetIndex === undefined) return undefined;
  return matches.find((c) => variantIndex(c) === targetIndex) ?? highestVariant(matches);
}

/**
 * Cross-product fallback for a requested variant that isn't in the guessed
 * set at all — a promotional release (an anniversary-set promo, a jumbo
 * print, an event-pack exclusive) shares its card_number with the mainline
 * card but is catalogued as its own separate BerryWallet product, which
 * getSetCards on one guessed set can never surface (it only ever lists what
 * that one set actually contains). searchCards's flat, language-blind index
 * does find it, in one call: confirmed live, OP09-061's real "English
 * Version 2nd Anniversary Set" promo ($528 real market price) doesn't
 * appear among getSetCards("OP09")'s 2 candidates at all, but is 1 of 5
 * exact-card_number results from a single searchCards("OP09-061") call.
 *
 * Only ever called when the guessed set already found *something* for this
 * card_number but not the requested tag — a second cheap, 36h-memoized call
 * (see berryWalletFetch), not the expensive full-set walk this file's own
 * header describes almost exhausting the free tier's rate limit.
 *
 * English only. A promo product's own `name` is self-descriptive enough to
 * tag-match directly ("English Version 2nd Anniversary Set" contains
 * "2nd Anniversary Set"). This isn't attempted for Japanese: this file's own
 * header already establishes the Japanese side carries no descriptive tags
 * even under normal set-scoped search, so there's no confirmed reason to
 * expect a promo product's Japanese name would be any more descriptive —
 * a Japanese promo counterpart, if one even exists, stays unresolved rather
 * than guessed at from an unconfirmed assumption.
 */
async function findVariantAcrossProducts(cardNumber: string, variantTags: string[]): Promise<BerryWalletCard | undefined> {
  const candidates = await searchCards(cardNumber, 50);
  return candidates.find(
    (c) => c.card_number === cardNumber && variantTags.every((tag) => c.name.toLowerCase().includes(tag.toLowerCase()))
  );
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
 * For Japanese with more than one candidate, this needs the English variant
 * index to align against (see pickVariantForJapanese's own comment for
 * why). `knownEnglishVariant` lets a caller that's already resolved English
 * — every real caller in this codebase, since a Japanese lookup only ever
 * happens for a card_number whose canonical identity is already built —
 * hand that number straight in, skipping a second live English resolution
 * entirely: no getSets/getSetCards round trip, no findVariantAcrossProducts
 * fallback, none of it, just the number itself. Confirmed live this isn't a
 * small saving: a Japanese lookup for a promo-shaped card without this
 * shortcut costs 4-5 raw HTTP calls (its own getSets+getSetCards, PLUS a
 * full English re-resolution behind it); with the number already in hand,
 * it's 2. Omitting the parameter entirely falls back to the old behavior
 * (a real, live English re-resolution) — for a hypothetical future caller
 * that doesn't already have the number, not because any caller in this
 * codebase actually takes that path today. Either way, a failure to
 * determine the index degrades to the old "highest V-number" guess rather
 * than failing the whole lookup — same non-fatal shape every other
 * cross-source call in this codebase follows.
 */
export async function findCardInLanguage(
  cardNumber: string,
  language: BerryWalletLanguage,
  variantTags?: string[],
  knownEnglishVariant?: { index: number | undefined }
): Promise<{ card: BerryWalletCard; set: BerryWalletSet } | undefined> {
  const sets = await getSets(language);
  const guessedCode = language === "jp" ? `${cardNumber.split("-")[0]}-JP` : cardNumber.split("-")[0];
  const ordered = [...sets].sort((a, b) => (a.set_code === guessedCode ? -1 : b.set_code === guessedCode ? 1 : 0));

  for (const set of ordered) {
    const cards = await getSetCards(set.set_code);
    const matches = cards.filter((c) => c.card_number === cardNumber || c.name.includes(cardNumber));
    if (matches.length === 0) continue;

    if (language === "en") {
      const tagged = pickVariantByTag(matches, variantTags);
      if (tagged) return { card: tagged, set };
      // The guessed set has this card_number but not the requested variant
      // — check whether it's a separate promo product instead (see
      // findVariantAcrossProducts' own comment) before settling for
      // "highest in the wrong set". Reports the guessed set alongside a
      // cross-product match too — it's the best real set label available;
      // a promo product carries no set of its own to report instead.
      if (variantTags && variantTags.length > 0) {
        const crossProduct = await findVariantAcrossProducts(cardNumber, variantTags);
        if (crossProduct) return { card: crossProduct, set };
      }
      return { card: highestVariant(matches), set };
    }

    let targetIndex: number | undefined;
    let hasEnglishSignal: boolean;
    if (knownEnglishVariant) {
      targetIndex = knownEnglishVariant.index;
      hasEnglishSignal = true;
    } else {
      hasEnglishSignal = false;
      try {
        const englishMatch = await findCardInLanguage(cardNumber, "en", variantTags);
        if (englishMatch) {
          targetIndex = variantIndex(englishMatch.card);
          hasEnglishSignal = true;
        }
      } catch {
        // Non-fatal — hasEnglishSignal stays false, pickVariantForJapanese's
        // own fallback (highest V-number) covers this exactly the way the
        // old code always did.
      }
    }
    // undefined here means pickVariantForJapanese positively determined
    // there's no honest Japanese match — see its own comment — not a
    // failure to look; correctly propagates as "no match" rather than
    // falling through to try another set for a card_number already found.
    const japaneseCard = pickVariantForJapanese(matches, targetIndex, hasEnglishSignal);
    return japaneseCard ? { card: japaneseCard, set } : undefined;
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
