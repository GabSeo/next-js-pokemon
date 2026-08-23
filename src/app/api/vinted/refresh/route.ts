import { NextResponse } from "next/server";
import { getAllCards } from "@/lib/cards";
import {
  addTasks,
  getRunStats,
  hasLobstrCredentials,
  listRuns,
  pinnedVintedRunHash,
  startRun,
  vintedSquidHash,
} from "@/lib/lobstr";
import { vintedQueryForCard } from "@/lib/vinted-listings";

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
 * Both are secret-gated and FAIL CLOSED: with no LOBSTR_REFRESH_SECRET
 * configured, every request is rejected. An open endpoint here would let
 * anyone on the internet burn the account's scrape credits by holding down
 * refresh.
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

  const squid = vintedSquidHash();
  if (!squid) return NextResponse.json({ configured, runs: [] });

  try {
    const runs = await listRuns(squid);
    const latest = runs[0];
    // Stats are fetched for the newest run only: it's the one the read path
    // will use, and one call keeps this well inside Lobstr's rate limits.
    const stats = latest ? await getRunStats(latest.id).catch(() => null) : null;
    return NextResponse.json({
      configured,
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
 * Note on the condition filter: tasks scrape the *unfiltered* search, and
 * "Très bon état" is applied afterwards when results are read
 * (lib/vinted-listings.ts). Vinted's URL does carry a status filter, but
 * its numeric ids aren't documented anywhere this integration could verify,
 * and a wrong id would silently scrape the wrong tier — an error that looks
 * exactly like real data. Filtering on the returned condition text is
 * checkable and can't quietly mislabel a listing. Worth revisiting as a
 * credit optimisation once the ids are confirmed against a live run.
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

  try {
    const cards = await getAllCards();
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
      // Results are not available yet — the run has only just started. This
      // is the asynchronous part callers most often get wrong.
      note: "Run started. Results appear on product pages once the run finishes and the read path's cache turns over.",
    });
  } catch (err) {
    console.error("[lobstr] failed to start Vinted run:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
