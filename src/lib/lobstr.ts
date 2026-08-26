/**
 * Lobstr.io API client — the transport layer for the real Vinted data
 * behind the France tab of the Pokémon Market Overview
 * (components/retro/graded-market-panel.tsx). Vinted has no public API of
 * its own (that's what lib/illustrative.ts's Vinted feed comment was
 * waiting on); Lobstr's hosted Vinted Products Scraper is the source we
 * actually go through.
 *
 * The one structural thing to understand before reading further: this API
 * is ASYNCHRONOUS. You do not ask it for prices and get prices back. You
 * create a squid (a configured scraper instance), feed it tasks (URLs to
 * scrape), start a run, and then — minutes later — read that run's
 * results. A page render can never drive that whole cycle: it would block
 * for as long as the scrape takes and burn a scrape credit per page view.
 *
 * So the flow is split in two, and only the second half is on the render
 * path:
 *
 *   COLLECT  (app/api/vinted/refresh/route.ts, cron every 14 days,
 *             secret-gated, refuses to run early)
 *             addTasks() -> startRun() -> [Lobstr scrapes] -> getRunStats()
 *   READ      (lib/vinted-listings.ts, during page render, cached 14 days)
 *             listRuns() -> getResults() -> filter -> render
 *
 * Squids are NOT created per request. Per Lobstr's own guidance you create
 * one and reuse it; ours is created once by scripts/lobstr-setup.mjs and
 * its hash lives in LOBSTR_VINTED_SQUID. See docs/lobstr-vinted.md.
 *
 * Endpoint shapes below come from Lobstr's documented walkthrough
 * (/v1/me, /v1/crawlers, /v1/squids, /v1/tasks, /v1/runs,
 * /v1/runs/<hash>/stats, /v1/results?run=<hash>). Listing a squid's runs
 * is not documented at all; a live account established that GET /v1/runs
 * requires ?squid=<hash> (omitting it returns 400 ParamsNeeded). Response
 * ENVELOPES remain undocumented, so unwrapCollection locates the records
 * array by shape rather than by key name — guessing the key is what made a
 * successful collection look like an empty account for a full day.
 *
 * Two documented limits shape the design here. Rate: /v1/squids 120
 * calls/min, /v1/tasks 90/min, /v1/results 2/sec (Lobstr returns
 * X-RateLimit-Remaining and Retry-After — surfaced in the error text
 * below). Coverage: the Vinted scraper reads search and catalog pages only,
 * never the individual product page, so every field this integration can
 * ever show is one that appears on a search-results card.
 */

const API_BASE = "https://api.lobstr.io/v1";

/**
 * Lobstr's Vinted Products Scraper crawler hash — a fixed, published
 * identifier for that specific scraper, not an account-specific value.
 * Every crawler Lobstr offers has one; the full list is at GET /v1/crawlers
 * (see scripts/lobstr-setup.mjs, which prints it).
 */
export const VINTED_PRODUCTS_CRAWLER = "ffd34f9b42a79b7323a048f09fc158e6";

/**
 * How often the data is actually re-collected. Scraping is what costs money
 * (Lobstr bills per scraped result); reading results back does not. So the
 * cost of this integration is set almost entirely by this number, and it is
 * enforced in two places rather than just documented: the cron schedule in
 * vercel.json, and a hard minimum-interval check in the refresh route that
 * refuses to start a run this soon after the last one.
 *
 * Card prices on a peer-to-peer resale market move slowly enough that a
 * fortnightly snapshot is honest. If that ever needs to be weekly, this is
 * the single constant to change.
 *
 * Deliberately NOT the source of any cache TTL any more. It used to feed
 * RESULTS_REVALIDATE_SECONDS, which coupled two unrelated things: how often
 * we SPEND credits (this — a real budget decision) and how long a free read
 * is allowed to go unrefreshed (not a budget decision at all). The practical
 * cost of that coupling was that one bad read got pinned in front of the
 * feed for a fortnight.
 */
export const COLLECTION_INTERVAL_DAYS = 14;

