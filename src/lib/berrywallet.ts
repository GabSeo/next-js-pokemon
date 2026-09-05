/**
 * BerryWallet — One Piece Card Game data from pokewallet.io's multi-game
 * card API (sibling product to their Pokémon "PokéWallet" API; same host,
 * api.pokewallet.io, but its own separate API key — BERRYWALLET_API_KEY, see
 * this file's own apiKey() comment — so One Piece traffic doesn't share
 * PokéWallet's Pokémon quota. See PokewalletGame below). Picked specifically
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
 * get a specific language's printing — and, per searchCards' own corrected
 * doc comment, the ONLY way: `/op/search` does not return Japanese rows at
 * all.
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

/** Same 24h window as apitcg.ts/tcgdex.ts, for the same reason — controls quota burn (1,000/day free tier) as much as freshness. */
const REVALIDATE_SECONDS = 60 * 60 * 24;

import { cardmarketUrl } from "@/lib/cardmarket-search";
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
  // Confirmed live: BerryWallet sends an explicit `null` (not omission) for
  // any of these when Cardmarket has no data for that stat yet — same shape
  // as direct_low_price above. Every consumer must normalize null to
  // undefined before this reaches Card.cardmarket (lib/types.ts), which
  // declares plain `number`, not `number | null` — see cards.ts's
  // resolveCard/resolveOnePieceJapanese.
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
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

/**
 * BerryWallet's own credential — separate from PokéWallet's
 * POKEWALLET_API_KEY (see that file's own apiKey() comment) even though both
 * point at the same host, api.pokewallet.io. Falls back to
 * POKEWALLET_API_KEY when BERRYWALLET_API_KEY isn't set, so this keeps
 * working exactly as it did when one key covered both, until a dedicated
 * BerryWallet-only key is actually added — at which point One Piece traffic
 * stops sharing PokéWallet's Pokémon quota, see RATE_LIMIT_BUCKET below and
 * resilientFetch's `rateLimitKey` doc comment (upstream.ts) for how that
 * split is kept true all the way through the circuit breaker, not just at
 * the credential level.
 *
 * Worth confirming with pokewallet.io directly before assuming this doubles
 * real headroom: if their rate limit is enforced per *account* rather than
 * per *key*, two keys on one account still share one bucket server-side —
 * this only helps if a second key genuinely carries its own quota.
 */
function apiKey(): string {
  const key = process.env.BERRYWALLET_API_KEY ?? process.env.POKEWALLET_API_KEY;
  if (!key) {
    throw new Error(
      "Neither BERRYWALLET_API_KEY nor POKEWALLET_API_KEY is set. Add BERRYWALLET_API_KEY in Vercel (Project Settings > Environment Variables) and locally in .env.local for dev — a key dedicated to BerryWallet's One Piece traffic. POKEWALLET_API_KEY alone still works as a fallback if BERRYWALLET_API_KEY isn't set yet."
    );
  }
  return key;
}

/** Keeps this credential's circuit breaker independent from PokéWallet's own (see pokewallet.ts's RATE_LIMIT_BUCKET) despite sharing api.pokewallet.io as a literal host — see resilientFetch's `rateLimitKey` param (upstream.ts). */
const RATE_LIMIT_BUCKET = "api.pokewallet.io#berrywallet";

async function berryWalletFetch<T>(path: string, revalidateSeconds: number): Promise<T> {
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
      throw new Error(`berrywallet request failed (${res.status}): ${path}`);
    }
    return res.json() as Promise<T>;
  });
}

/**
 * Flat search across sets. ENGLISH ONLY in practice — do not use it to
 * reason about Japanese.
 *
 * This comment previously claimed the index was "language-blind", with
 * English and Japanese rows "interleaved with no way to tell them apart".
 * That was wrong, and it was load-bearing: it is the stated justification
 * for findVariantAcrossProducts being English-only, and it invites the
 * inference that a card_number absent from these results has no Japanese
 * print. Disproved live on 2026-08-29 with a control: Shanks OP09-004 has a
 * confirmed real Japanese printing (it resolves through
 * getSets("jp")+getSetCards and renders on the product page), yet
 * `searchCards("OP09-004")` returns 9 exact rows, every one of them
 * English.
 *
 * So absence here is evidence of nothing about the Japanese catalogue. Only
 * a set-scoped lookup against a set whose own `language` is "jp" can answer
 * that — language lives on the SET, never on the row (BerryWallet's
 * Japanese rows carry Latin names, so text inspection can't identify them
 * either).
 *
 * Still the right tool for its actual job: discovering English promo
 * products that a single set listing never surfaces (see
 * findVariantAcrossProducts). Matches on card name/number per BerryWallet's
 * own docs.
 */
