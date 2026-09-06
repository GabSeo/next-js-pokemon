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
 * OP05 original and the PRB-01 reprint were one card told apart only by a slab
 * label, so their listings could be merged.
 *
 * WHETHER A REPRINT IS THE SAME CARD DEPENDS ON THE TREATMENT, and both answers
 * are real:
 *
 *   SEC Alt Art  PRB-01 gets its OWN artwork. OP05-119's Premium Booster print
 *                is not the Awakening print redrawn or restamped, it is a
 *                different picture — confirmed by the owner of the card.
 *   Manga Rare   PRB-01 keeps the exact manga panel, always. Bandai cannot
 *                reissue a manga artwork under a code that already has one; a
 *                new manga drawing for the same character gets a NEW code in a
 *                new set. Only production changes — a "PRB01" text watermark,
 *                ink, foil texture.
 *
 * The market says the same thing, which is the useful corroboration since a
 * price is what this file exists to produce. Measured PSA 10, 2026-09-06:
 *
 *   OP05-074 Manga Rare   OG median $1,475 (10)  PRB-01 $1,600  (4)   +8%
 *   OP05-119 SEC Alt Art  OG median   $790 (45)  PRB-01   $400  (6)   -49%
 *                     JA  OG median   $542 (28)  PRB-01   $211 (13)   -61%
 *
 * So the split is per TREATMENT — see reprintedIdentically below.
 *
 * NAME generates nothing, still.
 *
 * So treatments and products generate query terms; names do not. That
 * distinction removes every guard an earlier version needed — minimum token
 * length, year filtering, a forbidden-word list to stop "Luffy Deck" emitting
 * `luffy`, a short-but-real allowlist for "SP" — because none of those strings
 * is a treatment and none was ever eligible.
 */
