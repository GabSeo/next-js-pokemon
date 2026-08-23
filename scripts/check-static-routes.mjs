#!/usr/bin/env node
/**
 * Guards against the exact class of bug fixed in commit 82bfeab: a single
 * `cache: "no-store"` (or `revalidate: 0`) fetch anywhere in a product
 * page's render tree silently downgrades /products/[slug] from static
 * (fast, pre-built, readable by an AI agent on the very first fetch — the
 * whole premise of this site, see AGENTS.md/PLAN.md) to on-demand dynamic
 * rendering. Next.js doesn't always throw loudly enough at `next build`
 * time to catch this — the original bug shipped a passing build, then
 * broke later at ISR-regeneration time in production, invisible until
 * someone happened to read the runtime logs.
 *
 * This checks the actual build artifact Next itself writes
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

// One entry per route that must be statically prerendered — every pattern
// needs at least one real page in the manifest, or that route silently
// fell back to on-demand dynamic rendering.
const REQUIRED_PATTERNS = [
  { label: "/products/[slug]", test: (r) => /^\/products\/[^/]+$/.test(r) },
  { label: "/products/[slug]/fr", test: (r) => /^\/products\/[^/]+\/fr$/.test(r) },
  { label: "/products/[slug]/ja", test: (r) => /^\/products\/[^/]+\/ja$/.test(r) },
  { label: "/okf/products/[slug]", test: (r) => /^\/okf\/products\/[^/]+$/.test(r) },
];

let failed = false;
for (const { label, test } of REQUIRED_PATTERNS) {
  const matches = routeKeys.filter(test);
  if (matches.length === 0) {
    failed = true;
    console.error(`[check-static-routes] FAIL: no statically-prerendered pages found for ${label}.`);
    console.error(`  This route is supposed to be pre-built (fast, agent-readable on the first fetch), not on-demand.`);
    console.error(`  Likely cause: a cache: "no-store" / revalidate: 0 fetch somewhere in this route's`);
    console.error(`  render tree forced it into dynamic rendering — see commit 82bfeab for the last time this happened.`);
  } else {
    console.log(`[check-static-routes] OK: ${label} — ${matches.length} static page(s).`);
  }
}

if (failed) {
  console.error("\n[check-static-routes] Build failed: one or more routes that must be static are not.");
  process.exit(1);
}

console.log("[check-static-routes] All required routes are statically prerendered.");
