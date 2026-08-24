/**
 * Short-TTL, in-memory promise memoization keyed by an arbitrary string —
 * used by apitcg.ts and tcgdex.ts to collapse redundant identical requests
 * (including *failed* ones) into a single real network attempt.
 *
 * Why this exists: Next's own fetch data-cache only persists *successful*
 * responses (see REVALIDATE_SECONDS in both callers) — a failure is never
 * cached, so every route that needs the same card independently re-attempts
 * and re-fails against a down upstream. Confirmed live: a Vercel build with
 * ~9 static routes needing the same 3 cards turned one TCGdex outage into
 * dozens of independent timeout waits (route × card), enough dead time to
 * blow the build's time budget even after each individual attempt was
 * already bounded to a short timeout. Memoizing here — for both outcomes —
 * means only the *first* route to touch a given card pays that cost; every
 * other route within the window reuses the same settled promise.
 *
 * TTL (not indefinite) is the deliberate choice: `next build`'s static
 * generation for a handful of routes finishes well inside it, so a whole
 * build's worth of redundant lookups collapses into one — but in production,
 * a warm serverless instance that lives for minutes/hours won't keep
 * replaying a transient outage forever once the upstream recovers.
 */

const store = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();

export function memoizeFetch<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.promise as Promise<T>;
  }
  const promise = fn();
  store.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
}