/**
 * Rows kept per card, and the unit the whole budget is denominated in.
 *
 * Lobstr's free tier is 100 results a month. Three tracked Pokémon cards x
 * 10 results x two collections a month = 60, comfortably inside it with
 * room for a forced re-collection. Raising this, or adding cards, moves
 * that total directly — 4 cards at 10 would be 80, 5 would be 100 and the
 * tier is gone.
 *
 * A live test briefly ran this at 20, then 14, against remaining test
 * credits — reverted back to 10 as the steady-state value once that test
 * was done. The one real lesson from it, worth keeping in mind whenever
 * this changes again: the two squid settings below are easy to transpose
 * by hand on the dashboard, and a swapped pair fails silently rather than
 * erroring — the first task alone can consume the whole run's budget
 * before the other cards' tasks ever start. Always double check
 * max_unique_results_per_run (cards x this) isn't set *lower* than
 * max_results_per_task (this) before triggering a collection.
 *
 * Two squid settings have to agree with this for it to mean anything on
 * Lobstr's side, and `scripts/lobstr-setup.mjs --settings` computes and
 * applies both: `max_results_per_task` = this (so each card gets its own
 * even share rather than the first task swallowing the run's allowance),
 * and `max_unique_results_per_run` = cards x this (the spend ceiling).
 * This constant alone only trims what's *displayed* — it cannot stop a
 * scrape that has already been paid for.
 */
export const VINTED_RESULTS_PER_CARD = 10;

/**
 * How long a page of results may be served from Next's Data Cache.
 *
 * This was the collection interval (14 days), justified by "the cache key
 * includes the RUN HASH, and a finished run's results are immutable". That
 * justification stopped being true when the read path moved to the
 * squid-scoped route: the URL that actually gets cached in production is
 * `/results?squid=<hash>&page=N&limit=M`, which carries no run hash and
 * whose contents change the moment another collection lands. A fortnight
 * was therefore long enough to hide a whole new collection.
 *
 * Six hours, matching RUNS_REVALIDATE_SECONDS and the refresh route's
 * LISTING_DISCOVERY_HOURS promise, so a finished run reaches product pages
 * within the window the API already tells callers to expect. Reading
 * results costs no credits — only scraping does — so the only thing a
 * shorter TTL spends is a handful of free API reads a day.
 *
 * Pairs with readResultPages' all-or-nothing rule: a partial read now
 * throws instead of returning, and Next does not cache a thrown fetch, so
 * nothing that reaches this cache is ever a short read.
 */
const RESULTS_REVALIDATE_SECONDS = 6 * 60 * 60;

/**
 * The run *listing* is the one thing that has to stay fresher than the
 * collection interval, because it's how a newly finished run is discovered
 * at all. Six hours means a fresh collection reaches product pages within
 * that window, at a cost of four API reads a day — negligible, and nowhere
 * near any documented rate limit.
 */
const RUNS_REVALIDATE_SECONDS = 6 * 60 * 60;

/**
 * One cache tag on every cached Lobstr read, so a single revalidateTag call
 * drops the run list AND every page of results together.
 *
 * The TTLs above answer "how stale may this get on its own"; this answers
 * "the data just changed, catch up now". Re-running the squid from Lobstr's
 * dashboard is invisible to this app — no webhook, no polling — so without
 * an explicit nudge a fresh collection waits out RUNS_REVALIDATE_SECONDS
 * before it is even discovered. See app/api/vinted/publish/route.ts.
 */
export const VINTED_CACHE_TAG = "vinted-lobstr";

export function hasLobstrCredentials(): boolean {
  return Boolean(process.env.LOBSTR_API_KEY);
}

function lobstrApiKey(): string {
  const key = process.env.LOBSTR_API_KEY;
  if (!key) {
    throw new Error(
      "LOBSTR_API_KEY not set. Add it in Vercel (Project Settings > Environment Variables) and locally in .env.local for dev."
    );
  }
  return key;
}

/**
 * The reused squid's hash, produced once by scripts/lobstr-setup.mjs.
 * Optional on purpose: with no squid configured the read path returns
 * nothing and the France tab stays on its clearly-marked preview, rather
 * than the site failing to build.
 */
export function vintedSquidHash(): string | undefined {
  return process.env.LOBSTR_VINTED_SQUID || undefined;
}

/**
 * Escape hatch that pins the read path to one specific run hash instead of
 * resolving the squid's latest run. Two uses: reading results back before
 * the refresh route is scheduled anywhere, and staying on a known-good run
 * if listRuns' UNVERIFIED query shape turns out to be wrong.
 */
export function pinnedVintedRunHash(): string | undefined {
  return process.env.LOBSTR_VINTED_RUN || undefined;
}

type LobstrRequestOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /**
   * Seconds for Next's Data Cache. Deliberately never `cache: "no-store"`
   * on GETs: no-store maps to revalidate: 0, which taints the entire
   * calling route as dynamic and breaks /products/[slug]'s static
   * generation — the exact failure lib/ebay-browse.ts documents hitting in
   * production. Mutating calls pass `revalidate: 0` explicitly instead, and
   * only ever run inside a route handler that's already dynamic.
   */
  revalidate?: number;
  /** Internal: 429 retry budget. One retry is enough to ride out a concurrent-render collision; more would just make a slow page slower. */
  retriesLeft?: number;
};

