import { getCatalogCard, getCatalogSetCards, getCatalogSets, type CatalogEntry } from "@/lib/catalog";
import { searchCatalogCards } from "@/lib/catalog-search";
import { officialCode, officialRowsForCode, officialSearchByName } from "@/lib/one-piece-official";
import { onePieceImageUrl } from "@/lib/one-piece-images";
import { japaneseImageUrl, japaneseName, searchJapaneseNames } from "@/lib/pokemon-ja-official";

/**
 * Resolve whatever a person types into candidate CARDS, across both games.
 *
 * THIS IS THE SCAN, WITHOUT THE CAMERA. The pipeline is capture → read → match
 * → choose → store (docs/free-tier-catalogue.md §4), and only the first two
 * steps involve a photo. Building the last three against a text box first means
 * the interaction that actually matters ships and gets used before any OCR risk
 * is taken, and a bad photo later degrades to this rather than to an error.
 *
 * IT RESOLVES TO A CARD, NOT A PRINTING, on purpose. `/card/[tcg]/[code]` shows
 * the printings and lets a person pick; that step is unavoidable in both games
 * (§1) and is the one thing no pipeline can do for them. Narrowing 34,000 cards
 * to a handful is this module's whole job.
 *
 * AMBIGUITY IS A RESULT, NOT A FAILURE, and the printed-number form proves it.
 * "190/182" is Vanillish in Paradox Rift AND Ethan's Typhlosion in sv10 —
 * measured, 44 of 203 set totals are shared by more than one set, the worst by
 * 18. Returning both and saying why is correct; picking one would be a guess
 * with a wrong answer half the time.
 *
 * TIER 1 ONLY: catalogues on disk, no prices, no network, no metered call.
 */

export type LookupMatch = {
  tcg: "pokemon" | "onepiece";
  /** The address of the card page: a TCGdex id, or a One Piece card code. */
  code: string;
  name: string;
  /** The set or pack this card belongs to. */
  origin: string;
  image?: string;
  /** How many printings the card page will show. */
  printings: number;
  /** Rarity, or the printed number — whatever helps tell two candidates apart. */
  detail?: string;
};

export type LookupResult = {
  query: string;
  /** How the input was read, said plainly so a wrong reading is visible rather than mysterious. */
  interpretation: string;
  matches: LookupMatch[];
  /** Matches found beyond the limit, so the page can say "narrow it down" honestly. */
  truncated: number;
  /**
   * How many matched per game BEFORE any game filter was applied.
   *
   * The page needs this to decide whether a game filter is worth offering at
   * all, and to label it with real counts — neither of which it could work out
   * from `matches` once those have been filtered down to one game.
   */
  byGame: { pokemon: number; onepiece: number };
};

const LIMIT = 60;

/** `OP05-119`, `ST21-014`, `EB01-003`, `P-033`, with or without a `_p2` printing suffix. */
const OP_CODE = /^([A-Z]{1,4}\d{2}-\d{3}|P-\d{3})(_[A-Za-z0-9]+)?$/i;

/** The number printed on a Pokémon card: `190/182`. */
const PRINTED_NUMBER = /^(\d+)\s*\/\s*(\d+)$/;

function pokemonMatch(entry: CatalogEntry, detail?: string): LookupMatch {
  const { card, set } = entry;
  // One per variant TYPE, matching what the card page renders — see
  // card-view.ts on why Base Set Charizard's four `holo` variants are one.
  const printings = new Set(card.variants.map((v) => v.type ?? "unknown")).size;

  const japanese = set.language === "ja";

  return {
    tcg: "pokemon",
    code: japanese ? `ja~${card.tcgdexId}` : card.tcgdexId,
    // As printed. TCGdex romanises Japanese names; the card does not.
    name: (japanese ? japaneseName(set.id, card.localId) : undefined) ?? card.name,
    // Named, not flagged: two sets can share a printed total and a card
    // number, and "which one is mine" is answered by seeing that one is the
    // Japanese release.
    origin: set.language === "ja" ? `${set.name} (JP)` : set.name,
    image: card.image
      ? `${card.image}/low.webp`
      : japanese
        ? japaneseImageUrl(set.id, card.localId, 320)
        : undefined,
    printings: Math.max(printings, 1),
    detail: detail ?? card.rarity,
  };
}

