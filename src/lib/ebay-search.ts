import type { EbayCondition, EbayLanguage } from "@/lib/ebay-browse";
import type { Card } from "@/lib/types";

/** eBay's "CCG Individual Cards" category — matches ebay-browse.ts's CCG_INDIVIDUAL_CARDS_CATEGORY. */
const CCG_INDIVIDUAL_CARDS_CATEGORY = "183454";

function ebaySearchUrl(params: Record<string, string>, extraRawParam?: string): string {
  const qs = new URLSearchParams(params);
  const extra = extraRawParam ? `&${extraRawParam}` : "";
  return `https://www.ebay.com/sch/i.html?${qs}${extra}`;
}

/**
 * The "Professional Grader" facet param, exactly as it appears in a real,
 * hand-verified working eBay search URL — double percent-encoded
 * (`Professional%2520Grader=...%2528PSA%2529`, i.e. `%25` + `20`/`28`/`29`,
 * not the single-encoded `%20`/`28`/`29` a standard URLSearchParams would
 * produce). Confirmed by direct testing: the standard single-encoded form
 * does not trigger eBay's filter at all — only this exact double-encoded
 * string does, apparently a quirk of how eBay's frontend parses this
 * specific ad-hoc facet param. Hardcoded verbatim rather than re-derived
 * through nested encodeURIComponent/URLSearchParams calls, since a naive
 * two-pass encode doesn't reproduce it correctly (encodeURIComponent alone
 * never touches parentheses, so composing it with URLSearchParams' own
 * encoding only double-encodes the spaces, not the parens — the actual
 * confirmed string double-encodes both).
 */
const PROFESSIONAL_GRADER_PARAM =
  "Professional%2520Grader=Professional%2520Sports%2520Authenticator%2520%2528PSA%2529";

/**
 * apitcg.com's `product.name` bakes the print-variant descriptor into the
 * name itself for some cards — e.g. "Gengar VMAX (Alternate Art Secret)" —
 * duplicating what `card.rarity` already carries separately ("Secret Rare"
 * etc). That parenthetical is real signal for a human reading the card's
 * own name, but it's noise in a *search query*: comparing two real,
 * hand-tested eBay search URLs for two different cards, the one WITHOUT a
 * parenthetical in its name triggered eBay's filters correctly, and the one
 * WITH one (this Gengar VMAX case) did not — direct evidence that the
 * parenthetical breaks eBay's own query parsing, not just an aesthetic
 * concern. Stripped here, scoped to the search query only — card.name
 * itself (used in page titles, JSON-LD, breadcrumbs, etc.) is untouched.
 *
 * Exported so lib/tcgdex.ts can search TCGdex's catalog using the same
 * clean name — the parenthetical would break TCGdex's own name search the
 * same way it breaks eBay's.
 */
