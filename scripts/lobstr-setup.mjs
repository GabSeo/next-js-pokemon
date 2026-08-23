#!/usr/bin/env node
/**
 * One-time Lobstr.io setup + inspection helper for the Vinted integration
 * (see src/lib/lobstr.ts and docs/lobstr-vinted.md).
 *
 * Squids are reusable, not per-request: you create one, keep its hash, and
 * every run reuses it. That creation step is the one thing the app itself
 * deliberately never does — a web request creating scraper instances is how
 * you end up with a dashboard full of orphaned squids — so it lives here,
 * as something a human runs on purpose.
 *
 * Usage (needs LOBSTR_API_KEY in the environment):
 *
 *   node scripts/lobstr-setup.mjs                 # whoami + list crawlers
 *   node scripts/lobstr-setup.mjs --create        # create the Vinted squid, print its hash
 *   node scripts/lobstr-setup.mjs --params        # settable params for the Vinted crawler
 *   node scripts/lobstr-setup.mjs --settings      # apply the recommended squid settings
 *   node scripts/lobstr-setup.mjs --sample <run>  # print real result keys from a finished run
 *
 * --sample is the one to reach for when the France tab shows a preview
 * despite a finished run: it prints the actual per-item field names Lobstr
 * returns, which is exactly what src/lib/vinted-listings.ts's FIELD_ALIASES
 * is guessing at. Correct those aliases against real output and the mapping
 * stops being a guess.
 */

import { readFileSync } from "node:fs";

const API_BASE = "https://api.lobstr.io/v1";
const VINTED_PRODUCTS_CRAWLER = "ffd34f9b42a79b7323a048f09fc158e6";

/**
 * The budget, in the only unit that costs money: scraped results.
 *
 * Lobstr's free tier is 100 results/month. Collection is fortnightly (two
 * runs a month, see COLLECTION_INTERVAL_DAYS in src/lib/lobstr.ts), so the
 * whole bill is: tracked cards x RESULTS_PER_CARD x 2.
 *
 *   3 cards x 10 x 2 = 60/month — inside the free tier, with room for one
 *   forced re-collection.
 *
 * Two caps do two different jobs, and both matter:
 *
 * - max_results_per_task caps EACH card's search at 10. This is what makes
 *   the per-card number real: without it the run-wide cap is first-come,
 *   and with tasks running sequentially the first card could swallow the
 *   whole allowance while the other two return nothing.
 * - max_unique_results_per_run caps the WHOLE run at cards x 10. This is
 *   the spend ceiling, and it is not optional: `max_pages: 1` still means
 *   one *whole* page of Vinted results per task — around 96 listings — so
 *   without it three cards would spend ~288 results in a single run and
 *   blow a month's tier three times over on the first collection.
 *
 * max_pages stays 1 regardless: page one of a relevance-ordered, condition-
 * filtered search already holds far more than the ten rows the panel shows.
 */
const RESULTS_PER_CARD = 10; // keep in step with VINTED_RESULTS_PER_CARD in src/lib/lobstr.ts
const DEFAULT_TRACKED_CARDS = 3;

/**
 * Counts the Pokémon entries in card-refs.ts rather than hardcoding 3, so
 * adding a card and re-running `--settings` raises the cap automatically
 * instead of silently truncating the new card's results. Falls back to the
 * default if the file moves or its shape changes — a wrong-but-sane cap
 * beats crashing the one script that configures spend.
 */
function trackedPokemonCards() {
  try {
    const src = readFileSync(new URL("../src/data/card-refs.ts", import.meta.url), "utf8");
    const count = (src.match(/franchise:\s*"pokemon"/g) ?? []).length;
    return count > 0 ? count : DEFAULT_TRACKED_CARDS;
  } catch {
    return DEFAULT_TRACKED_CARDS;
  }
}

/**
 * Snake_case names inferred from the squid dashboard's own labels ("Max
 * pages", "Max Unique Results", "Max Results Per Task", "Slots"), matching
 * the convention of the three names Lobstr documents by name (max_pages,
 * max_unique_results_per_run, concurrency). Inferred, not confirmed — which
 * is exactly why applySettings below checks each one against
 * /v1/crawlers/<hash>/params before sending it, and says out loud which
 * ones it couldn't place instead of silently not applying a spend cap.
 */
function recommendedSettings(cards) {
  return {
    max_pages: 1,
    max_results_per_task: RESULTS_PER_CARD,
    max_unique_results_per_run: cards * RESULTS_PER_CARD,
    concurrency: 1, // the dashboard labels this "Slots"
  };
}

