import { NextResponse } from "next/server";
import { getCardsByFranchise } from "@/lib/cards";
import {
  addTasks,
  COLLECTION_INTERVAL_DAYS,
  getRunStats,
  VINTED_RESULTS_PER_CARD,
  hasLobstrCredentials,
  listRuns,
  pinnedVintedRunHash,
  startRun,
  vintedSquidHash,
} from "@/lib/lobstr";
import { diagnoseVintedRead, vintedQueryForCard } from "@/lib/vinted-listings";

/**
 * The WRITE half of the Lobstr integration (lib/lobstr.ts explains the
 * split): queues one scrape task per tracked card and kicks off a run.
 * Nothing here waits for the scrape to finish — Lobstr's API is
 * asynchronous, a run takes minutes, and results are read back later and
 * separately by lib/vinted-listings.ts during page render.
 *
 * POST triggers a run (costs scrape credits). GET reports what's
 * configured and how the most recent run is doing, without triggering
 * anything.
 *
 * Two independent guards on spend, because scraping is the only part of
 * this integration that costs money:
 *
 * 1. Secret-gated, FAILING CLOSED: with no LOBSTR_REFRESH_SECRET
 *    configured, every request is rejected. An open endpoint here would let
 *    anyone on the internet burn the account's credits by holding down
 *    refresh.
 * 2. A minimum interval of COLLECTION_INTERVAL_DAYS between runs, checked
 *    against Lobstr's own record of when the last run started. The cron
 *    schedule in vercel.json is a *plan*; this is the part that holds when
 *    the plan is wrong — a misconfigured schedule, a retried webhook, two
 *    deployments, or someone curling this by hand can't collect early. Pass
 *    force to override deliberately.
 */

