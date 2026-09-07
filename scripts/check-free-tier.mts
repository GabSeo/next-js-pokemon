#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Fails the build when a route reaches a metered upstream without saying so.
 *
 * WHY THIS EXISTS. The product splits along one line: identity is free and
 * local, market data is metered and paid. That line is currently held by
 * discipline — the tier-1 loaders import `node:fs` and nothing else — and
 * discipline does not survive contact with a new page. Someone adds a helper,
 * the helper imports cards.ts, and a page a free user can reach starts spending
 * a 90/hour quota on every view. Nothing would say so until the quota ran out,
 * and by then it looks like an upstream outage rather than our own leak. That
 * exact confusion has already cost this project weeks once (see
 * lib/api-budget.ts on the silent 30/day ceiling).
 *
 * WHAT COUNTS AS METERED, defined rather than listed by hand. `resilientFetch`
 * charges `rateLimitKey ?? host`, and `chargeApiBudget` is a no-op for a bucket
 * with no ceiling. So a module is metered exactly when it fetches against a
 * bucket that appears in api-budget.ts's BUDGETS. That is why lib/tcgdex.ts is
 * NOT on the list despite making real HTTP calls: api.tcgdex.net has no
 * ceiling, which is the whole reason the Pokémon catalogue could be built from
 * it in the first place.
 *
 * TRANSITIVE, because a direct-import check is worth very little: the leak this
 * guards against is precisely the indirect one. The import graph is walked from
 * every route file through every `@/` import until it reaches a metered leaf or
 * runs out.
 *
 * WHAT THIS CHECK CANNOT SEE, stated plainly because it changes how to read a
 * failure: it walks IMPORTS, not calls. A route that imports a module which
 * imports cards.ts is flagged even when it never invokes anything metered —
 * `okf/about` is exactly that, a page of static prose that reaches PokéWallet
 * because lib/okf.ts imports cards.ts at module level for its OTHER functions.
 * Those live in IMPORT_ONLY below, kept separate from routes that genuinely
 * spend, so the two are never confused. Erring toward flagging is the right
 * bias for a guard rail; erring toward one list would not be.
 *
 * THE ALLOWLIST IS THE POINT. Nineteen routes are metered today and every one
 * of them should be — the tracked-card pages, the price checker, the market
 * APIs. Listing them makes "this route costs quota" a written decision instead
 * of an accident, and makes the twentieth one a conversation.
 *
 * Run by `npm run prebuild`, and directly:  npm run check:free-tier
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const APP_DIR = path.join(process.cwd(), "src", "app");
const SRC_DIR = path.join(process.cwd(), "src");

/**
 * The leaves. Each of these fetches against a bucket that has a ceiling in
 * api-budget.ts, so reaching one from a route means that route can spend quota.
 *
 *   apitcg        api.apitcg.com                       900/month, burst 200/day
 *   berrywallet   api.pokewallet.io#berrywallet        90/hour
 *   pokewallet    api.pokewallet.io#pokewallet         60/hour
 *   ebay-browse   api.ebay.com                         1200/day
 *   tcggo         cardmarket-api-tcg.p.rapidapi.com    80/day, burst 24/min
 */
const METERED_MODULES = ["apitcg", "berrywallet", "pokewallet", "ebay-browse", "tcggo"];

/**
 * Routes that are metered ON PURPOSE.
 *
 * Everything here serves a tracked card, a market figure or an explicit
 * price-check action — the paid half of the product. A route joins this list
 * only when someone decides it should cost quota.
 */
const ALLOWED = new Set([
  // The tracked-card pages and their machine-readable mirrors.
  "products/[slug]/page.tsx",
  "products/[slug]/index.md/route.ts",
  "okf/products/[slug]/route.ts",
  "tracked/[franchise]/page.tsx",
  "tracked/[franchise]/index.md/route.ts",
  "okf/tracked/[franchise]/route.ts",
  // The price checker is a market tool by definition.
  "tools/price-checker/page.tsx",
  "tools/price-checker/[cardId]/page.tsx",
  "tools/price-checker.md/route.ts",
  "okf/tools/price-checker/route.ts",
  // Market APIs and the agent surfaces over them.
  "api/mcp/route.ts",
  "api/pokemon/route.ts",
  "api/pokemon/[id]/route.ts",
  "api/one-piece/route.ts",
  "api/one-piece/[id]/route.ts",
  "api/price-check/route.ts",
  "api/price-alerts/route.ts",
  "api/site/route.ts",
  "api/vinted/refresh/route.ts",
  // Image proxies. Both hold an API key a browser cannot send, so they must
  // reach the client module. NOTE: the BerryWallet one charges the 90/hour
  // budget per image — see docs/free-tier-catalogue.md §3a. It is allowed here
  // because it exists today, not because it is right.
  "api/berrywallet-image/[id]/route.ts",
  "api/pokewallet-image/[id]/route.ts",
  // The home page shows live market movers.
  "page.tsx",
  "okf/page.tsx",
  "index.md/route.ts",
  "okf/index.md/route.ts",
  "okf/home/route.ts",
  // The entity map resolves every tracked card: lib/entitymap.ts calls
  // getCardBySlug per ref. Genuinely metered, not an import artifact.
  "entitymap/page.tsx",
  "entitymap.json/route.ts",
]);

