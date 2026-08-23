import { getResults, hasLobstrCredentials, listRuns, pinnedVintedRunHash, vintedSquidHash } from "@/lib/lobstr";
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
 * Per-item field names in Lobstr's Vinted Products output aren't part of
 * the walkthrough this integration was built from, and couldn't be
 * confirmed against a live run (no API key here by design). Rather than
 * guess one name per field and silently render nothing when the guess is
 * wrong, each field is read from a small list of plausible aliases and the
 * first present one wins.
 *
 * These lists are cheap to correct: run scripts/lobstr-setup.mjs --sample
 * against a finished run, look at the real keys it prints, and delete the
 * aliases that aren't real. Nothing else in the codebase needs to change.
 */
const FIELD_ALIASES = {
  condition: ["status", "condition", "item_condition", "item_status", "etat", "état"],
  title: ["title", "name", "item_title", "product_title"],
  price: ["price", "price_numeric", "item_price", "total_item_price", "amount"],
  currency: ["currency", "price_currency", "currency_code"],
  url: ["url", "item_url", "product_url", "link", "item_link"],
  image: ["photo", "photo_url", "image", "image_url", "thumbnail", "picture"],
  seller: ["user", "username", "user_login", "seller", "seller_name"],
  timestamp: ["created_at", "created_at_ts", "listed_at", "published_at", "date", "timestamp", "updated_at"],
  /** The task URL a row came from — the exact, unambiguous way to bucket results per card when Lobstr echoes it back. */
  sourceUrl: ["task_url", "input_url", "source_url", "search_url", "query_url", "task"],
} as const;

function readString(row: Record<string, unknown>, aliases: readonly string[]): string | undefined {
  for (const key of aliases) {
    const value = row[key];
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
function readPrice(row: Record<string, unknown>): number | undefined {
  for (const key of FIELD_ALIASES.price) {
    const value = row[key];
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
function readCurrency(row: Record<string, unknown>): string {
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
  /** Milliseconds since epoch when Lobstr gave us a parseable listing date; undefined otherwise. Used only for ordering and the "x min ago" label. */
  listedAtMs?: number;
  seller?: string;
  /** The task URL this row was scraped from, when Lobstr echoes it — see FIELD_ALIASES.sourceUrl. */
  sourceUrl?: string;
};

function readTimestamp(row: Record<string, unknown>): number | undefined {
  for (const key of FIELD_ALIASES.timestamp) {
    const value = row[key];
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
export function toVintedListing(row: Record<string, unknown>): VintedListing | null {
  const condition = readString(row, FIELD_ALIASES.condition);
  if (condition !== undefined && !isTresBonEtat(condition)) return null;
  if (condition === undefined && !warnedAboutMissingCondition) {
    warnedAboutMissingCondition = true;
    console.warn(
      `[lobstr] no condition field found on a Vinted result row (looked for: ${FIELD_ALIASES.condition.join(", ")}). ` +
        `Relying on the task URL's status_ids[]=2 filter alone. Run \`node scripts/lobstr-setup.mjs --sample <run>\` and correct FIELD_ALIASES. ` +
        `Keys present: ${Object.keys(row).join(", ")}`
    );
  }

  const price = readPrice(row);
  const url = readString(row, FIELD_ALIASES.url);
  if (price === undefined || !url) return null;

  return {
    title: readString(row, FIELD_ALIASES.title) ?? "Vinted listing",
    price,
    currency: readCurrency(row),
    url,
    imageUrl: readString(row, FIELD_ALIASES.image),
    condition: TRES_BON_ETAT,
    listedAtMs: readTimestamp(row),
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
 * Which card a scraped row belongs to. One run covers every tracked card
 * (one task per card — see app/api/vinted/refresh/route.ts), so results
 * come back mixed and have to be bucketed.
 *
 * Preferred signal is the echoed task URL, which is exact. Falling back to
 * the title, every significant word of the card's name must appear —
 * seller-written Vinted titles are free text ("Carte Pokémon Ectoplasma
 * VMAX 271/264 état impeccable"), so requiring the words is precise enough
 * to reject a different card while tolerating the surrounding prose.
 *
 * The card's number is deliberately NOT required: unlike eBay's graded
 * market, where the grade and number are effectively always in the title,
 * casual Vinted sellers routinely omit the collector number. Requiring it
 * would throw away most genuine matches.
 */
function rowMatchesCard(listing: VintedListing, displayName: string, searchUrl: string): boolean {
  if (listing.sourceUrl) {
    const scraped = searchTextOf(listing.sourceUrl);
    const wanted = searchTextOf(searchUrl);
    // Compared on the search_text query param, not on the URL string: every
    // task URL shares the same https://www.vinted.fr/catalog path, so any
    // path-level comparison would match every card to every row.
    if (scraped !== undefined && wanted !== undefined) return scraped === wanted;
    return listing.sourceUrl === searchUrl;
  }

  const title = normalizeText(listing.title);
  const words = normalizeText(displayName)
    .split(" ")
    .filter((word) => word.length > 1);
  if (words.length === 0) return false;
  return words.every((word) => title.includes(word));
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

/** Matches the six-row illustrative feed this replaces, so the panel's layout is identical either way. */
const DISPLAY_LIMIT = 6;
/** How many recent runs to look back through when the newest one has nothing for this card (it may still be scraping, or its tasks may not have covered this card). */
const RUN_LOOKBACK = 3;

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
export async function getVintedListingsForCard(card: Card, displayName: string, searchUrl: string): Promise<VintedListing[]> {
  if (!hasLobstrCredentials()) return [];

  const pinnedRun = pinnedVintedRunHash();
  const squid = vintedSquidHash();
  if (!pinnedRun && !squid) return [];

  try {
    const runs = pinnedRun ? [pinnedRun] : (await listRuns(squid!)).slice(0, RUN_LOOKBACK).map((run) => run.id);

    for (const run of runs) {
      const rows = await getResults(run);
      const listings = rows
        .map(toVintedListing)
        .filter((listing): listing is VintedListing => listing !== null)
        .filter((listing) => rowMatchesCard(listing, displayName, searchUrl));

      // Same listing can appear on more than one scraped page of the same
      // search; the item URL is its identity.
      const deduped = [...new Map(listings.map((listing) => [listing.url, listing])).values()];
      if (deduped.length === 0) continue;

      deduped.sort((a, b) => (b.listedAtMs ?? 0) - (a.listedAtMs ?? 0));
      return deduped.slice(0, DISPLAY_LIMIT);
    }
  } catch (err) {
    console.error(`[lobstr] failed to read Vinted results for ${card.id}:`, err);
  }

  return [];
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