function onePieceMatch(code: string): LookupMatch | undefined {
  const rows = officialRowsForCode(code, "english");
  if (rows.length === 0) return undefined;

  const first = rows[0];
  return {
    tcg: "onepiece",
    code,
    name: first.card.name,
    origin: rows.length === 1 ? (first.pack.label ?? first.pack.title) : `${rows.length} packs`,
    image: onePieceImageUrl(first.card.id, { width: 320 }),
    printings: rows.length,
    detail: first.card.rarity ?? undefined,
  };
}

/**
 * Pokémon cards carrying `localId`, in any set whose printed total is `total`,
 * IN EITHER LANGUAGE.
 *
 * WHY BOTH, and it is not a nicety. What is printed on a Pokémon card is
 * `048/082` — a number and a set size, never the set itself, which is carried
 * by a symbol no OCR reads. Searching English alone did not fail on a Japanese
 * card, it answered confidently and wrongly: a photographed Japanese Gengar ex
 * (`048/082`) resolved to Team Rocket Porygon, which really is the 48th card of
 * an 82-card set. Complete with a price and an "I own this" button.
 *
 * Measured 2026-09-07: 154 of 216 English sets share their printed total with
 * another English set, and 152 of 182 Japanese ones do. So this returns a LIST
 * on purpose, and the caller says how many sets print that many. Narrowing it
 * to one is the name's job, not the number's.
 */
function byPrintedNumber(localId: string, total: number): LookupMatch[] {
  const out: LookupMatch[] = [];

  // ZERO PADDING DIFFERS BETWEEN THE CATALOGUES. English stores `48`, Japanese
  // stores `048` — 9,808 of 12,781 Japanese cards are padded against 4,450 of
  // 23,546 English ones. Comparing the strings, or normalising only one side,
  // silently finds nothing in the other language; both are reduced to a number.
  const wanted = Number(localId);

  for (const set of getCatalogSets({ language: "all" })) {
    if (set.cardCount?.official !== total) continue;
    const hit = getCatalogSetCards(set.id, set.language).find(
      (entry) => Number(entry.card.localId) === wanted && /^\d+$/.test(entry.card.localId)
    );
    if (hit) out.push(pokemonMatch(hit, `#${localId}/${total}`));
  }

  return out;
}

/**
 * How well a card's name answers what was typed. Lower sorts first.
 *
 * Without this, "Charizard" led with *Blaine's* Charizard, because the
 * underlying searches order alphabetically and a substring match is a substring
 * match. Someone typing a name usually means the card that IS that name, so an
 * exact hit outranks a prefix, which outranks a mention anywhere.
 */
