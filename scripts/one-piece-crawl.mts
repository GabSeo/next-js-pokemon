#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Crawls BerryWallet's One Piece catalogue into `data/catalog/one-piece/` and
 * `data/prices/one-piece.json` — the One Piece counterpart to
 * scripts/catalog-crawl.mts, and deliberately NOT a copy of it.
 *
 * WHY THE SHAPE DIFFERS FROM POKÉMON
 *
 * TCGdex needed one request PER CARD, because its set endpoint returns briefs
 * with no rarity and no marketplace ids — 23,546 requests, affordable only
 * because that host is free and unmetered.
 *
 * BerryWallet is the opposite on both counts. `getSetCards` returns FULL rows
 * — identity, TCGplayer and Cardmarket blocks together — so the crawl is per
 * SET, not per card: 109 sets (77 en + 32 jp), most in a single call since
 * PAGE_SIZE is 200. Call it ~130-150 requests for the entire catalogue in both
 * languages. But it is metered at 100/hour (our ceiling 90), which is the
 * tightest quota in this system, so that ~150 does not fit in one window and
 * this script is built to be run across several.
 *
 * ONE PASS, TWO ARTIFACTS. Identity and prices arrive in the same response, so
 * splitting them into two crawls would double the only cost that matters here.
 * They are still written to two files, for the same reason as Pokémon: identity
 * is stable and its diff should be readable, prices churn and carry a date.
 *
 * RESUMABLE, BECAUSE IT HAS TO BE. Each set writes its own file and a set
 * already on disk is skipped, so a run that exhausts the hourly budget can be
 * re-run next hour and continue. The budget ceiling in lib/api-budget.ts throws
 * rather than silently degrading, and that throw is caught here and reported as
 * "resume later" instead of a stack trace — an exhausted quota is the EXPECTED
 * end of a run, not a failure.
 *
 * WHAT THIS UNLOCKS, beyond making One Piece pages fast the way Pokémon's are:
 *
 *   - Every row is stored WITH its set, which BerryWalletCard does not carry.
 *     findVariantAcrossProducts currently reports the set of ORIGIN for a
 *     cross-product match, which is why a PRB-01 reprint cannot say "PRB" — the
 *     corpus makes the real containing set knowable offline.
 *   - Every row sharing a card_number is available without a request, which is
 *     what a derived eBay query needs: the wanted treatment and the COMPETING
 *     treatments both come from that list (see docs/ebay-market-pipeline.md).
 *
 * Usage:
 *
 *   npx tsx scripts/one-piece-crawl.mts                 # both languages, resumable
 *   npx tsx scripts/one-piece-crawl.mts --lang en       # one language
 *   npx tsx scripts/one-piece-crawl.mts --max-calls 60  # stop short of the ceiling
 *   npx tsx scripts/one-piece-crawl.mts --force         # re-fetch sets already held
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

const { getSets, getSetCards } = await import("../src/lib/berrywallet");
type Lang = "en" | "jp";

const CATALOG_DIR = path.join(process.cwd(), "data", "catalog", "one-piece");
const PRICES_FILE = path.join(process.cwd(), "data", "prices", "one-piece.json");

/** One printing as the corpus stores it. Prices live in the price file, not here. */
type OpCard = {
  id: string;
  cardNumber: string;
  /** BerryWallet's raw product name — the treatment lives in its parentheticals. */
  name: string;
  rarity?: string;
  /** The (V.N) index, when the row carries one. A PER-SET index, never an identifier. */
  variantIndex?: number;
  /** Cardmarket product slug + url, the join key findCardmarketSiblings uses. */
  cardmarketUrl?: string;
  cardmarketProductName?: string;
  /** Rows sharing a TCGplayer product are the same physical card — the corpus keeps the link. */
  tcgplayerUrl?: string;
};

type OpSetFile = {
  crawledAt: string;
  language: Lang;
  set: { code: string; name: string };
  cards: OpCard[];
};

type OpPriceEntry = {
  tcgplayer?: { low?: number; mid?: number; high?: number; market?: number };
  cardmarket?: { avg?: number; low?: number; trend?: number; avg1?: number; avg7?: number; avg30?: number };
};

const args = process.argv.slice(2);
const only = args.includes("--lang") ? (args[args.indexOf("--lang") + 1] as Lang) : undefined;
const force = args.includes("--force");
const maxCalls = args.includes("--max-calls") ? Number(args[args.indexOf("--max-calls") + 1]) : Infinity;

