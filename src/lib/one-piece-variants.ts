/**
 * Derives a One Piece eBay query from the catalogue.
 *
 * THE MODEL, taken from docs/adding-a-card.md's "How a One Piece card number is
 * built" rather than invented here. A row's parentheticals are not one kind of
 * thing, and treating them as one is what produced a pile of special cases.
 * Enumerated across all 10,689 corpus rows, they fall into three:
 *
 *   TREATMENT   a VERSION of the card — "the artwork, foil and texture change;
 *               the number and the printed rarity do not". A closed, small,
 *               high-frequency set: Alternate Art 500, Parallel 176, SP 133,
 *               Pirate Foil 90, Gold 73, Jolly Roger Foil 72, Full Art 64,
 *               Manga 41, Textured Foil 22.
 *
 *   PRODUCT     WHERE it was distributed — "PRB-01 is the product, OP05-119 is
 *               the card". A 400-value long tail, 46% of which appear once or
 *               twice: Online Regional 2023, CS 2023 Top Players Pack, Dash
 *               Pack, Luffy Deck, Judge Pack Vol. 2, Gift Collection 2023.
 *
 *   NAME        an alternate character name, not a version at all —
 *               Daz.Bonez 33, Bentham 25, Galdino 23, Zala 15.
 *
 * TREATMENT IS THE AXIS THAT CHANGES VALUE. One code spans EUR 4.49 to EUR
 * 7,500 across its versions, so those must never be merged. PRODUCT is the axis
 * that does not: the OP05 original and the PRB-01 reprint are the same artwork
 * at USD 208.30 and 215.13, told apart only by a PSA slab label, and are
 * deliberately grouped.
 *
 * So only treatments generate query terms and exclusions. Products and names
 * generate neither. That single distinction removes every guard the previous
 * version needed — minimum token length, year filtering, a forbidden-word list
 * to stop "Luffy Deck" emitting `luffy`, a short-but-real allowlist for "SP" —
 * because none of those strings is a treatment and none was ever eligible.
 */
import { opRowsForCode, type OpEntry } from "@/lib/one-piece-catalog";

/**
 * The closed set of version types, with the words sellers actually write.
 *
 * Closed on purpose. A treatment is a thing Bandai prints, not a string to be
 * tokenised, so an unrecognised parenthetical is a PRODUCT and is ignored
 * rather than guessed at. A genuinely new version type is one entry here and
 * it then serves every card that carries it.
 *
 * `terms` are alternatives, ORed. "alt" and "alternate" are both listed
 * because eBay tokenises and they do not match each other: OP05-119's sellers
 * write "Alt Art", OP01-024's write "Alternate Art", and a query carrying only
 * one spelling starves on the other card.
 *
 * The four alt-art spellings are the four that EXIST, each verified against
 * real PSA 10 listings on 2026-09-06 rather than imagined:
 *
 *   "Alt Art"          -> matched by `alt`         (also covers "Alt-Art":
 *                                                   both layers split on
 *                                                   non-alphanumerics)
 *   "Alternate Art"    -> matched by `alternate`
 *   "Alternative Art"  -> matched by `alternative`  43 listings
 *   "ALTART"/"AltArt"  -> matched by `altart`
 *
 * No term subsumes another, because both the eBay query and titleMatchesCard
 * work on WHOLE TOKENS: `alt` does not match "alternative", and nothing
 * matches the joined form, whose only token is "altart". Which is why this is
 * four listed spellings rather than a prefix rule — a prefix that caught all
 * four would also catch "altered", "alto", "alternator".
 *
 * "altart" is not a typo. Some sellers write
 * it as ONE word — "…HONESTY IMPACT ALTART PSA 10", "…Capone Gang Bege AltArt
 * OP04-10…", both real PSA 10 listings on 2026-09-06 — and a joined spelling
 * matches neither of the other two, because titleMatchesCard checks a
 * single-word term against the title's WORD SET, and "alt" is not a word in
 * "altart". No tracked card carries such a listing today, so eBay's own counts
 * are unchanged (OP05-119 57/57, OP01-024 19/19, OP05-074 22/22) — this is
 * about not silently discarding one the day it appears. Only alternate art is
 * evidenced spelled this way; the other treatments got no such measurement, so
 * they get no such term.
 *
 * `excludable: false` marks a term that is safe to SEARCH for and unsafe to
 * EXCLUDE on, because sellers use it loosely. "Alt art" is that case: in One
 * Piece it colloquially means "any special-art version", so Manga and Wanted
 * Poster listings are routinely titled "Manga Alt Art" or "Wanted Alternate
 * Art". Measured — excluding it cost OP09-093 nine of its fifteen listings and
 * OP09-004 four of fifteen. Bandai's naming separates these versions; seller
 * vocabulary does not, and the query has to live in seller vocabulary.
 */
