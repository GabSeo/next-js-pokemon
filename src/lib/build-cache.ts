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
 * rendered by roughly a dozen different routes during static generation —
 * /products/[slug], its /ja and /fr alternates and their index.md mirrors,
 * the JSON API keyed by BOTH slug and resolved id, the /okf mirror, and the
 * price-checker's prebuilt twin. Each of those is a separate render, so
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
const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "resolved-cards");

/**
 * How long a cached entry is trusted across separate `next build`
 * invocations (this build, plus however many redeploys land inside the
 * window) before a fresh resolution is forced — well under
 * BerryWallet/PokéWallet's own 36h upstream revalidate window
 * (REVALIDATE_SECONDS in berrywallet.ts/pokewallet.ts), so this is never the
 * stalest link in the chain. Long enough to absorb a burst of redeploys
 * during active development/testing without spending quota on each one.
 */
const ENTRY_TTL_MS = 6 * 60 * 60 * 1000;

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
 */
export async function buildCached<T>(key: string, compute: () => Promise<T>): Promise<T> {
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
    const entry: Entry<T> = { value, expiresAt: Date.now() + ENTRY_TTL_MS };
    writeFileSync(file, JSON.stringify(entry));
  } catch {
    // Best effort — see this function's own doc comment.
  }
  return value;
}
