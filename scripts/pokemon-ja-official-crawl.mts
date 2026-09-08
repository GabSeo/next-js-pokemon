#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Mirror the Japanese card data type-null/PTCG-database has scraped from the
 * official Pokemon site, into data/catalog/pokemon-ja-official/.
 *
 * WHY A FOURTH SOURCE. TCGdex publishes a Japanese catalogue and it is thin
 * where it matters most. Measured 2026-09-08 across our 12,781 Japanese cards:
 *
 *   3,882 (30%) carry an image, against 92% on the English side
 *   every Japanese card NAME is romanised — `Gengar Ex`, never `ゲンガーex`
 *
 * Both gaps break the scan specifically. Without an image a printing cannot be
 * ranked by artwork; without the Japanese name, the text Vision reads off a
 * Japanese card face matches nothing, so a card can only ever be resolved by
 * its printed number — and that number names several cards, which is how a
 * photographed Japanese Gengar ex became Team Rocket Porygon.
 *
 * This database fills 4,569 of the 8,899 missing images (51%) and carries the
 * real Japanese name for every record. Sampled 150 of the 4,330 it does NOT
 * cover: zero are on TCGdex's CDN either, so the two sources do not overlap on
 * the residual — this is strictly the better half, not a supplement.
 *
 * WHAT IS STILL MISSING AFTERWARDS, and it is honest to name it: 4,330 cards,
 * concentrated in the MEGA era (1,785), PCG (722), Pokemon-e (492), the 1996
 * originals (457) and neo (323). The official site's own search does not reach
 * back that far, so nobody scraping it can.
 *
 * ONE CLONE, NOT 22,000 REQUESTS. The data is 21,925 small JSON files. A shallow
 * clone takes it in a single transfer; walking the GitHub API instead would be
 * twenty-two thousand calls against someone's public repository for the same
 * bytes. The clone is removed afterwards unless it was already there.
 *
 * WE STORE POINTERS AND TEXT, NOT PICTURES. The `img` URL is recorded; the image
 * itself is fetched, resized and cached by app/api/pokemon-ja-image at request
 * time, the same arrangement app/api/one-piece-image has with Bandai. Copying
 * 4,569 official scans into this repository would be ~270 MB and a different
 * kind of claim over somebody else's artwork.
 *
 * ATTRIBUTION: the data originates with The Pokemon Company's official Japanese
 * card search. type-null/PTCG-database (MIT) is an independent project that
 * scrapes it and is not affiliated with them.
 *
 *   npm run catalog:pokemon-ja-official
 *   npx tsx scripts/pokemon-ja-official-crawl.mts --clone /path/to/existing/clone
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = "https://github.com/type-null/PTCG-database.git";

/**
 * Every Pokemon species name in English, in ONE request.
 *
 * WHY THIS IS NEEDED. TCGdex romanises SOME Japanese card names and not others
 * — `Gengar Ex` for PCG1-048, `ナゾノクサ` for SV4a-001 — so a Japanese card's
 * label was Japanese about half the time. The labels on this site are Latin;
 * the Japanese spelling belongs in the backend, where the scan reads it off a
 * photograph.
 *
 * The official data carries `pokedex_number`, which is the same integer in
 * every language, so the species name is a lookup rather than a translation.
 * PokeAPI answers all 1,025 of them in a single unauthenticated call, and the
 * result is stored beside the cards — nothing at request time touches it.
 *
 * A species name is not a card name: `リザードンex` is Charizard with a suffix.
 * The suffix is Latin on the card itself, so it is carried across from the
 * Japanese name rather than invented.
 */
const SPECIES_URL = "https://pokeapi.co/api/v2/pokemon-species/?limit=1100";
const OUT_DIR = path.join(process.cwd(), "data", "catalog", "pokemon-ja-official");

const args = process.argv.slice(2);
const provided = args.includes("--clone") ? args[args.indexOf("--clone") + 1] : undefined;

/** Only what we use, so a schema change upstream is visible rather than silently carried. */
type Attack = { cost?: string[]; damage?: { amount?: number | string } | null };

type Record_ = {
  jp_id?: number | string;
  name?: string;
  img?: string;
  set_name?: string;
  number?: string;
  set_total?: number;
  card_type?: string;
  url?: string;
  pokedex_number?: number;
  hp?: number | string;
  stage?: string;
  types?: string[];
  retreat?: number | string;
  attacks?: Attack[];
};

/**
 * The part of a card that does NOT change with the language.
 *
 * A Japanese card and its English print share a Pokedex number, a stage, an HP
 * value, a type, a retreat cost, and attacks with the same energy cost and the
 * same damage — everything except the words. Attack NAMES differ (`かえん` /
 * `Flamethrower`); their cost and damage do not.
 *
 * So this is the vocabulary in which a Japanese card can later be matched to
 * the English print somebody actually tracks, without translating anything.
 * That matching is deliberately NOT done here — it is the step after this one,
 * and it will be checked against a paid API rather than guessed. This just
 * makes sure the data it needs is on disk when it is written.
 *
 * Deliberately narrow: flavour text, attack effects, illustrator and the rest
 * of the record are dropped. They identify nothing across a language boundary
 * and would multiply the file for no gain.
 */