/**
 * In-flight GET de-duplication, keyed by the full request URL.
 *
 * Next's Data Cache does not help here: the three product pages regenerate
 * in separate invocations, so nothing is shared between them, and they hit
 * /v1/results — documented at 2 requests per SECOND — at the same instant.
 * The third request is then rate-limited, its fetch throws, the read path
 * catches it and silently renders the clearly-marked preview instead. One
 * card shows live data and the other two don't, for no reason visible on
 * the page. That is exactly the "worked on one card, then stopped" symptom.
 *
 * Same mechanism and the same reasoning as lib/ebay-browse.ts's
 * inFlightTokenRequest, which exists because a single panel render fired
 * four concurrent token requests.
 */
const inFlightGets = new Map<string, Promise<unknown>>();

/**
 * De-duplicating entry point. Concurrent GETs for the same URL share one
 * request; everything else goes straight through. The map entry is cleared
 * in a finally block, so this is a coalescing window rather than a cache —
 * caching stays Next's job, with the TTLs above.
 */
async function lobstrFetch<T>(path: string, options: LobstrRequestOptions = {}): Promise<T> {
  if ((options.method ?? "GET") !== "GET") return lobstrRequest<T>(path, options);

  const key = requestUrl(path, options.query);
  const existing = inFlightGets.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = lobstrRequest<T>(path, options).finally(() => inFlightGets.delete(key));
  inFlightGets.set(key, request);
  return request;
}

function requestUrl(path: string, query: LobstrRequestOptions["query"]): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) qs.set(key, String(value));
  }
  return `${API_BASE}${path}${qs.size > 0 ? `?${qs}` : ""}`;
}

async function lobstrRequest<T>(path: string, options: LobstrRequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, revalidate = 0, retriesLeft = 1 } = options;

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const url = `${API_BASE}${path}${qs.size > 0 ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    method,
    headers: {
      // Lobstr's own scheme keyword — "Token <key>", not "Bearer".
      Authorization: `Token ${lobstrApiKey()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    // Cache mode stated explicitly in both directions rather than inferred
    // from `revalidate` alone. Next 16 does not cache fetch by default, and
    // its own reference says force-cache is what opts a request in
    // "including ... requests that send `authorization` or `cookie`
    // headers" — which is every call in this file. Relying on a revalidate
    // number by itself risked none of these reads being cached at all, and
    // an uncached read path re-walks the whole paginated /results ladder on
    // every single regeneration, straight into the documented 2 req/s cap.
    // (force-cache alongside revalidate is a normal pairing; it is
    // `no-store` + revalidate that the docs call conflicting and ignore,
    // which is why the two cases are kept apart here.)
    ...(revalidate > 0
      ? { cache: "force-cache" as const, next: { revalidate, tags: [VINTED_CACHE_TAG] } }
      : { cache: "no-store" as const }),
  });

  if (res.status === 429 && retriesLeft > 0) {
    // Respect Lobstr's own backoff instruction rather than inventing one.
    // Capped: a render must never sit waiting on a scraper vendor, and the
    // honest fallback (a clearly-marked preview) is one caught error away.
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000, 2000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return lobstrRequest<T>(path, { ...options, retriesLeft: retriesLeft - 1 });
  }

  if (!res.ok) {
    // Rate-limit responses carry Retry-After / X-RateLimit-Remaining;
    // including them means a 429 reads as "back off for N seconds" in the
    // logs rather than as a generic failure indistinguishable from a bad
    // key. /v1/results' 2 req/s is the tightest of the documented caps and
    // the one the read path is most likely to brush against.
    const retryAfter = res.headers.get("retry-after");
    const remaining = res.headers.get("x-ratelimit-remaining");
    const limitInfo = retryAfter || remaining ? ` [retry-after=${retryAfter ?? "?"}, remaining=${remaining ?? "?"}]` : "";
    throw new Error(`lobstr ${method} ${path} failed (${res.status})${limitInfo}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/**
 * Finds the array of records in a Lobstr response, whatever it's wrapped
 * in. A plain array, `{data: [...]}`, `{results: [...]}` and
 * `{count, next, <something>: [...]}` are all shapes Lobstr uses across its
 * surface, and guessing the key is exactly how `GET /v1/runs?squid=` came
 * back 200-OK-but-empty for a squid that had a finished run: the request
 * was right, the unwrapping was wrong, and the two are indistinguishable
 * from the outside.
 *
 * So known keys are tried first for predictability, and then — rather than
 * give up — any property holding an array of objects is used. That makes
 * the function correct for envelope names nobody has seen yet, which is the
 * whole problem with an API whose response shapes aren't documented.
 */
function unwrapCollection<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  for (const key of ["data", "results", "items", "records", "runs"]) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  // Last resort: the first array of objects at the top level, whatever it's
  // called. Arrays of primitives are skipped — those are far more likely to
  // be a list of ids or errors than the records themselves.
  for (const value of Object.values(record)) {
    if (Array.isArray(value) && value.some((entry) => entry && typeof entry === "object")) {
      return value as T[];
    }
  }
  return [];
}

/**
 * Top-level shape of a response, for diagnostics — with scalar VALUES, not
 * just their types. That distinction is the whole point: a shape line
 * reading `total_results: number, data: array(0)` cannot tell you whether
 * Lobstr believes the squid has no runs at all or whether pagination
 * dropped them, whereas `total_results: 0` settles it in one glance.
 * Arrays are still summarised by length so a 30-row payload doesn't get
 * dumped into an HTTP response.
 */
function describePayload(payload: unknown): string {
  if (Array.isArray(payload)) return `array(${payload.length})`;
  if (!payload || typeof payload !== "object") return typeof payload;
  return Object.entries(payload as Record<string, unknown>)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: array(${value.length})`;
      if (value === null) return `${key}: null`;
      if (typeof value === "object") return `${key}: object`;
      return `${key}: ${JSON.stringify(value)}`;
    })
    .join(", ");
}