/**
 * Routes that reach a metered module ONLY through a module-level import they
 * never invoke. No quota is spent serving them.
 *
 * `okf/about` returns a fixed paragraph of prose. It reaches PokéWallet because
 * lib/okf.ts imports cards.ts on line 1 for its collection and product
 * functions, and importing any part of that file pulls the whole chain.
 *
 * Kept apart from ALLOWED on purpose. These are not decisions to spend quota —
 * they are places where splitting a module would make the graph tell the truth,
 * and a list of them is the backlog for doing that.
 */
const IMPORT_ONLY = new Set(["okf/about/route.ts"]);

/** Every `@/…` import in a file. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/from\s+"(@\/[^"]+)"/g)].map((m) => m[1]);
}

function resolveAlias(spec: string): string | undefined {
  const rel = spec.replace(/^@\//, "");
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = path.join(SRC_DIR, rel + ext);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this extension
    }
  }
  return undefined;
}

/** Walks the import graph and returns the metered module reached, if any. */
function meteredPath(entry: string): string[] | undefined {
  const seen = new Set<string>();
  const stack: { file: string; trail: string[] }[] = [{ file: entry, trail: [] }];

  while (stack.length > 0) {
    const { file, trail } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const name = path.basename(file).replace(/\.tsx?$/, "");
    if (file.startsWith(path.join(SRC_DIR, "lib")) && METERED_MODULES.includes(name)) {
      return [...trail, `lib/${name}`];
    }

    for (const spec of importsOf(file)) {
      const resolved = resolveAlias(spec);
      if (resolved) stack.push({ file: resolved, trail: [...trail, spec] });
    }
  }
  return undefined;
}

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === "page.tsx" || entry.name === "route.ts") out.push(full);
  }
  return out;
}

const routes = routeFiles(APP_DIR);
const leaks: { route: string; via: string[] }[] = [];
let meteredOnPurpose = 0;
let importOnly = 0;
const staleAllowlist = new Set([...ALLOWED, ...IMPORT_ONLY]);

for (const file of routes) {
  const id = path.relative(APP_DIR, file).split(path.sep).join("/");
  const via = meteredPath(file);
  if (!via) continue;
  if (ALLOWED.has(id)) {
    meteredOnPurpose++;
    staleAllowlist.delete(id);
    continue;
  }
  if (IMPORT_ONLY.has(id)) {
    importOnly++;
    staleAllowlist.delete(id);
    continue;
  }
  leaks.push({ route: id, via });
}

const free = routes.length - meteredOnPurpose - importOnly - leaks.length;

if (leaks.length === 0 && staleAllowlist.size === 0) {
  console.log(
    `[free-tier] OK — ${routes.length} routes: ${free} free, ${meteredOnPurpose} metered by decision, ` +
      `${importOnly} import-only, 0 leaks.`
  );
  process.exit(0);
}

if (leaks.length > 0) {
  console.error(`\n[free-tier] ${leaks.length} route(s) reach a metered upstream without being declared.\n`);
  for (const { route, via } of leaks) {
    console.error(`  ${route}`);
    console.error(`    via ${via.join(" → ")}`);
  }
  console.error(
    `\nA free user reaching one of these spends quota on every view, and nothing\n` +
      `will say so until the quota runs out. Either keep the route on tier-1\n` +
      `loaders (lib/catalog, lib/one-piece-catalog, lib/one-piece-official), or\n` +
      `add it to ALLOWED in this script as a deliberate decision.\n`
  );
}

if (staleAllowlist.size > 0) {
  console.error(`[free-tier] ${staleAllowlist.size} allowlist entr(y/ies) no longer metered — remove them:`);
  for (const id of staleAllowlist) console.error(`  ${id}`);
  console.error("");
}

process.exit(1);