const TREATMENTS: { id: string; match: RegExp; terms: string[]; excludable?: false }[] = [
  { id: "alternate-art", match: /\balt(ernate)?\s*art\b/i, terms: ["alt", "alternate", "alternative", "altart"], excludable: false },
  { id: "manga", match: /\bmanga\b/i, terms: ["manga"] },
  // Sellers write the short form. Measured in docs/ebay-market-pipeline.md:
  // "Wanted Poster OP09-093 PSA 10" returns 3 results and 0 survive the title
  // check, while "Wanted OP09-093 PSA 10" returns 7 real matches.
  { id: "wanted-poster", match: /\bwanted\s*poster\b/i, terms: ["wanted"] },
  { id: "parallel", match: /\bparallel\b/i, terms: ["parallel"] },
  { id: "sp", match: /\bsp\b/i, terms: ["sp"] },
  { id: "gold", match: /\bgold\b/i, terms: ["gold"] },
  { id: "silver", match: /\bsilver\b/i, terms: ["silver"] },
  { id: "full-art", match: /\bfull\s*art\b/i, terms: ["full art"] },
  { id: "pirate-foil", match: /\bpirate\s*foil\b/i, terms: ["pirate foil"] },
  { id: "jolly-roger-foil", match: /\bjolly\s*roger\b/i, terms: ["jolly roger"] },
  { id: "textured-foil", match: /\btextured\s*foil\b/i, terms: ["textured"] },
  { id: "jumbo", match: /\bjumbo\b/i, terms: ["jumbo"] },
];

/**
 * A version label that does NOT change the artwork.
 *
 * "Reprint" is the same picture printed again — the PRB trap in label form — so
 * it is grouped with the original rather than excluded from it, the same call
 * as grouping OP05 with PRB-01. Recognised here so it can never become an
 * exclusion.
 */
const NON_SEPARATING = new Set(["reprint"]);

/** A row's parentheticals, minus bare card codes and (V.N) indexes. */
function parentheticals(name: string): string[] {
  return [...name.matchAll(/\(([^)]+)\)/g)]
    .map((m) => m[1].trim())
    .filter((v) => !/^[A-Z]{0,4}\d*-?\d+$/i.test(v) && !/^V\.\d+$/i.test(v))
    .map((v) => v.replace(/^(english|japanese)\s+version\s+/i, "").trim());
}

/** Which closed-vocabulary treatments a row carries. A base print carries none. */
export function treatmentsOf(name: string): string[] {
  const parts = parentheticals(name);
  const text = parts.join(" ");
  if (/\breprint\b/i.test(text)) return ["reprint"];
  return TREATMENTS.filter((t) => t.match.test(text)).map((t) => t.id);
}

/**
 * The PRODUCT a row names, when it names one — the parentheticals that are not
 * treatments.
 *
 * This is what identifies a promo whose distinguishing feature is where it was
 * given out rather than how it was printed: "2nd Anniversary Set", "Event Pack
 * Vol. 2", "3rd Anniversary Treasure Campaign Pack". Those cards carry no
 * treatment at all, so the product is the only thing a query can say about them.
 */
export function productOf(name: string): string | undefined {
  const rest = parentheticals(name).filter(
    (v) => !TREATMENTS.some((t) => t.match.test(v)) && !NON_SEPARATING.has(v.toLowerCase())
  );
  return rest.length > 0 ? rest.join(" ") : undefined;
}

/**
 * The searchable form of a product name: its first two words, quoted as a
 * phrase by clause().
 *
 * Sellers write a product's HEAD and vary or drop its TAIL. Measured live on
 * 2026-09-06, PSA 10 tier, same aspect filters as production:
 *
 *   OP09-061  ("2nd anniversary set")        24   ("2nd anniversary")        32
 *   ST21-014  ("3rd anniversary treasure")    4   ("3rd anniversary")         5
 *   P-033     ("event pack vol. 2")           9   ("event pack")             10
 *
 * Two words, not one and not all of them. All of them keeps a tail — "Set",
 * "Cup", "Vol. 2" — that a seller need not have written, and every listing
 * missing it is lost. One word is not a product: it collapses "Event Pack" and
 * "Judge Pack" onto "Pack", "2nd Anniversary" and "3rd Anniversary" onto their
 * ordinals, and — the failure this codebase already hit once — "Luffy Deck"
 * onto a bare `luffy` that matches every Luffy card ever listed. Two words is
 * the shortest form that still names the product.
 *
 * The extra listings this admits are the SAME card in a neighbouring product —
 * ST21-014's fifth result is titled "3rd Anniversary CP Pack" — which is the
 * grouping this file already makes deliberately for the OP05/PRB-01 reprint.
 */