/** Lobstr hands back object ids as `id` (its own docs' wording: "The response gives you an id"); `hash` is accepted too since parts of its surface use that name. */
function readId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  // NOT "squid": a run object names the squid it belongs to, and treating
  // that as the run's own id would send every results lookup to the wrong
  // hash — a failure that looks like "no results" rather than an error.
  for (const key of ["id", "hash", "run_hash", "run"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

export type LobstrAccount = { email?: string; [key: string]: unknown };

/** GET /v1/me — the documented "is my key valid" check. Used by scripts/lobstr-setup.mjs before it creates anything. */
export async function getAccount(): Promise<LobstrAccount> {
  return lobstrFetch<LobstrAccount>("/me");
}

export type LobstrSquid = { id: string; [key: string]: unknown };

/** POST /v1/squids — body is just the crawler hash. Call this once, keep the id (see docs/lobstr-vinted.md), don't call it per request. */
export async function createSquid(crawler: string = VINTED_PRODUCTS_CRAWLER): Promise<LobstrSquid> {
  const payload = await lobstrFetch<Record<string, unknown>>("/squids", { method: "POST", body: { crawler } });
  const id = readId(payload);
  if (!id) throw new Error(`lobstr POST /squids returned no squid id: ${JSON.stringify(payload)}`);
  return { ...payload, id };
}

/**
 * PUT /v1/squids/<hash> — crawler behaviour knobs. The three worth touching
 * for this use case (per Lobstr's walkthrough) are max_pages (capped at 32
 * by Lobstr), max_unique_results_per_run and concurrency; the authoritative
 * per-crawler list is GET /v1/crawlers/<hash>/params, which
 * scripts/lobstr-setup.mjs prints rather than this file hardcoding an
 * assumption about what's settable.
 */
export async function updateSquidSettings(squid: string, params: Record<string, unknown>): Promise<unknown> {
  return lobstrFetch(`/squids/${squid}`, { method: "PUT", body: params });
}

/** GET /v1/crawlers/<hash>/params — the settable parameters for one crawler. Introspection only; nothing on the render path calls this. */
export async function getCrawlerParams(crawler: string = VINTED_PRODUCTS_CRAWLER): Promise<unknown> {
  return lobstrFetch(`/crawlers/${crawler}/params`);
}

/**
 * POST /v1/tasks — a task is one URL to scrape. Batched in a single call
 * (the body takes an array) rather than one request per URL, so adding all
 * tracked cards costs one round trip. Lobstr also offers /v1/tasks/upload
 * for CSV/TXT/TSV lists; at six tracked cards that's not worth the
 * multipart handling.
 */
export async function addTasks(squid: string, urls: string[]): Promise<unknown> {
  return lobstrFetch("/tasks", {
    method: "POST",
    body: { squid, tasks: urls.map((url) => ({ url })) },
  });
}

export type LobstrRun = {
  id: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
};

/** POST /v1/runs — starts scraping everything currently queued on the squid. The returned id is what the read path (and getRunStats) needs. */
export async function startRun(squid: string): Promise<LobstrRun> {
  const payload = await lobstrFetch<Record<string, unknown>>("/runs", { method: "POST", body: { squid } });
  const id = readId(payload);
  if (!id) throw new Error(`lobstr POST /runs returned no run id: ${JSON.stringify(payload)}`);
  return { ...payload, id };
}

export type LobstrRunStats = Record<string, unknown>;

/**
 * GET /v1/runs/<hash>/stats — progress for one run. Lobstr's docs suggest a
 * webhook listener as the better pattern for reacting the moment a run
 * finishes; polling this is the simpler half of that choice and is all the
 * refresh route needs, since nothing here blocks on completion.
 */
export async function getRunStats(run: string): Promise<LobstrRunStats> {
  return lobstrFetch<LobstrRunStats>(`/runs/${run}/stats`);
}

export type RunListAttempt = { strategy: string; count: number; payloadShape?: string; error?: string };

/**
 * A squid's runs. Lobstr documents `POST /v1/runs` to start one but no GET
 * to list them, so this was guesswork until a live account settled it:
 * `?squid=<hash>` is not merely accepted, it's REQUIRED — omitting it, or
 * renaming it to `squid_hash`, returns 400 ParamsNeeded ("A required
 * parameter squid is missing from the route").
 *
 * The earlier failure was never the request. It returned 200 with a real
 * run present; the response envelope simply wasn't one of the key names
 * unwrapCollection knew, so the runs were dropped on the floor and the read
 * path concluded there was nothing to read. unwrapCollection now finds the
 * records array whatever it's called, and the attempt record below carries
 * the payload's actual shape so a future mismatch is visible immediately
 * instead of looking like an empty account.
 */
async function attemptRunList(squid: string): Promise<{ runs: LobstrRun[]; attempts: RunListAttempt[] }> {
  try {
    const payload = await lobstrFetch<unknown>("/runs", { query: { squid }, revalidate: RUNS_REVALIDATE_SECONDS });
    const runs = unwrapCollection<Record<string, unknown>>(payload)
      .map((run) => {
        const id = readId(run);
        return id ? ({ ...run, id } as LobstrRun) : undefined;
      })
      .filter((run): run is LobstrRun => run !== undefined);

    return {
      runs: sortRunsNewestFirst(runs),
      attempts: [{ strategy: "?squid=", count: runs.length, payloadShape: describePayload(payload) }],
    };
  } catch (err) {
    return { runs: [], attempts: [{ strategy: "?squid=", count: 0, error: (err as Error).message }] };
  }
}

/** Newest first when Lobstr gives us a date to sort on; otherwise trust the API's own ordering rather than inventing one. */
function sortRunsNewestFirst(runs: LobstrRun[]): LobstrRun[] {
  return [...runs].sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : NaN;
    const bTime = b.created_at ? Date.parse(b.created_at) : NaN;
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
    return bTime - aTime;
  });
}

