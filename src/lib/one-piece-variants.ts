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
 * 7,500 across its versions, so those must never be merged.
 *
 * PRODUCT IS THE SECOND AXIS, and this file used to deny that. It claimed the
 * OP05 original and the PRB-01 reprint were one artwork told apart only by a
 * slab label. They are not — the Premium Booster reprints carry DIFFERENT ART,
 * confirmed by the owner of the card and, in hindsight, by data already on
 * disk: no two rows of a code share a TCGplayer or Cardmarket product. See
 * deriveQuery's own comment for the measurements and for why the product is
 * named only when treatment cannot do the job.
 *
 * NAME generates nothing, still.
 *
 * So treatments and products generate query terms; names do not. That
 * distinction removes every guard an earlier version needed — minimum token
 * length, year filtering, a forbidden-word list to stop "Luffy Deck" emitting
 * `luffy`, a short-but-real allowlist for "SP" — because none of those strings
 * is a treatment and none was ever eligible.
 */
import { opRowsForCode, opSetFamily, opSetNames, type OpEntry } from "@/lib/one-piece-catalog";

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
const TREATMENTS: {
  id: string;
  match: RegExp;
  terms: string[];
  /**
   * The subset of `terms` safe to EXCLUDE on, when that is narrower than the
   * terms searched for. Defaults to all of them.
   *
   * Parallel needs this and alternate art does not, even though both are
   * alt-art treatments, because the asymmetry lives in seller vocabulary
   * rather than in Bandai's. A Parallel is SEARCHED for as "parallel" or as
   * "alt art": OP09-061's Leader Parallel returns 18 listings on `(parallel)`
   * alone and 40 once the alt-art spellings join it, with titles reading
   * "Monkey.D.Luffy 2024 Leader Alt Art OP09-061". It must be EXCLUDED on
   * "parallel" alone, because `-alt` is the exclusion already measured to cost
   * OP09-093 nine of fifteen listings, and OP01-024's query depends on
   * `-parallel` meaning the Parallel print and nothing wider.
   */
  excludeTerms?: string[];
  excludable?: false;
}[] = [
  { id: "alternate-art", match: /\balt(ernate)?\s*art\b/i, terms: ["alt", "alternate", "alternative", "altart"], excludable: false },
  { id: "manga", match: /\bmanga\b/i, terms: ["manga"] },
  // Sellers write the short form. Measured in docs/ebay-market-pipeline.md:
  // "Wanted Poster OP09-093 PSA 10" returns 3 results and 0 survive the title
  // check, while "Wanted OP09-093 PSA 10" returns 7 real matches.
  { id: "wanted-poster", match: /\bwanted\s*poster\b/i, terms: ["wanted"] },
  // Sellers call this "alt art" as readily as "parallel" — see excludeTerms
  // on the type above for the measurement and for why the exclusion stays
  // narrow while the search goes wide.
  {
    id: "parallel",
    match: /\bparallel\b/i,
    terms: ["parallel", "alt", "alternate", "alternative", "altart"],
    excludeTerms: ["parallel"],
  },
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
 * "Reprint" is the row Bandai labelled as a straight re-run, so it is not a
 * VERSION and never becomes an exclusion. It is still separated from the
 * original when it sits in another product — that job belongs to the family
 * rule in deriveQuery, not to this set.
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
        return forExclusion ? (t.excludeTerms ?? t.terms) : t.terms;
      })
    ),
  ];
}

