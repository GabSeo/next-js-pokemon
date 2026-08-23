/**
 * The one Vinted URL this integration builds. It does double duty: it's the
 * task URL Lobstr's scraper is pointed at, AND the "Search on Vinted"
 * button's destination — one function, so what gets scraped and what a
 * human clicks through to can never drift apart.
 *
 * Shape confirmed against a real, working search URL (a .be one; the params
 * are identical across Vinted's country domains, and VINTED_DOMAIN below
 * defaults to .fr to match the panel's France tab):
 *
 *   https://www.vinted.be/catalog?search_text=Typhlosion%20de%20Luth%20190%2F182&status_ids[]=2&page=1&order=relevance
 *
 * `catalog[]=4875` scopes the search to Vinted's own "Cartes à collectionner
 * à l'unité" (single trading cards) category, confirmed from a real working
 * search URL the same way status_ids[] was. Without it, `search_text` alone
 * can surface non-card listings (playmats, sleeves, other items whose title
 * happens to match) — this filters server-side, the same "let Vinted do the
 * filtering, don't rely on scraped text alone" reasoning as status_ids[]
 * below, and for the same reason: catching it here is cheaper and more
 * reliable than trying to detect an off-category listing after the fact.
 *
 * The load-bearing param is `status_ids[]=2` — Vinted's own id for **Très
 * bon état**. An earlier version of this file deliberately left the search
 * unfiltered and applied the condition filter only to scraped text, because
 * a wrong status id would silently scrape the wrong tier (an error that
 * looks exactly like real data) and the ids aren't published anywhere.
 * That id is now confirmed from a live URL, so the filter moves to where it
 * belongs: Vinted applies it server-side, we scrape only the tier we're
 * going to show, and the click-through shows a human exactly the same set
 * of listings the panel does. The text check in lib/vinted-listings.ts
 * stays as a second, independent guard — see toVintedListing.
 *
 * Two deliberate departures from the reference URL above:
 *
 * - `time=<unix seconds>` is omitted. It's a cache-buster Vinted's own UI
 *   appends, and nothing server-side needs it. Including a fresh timestamp
 *   would make this function return a different string on every call —
 *   which would churn the rendered HTML of a statically-generated product
 *   page and pile up a new Lobstr task per refresh instead of reusing one
 *   stable task URL per card.
 * - Encoding is done with encodeURIComponent rather than URLSearchParams,
 *   which is what produces `%20` for spaces and a literal `status_ids[]`
 *   key. URLSearchParams would emit `+` for spaces and percent-encode the
 *   brackets to `status_ids%5B%5D`. Both forms are RFC-equivalent and
 *   almost certainly decode identically on Vinted's side, but "almost
 *   certainly" isn't a reason to send something other than the exact string
 *   that's been confirmed to work. Same reasoning as ebay-search.ts's
 *   hand-written PROFESSIONAL_GRADER_PARAM.
 */

/** Vinted's status id for "Très bon état", read off a confirmed working search URL. The other tiers' ids are unknown and unneeded — this integration only ever asks for this one. */
export const TRES_BON_ETAT_STATUS_ID = "2";

/** Vinted's category id for "Cartes à collectionner à l'unité" (single trading cards), read off a confirmed working search URL — see this file's header comment. */
export const TRADING_CARDS_CATALOG_ID = "4875";

/**
 * Which Vinted marketplace to search. Vinted runs a separate site per
 * country with its own sellers and shipping, so this genuinely changes
 * which listings come back — it isn't a cosmetic locale switch.
 *
 * vinted.fr, matching the panel's "France" tab and the French search terms
 * this integration builds (see vintedQueryForCard). Overridable without a
 * code change — the reference URL this file's shape was confirmed against
 * was a .be one, and every Vinted domain takes identical params — but if
 * this is pointed at another country, the tab label should move with it.
 */
export const VINTED_DOMAIN = process.env.VINTED_DOMAIN || "www.vinted.fr";

export function vintedSearchLink(query: string): string {
  const params = [
    `search_text=${encodeURIComponent(query)}`,
    `catalog[]=${TRADING_CARDS_CATALOG_ID}`,
    `status_ids[]=${TRES_BON_ETAT_STATUS_ID}`,
    "page=1",
    // Relevance, not newest-first: with a small max_pages budget (see
    // scripts/lobstr-setup.mjs) the goal is to spend it on listings that
    // actually match the card, not on whatever happened to be posted last.
    // The panel still renders what comes back newest-first — that ordering
    // is applied in lib/vinted-listings.ts, not asked of Vinted here.
    "order=relevance",
  ];
  return `https://${VINTED_DOMAIN}/catalog?${params.join("&")}`;
}
