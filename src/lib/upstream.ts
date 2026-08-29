/**
 * Shared failure handling for the two third-party card APIs (apitcg.ts and
 * tcgdex.ts). Everything here exists because of one production incident,
 * reproduced locally: a deploy where *both* upstreams were unreachable from
 * the build container. Three separate things went wrong at once, and this
 * module addresses all three.
 *
 * 1. **Every attempt was a first attempt.** A single connection failure
 *    permanently degraded a card for the whole build — no retry — while a
 *    *sustained* outage was retried endlessly, once per route × card ×
 *    build worker, each one paying the full fetch timeout. `resilientFetch`
 *    inverts that: one cheap retry for a transient blip, then a per-host
 *    circuit breaker that stops calling a host that has clearly gone away.
 *
 * 2. **The logs were unreadable.** `console.error(msg, err)` on a Node
 *    `fetch` rejection prints the `TypeError: fetch failed` *plus* its
 *    `AggregateError` cause (one sub-error per address the host resolves
 *    to) as a multi-line object dump — the `[errors]: [ [Error], [Error] ]`
 *    blocks that filled the deploy log, repeated dozens of times with no
 *    hostname or reason in any of them. `describeUpstreamError` flattens
 *    that whole chain into one line, and `logUpstreamOnce` prints a given
 *    failure once per window instead of once per caller.
 *
 * 3. **Nothing downstream could tell an outage from a bug.** The postbuild
 *    static-route gate (scripts/check-static-routes.mjs) failed the build
 *    for routes that had legitimately nothing to build, because their only
 *    data source was down. `markBuildOutage` leaves a breadcrumb the gate
 *    reads, so "TCGdex was unreachable" and "this route is broken" stop
 *    looking identical.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chargeApiBudget } from "@/lib/api-budget";

/** Directory (relative to the project root) the build-time outage markers go in. See markBuildOutage. */
export const OUTAGE_DIR = path.join(".next", "upstream-outage");

/**
 * How many consecutive transient failures against one host before we stop
 * calling it. Deliberately larger than `RETRY_ATTEMPTS` so a single failed
 * *call* (which burns one failure per attempt) can't trip the breaker on
 * its own — it takes two.
 */
const BREAKER_THRESHOLD = 4;

/**
 * How long the breaker stays open. Long enough to cover the rest of a
 * `next build`'s static-generation pass (so a dead host is called a handful
 * of times, not hundreds), short enough that a warm serverless instance
 * starts trying again soon after the upstream recovers.
 */
const BREAKER_OPEN_MS = 60_000;

/**
 * How long the breaker stays open after a 429 specifically — deliberately
 * far longer than BREAKER_OPEN_MS above. A 429 means the *quota* is
 * exhausted, not that the host is struggling: nothing short of waiting out
 * the window fixes that, and retrying every BREAKER_OPEN_MS (60s) against an
 * already-exhausted quota does nothing but keep adding failed calls on top
 * of it — confirmed live against PokeWallet/BerryWallet's shared hourly cap
 * (pokewallet.ts/berrywallet.ts's POKEWALLET_API_KEY), where a build that
 * kept retrying past the first 429 pushed the account further over its
 * 100/hour limit instead of backing off. An hour comfortably outlasts any
 * hourly quota window without this needing to know a given host's actual
 * reset time.
 */
const RATE_LIMIT_BREAKER_OPEN_MS = 60 * 60_000;

/** Total attempts per call, so: one retry. See RETRY_BACKOFF_MS. */
const RETRY_ATTEMPTS = 2;

/**
 * Backoff before the retry. Short on purpose — this is here to ride out a
 * dropped connection or a single 502, not to wait out an outage (that's the
 * breaker's job), and every millisecond spent here is multiplied by every
 * card the build still has to resolve.
 */
const RETRY_BACKOFF_MS = 400;

/** Failures logged in this process, with the time their dedupe window ends. */
const loggedAt = new Map<string, number>();

/** How long the same failure key stays deduped. Long enough to collapse a whole build's worth of repeats, short enough that a long-lived serverless instance still reports a *new* outage later on. */
const LOG_DEDUPE_MS = 10 * 60_000;

type Breaker = { failures: number; openUntil: number; rateLimited: boolean };

const breakers = new Map<string, Breaker>();

/** Thrown instead of making a call the circuit breaker has decided is pointless. Callers treat it like any other upstream failure — it's the same outage, just diagnosed earlier. */
export class UpstreamUnavailableError extends Error {
  constructor(
    readonly host: string,
    message: string
  ) {
    super(message);
    this.name = "UpstreamUnavailableError";
  }
}

