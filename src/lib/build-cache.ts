import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Disk-backed memoization for `next build`'s static-generation phase —
 * specifically for the expensive, quota-limited upstream lookups
 * (BerryWallet, PokéWallet, apitcg identity resolution) that were otherwise
 * being repeated once per *route*, not once per *card*.
 *
 * Why this exists: React's `cache()` (see cards.ts's resolveCardSafe) only
 * de-dupes calls within one render pass, but a single card is independently
 * rendered by several different routes during static generation —
 * /products/[slug] and its index.md mirror, the JSON API keyed by BOTH slug
 * and resolved id, the /okf mirror, and the price-checker's prebuilt twin.
 * (It used to be roughly a dozen: the /fr and /ja alternates and their own
 * index.md mirrors accounted for four more, each with a generateStaticParams
 * pass of its own, until the language toggle moved in-page — see
 * components/product-locale.tsx.) Each of those is a separate render, so
 * cache() buys nothing across them. Worse, getCardByIdOrSlug's id-keyed
 * lookup path (used by the JSON API's id params) has to re-resolve an
 * ENTIRE franchise just to find one card by id (see that function's own
 * comment) — for N cards that's N *separate* full-franchise re-resolutions,
 * one per id-page, each redoing every other card's work too. Confirmed
 * live: this combination turned a handful of cards' worth of real lookups
 * into 100+ actual HTTP calls in one build, blowing through
 * BerryWallet/PokéWallet's shared 100/hour quota (see upstream.ts's
 * RATE_LIMIT_BREAKER_OPEN_MS, added for the same incident).
 *
 * `next build`'s static-generation workers are separate processes (or
 * worker_threads — see buildPhaseActive's own comment) but share one
 * filesystem for the life of the build, so a plain JSON file under
 * `.next/cache` works as a cross-worker cache without needing to trust
 * Next's own fetch Data Cache to survive Turbopack + worker parallelism —
 * empirically it doesn't, reliably, which is the actual reason this exists
 * instead of just trusting the `cache: "force-cache"` these clients already
 * set (see berrywallet.ts/pokewallet.ts/apitcg.ts's own fetch calls).
 *
 * `.next/cache` specifically (not `.next` as a whole) is the directory
 * Vercel's own build pipeline already restores between deployments — "
 * Restored build cache from previous deployment" in a Vercel build log is
 * this exact mechanism working for Next's own caches — and, unlike `.next`
 * generally, it's Vercel's documented build-time-only cache: it is never
 * part of a deployed serverless function's bundle, so a value written here
 * can't leak into a live request and serve stale data forever the way
 * writing under `.next` root could. ENTRY_TTL_MS below is the other half of
 * that safety net: even across the several deployments this cache is meant
 * to survive, an entry eventually expires into a fresh live resolution
 * rather than serving indefinitely stale card data.
 */
/**
 * Bump this whenever you change HOW a cached value is computed — not when
 * you change the upstream data, which the TTL already handles.
 *
 * This exists because the same failure happened three times on 2026-08-29,
 * and the shape was identical each time: a code change ships, Vercel
 * restores `.next/cache` from the previous deployment, the new build reuses
 * a value computed by the OLD code, and production serves pre-change data
 * for up to ENTRY_TTL_MS while every local check says the fix works. It cost
 * an hour of "nothing changed" each time:
 *
 *   1. French stayed inert after api.eu1 fixed TCGdex reachability.
 *   2. Card identity stayed on the apitcg fallback after the same fix.
 *   3. The eBay market guard shipped, and product pages kept serving the
 *      unguarded median ($221.50 against a corrected $474.99) while the
 *      dynamic route returned the corrected one.
 *
 * Surviving deploys is the whole point of this cache (see the header
 * comment) — it is what keeps a redeploy from re-spending quota. So the fix
 * is not to shorten its reach but to make a deliberate computation change
 * able to say so. Bumping this starts a fresh namespace; the previous one is
 * simply never read again.
 */
const CACHE_VERSION = 2;

/** Versioned so a computation change cannot silently reuse pre-change values across a deploy — see CACHE_VERSION. */
const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "resolved-cards", `v${CACHE_VERSION}`);

