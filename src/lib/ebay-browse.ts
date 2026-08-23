import { cardSearchTerms } from "@/lib/ebay-search";
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
 */

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

/** eBay's "CCG Individual Cards" category — where graded/raw Pokémon singles live. */
const CCG_INDIVIDUAL_CARDS_CATEGORY = "183454";

const REVALIDATE_SECONDS = 60 * 60; // active listings churn much faster than apitcg's 36h card-data window

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

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  if (inFlightTokenRequest) return inFlightTokenRequest;

  inFlightTokenRequest = (async () => {
    const { id, secret } = credentials();
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
      // NOT cache: "no-store" — that maps to Next's revalidate: 0, which
      // taints the *entire calling route* as dynamic. This function only
      // ever runs when the in-memory cachedToken above is empty or genuinely
      // expired, so a real fresh token is always wanted regardless of what
      // Next's Data Cache does here — and POST requests aren't cached by
      // Next's Data Cache by default anyway, so a short positive revalidate
      // costs nothing while staying compatible with /products/[slug]'s
      // static generation. Confirmed live: omitting this (or using
      // no-store) broke static rendering in production with
      // "Dynamic server usage ... couldn't be rendered statically" and
      // "Page changed from static to dynamic at runtime" errors.
      next: { revalidate: 60 },
    });
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
 * `nameOverride` is threaded straight through to cardSearchTerms — see its
 * doc comment for why (localized name, e.g. TCGdex's French translation).
 */
function conditionQuery(card: Card, condition: EbayCondition, nameOverride?: string): string {
  const base = cardSearchTerms(card, nameOverride);
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
 */
function titleMatchesCard(title: string, card: Card, condition: EbayCondition): boolean {
  const gradeOk =
    condition === "Raw"
      ? // Exclude anything that looks graded at all, rather than trying to
        // positively confirm "raw" (there's no consistent raw-specific
        // keyword sellers use the way they consistently write "PSA 10").
        !/\b(PSA|BGS|CGC|SGC|CGA|BCCG|HGA|ISA|KSA|GMA)\b/i.test(title)
      : new RegExp(`\\bPSA\\s*-?\\s*${condition.replace("PSA ", "")}\\b`, "i").test(title);
  if (!gradeOk) return false;

  const primaryNumber = card.number?.split("/")[0];
  if (!primaryNumber) return true; // nothing to check the number against
  return new RegExp(`\\b${primaryNumber}\\b`).test(title);
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
};

export type EbaySearchResult = { listings: EbayActiveListing[]; total: number };

type BrowseSearchResponse = {
  total?: number;
  itemSummaries?: {
    title: string;
    price?: { value: string; currency: string };
    itemWebUrl: string;
    image?: { imageUrl: string };
    itemCreationDate?: string;
  }[];
};

/** Fetched per search — larger than DISPLAY_LIMIT on purpose, so wrong-card/wrong-grade noise (see titleMatchesCard) has real candidates left to filter down from instead of leaving a rare card with nothing. Free: `limit` doesn't cost extra API quota, it's still one call. */
const FETCH_LIMIT = 10;
/** Shown to the user (and used for the median) — the first this-many survivors of titleMatchesCard, still newest-first. */
const DISPLAY_LIMIT = 4;

/**
 * One search attempt at a given sort order. Not exported — searchActiveListings
 * below is the only caller, and decides whether a second attempt is needed.
 */
async function runSearch(
  card: Card,
  condition: EbayCondition,
  language: EbayLanguage | undefined,
  sort: "newlyListed" | undefined,
  nameOverride?: string
): Promise<EbaySearchResult> {
  const token = await getAccessToken();
  const query = conditionQuery(card, condition, nameOverride);
  const qs = new URLSearchParams({
    q: query,
    category_ids: CCG_INDIVIDUAL_CARDS_CATEGORY,
    filter: conditionFilter(condition),
    aspect_filter: precisionAspectFilter(condition, language),
    limit: String(FETCH_LIMIT),
  });
  if (sort) qs.set("sort", sort);

  const res = await fetch(`${SEARCH_URL}?${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!res.ok) {
    throw new Error(`ebay browse search failed (${res.status}) for "${query}" [${condition}, sort=${sort ?? "bestMatch"}]: ${await res.text()}`);
  }
  const data = (await res.json()) as BrowseSearchResponse;
  const rawItems = data.itemSummaries ?? [];
  const listings = rawItems
    .map((item) => ({
      title: item.title,
      price: Number(item.price?.value ?? 0),
      currency: item.price?.currency ?? "USD",
      url: item.itemWebUrl,
      imageUrl: item.image?.imageUrl,
      listedDate: item.itemCreationDate,
    }))
    // Defensive: never let a listing with no real price into the median —
    // a $0 entry would silently drag it down instead of erroring loudly.
    .filter((listing) => listing.price > 0)
    .filter((listing) => titleMatchesCard(listing.title, card, condition))
    .slice(0, DISPLAY_LIMIT);

  if (rawItems.length > 0 && listings.length === 0) {
    console.warn(
      `[ebay] all ${rawItems.length} result(s) for "${query}" [${condition}, sort=${sort ?? "bestMatch"}] failed the title sanity check — ` +
        `the filter likely isn't actually constraining to this tier. Treating as no real match.`
    );
  }

  return { listings, total: data.total ?? listings.length };
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
 * `nameOverride` is threaded straight through to conditionQuery/cardSearchTerms
 * — see cardSearchTerms's doc comment (lib/ebay-search.ts) for why.
 */
export async function searchActiveListings(
  card: Card,
  condition: EbayCondition,
  language?: EbayLanguage,
  nameOverride?: string
): Promise<EbaySearchResult> {
  const primary = await runSearch(card, condition, language, "newlyListed", nameOverride);
  if (primary.listings.length > 0) return primary;
  return runSearch(card, condition, language, undefined, nameOverride);
}
