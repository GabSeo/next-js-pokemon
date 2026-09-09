#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Which Japanese set an English set came from, learned from Limitless.
 *
 * THE PROBLEM. A Pokemon card exists twice — printed in Japan first, then
 * internationally — and nothing in our catalogue connects the two. Scan a
 * Japanese Umbreon and we can tell you it is `S12-110`; we cannot tell you it
 * is the card the English world calls Lost Origin 154, which is the answer a
 * person actually wants. TCGdex does not carry the relationship. The official
 * Japanese site has no reason to.
 *
 * WHAT LIMITLESS HAS. Every card page lists that card's OTHER printings, split
 * into `Int. Prints` and `JP. Prints`. Crown Zenith GG68 names four Japanese
 * ones: S10D 49, 82 and 86, and S12a 101. That is the bridge, at card level,
 * maintained by someone else and already correct.
 *
 * WHY THIS SAMPLES RATHER THAN CRAWLS EVERYTHING. The card-level bridge is
 * 20,315 English pages. At a polite rate that is twenty minutes of continuous
 * requests against somebody's site to build a table whose USEFUL content is
 * mostly set-level: cards in Brilliant Stars come from S9, cards in Crown
 * Zenith from S12a, and the exceptions are promos. So this asks a handful of
 * cards per set which Japanese sets their siblings live in, and keeps the
 * answer as a weighted set-to-set mapping — 760 requests instead of 20,315, for
 * the relationship that generalises.
 *
 * WHAT IT DELIBERATELY DOES NOT PRODUCE: a card-to-card table. A set mapping
 * cannot tell you WHICH Japanese card an English one is, only which sets to
 * look in, and pretending otherwise would be the confident-lie failure this
 * codebase keeps running into. Narrowing within a set is the artwork's job, and
 * the artwork index already exists.
 *
 *   npx tsx scripts/limitless-bridge.mts
 *   npx tsx scripts/limitless-bridge.mts --per-set 8
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { limitlessSets } from "../src/lib/limitless";

const OUT = path.join(process.cwd(), "data", "catalog", "limitless", "bridge.json");
const ORIGIN = "https://limitlesstcg.com";
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const perSet = args.includes("--per-set") ? Number(args[args.indexOf("--per-set") + 1]) || 5 : 5;

/**
 * The `JP. Prints` block, and only it.
 *
 * A card page carries two tables of sibling printings and they are separated by
 * a `<th>JP. Prints</th>` heading — everything before it is international, so
 * scanning the whole page for `/cards/jp/` links would also pick up navigation
 * and be wrong in a way that still returns plausible set codes.
 */
function japaneseSetsOn(html: string): string[] {
  const start = html.indexOf("JP. Prints");
  if (start < 0) return [];
  const codes: string[] = [];
  for (const match of html.slice(start).matchAll(/href="\/cards\/jp\/([A-Za-z0-9.\-]+)\/[A-Za-z0-9]+"/g)) {
    codes.push(match[1]);
  }
  return codes;
}

async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        await worker(items[index]);
      }
    })
  );
}

const english = limitlessSets("en");
if (english.length === 0) {
  console.error("[bridge] no English mirror — run npm run catalog:limitless first");
  process.exit(1);
}

/** `EN code` -> `JP code` -> how many sampled cards pointed there. */
const votes = new Map<string, Map<string, number>>();
const sampled = new Map<string, number>();

const work: { code: string; number: string }[] = [];
for (const set of english) {
  const numbers = Object.keys(set.cards);
  if (numbers.length === 0) continue;
  // Spread through the set: the first cards of a set are commons, and a promo
  // set's first entries are often the least representative thing in it.
  const step = Math.max(1, Math.floor(numbers.length / perSet));
  for (const number of numbers.filter((_, i) => i % step === 0).slice(0, perSet)) {
    work.push({ code: set.code, number });
  }
}

console.log(`[bridge] ${english.length} English sets, sampling ${work.length} cards`);