/**
 * How long a cached entry is trusted across separate `next build`
 * invocations (this build, plus however many redeploys land inside the
 * window) before a fresh resolution is forced. Now EQUAL to, rather than
 * under, the upstream revalidate window every card client uses
 * (REVALIDATE_SECONDS in apitcg.ts/tcgdex.ts/berrywallet.ts/pokewallet.ts,
 * all 24h since 2026-08-29) — the two layers simply expire on the same
 * daily cadence.
 *
 * The honest consequence, since this used to claim it was never the stalest
 * link: a deploy landing just before this entry expires ships data up to
 * 24h old, and that page then starts its own 24h ISR window. Worst case,
 * something on screen is ~48h old rather than ~24h. Shortening this to
 * restore the old invariant is not free — it would allow two cold
 * resolutions a day, and apitcg's ~2 calls x 9 cards would then be ~36/day
 * against a 1,000/month cap (~1,080/month), i.e. over. Daily is the right
 * cadence for both layers; the 48h tail is the price and it is small.
 *
 * Raised from 6h to 24h when the tracked-card count went past a handful,
 * because at 6h this became the binding constraint on apitcg's *monthly*
 * quota rather than a saving against it. The arithmetic, for 9 tracked
 * cards: one cold resolution costs ~2 apitcg calls per card (a product
 * lookup plus getHistoryPrices), so ~18 per cold window. A 6h TTL allows
 * four cold windows a day — ~72 calls/day, ~2,160/month against a 1,000/month
 * free tier, i.e. over cap by more than 2x before a single extra deploy.
 * At 24h that is ~18/day and ~540/month, which fits with real headroom.
 *
 * Nothing about page freshness changes: pages still revalidate on their own
 * 24h timer, and a *cold* window is only ever reached by a deploy, so in
 * steady state this simply stops charging the quota for redeploys that
 * would have resolved identical data. lib/api-budget.ts is the hard ceiling
 * underneath this; this is the lever that keeps normal builds nowhere near
 * it.
 */
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `next build` reliably sets NEXT_PHASE on its own process — except inside a
 * static-generation worker, confirmed live (the same gap upstream.ts's
 * markBuildOutage already works around): Next runs those as
 * `worker_threads`, which get a snapshot of `process.env` at spawn time
 * rather than live updates, so a worker can miss a `NEXT_PHASE` the parent
 * set moments earlier. `.next/cache` existing is the fallback signal for
 * exactly that case — see this file's own header comment for why it's also
 * a safe one at runtime (it isn't part of a deployed function's bundle).
 */
function buildPhaseActive(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build" || existsSync(path.join(process.cwd(), ".next", "cache"));
}

type Entry<T> = { value: T; expiresAt: number };

/**
 * How long a result the caller classes as *negative* is trusted — a
 * translation that came back untranslated, a lookup that found nothing.
 *
 * Deliberately minutes, not hours, and the difference is not cosmetic.
 * Confirmed live on the first run after this cache was extended to the
 * translation resolvers: a TCGdex connect timeout (IPv6, ~10s) made
 * getFrenchCardText return its `translated: false` fallback, and at the
 * full ENTRY_TTL_MS that transient blip would have kept a card's FR toggle
 * inert for a whole day — long after TCGdex recovered, and with no way to
 * tell from the page that anything had gone wrong.
 *
 * A positive result is a fact about a card and stays cheap to trust for a
 * day. A negative result is usually a fact about the *network*, and the
 * only honest thing to do with it is re-ask soon. Long enough to still
 * collapse one build's worth of repeats (the thing this module exists for),
 * short enough that the next deploy re-tries.
 */
const NEGATIVE_TTL_MS = 15 * 60 * 1000;

/**
 * Runs `compute()` at most once per `key` per ENTRY_TTL_MS window, sharing
 * that result across every static-generation worker in this build — and the
 * next few, within the TTL — via a JSON file. Falls straight through to
 * `compute()`, uncached, outside `next build`: a live request only ever
 * renders one route, so there's no cross-route fan-out here to de-dupe, and
 * the filesystem may be read-only anyway.
 *
 * Best-effort throughout, same spirit as markBuildOutage: a read/write
 * failure (a corrupt entry, a race with a concurrent writer, a read-only
 * disk) just means this key falls back to a live `compute()` — a cache miss
 * is never the reason a page fails to build.
 *
 * `isNegative` lets a caller say "this particular result means the lookup
 * didn't work", which caches it for NEGATIVE_TTL_MS instead of
 * ENTRY_TTL_MS. Callers whose failure mode is already a distinct value
 * should pass it; callers where every outcome is equally a real answer
 * (resolveCardSafe, which returns a genuine offline placeholder card that
 * the page is designed to render) should not.
 */
export async function buildCached<T>(
  key: string,
  compute: () => Promise<T>,
  isNegative?: (value: T) => boolean
): Promise<T> {
  if (!buildPhaseActive()) return compute();

  const file = path.join(CACHE_DIR, `${encodeURIComponent(key)}.json`);
  try {
    if (existsSync(file)) {
      const entry = JSON.parse(readFileSync(file, "utf8")) as Entry<T>;
      if (entry.expiresAt > Date.now()) return entry.value;
    }
  } catch {
    // Corrupt or caught mid-write by another worker — fall through to a
    // fresh compute below rather than failing the page over it.
  }

  const value = await compute();
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const ttl = isNegative?.(value) ? NEGATIVE_TTL_MS : ENTRY_TTL_MS;
    const entry: Entry<T> = { value, expiresAt: Date.now() + ttl };
    writeFileSync(file, JSON.stringify(entry));
  } catch {
    // Best effort — see this function's own doc comment.
  }
  return value;
}