function fileFor(lang: Lang, setCode: string): string {
  return path.join(CATALOG_DIR, `${lang}__${encodeURIComponent(setCode)}.json`);
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && v !== 0 ? v : undefined;
}

/** The `(V.N)` a row carries, read the same way lib/berrywallet.ts's variantIndex does. */
function variantIndexOf(name: string, productName?: string): number | undefined {
  const m = (productName ?? name).match(/\(V\.(\d+)\)/);
  return m ? Number(m[1]) : undefined;
}

async function main() {
  mkdirSync(CATALOG_DIR, { recursive: true });
  mkdirSync(path.dirname(PRICES_FILE), { recursive: true });

  const languages: Lang[] = only ? [only] : ["en", "jp"];
  let calls = 0;
  let crawled = 0;
  let skipped = 0;
  let cards = 0;
  let stoppedEarly = false;
  const collectedPrices: Record<string, OpPriceEntry> = {};

  for (const lang of languages) {
    if (stoppedEarly) break;
    const sets = await getSets(lang);
    calls++;
    console.log(`\n[one-piece] ${lang}: ${sets.length} sets`);

    for (const [i, set] of sets.entries()) {
      const target = fileFor(lang, set.set_code);
      if (!force && existsSync(target)) {
        skipped++;
        continue;
      }
      if (calls >= maxCalls) {
        stoppedEarly = true;
        console.log(`\n[one-piece] reached --max-calls ${maxCalls}; re-run to continue.`);
        break;
      }

      try {
        const rows = await getSetCards(set.set_code, { allPages: true });
        calls++;
        const file: OpSetFile = {
          crawledAt: new Date().toISOString(),
          language: lang,
          set: { code: set.set_code, name: set.name },
          cards: rows.map((c) => ({
            id: c.id,
            cardNumber: c.card_number,
            name: c.name,
            rarity: c.rarity ?? undefined,
            variantIndex: variantIndexOf(c.name, c.cardmarket?.product_name),
            cardmarketUrl: c.cardmarket?.product_url ?? undefined,
            cardmarketProductName: c.cardmarket?.product_name ?? undefined,
            tcgplayerUrl: c.tcgplayer?.url ?? undefined,
          })),
        };
        // Prices are captured HERE, from the rows just fetched — the corpus
        // deliberately does not store them, so this is the only moment they
        // are in hand. See the merge below for why they accumulate.
        for (const c of rows) {
          const tp = c.tcgplayer?.prices;
          const cm = c.cardmarket?.prices;
          const entry: OpPriceEntry = {
            tcgplayer: tp && { low: num(tp.low_price), mid: num(tp.mid_price), high: num(tp.high_price), market: num(tp.market_price) },
            cardmarket: cm && { avg: num(cm.avg), low: num(cm.low), trend: num(cm.trend), avg1: num(cm.avg1), avg7: num(cm.avg7), avg30: num(cm.avg30) },
          };
          const hasAny =
            Object.values(entry.tcgplayer ?? {}).some((v) => typeof v === "number") ||
            Object.values(entry.cardmarket ?? {}).some((v) => typeof v === "number");
          if (hasAny) collectedPrices[c.id] = entry;
        }
        writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, "utf8");
        crawled++;
        cards += rows.length;
        console.log(`[one-piece] ${lang} ${String(i + 1).padStart(3)}/${sets.length}  ${set.set_code.padEnd(20)} ${rows.length} cards`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // An exhausted hourly budget is the EXPECTED end of a run, not a crash.
        if (/budget|429|rate/i.test(msg)) {
          stoppedEarly = true;
          console.log(`\n[one-piece] quota reached at ${set.set_code} — progress is saved, re-run next hour to continue.`);
          break;
        }
        console.error(`[one-piece] ${set.set_code} FAILED: ${msg}`);
      }
    }
  }

  // ---- price file ----
  // ACCUMULATED, not rebuilt. Prices arrive with the rows during the crawl and
  // the corpus deliberately does not store them, so a resumed run can only
  // contribute the sets IT fetched — rebuilding from disk would throw away
  // every price collected in an earlier window. Existing entries are therefore
  // loaded first and updated in place.
  const existing: { generatedAt?: string; cards?: Record<string, OpPriceEntry> } = existsSync(PRICES_FILE)
    ? (JSON.parse(readFileSync(PRICES_FILE, "utf8")) as { generatedAt?: string; cards?: Record<string, OpPriceEntry> })
    : {};
  const merged = { ...(existing.cards ?? {}), ...collectedPrices };
  writeFileSync(
    PRICES_FILE,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), source: "api.pokewallet.io/op", cards: merged })}
