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
 *   WRITE  (app/api/vinted/refresh/route.ts, cron or manual, secret-gated)
 *          addTasks() -> startRun() -> [Lobstr scrapes] -> getRunStats()
 *   READ   (lib/vinted-listings.ts, called during page render, cached)
 *          listRuns() -> getResults() -> filter -> render
 *
 * Squids are NOT created per request. Per Lobstr's own guidance you create
 * one and reuse it; ours is created once by scripts/lobstr-setup.mjs and
 * its hash lives in LOBSTR_VINTED_SQUID. See docs/lobstr-vinted.md.
 *
 * Endpoint shapes below come from Lobstr's documented walkthrough
 * (/v1/me, /v1/crawlers, /v1/squids, /v1/tasks, /v1/runs,
 * /v1/runs/<hash>/stats, /v1/results?run=<hash>). Two things are marked
 * UNVERIFIED where they go past what's documented — the run *listing*
 * query and the exact result-envelope shape — and both are parsed
 * defensively so an unexpected shape degrades to "no real data" (which the
 * panel already renders honestly as a clearly-tagged preview) instead of
 * throwing on a product page.
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
 * Results churn on Lobstr's side only when a new run finishes, which is a
 * scheduled/manual event (see the refresh route) — not something that can
 * change between two page views seconds apart. 30 minutes keeps product
 * pages statically renderable and well clear of the documented 2 req/s
 * limit on /v1/results even under real traffic.
 */
const RESULTS_REVALIDATE_SECONDS = 30 * 60;
/** Run metadata is cheap and slightly more volatile than results (a run appears the moment it's started, before it has any results) — refreshed more eagerly so a just-finished run is picked up within minutes. */
const RUNS_REVALIDATE_SECONDS = 5 * 60;

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
 * Lobstr wraps collections inconsistently enough across endpoints that
 * guessing one shape would be brittle — a plain array, `{ data: [...] }`,
 * `{ results: [...] }` and `{ count, next, data }` are all plausible for
 * the same call. Rather than assert one, unwrap whichever is present and
 * treat anything else as empty: a wrong guess then costs a missing preview,
 * not a crashed product page.
 */
function unwrapCollection<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "results", "items", "records"]) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

/** Lobstr hands back object ids as `id` (its own docs' wording: "The response gives you an id"); `hash` is accepted too since parts of its surface use that name. */
function readId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ["id", "hash", "run", "squid"]) {
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

/**
 * UNVERIFIED: listing a squid's runs via `GET /v1/runs?squid=<hash>` is a
 * conventional REST reading of the documented `POST /v1/runs`, not
 * something Lobstr's walkthrough spells out. It's what lets the read path
 * find the newest finished run without a database to remember run hashes
 * in. If the query shape is wrong this returns [] (see unwrapCollection)
 * and the France tab falls back to its clearly-marked preview — set
 * LOBSTR_VINTED_RUN to pin a known run hash and bypass this entirely.
 */
export async function listRuns(squid: string): Promise<LobstrRun[]> {
  const payload = await lobstrFetch<unknown>("/runs", {
    query: { squid },
    revalidate: RUNS_REVALIDATE_SECONDS,
  });
  const runs = unwrapCollection<Record<string, unknown>>(payload)
    .map((run) => {
      const id = readId(run);
      return id ? ({ ...run, id } as LobstrRun) : undefined;
    })
    .filter((run): run is LobstrRun => run !== undefined);

  // Newest first when Lobstr gives us a date to sort on; otherwise trust
  // the API's own ordering rather than inventing one.
  return runs.sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : NaN;
    const bTime = b.created_at ? Date.parse(b.created_at) : NaN;
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
    return bTime - aTime;
  });
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