function nameRank(cardName: string, text: string): number {
  const name = cardName.toLowerCase().replace(/[.\-_]+/g, " ").replace(/\s+/g, " ").trim();
  const needle = text.toLowerCase().replace(/[.\-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  return 2;
}

function byName(text: string): LookupMatch[] {
  // One Piece first so a name common to both games does not fill the page with
  // one of them before the other is reached.
  const onePiece = officialSearchByName(text, "english", LIMIT / 2).flatMap((entry) => {
    const match = onePieceMatch(officialCode(entry.card.id));
    return match ? [match] : [];
  });

  const pokemon = searchCatalogCards({ q: text }).matched.map((entry) => pokemonMatch(entry));

  // NAMES AS PRINTED, which the catalogue does not hold. TCGdex romanises every
  // Japanese card, so searching it for `ゲンガー` — the string Vision reads off
  // a Japanese face — finds nothing. These are looked up in the official data
  // and joined back by (set, number).
  const japanese: LookupMatch[] = [];
  const alreadyFound = new Set(pokemon.map((m) => m.code));
  for (const key of searchJapaneseNames(text, LIMIT / 2)) {
    const hash = key.lastIndexOf("#");
    const entry = getCatalogSetCards(key.slice(0, hash), "ja").find(
      (e) => Number(e.card.localId) === Number(key.slice(hash + 1))
    );
    if (!entry) continue;
    const match = pokemonMatch(entry);
    if (alreadyFound.has(match.code)) continue;
    alreadyFound.add(match.code);
    japanese.push(match);
  }

  // Stable within a rank: each source already arrives in its own sensible
  // order, so ranking only lifts the better answers rather than reshuffling.
  return [...onePiece, ...pokemon, ...japanese].sort((a, b) => nameRank(a.name, text) - nameRank(b.name, text));
}

/**
 * `game` narrows the RESULTS, never the parsing.
 *
 * A card code already says which game it belongs to — `OP05-119` cannot be
 * Pokémon and `190/182` cannot be One Piece — so three of the four input forms
 * are unambiguous before any filter is applied and the parameter changes
 * nothing for them. It exists for the fourth: a NAME, where "Zoro" legitimately
 * matches Zoro-Juurou and Zoroark and only the person searching knows which
 * they meant.
 *
 * That is also why this is a filter rather than two routes. The scan produces a
 * code and nothing else, so a per-game path would have to be chosen for the
 * user from the code itself — a fork that exists only to be auto-resolved is
 * friction wearing the costume of structure.
 */
export function lookupCards(raw: string, game?: LookupMatch["tcg"]): LookupResult {
  const query = raw.trim();
  const empty: LookupResult = {
    query,
    interpretation: "",
    matches: [],
    truncated: 0,
    byGame: { pokemon: 0, onepiece: 0 },
  };
  if (query.length === 0) return empty;

  const finish = (interpretation: string, all: LookupMatch[]): LookupResult => {
    const byGame = {
      pokemon: all.filter((m) => m.tcg === "pokemon").length,
      onepiece: all.filter((m) => m.tcg === "onepiece").length,
    };
    // Filter BEFORE the limit, or asking for one game would show fewer of it
    // than exist simply because the other game filled the first 60 places.
    const matches = game ? all.filter((m) => m.tcg === game) : all;
    return {
      query,
      interpretation,
      matches: matches.slice(0, LIMIT),
      truncated: Math.max(matches.length - LIMIT, 0),
      byGame,
    };
  };

  // 1. A One Piece card code. Tried first because `OP05-119` also satisfies the
  //    looser shape of a TCGdex id, and only one of those readings is right.
  const opCode = query.match(OP_CODE);
  if (opCode) {
    const code = opCode[1].toUpperCase();
    const match = onePieceMatch(code);
    if (match) return finish(`One Piece card code ${code}`, [match]);
  }

  // 2. The number printed on a Pokémon card. Often ambiguous — see the header.
  const printed = query.match(PRINTED_NUMBER);
  if (printed) {
    const [, localId, total] = printed;
    const matches = byPrintedNumber(String(Number(localId)), Number(total));
    if (matches.length > 0) {
      const note =
        matches.length === 1
          ? `card ${localId} of a ${total}-card set`
          : `card ${localId} of a ${total}-card set — ${matches.length} sets print that many`;
      return finish(note, matches);
    }
  }

  // 3. A TCGdex id, which is what our own links carry. English ids are
  //    lowercase (`swsh12-186`) and Japanese ones are not (`PCG1-048`), so
  //    both spellings are tried rather than assuming one.
  const entry = getCatalogCard(query.toLowerCase()) ?? getCatalogCard(query) ?? getCatalogCard(query.toUpperCase());
  if (entry) return finish(`Pokémon card id ${entry.card.tcgdexId}`, [pokemonMatch(entry)]);

  // 4. A name, across both catalogues.
  if (query.length >= 2) {
    const matches = byName(query);
    if (matches.length > 0) return finish(`name containing "${query}"`, matches);
  }

  return { ...empty, interpretation: `nothing matches "${query}"` };
}