export type DerivedQuery = {
  /** Query text appended to the card code — positive terms plus `-` exclusions. */
  queryText: string;
  /** OR within a group, AND between groups: the treatment, then the product. */
  acceptGroups: string[][];
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
 * THE PRODUCT IS PART OF THE CARD, when two products print the same treatment.
 *
 * This file used to say the opposite — that OP05 and PRB-01 are one artwork
 * told apart only by a slab label, so grouping them was deliberate. That was
 * wrong, and the owner of the card caught it: PRB-01's OP05-119 SEC Alt Art is
 * NOT the OP05 SEC Alt Art. The Premium Booster reprints carry different art.
 *
 * The corpus already said so and nothing was reading it. Every row for
 * OP05-119 has its OWN TCGplayer product and its own Cardmarket product —
 * OP05's alt art is tcgplayer/530122 under `/Awakening-of-the-New-Era/…-V2`,
 * PRB-01's is tcgplayer/586960 under `/The-Best/…-V2`. Two marketplaces sell
 * them as two things. So does eBay, at different money (2026-09-06, PSA 10):
 * the PRB print, 6 listings, $175-1,100; the OP05 print, 51 listings,
 * $250-1,500 and mostly $600-750. A blended median belongs to neither, and it
 * is not reliably wrong in one direction — on the English tier, where our
 * filters keep 3 PRB asks of $400/$875/$1,100, blending UNDERSTATED the card
 * at roughly $650. The point is that it was answering about a different card,
 * not that it leaned high.
 *
 * WHEN THIS FIRES, and why it is not simply "always name the set". Treatment
 * already separates most rows, and a term that repeats work is a term that can
 * only lose listings. The product is named ONLY when treatment cannot do the
 * job: another row carries the SAME treatment in a DIFFERENT set family.
 *
 * Checked against every tracked card, and it explains a measurement that used
 * to look like a contradiction:
 *
 *   OP05-119  alt art in OP05 AND PRB      -> rival, name the product
 *   OP01-024  alt art in PRB only          -> no rival, say nothing
 *   OP05-074  alt art + manga in OP05 only -> no rival, say nothing
 *
 * OP01-024 is the card where a hand-written `["PRB","alt"]` returned ZERO
 * PSA 10 listings while the plain derived query returned 19. That was never
 * evidence that naming the product is wrong — it is evidence that naming it
 * where nothing competes only narrows a search that was already exact.
 *
 * Base prints are exempt: they carry no treatment, so productOf already gives
 * them a product-specific phrase and this would only repeat it.
 */
function familyOf(entry: OpEntry): string {
  return opSetFamily(entry.set.code).toLowerCase();
}

/**
 * The words sellers write for a product: its family code and the segments of
 * its set name.
 *
 * "Premium Booster -The Best-" splits into "premium booster" and "the best",
 * which is how sellers actually title it — measured, `("the best")` is what
 * finds "Monkey.D.Luffy OP05-119 Alternate Art Premium Booster -The Best-",
 * a listing that says PRB nowhere. ORed, so breadth here only ever adds.
 */
function familyAliases(entry: OpEntry): string[] {
  const segments = entry.set.name
    .split(/[-–—]/)
    .map((part) =>
      part
        .replace(/vol\.?\s*\d+/i, "")
        .replace(/\((japanese|english)\)/i, "")
        .trim()
        .toLowerCase()
    )
    .filter((part) => part.length > 3);
  return [...new Set([familyOf(entry), ...segments])];
}

/**
 * The one phrase that names a set, for use as an exclusion.
 *
 * The LONGEST segment, not every segment: "Premium Booster -The Best-" yields
 * "premium booster" and drops "the best". Both are fair game as POSITIVE terms,
 * where breadth only ever adds, but an exclusion is the one place a loose
 * phrase can silently destroy real listings — and "the best" is a phrase a
 * seller might write about condition rather than about the product.
 */
/** How many distinct set names each word appears in. Built once, off disk. */
let setNameDocFrequency: Map<string, number> | undefined;
function wordFrequency(): Map<string, number> {
  if (setNameDocFrequency) return setNameDocFrequency;
  const df = new Map<string, number>();
  for (const name of opSetNames()) {
    for (const word of new Set(name.split(/[^a-z0-9]+/).filter(Boolean))) {
      df.set(word, (df.get(word) ?? 0) + 1);
    }
  }
  setNameDocFrequency = df;
  return df;
}

/**
 * The one WORD of a set name that identifies it, alongside the phrase.
 *
 * A phrase alone is not enough, and a real listing showed why: our OP01-024 is
 * the PRB-01 print, and its Japanese tier carried
 *
 *   "PSA 10 GEM MINT JAPANESE ONE PIECE 2022 MONKEY LUFFY OP01-024 ROMANCE SR ALT ART"
 *
 * — the Romance Dawn card, written without "Dawn". `-"romance dawn"` cannot see
 * it; `-romance` removes it and its twin and nothing else (Japanese 15 -> 13,
 * English unchanged at 12, measured 2026-09-06).
 *
 * WHICH word, chosen by evidence rather than by taste. Splitting a set name and
 * excluding every word is how this breaks: "Awakening of the New Era" would
 * emit `-new`, and "new" is also in "Emperors in the New World" — a word that
 * names two products names neither. So a word's document frequency across the
 * corpus's own set names decides, lowest first, longest as the tie-break. That
 * makes "romance" beat "dawn", "awakening" beat "era", and "promotion" beat
 * "one" and "piece" in "One Piece Promotion Cards" — where `-one` would have
 * excluded the entire game.
 *
 * Words in the WANTED row's own set name are skipped outright. Without that
 * guard, excluding "Premium Booster -The Best-" contributes `-best`, which
 * would be right up until we track a card printed in "Premium Card Collection
 * -Best Selection Vol. 2-" — 59 of 100 One Piece PSA 10 titles carrying the
 * word "best" belong to that unrelated line.
 *
 * Words of three letters or fewer are out: they are "new", "era", "the", "of",
 * and none of them identifies anything.
 */
function setNameWord(rival: OpEntry, wantedSetName: string): string | undefined {
  const own = new Set(wantedSetName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const df = wordFrequency();
  const candidates = rival.set.name
    // The language suffix is not part of the product's name, and leaving it in
    // was briefly catastrophic: "Romance Dawn (Japanese)" offered "japanese",
    // which opSetNames strips and therefore scores at frequency zero — the most
    // distinctive word there is. `-japanese` on the Japanese tier rejects the
    // entire market.
    .replace(/\((japanese|english)\)/i, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !own.has(w));
  if (candidates.length === 0) return undefined;
  // A word the corpus has never seen scores LAST, not first. Unknown is not the
  // same as distinctive — it usually means the word came from somewhere other
  // than a set name, which is exactly when excluding on it is a guess.
  const freq = (w: string) => df.get(w) ?? Number.MAX_SAFE_INTEGER;
  return candidates.sort((a, b) => freq(a) - freq(b) || b.length - a.length)[0];
}

function setNamePhrase(entry: OpEntry): string | undefined {
  const segments = entry.set.name
    .split(/[-–—]/)
    .map((part) =>
      part
        .replace(/vol\.?\s*\d+/i, "")
        .replace(/\((japanese|english)\)/i, "")
        .trim()
        .toLowerCase()
    )
    .filter((part) => part.length > 3)
    .sort((a, b) => b.length - a.length);
  return segments[0];
}

/**
 * The rarities that are MUTUALLY EXCLUSIVE — a card is exactly one of these.
 *
 * That is what makes them safe to exclude without a sibling to point at: a
 * listing naming a different tier is a different card. PR is deliberately
 * absent; it says where a card was given out, not how rare it is, so a promo
 * printing carries one of these as well. See deriveQuery for both halves.
 */
const TIER_RARITIES = ["c", "uc", "r", "sr", "sec", "l", "tr", "don"];

/**
 * Tiers that may be searched for but never excluded on.
 *
 * "C" is the cost written in half the titles on eBay — "3000 2c" — and every
 * tokeniser here splits that into "2" and "c". Measured: `-c` deleted a real
 * PRB-01 listing of OP01-024, the exact card its query was built for.
 */
const NON_EXCLUDABLE_RARITIES = new Set(["c"]);

/**
 * A row's rarity as sellers write it: `DON!!` -> `don`, `SEC` -> `sec`.
 *
 * Undefined for the entire Japanese side — all 3,644 JP rows carry no rarity,
 * as do 579 English promos — so this is a signal that is often simply absent,
 * never one to infer from absence. `DON!!` in particular is an explicit value
 * on 244 rows, so a missing rarity does NOT mean a DON card.
 */
function rarityOf(entry: OpEntry): string | undefined {
  return entry.card.rarity?.replace(/[^A-Za-z]/g, "").toLowerCase() || undefined;
}

/** The treatments a row carries, as one comparable key. */
function treatmentKey(name: string): string {
  return treatmentsOf(name)
    .filter((id) => !NON_SEPARATING.has(id))
    .sort()
    .join("+");
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

  // The rows treatment CANNOT separate from this one: same version, different
  // product. See the product-identity comment above for why they are different
  // cards and not the same card twice.
  /**
   * RARITY, as an exclusion only.
   *
   * Required, it is destructive — most sellers do not write it, so ANDing it
   * onto the query throws away the ones who did not. Measured PSA 10,
   * 2026-09-06: `(sr)` took OP09-093 from 5 listings to 1, `(sec)` took
   * OP05-119 from 6 to 5, `(l,leader)` took the OP09-061 Parallel from 40
   * to 23.
   *
   * Excluded, it is close to free, and it catches what nothing else does. The
   * TIER rarities are mutually exclusive — a card is exactly one of C, UC, R,
   * SR, SEC, L, TR or DON!! — so a listing naming a different one is a
   * different card, whatever else its title says. This does NOT need a sibling
   * to justify it, and scoping it to siblings was measurably too narrow:
   * OP09-061 is a Leader and nothing sharing its code is an SR, so a sibling
   * rule stays silent while
   *
   *   "Bandai One Piece CCG Monkey.D.Luffy OP09-061 Alt Art Holo SR English 5000"
   *   "Bandai One Piece CCG Monkey D. Luffy OP09-061 Leader Alt Art Foil SR ENG"
   *
   * sit in the raw tier pricing a card that is not this one. `-sr` removes
   * exactly those two and nothing else (74 -> 72, measured 2026-09-06).
   *
   * PR IS NOT A TIER, and is handled apart. It says WHERE a card was given out,
   * not how rare it is, so a promo printing carries a tier as well — real
   * titles say "SR" and "Promo" together. Excluding the tiers on a PR card
   * would therefore throw away its own listings, and excluding `-pr` from a
   * tiered card would throw away the promo printing only when that printing is
   * genuinely a different card. So PR is excluded only when a SIBLING carries
   * it, which is exactly the 86 of 2,622 codes that carry two rarities —
   * always PR against the set's own (OP01-120 is PR/SEC, OP01-001 is PR/L).
   *
   * `c` is searchable but never excludable, the same asymmetry TREATMENTS uses.
   * Cost is written in titles as "2c", "3c", and every tokeniser in this
   * pipeline splits that into "2" and "c" — `-c` deleted "Monkey D. Luffy
   * OP01-024 Premium Booster -The Best- SR Foil Alt Art 3000 2c", a real
   * listing of the very card that query is for. Every other tier token was
   * measured individually against the same result set and dropped nothing.
   */
  const wantedRarity = rarityOf(wanted);
  const rarityReject = [
    ...new Set([
      ...(wantedRarity && TIER_RARITIES.includes(wantedRarity)
        ? TIER_RARITIES.filter((r) => r !== wantedRarity && !NON_EXCLUDABLE_RARITIES.has(r))
        : []),
      ...(wantedRarity !== "pr" && rows.some((r) => rarityOf(r) === "pr") ? ["pr"] : []),
    ]),
  ];

  const wantedKey = treatmentKey(wanted.card.name);
  const wantedFamily = familyOf(wanted);
  const rivalFamilies =
    wantedIds.length === 0
      ? []
      : [
          ...new Set(
            rows
              .filter((r) => treatmentKey(r.card.name) === wantedKey && familyOf(r) !== wantedFamily)
              .map(familyOf)
          ),
        ];

  // Which side of the split this row is on decides the shape. A card in its
  // code's OWN family is the original and names the rivals to keep them out; a
  // card in any other family is the reprint and must name itself, because a
  // listing that mentions no product at all is far more likely to be the
  // original — that is where the volume is (51 listings against 6).
  const homeFamily = code.split("-")[0].toLowerCase();
  const isHome = wantedFamily === homeFamily;
  const familyAccept = rivalFamilies.length > 0 && !isHome ? familyAliases(wanted) : [];

  /**
   * The OTHER product, excluded BY SET NAME.
   *
   * A treatment exclusion cannot do this job, and OP01-024 is the proof.
   * BerryWallet calls the Romance Dawn printing "(Parallel)"; every seller
   * calls it "Alt Art". So the query dutifully sent `-parallel`, aimed at a
   * word nobody writes, and the original print sailed straight through the
   * search for the PRB one. Two catalogues and a marketplace, three
   * vocabularies for one treatment.
   *
   * A set NAME survives that. Sellers of the original write it — "PSA 10
   * Monkey D. Luffy (Alt Art) Romance Dawn OP01-024 EN One Piece" — and
   * sellers of the reprint do not. Measured PSA 10, 2026-09-06:
   *
   *   OP01-024 EN  19 -> 12 with -"romance dawn"; all 7 dropped say Romance
   *                Dawn, none says PRB. The inverse group returns those same
   *                7, none naming PRB. A clean cut, and two different markets
   *                either side of it: $505-2,000 against $148-719.
   *   OP01-024 JA  19 -> 15, same shape.
   *   OP05-119 EN   6 -> 6. Nothing to lose where the positive PRB term has
   *                already done the work.
   *
   * Away from home, the home family's name is excluded unconditionally: the
   * original is the printing that competes, and the vocabulary mismatch above
   * means treatment terms cannot be trusted to have separated it. At home, the
   * same-treatment rivals are excluded instead — the mirror case, and the only
   * away rows treatment leaves ambiguous.
   */
  const excludedFamilies = isHome ? rivalFamilies : [homeFamily];
  const familyReject =
    wantedIds.length === 0
      ? []
      : [
          ...new Set([
            // The family CODE, but never when it is a prefix of this card's own
            // code: `-op01` on OP01-024 would fight the card number itself.
            // Two-letter families (OP, ST, LT, CM) are out for the same reason
            // — they are prefixes of the tokens sellers write, OP05 and ST21.
            ...excludedFamilies.filter((f) => f.length >= 3 && !code.toLowerCase().startsWith(f)),
            // Both forms of the rival's set name: the phrase a seller writes in
            // full, and the one word they write when they abbreviate it. See
            // setNameWord for why it is one chosen word and not every word.
            ...rows
              .filter((r) => excludedFamilies.includes(familyOf(r)))
              .flatMap((r) => [setNamePhrase(r), setNameWord(r, wanted.set.name)])
              .filter((n): n is string => n !== undefined),
          ]),
        ];

  return {
    queryText: [
      clause(accept),
      clause(familyAccept),
      clause(reject, true),
      clause(familyReject, true),
      clause(rarityReject, true),
    ]
      .filter(Boolean)
      .join(" "),
    acceptGroups: [accept, familyAccept].filter((g) => g.length > 0),
    reject: [...reject, ...familyReject, ...rarityReject],
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
    acceptGroups: [accept],
    reject: [],
    treatment: ids.join(" + ") || product || "(base print)",
    competing: [],
  };
}