`,
    "utf8"
  );
  console.log(`[one-piece] prices: ${Object.keys(merged).length} rows (${Object.keys(collectedPrices).length} from this run)`);

  console.log(
    `\n[one-piece] ${crawled} set(s) crawled, ${skipped} already held, ${cards} cards, ~${calls} call(s) spent` +
      (stoppedEarly ? " — INCOMPLETE, re-run to continue" : "")
  );
  console.log(`[one-piece] output: ${path.relative(process.cwd(), CATALOG_DIR)}`);

  await reportUnknownVocabulary();
}

/**
 * Names every product family on disk that data/one-piece-sets.ts does not know.
 *
 * This is the only part of the eBay query model that does not derive itself. A
 * card, a printing, a promo product — all of those come out of the row names
 * this crawl just wrote, and need no hand-editing ever. A new SET does: the
 * short word sellers write for it is marketplace vocabulary, not something the
 * catalogue records, so it lives in a table.
 *
 * The danger is silence rather than effort. An unknown family contributes no
 * exclusion and nothing complains, so a query quietly stops separating one of
 * the products its code was printed in. One line of output at the end of a
 * crawl is what turns that into a five-second edit.
 */
async function reportUnknownVocabulary() {
  const { opSetFamily, opRowsForCode } = await import("../src/lib/one-piece-catalog");
  const { productOf } = await import("../src/lib/one-piece-variants");
  const { OP_SET_VOCABULARY, OP_PRODUCT_VOCABULARY } = await import("../src/data/one-piece-sets");
  const { cardRefs } = await import("../src/data/card-refs");

  const known = new Set(Object.keys(OP_SET_VOCABULARY));
  const unknown = new Map<string, string[]>();
  for (const file of readdirSync(CATALOG_DIR)) {
    if (!file.endsWith(".json")) continue;
    let parsed: OpSetFile;
    try {
      parsed = JSON.parse(readFileSync(path.join(CATALOG_DIR, file), "utf8")) as OpSetFile;
    } catch {
      continue;
    }
    const family = opSetFamily(parsed.set.code).toUpperCase();
    if (known.has(family)) continue;
    unknown.set(family, [...(unknown.get(family) ?? []), `${parsed.set.code} = ${parsed.set.name}`]);
  }

  // Products are only checked against TRACKED codes: 405 exist, 249 could ever
  // generate a term, and a query only ever needs the handful printed on a code
  // this site actually resolves. Six cover the nine cards tracked today.
  const unknownProducts = new Map<string, string[]>();
  for (const ref of cardRefs) {
    if (ref.franchise !== "one-piece" || ref.lookup.by !== "code") continue;
    for (const row of opRowsForCode(ref.lookup.code)) {
      const product = productOf(row.card.name);
      if (!product || product in OP_PRODUCT_VOCABULARY) continue;
      unknownProducts.set(product, [...(unknownProducts.get(product) ?? []), ref.slug]);
    }
  }

  if (unknownProducts.size > 0) {
    console.log(
      `
[one-piece] ${unknownProducts.size} product(s) on tracked codes are NOT in` +
        ` src/data/one-piece-sets.ts. Those printings cannot be told apart until they are added.`
    );
    for (const [product, slugs] of unknownProducts) {
      console.log(`  "${product}"  on ${[...new Set(slugs)].join(", ")}`);
    }
  }

  if (unknown.size === 0) {
    console.log(
      `[one-piece] vocabulary: all ${known.size} set families known` +
        (unknownProducts.size === 0 ? `, all products on tracked codes known` : "")
    );
    return;
  }
  console.log(
    `\n[one-piece] ${unknown.size} product family/families are NOT in src/data/one-piece-sets.ts.` +
      ` Queries cannot exclude them until they are added — see that file's header for what` +
      ` \`exclude\` should be, and null for a catalogue bucket or a deck.`
  );
  for (const [family, sets] of unknown) {
    console.log(`  ${family.padEnd(8)} ${sets.slice(0, 3).join(" | ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