export async function searchCards(query: string, limit = 20): Promise<BerryWalletCard[]> {
  const qs = new URLSearchParams({ q: query, limit: String(limit) });
  const { data } = await berryWalletFetch<SearchResponse>(`/op/search?${qs}`, REVALIDATE_SECONDS);
  return data;
}

/**
 * The Cardmarket products for a card whose own row carries none.
 *
 * BerryWallet splits one physical card across several rows and maps only some
 * of them to Cardmarket. Monkey D. Luffy OP09-061 resolves to a row named
 * "English Version 2nd Anniversary Set" with `cardmarket: null`, while two
 * other rows carry the real products; P-033 resolves to a row whose Cardmarket
 * block exists but is entirely null. Neither can be repaired from the card
 * number — the sibling rows carry `61`, `null`, or a different variant suffix.
 *
 * THE LINK IS THE TCGPLAYER PRODUCT URL. Rows that share one are the same
 * physical card, whatever BerryWallet calls them, and grouping by it lands
 * exactly on the products Cardmarket itself lists — verified against
 * OP09-061 (Unnumbered Promos + Unnumbered Promos Japanese), P-033 (Promos +
 * Promos Japanese) and OP09-004. Nothing here is stored per card; a sibling is
 * only ever adopted when it is provably the same TCGplayer product.
 *
 * The Western/Japanese split comes from Cardmarket's own set slug — see
 * isJapaneseProduct for the two suffixes it uses.
 *
 * One search per card, and only for a card that needs one.
 */
export async function findCardmarketSiblings(
  card: BerryWalletCard
): Promise<{ western?: BerryWalletCard; japanese?: BerryWalletCard }> {
  const tcgplayerUrl = card.tcgplayer?.url;
  const code = card.card_number;
  if (!tcgplayerUrl || !code) return {};

  const rows = await searchCards(code, 60).catch(() => [] as BerryWalletCard[]);
  const siblings = rows.filter(
    (row) => row.tcgplayer?.url === tcgplayerUrl && hasCardmarketPrices(row)
  );

  return {
    western: siblings.find((row) => !isJapaneseProduct(row)),
    japanese: siblings.find(isJapaneseProduct),
  };
}

/**
 * The Japanese Cardmarket product belonging to the Western product this site
 * already quotes for a card.
 *
 * Only for a card whose own Japanese row carries no Japanese product — the
 * ordinary case is that it does (see isJapaneseProduct), and this never runs.
 *
 * The walk starts from the Western product rather than from the Japanese row
 * because those rows carry `tcgplayer: null` on the newer sets and so have
 * nothing to join on. From the Western product it is the same TCGplayer link
 * findCardmarketSiblings uses: find the row holding that product, then the
 * Japanese row sharing its TCGplayer URL.
 *
 * Returns undefined rather than a near-miss when there is none. Pricing a
 * different print as this one is exactly the merge this codebase refuses to
 * make — OP09-004's other Japanese product is an Unnumbered Promo, not the set
 * card being quoted.
 *
 * One search, paid only when it is actually needed.
 */
export async function findJapaneseCardmarket(
  code: string,
  westernProductUrl: string | undefined
): Promise<BerryWalletCard | undefined> {
  if (!westernProductUrl) return undefined;
  const rows = await searchCards(code, 60).catch(() => [] as BerryWalletCard[]);
  // Locale-normalised on both sides: the stored URL has been forced onto /en/
  // while BerryWallet's raw rows are Italian (see cardmarketUrl).
  const target = cardmarketUrl(westernProductUrl);
  const tcgplayerUrl = rows.find((row) => cardmarketUrl(row.cardmarket?.product_url) === target)?.tcgplayer?.url;
  if (!tcgplayerUrl) return undefined;
  return rows.find(
    (row) => row.tcgplayer?.url === tcgplayerUrl && isJapaneseProduct(row) && hasCardmarketPrices(row)
  );
}

