#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Crawls the OFFICIAL One Piece card list into `data/catalog/one-piece-official/`.
 *
 * WHY A SECOND ONE PIECE CATALOGUE. `scripts/one-piece-crawl.mts` reads
 * BerryWallet, which is the same host we buy prices from and is metered at 100
 * calls/hour. Using it for data that never changes — a card's name, rarity,
 * colour, effect text — spends the only quota that matters on the only thing
 * that does not move. This crawl exists to take that load off it entirely.
 *
 * WHERE THE DATA COMES FROM, and why we do not scrape. Bandai publishes the
 * authoritative card list at onepiece-cardgame.com, but it is HTML on the
 * rights holder's own site. `punk-records` already scrapes it, on a schedule,
 * and publishes static versioned JSON on GitHub. We read that: a git
 * dependency rather than a scraper of ours pointed at Bandai. If it stops being
 * updated we still hold the last snapshot and can pin a commit — which this
 * script records, so a crawl is reproducible.
 *
 *   https://github.com/buhbbl/punk-records   (data)
 *   https://github.com/Coko7/vegapull        (the scraper behind it)
 *
 * The card data itself remains Bandai/Shueisha's. This stores the factual
 * fields a price tracker needs; it is not a place to republish artwork.
 *
 * WHAT IT GIVES US THAT BERRYWALLET DOES NOT:
 *
 *   - Japanese RARITY. All 3,644 of our BerryWallet JP rows carry none.
 *   - Real localised names — モンキー・D・ルフィ, not a romanisation.
 *   - The PACK each printing belongs to, in every language. That is the
 *     product axis, which lib/one-piece-variants.ts currently reconstructs
 *     from parentheticals in a name string.
 *   - Rules text, colour, cost, power, counter, attributes, types, keywords —
 *     none of which we hold today, in any language.
 *   - French, which BerryWallet has zero sets for, so One Piece's FR toggle
 *     has never been able to show anything real.
 *
 * WHAT IT DOES NOT REPLACE: Cardmarket and TCGplayer product URLs, and prices.
 * Those stay on BerryWallet, which is where its quota should have been going
 * all along.
 *
 * ONE FILE PER PACK PER LANGUAGE — punk-records publishes `data/{pack}.json`
 * bundles, so a full crawl is ~160 requests rather than one per card. Free and
 * unmetered either way; this just makes a re-crawl take seconds.
 *
 * Usage:
 *
 *   npx tsx scripts/one-piece-official-crawl.mts
 *   npx tsx scripts/one-piece-official-crawl.mts --lang japanese
 *   npx tsx scripts/one-piece-official-crawl.mts --all-languages   # + zh/th
 *   npx tsx scripts/one-piece-official-crawl.mts --force
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO = "buhbbl/punk-records";
const RAW = `https://raw.githubusercontent.com/${REPO}`;
const OUT_DIR = path.join(process.cwd(), "data", "catalog", "one-piece-official");

/**
 * The three the product actually renders. The dataset also carries
 * english-asia, chinese-hongkong, chinese-taiwan and thai; `--all-languages`
 * pulls those too, at roughly 5 MB each, which is why they are not the default.
 */
const DEFAULT_LANGUAGES = ["english", "japanese", "french"];
const EXTRA_LANGUAGES = ["english-asia", "chinese-hongkong", "chinese-taiwan", "thai"];

type PunkCard = {
  id: string;
  pack_id: string;
  name: string;
  rarity: string | null;
  category: string | null;
  colors: string[] | null;
  cost: number | null;
  power: number | null;
  counter: number | null;
  block_number: number | null;
  attributes: string[] | null;
  types: string[] | null;
  effect: string | null;
  trigger: string | null;
  img_url: string | null;
  img_full_url: string | null;
};

type PunkPack = {
  id: string;
  raw_title: string;
  title_parts?: { label: string | null; prefix: string | null; title: string | null };
};

/** One pack, as we store it. Same discipline as the other catalogues: no prices. */
type OfficialPackFile = {
  crawledAt: string;
  /** The punk-records commit this came from, so a crawl is reproducible. */
  sourceCommit: string;
  language: string;
  pack: { id: string; label?: string; prefix?: string; title: string; rawTitle: string };
  cards: PunkCard[];
};

const args = process.argv.slice(2);
const only = args.includes("--lang") ? [args[args.indexOf("--lang") + 1]] : undefined;
const languages = only ?? (args.includes("--all-languages") ? [...DEFAULT_LANGUAGES, ...EXTRA_LANGUAGES] : DEFAULT_LANGUAGES);
const force = args.includes("--force");

function fileFor(lang: string, packId: string): string {
  return path.join(OUT_DIR, `${lang}__${packId}.json`);
}

async function getJson<T>(url: string): Promise<T | undefined> {
  const res = await fetch(url);
  if (!res.ok) return undefined;
  return (await res.json()) as T;
}

/** punk-records publishes some files as arrays and some as objects; normalise. */
function asList<T>(raw: unknown): T[] {
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>)) as T[];
}

async function headCommit(): Promise<string> {
  const commits = await getJson<{ sha: string }[]>(`https://api.github.com/repos/${REPO}/commits?per_page=1`);
  return commits?.[0]?.sha?.slice(0, 12) ?? "unknown";
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const sourceCommit = await headCommit();
  console.log(`[official] source ${REPO} @ ${sourceCommit}`);

  let written = 0;
  let skipped = 0;
  let cards = 0;
  let requests = 1;

  for (const language of languages) {
    const packs = asList<PunkPack>(await getJson(`${RAW}/main/${language}/packs.json`));
    requests++;
    if (packs.length === 0) {
      console.log(`[official] ${language}: no packs — skipping (is the language name right?)`);
      continue;
    }
    console.log(`\n[official] ${language}: ${packs.length} packs`);

    for (const [i, pack] of packs.entries()) {
      const target = fileFor(language, pack.id);
      if (!force && existsSync(target)) {
        skipped++;
        continue;
      }
      const bundle = asList<PunkCard>(await getJson(`${RAW}/main/${language}/data/${pack.id}.json`));
      requests++;
      if (bundle.length === 0) {
        console.warn(`[official] ${language} ${pack.id}: empty bundle, skipped`);
        continue;
      }
      const file: OfficialPackFile = {
        crawledAt: new Date().toISOString(),
        sourceCommit,
        language,
        pack: {
          id: pack.id,
          label: pack.title_parts?.label ?? undefined,
          prefix: pack.title_parts?.prefix ?? undefined,
          title: pack.title_parts?.title ?? pack.raw_title,
          rawTitle: pack.raw_title,
        },
        cards: bundle,
      };
      writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      written++;
      cards += bundle.length;
      const label = (pack.title_parts?.label ?? pack.id).padEnd(10);
      console.log(`[official] ${language} ${String(i + 1).padStart(3)}/${packs.length}  ${label} ${bundle.length} cards`);
    }
  }

  const held = readdirSync(OUT_DIR).filter((f) => f.endsWith(".json")).length;
  console.log(
    `\n[official] ${written} pack file(s) written, ${skipped} already held, ${cards} cards this run; ` +
      `${held} files on disk, ~${requests} request(s) spent (all unmetered).`
  );
  console.log(`[official] output: ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