function productTerm(product: string): string {
  return product.split(/\s+/).slice(0, 2).join(" ").toLowerCase();
}

function termsFor(ids: string[], forExclusion = false): string[] {
  return [
    ...new Set(
      ids.flatMap((id) => {
        const t = TREATMENTS.find((x) => x.id === id);
        if (!t) return [];
        if (forExclusion && t.excludable === false) return [];
        return t.terms;
      })
    ),
  ];
}

export type DerivedQuery = {
  /** Query text appended to the card code — positive terms plus `-` exclusions. */
  queryText: string;
  /** A title must contain at least ONE of these. */
  acceptAny: string[];
  /** A title containing any of these is a different version. */
  reject: string[];
  /** The wanted version(s), or the product when the card is a base print. */
  treatment: string;
  competing: string[];
};

/**
 * One clause of the query.
 *
 * The positive group is ALWAYS parenthesised, even with a single term. eBay
 * treats `(manga)` and `manga` identically, so this costs nothing and buys the
 * thing that matters when reading a live query: every card's search has the
 * same shape, and the version terms are visibly separate from the card number
 * and the grade.
 */
export function clause(terms: string[], negate = false): string {
  if (terms.length === 0) return "";
  const fmt = (t: string) => (t.includes(" ") ? `"${t}"` : t);
  if (negate) return terms.map((t) => `-${fmt(t)}`).join(" ");
  return `(${terms.map(fmt).join(",")})`;
}

/**
 * Build the query for one card.
 *
 * Positive terms come from the wanted row's treatments; exclusions from the
 * treatments its SIBLINGS carry and it does not. A base print in a special
 * product has no treatments, so it searches on the product name and excludes
 * every version its code also has — which is exactly right: the "2nd
 * Anniversary Set" card is the one that is NOT the Parallel and NOT the Jumbo.
 */
export function deriveQuery(code: string, wanted: OpEntry): DerivedQuery {
  const wantedIds = treatmentsOf(wanted.card.name).filter((id) => !NON_SEPARATING.has(id));
  const rows = opRowsForCode(code);

  const competingIds = [
    ...new Set(
      rows
        .flatMap((r) => treatmentsOf(r.card.name))
        .filter((id) => !NON_SEPARATING.has(id) && !wantedIds.includes(id))
    ),
  ];

  const product = wantedIds.length === 0 ? productOf(wanted.card.name) : undefined;
  const accept = wantedIds.length > 0 ? termsFor(wantedIds) : product ? [productTerm(product)] : [];
  const reject = termsFor(competingIds, true);

  return {
    queryText: `${clause(accept)} ${clause(reject, true)}`.trim(),
    acceptAny: accept,
    reject,
    treatment: wantedIds.join(" + ") || product || "(base print)",
    competing: competingIds,
  };
}

/**
 * The entry point graded-market.ts uses — derives from what a resolved Card
 * already carries, falling back to the ref's own tags when BerryWallet could
 * not be reached.
 *
 * That fallback matters: BerryWallet is capped at 100/hour, and without it
 * `card.printName` is undefined. The corpus is on disk and does not care, so a
 * metered upstream being down costs freshness, never correctness.
 */
export function deriveQueryForCard(
  code: string,
  printName: string | undefined,
  variantTags?: string[]
): DerivedQuery | undefined {
  const rows = opRowsForCode(code);
  const byPrintName = printName
    ? (rows.find((r) => r.card.name === printName) ?? rows.find((r) => r.card.name.includes(printName)))
    : undefined;
  const byTags =
    variantTags && variantTags.length > 0
      ? (rows.find(
          (r) => r.language === "en" && variantTags.every((t) => r.card.name.toLowerCase().includes(t.toLowerCase()))
        ) ?? rows.find((r) => variantTags.every((t) => r.card.name.toLowerCase().includes(t.toLowerCase()))))
      : undefined;

  const match = byPrintName ?? byTags;
  if (match) return deriveQuery(code, match);

  // Not in the corpus — a handful of rows exist only in the flat /op/search
  // index (ST21-014's Campaign Pack). Same model, but with no sibling list to
  // exclude from, so the query is positive-only.
  const name = printName ?? (variantTags ?? []).map((t) => `(${t})`).join(" ");
  if (!name) return undefined;
  const ids = treatmentsOf(name).filter((id) => !NON_SEPARATING.has(id));
  const product = ids.length === 0 ? productOf(name) : undefined;
  const accept = ids.length > 0 ? termsFor(ids) : product ? [productTerm(product)] : [];
  if (accept.length === 0) return undefined;
  return {
    queryText: clause(accept),
    acceptAny: accept,
    reject: [],
    treatment: ids.join(" + ") || product || "(base print)",
    competing: [],
  };
}
