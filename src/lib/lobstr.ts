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
 * the single constant to change — the cache TTLs below are derived from it.
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
 * Results are cached for the full collection interval, not minutes.
 *
 * That's safe rather than stale because the cache key includes the RUN
 * HASH, and a finished run's results are immutable — they are a snapshot of
 * one scrape, and nothing will ever change them. When the next collection
 * happens it produces a *new* run hash, so it lands on a fresh cache entry
 * and appears immediately; it never has to wait for this TTL to lapse.
 *
 * A cache miss (eviction, a new deployment) costs one API read, not a
 * re-scrape — no credits. The expensive operation is starting a run, and
 * nothing on the render path can do that.
 */
const RESULTS_REVALIDATE_SECONDS = COLLECTION_INTERVAL_DAYS * 24 * 60 * 60;

/**
 * The run *listing* is the one thing that has to stay fresher than the
 * collection interval, because it's how a newly finished run is discovered
 * at all. Six hours means a fresh collection reaches product pages within
 * that window, at a cost of four API reads a day — negligible, and nowhere
 * near any documented rate limit.
 */
const RUNS_REVALIDATE_SECONDS = 6 * 60 * 60;

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
};

async function lobstrFetch<T>(path: string, options: LobstrRequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, revalidate = 0 } = options;

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
    next: { revalidate },
  });

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

/** Top-level shape of a response, for diagnostics — says what came back without dumping a whole payload into a JSON response. */
function describePayload(payload: unknown): string {
  if (Array.isArray(payload)) return `array(${payload.length})`;
  if (!payload || typeof payload !== "object") return typeof payload;
  return Object.entries(payload as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `array(${value.length})` : typeof value}`)
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
export async function getResults(
  run: string,
  options: { page?: number; limit?: number } = {}
): Promise<Record<string, unknown>[]> {
  const payload = await lobstrFetch<unknown>("/results", {
    query: { run, page: options.page, limit: options.limit },
    revalidate: RESULTS_REVALIDATE_SECONDS,
  });
  return unwrapCollection<Record<string, unknown>>(payload);
}
