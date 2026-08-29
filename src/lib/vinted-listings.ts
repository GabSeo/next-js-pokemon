import {
  hasLobstrCredentials,
  pinnedVintedRunHash,
  resolveVintedResults,
  VINTED_RESULTS_PER_CARD,
  vintedSquidHash,
} from "@/lib/lobstr";
import { cleanCardName } from "@/lib/ebay-search";
import { getLocalizedName } from "@/lib/tcgdex";
import { vintedSearchLink } from "@/lib/vinted-search";
import type { Card } from "@/lib/types";

/**
 * The Vinted domain layer: turns raw Lobstr result rows (lib/lobstr.ts)
 * into listings this site is willing to show, and decides which card each
 * one belongs to.
 *
 * THE ONE FILTER THAT MATTERS: only listings whose condition is "Très bon
 * état" survive. Not "the best of what's available", not a ranking — a hard
 * filter. Vinted's other tiers (Bon état, Satisfaisant, Neuf avec/sans
 * étiquette) are excluded, so the feed answers one question only: what's
 * for sale that the seller has clearly described as très bon état. That's
 * also why every rendered row carries the same single condition tag instead
 * of a per-row condition: there is only one condition on screen, by
 * construction.
 *
 * It's enforced twice, in two independent places:
 *
 *   1. Vinted itself, server-side, via `status_ids[]=2` on the task URL
 *      (lib/vinted-search.ts) — so the scrape only ever visits pages of
 *      très bon état listings, and no credits are spent on tiers we'd
 *      throw away.
 *   2. Here, on each returned row (toVintedListing), as a guard against a
 *      stale task queued before the filter existed or a mislabelled row.
 *
 * Consequence worth stating plainly: this feed is intentionally sparser
 * than the underlying Vinted search. A card whose recent listings are all
 * "Bon état" shows zero real rows here and falls back to the panel's
 * clearly-marked preview — which is the honest outcome, not a bug to widen
 * the filter for.
 */

/** The single condition tag this feed ever shows, in Vinted's own French wording. */
export const TRES_BON_ETAT = "Très bon état";

/**
 * Accent- and case-insensitive comparison key, used for both condition
 * labels and listing titles. Everything here arrives from a scraper, not a
 * typed enum: "Très bon état", "TRÈS BON ÉTAT" and a de-accented "Tres bon
 * etat" are the same tier and all three are plausible in the same result
 * set — and the same is true of "Ectoplasma" in a seller-written title.
 */
