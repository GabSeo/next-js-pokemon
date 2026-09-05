import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * A hard ceiling on how many calls one credential may make during
 * `next build`, enforced across every static-generation worker and across
 * the several redeploys that can land inside a single quota window.
 *
 * Why this exists, separately from everything else already here: the
 * circuit breaker in upstream.ts is *reactive* — it backs off for an hour
 * once a 429 has already been returned (RATE_LIMIT_BREAKER_OPEN_MS), which
 * is the right shape for surviving an exhausted quota but does nothing to
 * stop the build that exhausts it. Every free tier this app runs on is
 * small enough that spending the quota is itself the failure:
 *
 *   PokéWallet     100 calls/hour, 1,000/day   (POKEWALLET_API_KEY)
 *   BerryWallet    100 calls/hour, 1,000/day   (BERRYWALLET_API_KEY)
 *   apitcg         1,000 calls/month
 *   eBay Browse    5,000 calls/day
 *
 * A tracked-card count that grows (3 -> 9 and upward) multiplies build cost
 * linearly, and a burst of redeploys multiplies it again, so "how many
 * calls did that build make" stops being something anyone can hold in their
 * head. This makes the answer enforceable instead of estimated: past the
 * budget, the call is refused locally and the caller takes the same
 * fallback path it already takes for an unreachable upstream. A card whose
 * Japanese toggle goes inert for a few hours is a far cheaper outcome than
 * a month's apitcg allowance spent in one afternoon of redeploys.
 *
 * Budgets are deliberately well under each real cap — the gap is the
 * headroom left for production ISR revalidation, which runs outside a build
 * and is not counted here (see this file's own `buildPhaseActive` note).
 *
 * Best-effort, exactly like build-cache.ts: workers race on these files and
 * a lost write just means a call or two goes uncounted. That is why the
 * budgets sit below the real caps rather than at them — this is a spend
 * ceiling, not an accountant.
 */

/** Where the rolling counters live. `.next/cache` is Vercel's documented build-time-only cache and is restored between deployments, which is exactly what lets a budget span the redeploys inside one quota window — see build-cache.ts's header for the full reasoning on this directory. */
const BUDGET_DIR = path.join(process.cwd(), ".next", "cache", "api-budget");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;

type Window = { limit: number; windowMs: number };

/**
 * `burst` is a second, shorter ceiling checked alongside the main one —
 * both must have room for a call to proceed. It exists because a plan can
 * meter two different things at once: TCGGO's free tier allows 100 calls a
 * day AND no more than 30 a minute, and only the second one is at risk
 * during a build, where every tracked card resolves concurrently rather
 * than spread across the day.
 */
type Budget = Window & { burst?: Window };

/**
 * Keyed by the same `rateLimitKey` bucket the circuit breaker uses (see
 * resilientFetch in upstream.ts), NOT by hostname — PokéWallet and
 * BerryWallet are two separate credentials with two separate quotas against
 * the one literal host api.pokewallet.io, and counting them together would
 * let One Piece traffic spend the Pokémon allowance, which is the exact
 * thing splitting the keys was meant to stop.
 *
 * A bucket with no entry here is unbudgeted and passes straight through —
 * TCGdex (free, no key, no published rate limit) and the Lobstr scrape
 * trigger (already behind a password-protected manual endpoint that refuses
 * to run early, see lib/lobstr.ts) are both deliberately absent.
 */
const BUDGETS: Record<string, Budget> = {
  // Both 100/hour real, but their per-card costs are nothing alike, so the
  // ceilings are set from measurement rather than symmetry.
  //
  // PokéWallet resolves a card from a stored, already-confirmed id
  // (card-refs.ts's pokeWalletCardId), so it is exactly ONE call per
  // Pokémon card — measured: 3 calls for 3 cards. 60 is enormous headroom.
  "api.pokewallet.io#pokewallet": { limit: 60, windowMs: HOUR_MS },
  // BerryWallet has no stored id and resolves a card by finding its set
  // (findCardInLanguage). Cost is NOT an average — it is bimodal, which is
  // why an averaged figure misleads here. A card whose set is known or
  // correctly guessed from its number prefix costs ONE getSetCards call
  // (the getSets call is shared across the whole build). A card whose set
  // is neither costs one call per set walked.
  //
  // Confirmed live on 2026-08-29: four ordinary cards resolved in ~2 calls
  // apiece, then one promo card — P-033, real set OP-PR, guessed set "P" —
  // consumed the entire remainder of a 60-call ceiling by itself and took
  // unrelated later cards down with it.
  //
  // Both halves of that are now fixed at the source rather than budgeted
  // around: confirmed set codes live on the refs (card-refs.ts's
  // berryWalletSetCode) and the fallback walk is bounded (berrywallet.ts's
  // MAX_FALLBACK_SETS), so the worst case for one card is a handful of
  // calls instead of 77. 90 is simply the honest ceiling under a 100/hour
  // cap; with those two fixes in place a full 9-card catalogue resolves
  // well inside it.
  "api.pokewallet.io#berrywallet": { limit: 90, windowMs: HOUR_MS },
  // 1,000/month real. Both windows are load-bearing and neither works alone.
  //
  // A flat 30/day was measured starving price history on 2026-08-30: card
  // resolution runs first and history second (cards.ts's getHistoryPrices),
  // so a cold build spent the whole day window on resolution and every
  // history call then failed. It failed *silently* — that call sits behind a
  // `.catch(() => [])` — so for weeks this looked like an apitcg outage
  // rather than our own ceiling. A cold 8-card build costs ~24 calls to
  // resolve plus 8 for history; 30 cannot fit both, which is the entire bug.
  //
  // 90/day is what makes a cold build fit, with room for two or three in a
  // day. But a daily ceiling alone cannot protect the month: one cold build
  // a day is ~960/month at 8 cards and ~1,080 at 9 — over the real cap
  // without ever touching the daily limit. So the month is the outer guard
  // and the day is the burst limiter.
  //
  // 900 rather than 1,000 for the same reason every budget here sits under
  // its real cap: workers race on these files and a lost write means a call
  // goes uncounted (see this file's header). The 100 is that slack.
  //
  // The starvation this file previously warned about — a bad week eating the
  // month, then starving the rest of it — is real and NOT solved here, only
  // bounded. It is strictly better than the alternative: without a monthly
  // guard the same spend hits apitcg's own 1,000 and returns hard 429s, which
  // degrades identically but uncontrolled, and across every surface at once.
  // Burst raised 90 -> 200 on 2026-09-05: the account has real headroom
  // against apitcg's own monthly ceiling, and 90/day was stopping cold
  // rebuilds rather than protecting anything. The monthly 900 is still the
  // limit that matters; this one only shapes how fast it may be spent.
  "api.apitcg.com": { limit: 900, windowMs: MONTH_MS, burst: { limit: 200, windowMs: DAY_MS } },
  // 5,000/day real. Comfortably the loosest of the four, but still bounded:
  // graded-market.ts spends 6-8 of these per card per resolution, so this
  // is the one budget that scales hardest with the tracked-card count.
  "api.ebay.com": { limit: 1200, windowMs: DAY_MS },
  // TCGGO (RapidAPI "CardMarket API TCG"), Basic/free: 100 a day AND 30 a
  // minute. The tightest quota in the system, and the burst half is the one
  // that actually bites — tcggo-integration-plan.md budgets 3-4 calls per
  // card, which at the 6 cards it was written for meant ~24 in a cold
  // build, comfortably under 30. At 9 cards that is 27-36 fired
  // concurrently, straight through the per-minute ceiling. The daily figure
  // never notices; without `burst` here, neither would this.
  "cardmarket-api-tcg.p.rapidapi.com": { limit: 80, windowMs: DAY_MS, burst: { limit: 24, windowMs: 60_000 } },
};

type Counter = { windowStart: number; count: number };

/** One file per bucket holds both ceilings' counters — see chargeApiBudget. */
type Counters = { main: Counter; burst?: Counter };

/**
 * Same signal, and the same two reasons for it, as build-cache.ts's own
 * `buildPhaseActive` — see that function's comment: `next build` sets
 * NEXT_PHASE on its own process but a static-generation worker
 * (`worker_threads`, snapshotting `process.env` at spawn) can miss it, so an
 * existing `.next/cache` is accepted as the same evidence.
 *
 * Deliberately build-time only. At runtime on Vercel the filesystem is
 * read-only so there is nowhere to keep a counter, and the shape of the
 * risk is different anyway: a build fans one card out across many routes
 * and workers at once, where a live request renders exactly one route.
 */
function buildPhaseActive(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build" || existsSync(path.join(process.cwd(), ".next", "cache"));
}

function counterFile(bucket: string): string {
  return path.join(BUDGET_DIR, `${encodeURIComponent(bucket)}.json`);
}

function freshCounter(): Counter {
  return { windowStart: Date.now(), count: 0 };
}

/**
 * A window that has rolled over starts clean rather than decaying — the
 * upstream quotas these mirror are themselves fixed windows, not leaky
 * buckets.
 */
function liveOrFresh(counter: unknown, windowMs: number): Counter {
  if (counter === null || typeof counter !== "object") return freshCounter();
  const c = counter as Counter;
  if (typeof c.windowStart !== "number" || typeof c.count !== "number") return freshCounter();
  if (Date.now() - c.windowStart >= windowMs) return freshCounter();
  return c;
}

/**
 * Both of a bucket's counters, from the one file that holds them.
 *
 * Reads a bare `Counter` as well as the `{ main, burst }` pair, because
 * files written before `burst` existed are the older shape — discarding a
 * live window's worth of real spend on the deploy that introduces this
 * would hand back exactly the headroom the budget is meant to withhold.
 */
function readCounters(file: string, budget: Budget): Counters {
  let raw: unknown;
  try {
    raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
  } catch {
    // Corrupt, or caught mid-write by another worker. Starting a fresh
    // window is the permissive choice, and the right one: a cache read
    // failing must never be the reason a page can't build.
    raw = undefined;
  }

  const stored = raw as (Partial<Counters> & Partial<Counter>) | undefined;
  const mainRaw = stored?.main ?? (typeof stored?.count === "number" ? (stored as Counter) : undefined);

  return {
    main: liveOrFresh(mainRaw, budget.windowMs),
    ...(budget.burst ? { burst: liveOrFresh(stored?.burst, budget.burst.windowMs) } : {}),
  };
}

/**
 * Thrown instead of making a call that would spend past this build's budget
 * for that credential. Deliberately shaped like upstream.ts's
 * UpstreamUnavailableError — every caller in this codebase already handles
 * "this upstream produced nothing" by falling back (an offline placeholder
 * card, an inert locale toggle, an illustrative market panel), so a budget
 * stop lands on paths that are already written and already tested rather
 * than needing a new one.
 */
export class ApiBudgetExceededError extends Error {
  constructor(readonly bucket: string, message: string) {
    super(message);
    this.name = "ApiBudgetExceededError";
  }
}

/** Set once a bucket has reported, so the "budget exhausted" line appears once per build per credential instead of once per refused call. */
const reported = new Set<string>();

/**
 * Records one call against `bucket` and throws if that would exceed the
 * budget. A no-op outside `next build`, and a no-op for any bucket with no
 * entry in BUDGETS.
 *
 * Counted at the point of *attempting* a call, not on success: a 500 or a
 * timeout still consumed a request against most metered APIs, and assuming
 * otherwise is how a budget quietly overspends exactly when an upstream is
 * unhealthy and being retried.
 */
export function chargeApiBudget(bucket: string): void {
  const budget = BUDGETS[bucket];
  if (!budget || !buildPhaseActive()) return;

  const file = counterFile(bucket);
  const counters = readCounters(file, budget);

  // Both ceilings must have room. Checked before either is incremented, so
  // a call refused by one never silently consumes the other.
  const checks: { counter: Counter; window: Window; label: string }[] = [
    { counter: counters.main, window: budget, label: "budget" },
    ...(budget.burst && counters.burst ? [{ counter: counters.burst, window: budget.burst, label: "burst limit" }] : []),
  ];

  for (const { counter, window, label } of checks) {
    if (counter.count < window.limit) continue;
    const resetsAt = new Date(counter.windowStart + window.windowMs).toISOString();
    const key = `${bucket}:${label}`;
    if (!reported.has(key)) {
      reported.add(key);
      console.warn(
        `[api-budget] ${bucket} has spent its ${label} (${window.limit} calls). ` +
          `Refusing further calls until ${resetsAt}. Pages still build — the affected surfaces fall back ` +
          `the same way they do for an unreachable upstream. See src/lib/api-budget.ts.`
      );
    }
    throw new ApiBudgetExceededError(
      bucket,
      `${bucket} ${label} of ${window.limit} calls is spent; window resets at ${resetsAt}`
    );
  }

  try {
    mkdirSync(BUDGET_DIR, { recursive: true });
    const next: Counters = {
      main: { windowStart: counters.main.windowStart, count: counters.main.count + 1 },
      ...(counters.burst ? { burst: { windowStart: counters.burst.windowStart, count: counters.burst.count + 1 } } : {}),
    };
    writeFileSync(file, JSON.stringify(next));
  } catch {
    // Best effort — see this function's own doc comment. An uncountable call
    // is allowed through rather than blocked.
  }
}

/**
 * What each budgeted credential has spent in its current window. Read-only;
 * used by scripts/api-budget-report.mjs so the spend is inspectable after a
 * build instead of only being visible as a warning when it runs out.
 */
export function apiBudgetStatus(): { bucket: string; used: number; limit: number; windowMs: number; resetsAt: string; burst?: { used: number; limit: number } }[] {
  return Object.entries(BUDGETS).map(([bucket, budget]) => {
    const counters = readCounters(counterFile(bucket), budget);
    return {
      bucket,
      used: counters.main.count,
      limit: budget.limit,
      windowMs: budget.windowMs,
      resetsAt: new Date(counters.main.windowStart + budget.windowMs).toISOString(),
      ...(budget.burst && counters.burst ? { burst: { used: counters.burst.count, limit: budget.burst.limit } } : {}),
    };
  });
}