/**
 * True when Cardmarket's own set slug marks this as the Japanese product.
 *
 * Cardmarket spells it two ways for One Piece and both are real, so both are
 * tested here. The older sets get `-Japanese` (Awakening-of-the-New-Era-
 * Japanese, Promos-Japanese, Unnumbered-Promos-Japanese); the newer ones get
 * `-Non-English` instead, which reads Western but is not.
 *
 * That second one was originally excluded here on the assumption that
 * "Non-English" meant the FR/DE/IT/ES printings. BerryWallet's own Japanese
 * side says otherwise, three ways: `/op/sets?language=jp` lists OP09-JP
 * "Emperors in the new world (Japanese)", every card in it maps to
 * `Emperors-in-the-New-World-Non-English`, no `-Japanese` variant of that set
 * exists anywhere in the catalogue, and the neighbouring set is named outright
 * "Two Legends (Non English)".
 *
 * Not included: `-Asia-Region-Legal` (Starter-Deck-Egghead, Heroines-Edition,
 * Egghead-Crisis). Those are region-locked printings and this codebase has no
 * confirmation of which language they carry, so they stay Western-side rather
 * than being guessed onto the Japanese view.
 */
export function isJapaneseProduct(card: BerryWalletCard): boolean {
  const set = card.cardmarket?.product_url?.split("/Singles/")[1]?.split("/")[0] ?? "";
  return /-(Japanese|Non-English)$/i.test(set);
}

/** A Cardmarket block that exists AND carries a figure — P-033's is present but entirely null. */
export function hasCardmarketPrices(card: BerryWalletCard | undefined): boolean {
  const p = card?.cardmarket?.prices;
  if (!p) return false;
  return [p.avg, p.low, p.trend, p.avg1, p.avg7, p.avg30].some((v) => v != null && v !== 0);
}

/** Every One Piece set, optionally filtered to one language. This is the real language boundary — see this file's header comment. */
export async function getSets(language?: BerryWalletLanguage): Promise<BerryWalletSet[]> {
  const qs = language ? `?${new URLSearchParams({ language })}` : "";
  const { data } = await berryWalletFetch<SetsResponse>(`/op/sets${qs}`, REVALIDATE_SECONDS);
  return data;
}

/**
 * The API's hard page size. Confirmed live on 2026-08-29: `limit=1000`
 * against a 300-card set still returned exactly 200 rows, so `limit` is
 * capped server-side and cannot be raised past this.
 */
const PAGE_SIZE = 200;

/**
 * Safety stop for the pagination loop below. 1,000 cards is far larger than
 * any real One Piece set (the biggest observed is 300), so reaching this
 * means the `total` field is lying or the page cursor isn't advancing —
 * either way, stopping beats looping against a metered API.
 */
const MAX_PAGES = 5;

/**
 * Every card in one set (accepts a set_code like "OP09-JP", confirmed live).
 *
 * `allPages` exists because this used to silently truncate. It passed
 * `limit` and nothing else, and the server caps a page at PAGE_SIZE
 * regardless of what `limit` asks for — so for any set larger than 200
 * cards, every row past the 200th was invisible to findCardInLanguage, with
 * no error and no warning. Confirmed live: `CM-UNNUMBERED-JP` reports
 * `total: 300` and returned 200 rows; `page=2` returns the missing 100.
 * `offset` and `skip` are both ignored by this API — `page` is the only
 * parameter that actually advances the cursor.
 *
 * Off by default, and that default is a quota decision rather than a
 * correctness one: a second page is a second real request against a
 * 100/hour ceiling, and it is only worth spending on a set we have actual
 * reason to think holds the card. findCardInLanguage turns it on for the
 * sets it targets deliberately (a confirmed set_code, or the prefix guess)
 * and leaves it off for the speculative walk behind them — see that
 * function's own tier comments.
 */
export async function getSetCards(setCode: string, options?: { allPages?: boolean }): Promise<BerryWalletCard[]> {
  const page = async (n: number): Promise<SearchResponse> => {
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(n) });
    return berryWalletFetch<SearchResponse>(`/op/sets/${encodeURIComponent(setCode)}?${qs}`, REVALIDATE_SECONDS);
  };

  const first = await page(1);
  const cards = [...first.data];
  if (!options?.allPages) return cards;

  const total = first.total ?? cards.length;
  for (let n = 2; cards.length < total && n <= MAX_PAGES; n++) {
    const next = await page(n);
    // An empty page means the set is exhausted regardless of what `total`
    // claimed — stop rather than burning the rest of MAX_PAGES on it.
    if (next.data.length === 0) break;
    cards.push(...next.data);
  }
  return cards;
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
/**
 * How many *speculative* sets findCardInLanguage will try after both the
 * confirmed code and the prefix guess have missed, before giving up.
 *
 * Small on purpose. Walking further has never once been what found a card
 * in this codebase — the guess covers every ordinary numbered set and a
 * stored code covers the promos — while the cost of walking is one request
 * per set against a 100/hour ceiling. A handful is enough to catch a
 * near-miss (a reprint sitting in an adjacent set) and nowhere near enough
 * to matter to the quota if it misses anyway.
 */