/** The squid's runs, newest first. Empty means the request succeeded but nothing parsed out of it — check the attempt's payloadShape via ?debug=1; LOBSTR_VINTED_RUN bypasses the lookup entirely. */
export async function listRuns(squid: string): Promise<LobstrRun[]> {
  return (await attemptRunList(squid)).runs;
}

/** Same lookup, plus what each attempted query shape returned — for the ?debug=1 diagnosis. */
export async function listRunsWithAttempts(squid: string): Promise<{ runs: LobstrRun[]; attempts: RunListAttempt[] }> {
  return attemptRunList(squid);
}

export type ResultsAttempt = { strategy: string; rows: number; pagesRead?: number; payloadShape?: string; error?: string };
export type ResolvedResults = { rows: Record<string, unknown>[]; source: string | null; attempts: ResultsAttempt[] };

/**
 * Gets the latest scraped rows, by whatever route actually works.
 *
 * This exists because the render path had a single point of failure that
 * production proved is not reliable: it asked `GET /v1/runs?squid=` for the
 * newest run, then read that run's results. That lookup returns
 * `{total_results, data: []}` — a 200 with an empty list — for a squid whose
 * run demonstrably produced 30 results. One undocumented endpoint behaving
 * unexpectedly took the whole feature down, and did it *silently*: no run
 * found is indistinguishable from no data, and the panel honestly renders a
 * preview for both.
 *
 * So the run lookup is now the LAST resort rather than the only path:
 *
 *   1. LOBSTR_VINTED_RUN        pinned; one documented call, no lookup at
 *                               all. Deterministic — this is the route to
 *                               prefer in production.
 *   2. /v1/results?squid=       speculative but free to try, and if Lobstr
 *                               supports it the run lookup disappears
 *                               entirely. /v1/runs requires a squid param,
 *                               so the API is clearly squid-scoped.
 *   3. /v1/squids/<hash>/runs   the conventional REST sub-resource.
 *   4. /v1/runs?squid=          what we have; kept in case it starts
 *                               returning finished runs.
 *
 * Every attempt is recorded with the payload's real shape, so one look at
 * ?debug=1 says which routes exist and what each returned, instead of
 * another round of guessing against an API whose responses aren't
 * documented.
 */
