import { cardRefs } from "@/data/card-refs";
import { absoluteUrl } from "@/lib/site";

/**
 * Regenerates expired ISR pages on a schedule, so a visitor never has to.
 *
 * The problem this solves: ISR does not refresh on a timer. A page's
 * `revalidate` window only says when it *becomes eligible* — the rebuild is
 * triggered by the next request to arrive after that, and, because Next
 * serves stale-while-revalidate, that request is served the OLD page. The
 * visitor who pays for the rebuild never sees its result.
 *
 * That is tolerable for a human, who can reload. It is not tolerable for
 * this site's actual audience: AI agents fetching a card once, with no
 * retry (see scripts/check-static-routes.mjs's header — that premise is why
 * every one of these routes is prerendered in the first place). An agent
 * arriving after the window lapsed gets a day-old price, at full speed,
 * with a 200, and moves on. Low human traffic makes this the common case
 * rather than the edge case: with a handful of readers, the window
 * routinely expires with nobody around, so a crawler is exactly who lands
 * on it.
 *
 * `revalidatePath` is deliberately NOT what this does — that only marks a
 * page stale, which leaves the next visitor paying the rebuild and still
 * being served stale content first. The same distinction
 * /api/vinted/publish documents for its own `expire: 0` choice. Actually
 * fetching each URL is what forces the regeneration to happen here, now,
 * against this request instead of a reader's.
 *
 * Cost note, because this is a real change in shape rather than a free win:
 * lazy ISR costs nothing when nobody visits, while this pays for one
 * catalogue refresh per revalidate window whether or not anyone reads it.
 * Fetching a page whose window has NOT lapsed costs nothing upstream (it is
 * served straight from the ISR cache), so running this more often than the
 * window does not multiply spend — it only narrows how long a lapsed page
 * can sit unattended.
 */

export const dynamic = "force-dynamic";

/**
 * Sequential warming of every card can outrun the default serverless
 * timeout, so this asks for the longer ceiling. WARM_ORDER below is built
 * to finish well inside it regardless — see its own comment on why the
 * expensive work collapses into the first few requests.
 */
export const maxDuration = 60;

/** Per-request ceiling. A page that is genuinely regenerating can take a few seconds; anything past this is a problem worth abandoning rather than blocking the rest of the run behind. */
const FETCH_TIMEOUT_MS = 20_000;

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`, so the same header shape works for both a scheduled call and a manual curl. Same secret resolution as /api/vinted/refresh, and FAILING CLOSED for the same reason: with none configured, nothing is authorized. */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET || process.env.LOBSTR_REFRESH_SECRET;
  if (!secret) return false;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(request.url).searchParams.get("secret") === secret;
}

/**
 * Every URL worth warming, in a deliberate order.
 *
 * The homepage and the two collection pages come FIRST because each of them
 * resolves a whole list of cards in one render (getAllCards /
 * getCardsByFranchise). Next's runtime Data Cache is shared across routes,
 * so those three requests populate it for the entire catalogue — and every
 * per-card page, markdown mirror and JSON route behind them then
 * regenerates from cache instead of going upstream again.
 *
 * That ordering is the whole reason this is cheap, and it is also why the
 * requests must be sequential (see warm() below). Fired concurrently, every
 * URL would miss the shared cache at the same instant and fan out to the
 * upstream APIs in parallel — a thundering herd against exactly the free
 * tiers lib/api-budget.ts exists to protect.
 */
function warmOrder(): string[] {
  const franchises = [...new Set(cardRefs.map((ref) => ref.franchise))];
  return [
    // Catalogue-wide renders first — these do the expensive resolution once.
    "/",
    ...franchises.flatMap((f) => [`/collections/${f}`, `/collections/${f}/index.md`]),
    // Then the per-card surfaces, which now hit a warm Data Cache. The
    // markdown mirror and the JSON route matter as much as the HTML here:
    // llms.txt points agents straight at them, so they are the surfaces an
    // agent is most likely to read.
    ...cardRefs.flatMap((ref) => [
      `/products/${ref.slug}`,
      `/products/${ref.slug}/index.md`,
      `/api/${ref.franchise}/${ref.slug}`,
      `/tools/price-checker/${ref.slug}`,
    ]),
  ];
}

type WarmResult = { path: string; status: number | "error"; ms: number };

/**
 * Sequential on purpose — see warmOrder's comment. Never throws: a single
 * unreachable URL must not abort the rest of the run, since every URL after
 * it is independent and still worth warming.
 */
async function warm(paths: string[]): Promise<WarmResult[]> {
  const results: WarmResult[] = [];
  for (const path of paths) {
    const startedAt = Date.now();
    try {
      const res = await fetch(absoluteUrl(path), {
        // no-store applies to THIS request, not to the page being warmed:
        // it stops the warmer itself caching the response and turning into
        // a no-op on its second run. The regeneration it triggers on the
        // far side is unaffected.
        cache: "no-store",
        headers: { "user-agent": "CardTrace-cache-warmer" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      results.push({ path, status: res.status, ms: Date.now() - startedAt });
    } catch {
      results.push({ path, status: "error", ms: Date.now() - startedAt });
    }
  }
  return results;
}

/**
 * GET, not POST, and idempotent: warming spends upstream quota but changes
 * nothing and can be re-run safely. Vercel Cron issues a GET.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const results = await warm(warmOrder());
  const failed = results.filter((r) => r.status === "error" || (typeof r.status === "number" && r.status >= 400));

  return Response.json({
    ok: failed.length === 0,
    warmed: results.length,
    failed: failed.length,
    totalMs: Date.now() - startedAt,
    // Full list rather than a count: this endpoint's only consumer is a
    // human reading a cron log after something looked stale, and "which URL"
    // is the entire question at that point.
    results,
  });
}
