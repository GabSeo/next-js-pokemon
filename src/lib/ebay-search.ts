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
 */
function cleanCardName(card: Card): string {
  return card.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Search terms shared by the real eBay Browse API query (lib/ebay-browse.ts)
 * and the plain search-link fallback below: "<clean name> <full number>"
 * (e.g. "Gengar VMAX 271/264"), no dash and no repeated number. An earlier
 * version added "- <full number> <primary number>" to match one specific
 * hand-verified working URL, but a second comparison URL for a different
 * card showed that exact pattern isn't what makes eBay's filters fire — the
 * dash/duplication was incidental to that one example, not load-bearing.
 */
export function cardSearchTerms(card: Card): string {
  const name = cleanCardName(card);
  return card.number ? `${name} ${card.number}` : name;
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
 * exact effect is unconfirmed), and for graded tiers `Graded=Yes` +
 * `Grade` (bare number) + `Professional Grader` (exact value "Professional
 * Sports Authenticator (PSA)") + `_fsrp=1`; for Raw, `Graded=No` instead
 * and none of the grade-specific params. `Graded=Yes` was missing from an
 * earlier version — a second confirmed URL showed graded searches need it
 * explicitly, not just the grade-specific params on their own.
 */
export function conditionSearchLink(card: Card, condition: EbayCondition, language: EbayLanguage = "English"): string {
  const nkw = condition === "Raw" ? cardSearchTerms(card) : `${cardSearchTerms(card)} ${condition}`;
  const params: Record<string, string> = {
    _dcat: CCG_INDIVIDUAL_CARDS_CATEGORY,
    _sacat: "0",
    _from: "R40",
    _nkw: nkw,
    rt: "nc",
    Language: language,
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
