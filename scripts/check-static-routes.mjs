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
import { readFileSync } from "node:fs";
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

// Every pattern here draws from getAllCards() or getCardsByFranchise("pokemon")
// — both resilient to apitcg being down (Pokemon falls back to TCGdex; see
// commit 1a8ef71) — so a zero-page result can only mean this specific route's
// own generateStaticParams (or its render tree) is broken, not that an
// external dependency is unavailable. Fails the build.
const REQUIRED_PATTERNS = [
  // /ja is required only while the Japanese market is switched on. It is
  // gated on JAPANESE_MARKET_ENABLED in src/lib/graded-market.ts, and with
  // Japan off the route prerenders zero pages BY DESIGN — demanding them
  // would fail every build, and warning about them every build would be
  // noise. Read from the source rather than duplicated here, so flipping
  // that one flag re-arms this check automatically.
  ...(japaneseMarketEnabled() ? [{ label: "/products/[slug]/ja", test: (r) => /^\/products\/[^/]+\/ja$/.test(r) }] : []),
  { label: "/products/[slug]", test: (r) => /^\/products\/[^/]+$/.test(r) },
  { label: "/products/[slug]/fr", test: (r) => /^\/products\/[^/]+\/fr$/.test(r) },
  { label: "/products/[slug]/index.md", test: (r) => /^\/products\/[^/]+\/index\.md$/.test(r) },
  { label: "/products/[slug]/fr/index.md", test: (r) => /^\/products\/[^/]+\/fr\/index\.md$/.test(r) },
  { label: "/api/pokemon/[id]", test: (r) => /^\/api\/pokemon\/[^/]+$/.test(r) },
  { label: "/okf/products/[slug]", test: (r) => /^\/okf\/products\/[^/]+$/.test(r) },
];

// One Piece has zero TCGdex coverage — getCardsByFranchise("one-piece")
// depends on apitcg *unconditionally*, with no fallback (see cards.ts's
// resolveCard). A zero-page result here can genuinely mean "apitcg's quota
// is exhausted right now" rather than a code regression, and blocking the
// *entire* deploy over a real external outage — even when the resilient
// Pokemon routes above built fine — is worse than the problem it prevents.
// Warns, doesn't fail the build.
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

if (failed) {
  console.error("\n[check-static-routes] Build failed: one or more routes that must be static are not.");
  process.exit(1);
}

console.log("[check-static-routes] All required routes are statically prerendered.");
