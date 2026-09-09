#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Mirror Limitless TCG's card index, both languages.
 *
 * WHY THIS EXISTS. 5,986 of our 44,985 Pokemon cards have no picture anywhere
 * in the corpus — 1,558 English and 4,428 Japanese — and a card with no picture
 * cannot be embedded, cannot be signed, and therefore cannot be scanned. It is
 * invisible to the feature this whole project is for. TCGdex does not have
 * those pictures and the official Japanese site does not either.
 *
 * Limitless does, for about half of them. Measured before this was written:
 *
 *   MC   Starter Decks 100 Battle Collection   774 cards, all pictured
 *   M2a  Mega Dream ex                         250
 *   M2..M6 and M-P                             ~700 between them
 *   CRZ  GG68, the Dialga our scan cannot find  present, 176 KB
 *
 * WHAT IT IS NOT. Limitless is NOT a replacement backbone for Japanese, which
 * was the obvious hypothesis and is wrong: their Japanese index holds 262 sets
 * and 19,831 cards against our 341 and 23,919. They begin at the HS/BW era, so
 * everything from 1996 to 2010 — VS, neo, e-Card JP, PCG, PMCG, ADV — is ours
 * alone. Swapping to them would lose 2,184 cards to gain pictures for 2,006.
 *
 * So this is a supplement, and the crawl is deliberately dumb about identity:
 * it records what Limitless has under Limitless's own codes and leaves the
 * matching to lib/limitless.ts, where the rule can improve without re-crawling
 * 414 pages to try it.
 *
 * ONE REQUEST PER SET, NOT PER CARD. A set page carries every card's thumbnail
 * URL — `/cards/jp/MC` returns all 774 in a single 192 KB response. That is 414
 * requests for the whole index instead of 40,000, which is the difference
 * between a polite crawl and an abusive one. Their robots.txt allows
 * everything; that is permission, not an invitation to hammer.
 *
 * NO IMAGES ARE DOWNLOADED HERE. This writes URLs. The embedding and signature
 * scripts fetch the ones they actually need.
 *
 *   npm run catalog:limitless
 *   npx tsx scripts/limitless-crawl.mts --languages jp
 *   npx tsx scripts/limitless-crawl.mts --sets MC,M2a --force
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "data", "catalog", "limitless");
const ORIGIN = "https://limitlesstcg.com";

/** Gentle on purpose. 414 pages at four at a time is a couple of minutes. */
const CONCURRENCY = 4;

/**
 * Their two catalogues. `jp` is a path segment on the site; the image CDN uses
 * `tpc` for Japan and `tpci` for the international arm. Both appear only in
 * URLs we parse rather than build, but the split is worth naming — it is the
 * one thing separating a Japanese image URL from an English one.
 */
const CATALOGUES = [
  { language: "en" as const, indexPath: "/cards" },
  { language: "jp" as const, indexPath: "/cards/jp" },
];

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlySets = args.includes("--sets") ? new Set(args[args.indexOf("--sets") + 1]?.split(",")) : undefined;
const onlyLanguages = args.includes("--languages")
  ? new Set(args[args.indexOf("--languages") + 1]?.split(","))
  : undefined;

type LimitlessSet = {
  code: string;
  /** Their English name — for a Japanese set, the Latin label we otherwise have to invent. */
  name: string;
  releaseDate?: string;
  cardCount?: number;
  /**
   * Their set symbol, ~1.5 KB.
   *
   * Worth capturing because TCGdex publishes a logo for 146 of 203 English sets
   * and ZERO of 381 Japanese ones — so every Japanese tile on the browse page
   * falls back to a lettered square. This is a symbol rather than a wordmark,
   * which is a smaller thing than the English logo, but it is the set's own
   * mark instead of its initials.
   */
  symbol?: string;
  /** `localId` -> thumbnail URL, exactly as the set page gives it. */
  cards: Record<string, string>;
};

type CatalogueFile = { crawledAt: string; source: string; language: string; sets: LimitlessSet[] };

async function fetchText(url: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          // Identify ourselves. A crawler that hides is a crawler nobody can
          // ask to slow down.
          "User-Agent": "pokecard-shop catalogue crawler (+https://github.com/GabSeo/next-js-pokemon)",
          Accept: "text/html",
        },
      });
      if (response.ok) return await response.text();
      // 404 is an answer, not a failure worth retrying.
      if (response.status === 404) return undefined;
    } catch {
      // fall through to the retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return undefined;
}

