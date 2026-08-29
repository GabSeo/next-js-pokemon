#!/usr/bin/env node
/**
 * Prints what each metered credential spent during the build that just ran.
 *
 * Wired in as part of `postbuild` (see package.json), next to
 * check-static-routes.mjs, because the counters live under `.next/cache` and
 * that is the moment they are both complete and still present. It never
 * fails the build: a budget being close to its ceiling is information, not a
 * regression, and the ceiling enforcing itself (src/lib/api-budget.ts) is
 * already the mechanism that prevents an overspend.
 *
 * Read this after adding cards to data/card-refs.ts. Build cost scales
 * roughly linearly with the tracked-card count, and the two pokewallet.io
 * credentials are the tightest ceilings in the system (100 calls/hour each),
 * so this table is the fastest way to see how much headroom is left before
 * the next card, or the next redeploy inside the same hour, starts getting
 * refused.
 *
 * The counters are windowed and shared across deployments (`.next/cache` is
 * restored by Vercel between builds), so "used" is the spend across every
 * build inside the current window, not just this one — which is exactly the
 * number that matters against an hourly or daily quota.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const budgetDir = path.join(rootDir, ".next", "cache", "api-budget");

/**
 * The ceilings are read out of the TypeScript source rather than duplicated
 * here — same technique check-static-routes.mjs uses to read a flag out of
 * graded-market.ts, and for the same reason: a postbuild script quietly
 * disagreeing with the module it reports on is worse than no report.
 */
function budgets() {
  try {
    const src = readFileSync(path.join(rootDir, "src", "lib", "api-budget.ts"), "utf8");
    const block = src.slice(src.indexOf("const BUDGETS"), src.indexOf("type Counter"));
    const found = new Map();
    // Parsed line by line rather than with one regex over the whole block.
    // The single-regex version had an optional trailing group for `burst`,
    // which is a trap: an optional group matches empty rather than forcing
    // the backtrack that would find it, so every burst ceiling silently
    // read as absent and the report quietly under-stated the limits.
    for (const line of block.split("\n")) {
      const entry = line.match(/^\s*"([^"]+)":\s*\{(.*)\},?\s*$/);
      if (!entry) continue;
      const [, bucket, body] = entry;
      // First `limit:` in the body is the main ceiling; the one inside
      // `burst: { ... }` is matched separately below.
      const limit = body.match(/limit:\s*(\d+)/);
      if (!limit) continue;
      const burst = body.match(/burst:\s*\{[^}]*limit:\s*(\d+)/);
      found.set(bucket, { limit: Number(limit[1]), burst: burst ? Number(burst[1]) : undefined });
    }
    return found;
  } catch {
    return new Map();
  }
}

if (!existsSync(budgetDir)) {
  console.log("[api-budget] No calls were metered this build (no counters written).");
  process.exit(0);
}

const limits = budgets();
const rows = [];

for (const file of readdirSync(budgetDir).filter((f) => f.endsWith(".json"))) {
  const bucket = decodeURIComponent(file.slice(0, -".json".length));
  try {
    // Counters are { main, burst } since burst ceilings were added; a file
    // written before that is a bare Counter. Read either.
    const raw = JSON.parse(readFileSync(path.join(budgetDir, file), "utf8"));
    const main = raw.main ?? raw;
    const budget = limits.get(bucket);
    rows.push({
      bucket,
      count: main.count,
      windowStart: main.windowStart,
      limit: budget?.limit,
      burstLimit: budget?.burst,
      burstCount: raw.burst?.count,
    });
  } catch {
    // A counter caught mid-write by a build worker. Skipping it costs
    // nothing here — this is a report, and api-budget.ts already treats an
    // unreadable counter as a fresh window rather than a failure.
  }
}

if (rows.length === 0) {
  console.log("[api-budget] No readable counters.");
  process.exit(0);
}

rows.sort((a, b) => b.count / (b.limit ?? Infinity) - a.count / (a.limit ?? Infinity));

console.log("[api-budget] Upstream calls in the current quota window:");
for (const { bucket, count, limit, windowStart, burstLimit, burstCount } of rows) {
  const pct = limit ? Math.round((count / limit) * 100) : null;
  const headroom = limit ? `${count}/${limit} (${pct}%)` : `${count} (unbudgeted)`;
  const since = new Date(windowStart).toISOString();
  const flag = pct !== null && pct >= 80 ? "  <-- close to the ceiling" : "";
  console.log(`  ${bucket.padEnd(38)} ${headroom.padEnd(20)} window opened ${since}${flag}`);
  if (burstLimit !== undefined) {
    // Reported separately because it is a different failure: the daily
    // figure can look healthy while a concurrent build is breaching the
    // per-minute ceiling. See `burst` in src/lib/api-budget.ts.
    console.log(`  ${"".padEnd(38)} burst ${burstCount ?? 0}/${burstLimit} per minute`);
  }
}