let done = 0;
const started = Date.now();

await pooled(work, CONCURRENCY, async ({ code, number }) => {
  try {
    const response = await fetch(`${ORIGIN}/cards/${code}/${number}`, {
      headers: { "User-Agent": "pokecard-shop catalogue crawler (+https://github.com/GabSeo/next-js-pokemon)" },
    });
    if (response.ok) {
      sampled.set(code, (sampled.get(code) ?? 0) + 1);
      const tally = votes.get(code) ?? new Map<string, number>();
      // A card reprinted three times in one Japanese set should not outvote a
      // set that appears once — the question is WHICH SETS, not how often.
      for (const jp of new Set(japaneseSetsOn(await response.text()))) {
        tally.set(jp, (tally.get(jp) ?? 0) + 1);
      }
      votes.set(code, tally);
    }
  } catch {
    // one unreachable page does not decide a set
  }
  if (++done % 100 === 0) console.log(`[bridge]   ${done}/${work.length}…`);
});

/**
 * THE RAW TALLY IS WHAT GETS WRITTEN, not a filtered conclusion.
 *
 * The first version stored only sets clearing a 0.4 share, and every later
 * question about the threshold would have cost another 760 requests to answer.
 * Interpretation is cheap and re-crawling somebody else's site is not, so the
 * counts go to disk and the rule lives in lib/limitless-bridge.ts.
 */
type BridgeRow = {
  /** `JP code` -> how many of the sampled cards had a printing there. */
  votes: Record<string, number>;
  sampled: number;
  /**
   * `expansion`  the set has a Japanese origin — one or two sets account for it
   * `compilation` the set is reprints from everywhere, and no origin exists to
   *               find. Recorded rather than dropped: "this question has no
   *               answer" is a different fact from "we did not look".
   */
  kind: "expansion" | "compilation" | "unknown";
  /** The single Japanese set this one came from, where there is one. */
  origin?: string;
};

const bridge: Record<string, BridgeRow> = {};
let expansions = 0;
let compilations = 0;

for (const [code, tally] of votes) {
  const sampledHere = sampled.get(code) ?? 0;
  if (sampledHere === 0) continue;

  const ranked = [...tally.entries()]
    .map(([jp, count]) => ({ code: jp, share: count / sampledHere }))
    .sort((a, b) => b.share - a.share);

  const strong = ranked.filter((row) => row.share >= 0.4);

  // A SET THAT POINTS EVERYWHERE POINTS NOWHERE. `MEE`, the Eevee ex starter,
  // names 39 Japanese sets at full share — not because it descends from all of
  // them but because it reprints cards that were printed everywhere. Above a
  // handful, the honest reading is that this set has no single origin.
  const kind = strong.length === 0 ? "unknown" : strong.length <= 3 ? "expansion" : "compilation";
  if (kind === "expansion") expansions++;
  if (kind === "compilation") compilations++;

  bridge[code] = {
    votes: Object.fromEntries(tally),
    sampled: sampledHere,
    kind,
    origin: kind === "expansion" && strong[0].share >= 0.6 ? strong[0].code : undefined,
  };
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ builtAt: new Date().toISOString(), perSet, source: `${ORIGIN}/cards`, sets: bridge })
);

console.log(
  `\n[bridge] ${english.length} English sets: ${expansions} with a Japanese origin, ` +
    `${compilations} reprint compilations, ${english.length - expansions - compilations} with no Japanese data, ` +
    `${((Date.now() - started) / 1000).toFixed(0)}s`
);
for (const [code, row] of Object.entries(bridge)) {
  if (row.kind !== "expansion") continue;
  const top = Object.entries(row.votes)
    .sort((a, b) => b[1] - a[1])
    .filter(([, n]) => n / row.sampled >= 0.4)
    .map(([jp, n]) => `${jp} (${(n / row.sampled).toFixed(1)})`);
  console.log(`  ${code.padEnd(6)} -> ${top.join(", ")}`);
}