const MAX_FALLBACK_SETS = 6;

function matchesTags(name: string, variantTags: string[], excludeTags?: string[]): boolean {
  const lower = name.toLowerCase();
  if (!variantTags.every((tag) => lower.includes(tag.toLowerCase()))) return false;
  return !excludeTags?.some((tag) => lower.includes(tag.toLowerCase()));
}

function pickVariantByTag(
  matches: BerryWalletCard[],
  variantTags?: string[],
  excludeTags?: string[]
): BerryWalletCard | undefined {
  if (!variantTags || variantTags.length === 0) return undefined;
  return matches.find((c) => matchesTags(c.name, variantTags, excludeTags));
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
 * NOTE, settled 2026-08-29: for the two promo cards this codebase tracks
 * (OP09-061 "2nd Anniversary Set", P-033 "Event Pack Vol. 2") the undefined
 * return below is not merely cautious, it is the only available answer. No
 * source we have carries their Japanese print: BerryWallet's Japanese promo
 * sets were searched exhaustively (CM-PREMIUM-BANDAI, CM-UNNUMBERED-JP incl.
 * its hidden second page, CM-PRODUCTS, CM-PROMO-JP, CM-REPRINTS,
 * CM-SPECIAL-PROMOS, CM-SPECIAL-PROMOS-JP — no match), and TCGGO, the
 * Cardmarket-backed API in lib/tcggo.ts, has no Japanese data at all. The
 * cards demonstrably exist (a real PSA-graded Japanese OP09-061 was the
 * prompt for this investigation) and Cardmarket's own website lists them —
 * they are simply not in any catalogue this app can read. Do not re-derive
 * this; it costs real quota. See docs/i18n-deferred.md.
 *
 * AMENDED 2026-09-05, and the amendment matters: "no match" above is true of
 * those two cards, NOT of every promo. ST21-014 does have a row in
 * CM-UNNUMBERED-JP — `Monkey.D.Luffy (ST21-014) (V.1)`, a real
 * Unnumbered-Promos-Japanese product at EUR 169.53, and the only ST21-014
 * candidate in that set. It is still refused here, by the `targetIndex ===
 * undefined` branch below, and that is still the right answer: the English
 * side resolved to the 3rd Anniversary Treasure Campaign Pack promo, which
 * carries no parseable (V.N), so pairing it with the single ordinary Japanese
 * variant would be a guess dressed as a match — and the two differ by an
 * order of magnitude (USD 1,747 against EUR 169.53), which is exactly the
 * shape a wrong pairing takes.
 *
 * SETTLED 2026-09-05, by a person opening the Cardmarket page: the two are
 * NOT the same printing. So the refusal below is not merely the cautious
 * answer on this card, it is the correct one — a blind "highest variant"
 * guess would have put an unrelated EUR 169.53 print under a USD 1,747 card's
 * Japanese toggle, which is precisely the fabricated pairing this function was
 * written to prevent. Two cards have now confirmed it the same way (OP09-061's
 * V.2 Parallel, and this). ST21-014 has no known Japanese counterpart in any
 * catalogue this app reads, and its JP toggle is correctly inert.
 *
 * Worth knowing that the whole set carries `card_number: null` on all 300
 * rows, so only the `name.includes(cardNumber)` half of the match in
 * findCardInLanguage can ever reach it.
 *
 * EXTENDED 2026-09-05 to the case this was plainly written for and did not
 * cover. The refusal used to fire only when the English index was
 * UNPARSEABLE. It now also fires when the index is perfectly parseable but
 * belongs to a different product — a cross-product English match, flagged by
 * findCardInLanguage as `crossProduct` and turned into a null
 * printVariantIndex by cards.ts.
 *
 * Measured on monkey-d-luffy-op05-119 and monkey-d-luffy-op01-024, both
 * PRB-01 reprints: the English side resolves in The-Best at index 2, the
 * guessed Japanese set is the ORIGIN set, and its index 2 is a different card
 * entirely. OP05-119 paired a USD 215 English print with a EUR 171.50
 * Japanese one; OP01-024 paired USD 73.23 with USD 240.03, 3.3x out. Both
 * matched a NUMBER across two sets and called it a card, which is the same
 * fabricated pairing described above wearing a parseable index.
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
 * card_number but not the requested tag — a second cheap, 24h-memoized call
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
async function findVariantAcrossProducts(
  cardNumber: string,
  variantTags: string[],
  excludeTags?: string[]
): Promise<BerryWalletCard | undefined> {
  const candidates = await searchCards(cardNumber, 50);
  return candidates.find((c) => c.card_number === cardNumber && matchesTags(c.name, variantTags, excludeTags));
}

/**
 * Resolves a card_number to one language's real printing — the composition
 * of getSets + getSetCards this file's header comment describes as the only
 * reliable way to pin down a language, since /op/search itself can't.
 * Returns the containing set alongside the card, since BerryWalletCard
 * itself carries no set name/code — cards.ts needs it for Card.set/setCode.
 *
 * Set resolution goes in three tiers, cheapest first.
 *
 * 1. `options.knownSetCode` — a CONFIRMED code stored on the CardRef (see
 *    data/card-refs.ts's berryWalletSetCode). One `getSetCards` call, and
 *    the `getSets` call below is shared across every card in the build
 *    (memoized by path, see lib/memo-fetch.ts), so the real marginal cost
 *    of a card with a stored code is a single request.
 * 2. The prefix guess — see prefixCandidates below. A card_number's own
 *    prefix is almost always its set's code, in one of two shapes, `-JP`
 *    appended for Japanese. Right for every ordinary numbered set and every
 *    starter deck / extra booster, wrong for promos.
 * 3. A BOUNDED walk of the remaining sets, for the case both miss.
 *
 * Tier 3 is bounded and did not used to be, which was a real quota bug
 * rather than a slow path. English has 77 sets and the walk spent one
 * `getSetCards` call on each: confirmed live on 2026-08-29, four ordinary
 * cards resolved in ~2 calls apiece and then a single promo card (`P-033`,
 * whose guess `P` misses its real set `OP-PR`) consumed the entire
 * remainder of a 60-call ceiling on its own. One unlucky card_number could
 * drain an hourly quota that the whole rest of the catalogue barely
 * touched, and the only visible symptom was unrelated cards further down
 * the build failing to resolve.
 *
 * See MAX_FALLBACK_SETS below for why giving up beats continuing.
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
/**
 * The set codes a card_number's prefix could plausibly name, best first.
 *
 * BerryWallet writes a set code in two shapes and the card number only ever
 * shows one of them. Confirmed against the live English catalogue on
 * 2026-09-04: the main booster sets are unhyphenated and match the prefix
 * exactly (`OP05-119` -> `OP05`), while every other family separates its
 * letters from its digits — `ST21-014` -> `ST-21` ("Starter Deck EX: Gear
 * 5"), `EB01-001` -> `EB-01`, and likewise the `PRB-01` / `LT-01` products.
 *
 * So the bare prefix was not a guess but half of one, and the half it missed
 * was every starter deck and extra booster in the catalogue. ST21-014 gave up
 * after six speculative sets in BOTH languages before this existed, and the
 * card resolved to nothing at all.
 *
 * The alternate costs nothing when it names no real set. These strings are
 * only ever compared against set codes the catalogue has already returned, so
 * an unmatched candidate changes the ORDER of the walk and never adds a
 * request — `OP05-119` still yields `OP-05`, which simply matches nothing.
 */
function prefixCandidates(cardNumber: string, language: BerryWalletLanguage): string[] {
  const prefix = cardNumber.split("-")[0];
  const parts = /^([A-Za-z]+)(\d+)$/.exec(prefix);
  const codes = parts ? [prefix, `${parts[1]}-${parts[2]}`] : [prefix];
  return language === "jp" ? codes.map((code) => `${code}-JP`) : codes;
}

export async function findCardInLanguage(
  cardNumber: string,
  language: BerryWalletLanguage,
  variantTags?: string[],
  options?: {
    /** See this function's own doc comment — lets a caller that already resolved English skip a second live English resolution. */
    knownEnglishVariant?: { index: number | undefined };
    /** A confirmed `set_code` for this card in this language, from data/card-refs.ts's berryWalletSetCode. Tier 1 above. */
    knownSetCode?: string;
    /**
     * The confirmed ENGLISH set_code, used only by the Japanese branch's
     * fallback English re-resolution below — the path taken when a caller
     * asks for Japanese without already knowing the English variant index.
     * No caller in this codebase takes that path today (they all pass
     * knownEnglishVariant), but if one ever does, this stops that nested
     * lookup from being the unbounded walk this function just stopped being
     * everywhere else.
     */
    knownEnglishSetCode?: string;
    /** See CodeLookup.excludeTags in data/card-refs.ts — the negative half of the variant match. */
    excludeTags?: string[];
  }
): Promise<{ card: BerryWalletCard; set: BerryWalletSet; crossProduct?: boolean } | undefined> {
  const knownEnglishVariant = options?.knownEnglishVariant;
  const sets = await getSets(language);
  const guessedCodes = prefixCandidates(cardNumber, language);

  // Confirmed code first, prefix guess second, everything else after — and
  // `ordered` is only ever *walked* as far as MAX_FALLBACK_SETS past those
  // two, see the loop below.
  const priority = (code: string): number =>
    code === options?.knownSetCode ? 0 : guessedCodes.includes(code) ? 1 : 2;
  const ordered = [...sets].sort((a, b) => priority(a.set_code) - priority(b.set_code));
  const targeted = ordered.filter((set) => priority(set.set_code) < 2).length;

  let walked = 0;
  for (const set of ordered) {
    // Past the confirmed code and the prefix guess, this is speculative:
    // every additional set is a real request spent on a hunch. Stopping
    // returns "no match", which every caller already handles by falling
    // back to the offline placeholder or an inert toggle — a strictly
    // better outcome than draining the hourly quota and taking unrelated
    // cards down with it. The fix for a card that lands here is to store
    // its real code on the ref, which the warning below names explicitly.
    if (priority(set.set_code) === 2 && ++walked > MAX_FALLBACK_SETS) {
      console.warn(
        `[berrywallet] gave up finding ${cardNumber} (${language}) after ${targeted + MAX_FALLBACK_SETS} sets. ` +
          `Add a confirmed set_code for it to berryWalletSetCode in src/data/card-refs.ts — see that field's own comment.`
      );
      return undefined;
    }
    // Paginate only the sets we're targeting on purpose (tier 1 and 2) —
    // a speculative set is already a guess, and paying a second request to
    // guess more thoroughly is the wrong trade against an hourly quota.
    const cards = await getSetCards(set.set_code, { allPages: priority(set.set_code) < 2 });
    const matches = cards.filter((c) => c.card_number === cardNumber || c.name.includes(cardNumber));
    if (matches.length === 0) continue;

    if (language === "en") {
      const tagged = pickVariantByTag(matches, variantTags, options?.excludeTags);
      if (tagged) return { card: tagged, set };
      // The guessed set has this card_number but not the requested variant
      // — check whether it's a separate promo product instead (see
      // findVariantAcrossProducts' own comment) before settling for
      // "highest in the wrong set". Reports the guessed set alongside a
      // cross-product match too — it's the best real set label available;
      // a promo product carries no set of its own to report instead.
      if (variantTags && variantTags.length > 0) {
        const crossMatch = await findVariantAcrossProducts(cardNumber, variantTags, options?.excludeTags);
        // `crossProduct: true` is load-bearing, not a diagnostic. This card
        // came from a DIFFERENT product than `set`, so its (V.N) index counts
        // within that other product's tiering and means nothing against this
        // set's — see cards.ts, which turns the flag into a null
        // printVariantIndex, and pickVariantForJapanese's own comment for
        // what that then refuses.
        if (crossMatch) return { card: crossMatch, set, crossProduct: true };
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
        const englishMatch = await findCardInLanguage(cardNumber, "en", variantTags, {
          knownSetCode: options?.knownEnglishSetCode,
          excludeTags: options?.excludeTags,
        });
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
  const res = await resilientFetch(
    `${API_BASE}/images/${encodeURIComponent(id)}?size=${size}`,
    {
      headers: { "X-API-Key": apiKey() },
      // force-cache — same reasoning as pokewallet.ts's fetchCardImage.
      cache: "force-cache",
      next: { revalidate: REVALIDATE_SECONDS },
    },
    FETCH_TIMEOUT_MS,
    RATE_LIMIT_BUCKET
  );
  if (!res.ok || !res.body) return undefined;
  return { body: res.body, contentType: res.headers.get("content-type") ?? "image/jpeg" };
}

/** The browser-facing URL for a card's image — our own proxy route, not BerryWallet's directly (see fetchCardImage's doc comment on why). */
export function cardImageUrl(id: string, size: "low" | "high" = "high"): string {
  return `/api/berrywallet-image/${encodeURIComponent(id)}?size=${size}`;
}