/**
 * Flattens an error and its whole `cause` / `AggregateError.errors` chain
 * into a single line. A Node fetch failure against an unreachable host
 * nests the real reason two levels down and once per resolved address
 * (IPv4 + IPv6), which is why the raw dumps in the deploy log said
 * `[errors]: [ [Error], [Error] ]` and nothing else useful. Identical
 * sub-errors are collapsed, since "both addresses refused" reads the same
 * as "one address refused" for every decision we make about it.
 */
export function describeUpstreamError(err: unknown, depth = 0): string {
  if (!(err instanceof Error)) return String(err);

  const head = err.name && err.name !== "Error" ? `${err.name}: ${err.message}` : err.message;
  if (depth >= 3) return head;

  const nested = err as Error & { errors?: unknown[]; cause?: unknown };
  const children = Array.isArray(nested.errors)
    ? nested.errors
    : nested.cause !== undefined && nested.cause !== null
      ? [nested.cause]
      : [];
  if (children.length === 0) return head;

  const described = [...new Set(children.map((child) => describeUpstreamError(child, depth + 1)))];
  return `${head} (${described.join("; ")})`;
}

/**
 * `console.error` that prints a given failure at most once per dedupe
 * window. The callers are page/route render paths that all resolve the same
 * handful of cards, so without this a single outage prints the same line
 * once per route × card — the "repeated error logs" this whole module is
 * named for. Keyed by the caller, not by the message, so a *different*
 * failure for the same card still gets through.
 */
export function logUpstreamOnce(key: string, message: string): void {
  const now = Date.now();
  const until = loggedAt.get(key);
  if (until !== undefined && until > now) return;
  loggedAt.set(key, now + LOG_DEDUPE_MS);
  console.error(message);
}

/**
 * Records, during `next build` only, that a host failed in a way that means
 * "unreachable" rather than "no such card" — a breadcrumb for the postbuild
 * gate, which otherwise cannot distinguish a route that built nothing
 * because its upstream was down from one that built nothing because it's
 * broken (see scripts/check-static-routes.mjs).
 *
 * One file per host, overwritten rather than merged: build workers are
 * separate processes and would otherwise race on a single shared file. Best
 * effort throughout — a read-only or missing `.next` must never be the
 * reason a page fails to render, and at runtime (serverless, read-only
 * filesystem) this is skipped entirely.
 */
