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
      cache: "no-store", // token endpoint — never let Next's Data Cache serve a stale one
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
 */
function conditionQuery(card: Card, condition: EbayCondition): string {
  const base = cardSearchTerms(card);
  return condition === "Raw" ? base : `${base} ${condition}`;
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

/**
 * Last 3 active listings for one condition tier (newest-listed first) plus
 * the real total match count, for a "see all N listings" link.
 *
 * Restricted to buyingOptions:FIXED_PRICE on purpose: an auction listing's
 * `price` in the Browse API response is the current bid (or starting bid if
 * no one's bid yet), not a real asking price — mixing that into a price
 * comparison or the ROI median would be comparing incompatible numbers, not
 * a data-quality nicety.
 */
export async function searchActiveListings(card: Card, condition: EbayCondition): Promise<EbaySearchResult> {
  const token = await getAccessToken();
  const query = conditionQuery(card, condition);
  const qs = new URLSearchParams({
    q: query,
    category_ids: CCG_INDIVIDUAL_CARDS_CATEGORY,
    filter: conditionFilter(condition),
    sort: "newlyListed",
    limit: "3",
  });

  const res = await fetch(`${SEARCH_URL}?${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!res.ok) {
    throw new Error(`ebay browse search failed (${res.status}) for "${query}" [${condition}]: ${await res.text()}`);
  }
  const data = (await res.json()) as BrowseSearchResponse;
  const listings = (data.itemSummaries ?? [])
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
    .filter((listing) => listing.price > 0);
  return { listings, total: data.total ?? listings.length };
}