function fingerprint(record: Record_): Record<string, unknown> | undefined {
  const attacks = (record.attacks ?? [])
    .map((attack) => {
      const cost = (attack.cost ?? []).join("+");
      const amount = attack.damage?.amount;
      return `${cost}:${amount ?? ""}`;
    })
    .filter((entry) => entry !== ":");

  const out: Record<string, unknown> = {};
  if (typeof record.pokedex_number === "number") out.dex = record.pokedex_number;
  const hp = Number(record.hp);
  if (Number.isFinite(hp) && hp > 0) out.hp = hp;
  if (record.stage) out.stage = record.stage;
  if (record.types?.length) out.types = record.types;
  const retreat = Number(record.retreat);
  if (Number.isFinite(retreat)) out.retreat = retreat;
  if (attacks.length > 0) out.attacks = attacks;

  return Object.keys(out).length > 0 ? out : undefined;
}

function clone(): { dir: string; temporary: boolean } {
  if (provided) {
    if (!existsSync(provided)) {
      console.error(`[pokemon-ja] --clone ${provided} does not exist.`);
      process.exit(1);
    }
    return { dir: provided, temporary: false };
  }
  const dir = mkdtempSync(path.join(tmpdir(), "ptcg-"));
  console.log(`[pokemon-ja] shallow-cloning ${REPO}`);
  const result = spawnSync("git", ["clone", "--depth", "1", "--quiet", REPO, dir], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error("[pokemon-ja] clone failed.");
    process.exit(result.status ?? 1);
  }
  return { dir, temporary: true };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

/**
 * `(setId, number)` — the join our own catalogue can answer.
 *
 * Their files are named by the official site's internal id, which nothing else
 * we hold knows; `set_name` and `number` live INSIDE each record and use
 * TCGdex's own Japanese set ids. The number is zero-padded on one side and not
 * the other, so both are reduced to an integer — the same rule card-lookup.ts
 * applies for the same reason.
 */
function key(setId: string, number: string): string {
  const digits = Number(String(number).replace(/^0+/, "") || "0");
  return Number.isFinite(digits) && /^\d+$/.test(String(number)) ? `${setId}#${digits}` : `${setId}#${number}`;
}

/** `ex`, `EX`, `GX`, `V`, `VMAX`, `VSTAR`, `BREAK`, `LEGEND` — written in Latin even on a Japanese card. */
const SUFFIX = /(?:VMAX|VSTAR|V-UNION|BREAK|LEGEND|GX|EX|ex|V)/g;

async function speciesNames(): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  try {
    const response = await fetch(SPECIES_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    const parsed = (await response.json()) as { results?: { name?: string }[] };
    (parsed.results ?? []).forEach((entry, index) => {
      const slug = entry.name;
      if (!slug) return;
      // `mr-mime` -> `Mr Mime`, `nidoran-f` -> `Nidoran F`.
      const title = slug
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      names.set(index + 1, title);
    });
  } catch (error) {
    // Optional: without it a Japanese card keeps whatever TCGdex spells it,
    // which is the behaviour before this existed rather than a failure.
    console.warn(`[pokemon-ja] species names unavailable (${error}) — labels fall back to TCGdex.`);
  }
  return names;
}

/** The card's English label: the species, plus the Latin suffix the Japanese name already carries. */
function englishLabel(record: Record_, species: Map<number, string>): string | undefined {
  const dex = record.pokedex_number;
  if (typeof dex !== "number") return undefined;
  const base = species.get(dex);
  if (!base) return undefined;
  const suffixes = [...new Set((record.name ?? "").match(SUFFIX) ?? [])];
  return suffixes.length > 0 ? `${base} ${suffixes.join(" ")}` : base;
}

const started = Date.now();
const species = await speciesNames();
const { dir, temporary } = clone();

try {
  const root = path.join(dir, "data_jp");
  if (!existsSync(root)) {
    console.error(`[pokemon-ja] no data_jp/ in ${dir}`);
    process.exit(1);
  }

  const files = walk(root);
  const cards: Record<
    string,
    {
      jpId: string;
      name: string;
      en?: string;
      img: string;
      total?: number;
      url?: string;
      fp?: Record<string, unknown>;
    }
  > = {};
  let skipped = 0;

  for (const file of files) {
    let record: Record_;
    try {
      record = JSON.parse(readFileSync(file, "utf8")) as Record_;
    } catch {
      skipped++;
      continue;
    }
    const { set_name: setName, number, img, name, jp_id: jpId } = record;
    if (!setName || !number || !img || !name) {
      skipped++;
      continue;
    }
    const id = key(setName, String(number));
    // First writer wins: a set can list the same number twice for a promo
    // reprint, and there is nothing here to tell them apart.
    if (cards[id]) continue;
    cards[id] = {
      jpId: String(jpId ?? ""),
      name,
      en: englishLabel(record, species),
      img,
      total: record.set_total && record.set_total > 0 ? record.set_total : undefined,
      url: record.url,
      fp: fingerprint(record),
    };
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify({
      crawledAt: new Date().toISOString(),
      source: REPO,
      note: "Data originates with The Pokemon Company's official Japanese card search; PTCG-database (MIT) mirrors it and is not affiliated with them.",
      cards,
    })
  );

  const count = Object.keys(cards).length;
  const fingerprinted = Object.values(cards).filter((card) => card.fp).length;
  const labelled = Object.values(cards).filter((card) => card.en).length;
  console.log(
    `[pokemon-ja] ${files.length} records read, ${count} keyed by (set, number), ${skipped} incomplete, ` +
      `${fingerprinted} with a cross-language fingerprint, ${labelled} with an English label — ` +
      `${((Date.now() - started) / 1000).toFixed(0)}s`
  );
} finally {
  if (temporary) rmSync(dir, { recursive: true, force: true });
}
