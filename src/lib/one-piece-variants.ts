/**
 * Derives an eBay query and title filter for a One Piece card from the
 * catalogue, instead of from a hand-written `ebayVariantTags` on the ref.
 *
 * THE PROBLEM IT SOLVES. A card code is an identity, not a printing: 1,084 of
 * 2,865 codes carry more than one treatment, and OP05-119 spans plain /
 * Alternate Art / Manga / SP / SP Gold / Reprint at EUR 4.49 to EUR 7,500. A
 * query that cannot tell those apart will put an EUR 8,000 Manga in an EUR 283
 * card's median. Until now the discrimination came from tags typed per card.
 *
 * TWO AXES, AND ONLY ONE OF THEM DISCRIMINATES:
 *
 *   treatment  Alt Art vs Manga vs SP vs plain   MUST separate — 28x apart
 *   product    OP05 original vs PRB-01 reprint   GROUP — same artwork, USD
 *                                                208.30 vs 215.13, and a PSA
 *                                                slab is the only thing that
 *                                                tells them apart
 *
 * Grouping by artwork and never across treatments is the rule this file
 * encodes. It is also why "PRB" is NOT emitted as a required token any more:
 * `Manga` exists inside PRB-01 too, so excluding on the product would have been
 * wrong even when it looked like it was working.
 *
 * WHY THE QUERY IS AN OR GROUP AND THE FILTER IS A REJECT LIST.
 *
 * eBay's `q` is AND — every extra word narrows. Measured: `PRB alt OP01-024
 * PSA 10` returns 0 PSA 10s because those sellers write "Alternate" and eBay
 * tokenises, so `alt` never matches. Parenthesised comma groups are OR, and
 * that IS honoured by the Browse API (measured on OP05-119: bare code 656
 * results, OR group 171, so it filters rather than being ignored). Exclusion
 * with `-` works too (171 -> 144 with `-manga`).
 *
 * But an OR group is not universally wider. Measured on OP01-024: the bare
 * keyword `Alternate` returns 76 while `(alt,alternate,"alt art","alternate
 * art")` returns 43 — eBay expands a bare term and matches group members more
 * literally. So the OR group is emitted only when the treatment has genuinely
 * divergent spellings, and the reject list does the rest of the work.
 */
import { opRowsForCode, opTreatment, type OpEntry } from "@/lib/one-piece-catalog";

/**
 * How sellers write a treatment. The ONLY hand-maintained piece here, and it is
 * a table of English TCG vocabulary rather than a fact about any card — one
 * entry serves every card sharing that treatment.
 *
 * `alt` and `alternate` are both listed because they are not interchangeable to
 * eBay: OP05-119's sellers write "Alt Art", OP01-024's write "Alternate Art",
 * and a query carrying only one of them starves on the other card.
 */
const TREATMENT_ALIASES: [RegExp, string[]][] = [
  [/alternate art|alt art/i, ["alt", "alternate"]],
  [/\bmanga\b/i, ["manga"]],
  [/\bparallel\b/i, ["parallel"]],
  [/wanted poster/i, ["wanted"]],
  [/\bgold\b/i, ["gold"]],
  [/\bsilver\b/i, ["silver"]],
  [/\bjumbo\b/i, ["jumbo"]],
  [/\breprint\b/i, ["reprint"]],
  [/2nd anniversary|2 anniversary/i, ['"2nd anniversary"', '"2 anniversary"']],
  [/3rd anniversary|3 anniversary/i, ['"3rd anniversary"', '"3 anniversary"']],
];

/**
 * Words that must never enter a reject list, however they appear in a competing
 * print's name.
 *
 * ST21-014 is the case that forced this. Its competing row is named "Luffy
 * Deck", and a naive "first word of the competing treatment" rule produced
 * `luffy` — which would reject essentially every listing for a Monkey D. Luffy
 * card and leave a tier that reads "nobody is selling this" rather than "our
 * filter is broken". The character's own name is always in the title; it can
 * never be evidence of the wrong print.
 */
function forbiddenRejectTokens(displayName: string): Set<string> {
  const out = new Set<string>();
  for (const word of displayName.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 2) out.add(word);
  }
  // "one piece" is in every listing on the site.
  out.add("one");
  out.add("piece");
  return out;
}

/** Tokens shorter than this collide with everything — "CS", "V1", "Ver". */
const MIN_REJECT_TOKEN = 4;

/**
 * A four-digit year is never evidence of the wrong print.
 *
 * P-033's competing row is "CS 2023 Event Pack", so `2023` became a reject
 * token — and real listings for the WANTED card are routinely titled "Event
 * Pack Vol 2 2023", because that is the year it was printed. Measured: it cut
 * a 9-listing tier to 5. Sellers put the year in almost every title; it
 * separates nothing.
 */
function isYear(token: string): boolean {
  return /^(19|20)\d{2}$/.test(token);
}

/**
 * Short treatment names that are real prints and must still be rejectable.
 *
 * MIN_REJECT_TOKEN exists to stop two-character noise, but it also silently
 * dropped "SP" — which on OP05-119 is a EUR 7,500 print against an EUR 283
 * card, the single most expensive thing that filter has to keep out. These are
 * matched as whole words by the caller rather than as substrings, so "sp" does
 * not fire on "spectacular".
 */