function normalizeText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Exact matches only, never a substring or fuzzy test. "Clearly described
 * as très bon état" is the whole point of the filter, and a substring test
 * would quietly swallow the tier below it — "bon état" is a literal
 * substring of "très bon état", so `includes("bon etat")` would let every
 * Bon état listing through the filter that exists to exclude them.
 *
 * The English entries cover Lobstr normalising to Vinted's English UI
 * ("Very good" / "Very good condition" are that same tier's labels); they
 * are exact labels too, not a fuzzy allowance.
 */
const TRES_BON_ETAT_LABELS = new Set(["tres bon etat", "very good", "very good condition"]);

export function isTresBonEtat(raw: string | undefined): boolean {
  return raw !== undefined && TRES_BON_ETAT_LABELS.has(normalizeText(raw));
}

/**
 * Per-item field names, confirmed against real output from BOTH surfaces —
 * and they disagree, which is why the lookup is key-normalised rather than
 * exact. The dashboard export shouts and spaces them (`IMAGE URL`, `INPUT
 * URL`); /v1/results uses snake_case (`image_url`, `scraping_time`). Both
 * normalise to the same key (see normalizeKey), so neither surface needs
 * its own alias list and neither can break the other.
 *
 * That was a guess when it was written and is now a verified one: production
 * returns snake_case, the export returns caps. Betting on either alone would
 * have dropped every row from the other.
 *
 * One field exists only in the export: `INPUT URL`, the task URL a row came
 * from. /v1/results does not return it, so per-card bucketing falls back to
 * matching the card's name and number in the title (see rowMatchesCard).
 *
 * Order is significance order, not preference-of-guess: `price` before
 * `total item price` because the former is the seller's asking price and
 * the latter silently adds Vinted's buyer-protection fee (confirmed in the
 * export: PRICE "1" alongside TOTAL ITEM PRICE "1.75"). Showing a fee-
 * inclusive number in a price comparison would overstate every listing.
 */
const FIELD_ALIASES = {
  condition: ["status", "condition", "item condition", "etat", "état"],
  title: ["title", "name", "item title"],
  price: ["price", "total item price", "item price", "amount"],
  currency: ["currency", "price currency", "currency code"],
  url: ["url", "item url", "product url", "link"],
  image: ["image url", "photo", "photo url", "image", "thumbnail"],
  seller: ["user login", "username", "user", "seller"],
  /**
   * Deliberately does NOT include `collected at`. That's when the scrape
   * ran, identical for every row in a run — presenting it as a per-listing
   * age would tell a reader the whole feed appeared at the same instant.
   * Lobstr reads search-results cards only, and those carry no listing
   * date, so per-row age is simply not available; the UI omits it rather
   * than inventing it.
   */
  timestamp: ["listed at", "published at", "created at"],
  /** The task URL a row was scraped from — Lobstr echoes it as INPUT URL, which makes per-card bucketing exact instead of inferred. */
  sourceUrl: ["input url", "task url", "source url", "search url"],
  /**
   * When the scrape ran — surfaced once as feed-level freshness, never per
   * row. `scraping_time` is what /v1/results calls it; `collected at` is
   * what the dashboard export calls the same field. Both are listed because
   * both surfaces are real.
   */
  collectedAt: ["scraping time", "collected at"],
} as const;

/**
 * Case, space, underscore and hyphen insensitive key matching. Lobstr's
 * export says `IMAGE URL`; a different surface might say `image_url` or
 * `imageUrl`. All three normalise to `imageurl`, so the alias lists above
 * stay short and none of this depends on guessing a casing convention.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Row keys normalised once per row, so a lookup across nine alias lists doesn't rescan the object nine times. */
function normalizedRow(row: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeKey(key);
    // First writer wins, so an exact-ish match isn't clobbered by a later
    // key that happens to normalise the same way.
    if (!map.has(normalized)) map.set(normalized, value);
  }
  return map;
}

