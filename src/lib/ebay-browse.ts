import { cardSearchTerms, tagFirstWord } from "@/lib/ebay-search";
import { resilientFetch } from "@/lib/upstream";
import type { Card } from "@/lib/types";

/**
 * eBay Buy Browse API client — real active-listing search, not a search-link
 * stand-in like lib/ebay-search.ts. Sold/completed listings stay out of
 * scope: that data lives behind eBay's Marketplace Insights API, which eBay
 * itself documents as restricted and closed to new applicants (confirmed via
 * eBay's community forum — multiple individual developers report applying
 * and being denied, with eBay staff saying it's reserved for major
 * partners). Being accepted into the general Developer Program does not
 * include it.
 *
 * Requires a Buy API license on top of basic developer program acceptance
 * (see the "Buy APIs require an additional license" footnote on eBay's own
 * API call limits page) — if that hasn't been separately granted yet, the
 * token request below will fail with a scope/access error even with valid
 * client credentials.
 *
 * Both real requests here (the OAuth token, the search itself) go through
 * upstream.ts's resilientFetch rather than a bare `fetch` — confirmed live
 * this was the one client in the codebase still missing that: a burst of
 * eBay 429s (up to 8 searches per card, times however many routes touch a
 * card before graded-market.ts's own buildCached wrapper existed) had no
 * circuit breaker to stop it from hammering an already-rate-limited eBay
 * with the next card's 8 searches, unlike apitcg/TCGdex/PokéWallet/
 * BerryWallet. See resilientFetch's RATE_LIMIT_BREAKER_OPEN_MS for what a
 * 429 now does instead. A caught failure here still degrades to the
 * clearly-tagged illustrative preview one tier at a time (see
 * graded-market.ts's fetchActiveTier) — this only stops the retries from
 * making the outage worse, it was never the reason a page could crash.
 */

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

/** eBay's "CCG Individual Cards" category — where graded/raw Pokémon singles live. */
const CCG_INDIVIDUAL_CARDS_CATEGORY = "183454";

const REVALIDATE_SECONDS = 60 * 60; // active listings churn much faster than apitcg's 24h card-data window

/** Same value every other upstream client in this codebase uses — see apitcg.ts's own FETCH_TIMEOUT_MS comment. */
const FETCH_TIMEOUT_MS = 6000;

function credentials(): { id: string; secret: string } {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set. Add them in Vercel (Project Settings > Environment Variables) and locally in .env.local for dev."
    );
  }
  return { id, secret };
}

type TokenResponse = { access_token: string; expires_in: number };

// Module-level cache, not per-request — a client_credentials app token is
// shared across all callers, not tied to any one user or request. Only
// helps within one warm serverless instance (doesn't survive cold starts),
// which is why inFlightTokenRequest below matters more in practice: every
// GradedMarketPanel render fires 4 concurrent searchActiveListings calls via
// Promise.all, and without de-duping the in-flight request, all 4 would
// call getAccessToken() at nearly the same instant, before any of them had
// set cachedToken yet — a stampede of 4 separate OAuth token requests for
// one page view instead of 1.
let cachedToken: { token: string; expiresAt: number } | null = null;
let inFlightTokenRequest: Promise<string> | null = null;

/**
 * `forceFresh` exists because this token request is, against the comment
 * below's expectation, subject to Next's Data Cache — `next: { revalidate }`
 * opts even a POST in. A token cached from an earlier session then gets
 * served after eBay has already expired it, and every search using it comes
 * back 401 "Invalid access token". Observed twice: a dev server that 401'd
 * on all 8 searches while a standalone script with its own fresh token
 * worked at the same moment.
 *
 * The cache entry cannot simply be disabled — `no-store` (and
 * `revalidate: 0`) taints the calling route as dynamic and broke static
 * generation in production, which is what the comment below documents. So
 * the fix is a distinct cache key instead: a one-off header value eBay
 * ignores but Next keys on, requested only after a 401 has already proven
 * the held token is dead.
 */