export async function resolveVintedResults(squid: string | undefined, pinnedRun: string | undefined): Promise<ResolvedResults> {
  const attempts: ResultsAttempt[] = [];

  const readRun = async (run: string, strategy: string): Promise<ResolvedResults | undefined> => {
    try {
      const rows = await getResults(run);
      attempts.push({ strategy, rows: rows.length });
      if (rows.length > 0) return { rows, source: run, attempts };
    } catch (err) {
      attempts.push({ strategy, rows: 0, error: (err as Error).message });
    }
    return undefined;
  };

  if (pinnedRun) {
    const resolved = await readRun(pinnedRun, `LOBSTR_VINTED_RUN=${pinnedRun}`);
    if (resolved) return resolved;
  }

  if (!squid) return { rows: [], source: null, attempts };

  // 2 and 3 — find the squid's NEWEST run, then read that run's results.
  //
  // This used to sit below the squid-scoped read, which meant it never ran:
  // /results?squid= always answered, so the lookup was dead code. That was
  // fine while the squid had exactly one run and dangerous the moment it
  // had two, because a squid-scoped read is not "the latest collection" —
  // it is every row the squid has ever produced, behind a 30-result export
  // ceiling whose ordering (newest 30? oldest 30?) is undocumented. Reading
  // the newest run by hash is the only formulation that means "what was
  // collected most recently", and it needs no stored state: re-run the
  // squid, and the newest run is by definition the one to read.
  //
  // The run lookup was ALSO believed dead — GET /v1/runs?squid= appeared to
  // return an empty list. attemptRunList's comment records what that
  // actually was: a 200 with a real run in it, under an envelope key
  // unwrapCollection didn't know. That parser is shape-based now, so the
  // lookup is worth trying first rather than keeping as a last resort.
  for (const { strategy, path, query } of [
    { strategy: "/runs?squid=", path: "/runs", query: { squid } },
    { strategy: "/squids/<hash>/runs", path: `/squids/${squid}/runs`, query: {} },
  ]) {
    let runIds: string[] = [];
    try {
      const payload = await lobstrFetch<unknown>(path, { query, revalidate: RUNS_REVALIDATE_SECONDS });
      const runs = unwrapCollection<Record<string, unknown>>(payload)
        .map((run) => {
          const id = readId(run);
          return id ? ({ ...run, id } as LobstrRun) : undefined;
        })
        .filter((run): run is LobstrRun => run !== undefined);
      runIds = sortRunsNewestFirst(runs).map((run) => run.id);
      attempts.push({ strategy, rows: runIds.length, payloadShape: describePayload(payload) });
    } catch (err) {
      attempts.push({ strategy, rows: 0, error: (err as Error).message });
      continue;
    }

    // Only the newest few: a squid accumulates runs, and each extra lookup
    // is another request against a 2/sec endpoint for diminishing odds.
    for (const run of runIds.slice(0, 3)) {
      const resolved = await readRun(run, `${strategy} -> run ${run}`);
      if (resolved) return resolved;
    }
  }

  // 4 — last resort: every row the squid has, newest-first ordering not
  // guaranteed. Correct only while the squid has a single run; kept because
  // returning the right answer by luck beats returning nothing, and because
  // it is what covers a plan where run discovery genuinely doesn't work.
  // ?debug=1 names the strategy that won, so a page served from here rather
  // than from a run hash is visible rather than assumed.
  try {
    const { rows, payloadShape, pagesRead } = await fetchAllResults({ squid });
    attempts.push({ strategy: "/results?squid=", rows: rows.length, pagesRead, payloadShape });
    if (rows.length > 0) return { rows, source: `squid:${squid}`, attempts };
  } catch (err) {
    attempts.push({ strategy: "/results?squid=", rows: 0, error: (err as Error).message });
  }

  return { rows: [], source: null, attempts };
}

