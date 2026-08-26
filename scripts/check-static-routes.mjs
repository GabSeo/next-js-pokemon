#!/usr/bin/env node
/**
 * Every page/route listed below exists to be fetched fast and reliably by
 * an AI agent — often on a single, one-shot visit with no retry (the whole
 * premise of this site, see AGENTS.md/PLAN.md). "Dynamic" (on-demand,
 * server-rendered per request) isn't broken, but it's slower and less
 * reliable than a pre-built static page served instantly from Vercel's edge
 * — a real regression for that goal even when it isn't a crash.
 *
 * Originally written to guard against the specific bug fixed in commit
 * 82bfeab (a `cache: "no-store"` fetch anywhere in a route's render tree
 * silently forces the *whole route* dynamic — Next.js doesn't always throw
 * loudly enough at `next build` time to catch this; that bug shipped a
 * passing build, then broke later at ISR-regeneration time in production,
 * invisible until someone happened to read the runtime logs). Extended to
 * also cover the markdown and JSON mirrors of each product page, which
 * simply never had `generateStaticParams` added — same "should be static,
 * isn't" failure mode, different root cause, same check catches both.
 *
 * Checks the actual build artifact Next itself writes
 * (.next/prerender-manifest.json — the authoritative record of which pages
 * really got prerendered) rather than trusting build-time console output,
 * so a regression fails the build immediately instead of surfacing days
 * later in production logs. Wired in as `postbuild` (see package.json), so
 * it runs automatically after every `next build`, including on Vercel.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(rootDir, ".next", "prerender-manifest.json");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (err) {
  console.error(`[check-static-routes] Could not read ${manifestPath} — did "next build" run first?`, err);
  process.exit(1);
}

const routeKeys = Object.keys(manifest.routes ?? {});

/** Reads JAPANESE_MARKET_ENABLED out of graded-market.ts. Defaults to false if the file moves or its shape changes — a skipped check is better than a build that fails over a route deliberately switched off. */
function japaneseMarketEnabled() {
  try {
    const src = readFileSync(new URL("../src/lib/graded-market.ts", import.meta.url), "utf8");
    return /JAPANESE_MARKET_ENABLED\s*=\s*true/.test(src);
  } catch {
    return false;
  }
}

/**
 * Hosts that failed in a connection-level way during this build, as recorded
 * by lib/upstream.ts's markBuildOutage. Read once and deleted, so a marker
 * can never survive into a later build and quietly soften its checks.
 *
 * This exists because "this route built zero pages" has two completely
 * different causes that used to look identical here: a real regression, and
 * a third-party API being unreachable from the build container. The routes
 * below whose *only* data source is TCGdex genuinely have nothing to build
 * when TCGdex is down, and failing the deploy for that blocks shipping
 * unrelated work over someone else's outage.
 */