const apiKey = process.env.LOBSTR_API_KEY;
if (!apiKey) {
  console.error("LOBSTR_API_KEY is not set. Export it (or put it in .env.local and source it) before running this script.");
  process.exit(1);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Token ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${method} ${path} failed (${res.status}): ${text}`);
    process.exit(1);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Lobstr wraps collections differently per endpoint — same defensive unwrap as src/lib/lobstr.ts. */
function collection(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "results", "items", "records"]) {
    if (payload && Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

const me = await api("/me");
console.log("Account:", JSON.stringify(me, null, 2));

if (has("--create")) {
  const squid = await api("/squids", { method: "POST", body: { crawler: VINTED_PRODUCTS_CRAWLER } });
  const hash = squid.id ?? squid.hash;
  console.log("\nCreated squid:", JSON.stringify(squid, null, 2));
  console.log(`\n>>> Add this to Vercel (and .env.local):\n    LOBSTR_VINTED_SQUID=${hash}\n`);
  process.exit(0);
}

if (has("--params")) {
  const params = await api(`/crawlers/${VINTED_PRODUCTS_CRAWLER}/params`);
  console.log("\nVinted crawler params:", JSON.stringify(params, null, 2));
  process.exit(0);
}

/**
 * Pulls the settable parameter names for a crawler out of
 * /v1/crawlers/<hash>/params. The response shape isn't documented, so every
 * plausible one is handled: an array of strings, an array of objects with a
 * name/key/id field, or a plain object keyed by parameter name. Returns []
 * when nothing recognisable comes back, which the caller treats as "can't
 * verify" rather than "nothing is settable".
 */
async function settableParamNames() {
  const payload = await api(`/crawlers/${VINTED_PRODUCTS_CRAWLER}/params`);
  const items = collection(payload);
  if (items.length > 0) {
    const names = items
      .map((item) => (typeof item === "string" ? item : item?.name ?? item?.key ?? item?.id ?? item?.param))
      .filter((name) => typeof name === "string");
    if (names.length > 0) return names;
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return Object.keys(payload);
  return [];
}

if (has("--settings")) {
  const squidHash = process.env.LOBSTR_VINTED_SQUID;
  if (!squidHash) {
    console.error("LOBSTR_VINTED_SQUID is not set — run with --create first.");
    process.exit(1);
  }

  const cards = trackedPokemonCards();
  const desired = recommendedSettings(cards);

  // Check names against the crawler's own parameter list before sending
  // them. A misnamed key is the dangerous failure here: the PUT can quite
  // happily succeed while quietly ignoring the cap that was the whole point
  // of the call, and the first sign would be an exhausted month's tier.
  let known = [];
  try {
    known = await settableParamNames();
  } catch {
    console.log("Could not read /crawlers/<hash>/params — sending settings unverified.");
  }

  const unknownKeys = known.length > 0 ? Object.keys(desired).filter((key) => !known.includes(key)) : [];
  if (unknownKeys.length > 0) {
    console.log(`\nWARNING: this crawler does not list ${unknownKeys.join(", ")} as settable.`);
    console.log("Its real parameter names are:");
    console.log(known.map((name) => `  ${name}`).join("\n"));
    console.log("Fix recommendedSettings() to use the right names — an ignored cap is an uncapped run.\n");
  }

  const settings = await api(`/squids/${squidHash}`, { method: "PUT", body: desired }).then(() => desired);

  console.log(`\nTracked Pokémon cards: ${cards}`);
  console.log(`Per card: ${RESULTS_PER_CARD} (max_results_per_task) — an even split, not first-come.`);
  console.log(`Per run:  ${settings.max_unique_results_per_run} (max_unique_results_per_run) — the spend ceiling.`);
  console.log(`Per month at two collections: ${settings.max_unique_results_per_run * 2} results (free tier: 100).`);
  if (settings.max_unique_results_per_run * 2 > 100) {
    console.log("WARNING: that exceeds the 100/month free tier. Drop RESULTS_PER_CARD or the card count.");
  }
  console.log("\nApplied:", JSON.stringify(settings, null, 2));
  console.log("\nRe-run this after adding or removing a tracked card — the caps do not update themselves.");
  console.log(
    'Also check "When to end run" in the dashboard: "End run once all tasks consumed" is what this setup wants,\n' +
      'not the "End run once no credit left" default. Its API parameter name is not known — look for it in the list\n' +
      "printed by `node scripts/lobstr-setup.mjs --params` and add it to recommendedSettings()."
  );
  process.exit(0);
}

const sampleIndex = args.indexOf("--sample");
if (sampleIndex !== -1) {
  const runHash = args[sampleIndex + 1];
  if (!runHash) {
    console.error("--sample needs a run hash: node scripts/lobstr-setup.mjs --sample <run_hash>");
    process.exit(1);
  }
  const rows = collection(await api(`/results?run=${encodeURIComponent(runHash)}`));
  console.log(`\n${rows.length} result row(s) for run ${runHash}.`);
  if (rows.length > 0) {
    console.log("\nField names on the first row (compare against FIELD_ALIASES in src/lib/vinted-listings.ts):");
    console.log(Object.keys(rows[0]).join("\n"));
    console.log("\nFirst row in full:");
    console.log(JSON.stringify(rows[0], null, 2));

    // The condition field is the whole point of this integration — call out
    // what values actually appear, so "no très bon état listings" can be
    // told apart from "the condition field isn't named what we guessed".
    const conditionish = Object.keys(rows[0]).filter((key) => /status|condition|etat|état/i.test(key));
    if (conditionish.length > 0) {
      console.log("\nCondition-looking fields and their distinct values across all rows:");
      for (const key of conditionish) {
        const values = [...new Set(rows.map((row) => row[key]).filter((value) => value !== undefined && value !== null))];
        console.log(`  ${key}: ${JSON.stringify(values.slice(0, 12))}`);
      }
    } else {
      console.log("\nNo field name matched /status|condition|etat/ — check the full row above for how condition is expressed.");
    }
  }
  process.exit(0);
}

const crawlers = collection(await api("/crawlers"));
console.log(`\n${crawlers.length} crawler(s) available.`);
const vinted = crawlers.find((crawler) => (crawler.id ?? crawler.hash) === VINTED_PRODUCTS_CRAWLER);
console.log(
  vinted
    ? `Vinted Products Scraper found: ${JSON.stringify(vinted)}`
    : `Vinted Products Scraper hash ${VINTED_PRODUCTS_CRAWLER} not found in the list — check it against GET /v1/crawlers output above.`
);
console.log("\nNext: node scripts/lobstr-setup.mjs --create");