import { opRowsForCode, opSetFamily, type OpEntry } from "@/lib/one-piece-catalog";
import { opProductVocabulary, opSetVocabulary } from "@/data/one-piece-sets";

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
   * This treatment's reprints ALWAYS carry the original artwork, so a product
   * can never be grounds for splitting them.
   *
   * Manga is the case, and it is a rule rather than an observation: Bandai
   * cannot reissue a manga panel under a code that already has one. A new manga
   * drawing for the same character gets a NEW code in a new set. So a Manga
   * Rare reprinted into PRB-01 is the same card, differing only by a "PRB01"
   * text watermark, ink and foil texture.
   *
   * The market agrees, which is what a price cares about. OP05-074 PSA 10,
   * 2026-09-06: the OG Awakening print ran 10 listings, $1,200-2,500, median
   * $1,475; the PRB-01 reprint 4 listings, $1,399-3,100, median $1,600 —
   * overlapping ranges, medians 8% apart.
   *
   * IT DOES NOT GENERALISE TO ALT ART, confirmed twice and at two rarities. A
   * PRB-01 reprint of an alt art is a NEW picture:
   *
   *   OP05-119  SEC  English OG median $790 across 45 listings against PRB-01's
   *                  $400 across 6; Japanese $542 across 28 against $211 across
   *                  13. Half the price on both tiers.
   *   OP01-024  SR   Same answer from the card's owner. Its PRB-01 print is not
   *                  the Romance Dawn Parallel's artwork.
   *
   * Which is why alt art is not flagged and manga is, and why OP01-024's query
   * has to NAME the product: once Parallel and Alt Art merged into one
   * treatment (see the entry below), nothing else tells the two printings
   * apart. Drop that product group and the OG Romance Dawn Parallel floods in —
   * 26 English PSA 10 listings instead of 8, at $135-245, none of them saying
   * "Romance Dawn" for an exclusion to catch.
   *
   * Splitting is therefore the default and this flag is the exception, because
   * the errors are not symmetric: splitting printings that should be grouped
   * only narrows a search, while grouping printings that should be split quotes
   * one card's price as another's.
   */
  reprintedIdentically?: true;
  /**
   * The broader treatment this one IS a kind of.
   *
   * Every Manga Rare is an alternate art. So a card labelled "(Alternate Art)
   * (Manga)" is not two things, it is one thing named twice, and searching for
   * both is worse than redundant: the terms are ORed, so `alt` lets in the
   * SEPARATE plain Alternate Art printing the same code also has.
   *
   * Measured on OP05-074 PSA 10, 2026-09-06. `(alt,alternate,alternative,
   * altart,manga)` returns 22 listings spanning $69.99-3,100, and its four
   * cheapest — the ones the panel actually displays — are plain Alt Arts at
   * $69.99, $80, $84.99 and $120, none of them this card. `(manga)` alone
   * returns 14, every one the Manga Rare, $1,200-3,100.
   *
   * So when a card carries a treatment and something that treatment implies,
   * only the specific one generates POSITIVE terms. The broad one is still what
   * a sibling gets excluded on.
   */
  implies?: string;
  excludable?: false;
}[] = [
  // PARALLEL IS ALT ART. Bandai's early sets say "Parallel" and its later ones
  // say "Alternate Art" for the same thing, and this used to be two treatments,
  // which made them look like competing printings of one code. They are not:
  //
  //   - Across 10,689 corpus rows, NO code carries a Parallel row and a
  //     separate Alternate Art row. Two treatments would collide somewhere;
  //     these never do. 174 rows say parallel, 504 say alt art.
  //   - The two rows that carry both say "(Parallel) (Manga) (Alternate Art)" —
  //     one card named three ways, not three versions.
  //   - Sellers write them together: "PSA 10 Luffy OP01-024 SR Parallel Alt Art
  //     THE BEST PRB-01". Splitting them meant OP01-024 emitted `-parallel`
  //     against its own card, discarding two real Japanese PSA 10 listings.
  //
  // Merging also drops `-parallel` everywhere, which cost nothing: the 2nd
  // Anniversary promo, the one card that relied on it, returns 32 PSA 10 and 10
  // raw listings either way.
  {
    id: "alternate-art",
    match: /\balt(ernate)?\s*art\b|\bparallel\b/i,
    terms: ["alt", "alternate", "alternative", "altart", "parallel"],
    excludable: false,
  },
  { id: "manga", match: /\bmanga\b/i, terms: ["manga"], reprintedIdentically: true, implies: "alternate-art" },
  // Sellers write the short form. Measured in docs/ebay-market-pipeline.md:
  // "Wanted Poster OP09-093 PSA 10" returns 3 results and 0 survive the title
  // check, while "Wanted OP09-093 PSA 10" returns 7 real matches.
  { id: "wanted-poster", match: /\bwanted\s*poster\b/i, terms: ["wanted"] },
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
 * The terms sellers write for a product, from data/one-piece-sets.ts.
 *
 * A LOOKUP, not a derivation. This used to shorten a product name to its first
 * two words, which broke three ways at once: 45 of the 249 products that can
 * generate a term collided with another product ("Judge Pack Vol. 2" through
 * "Vol. 7" all becoming `judge pack`), alternate character names came through
 * as products because productOf returns any non-treatment parenthetical, and
 * "2nd Anniversary Set" needs its tail dropped while "Judge Pack Vol. 2" needs
 * its tail kept — no single rule reads both ways.
 *
 * An unlisted product contributes nothing rather than a guess, and the crawl
 * reports it so the gap is a line to add rather than a query that silently
 * stopped separating a printing.
 */
function productTerms(product: string): string[] {
  return opProductVocabulary(product)?.terms ?? [];
}

/** The single token safe to exclude a rival product on, when it has one. */
function productExclusion(product: string): string | undefined {
  return opProductVocabulary(product)?.exclude ?? undefined;
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
 * NOT the OP05 SEC Alt Art: a Premium Booster SEC Alt Art is its own artwork.
 * (A Manga Rare's reprint is not — see reprintedIdentically.)
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

  /**
   * The PRODUCTS the siblings were given out in, excluded the same way their
   * treatments are.
   *
   * This was the last asymmetry in the model. A sibling's treatment became an
   * exclusion, its product family became one, its rarity became one — but the
   * product itself never did, so the OP09-061 Parallel had nothing keeping the
   * 2nd Anniversary Set promo out. That only worked by accident, because the
   * promo's own query names its product and the Parallel's names a treatment;
   * a listing writing both would have satisfied both cards.
   *
   * Measured free on every tracked card that has such a sibling, PSA 10 and
   * raw: OP09-061 Parallel 40/40 and 73/73, OP09-004 5/5 and 7/7, OP09-093 5/5
   * and 7/7, ST21-014 5/5 and 8/8 — that last one carrying `-"luffy deck"` on a
   * Luffy card, which is safe only because a quoted phrase demands adjacency.
   * Inert today, then, and the point is that it stops being an accident.
   *
   * A term equal to this card's OWN product is skipped, or "CS 2023 Event Pack"
   * and "CS 2023 Event Pack Finalist Ver." would exclude each other: both
   * shorten to the same two words.
   */
  const ownProduct = productOf(wanted.card.name);
  const ownExclusion = ownProduct ? productExclusion(ownProduct) : undefined;
  const productReject = [
    ...new Set(
      rows
        .map((r) => productOf(r.card.name))
        .filter((p): p is string => p !== undefined && p !== ownProduct)
        .map(productExclusion)
        .filter((t): t is string => t !== undefined && t !== ownExclusion)
    ),
  ];
  // Only the most specific treatments generate positive terms: "(Alternate Art)
  // (Manga)" searches on `manga` alone, because every Manga Rare is an alt art
  // and naming both would OR the plain Alt Art printing back in. See `implies`.
  const impliedIds = new Set(
    wantedIds.map((id) => TREATMENTS.find((t) => t.id === id)?.implies).filter((id): id is string => id !== undefined)
  );
  const specificIds = wantedIds.filter((id) => !impliedIds.has(id));
  const accept = wantedIds.length > 0 ? termsFor(specificIds) : product ? productTerms(product) : [];
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
  /**
   * The family the CODE itself names — OP09-061's own set is OP09.
   *
   * The fallback exists because a starter deck's code and its set code do not
   * agree: `ST21-014` yields `ST21`, while the set `ST-21` yields the family
   * `ST`. Without it no ST card ever recognised itself as at home, and ST cards
   * are exactly the ones that get reprinted — Bandai puts them in Premium
   * Booster sets, in bonus packs inside premium decks, and in the early errata
   * revision packs, though never in a standard booster.
   *
   * The exact prefix wins when a row actually carries it, so OP09-061 resolves
   * to OP09 rather than falling back to the OP promo family.
   */
  const codePrefix = code.split("-")[0].toLowerCase();
  const familiesPresent = new Set(rows.map(familyOf));
  const homeFamily = familiesPresent.has(codePrefix) ? codePrefix : codePrefix.replace(/\d+$/, "");
  const isHome = wantedFamily === homeFamily;
  // No positive product term when the card's own treatment is one that reprints
  // unchanged: naming a product would split the very printings being grouped.
  const reprintsUnchanged = wantedIds.some((id) => TREATMENTS.find((t) => t.id === id)?.reprintedIdentically);
  const familyAccept =
    rivalFamilies.length > 0 && !isHome && !reprintsUnchanged
      ? (opSetVocabulary(wantedFamily)?.terms ?? [wantedFamily])
      : [];

  /**
   * EVERY other product this code was printed in, excluded by set name.
   *
   * A treatment exclusion cannot do this job, and OP01-024 is the proof.
   * BerryWallet calls the Romance Dawn printing "(Parallel)" and the PRB-01 one
   * "(Alternate Art)", but those are the same treatment under two names, so no
   * treatment term separates them at all — the original print sailed straight
   * through the search for the reprint. What actually differs is the PRODUCT.
   *
   * A set NAME survives that. Sellers of one printing write its product and
   * sellers of another do not. Measured PSA 10, 2026-09-06:
   *
   *   OP01-024 EN  19 -> 12 with -"romance dawn"; all 7 dropped say Romance
   *                Dawn, none says PRB. Two markets either side of that cut,
   *                $505-2,000 against $148-719.
   *   OP01-024 JA  19 -> 15, same shape.
   *   OP05-119     6 -> 6, 13 -> 13, 9 -> 9 across EN PSA 10, JA PSA 10 and raw
   *                once EVERY rival product is named, not just the origin.
   *
   * ALL other families, not only the origin. A code can be printed in six
   * products — OP05-119 is in OP-PR, OP05, OP09, OP11, PRB-01 and CM — and
   * naming one of them leaves the rest to treatment terms that may not separate
   * them.
   *
   * THE WORD COMES ONLY FROM THE HOME SET, and that restriction is the whole
   * safety story. A code's own set is always a real numbered product; any other
   * family may be a catalogue bucket whose name means nothing to a seller.
   * "Premium Bandai Products" would contribute `-bandai`, its rarest word,
   * against titles that overwhelmingly begin with "Bandai". Everything that is
   * not the home set therefore contributes its full phrase only, which cannot
   * misfire on a single common word.
   *
   * A DECK NEVER CONTRIBUTES A WORD EITHER, home or not. All 36 deck names in
   * the corpus describe their contents rather than a theme — "Starter Deck 26:
   * PURPLE/BLACK Monkey.D.Luffy", "Starter Deck 23: RED Shanks", "Starter Deck
   * EX: Gear 5" — so their distinctive word is the card's own colour or its
   * character. Measured: `-purple` cost the OP09-061 Parallel two real raw
   * listings, both titled "PURPLE BLACK … Leader Alt Art", and `-gear` would hit
   * every Gear 5 Luffy on the site. The other 53 names are themes — Romance
   * Dawn, Paramount War, Kingdoms of Intrigue — and their words measured free.
   */
  /**
   * The treatments this card carries that survive a reprint unchanged — see
   * reprintedIdentically. A family holding one of them is the SAME card in a
   * different wrapper, so it is grouped rather than excluded. That is what
   * keeps OP05-074's four PRB-01 Manga listings in its own market instead of
   * discarding a median that sits 8% from the original print's.
   */
  const regrouped = new Set(wantedIds.filter((id) => TREATMENTS.find((t) => t.id === id)?.reprintedIdentically));
  /**
   * Does this family hold a printing of the SAME artwork?
   *
   * Two ways it can. It carries the treatment itself — PRB-01's "(Manga)" row
   * against OP05's "(Alternate Art) (Manga)". Or it carries a plain "Reprint",
   * which is by definition an existing artwork printed again: OP09-004's only
   * PRB-01 row is labelled exactly that, and without this second arm a Manga
   * Rare whose reprint BerryWallet happened to file under "Reprint" would be
   * split from itself.
   *
   * Safe because grouping only ever REMOVES an exclusion. The positive terms
   * still gate: a PRB-01 listing has to say "manga" to be accepted at all, so
   * admitting the family cannot let a base-card reprint in.
   */
  const sharesRegroupedTreatment = (family: string) =>
    regrouped.size > 0 &&
    rows.some((r) => {
      if (familyOf(r) !== family) return false;
      const ids = treatmentsOf(r.card.name);
      return ids.some((id) => regrouped.has(id)) || ids.includes("reprint");
    });

  const excludedFamilies = [...familiesPresent].filter((f) => f !== wantedFamily && !sharesRegroupedTreatment(f));
  /**
   * ONE token per rival product, straight from data/one-piece-sets.ts: the
   * short name a seller actually writes.
   *
   * That table replaced a derivation that emitted a long phrase AND a rare word
   * for every rival, producing queries like `-"unnumbered promos" -"one piece
   * promotion cards" -"awakening of the new era" -awakening -"emperors in the
   * new world" -"a fist of divine speed"`. Most of those names are Cardmarket
   * catalogue buckets no seller has ever typed, and every one measured zero
   * effect. See that file's header for which products are excludable and why
   * decks and buckets are not.
   */
  const familyReject = [
    ...new Set(
      excludedFamilies
        .map((f) => opSetVocabulary(f)?.exclude)
        .filter((t): t is string => typeof t === "string")
        // Never a token the card's own code contains: `-op01` on OP01-024 would
        // fight the card number itself.
        .filter((t) => !code.toLowerCase().includes(t))
    ),
  ];

  return {
    queryText: [
      clause(accept),
      clause(familyAccept),
      clause(reject, true),
      clause(productReject, true),
      clause(familyReject, true),
      clause(rarityReject, true),
    ]
      .filter(Boolean)
      .join(" "),
    acceptGroups: [accept, familyAccept].filter((g) => g.length > 0),
    reject: [...reject, ...productReject, ...familyReject, ...rarityReject],
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
  const accept = ids.length > 0 ? termsFor(ids) : product ? productTerms(product) : [];
  if (accept.length === 0) return undefined;
  return {
    queryText: clause(accept),
    acceptGroups: [accept],
    reject: [],
    treatment: ids.join(" + ") || product || "(base print)",
    competing: [],
  };
}