/**
 * One page of results is not the results — but asking for too big a page is
 * worse than asking for a small one.
 *
 * Two production facts shape this, and they pull in opposite directions:
 *
 *   1. /v1/results paginates at 10 by default and reports the rest only in
 *      `total_pages` and a `next` URL. Reading page one silently returned
 *      10 of 30 rows — split across three cards, that left each one with a
 *      third of its listings and no indication anything was missing. A
 *      partial market that looks complete is worse than an empty one.
 *   2. The free plan caps how many results an account may export, and asks
 *      for the whole page up front: `limit=100` came back
 *      `400 ExportLimitReached` ("You have reached the free plan limit of
 *      30 results"), while the default `limit=10` came back 200 with the
 *      same message downgraded to a soft `warning` field. So the ceiling is
 *      enforced on the REQUEST, not on the response — a page bigger than
 *      the plan allows returns nothing at all rather than as much as it can.
 *
 * Hence a ladder rather than a single page size: try the largest page that
 * should fit the whole free-tier run in one request, and if the server
 * rejects it as too large, drop to the size production has already proven
 * and page through instead. The ladder means an untested page size can only
 * ever cost one extra request, never the whole feed — which is what the
 * jump straight to 100 cost.
 *
 * Bounded by RESULTS_MAX_PAGES, because a runaway loop against a 2 req/s
 * endpoint during a page render is a worse failure than a truncated feed.
 */
const RESULTS_PAGE_SIZES = [30, 10] as const;
const RESULTS_MAX_PAGES = 5;

/**
 * /v1/results is documented at 2 req/s — the tightest cap in this API, and
 * this pager is the only thing that hits it in a burst. Pages used to be
 * fired back-to-back with no delay at all, so any read that needed three
 * pages was guaranteed to breach the cap; the resulting 429 on page 2 was
 * then swallowed and the half-read feed rendered as a market.
 *
 * 550ms keeps a sequential pager just under 2/s with margin for clock skew.
 * A three-page read costs ~1.1s of added wall time on a static render,
 * which is cheap next to the eBay and TCGdex calls the same render makes.
 */
const RESULTS_PAGE_INTERVAL_MS = 550;

/**
 * More than lobstrRequest's default of one. A single retry is fine when a
 * failure is allowed to degrade quietly; now that a failed page fails the
 * whole read (and drops the card to its preview), it's worth actually
 * riding out a rate limit. Capped at 2s per wait by lobstrRequest, so the
 * worst case this adds to a render is ~6s.
 */
const RESULTS_RETRIES = 3;

/** A read that came back short. Distinct from a transport error so the ladder in fetchAllResults can tell "ask smaller" from "this read is incomplete". */
class IncompleteResultsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteResultsError";
  }
}

