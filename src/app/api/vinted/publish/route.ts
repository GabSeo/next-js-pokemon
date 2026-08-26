import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { VINTED_CACHE_TAG } from "@/lib/lobstr";

/**
 * "The squid just ran — go and look."
 *
 * Nothing in this app can tell that a Lobstr run finished. Lobstr does not
 * call us, and the read path deliberately does not poll (a product page
 * render must not wait on a scraper vendor). So a collection triggered by
 * hand from Lobstr's dashboard is invisible here until two independent
 * caches happen to lapse on their own:
 *
 *   1. The Data Cache holding the run list and each page of results —
 *      RUNS/RESULTS_REVALIDATE_SECONDS, six hours.
 *   2. The rendered HTML of every product page — ISR, `revalidate = 129600`,
 *      thirty-six hours.
 *
 * Worst case that is a day and a half before a fresh scrape reaches the
 * site, which is not what "I re-ran it, show me" should mean. This endpoint
 * collapses both to seconds.
 *
 * It is the READ side only and costs nothing: no scrape, no credits, no
 * Lobstr write. Hitting it twice is the same as hitting it once. That is
 * exactly why it lives at its own path rather than as a flag on
 * /api/vinted/refresh, whose POST spends a full collection's credits — the
 * one you want to fat-finger is not the one that bills you.
 *
 * Use it either way round:
 *
 *   - By hand, after the dashboard run reports Done:
 *       curl -X POST "https://<host>/api/vinted/publish" \
 *            -H "Authorization: Bearer $LOBSTR_REFRESH_SECRET"
 *   - From a Lobstr webhook on run completion, which is the pattern Lobstr's
 *     own docs recommend over polling. Webhook senders often cannot set
 *     headers, so the secret is also accepted as ?secret= and GET is allowed
 *     alongside POST. That does put the secret in a URL (and therefore in
 *     access logs), which is an accepted trade for an endpoint whose entire
 *     power is "recompute something you could have recomputed by waiting".
 */

export const dynamic = "force-dynamic";

/**
 * Every route whose HTML embeds Vinted rows. The `[slug]`/`[franchise]`
 * forms are route PATTERNS, not paths — with type "page" one call marks
 * every card's copy of that route, so this list does not grow when a card
 * is added to card-refs.ts.
 *
 * The .md route handlers are here for the same reason the pages are: they
 * serve the same feed to agents, from the same cache, and a machine reader
 * being 36h behind the HTML is the sort of drift nobody notices.
 */
const VINTED_ROUTE_PATTERNS = [
  "/products/[slug]",
  "/products/[slug]/fr",
  "/products/[slug]/ja",
  "/products/[slug]/index.md",
  "/products/[slug]/fr/index.md",
  "/collections/[franchise]",
  "/collections/[franchise]/index.md",
] as const;

/** Literal paths take no type parameter — see revalidatePath's own API contract. */
const VINTED_LITERAL_PATHS = ["/"] as const;

/** Same secret as the refresh route, and FAILING CLOSED for the same reason: with none configured, nothing is authorized. */
function isAuthorized(request: Request): boolean {
  const secret = process.env.LOBSTR_REFRESH_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(request.url).searchParams.get("secret") === secret;
}

function publish() {
  // Order matters. Drop the upstream reads FIRST: a page regenerated before
  // its Lobstr fetches were invalidated would rebuild from the cache we are
  // about to throw away, and then sit on that stale HTML for another 36h —
  // turning a cache refresh into a cache refresh that changed nothing.
  //
  // `{ expire: 0 }` rather than the documented-as-recommended `"max"`, and
  // the difference matters here. "max" is stale-while-revalidate: the next
  // visitor is served the OLD feed while the new one loads behind them, so
  // the person who just re-ran the squid and reloaded to check still sees
  // yesterday's listings — the exact "refresh a few times and it comes back"
  // behaviour this whole endpoint exists to end. `expire: 0` expires the
  // entry outright, so the next request blocks on a fresh read and gets the
  // new run. One slow request on a low-traffic page is the right trade for
  // "I re-ran it, show me" actually meaning that.
  //
  // (updateTag would be the immediate-expiry API of choice, but it is
  // Server-Action-only by contract and cannot be called from a Route
  // Handler. Next 16 also made the second argument REQUIRED — the old
  // single-argument revalidateTag(tag) is deprecated and no longer
  // typechecks.)
  revalidateTag(VINTED_CACHE_TAG, { expire: 0 });

  for (const pattern of VINTED_ROUTE_PATTERNS) revalidatePath(pattern, "page");
  for (const path of VINTED_LITERAL_PATHS) revalidatePath(path);

  return NextResponse.json({
    published: true,
    tag: VINTED_CACHE_TAG,
    routes: [...VINTED_ROUTE_PATTERNS, ...VINTED_LITERAL_PATHS],
    // Route Handlers mark rather than rebuild: Next revalidates each path on
    // its NEXT visit. So the first person to load a product page after this
    // call pays the regeneration and everyone after them gets it free —
    // which is why this returns instantly and the site can still take a
    // moment to visibly change.
    note: "Caches dropped. Each route rebuilds on its next visit — reload a product page to trigger it.",
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return publish();
}

/** GET does the same thing, so the URL can be pasted into a browser or handed to a webhook that only sends GETs. Safe to repeat: it invalidates caches, it does not scrape. */
export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return publish();
}