function upstreamOutages() {
  const dir = path.join(rootDir, ".next", "upstream-outage");
  if (!existsSync(dir)) return new Set();
  try {
    const hosts = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length));
    return new Set(hosts);
  } catch {
    return new Set();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const outages = upstreamOutages();
const tcgdexDown = outages.has("api.tcgdex.net");

// Every pattern here draws from getAllCards() or getCardsByFranchise("pokemon"),
// which always return one entry per card in data/card-refs.ts — a card whose
// price sources are all unreachable falls back to an offline placeholder
// rather than disappearing (see placeholderCard in lib/cards.ts). So a
// zero-page result means this specific route's own generateStaticParams (or
// its render tree) is broken, not that an external dependency is
// unavailable. Fails the build.
//
// The exception is the French route pair: a French page only exists when
// TCGdex returns a real translation, so with TCGdex unreachable there is
// legitimately nothing to prerender and no offline substitute that wouldn't
// be a fabricated translation. Those two drop to warnings for that build
// only, on the evidence of the outage marker above — never unconditionally.
const REQUIRED_PATTERNS = [
  // /ja is required only while the Japanese market is switched on. It is
  // gated on JAPANESE_MARKET_ENABLED in src/lib/graded-market.ts, and with
  // Japan off the route prerenders zero pages BY DESIGN — demanding them
  // would fail every build, and warning about them every build would be
  // noise. Read from the source rather than duplicated here, so flipping
  // that one flag re-arms this check automatically.
  ...(japaneseMarketEnabled() ? [{ label: "/products/[slug]/ja", test: (r) => /^\/products\/[^/]+\/ja$/.test(r) }] : []),
  { label: "/products/[slug]", test: (r) => /^\/products\/[^/]+$/.test(r) },
  // The prebuilt twin behind /tools/price-checker?cardId= (see the
  // beforeFiles rewrite in next.config.ts). Its whole purpose is to be
  // static: if it ever stops prerendering, the query-string URL silently
  // falls back to rendering four eBay searches plus the Vinted read inside
  // every visitor's request, which is exactly the regression this fixed and
  // is invisible from the outside. Its params come from card-refs.ts, so
  // zero pages can only mean a code regression, never an upstream outage.
  { label: "/tools/price-checker/[cardId]", test: (r) => /^\/tools\/price-checker\/[^/]+$/.test(r) },
  { label: "/products/[slug]/index.md", test: (r) => /^\/products\/[^/]+\/index\.md$/.test(r) },
  ...(tcgdexDown
    ? []
    : [
        { label: "/products/[slug]/fr", test: (r) => /^\/products\/[^/]+\/fr$/.test(r) },
        { label: "/products/[slug]/fr/index.md", test: (r) => /^\/products\/[^/]+\/fr\/index\.md$/.test(r) },
      ]),
  { label: "/api/pokemon/[id]", test: (r) => /^\/api\/pokemon\/[^/]+$/.test(r) },
  { label: "/okf/products/[slug]", test: (r) => /^\/okf\/products\/[^/]+$/.test(r) },
];

// One Piece has zero TCGdex coverage, so getCardsByFranchise("one-piece")
// gets its real data from apitcg alone (see cards.ts's resolveCard). Since
// the offline placeholder covers every card in data/card-refs.ts regardless
// of franchise, this should now always prerender — but it stays a warning
// rather than a hard failure, because it's the one required-ish route whose
// real content has a single point of failure, and blocking the *entire*
// deploy over apitcg's quota is worse than the problem it prevents.
const SOFT_PATTERNS = [{ label: "/api/one-piece/[id]", test: (r) => /^\/api\/one-piece\/[^/]+$/.test(r) }];

let failed = false;
for (const { label, test } of REQUIRED_PATTERNS) {
  const matches = routeKeys.filter(test);
  if (matches.length === 0) {
    failed = true;
    console.error(`[check-static-routes] FAIL: no statically-prerendered pages found for ${label}.`);
    console.error(`  This route is supposed to be pre-built (fast, agent-readable on the first fetch), not on-demand.`);
    console.error(`  Either generateStaticParams is missing/broken for this route, or a cache: "no-store" /`);
    console.error(`  revalidate: 0 fetch somewhere in its render tree forced it into dynamic rendering.`);
  } else {
    console.log(`[check-static-routes] OK: ${label} — ${matches.length} static page(s).`);
  }
}

for (const { label, test } of SOFT_PATTERNS) {
  const matches = routeKeys.filter(test);
  if (matches.length === 0) {
    console.warn(`[check-static-routes] WARN: no statically-prerendered pages found for ${label}.`);
    console.warn(`  Not failing the build for this one — One Piece has no TCGdex fallback, so this can`);
    console.warn(`  legitimately mean apitcg's quota is exhausted right now, not a code regression.`);
    console.warn(`  These pages will still render on demand once apitcg recovers (dynamicParams defaults`);
    console.warn(`  to true) — just not pre-built until the next successful revalidation.`);
  } else {
    console.log(`[check-static-routes] OK: ${label} — ${matches.length} static page(s).`);
  }
}

if (tcgdexDown) {
  console.warn(`[check-static-routes] WARN: api.tcgdex.net was unreachable during this build.`);
  console.warn(`  The French routes (/products/[slug]/fr and its .md mirror) have no other translation source,`);
  console.warn(`  so they were not required this time — they prerender again on the next build that reaches`);
  console.warn(`  TCGdex. Pokemon cards themselves still built: they fall back to an offline placeholder with`);
  console.warn(`  no price (see placeholderCard in src/lib/cards.ts), which refreshes on the next revalidation.`);
}

if (failed) {
  console.error("\n[check-static-routes] Build failed: one or more routes that must be static are not.");
  process.exit(1);
}

console.log("[check-static-routes] All required routes are statically prerendered.");