/** The run's own row count, when the envelope reports one. Used only as a second opinion — see readResultPages. */
function readTotalResults(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ["total_results", "count", "total"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

/**
 * The free plan's soft "Export limit reached - only N results returned"
 * note, which rides along on a 200. It means the short read IS the whole
 * exportable set, so the total_results check below must stand down —
 * otherwise a read that is as complete as the plan allows gets rejected as
 * truncated, and the panel shows a preview forever.
 */
function hasExportCeilingWarning(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const warning = (payload as Record<string, unknown>).warning;
  return typeof warning === "string" && /limit/i.test(warning);
}

type ResultsPage = { rows: Record<string, unknown>[]; payloadShape: string; pagesRead: number };

/**
 * True for the "your page is bigger than your plan" rejection, which is the
 * one error worth retrying at a smaller page size. Matched on the message
 * rather than a parsed body because lobstrFetch surfaces the raw text, and
 * loosely (`400` + "limit") rather than on the exact `ExportLimitReached`
 * string, since the wording is plan copy and plan copy changes.
 */
function looksLikePageTooLarge(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("failed (400)") && /limit/i.test(message);
}

async function fetchAllResults(query: Record<string, string | number | undefined>): Promise<ResultsPage> {
  let lastError: unknown;

  for (const [index, limit] of RESULTS_PAGE_SIZES.entries()) {
    try {
      return await readResultPages(query, limit);
    } catch (err) {
      const smaller = RESULTS_PAGE_SIZES[index + 1];
      if (smaller === undefined || !looksLikePageTooLarge(err)) throw err;
      lastError = err;
      console.warn(`[lobstr] /results refused limit=${limit}, retrying at limit=${smaller}: ${(err as Error).message}`);
    }
  }

  throw lastError;
}

/**
 * Pages through /v1/results at a fixed page size, following `next`.
 *
 * ALL OR NOTHING, which is the whole point of this rewrite.
 *
 * It used to stop at the first failed page and return whatever had already
 * arrived, on the reasoning that "half a market beats none". Production
 * disagreed: two renders of the SAME card against the SAME immutable run
 * (61edae5a, 30 results, the only run on the squid) rendered 4 listings on
 * /products/gengar-vmax-271 and 1 listing on /products/gengar-vmax-271/fr,
 * with identical search text on both. selectVintedListings is pure, so the
 * only variable left was how many rows this function handed back. Each
 * wrong answer was then frozen by ISR for 36h.
 *
 * fetchAllResults' own comment already had the rule right and the code
 * simply didn't follow it: "A partial market that looks complete is worse
 * than an empty one." An error here drops the card to its clearly-marked
 * preview, which is honest. One of four asks, rendered as the market, is
 * not.
 *
 * Completeness is judged structurally rather than by trusting a count: the
 * read is complete only when the API stopped pointing at a `next` page.
 * Two things are deliberately NOT treated as failures:
 *
 * - The export-ceiling 400 on a LATER page. That refusal means we have
 *   already read everything this plan will ever hand back, so it completes
 *   the read rather than truncating it. (On page 1 it still propagates, so
 *   the ladder can step down to a smaller page size.)
 * - A `total_results` larger than what arrived, when the payload carried
 *   the ceiling warning — same reason.
 */
async function readResultPages(query: Record<string, string | number | undefined>, limit: number): Promise<ResultsPage> {
  const rows: Record<string, unknown>[] = [];
  let payloadShape = "";
  let pagesRead = 0;
  let expected: number | undefined;
  let ceilingReached = false;
  let complete = false;

  for (let page = 1; page <= RESULTS_MAX_PAGES; page++) {
    // Sequential and paced — see RESULTS_PAGE_INTERVAL_MS on the 2 req/s cap.
    if (page > 1) await new Promise((resolve) => setTimeout(resolve, RESULTS_PAGE_INTERVAL_MS));

    let payload: unknown;
    try {
      payload = await lobstrFetch<unknown>("/results", {
        query: { ...query, page, limit },
        revalidate: RESULTS_REVALIDATE_SECONDS,
        retriesLeft: RESULTS_RETRIES,
      });
    } catch (err) {
      if (page === 1) throw err;
      if (looksLikePageTooLarge(err)) {
        // The plan refusing page N is the end of the exportable set, not a
        // short read — everything it will give us is already in `rows`.
        ceilingReached = true;
        complete = true;
        break;
      }
      throw new IncompleteResultsError(
        `lobstr /results failed on page ${page} of a limit=${limit} read after ${rows.length} rows: ${(err as Error).message}`
      );
    }

    pagesRead = page;
    if (page === 1) {
      payloadShape = describePayload(payload);
      expected = readTotalResults(payload);
    }
    if (hasExportCeilingWarning(payload)) ceilingReached = true;

    const batch = unwrapCollection<Record<string, unknown>>(payload);
    rows.push(...batch);

    const next = payload && typeof payload === "object" ? (payload as Record<string, unknown>).next : null;
    if (!next || batch.length === 0) {
      complete = true;
      break;
    }
  }

  // Ran out of page budget with the API still offering more. Rendering this
  // would be the exact bug above, one loop iteration later.
  if (!complete) {
    throw new IncompleteResultsError(
      `lobstr /results still had a next page after ${RESULTS_MAX_PAGES} pages at limit=${limit} (${rows.length} rows read)`
    );
  }

  // Second opinion, only where it can be trusted: with the ceiling in play a
  // short read is the complete one, so the count must not overrule it.
  if (!ceilingReached && expected !== undefined && rows.length < expected) {
    throw new IncompleteResultsError(
      `lobstr /results returned ${rows.length} of ${expected} rows at limit=${limit} across ${pagesRead} page(s)`
    );
  }

  return { rows, payloadShape, pagesRead };
}

/**
 * GET /v1/results?run=<hash> — the scraped rows, in JSON. (Lobstr also
 * exposes GET /v1/runs/<hash>/download for a temporary CSV link, and
 * push-style delivery to Sheets/S3/SFTP; JSON pull is the only one that
 * doesn't add a second system to keep in sync.)
 *
 * Row shape is deliberately left as `Record<string, unknown>` here —
 * lib/vinted-listings.ts owns the mapping and does it defensively, since
 * the exact per-item field names aren't documented in the walkthrough this
 * was built from.
 *
 * `page`/`limit` are passed through when given but never assumed to exist:
 * the caller reads a single page and works with whatever comes back, which
 * is correct for either a paginated or an unpaginated response.
 */
export async function getResults(run: string): Promise<Record<string, unknown>[]> {
  return (await fetchAllResults({ run })).rows;
}