async function getAccessToken(forceFresh = false): Promise<string> {
  if (!forceFresh && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  if (forceFresh) cachedToken = null;
  if (inFlightTokenRequest) return inFlightTokenRequest;

  inFlightTokenRequest = (async () => {
    const { id, secret } = credentials();
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await resilientFetch(
      TOKEN_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          // Part of Next's Data Cache key, ignored by eBay — see this
          // function's own doc comment on why a distinct key is the only
          // way to get past a stale cached token here.
          ...(forceFresh ? { "X-Token-Refresh": String(Date.now()) } : {}),
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "https://api.ebay.com/oauth/api_scope",
        }),
        // NOT cache: "no-store" — that maps to Next's revalidate: 0, which
        // taints the *entire calling route* as dynamic. This function only
        // ever runs when the in-memory cachedToken above is empty or
        // genuinely expired, so a real fresh token is always wanted
        // regardless of what Next's Data Cache does here — and POST
        // requests aren't cached by Next's Data Cache by default anyway, so
        // a short positive revalidate costs nothing while staying
        // compatible with /products/[slug]'s static generation. Confirmed
        // live: omitting this (or using no-store) broke static rendering in
        // production with "Dynamic server usage ... couldn't be rendered
        // statically" and "Page changed from static to dynamic at runtime"
        // errors.
        next: { revalidate: 60 },
      },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      throw new Error(`ebay oauth token request failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as TokenResponse;
    cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return cachedToken.token;
  })();

  try {
    return await inFlightTokenRequest;
  } finally {
    inFlightTokenRequest = null;
  }
}

export type EbayCondition = "PSA 10" | "PSA 9" | "PSA 8" | "Raw";

/**
 * eBay's documented, verified condition IDs for trading cards (Metadata
 * API's getItemConditionPolicies / eBay's condition-ID reference): 2750 =
 * "Graded", 4000 = "Ungraded". This replaces an earlier attempt at
 * grade-specific filtering via aspect_filter's conditionDescriptors
 * (Professional Grader/Grade) — that syntax was never confirmed against
 * eBay's own docs and, confirmed by live testing, silently matched with no
 * filtering effect at all (every condition tab returned identical results).
 * conditionIds is the one part of this that's actually documented and
 * confirmed working (`filter=conditionIds:{1000}` is a real eBay example).
 */
const CONDITION_ID = { graded: "2750", ungraded: "4000" } as const;

function conditionFilter(condition: EbayCondition): string {
  const id = condition === "Raw" ? CONDITION_ID.ungraded : CONDITION_ID.graded;
  return `buyingOptions:{FIXED_PRICE},conditionIds:{${id}}`;
}

/**
 * conditionIds only tells eBay "graded" vs "ungraded" — it can't distinguish
 * PSA 10 from PSA 9 from PSA 8 (no confirmed structured filter for that
 * exists). Grade-specific precision instead comes from appending the grade
 * as a keyword to the text query (e.g. "Gengar VMAX 271 PSA 10") — real
 * seller-written listing titles overwhelmingly include the grade as text
 * (confirmed in live search results), so eBay's own title-text matching
 * does the disambiguation eBay's structured filters won't.
 *
 * Language is deliberately NOT appended here, even though it was in an
 * earlier version of this function — the confirmed-working website search
 * URL (see lib/ebay-search.ts) keeps `_nkw` grade-only and passes Language
 * as a wholly separate structured param, never smashed into the free-text
 * query. Listing titles essentially never contain the literal word
 * "English"/"Japanese"/"French", so appending it to `q` only narrowed (and
 * often broke) the text match — language filtering is precisionAspectFilter's
 * job alone.
 *
 * `nameOverride`/`numberOverride` are threaded straight through to
 * cardSearchTerms — see its doc comment for why (localized name, e.g.
 * TCGdex's French translation or BerryWallet's real One Piece print name;
 * localized number, e.g. a Japanese Pokémon print's own set number).
 */
function conditionQuery(card: Card, condition: EbayCondition, nameOverride?: string, numberOverride?: string): string {
  const base = cardSearchTerms(card, nameOverride, numberOverride);
  return condition === "Raw" ? base : `${base} ${condition}`;
}

export type EbayLanguage = "English" | "Japanese" | "French";

/**
 * Aspect names and values here are copied from a real, hand-verified
 * "perfect results" eBay search URL (see lib/ebay-search.ts's
 * conditionSearchLink comment for the decoded params), not guessed: `Grade`
 * (bare number) + `Professional Grader` (exact value "Professional Sports
 * Authenticator (PSA)") for graded tiers, `Graded:No` for Raw, `Language`
 * for card language. That URL confirms these are eBay's website-facet
 * names, not the nested condition-descriptor path
 * (`conditionDescriptors.name`/`.values.content`) that failed earlier — but
 * the website's facet system and the Browse API's aspect_filter, while
 * usually built on the same underlying item-aspect taxonomy, aren't
 * guaranteed identical, so this is still applied ADDITIVELY on top of the
 * already-confirmed-working conditionIds+keyword approach above, not in
 * place of it: if aspect_filter has no effect via the API, results degrade
 * to exactly what already works today, not a second broken state.
 */
function precisionAspectFilter(condition: EbayCondition, language?: EbayLanguage): string {
  const parts: string[] = [`categoryId:${CCG_INDIVIDUAL_CARDS_CATEGORY}`];
  if (condition === "Raw") {
    parts.push(`Graded:{No}`);
  } else {
    parts.push(`Grade:{${condition.replace("PSA ", "")}}`);
    parts.push(`Professional Grader:{Professional Sports Authenticator (PSA)}`);
  }
  if (language) parts.push(`Language:{${language}}`);
  return parts.join(",");
}

/**
 * True when `number` (the card's own real number, e.g. "P-033" or
 * "OP09-093") plausibly appears in a real listing's title — either
 * verbatim, or, for a letter-prefixed promo code specifically, as a bare
 * "#<digits>" with the letter prefix dropped. Confirmed live this second
 * form is real, not theoretical: "2023 ONE PIECE PROMOS EVENT PACK VOL.2
 * #033 MONKEY D. LUFFY PSA 9" is a genuine, correctly-priced listing for
 * card_number "P-033" that writes it as "#033" — a strict `\bP-033\b` check
 * rejects it outright, the same way requiring a variant tag's full phrase
 * verbatim rejects "Wanted" for "Wanted Poster" (see titleMatchesCard's own
 * comment on variantTags — this is the same shape of gap, just for the
 * number instead of the variant name). General on purpose: any future
 * promo-style code (a single letter, a dash, digits) gets this fallback for
 * free, nothing here names a specific card or prefix letter.
 */
function numberMatchesTitle(number: string, title: string): boolean {
  if (new RegExp(`\\b${number}\\b`).test(title)) return true;
  const promoDigits = number.match(/^[A-Za-z]+-(\d+)$/)?.[1];
  if (!promoDigits) return false;
  const stripped = promoDigits.replace(/^0+(?=\d)/, "");
  return new RegExp(`#0*${stripped}\\b`).test(title);
}

/**
 * Sanity check on a returned listing's title, not just trust in the
 * structured filters — precisionAspectFilter is still unverified against
 * the API (confirmed working on eBay's website, not confirmed there), and
 * results have been observed to be correctly filtered for some cards but
 * not others. Showing an ungraded listing as "PSA 10 active" (or vice
 * versa) would be actively misleading, worse than falling back to a
 * clearly-tagged preview — so a listing that doesn't plausibly match the
 * requested tier gets dropped here rather than trusted just because the API
 * returned it in response to a filtered request.
 *
 * Checks two independent things: the grade/condition text (as before), and
 * — new — the card's own number. "sort=newlyListed" surfaces whatever's
 * newest regardless of match quality, so a text query like "Gengar VMAX
 * 271/264" can still return a same-name-prefix, wrong-number card (e.g.
 * "Gengar V 156/264") among the newest results; requiring the card's own
 * number to literally appear in the title catches that a grade check alone
 * never would, since a wrong card can still happen to mention the right
 * grade.
 *
 * `numberOverride` swaps in a localized number (a Japanese print's own set
 * number) for this check the same way it does for the search query itself —
 * checking card.number's English number against a real Japanese listing's
 * title would reject it: a genuine Japanese-print listing's title correctly
 * carries the Japanese number, not the English one, so without the override
 * every real Japanese result fails this check and silently degrades to the
 * illustrative preview.
 *
 * `variantTags` is the third, One Piece-specific check — the actual
 * enforcement of variant precision, on real returned titles, rather than
 * trusting the query text to have found only the right print (see
 * graded-market.ts's own comment: the same tags also seed the query text
 * now, via tagFirstWord below, but eBay's own text matching isn't
 * exact-phrase, so a query hint narrows the field without guaranteeing
 * every result that comes back is actually the right print — this check is
 * what actually enforces that). Each tag must appear in the title as either
 * the full phrase or its own first word (tagFirstWord, lib/ebay-search.ts,
 * shared with the query-text builder) — confirmed live that sellers
 * commonly abbreviate a multi-word variant name to its first word ("Wanted
 * Poster" listed as just "Wanted"), so requiring the full phrase verbatim
 * would reject genuine matches. This still isn't perfect (an abbreviation
 * that drops the first word instead, e.g. "Alt Art" for "Alternate Art",
 * won't match either form) — accepted as a real, known limitation rather
 * than chased with a per-tag alias table, which is exactly the kind of
 * per-card exception this design is trying to avoid.
 */
function titleMatchesCard(
  title: string,
  card: Card,
  condition: EbayCondition,
  numberOverride?: string,
  variantTags?: string[],
  language?: EbayLanguage
): boolean {
  // English-tier-only: reject a title that also says "Japanese", or carries
  // a standalone "JP" language marker. precisionAspectFilter's own
  // Language:{English} aspect_filter is the one already flagged elsewhere as
  // unconfirmed against the real API, and this is the confirmed failure
  // mode — for monkey-d-luffy-op09-061, the English-filtered search's own
  // top newest-first results included "...English 2nd Anniversary Set
  // Japanese Ver." and "2ND ANNIVERSARY SET JP MONKEY.D.LUFFY..."
  // ($728-994), crowding out real, unambiguous English listings
  // ($1218-1325) further back in the same result set. `\bJP\b` (not a bare
  // substring match) so this doesn't fire on some unrelated alphanumeric
  // token that happens to contain "jp" — confirmed live sellers write it as
  // its own word ("...Set JP Monkey...", never "...SetJP..."). Deliberately
  // NOT the mirror check on the Japanese tier: real Japanese listings for
  // this same card routinely say "EN" too (e.g. "...EN 2nd
  // Anniversary...Japanese PSA 10") — almost certainly short for OP09's own
  // English set name, "Emperors in the New World", not a language claim —
  // so rejecting "English" mentions there has no comparably clean signal
  // behind it and risks throwing out genuine matches instead.
  if (language === "English" && /\bjapanese\b|\bjp\b/i.test(title)) return false;

  // Chinese prints, rejected on EVERY tier because this site does not track
  // them. eBay's `Language` aspect is seller-declared and lets them through:
  // for OP09-061 Raw, an aspect_filter of Language:{Japanese} returns "One
  // Piece Chinese EN 2nd Anniversary Special OP09-061 L Monkey.D.Luffy HOLO
  // NM" at $204.99 among 16 results, and dropping the aspect entirely
  // surfaces at least four more Chinese listings of the same card_number.
  // eBay's own website does NOT return that listing for the equivalent
  // Language=Japanese search, so its facet applies something stricter than
  // the API's aspect_filter — confirmed by opening both.
  //
  // Matters more than an ordinary mis-tag because Chinese prints of the same
  // card_number trade far below the Japanese ones ($196-205 against $475+
  // here), so one leaking in lands at the top of a cheapest-first tab and
  // drags the median down with it.
  //
  // Applied to both tiers, unlike the JP check above, because there is no
  // Chinese tier for it to belong to. If Chinese is ever tracked (Pokémon
  // first, per current intent), this becomes a tier check rather than a
  // blanket exclusion.
  if (/\bchinese\b/i.test(title)) return false;

  const gradeOk =
    condition === "Raw"
      ? // Exclude anything that looks graded at all, rather than trying to
        // positively confirm "raw" (there's no consistent raw-specific
        // keyword sellers use the way they consistently write "PSA 10").
        !/\b(PSA|BGS|CGC|SGC|CGA|BCCG|HGA|ISA|KSA|GMA)\b/i.test(title)
      : new RegExp(`\\bPSA\\s*-?\\s*${condition.replace("PSA ", "")}\\b`, "i").test(title);
  if (!gradeOk) return false;

  const primaryNumber = (numberOverride ?? card.number)?.split("/")[0];
  if (primaryNumber && !numberMatchesTitle(primaryNumber, title)) return false;

  if (variantTags && variantTags.length > 0) {
    const titleLower = title.toLowerCase();
    const tagOk = variantTags.every((tag) => {
      const tagLower = tag.toLowerCase();
      return titleLower.includes(tagLower) || titleLower.includes(tagFirstWord(tagLower));
    });
    if (!tagOk) return false;
  }

  return true;
}

export type EbayActiveListing = {
  title: string;
  price: number;
  currency: string;
  url: string;
  imageUrl?: string;
  /**
   * eBay documents `itemCreationDate` as an ItemSummary field, but it's
   * unconfirmed whether item_summary/search actually populates it (vs only
   * the single-item getItem detail endpoint) — treat as best-effort, test
   * against real credentials before relying on it always being present.
   */
  listedDate?: string;
  /**
   * ISO 3166-1 alpha-2 country the item ships from (`itemLocation.country`).
   * Confirmed live that item_summary/search populates this — unlike
   * `listedDate` above, which is documented but unverified.
   *
   * Load-bearing, not decoration: for a card_number that exists as both an
   * English and a Japanese print, where the seller-declared `Language`
   * aspect is unreliable, this is the one hard fact eBay gives us about a
   * listing. See marketGuard below.
   */
  location?: string;
};

export type EbaySearchResult = {
  /** The cheapest few, for display. See DISPLAY_LIMIT. */
  listings: EbayActiveListing[];
  total: number;
  /**
   * Every ask that survived every filter, ascending — the set `listings` is
   * merely the first four of.
   *
   * Exists because four rows cannot describe a spread. eBay is asked for
   * FETCH_LIMIT results per search and we were keeping four, so the other
   * sixteen were paid for and discarded; anything that wants to say how
   * tightly a tier is priced needs them back. It costs no extra quota — the
   * request is byte-identical, only the slice moved downstream.
   *
   * Read it for what it is. These are the cheapest asks from ONE page of a
   * price-sorted search, so the array describes the floor of a tier, not the
   * tier. On a grade with 837 live listings it is still the cheap end, and a
   * spread taken from it is the spread of the floor — presenting that as the
   * tier's volatility would claim far more than it measures.
   */
  asks: number[];
};

type BrowseSearchResponse = {
  total?: number;
  itemSummaries?: {
    title: string;
    price?: { value: string; currency: string };
    itemWebUrl: string;
    image?: { imageUrl: string };
    itemCreationDate?: string;
    itemLocation?: { country?: string };
  }[];
};

/**
 * Extra constraints applied to the raw candidates AFTER eBay's own filters,
 * for the cases eBay cannot express. Both are opt-in per search — callers
 * that pass nothing get exactly the old behaviour.
 *
 * Why this exists, measured against a real search ("Event Vol P-033", Raw,
 * Language:{English}) on 2026-08-29: eBay returned 12 results, and 7 of them
 * were the JAPANESE print at $63-65 while the 5 real English listings sat at
 * $275-609. The card's own real market price is $423.50. So the majority of
 * a supposedly-English result set was the wrong print, which drags the
 * median to $65 and makes the English market look 6x cheaper than it is.
 *
 * Neither signal is sufficient alone, which is the whole reason there are
 * two:
 *
 *  - `excludeCountries` caught only 1 of those 7. The other 6 were
 *    US-located, with a title byte-identical to the Japanese one.
 *  - `minPrice` catches all 7, but cannot be derived from the result set
 *    itself: with 7 of 12 results wrong, the median IS the wrong cluster,
 *    so any outlier rule keyed off these results would discard the five
 *    real listings instead. It has to be anchored to a price we already
 *    trust from another source.
 */
export type EbayMarketGuard = {
  /** Drop listings shipping from these countries (ISO alpha-2). */
  excludeCountries?: string[];
  /** Drop listings priced below this. Anchor it to a price from a trusted source, never to the result set — see this type's own comment. */
  minPrice?: number;
};

/**
 * Fetched per search — deliberately far larger than DISPLAY_LIMIT, because
 * titleMatchesCard rejects a large share of what eBay returns (wrong grade,
 * wrong card sharing a name prefix, wrong number). At 10 the survivors
 * regularly fell short of the four rows the panel wants, leaving the
 * English market looking thinner than it is; 20 gives that filter enough
 * candidates to actually produce four.
 *
 * Free to raise: `limit` is one page of one call, so this costs no extra
 * API quota against eBay's daily cap.
 */
/**
 * Browse API sort values, confirmed live on 2026-08-29 (all HTTP 200 with
 * real results): "newlyListed", "price" (ascending), "-price" (descending).
 * `undefined` is Best Match, eBay's default.
 *
 * Note "price" sorts on price + shipping, so the `price.value` field this
 * client reads is close to ordered but not strictly monotonic — observed
 * 2300, 2300, 2400, 2600, 2599.99. Fine for picking the cheap end of a
 * market; do not rely on the array being sorted.
 */
type EbaySort = "newlyListed" | "price" | undefined;

/**
 * Cheapest-first for every tier, graded and raw alike.
 *
 * Graded populations are thin and priced over a wide spread, so "newest" is
 * an arbitrary draw from that spread — measured on Gengar VMAX PSA 10,
 * newest-first gave 2600/2626/2600/2633 while cheapest-first gave
 * 2300/2300/2400/2600. Raw was left on newest-first at first and then moved
 * here too, for consistency: a reader comparing tiers should not have one
 * tab answering "what's recent" and the next answering "what's cheap".
 *
 * This makes every median a FLOOR rather than a market rate. Deliberate, and
 * the reason the price guards in graded-market.ts matter so much: with the
 * cheap end of the market at the top of the panel, a junk or mispriced
 * listing goes from invisible to first-in-view.
 */
const PRIMARY_SORT: EbaySort = "price";

/**
 * MEASURED AND REJECTED, so it is not re-proposed: broadening the QUERY when
 * a tier comes back thin. The obvious next step after this threshold is a
 * cascade that drops the variant word and retries on number alone. It is a
 * trap. Checked with scripts/ebay-query-lab.mts on 2026-08-30 against the
 * tiers that actually come back empty:
 *
 *   OP09-093 PSA 9 EN   "Wanted OP09-093 PSA 9" -> 0
 *                       "OP09-093 PSA 9"        -> 6, at $25-180
 *   OP09-093 PSA 9 JA   0  ->  5, at $116-1770
 *   OP05-074 PSA 9 JA   0  ->  1, at $35.50
 *
 * Against reference prices of $253 and $884, and Wanted Poster PSA 10s at
 * $299-500, those broader results are the ORDINARY print of the same
 * card_number, not the variant being tracked. The proof is structural rather
 * than a judgement call: the narrow query already contains the variant word,
 * so eBay returning 0 for it while returning 6 for the number alone means
 * none of those 6 carry the word. They are a different card.
 *
 * So an empty tier here is the correct answer — that variant genuinely has
 * no listing at that grade — and graded-market.ts reports it as such
 * (noListings). Widening the net to fill the tab would publish the wrong
 * card's price.
 *
 * Below this many survivors, the primary search is retried on Best Match and
 * the two result sets are merged. Note that this changes the SORT, never the
 * query text — which is exactly why it is safe and a cascade is not. Four rows is what the panel wants; two or
 * fewer reads as a broken tab rather than a thin market, and Best Match
 * genuinely surfaces different inventory — eBay's own community reports
 * document Newly Listed and Best Match returning different result COUNTS for
 * one query (429 vs 490 in one case), not just a reordering.
 */
const MERGE_THRESHOLD = 2;

/**
 * runSearch's own return, richer than the public EbaySearchResult: it
 * carries the counts needed to attribute an empty result correctly.
 * searchActiveListings is the only consumer and reports on them once, after
 * its Best Match merge has had its chance — warning from inside runSearch
 * meant a search the merge went on to rescue still logged a failure.
 */
type RunSearchResult = EbaySearchResult & {
  /**
   * The full post-filter set `listings` was sliced from, same ascending
   * order. searchActiveListings merges on this rather than on the sliced
   * rows, so `asks` survives the Best Match merge whole.
   */
  survivors: EbayActiveListing[];
  /** Everything eBay returned, before any local filtering. */
  rawCount: number;
  /** How many survived titleMatchesCard — i.e. before the market guard ran. */
  titlePassCount: number;
};

const FETCH_LIMIT = 20;
/** Shown to the user (and used for the median) — the cheapest this-many survivors of titleMatchesCard, per the local sort below. */
const DISPLAY_LIMIT = 4;

/**
 * One search attempt at a given sort order. Not exported — searchActiveListings
 * below is the only caller, and decides whether a second attempt is needed.
 */
async function runSearch(
  card: Card,
  condition: EbayCondition,
  language: EbayLanguage | undefined,
  sort: EbaySort,
  nameOverride?: string,
  numberOverride?: string,
  variantTags?: string[],
  guard?: EbayMarketGuard
): Promise<RunSearchResult> {
  const query = conditionQuery(card, condition, nameOverride, numberOverride);
  const qs = new URLSearchParams({
    q: query,
    category_ids: CCG_INDIVIDUAL_CARDS_CATEGORY,
    filter: conditionFilter(condition),
    aspect_filter: precisionAspectFilter(condition, language),
    limit: String(FETCH_LIMIT),
  });
  if (sort) qs.set("sort", sort);

  /**
   * One retry on 401, with a forced-fresh token. A 401 here means the token
   * we hold is dead — expired, or served stale out of Next's Data Cache (see
   * getAccessToken's own comment) — and nothing about repeating the request
   * with the same token can fix it. Exactly one retry: if a genuinely fresh
   * token is also rejected, the credentials are wrong and looping would only
   * spend quota to keep learning that.
   *
   * Deliberately handled here rather than in resilientFetch, which treats
   * 401 as a hard "blocked" status that counts toward the circuit breaker.
   * That is right for a rejected API key and wrong for an expired bearer
   * token, which is recoverable and self-inflicted.
   */
  const attempt = (token: string) => resilientFetch(
    `${SEARCH_URL}?${qs}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      // cache: "force-cache" is required, not implied by next.revalidate —
      // this Next version's own fetch reference says caching is opt-in and
      // explicitly calls out a GET carrying an Authorization header (this
      // one) as needing it. Without it, this request is only ever cached on
      // a statically-prerendered render pass; any dynamic path — /api/mcp's
      // get_graded_market tool, /api/price-check, a product page that falls
      // through to on-demand rendering — refetches all 8 eBay searches on
      // every single call, ignoring REVALIDATE_SECONDS and burning real
      // quota against eBay's 5,000 calls/day limit for no freshness
      // benefit. Same gap this codebase's own next.config.ts rewrite
      // comment on /tools/price-checker?cardId= already documented hitting
      // for this exact reason, worked around there by rewriting to a
      // static path instead of fixing it at the source.
      cache: "force-cache",
      next: { revalidate: REVALIDATE_SECONDS },
    },
    FETCH_TIMEOUT_MS
  );

  let res = await attempt(await getAccessToken());
  if (res.status === 401) {
    console.warn(`[ebay] 401 for "${query}" [${condition}] — held token is dead, retrying once with a forced-fresh token.`);
    res = await attempt(await getAccessToken(true));
  }
  if (!res.ok) {
    throw new Error(`ebay browse search failed (${res.status}) for "${query}" [${condition}, sort=${sort ?? "bestMatch"}]: ${await res.text()}`);
  }
  const data = (await res.json()) as BrowseSearchResponse;
  const rawItems = data.itemSummaries ?? [];
  const priced = rawItems
    .map((item) => ({
      title: item.title,
      price: Number(item.price?.value ?? 0),
      currency: item.price?.currency ?? "USD",
      url: item.itemWebUrl,
      imageUrl: item.image?.imageUrl,
      listedDate: item.itemCreationDate,
      location: item.itemLocation?.country,
    }))
    // Defensive: never let a listing with no real price into the median —
    // a $0 entry would silently drag it down instead of erroring loudly.
    .filter((listing) => listing.price > 0);

  // Split deliberately rather than chained: the count AFTER the title check
  // and BEFORE the guard is the only thing that can tell those two apart
  // when a result set ends up empty.
  const titlePassed = priced.filter((listing) =>
    titleMatchesCard(listing.title, card, condition, numberOverride, variantTags, language)
  );

  const survivors = titlePassed
    // Applied after titleMatchesCard so the warning below still reports the
    // title check honestly, and so a guard can never be blamed for a result
    // set that was already empty.
    .filter((listing) => !guard?.excludeCountries?.includes(listing.location ?? ""))
    .filter((listing) => guard?.minPrice === undefined || listing.price >= guard.minPrice)
    // Re-sorted locally before the slice, because the API's own `sort=price`
    // cannot be trusted to return a globally ordered result set.
    //
    // Measured on P-033's English PSA 10 tier, which came back:
    //   1131.91  1220  1350  4499.99 | 1353.73  2000  2000  2500
    // Two ascending runs concatenated, not one ordering — the signature of
    // results sorted within shards and joined. Every price is USD and
    // shipping is absent or under $20, so neither currency conversion nor
    // price-plus-shipping explains it (an earlier version of this comment
    // claimed shipping, wrongly: shipping cannot be negative, and nothing
    // can place 4499.99 between 1350 and 1353.73). `priceCurrency` as a
    // filter is rejected outright by the API (errorId 12002), so there is no
    // parameter to fix it with either.
    //
    // Not a data problem: eBay's own website sorts the identical search
    // correctly under _sop=15 and puts the 4499.99 last. It is the Browse
    // API's sort specifically.
    //
    // Left in the request anyway — it costs nothing and gets the cheap end
    // into the fetched window — but the displayed order and therefore the
    // median must come from this local sort. Without it, which four rows a
    // visitor sees is decided by eBay's sharding.
    .sort((a, b) => a.price - b.price);

  // The slice lives here and nowhere upstream: `survivors` is what the asks
  // array is built from, `listings` is only what the panel prints.
  const listings = survivors.slice(0, DISPLAY_LIMIT);

  return {
    listings,
    survivors,
    asks: survivors.map((listing) => listing.price),
    total: data.total ?? listings.length,
    rawCount: rawItems.length,
    titlePassCount: titlePassed.length,
  };
}

/**
 * Last few active listings for one condition tier (newest-listed first,
 * filtered for quality — see titleMatchesCard) plus the real total match
 * count, for a "see all N listings" link.
 *
 * Restricted to buyingOptions:FIXED_PRICE on purpose: an auction listing's
 * `price` in the Browse API response is the current bid (or starting bid if
 * no one's bid yet), not a real asking price — mixing that into a price
 * comparison or the ROI median would be comparing incompatible numbers, not
 * a data-quality nicety.
 *
 * Falls back from sort=newlyListed to Best Match (no sort param) if the
 * newest-first search comes back with nothing — confirmed via eBay's own
 * community reports that "Newly Listed" and "Best Match" can return
 * genuinely different result *counts* for the same query, not just the same
 * results reordered (one documented example: 429 vs 490 results). Best
 * Match isn't recency-biased the way Newly Listed's indexing apparently is,
 * so it can still surface a real, currently-active listing that's simply
 * been sitting unsold for a while — which matters most for rare cards,
 * where "nothing new" and "nothing at all" are very different situations.
 * Only fires when the first attempt is empty, so the common case (a card
 * with real recent activity) costs exactly one request, same as before.
 *
 * `nameOverride`/`numberOverride` are threaded straight through to
 * conditionQuery/cardSearchTerms and titleMatchesCard — see
 * cardSearchTerms's doc comment (lib/ebay-search.ts) for why. `variantTags`
 * is threaded to titleMatchesCard only (never into the query text itself) —
 * see that function's own comment for why.
 */
export async function searchActiveListings(
  card: Card,
  condition: EbayCondition,
  language?: EbayLanguage,
  nameOverride?: string,
  numberOverride?: string,
  variantTags?: string[],
  guard?: EbayMarketGuard
): Promise<EbaySearchResult> {
  const primary = await runSearch(card, condition, language, PRIMARY_SORT, nameOverride, numberOverride, variantTags, guard);
  if (primary.listings.length > MERGE_THRESHOLD) return primary;

  // Best Match is not recency-biased the way the sorted searches are, so it
  // can surface a real listing that has simply been sitting unsold — which
  // matters most on exactly the thin markets that trip MERGE_THRESHOLD.
  const fallback = await runSearch(card, condition, language, undefined, nameOverride, numberOverride, variantTags, guard);

  // Merged rather than replaced: the point is to REACH four rows, and either
  // search alone may be short. Deduped by item URL, since the same listing
  // legitimately appears in both result sets.
  const seen = new Set<string>();
  const merged = [...primary.survivors, ...fallback.survivors]
    .filter((listing) => (seen.has(listing.url) ? false : (seen.add(listing.url), true)))
    // Re-sorted because the merge interleaves two orderings, and the panel's
    // contract is cheapest-first (see PRIMARY_SORT).
    .sort((a, b) => a.price - b.price);

  // Merging the full survivor sets rather than the two sliced fours, so the
  // merged `asks` is every ask both searches saw. The displayed rows are
  // unchanged by that: each side was already its own cheapest-four, and the
  // cheapest four of a union cannot contain anything that was not already in
  // its own side's cheapest four.
  const listings = merged.slice(0, DISPLAY_LIMIT);

  if (listings.length === 0) reportEmpty(card, condition, language, guard, fallback);
  return {
    listings,
    total: Math.max(primary.total, fallback.total),
    asks: merged.map((listing) => listing.price),
  };
}

/**
 * Says WHY a tier came back empty, once, after every attempt has been made.
 *
 * The attribution is the point. "eBay had nothing", "everything eBay sent
 * was the wrong card" and "our own guard removed it all" are three different
 * problems with three different fixes, and they used to be reported as one
 * — worse, the guard was blamed for the title check's work, because the
 * count being tested was "items with a price" rather than "items that passed
 * the title check". Both warnings fired on the same search, e.g. Lugia V
 * PSA 8, which sent whoever read the log looking at the wrong thing.
 */
function reportEmpty(
  card: Card,
  condition: EbayCondition,
  language: EbayLanguage | undefined,
  guard: EbayMarketGuard | undefined,
  last: RunSearchResult
): void {
  const where = `${card.id} [${condition}/${language ?? "any"}]`;
  if (last.rawCount === 0) {
    // Not a defect: a thin tier genuinely has no sellers today. The panel
    // says so rather than showing preview rows (see graded-market.ts's
    // noListings).
    return;
  }
  if (last.titlePassCount === 0) {
    console.warn(
      `[ebay] all ${last.rawCount} result(s) for ${where} failed the title check — eBay returned listings, none of them this card. ` +
        `Suspect the query text or the tier filter, not the market guard.`
    );
    return;
  }
  console.warn(
    `[ebay] ${last.titlePassCount} of ${last.rawCount} result(s) for ${where} were the right card, then all were removed by the market guard ` +
      `(excludeCountries=${JSON.stringify(guard?.excludeCountries ?? [])}, minPrice=${guard?.minPrice ?? "none"}). ` +
      `Suspect the anchor price for this card, not the query.`
  );
}
