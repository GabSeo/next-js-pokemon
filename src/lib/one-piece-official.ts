/**
 * TIER 1 for the OFFICIAL One Piece card list — the catalogue crawled by
 * scripts/one-piece-official-crawl.mts from Bandai's own data.
 *
 * Same discipline as lib/catalog.ts and lib/one-piece-catalog.ts, for the same
 * reason: this file imports `node:fs` and `node:path` and nothing else, so it
 * cannot reach a metered upstream by mistake, and it holds no prices.
 *
 * WHY IT SITS BESIDE lib/one-piece-catalog.ts RATHER THAN REPLACING IT. The two
 * answer different questions and neither is a superset:
 *
 *   this file          what the card IS — name, rarity, colour, cost, power,
 *                      counter, attributes, types, rules text, the pack it was
 *                      printed in, an image. In every language Bandai
 *                      publishes, including Japanese rarity (which BerryWallet
 *                      leaves empty on all 3,644 of its JP rows) and French
 *                      (which BerryWallet has no sets for at all).
 *
 *   one-piece-catalog  where the card is SOLD — Cardmarket and TCGplayer
 *                      product URLs, and the sibling joins built on them. None
 *                      of that exists here, because Bandai does not sell
 *                      singles.
 *
 * IT DOES NOT REPLACE BERRYWALLET FOR IDENTITY, and an earlier version of this
 * comment claimed it did. Bandai's catalogue records THAT a code has several
 * printings and not WHICH is which. Measured across this catalogue: of the 945
 * (code, pack) groups holding more than one printing, 895 — 94.7% — are
 * identical in every field but the id and the image URL, and `name` differs in
 * ZERO of them. OP05-119's Alternate Art, Manga and Reprint all read
 * "Monkey.D.Luffy", SecretRare, PRB-01.
 *
 * Tested against the tracked cards directly: 0 of 9 could be identified
 * uniquely from (code + pack + treatment) using this data. BerryWallet's
 * parenthetical naming — "(Alternate Art) (Manga)" — remains the only
 * machine-readable source of the treatment, and lib/one-piece-variants.ts is
 * built entirely on it.
 *
 * So what this catalogue is actually for: browsing sets, and the per-card
 * facts BerryWallet has never carried — colour, cost, power, counter,
 * attributes, types, rules text, Japanese rarity, French. It PREVENTED spend
 * by making set pages possible at all on a 90/hour budget. It has not REDUCED
 * any call that was already being made.
 *
 * THE PRINTING ID IS PER-LANGUAGE, NOT UNIVERSAL. `OP05-119_p4` is the PRB-01
 * printing in English and `_p3` is the same product's printing in Japanese,
 * because the `_pN` counter is assigned per language and a JP-only printing
 * shifts everything after it. Measured on OP05-119: the ids agree inside OP-05
 * and diverge from PRB-01 onward. So this is a per-set index in disguise, the
 * same trap as BerryWallet's `(V.N)`, and joining EN to JP on the id alone is
 * exactly the guess pickVariantForJapanese refuses to make. Join on
 * (card code + pack label) instead — the pack label `[PRB-01]` is stable across
 * languages, and that is what `packsFor` exposes.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CATALOG_DIR = path.join(process.cwd(), "data", "catalog", "one-piece-official");

/** One printing, exactly as Bandai publishes it. No prices — see the header. */
export type OfficialCard = {
  /** Per-language printing id: `OP05-119`, `OP05-119_p2`. NOT a cross-language key. */
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

export type OfficialPack = {
  id: string;
  /** `OP-05`, `ST-21`, `PRB-01` — stable across languages, so this is the join key. */
  label?: string;
  /** `BOOSTER PACK`, `STARTER DECK`, `PREMIUM BOOSTER` — the product line. */
  prefix?: string;
  title: string;
  rawTitle: string;
};

export type OfficialEntry = { card: OfficialCard; pack: OfficialPack; language: string };

type OfficialPackFile = {
  crawledAt: string;
  sourceCommit: string;
  language: string;
  pack: OfficialPack;
  cards: OfficialCard[];
};

type Loaded = {
  entries: OfficialEntry[];
  /** Every printing of a card code, per language. The lookup this module exists for. */
  byCode: Map<string, OfficialEntry[]>;
  packs: { pack: OfficialPack; language: string; cardCount: number }[];
  languages: string[];
  crawledAt?: string;
  sourceCommit?: string;
};

let cache: Loaded | undefined;

/** `OP05-119_p2` -> `OP05-119`. The card code, without the printing suffix. */
export function officialCode(id: string): string {
  return id.split("_")[0];
}

/**
 * A pack's set code — `OP-05`, `PRB-01`, `ST-21` — however the language spells it.
 *
 * `title_parts.label` is populated on the English and French feeds and NULL on
 * the entire Japanese one, where the code lives inside the title in full-width
 * brackets: `プレミアムブースター ONE PIECE CARD THE BEST【PRB-01】` against
 * `PREMIUM BOOSTER -ONE PIECE CARD THE BEST- [PRB-01]`. Reading only the field
 * made every Japanese pack label-less and silently broke the one join this
 * module recommends over the printing id.
 *
 * Undefined for the promo buckets — "Promotion card", "Other Product Card" —
 * which genuinely carry no set code.
 */
function packLabel(pack: OfficialPack): string | undefined {
  if (pack.label) return pack.label;
  return pack.rawTitle.match(/[[【]([A-Z]{1,4}-?\d{2})[\]】]/)?.[1];
}

function loadCatalog(): Loaded {
  if (cache) return cache;

  const entries: OfficialEntry[] = [];
  const byCode = new Map<string, OfficialEntry[]>();
  const packs: Loaded["packs"] = [];
  const languages = new Set<string>();
  let crawledAt: string | undefined;
  let sourceCommit: string | undefined;

  if (!existsSync(CATALOG_DIR)) {
    // An absent corpus is an empty catalogue, not a crash — the same
    // degradation rule the other two catalogue loaders follow.
    cache = { entries, byCode, packs, languages: [] };
    return cache;
  }

  for (const file of readdirSync(CATALOG_DIR)) {
    if (!file.endsWith(".json")) continue;
    let parsed: OfficialPackFile;
    try {
      parsed = JSON.parse(readFileSync(path.join(CATALOG_DIR, file), "utf8")) as OfficialPackFile;
    } catch {
      continue;
    }
    languages.add(parsed.language);
    const pack: OfficialPack = { ...parsed.pack, label: packLabel(parsed.pack) };
    packs.push({ pack, language: parsed.language, cardCount: parsed.cards.length });
    if (!crawledAt || parsed.crawledAt < crawledAt) crawledAt = parsed.crawledAt;
    sourceCommit ??= parsed.sourceCommit;

    for (const card of parsed.cards) {
      const entry: OfficialEntry = { card, pack, language: parsed.language };
      entries.push(entry);
      const code = officialCode(card.id);
      const list = byCode.get(code);
      if (list) list.push(entry);
      else byCode.set(code, [entry]);
    }
  }

  cache = { entries, byCode, packs, languages: [...languages].sort(), crawledAt, sourceCommit };
  return cache;
}

/** Every printing of a code, in every crawled language. */
export function officialRowsForCode(code: string, language?: string): OfficialEntry[] {
  const rows = loadCatalog().byCode.get(code) ?? [];
  return language ? rows.filter((r) => r.language === language) : rows;
}

/**
 * The packs a code was printed in, by their language-stable label.
 *
 * This is the join the printing id cannot be trusted for — see the file header.
 * `OP05-119` comes back as `OP-05`, `OP-09`, `OP-11`, `PRB-01`, and those
 * labels read the same in English, Japanese and French.
 */
export function officialPacksFor(code: string, language?: string): string[] {
  return [
    ...new Set(
      officialRowsForCode(code, language)
        .map((r) => r.pack.label)
        .filter((l): l is string => typeof l === "string")
    ),
  ];
}

/** Every pack in one language, newest first — pack ids run in release order. */
export function officialPacks(language: string): { pack: OfficialPack; cardCount: number }[] {
  return loadCatalog()
    .packs.filter((p) => p.language === language)
    .map(({ pack, cardCount }) => ({ pack, cardCount }))
    .sort((a, b) => b.pack.id.localeCompare(a.pack.id));
}

export function officialCardsInPack(packId: string, language: string): OfficialCard[] {
  return loadCatalog()
    .entries.filter((e) => e.language === language && e.pack.id === packId)
    .map((e) => e.card);
}

export function officialStats(language?: string): {
  packs: number;
  printings: number;
  codes: number;
  languages: string[];
  crawledAt?: string;
  sourceCommit?: string;
} {
  const { entries, byCode, packs, languages, crawledAt, sourceCommit } = loadCatalog();
  if (!language) {
    return { packs: packs.length, printings: entries.length, codes: byCode.size, languages, crawledAt, sourceCommit };
  }
  const inLang = entries.filter((e) => e.language === language);
  return {
    packs: packs.filter((p) => p.language === language).length,
    printings: inLang.length,
    codes: new Set(inLang.map((e) => officialCode(e.card.id))).size,
    languages,
    crawledAt,
    sourceCommit,
  };
}
