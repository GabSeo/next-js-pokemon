import type { EbayCondition, EbayLanguage } from "@/lib/ebay-browse";
import type { Card } from "@/lib/types";

/** eBay's "CCG Individual Cards" category — matches ebay-browse.ts's CCG_INDIVIDUAL_CARDS_CATEGORY. */
const CCG_INDIVIDUAL_CARDS_CATEGORY = "183454";

function ebaySearchUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params);
  return `https://www.ebay.com/sch/i.html?${qs}`;
}

/**
 * Search terms shared by the real eBay Browse API query (lib/ebay-browse.ts)
 * and the plain search-link fallback below. Format confirmed against a real,
 * hand-verified working eBay search URL: "<name> - <full number> <primary
 * number>" (e.g. "Ethan's Typhlosion - 190/182 190") — includes the full
 * "190/182" *and* repeats the bare "190", dropping only the set name.
 * Earlier versions of this dropped the full number entirely; that was wrong
 * — the working example keeps it.
 */
export function cardSearchTerms(card: Card): string {
  if (!card.number) return card.name;
  const primaryNumber = card.number.split("/")[0];
  return `${card.name} - ${card.number} ${primaryNumber}`;
}

/**
 * Per-condition-tier fallback link — used by GradedMarketPanel when the real
 * eBay Browse API search for that specific tier isn't available (no
 * credentials, request failed, no results), so there's still a real,
 * working place to click through to instead of an empty cell.
 *
 * Every param here is copied from a real, hand-verified "perfect results"
 * eBay search URL (not guessed): `_dcat` for category, `Language` for card
 * language, and for graded tiers `Grade` (bare number) + `Professional
 * Grader` (exact value "Professional Sports Authenticator (PSA)") +
 * `_fsrp=1`; for Raw, `Graded=No` instead. `rt=nc` is carried over from that
 * same URL even though its exact effect is unconfirmed, for fidelity to the
 * example rather than guessing which params are load-bearing.
 */
export function conditionSearchLink(card: Card, condition: EbayCondition, language: EbayLanguage = "English"): string {
  const nkw = condition === "Raw" ? cardSearchTerms(card) : `${cardSearchTerms(card)} ${condition}`;
  const params: Record<string, string> = {
    _dcat: CCG_INDIVIDUAL_CARDS_CATEGORY,
    _nkw: nkw,
    rt: "nc",
    Language: language,
  };
  if (condition === "Raw") {
    params.Graded = "No";
  } else {
    params.Grade = condition.replace("PSA ", "");
    params["Professional Grader"] = "Professional Sports Authenticator (PSA)";
    params._fsrp = "1";
  }
  return ebaySearchUrl(params);
}
