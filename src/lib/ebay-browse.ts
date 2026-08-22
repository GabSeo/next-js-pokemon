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
// shared across all callers, not tied to any one user or request.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

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
    cache: "no-store", // token endpoint, never cache
  });
  if (!res.ok) {
    throw new Error(`ebay oauth token request failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

export type EbayCondition = "PSA 10" | "PSA 9" | "PSA 8" | "Raw";

/**
 * aspect_filter values for each condition tier, as name/value TEXT pairs
 * (e.g. "Professional Grader" / "Professional Sports Authenticator"), not
 * eBay's separate numeric condition-descriptor IDs (27501/27502/etc) — those
 * numeric IDs are documented for *listing* trading cards via the Inventory
 * API, and it's unconfirmed whether Browse API's search-side aspect_filter
 * accepts the same numeric system or needs the text form instead. This
 * follows the text-pair syntax from a real (if unresolved) attempted query
 * in eBay's own developer community, since that's the closest thing to
 * verified real-world usage found — TEST THIS against a live account before
 * trusting it; the numeric-ID form may turn out to be required instead.
 */
function conditionAspectFilter(condition: EbayCondition): string {
  if (condition === "Raw") {
    return `categoryId:${CCG_INDIVIDUAL_CARDS_CATEGORY}`;
  }
  const grade = condition.replace("PSA ", "");
  return [
    `categoryId:${CCG_INDIVIDUAL_CARDS_CATEGORY}`,
    `conditionDescriptors.name:{Professional Grader}`,
    `conditionDescriptors.values.content:{Professional Sports Authenticator}`,
    `conditionDescriptors.name:{Grade}`,
    `conditionDescriptors.values.content:{${grade}}`,
  ].join(",");
}

export type EbayActiveListing = {
  title: string;
  price: number;
  currency: string;
  url: string;
  imageUrl?: string;
};

type BrowseSearchResponse = {
  itemSummaries?: {
    title: string;
    price?: { value: string; currency: string };
    itemWebUrl: string;
    image?: { imageUrl: string };
  }[];
};

/** Last 3 active listings for one condition tier, newest-listed first. */
export async function searchActiveListings(card: Card, condition: EbayCondition): Promise<EbayActiveListing[]> {
  const token = await getAccessToken();
  const query = `${card.name} ${card.set}${card.number ? ` ${card.number}` : ""}`.trim();
  const qs = new URLSearchParams({
    q: query,
    category_ids: CCG_INDIVIDUAL_CARDS_CATEGORY,
    aspect_filter: conditionAspectFilter(condition),
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
  return (data.itemSummaries ?? []).map((item) => ({
    title: item.title,
    price: Number(item.price?.value ?? 0),
    currency: item.price?.currency ?? "USD",
    url: item.itemWebUrl,
    imageUrl: item.image?.imageUrl,
  }));
}