const SHORT_BUT_REAL = new Set(["sp"]);

export type DerivedQuery = {
  /** Extra query text appended to the card code, or "" for none. */
  queryText: string;
  /** Words a title must contain at least ONE of. Empty means no positive requirement. */
  acceptAny: string[];
  /** Words that disqualify a title outright — competing treatments. */
  reject: string[];
  /** What the wanted row is, for logging and for the audit script. */
  treatment: string;
  /** Treatments this code also carries, before guards. */
  competing: string[];
};

/**
 * Seller spellings for a treatment.
 *
 * A treatment with no alias entry falls back to its OWN distinctive words
 * rather than to nothing. P-033 is why: "Event Pack Vol. 2" matches no alias,
 * and returning an empty list emitted a bare `P-033 PSA 10` with no positive
 * term at all — which is the broad query that surfaces every other print of the
 * code. The fallback keeps words of 4+ characters, so "Vol." and "2" are
 * dropped while "event" and "pack" survive.
 */
function aliasesFor(treatment: string): string[] {
  const out = new Set<string>();
  for (const [re, tokens] of TREATMENT_ALIASES) if (re.test(treatment)) tokens.forEach((t) => out.add(t));
  if (out.size === 0) {
    for (const word of treatment.split(/\s+/)) {
      const clean = word.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (clean.length >= 4) out.add(clean);
    }
  }
  return [...out];
}

/**
 * Reject tokens for one competing treatment, after the guards.
 *
 * Multi-word names contribute every word that survives, not just the first:
 * "Luffy Deck" contributes "deck" once "luffy" is forbidden, where a
 * first-word rule would have contributed the dangerous half and nothing else.
 */
function rejectTokensFor(treatment: string, forbidden: Set<string>): string[] {
  const aliased = aliasesFor(treatment);
  const source = aliased.length > 0 ? aliased : treatment.split(/\s+/);
  return source
    .map((w) => w.replace(/["']/g, "").toLowerCase().trim())
    .filter((w) => (w.length >= MIN_REJECT_TOKEN || SHORT_BUT_REAL.has(w)) && !forbidden.has(w) && !isYear(w));
}

/**
 * Build the query and filter for one card.
 *
 * `wanted` is the row the resolver picked; every other row sharing the code is
 * a competing print unless it carries the SAME treatment, in which case it is
 * the same artwork in a different product and is deliberately grouped in.
 */
export function deriveQuery(code: string, wanted: OpEntry, displayName: string): DerivedQuery {
  const treatment = opTreatment(wanted.card.name);
  const rows = opRowsForCode(code);

  const competing = [
    ...new Set(
      rows
        .map((r) => opTreatment(r.card.name))
        .filter((t) => t && t.toLowerCase() !== treatment.toLowerCase())
    ),
  ];

  const forbidden = forbiddenRejectTokens(displayName);
  // A token that also describes the WANTED treatment cannot reject anything —
  // "Alternate Art" and "Alternate Art (Manga)" share "alternate", so rejecting
  // on it would throw away the card we are looking for.
  const wantedTokens = new Set([
    ...aliasesFor(treatment),
    ...treatment.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
  ]);

  const reject = [
    ...new Set(competing.flatMap((t) => rejectTokensFor(t, forbidden))),
  ].filter((t) => !wantedTokens.has(t));

  const accept = aliasesFor(treatment);
  // An OR group is only worth sending when the treatment has more than one real
  // spelling. With a single token, a bare keyword reaches further — measured.
  const queryText = accept.length > 1 ? `(${accept.join(",")})` : (accept[0] ?? "");

  return { queryText, acceptAny: accept, reject, treatment, competing };
}

/**
 * The entry point graded-market.ts uses: derive from what a resolved Card
 * already carries — its code and BerryWallet print name — without re-resolving
 * anything.
 *
 * Finds the corpus row whose name matches the print name, so the competing
 * treatments come from the catalogue. When the row is NOT in the corpus, the
 * treatment is still read from the print name itself and the reject list comes
 * back empty — a positive query with no exclusions, which is exactly the
 * shipped behaviour and therefore never a regression.
 *
 * That fallback is not hypothetical: crawling all 109 sets is not a superset of
 * the flat /op/search index, and ST21-014's Campaign Pack row lives only in the
 * latter (see scripts/one-piece-crawl.mts).
 */
export function deriveQueryForCard(
  code: string,
  printName: string | undefined,
  displayName: string
): DerivedQuery | undefined {
  if (!printName) return undefined;
  const rows = opRowsForCode(code);
  const match = rows.find((r) => r.card.name === printName) ?? rows.find((r) => r.card.name.includes(printName));
  if (match) return deriveQuery(code, match, displayName);

  // Not in the corpus — positive terms only, no exclusions.
  const treatment = opTreatment(printName);
  if (!treatment) return undefined;
  const accept = aliasesFor(treatment);
  return {
    queryText: accept.length > 1 ? `(${accept.join(",")})` : (accept[0] ?? ""),
    acceptAny: accept,
    reject: [],
    treatment,
    competing: [],
  };
}