function readString(row: Map<string, unknown>, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const value = row.get(normalizeKey(alias));
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/**
 * Prices can arrive as a number (12.5) or as display text ("12,50 €",
 * "€12.50", "1 234,00"). Handles the French decimal comma and thousands
 * separators; returns undefined rather than 0 for anything unparseable, so
 * a bad row is dropped instead of dragging the feed's average toward zero
 * (same defensive rule lib/ebay-browse.ts applies to $0 eBay listings).
 */
function readPrice(row: Map<string, unknown>): number | undefined {
  for (const alias of FIELD_ALIASES.price) {
    const value = row.get(normalizeKey(alias));
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value !== "string") continue;

    const digits = value.replace(/[^\d.,]/g, "");
    if (!digits) continue;
    // Whichever separator appears last is the decimal one; the other is a
    // thousands separator. Covers "1,234.56" and "1.234,56" with one rule.
    const lastComma = digits.lastIndexOf(",");
    const lastDot = digits.lastIndexOf(".");
    let normalized = digits;
    if (lastComma > lastDot) {
      normalized = digits.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = digits.replace(/,/g, "");
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/** Vinted France trades in euros; the symbol is only read off the price text when Lobstr doesn't hand over an explicit currency field. */
function readCurrency(row: Map<string, unknown>): string {
  const explicit = readString(row, FIELD_ALIASES.currency);
  if (explicit) return explicit.toUpperCase() === "EUR" ? "EUR" : explicit.toUpperCase();
  const priceText = readString(row, FIELD_ALIASES.price) ?? "";
  if (priceText.includes("£")) return "GBP";
  if (priceText.includes("$")) return "USD";
  return "EUR";
}

export type VintedListing = {
  title: string;
  price: number;
  currency: string;
  url: string;
  imageUrl?: string;
  /** Always TRES_BON_ETAT — nothing else gets past the filter. Kept on the row so the renderer never has to re-assert it. */
  condition: string;
  /** Milliseconds since epoch when Lobstr gave us a parseable listing date. In practice always undefined for this scraper — search-results cards carry no listing date — so the UI shows no per-row age. */
  listedAtMs?: number;
  /** When the scrape ran. Identical across a run, so it describes the FEED's freshness, never one listing's age. */
  collectedAtMs?: number;
  seller?: string;
  /** The task URL this row was scraped from, when Lobstr echoes it — see FIELD_ALIASES.sourceUrl. */
  sourceUrl?: string;
};

function readTimestamp(row: Map<string, unknown>, aliases: readonly string[] = FIELD_ALIASES.timestamp): number | undefined {
  for (const alias of aliases) {
    const value = row.get(normalizeKey(alias));
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      // Unix seconds vs. milliseconds: anything below ~Nov 2286 in ms is a
      // seconds value, so scale it up.
      return value < 1e11 ? value * 1000 : value;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return undefined;
}

/**
 * Vinted's floor price, and the reason a listing sitting on it is not an
 * asking price at all.
 *
 * Sellers list at 1 EUR to run a hidden auction: the number is bait for
 * offers and private negotiation, not what they intend to sell for. The
 * live Gengar feed carried one (1 EUR beside three listings near 800), and
 * so did Lugia's. Treating those as market observations poisons every
 * statistic downstream — the reference price, each row's percentage against
 * it, and the deal-density bar, which was reporting a "bargain" that was
 * really just an auction that hadn't started.
 *
 * These are excluded rather than down-weighted. A hidden auction is not a
 * cheap listing to be robust against; it is a different kind of thing,
 * carrying no price information about this market at all. Robustness
 * (median, see graded-market.ts) is a good default for outliers we haven't
 * anticipated — this one we have.
 *
 * Threshold rather than equality so 0.50 EUR is caught too. Deliberately
 * absolute, not relative to the card's value: the pattern is "list at the
 * platform floor", which does not scale with what the card is worth. A
 * genuinely 1 EUR card exists, but it is a common, and nothing this site
 * tracks trades anywhere near there.
 */
const HIDDEN_AUCTION_PRICE_CEILING = 1;

function isHiddenAuction(price: number): boolean {
  return price <= HIDDEN_AUCTION_PRICE_CEILING;
}

/** Logged at most once per process — a missing condition field is a config note for whoever maintains FIELD_ALIASES, not a per-row event worth flooding the logs with. */
let warnedAboutMissingCondition = false;

/**
 * One raw Lobstr row -> a listing, or null. Returns null for anything
 * missing a price or a URL: a row we can't price or link to isn't a listing
 * a buyer can act on.
 *
 * The condition check is now a SECOND line of defence, not the only one.
 * The scrape itself is constrained to Très bon état by `status_ids[]=2` in
 * the task URL (lib/vinted-search.ts), so Vinted has already filtered
 * server-side before Lobstr ever sees a page. That changes what to do with
 * a row whose condition we can't read:
 *
 * - Condition readable and NOT très bon état -> drop it. Something is wrong
 *   (a stale task queued before the filter existed, a mislabelled row), and
 *   showing it would break the one promise this feed makes.
 * - Condition readable and très bon état -> keep it, obviously.
 * - Condition not readable at all -> KEEP it, and warn. The row came back
 *   from a search Vinted itself restricted to status 2; dropping it would
 *   mean that one wrong guess in FIELD_ALIASES silently empties the entire
 *   feed and pins the site to its preview forever. The seller's structured
 *   condition selection is what "clearly described as très bon état" means
 *   here — arguably better evidence than scraped display text, since it's
 *   the field Vinted's own filter reads.
 */
export function toVintedListing(rawRow: Record<string, unknown>): VintedListing | null {
  const row = normalizedRow(rawRow);
  const condition = readString(row, FIELD_ALIASES.condition);
  if (condition !== undefined && !isTresBonEtat(condition)) return null;

  const price = readPrice(row);
  const url = readString(row, FIELD_ALIASES.url);
  if (price === undefined || !url) return null;
  // A 1 EUR listing is a hidden auction, not an offer — see above.
  if (isHiddenAuction(price)) return null;

  // Warn only for rows that are otherwise real listings. Lobstr appends
  // advertising rows to an export ("Export limit reached - Get the full
  // dataset...") which carry no fields at all; warning on those would send
  // someone hunting for a FIELD_ALIASES bug that isn't there.
  if (condition === undefined && !warnedAboutMissingCondition) {
    warnedAboutMissingCondition = true;
    console.warn(
      `[lobstr] no condition field on a Vinted listing row (looked for: ${FIELD_ALIASES.condition.join(", ")}). ` +
        `Relying on the task URL's status_ids[]=2 filter alone. Keys present: ${Object.keys(rawRow).join(", ")}`
    );
  }

  return {
    title: readString(row, FIELD_ALIASES.title) ?? "Vinted listing",
    price,
    currency: readCurrency(row),
    url,
    imageUrl: readString(row, FIELD_ALIASES.image),
    condition: TRES_BON_ETAT,
    listedAtMs: readTimestamp(row),
    collectedAtMs: readTimestamp(row, FIELD_ALIASES.collectedAt),
    seller: readString(row, FIELD_ALIASES.seller),
    sourceUrl: readString(row, FIELD_ALIASES.sourceUrl),
  };
}

/**
 * The search a card's Vinted task scrapes, and the link the panel's "Search
 * on Vinted" button points at — one function so the scraped query and the
 * clicked-through query can never drift apart.
 *
 * French name when TCGdex has one (a French marketplace gets searched in
 * French — "Ectoplasma", not "Gengar"), English otherwise so the link is
 * always at least usable. The parenthetical variant descriptor is stripped
 * via cleanCardName for the same reason lib/ebay-search.ts strips it.
 */
export async function vintedQueryForCard(card: Card): Promise<{ query: string; displayName: string; searchUrl: string }> {
  const frenchName = card.tcgdexId ? await getLocalizedName(card.tcgdexId, "fr").catch(() => undefined) : undefined;
  const displayName = frenchName ?? cleanCardName(card);
  const query = `${displayName} ${card.number ?? ""}`.trim();
  return { query, displayName, searchUrl: vintedSearchLink(query) };
}

/**
 * Which card a scraped row belongs to — and whether it's plausibly that
 * card at all. Two separate questions, and an earlier version answered only
 * the first.
 *
 * Bucketing is exact: Lobstr echoes the task URL as INPUT URL, so a row is
 * assigned to the card whose search produced it, compared on `search_text`
 * (every task URL shares the same /catalog path, so a path comparison would
 * match every card to every row).
 *
 * Relevance is the part that isn't optional. Vinted pads a thin search with
 * unrelated stock: the live Ectoplasma VMAX search returned "Robe de soirée
 * noir" and "Jean celio bleu W27" among its ten results. Those rows carry
 * the right INPUT URL and a perfectly valid `Très bon état` — bucketing
 * alone would render an evening dress as a Gengar VMAX listing at €10.
 * So the title must also carry the card's own name.
 *
 * The name test requires every word of four or more characters. That length
 * floor drops French articles ("de", "la") and single-letter card suffixes
 * ("Lugia V") which carry no distinguishing signal, while keeping the words
 * that do: "Typhlosion de Luth" needs typhlosion + luth, "Ectoplasma VMAX"
 * needs ectoplasma + vmax. The card's NUMBER is not required when the name
 * alone has 2+ distinguishing words — casual Vinted sellers routinely omit
 * it ("Ectoplasma Vmax Alt" at €780 has no number and is a genuine match) —
 * but IS required when the name is down to one word, like "lugia": a bare
 * "Lugia V" title matched a real, unrelated €12–13 listing, a different and
 * far cheaper print than the 186/195 alt art being searched for. See
 * titleNumberAgreesWithCard's own comment for the full reasoning.
 */
function rowMatchesCard(listing: VintedListing, displayName: string, searchUrl: string): boolean {
  if (!titleMentionsCard(listing.title, displayName)) return false;
  // A single distinguishing word ("lugia") is too weak to trust a bare,
  // number-less title on its own — see titleNumberAgreesWithCard's doc
  // comment on the real €12 false positive this closed.
  const requireNumber = significantWords(displayName).length <= 1;
  if (!titleNumberAgreesWithCard(listing.title, primaryNumberOf(searchUrl), requireNumber)) return false;

  if (listing.sourceUrl) {
    const scraped = searchTextOf(listing.sourceUrl);
    const wanted = searchTextOf(searchUrl);
    if (scraped !== undefined && wanted !== undefined) return scraped === wanted;
    return listing.sourceUrl === searchUrl;
  }
  // No task URL echoed — the title check above is then the only signal, and
  // it has already passed.
  return true;
}

/** The `search_text` a Vinted catalog URL searches for, normalized for comparison; undefined if the URL isn't parseable or carries no search text. */
function searchTextOf(url: string): string | undefined {
  try {
    const value = new URL(url).searchParams.get("search_text");
    return value ? normalizeText(value) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The card's own collector number, taken from the search text the task was
 * built with ("Typhlosion de Luth 190/182" -> "190"). Read from the URL
 * rather than threaded through as another parameter, so the diagnosis
 * endpoint and the render path can't disagree about it.
 */
function primaryNumberOf(searchUrl: string): string | undefined {
  const match = (searchTextOf(searchUrl) ?? "").match(/(\d+)\s*\/\s*\d+/);
  return match?.[1];
}

/** Three or more digits in a row. Shorter runs are too ambiguous to act on — a "2" in "Lot de 2 cartes" is a quantity, not a card number. */
const NUMBER_TOKEN = /\d{3,}/g;

/**
 * Rejects a listing whose title states a DIFFERENT collector number — and,
 * for cards whose name alone is ambiguous, one that states no number either.
 *
 * The name check alone is too weak for cards whose name reduces to a single
 * token: "Lugia V" yields just "lugia" (the "V" is one character), so the
 * live search matched a 138/195 World Championships print, a jumbo promo
 * swsh301, and a two-card lot — €4 to €580 — all averaged together as if
 * they were the 186/195. That average, and the per-listing deal percentages
 * derived from it, would have been meaningless.
 *
 * A wrong stated number was always rejected — it contradicts us, not merely
 * silent. But a bare "Lugia V" (no number at all, confirmed live: a real
 * listing at €12–13, a different and far cheaper print) used to be KEPT,
 * on the theory that plenty of genuine listings omit the number
 * ("Ectoplasma Vmax Alt" at €780 is a real match with none). That theory
 * only holds when the name itself is distinguishing enough to trust alone —
 * for a single-token name like "lugia", omission is silence, not evidence,
 * and the ambiguity that broke the wrong-number case breaks this case too.
 * So `requireNumber` (true when the card's own significantWords is down to
 * one token — see rowMatchesCard) demands the number be stated for those
 * cards, and keeps the lenient no-number-is-fine behaviour for the rest.
 *
 * Skipped entirely when the card's own number is under three digits, since
 * NUMBER_TOKEN would never find it in a title and every listing would be
 * dropped.
 */
function titleNumberAgreesWithCard(title: string, primaryNumber: string | undefined, requireNumber: boolean): boolean {
  if (!primaryNumber || primaryNumber.length < 3) return true;
  const stated = title.match(NUMBER_TOKEN);
  if (!stated) return !requireNumber;
  return stated.includes(primaryNumber);
}

/** Minimum word length to count as a distinguishing token — see rowMatchesCard. */
const SIGNIFICANT_WORD_LENGTH = 4;

export function significantWords(displayName: string): string[] {
  return normalizeText(displayName)
    .split(" ")
    .filter((word) => word.length >= SIGNIFICANT_WORD_LENGTH);
}

function titleMentionsCard(title: string, displayName: string): boolean {
  const words = significantWords(displayName);
  if (words.length === 0) return true; // nothing distinguishing to test against
  const normalizedTitle = normalizeText(title);
  return words.every((word) => normalizedTitle.includes(word));
}

/**
 * Kept in lib/lobstr.ts because it's a budget number, not a layout one: the
 * squid is configured to scrape exactly (tracked cards x this) results per
 * run, so the feed's length and the monthly bill are the same decision. The
 * illustrative fallback renders the same number of rows, so the panel's
 * layout is identical either way.
 */
const DISPLAY_LIMIT = VINTED_RESULTS_PER_CARD;

/**
 * Real "très bon état" listings for one card, newest first — or an empty
 * array, which is a normal outcome, not an error: no API key, no squid
 * configured, no run yet, a run still in progress, or simply no listing in
 * that condition right now all land here. Every caller treats empty as
 * "show the clearly-marked preview instead".
 *
 * Never throws. A product page render must not fail because a scraper
 * vendor is down — same resilience rule lib/graded-market.ts applies to
 * eBay.
 *
 * Called once per card, but that does NOT mean one /v1/results call per
 * card: every card reads the same run, so the request URL is identical and
 * Next's Data Cache serves all but the first from cache (the same
 * mechanism, and the same reason, that lib/ebay-browse.ts de-dupes its
 * token request). That's what keeps a six-card build well inside the
 * documented 2 req/s cap on /v1/results.
 */
/**
 * Every raw row that survives toVintedListing, card-agnostic. Split out
 * because the run is read ONCE for the whole feed and then narrowed per
 * card: parsing is the shared half, matching is the per-card half.
 */
export function parseVintedRows(rows: Record<string, unknown>[]): VintedListing[] {
  return rows.map(toVintedListing).filter((listing): listing is VintedListing => listing !== null);
}

/**
 * The listings one card actually shows: matched, de-duplicated, newest
 * first, capped at DISPLAY_LIMIT.
 *
 * Pure and exported on purpose. It is the step that decides how many rows a
 * product page renders, and the step most likely to be wrong (too strict
 * empties a card, too loose puts an evening dress in a Pokémon feed) — so
 * it has to be runnable against a saved Lobstr export offline, without an
 * API key. The render path and ?debug=1 both call this exact function, so a
 * count checked against a real export is the count the page will show.
 */
export function selectVintedListings(listings: VintedListing[], displayName: string, searchUrl: string): VintedListing[] {
  const matched = listings.filter((listing) => rowMatchesCard(listing, displayName, searchUrl));
  // The same listing can appear on more than one scraped page of a search;
  // the item URL is its identity.
  const deduped = [...new Map(matched.map((listing) => [listing.url, listing])).values()];
  // Newest first, by when the listing was posted — but Lobstr's Vinted rows
  // carry no posting date in practice, only a `scraping time`, so fall back
  // to that. It matters more than it looks: if /v1/results ever accumulates
  // across runs (a squid keeps its history, and run-scoped reads are not
  // available on this plan), the most recently collected rows are the ones
  // that should win the DISPLAY_LIMIT slots rather than whichever order the
  // API happened to return.
  deduped.sort((a, b) => (b.listedAtMs ?? b.collectedAtMs ?? 0) - (a.listedAtMs ?? a.collectedAtMs ?? 0));
  return deduped.slice(0, DISPLAY_LIMIT);
}

export async function getVintedListingsForCard(card: Card, displayName: string, searchUrl: string): Promise<VintedListing[]> {
  if (!hasLobstrCredentials()) return [];

  const pinnedRun = pinnedVintedRunHash();
  const squid = vintedSquidHash();
  if (!pinnedRun && !squid) return [];

  try {
    // One resolution for the whole feed, whichever route works (see
    // resolveVintedResults). Previously this walked a run list that
    // production shows returns nothing, which took the feature down
    // silently — an unfound run and a genuinely empty market render
    // identically.
    const { rows } = await resolveVintedResults(squid, pinnedRun);
    return selectVintedListings(parseVintedRows(rows), displayName, searchUrl);
  } catch (err) {
    console.error(`[lobstr] failed to read Vinted results for ${card.id}:`, err);
    return [];
  }
}

/**
 * "3 min" / "5 h" / "2 j" — French units, since these sit next to French
 * listing titles on the France tab. Empty string when Lobstr gave no
 * parseable date: a row with an unknown age says nothing rather than
 * claiming to be new.
 */
export function relativeTimeLabel(listedAtMs: number | undefined, now: number = Date.now()): string {
  if (listedAtMs === undefined) return "";
  // Floor, not round, at every step — the standard relative-time reading
  // ("5 h" means at least five hours ago). Rounding would report a listing
  // 30 seconds old as "1 min", which is the wrong direction to be wrong in
  // on a feed whose whole selling point is recency.
  const minutes = Math.max(0, Math.floor((now - listedAtMs) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} j`;
}

/**
 * Why one raw row did or didn't survive toVintedListing. Mirrors that
 * function's own checks exactly — if the two ever disagree, this is lying,
 * so keep them in step.
 */
function classifyRow(rawRow: Record<string, unknown>): "ok" | "wrong-condition" | "no-price" | "no-url" | "hidden-auction" {
  const row = normalizedRow(rawRow);
  const condition = readString(row, FIELD_ALIASES.condition);
  if (condition !== undefined && !isTresBonEtat(condition)) return "wrong-condition";
  const price = readPrice(row);
  if (price === undefined) return "no-price";
  if (!readString(row, FIELD_ALIASES.url)) return "no-url";
  // Reported separately in ?debug=1 rather than folded into a generic drop
  // count: "3 hidden auctions excluded" is a fact about the market worth
  // seeing, not a parsing failure to go hunting for.
  if (isHiddenAuction(price)) return "hidden-auction";
  return "ok";
}

export type VintedReadDiagnosis = Record<string, unknown>;

/**
 * Read-path diagnosis for when a collection succeeded but the France tab
 * still shows its preview. There are several independent places a row can
 * vanish between Lobstr and the panel — no run found (listRuns' query shape
 * is UNVERIFIED), an unrecognised results envelope, a FIELD_ALIASES miss on
 * url/price, or per-card title matching being too strict — and they all
 * look identical from the outside: an empty feed.
 *
 * Rather than guess, this walks the same funnel getVintedListingsForCard
 * walks and reports the count at every stage, plus the real field names on
 * a sample row. Costs nothing: reading results is not billed, and the rows
 * are already cached by run hash.
 *
 * Never throws — a diagnosis that 500s tells you less than one that says
 * which step blew up.
 */
export async function diagnoseVintedRead(
  cards: { slug: string; displayName: string; searchUrl: string }[]
): Promise<VintedReadDiagnosis> {
  const config = {
    hasApiKey: hasLobstrCredentials(),
    squid: vintedSquidHash() ?? null,
    pinnedRun: pinnedVintedRunHash() ?? null,
  };
  if (!config.hasApiKey) return { config, verdict: "LOBSTR_API_KEY missing on this deployment" };
  if (!config.squid && !config.pinnedRun) return { config, verdict: "LOBSTR_VINTED_SQUID missing on this deployment" };

  const { rows, source, attempts } = await resolveVintedResults(config.squid ?? undefined, config.pinnedRun ?? undefined);

  if (rows.length === 0) {
    return {
      config,
      resultAttempts: attempts,
      verdict:
        "No route returned any rows. resultAttempts shows every endpoint tried and what each returned — a payloadShape with total_results: 0 means Lobstr reports nothing there, anything else means the rows were found but not unwrapped. Pinning LOBSTR_VINTED_RUN to a known run hash bypasses discovery entirely.",
    };
  }

  const tally = { ok: 0, "wrong-condition": 0, "no-price": 0, "no-url": 0, "hidden-auction": 0 };
  let missingConditionField = 0;
  for (const row of rows) {
    tally[classifyRow(row)]++;
    if (readString(normalizedRow(row), FIELD_ALIASES.condition) === undefined) missingConditionField++;
  }
  const parsed = parseVintedRows(rows);

  const perCard = cards.map((card) => {
    const matched = selectVintedListings(parsed, card.displayName, card.searchUrl);
    return {
      slug: card.slug,
      displayName: card.displayName,
      requiredWords: significantWords(card.displayName),
      matched: matched.length,
      sampleMatchedTitles: matched.slice(0, 3).map((l) => l.title),
    };
  });

  return {
    config,
    resultAttempts: attempts,
    source,
    rawRows: rows.length,
    sampleRowKeys: Object.keys(rows[0]),
    sampleRow: rows[0],
    parse: { ...tally, missingConditionField, parsedListings: parsed.length },
    sampleParsedTitles: parsed.slice(0, 5).map((l) => ({ title: l.title, price: l.price, currency: l.currency, condition: l.condition })),
    perCard,
    verdict:
      parsed.length === 0
        ? "Rows arrived but none parsed — compare sampleRowKeys against FIELD_ALIASES (url and price are required)."
        : perCard.every((c) => c.matched === 0)
          ? "Rows parsed but none matched a card — see requiredWords against sampleParsedTitles."
          : "Read path is working. If a page still shows Preview it is serving cached HTML: product pages are ISR with revalidate=86400 (24h), so redeploy to regenerate.",
  };
}