/**
 * HTML entities, decoded — because this is scraped markup, not text.
 *
 * Stripping tags is not the same as decoding, and forgetting the second step
 * stored 47 set names with the escape still in them: `Sword &amp; Shield`,
 * `Champion&#039;s Path`. Those went straight into a dropdown, where they were
 * visible to anyone reading and invisible to any test that only counted rows.
 *
 * A small explicit table rather than a DOM parse: five entities cover every
 * name on both indexes, and the numeric form catches the rest.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // LAST, ALWAYS. Decoding `&amp;` first would turn `&amp;lt;` into `<`.
    .replace(/&amp;/g, "&");
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

/** `19 Dec 25` -> `2025-12-19`, so it sorts like every other date we hold. */
function isoDate(text: string): string | undefined {
  const parts = text.match(/(\d{1,2}) ([A-Za-z]{3}) (\d{2})/);
  if (!parts) return undefined;
  const month = MONTHS.indexOf(parts[2].toLowerCase());
  if (month < 0) return undefined;
  return `20${parts[3]}-${String(month + 1).padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
}

/**
 * The set rows on an index page.
 *
 * Each is a table row whose first cell links to the set and carries its logo,
 * its English name and its code; the second holds the release date and the
 * third the card count. Parsed with regular expressions rather than a DOM
 * library because the shape is narrow, stable, and one dependency lighter.
 */
function parseIndex(html: string, prefix: string): Omit<LimitlessSet, "cards">[] {
  const sets: Omit<LimitlessSet, "cards">[] = [];
  // The symbol's `src` sits between `<img class="set"` and the name, so it is
  // captured here rather than fetched separately — it was already crossing this
  // pattern and being discarded.
  const rowPattern = new RegExp(
    `href="/cards/${prefix}([A-Za-z0-9.\\-]+)"><img class="set"[^>]*?src="([^"]+)"[^>]*>\\s*([\\s\\S]*?)\\s*<span class="code`
  );
  for (const row of html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const head = row.match(rowPattern);
    if (!head) continue;
    const date = row.match(/>(\d{1,2} [A-Za-z]{3} \d{2})</);
    const count = row.match(/<td class="md-only"><a[^>]*>(\d+)\s/);
    sets.push({
      code: head[1],
      symbol: head[2],
      name: decodeEntities(head[3].replace(/<[^>]+>/g, "")).trim(),
      releaseDate: date ? isoDate(date[1]) : undefined,
      cardCount: count ? Number(count[1]) : undefined,
    });
  }
  return sets;
}

/**
 * `localId` -> thumbnail, from a set page's card grid.
 *
 * The number is taken from the LINK rather than from the image filename. Both
 * carry it, but the link is what Limitless treats as the card's identity while
 * the filename also encodes rarity and language. `GG68`, `SV001` and `TG01`
 * arrive as-is, which is what our own catalogue calls them too.
 *
 * THE ATTRIBUTES BETWEEN `<img` AND `class` ARE NOT OPTIONAL TO ALLOW FOR.
 * Limitless marks everything past the first row `loading="lazy"`, so a pattern
 * anchored on `<img class=` reads exactly eleven cards off a 774-card page and
 * looks like it worked. That is what the count check below is for.
 */
function parseSetPage(html: string): Record<string, string> {
  const cards: Record<string, string> = {};
  const grid =
    /<a href="\/cards\/(?:jp\/)?[A-Za-z0-9.\-]+\/([A-Za-z0-9]+)"><img[^>]*?class="card shadow"[^>]*?src="([^"]+)"/g;
  for (const match of html.matchAll(grid)) cards[match[1]] = match[2];
  return cards;
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

mkdirSync(OUT_DIR, { recursive: true });

for (const { language, indexPath } of CATALOGUES) {
  if (onlyLanguages && !onlyLanguages.has(language)) continue;

  const file = path.join(OUT_DIR, `${language}.json`);

  // Existing work, so a re-run costs only the sets that are new or asked for.
  const held = new Map<string, LimitlessSet>();
  if (!force && existsSync(file)) {
    try {
      for (const set of (JSON.parse(readFileSync(file, "utf8")) as CatalogueFile).sets ?? []) held.set(set.code, set);
    } catch {
      held.clear();
    }
  }

  const index = await fetchText(ORIGIN + indexPath);
  if (!index) {
    console.error(`[limitless] ${language}: index unreachable, leaving what we hold alone`);
    continue;
  }

  const listed = parseIndex(index, language === "jp" ? "jp/" : "");
  const todo = listed.filter((set) => {
    if (onlySets) return onlySets.has(set.code);
    const previous = held.get(set.code);
    // A set already crawled is re-fetched only when Limitless says it grew,
    // which is what happens when a new secret rare is revealed.
    return !previous || Object.keys(previous.cards).length < (set.cardCount ?? 0);
  });

  console.log(
    `[limitless] ${language}: ${listed.length} sets listed, ${held.size} already held, ${todo.length} to fetch`
  );

  let done = 0;
  let empty = 0;
  const short: string[] = [];
  const started = Date.now();

  await pooled(todo, CONCURRENCY, async (set) => {
    const page = await fetchText(`${ORIGIN}${indexPath}/${set.code}`);
    const cards = page ? parseSetPage(page) : {};
    const found = Object.keys(cards).length;
    if (found === 0) empty++;
    // A PARSE THAT SILENTLY UNDER-READS is the failure mode this whole file is
    // exposed to: the page arrives, the regex matches something, and a set of
    // 774 lands as 11 without anything looking wrong. Their own count is the
    // only independent check available, so it is used as one.
    else if (set.cardCount && found < set.cardCount * 0.9) short.push(`${set.code} ${found}/${set.cardCount}`);
    held.set(set.code, { ...set, cards });
    if (++done % 25 === 0) console.log(`[limitless]   ${done}/${todo.length}…`);
  });

  if (short.length > 0) {
    console.warn(
      `[limitless] ${language}: ${short.length} sets parsed short — the page shape may have changed:\n` +
        `             ${short.slice(0, 8).join(", ")}`
    );
  }

  // Their order, newest first, is a reasonable one to keep.
  const sets = listed.map((s) => held.get(s.code)).filter((s): s is LimitlessSet => Boolean(s));
  const kept = new Set(sets.map((s) => s.code));
  for (const [code, set] of held) if (!kept.has(code)) sets.push(set);

  writeFileSync(
    file,
    JSON.stringify({ crawledAt: new Date().toISOString(), source: ORIGIN + indexPath, language, sets })
  );

  const pictured = sets.reduce((n, s) => n + Object.keys(s.cards).length, 0);
  console.log(
    `[limitless] ${language}: ${sets.length} sets, ${pictured.toLocaleString("en-US")} pictured cards, ` +
      `${empty} sets came back empty, ${((Date.now() - started) / 1000).toFixed(0)}s\n`
  );
}