export const dynamic = "force-dynamic";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`, so the same header shape works for both a scheduled call and a manual curl. */
function isAuthorized(request: Request): boolean {
  const secret = process.env.LOBSTR_REFRESH_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function configurationError(): string | undefined {
  if (!hasLobstrCredentials()) return "LOBSTR_API_KEY not set";
  if (!vintedSquidHash()) return "LOBSTR_VINTED_SQUID not set — run `node scripts/lobstr-setup.mjs` once to create the squid";
  return undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Slack cut off the front of the interval so a scheduled collection can't
 * be rejected by its own schedule. The cron in vercel.json fires on the 1st
 * and 15th — exactly 14 days apart in the best case — so without this, a
 * few minutes of scheduler jitter would make the run "13 days 23:59 old",
 * fail the check, and skip the collection entirely until the *next* fire a
 * fortnight later. Half a day of tolerance costs nothing (it can pull a
 * collection at most 12h early) and removes that failure mode.
 */
const COLLECTION_GRACE_MS = 12 * 60 * 60 * 1000;
/** Matches RUNS_REVALIDATE_SECONDS in lib/lobstr.ts — how long a freshly finished run can take to reach product pages. Reported back so a caller knows when to look, instead of refreshing and assuming it failed. */
const LISTING_DISCOVERY_HOURS = 6;

/** `force` may arrive as ?force=1 or as {"force":true} in the body, so a browser address bar and a scripted POST both work. A malformed body is simply not a force. */
async function isForced(request: Request): Promise<boolean> {
  if (new URL(request.url).searchParams.get("force") !== null) return true;
  try {
    const body = (await request.clone().json()) as { force?: unknown };
    return body?.force === true;
  } catch {
    return false;
  }
}

/**
 * Lobstr's own run history is the source of truth for "when did we last
 * collect", deliberately — not a local timestamp. A serverless deployment
 * has nowhere durable to write one, and a cache entry that got evicted
 * would read as "never collected" and authorise a spend. Asking the vendor
 * that already knows cannot drift.
 *
 * Fails OPEN: if the run list can't be read (the UNVERIFIED query shape in
 * lib/lobstr.ts, an outage), collection proceeds. The alternative — a
 * transient read failure permanently blocking collection — leaves the site
 * on preview data indefinitely, which is worse than one unplanned run.
 */
/** The newest run date Lobstr will admit to, or undefined when the run list is empty/unreadable. Separate from tooSoonToCollect so the response can distinguish "checked and allowed" from "could not check". */
async function lastRunTimestamp(squid: string): Promise<string | undefined> {
  try {
    return (await listRuns(squid)).find((run) => run.created_at)?.created_at;
  } catch {
    return undefined;
  }
}

async function tooSoonToCollect(squid: string): Promise<{ error: string; lastRunAt: string; nextEligibleAt: string } | undefined> {
  let runs;
  try {
    runs = await listRuns(squid);
  } catch (err) {
    console.warn("[lobstr] could not check last run time, allowing collection:", err);
    return undefined;
  }

  const lastRunAt = runs.find((run) => run.created_at)?.created_at;
  if (!lastRunAt) {
    // Production reality: GET /v1/runs?squid= returns an empty list even for
    // a squid with a finished run, so this check frequently CANNOT be
    // evaluated. It still fails open — a transient read error must not
    // freeze collection forever — but that means the 14-day spend guard is
    // not actually protecting anything right now, and pretending otherwise
    // would be worse than saying so. The POST response reports this as
    // intervalCheck: "unverifiable" rather than implying it passed.
    console.warn("[lobstr] no run dates available — the collection-interval guard cannot be enforced on this call.");
    return undefined;
  }

  const lastRunMs = Date.parse(lastRunAt);
  if (Number.isNaN(lastRunMs)) return undefined;

  const nextEligibleMs = lastRunMs + COLLECTION_INTERVAL_DAYS * DAY_MS - COLLECTION_GRACE_MS;
  if (Date.now() >= nextEligibleMs) return undefined;

  return {
    error: `Last collection was less than ${COLLECTION_INTERVAL_DAYS} days ago. Scraping is the only part of this that costs credits, so it is rate-limited to that interval. Pass force to override.`,
    lastRunAt,
    nextEligibleAt: new Date(nextEligibleMs).toISOString(),
  };
}

/**
 * Status only — no tasks queued, no run started, no credits spent. Useful
 * for confirming a cron-triggered run actually finished before wondering
 * why a product page still shows the preview.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configured = {
    apiKey: hasLobstrCredentials(),
    squid: vintedSquidHash() ?? null,
    pinnedRun: pinnedVintedRunHash() ?? null,
  };

  // ?debug=1 walks the whole read path and reports where rows are being
  // lost. Costs nothing — reading results isn't billed and the rows are
  // already cached by run hash — so it's safe to hit repeatedly while
  // chasing an empty France tab.
  if (new URL(request.url).searchParams.get("debug") !== null) {
    const cards = await getCardsByFranchise("pokemon");
    const targets = await Promise.all(
      cards.map(async (card) => {
        const { displayName, searchUrl } = await vintedQueryForCard(card);
        return { slug: card.slug, displayName, searchUrl };
      })
    );
    return NextResponse.json(await diagnoseVintedRead(targets));
  }

  const squid = vintedSquidHash();
  if (!squid) return NextResponse.json({ configured, runs: [] });

  try {
    const runs = await listRuns(squid);
    const latest = runs[0];
    // Stats are fetched for the newest run only: it's the one the read path
    // will use, and one call keeps this well inside Lobstr's rate limits.
    const stats = latest ? await getRunStats(latest.id).catch(() => null) : null;
    const lastRunAt = runs.find((run) => run.created_at)?.created_at;
    const lastRunMs = lastRunAt ? Date.parse(lastRunAt) : NaN;
    return NextResponse.json({
      configured,
      collection: {
        intervalDays: COLLECTION_INTERVAL_DAYS,
        lastRunAt: lastRunAt ?? null,
        // Answers the question someone actually has when they hit this
        // endpoint: can I collect right now, and if not, when?
        nextEligibleAt: Number.isNaN(lastRunMs)
          ? null
          : new Date(lastRunMs + COLLECTION_INTERVAL_DAYS * DAY_MS - COLLECTION_GRACE_MS).toISOString(),
        eligibleNow: Number.isNaN(lastRunMs) || Date.now() >= lastRunMs + COLLECTION_INTERVAL_DAYS * DAY_MS - COLLECTION_GRACE_MS,
      },
      runs: runs.slice(0, 5).map((run) => ({ id: run.id, status: run.status ?? null, createdAt: run.created_at ?? null })),
      latestRunStats: stats,
    });
  } catch (err) {
    console.error("[lobstr] refresh status check failed:", err);
    return NextResponse.json({ configured, error: (err as Error).message }, { status: 502 });
  }
}

/**
 * Queue + launch. One task per tracked card, batched into a single
 * /v1/tasks call, then one /v1/runs call — so the whole catalog costs two
 * requests regardless of how many cards it grows to (well inside the
 * documented 90 calls/min on /v1/tasks).
 *
 * Task URLs are built by vintedQueryForCard, the same function that builds
 * the "Search on Vinted" link the panel renders — the scrape and the
 * click-through can't drift apart.
 *
 * Refuses to collect again within COLLECTION_INTERVAL_DAYS of the last run
 * (409 + the timestamp it next becomes eligible), unless `force` is passed
 * as a query param or in the JSON body. Force still requires the secret —
 * it's an override for a human who means it, not a way around the gate.
 *
 * Note on the condition filter: every task URL carries `status_ids[]=2`
 * (Très bon état), so Vinted filters server-side and the scrape never
 * spends credits on tiers this site would throw away. The text check in
 * lib/vinted-listings.ts stays on as a second, independent guard.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configError = configurationError();
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 503 });
  }

  const squid = vintedSquidHash()!;
  const force = await isForced(request);
  let lastRunSeenAt: string | undefined;

  try {
    if (!force) {
      const blocked = await tooSoonToCollect(squid);
      if (blocked) return NextResponse.json(blocked, { status: 409 });
    }
    lastRunSeenAt = await lastRunTimestamp(squid);

    // Pokémon only — deliberately not getAllCards(). This is the Market
    // Overview panel's France tab, and every card added here costs
    // VINTED_RESULTS_PER_CARD results out of a 100/month tier. Scraping the
    // One Piece cards too would double the bill for a tab that franchise's
    // own market panel (now enabled — see ONE_PIECE_MARKET_ENABLED in
    // lib/graded-market.ts) doesn't yet get real traffic to justify; their
    // France tab stays on its clearly-marked preview, which is the honest
    // way to show data that isn't collected.
    const cards = await getCardsByFranchise("pokemon");
    const queries = await Promise.all(cards.map(async (card) => ({ slug: card.slug, ...(await vintedQueryForCard(card)) })));
    const urls = [...new Set(queries.map((q) => q.searchUrl))];

    if (urls.length === 0) {
      return NextResponse.json({ error: "No tracked cards to scrape" }, { status: 503 });
    }

    await addTasks(squid, urls);
    const run = await startRun(squid);

    return NextResponse.json({
      started: true,
      runId: run.id,
      taskCount: urls.length,
      tasks: queries.map((q) => ({ slug: q.slug, query: q.query, url: q.searchUrl })),
      forced: force,
      // "enforced" only when Lobstr actually told us when the last run was.
      // See tooSoonToCollect: the run list is unreliable, so this is often
      // "unverifiable" — meaning nothing stopped this call, and repeated
      // POSTs would each spend a full collection's credits.
      intervalCheck: force ? "overridden" : lastRunSeenAt ? "enforced" : "unverifiable",
      // The budget, echoed back on every collection so a card added to
      // card-refs.ts shows up here as a bigger number instead of quietly
      // as a bigger invoice. If this exceeds what the squid was configured
      // with, re-run `node scripts/lobstr-setup.mjs --settings`.
      resultBudget: {
        perCard: VINTED_RESULTS_PER_CARD,
        cards: urls.length,
        maxResultsThisRun: urls.length * VINTED_RESULTS_PER_CARD,
        perMonthAtThisCadence: urls.length * VINTED_RESULTS_PER_CARD * 2,
      },
      nextEligibleAt: new Date(Date.now() + COLLECTION_INTERVAL_DAYS * DAY_MS - COLLECTION_GRACE_MS).toISOString(),
      // Results are not available yet — the run has only just started. This
      // is the asynchronous part callers most often get wrong.
      note: `Run started. Results appear on product pages once the run finishes and the read path picks up the new run (within ${LISTING_DISCOVERY_HOURS}h).`,
    });
  } catch (err) {
    console.error("[lobstr] failed to start Vinted run:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