export function cleanCardName(card: Card): string {
  return card.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Search terms shared by the real eBay Browse API query (lib/ebay-browse.ts)
 * and the plain search-link fallback below: "<name> <full number>" (e.g.
 * "Gengar VMAX 271/264"), no dash and no repeated number. An earlier
 * version added "- <full number> <primary number>" to match one specific
 * hand-verified working URL, but a second comparison URL for a different
 * card showed that exact pattern isn't what makes eBay's filters fire — the
 * dash/duplication was incidental to that one example, not load-bearing.
 *
 * `nameOverride` lets a caller substitute a localized name (e.g. TCGdex's
 * French translation, "Ectoplasma" for "Gengar") while reusing the same
 * number-appending logic — French/German/Spanish/Italian prints share the
 * English print's set numbering (only Japanese/Korean/Chinese don't), so
 * the number itself never needs to change, only the name.
 *
 * `numberOverride` is the counterpart for the case French/German/etc DON'T
 * hit: a Japanese print's own set number (e.g. PokéWallet's, via
 * getJapaneseCardText) is frequently a completely different number from the
 * English card's — same card, different print, different local numbering.
 * Searching (or title-matching, see ebay-browse.ts's titleMatchesCard) on
 * card.number there doesn't just fail to help, it actively rejects real
 * Japanese listings whose titles correctly carry the Japanese number instead
 * of the English one.
 *
 * A bare "<name> <number>" query can still false-positive on a different
 * card that shares a name prefix and a loosely-matched number (e.g.
 * "Gengar VMAX 271/264" surfacing a "Gengar V 156/264" listing) — a keyword
 * heuristic extracted from the variant parenthetical (e.g. appending "alt")
 * reduced this for one card in testing, but wasn't kept: hand-picking
 * per-variant keywords isn't a clean, general way to fix a text-match
 * precision problem. Revisit with a more systematic approach if false
 * positives turn out to matter in practice.
 *
 * Every composed string passes through cleanQueryText below before it's
 * returned — see that function's own comment for why.
 *
 * `nameOverride` distinguishes "" from `undefined`: `undefined` means "use
 * the default", but `""` means "no name at all" — a bare `<number>` (or
 * `<number> <condition>`) query, which cleanQueryText's own whitespace
 * collapse makes exactly as clean as a real name would. One Piece uses this
 * deliberately (see graded-market.ts's own comment) — a bare card-number
 * query reliably finds real listings; the caller doesn't need this function
 * to also guess at a variant-specific name.
 */
export function cardSearchTerms(card: Card, nameOverride?: string, numberOverride?: string): string {
  const name = nameOverride ?? cleanCardName(card);
  const number = numberOverride ?? card.number;
  return cleanQueryText(number ? `${name} ${number}` : name);
}

/**
 * Strips punctuation that breaks eBay's own `_nkw` matching rather than
 * helping it, and is common in exactly the kind of raw catalog name this
 * function's caller substitutes in via `nameOverride` (e.g. BerryWallet's
 * own One Piece names, see graded-market.ts). Confirmed live: BerryWallet's
 * `Eustass"Captain"Kid` — quote marks jammed directly against the letters,
 * unlike how real sellers write it ("Eustass "Captain" Kid", with spaces) —
 * took a search from real, well-matched listings to zero results and no
 * fallback at all; replacing each quote/apostrophe character with a space
 * (never deleting it outright, which would instead merge the surrounding
 * words together) recovered them. General on purpose, not a One Piece
 * special case: this runs on every query this function builds, Pokémon
 * included — a card whose real name carries an apostrophe (e.g. Pokémon's
 * own "Farfetch'd") would hit the identical failure mode the moment one
 * gets tracked, and this is what stops that from ever needing its own fix.
 */
function cleanQueryText(text: string): string {
  return text
    .replace(/["'‘’“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Per-condition-tier fallback link — used by GradedMarketPanel when the real
 * eBay Browse API search for that specific tier isn't available (no
 * credentials, request failed, no results), so there's still a real,
 * working place to click through to instead of an empty cell.
 *
 * Every param here is copied from real, hand-verified "perfect results"
 * eBay search URLs (not guessed): `_dcat`/`_sacat` for category, `Language`
 * for card language, `_from=R40` (carried over for fidelity though its
 * exact effect is unconfirmed), and for graded tiers `Graded=Yes` + `Grade`
 * (bare number) + `Professional Grader` (exact value "Professional Sports
 * Authenticator (PSA)") + `_fsrp=1`; for Raw, `Graded=No` instead and none
 * of the grade-specific params.
 *
 * `_sop=10` (eBay's own code for "Time: newly listed") is deliberate, not
 * incidental — confirmed live comparing two otherwise-identical searches for
 * the same One Piece card: without it (the default, Best Match) eBay blends
 * real exact-keyword matches together with looser related items into one
 * undivided list; with it, eBay visibly separates the two — a small "exact
 * match" cluster, then a labeled "Results matching fewer words" section
 * below it for everything else. Best Match alone can't be told apart from
 * that blended state by a human clicking through. This also matches what
 * lib/ebay-browse.ts's own real API search already prefers — its primary
 * attempt is `sort: "newlyListed"`, only falling back to Best Match if that
 * comes back empty — so the human-facing fallback link and the real search
 * behind the panel are now consistent instead of one defaulting to the
 * weaker mode.
 *
 * Deliberately NOT restricted to Buy-It-Now (no `LH_BIN=1`), unlike the
 * real API search in lib/ebay-browse.ts which does restrict to fixed-price
 * — this is a link a human clicks through to browse, and excluding
 * auctions would hide exactly the kind of listing (an auction closing
 * soon) a buyer browsing "all listings" would most want to catch. The API
 * search's own fixed-price restriction is about keeping *our* displayed
 * median a stable, comparable number, not about what's worth browsing.
 *
 * `nameOverride`/`numberOverride` are threaded straight through to
 * cardSearchTerms — see its doc comment.
 */
export function conditionSearchLink(
  card: Card,
  condition: EbayCondition,
  language: EbayLanguage = "English",
  nameOverride?: string,
  numberOverride?: string
): string {
  const terms = cardSearchTerms(card, nameOverride, numberOverride);
  const nkw = condition === "Raw" ? terms : `${terms} ${condition}`;
  const params: Record<string, string> = {
    _dcat: CCG_INDIVIDUAL_CARDS_CATEGORY,
    _sacat: "0",
    _from: "R40",
    _nkw: nkw,
    rt: "nc",
    Language: language,
    // See this function's own doc comment on why "newly listed" sort,
    // not Best Match.
    _sop: "10",
  };
  if (condition === "Raw") {
    params.Graded = "No";
    return ebaySearchUrl(params);
  }
  params.Graded = "Yes";
  params.Grade = condition.replace("PSA ", "");
  params._fsrp = "1";
  return ebaySearchUrl(params, PROFESSIONAL_GRADER_PARAM);
}