function markBuildOutage(host: string, reason: string): void {
  // `next build` sets NEXT_PHASE, but not every static-generation worker
  // inherits it, so an existing `.next/` in the working directory is
  // accepted as the same signal. At runtime on a serverless platform
  // neither holds (and the filesystem is read-only anyway), so this is a
  // no-op there twice over.
  const dir = path.join(process.cwd(), OUTAGE_DIR);
  if (process.env.NEXT_PHASE !== "phase-production-build" && !existsSync(path.join(process.cwd(), ".next"))) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${host}.json`),
      JSON.stringify({ host, reason, at: new Date().toISOString() }, null, 2)
    );
  } catch {
    // Nothing to do and nothing worth logging — the marker is an
    // optimization for the gate's error message, not a correctness input.
  }
}

/**
 * `host` and `bucket` are deliberately separate parameters, not always the
 * same value — see resilientFetch's own `rateLimitKey` doc comment for why:
 * two credentials against the same literal host (PokéWallet and BerryWallet
 * both call api.pokewallet.io) need independent breakers, but the build
 * outage marker below is keyed by the real hostname regardless, since
 * scripts/check-static-routes.mjs looks it up by that literal string.
 */
function noteFailure(host: string, bucket: string, reason: string, rateLimited = false): void {
  // Marked on the *first* failure, not when the breaker finally opens: the
  // marker answers "was this host reachable during the build at all", and a
  // build resolving a handful of cards concurrently can finish having made
  // fewer calls than the breaker threshold. A host that failed once and then
  // recovered is marked too — harmless, because the gate only consults the
  // marker for a route that prerendered nothing, and a recovered host means
  // that route has pages.
  markBuildOutage(host, reason);
  const breaker = breakers.get(bucket) ?? { failures: 0, openUntil: 0, rateLimited: false };
  breaker.failures += 1;
  if (rateLimited) {
    // Trips on the *first* 429, unlike the BREAKER_THRESHOLD path below —
    // see RATE_LIMIT_BREAKER_OPEN_MS's own comment for why a rate limit
    // gets no benefit-of-the-doubt retries the way a connectivity blip does.
    breaker.openUntil = Date.now() + RATE_LIMIT_BREAKER_OPEN_MS;
    breaker.rateLimited = true;
  } else if (breaker.failures >= BREAKER_THRESHOLD) {
    breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
  }
  breakers.set(bucket, breaker);
}

function noteSuccess(bucket: string): void {
  breakers.delete(bucket);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True for the failure classes worth trying again: the server itself
 * describes the condition as temporary.
 */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * True for a status that means "you can't use this host right now" without
 * being worth a retry — an edge/WAF block or a rejected key answers the
 * same way every time. Neither of these APIs uses 401/403 to mean "no such
 * card" (TCGdex needs no key at all), so this is never a per-card result:
 * it counts toward the circuit breaker exactly like a dead connection does,
 * while the response is still handed back for the caller to report.
 */
function isBlockedStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * `fetch` with a bounded timeout, one retry on a transient failure, and a
 * circuit breaker. Returns the `Response` for any status the caller should
 * interpret itself (including 404); throws for a transient failure that
 * survived the retry, and for every call made while the breaker is open.
 *
 * `init` is passed through untouched apart from `signal`, so callers keep
 * their own headers and their own Next.js `next: { revalidate }` caching.
 *
 * `rateLimitKey` overrides what the circuit breaker is keyed by — defaults
 * to the URL's own host, which is right for almost every caller (one
 * credential per host). It exists for the one exception: PokéWallet and
 * BerryWallet are two separate credentials (POKEWALLET_API_KEY,
 * BERRYWALLET_API_KEY) against the literal same host, api.pokewallet.io —
 * without this, a 429 on one credential's traffic would trip the breaker for
 * *both*, even though each credential has its own independent quota. Passing
 * a distinct string per credential (see pokewallet.ts/berrywallet.ts's own
 * calls) keeps their breakers, and therefore their backoff, fully separate.
 * The build-outage marker (markBuildOutage) is unaffected by this — it's
 * always keyed by the real host, since scripts/check-static-routes.mjs looks
 * that up by literal hostname regardless of which credential made the call.
 *
 * The same bucket is also what lib/api-budget.ts meters against, and this
 * function is where that happens — every metered client in this codebase
 * (apitcg, PokéWallet, BerryWallet, eBay Browse, Lobstr) already routes
 * through here, so there is exactly one place a call can be counted and
 * exactly one place it can be refused. That charge happens per *attempt*,
 * inside the retry loop below, not once per call: a retry is a second real
 * request against the quota, and counting it as free is precisely how a
 * budget overspends while an upstream is unhealthy.
 */
export async function resilientFetch(url: string, init: RequestInit, timeoutMs: number, rateLimitKey?: string): Promise<Response> {
  const host = new URL(url).host;
  const bucket = rateLimitKey ?? host;

  const breaker = breakers.get(bucket);
  if (breaker && breaker.openUntil > Date.now()) {
    throw new UpstreamUnavailableError(
      host,
      breaker.rateLimited
        ? `${host} is rate-limited; skipping calls until ${new Date(breaker.openUntil).toISOString()} rather than adding to the shortfall`
        : `${host} is not answering (${breaker.failures} consecutive failures); skipping this call until ${new Date(breaker.openUntil).toISOString()}`
    );
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    let status: number | undefined;
    // Outside the try: an exhausted budget must propagate to the caller
    // like an open breaker does (same class of "we decided not to make this
    // call"), not be swallowed into `lastError` and then retried — retrying
    // a refusal we issued ourselves can only refuse again.
    chargeApiBudget(bucket);
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      status = res.status;
      if (isBlockedStatus(res.status)) {
        noteFailure(host, bucket, `${host} responded ${res.status}`);
        return res;
      }
      if (!isTransientStatus(res.status)) {
        // Any definitive per-request answer — 2xx, 404, 400 — means the host
        // is alive and talking to us, so the breaker's failure count starts
        // over even on a status the caller will end up throwing on.
        noteSuccess(bucket);
        return res;
      }
      lastError = new Error(`${host} responded ${res.status}`);
    } catch (err) {
      lastError = err;
    }

    noteFailure(host, bucket, describeUpstreamError(lastError), status === 429);
    // A 429 skips the retry entirely — see RATE_LIMIT_BREAKER_OPEN_MS's
    // comment. Retrying moments later against a quota that's already
    // exhausted is essentially guaranteed to fail again and only spends
    // more of it for nothing.
    if (status === 429) break;
    if (attempt < RETRY_ATTEMPTS) await delay(RETRY_BACKOFF_MS);
  }

  throw lastError;
}
