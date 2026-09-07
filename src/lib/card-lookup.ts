import { getCatalogCard, getCatalogSetCards, getCatalogSets, type CatalogEntry } from "@/lib/catalog";
import { searchCatalogCards } from "@/lib/catalog-search";
import { officialCode, officialRowsForCode, officialSearchByName } from "@/lib/one-piece-official";

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

  return {
    tcg: "pokemon",
    code: card.tcgdexId,
    name: card.name,
    origin: set.name,
    image: card.image ? `${card.image}/low.webp` : undefined,
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
    image: `/api/one-piece-image/${encodeURIComponent(first.card.id)}?lang=english&w=320`,
    printings: rows.length,
    detail: first.card.rarity ?? undefined,
  };
}

/** Pokémon cards carrying `localId`, in any set whose printed total is `total`. */
function byPrintedNumber(localId: string, total: number): LookupMatch[] {
  const out: LookupMatch[] = [];

  for (const set of getCatalogSets()) {
    if (set.cardCount?.official !== total) continue;
    const hit = getCatalogSetCards(set.id).find((entry) => entry.card.localId === localId);
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

  // Stable within a rank: each source already arrives in its own sensible
  // order, so ranking only lifts the better answers rather than reshuffling.
  return [...onePiece, ...pokemon].sort((a, b) => nameRank(a.name, text) - nameRank(b.name, text));
}

export function lookupCards(raw: string): LookupResult {
  const query = raw.trim();
  const empty: LookupResult = { query, interpretation: "", matches: [], truncated: 0 };
  if (query.length === 0) return empty;

  const finish = (interpretation: string, matches: LookupMatch[]): LookupResult => ({
    query,
    interpretation,
    matches: matches.slice(0, LIMIT),
    truncated: Math.max(matches.length - LIMIT, 0),
  });

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

  // 3. A TCGdex id, which is what our own links carry.
  const entry = getCatalogCard(query.toLowerCase());
  if (entry) return finish(`Pokémon card id ${entry.card.tcgdexId}`, [pokemonMatch(entry)]);

  // 4. A name, across both catalogues.
  if (query.length >= 2) {
    const matches = byName(query);
    if (matches.length > 0) return finish(`name containing "${query}"`, matches);
  }

  return { ...empty, interpretation: `nothing matches "${query}"` };
}
