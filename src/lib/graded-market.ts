import { conditionSearchLink, tagFirstWord } from "@/lib/ebay-search";
import { searchActiveListings, type EbayCondition, type EbayLanguage, type EbayMarketGuard } from "@/lib/ebay-browse";
import { illustrativeActiveListings, illustrativeSoldListings, illustrativeVintedFeed } from "@/lib/illustrative";
import { DEFAULT_PSA_GRADING_COST_USD, gradingRoi, median } from "@/lib/roi";
import { getVintedListingsForCard, relativeTimeLabel, TRES_BON_ETAT, vintedQueryForCard } from "@/lib/vinted-listings";
import { getJapaneseCardText } from "@/lib/cards";
import { buildCached } from "@/lib/build-cache";
import { cardRefs } from "@/data/card-refs";
import type { Card } from "@/lib/types";

export const GRADED_MARKET_CONDITIONS: EbayCondition[] = ["PSA 10", "PSA 9", "PSA 8", "Raw"];

/**
 * Japan is ON — same eBay US marketplace, same `Language: Japanese` aspect
 * filter, as English. The original concern here (see git history) was that
 * this filter returns almost nothing that survives titleMatchesCard, but
 * that check (ebay-browse.ts) only ever verifies grade text and the card's
 * own number — never the card's name — so it was never going to reject a
 * real Japanese-print listing just because its seller-written title is in
 * English (confirmed live: sellers write English titles — "PSA 10", the
 * card number — even for genuine Japanese prints). Re-verified live after
 * re-enabling: real active listings come back for the tracked cards, not
 * an empty illustrative fallback.
 *
 * One flag, one consumer now: the Market Overview tab list
 * (GRADED_MARKET_LANGUAGES below). The JP entry in the product page's
 * language toggle is keyed to per-card identity availability instead — a
 * separate, narrower question (does PokéWallet/BerryWallet have a confirmed
 * Japanese counterpart for THIS card) from whether eBay's Japanese market
 * is worth showing at all.
 */
export const JAPANESE_MARKET_ENABLED = true;

/**
 * One Piece is ON — same PSA/eBay/Vinted shape as Pokémon, same eBay US
 * marketplace, print-name + set-name query text (see getGradedMarketData's
 * own comment) instead of Pokémon's name + number, PSA 10/9/Raw only (no
 * PSA 8 — population too thin for this game). Turned on for live preview
 * review; flip back to false if match quality against real listings turns
 * out to need more work before this is ready for production traffic — same
 * "one flag gates a whole feature" shape as JAPANESE_MARKET_ENABLED above,
 * nothing else in this file needs to change either way.
 */
export const ONE_PIECE_MARKET_ENABLED = true;

/**
 * One Piece's own condition tiers — PSA 8-and-below population is too thin
 * to be a meaningful market for this game, in either language (confirmed
 * against the actual market, not derived from anything in this codebase) —
 * so unlike Pokémon this never queries PSA 8 at all, English or Japanese.
 * conditionsFor below is what everything in this file actually iterates.
 */
const ONE_PIECE_CONDITIONS: EbayCondition[] = ["PSA 10", "PSA 9", "Raw"];

function conditionsFor(card: Card): EbayCondition[] {
  return card.franchise === "one-piece" ? ONE_PIECE_CONDITIONS : GRADED_MARKET_CONDITIONS;
}

/**
 * eBay-backed markets. French was removed from here (not from
 * EbayLanguage/ebay-browse.ts/ebay-search.ts themselves, which still
 * support it) after a market-fit call: eBay.fr isn't where the French
 * Pokémon TCG market actually trades, Vinted is. French gets its own
 * VintedMarketData below instead of a third entry in this array. Japanese
 * is gated on the flag above.
 */
export const GRADED_MARKET_LANGUAGES: EbayLanguage[] = JAPANESE_MARKET_ENABLED ? ["English", "Japanese"] : ["English"];

export type GradedMarketListingRow = {
  date: string;
  description: string;
  price: number;
  currency: string;
  /** Real per-item link — only present for real (non-illustrative) rows. See lib/illustrative.ts on why illustrative rows never carry one. */
  url?: string;
};

export type GradedMarketTypeData = {
  isReal: boolean;
  /**
   * True only when eBay answered and genuinely had nothing to show for this
   * tier. Distinct from `isReal: false`, which means we could not ask at all
   * (outage, quota, open breaker) and are showing preview figures instead.
   *
   * The difference is the whole point: "nobody is selling this today" is a
   * real, useful answer and deserves to be stated, while inventing preview
   * rows for it tells the reader something false. A failed lookup is not an
   * empty market and must not be presented as one.
   */
  noListings?: boolean;
  medianPrice: number;
  currency: string;
  /** Real eBay total match count when isReal; an illustrative estimate otherwise. */
  count: number;
  seeAllUrl: string;
  rows: GradedMarketListingRow[];
};

export type GradedMarketLanguageData = {
  language: EbayLanguage;
  active: GradedMarketTypeData;
  sold: GradedMarketTypeData;
};

export type GradedMarketConditionData = {
  condition: EbayCondition;
  languages: GradedMarketLanguageData[];
};

export type GradedMarketRoi = {
  isReal: boolean;
  percent: number;
  psa10Median: number;
  rawMedian: number;
  gradingCostUsd: number;
  currency: string;
};

export type VintedDealTier = "good" | "fair" | "high";

export type VintedFeedRow = {
  timeAgo: string;
  /** Always "Très bon état" — see lib/vinted-listings.ts. Kept per-row so the renderer never has to re-assert the filter. */
  condition: string;
  price: number;
  currency: string;
  /** Signed percent vs. this card's rolling average across the feed (see VintedMarketData.avgPrice) — negative means priced below average. */
  dealPct: number;
  dealTier: VintedDealTier;
  /** Seller-written listing title — real rows only. */
  title?: string;
  /** Real per-item Vinted link — present only on real rows, never fabricated for a preview row (same rule as GradedMarketListingRow.url). */
  url?: string;
  /** The listing's own photo when the scrape returned one; real rows only. Preview rows share the card's image via VintedMarketData.imageUrl. */
  imageUrl?: string;
};

export type VintedMarketData = {
  /** True once Lobstr has scraped real "très bon état" listings for this card (see lib/vinted-listings.ts); false falls back to the clearly-tagged illustrative feed. */
  isReal: boolean;
  /** Real, working Vinted search-results link (see lib/vinted-search.ts) — carrying the same `status_ids[]=2` (Très bon état) filter as `rows`, so a human clicking through lands on exactly the set of listings the panel is showing them. */
  searchUrl: string;
  /** Real French name + number when TCGdex has a match, English otherwise — same string used to build searchUrl. */
  title: string;
  /** The card's own real image — every row shares it (same physical card, different sellers/conditions), never a fabricated per-listing photo. */
  imageUrl?: string;
  /** The real-world character this card depicts (Card.character) — e.g. picking a Pokémon Showdown sprite for the panel's mascot. */
  character: string;
  /**
   * The feed's mean asking price. A real arithmetic average, safe to
   * compute because 1 EUR hidden auctions are excluded before it — see
   * summarizeVintedFeed.
   */
  avgPrice: number;
  currency: string;
  rows: VintedFeedRow[];
  /** How many of `rows` sit below `avgPrice` — real math either way, same honesty shape as the ROI percent, which is real arithmetic over possibly-illustrative inputs. */
  belowAverageCount: number;
  /**
   * When the scrape that produced these rows ran. Feed-level freshness, and
   * deliberately NOT a per-row age: Lobstr reads Vinted's search-results
   * cards, which carry no listing date, so every row in a run shares this
   * one timestamp. Presenting it per row would tell a reader all six
   * listings appeared at the same instant.
   */
  collectedAtMs?: number;
  /**
   * The single condition every row in this feed is filtered to. Carried in
   * the data (not just rendered) so the markdown export, JSON API and MCP
   * tool all state the same constraint the panel shows — a consumer reading
   * only the JSON must not mistake this for an unfiltered view of the
   * French market.
   */
  conditionFilter: string;
};

export type GradedMarketData = {
  conditions: GradedMarketConditionData[];
  roi: GradedMarketRoi;
  vinted: VintedMarketData;
};

/**
 * Real active-listing fetch for one condition tier + language — failure
 * here (missing EBAY_CLIENT_ID/SECRET, no Buy API license yet, rate limit,
 * no results) must never take down whatever's consuming this (HTML page,
 * markdown export, JSON API, MCP tool), so it's caught locally and degrades
 * to an illustrative preview, same resilience shape lib/cards.ts uses for
 * apitcg.
 *
 * `nameOverride` is One Piece's own query text — an empty string, meaning
 * "no name at all, just the card's own number" (see getGradedMarketData's
 * own comment on why a bare-number query beats guessing at print-name text).
 * `numberOverride` is the Japanese Pokémon print's own set number (resolved
 * by the caller via getJapaneseCardText, see that function's own comment on
 * why it's genuinely different from card.number) — searching or
 * title-matching on card.number's English number would silently reject real
 * Japanese listings. `variantTags` is One Piece's own variant precision —
 * see titleMatchesCard's own comment (lib/ebay-browse.ts) for why it lives
 * here, in the per-listing title check, rather than in the query text.
 */
/**
 * Countries whose listings are treated as the Japanese print when the
 * ENGLISH tab asks for a card that also exists in Japanese.
 *
 * Just Japan, and deliberately not a longer list of "Asian" countries: the
 * claim being made is the narrow, checkable one — a card shipping from Japan
 * under a query for a card_number with a separate Japanese print is
 * overwhelmingly that Japanese print. Hong Kong or Singapore would be a
 * guess, and a wrong one discards real English listings.
 */
const JAPANESE_MARKET_COUNTRIES = ["JP"];

/**
 * How far below the card's own TCGPlayer reference price an ENGLISH listing
 * may sit before it is treated as a different print rather than a cheap copy.
 * 0.40 means "40% or more below the reference is not this card".
 *
 * Why a reference price at all, rather than an outlier rule over the
 * results: measured on "Event Vol P-033" (Raw, Language:{English}) on
 * 2026-08-29, 7 of 12 results were the Japanese print. With the wrong print
 * in the MAJORITY, the result-set median IS the wrong cluster, so anything
 * self-referential discards the real listings instead. card.currentPrice is
 * the TCGPlayer market price we already trust and display, and it is
 * independent of whatever eBay happened to return.
 *
 * Why the English side has to catch its own mislabelling: those Japanese
 * listings are declared `Language: English` by their sellers, so they
 * surface here and the Japanese tab never sees them. Correcting an earlier
 * version of this comment, which over-generalised that into "the Japanese
 * tab comes back EMPTY" — it does not. Measured: Lugia V's Japanese PSA 10
 * tab returns 35 results and Gengar VMAX's returns 31. The empty tab was
 * specific to a One Piece promo whose Japanese print no source carries at
 * all (see docs/i18n-deferred.md), not a property of Japanese searches.
 * The Japanese tab is guarded too — see marketGuardFor below.
 *
 * Worked example (the real shape, not a hypothetical): reference 400, eBay
 * returns four listings at 240 and the rest at 400-550. The 240s are 40%
 * below and are the Japanese print; everything from 400 up is English.
 *
 * The threshold is deliberately a wide band and not a tuned number, but it
 * is tighter than it looks on a card whose real English listings run close
 * to reference: P-033's cheapest genuine English listing is 274.99 against a
 * 423.50 reference, which is 0.65 — surviving by about 5%. A reference price
 * that drifts up could push a real listing under. That is the accepted cost,
 * and the direction of the trade is deliberate: one missing row is
 * recoverable, a median quoting the wrong print's price is not, because it
 * misreports the market on every surface that reads it.
 *
 * Only ever removes LOW outliers. Graded tiers price well ABOVE the raw
 * reference and are untouched — which is also this rule's blind spot: a
 * Japanese PSA 10 can still sit above 60% of the RAW reference and pass. No
 * evidence gathered for a graded-specific reference yet.
 */
const ENGLISH_PRICE_GAP_THRESHOLD = 0.4;

/**
 * The extra constraints to apply to one tier's search, or undefined to leave
 * eBay's own filtering untouched.
 *
 * Only the English tab is guarded. The Japanese tab deliberately gets
 * nothing: its confusable neighbour is the *pricier* English print, so the
 * same price rule inverted would need a ceiling, and no evidence has been
 * gathered for where that sits. Guessing symmetry here would be exactly the
 * fabrication this codebase avoids elsewhere.
 *
 * Both constraints are skipped when the card has no readable price
 * (placeholder cards), since the anchor would then be meaningless.
 */
function marketGuardFor(card: Card, condition: EbayCondition, language: EbayLanguage): EbayMarketGuard | undefined {
  if (card.priceUnavailable) return undefined;
  const floor = card.currentPrice * (1 - ENGLISH_PRICE_GAP_THRESHOLD);

  if (language === "English") {
    return { excludeCountries: JAPANESE_MARKET_COUNTRIES, minPrice: floor };
  }

  // Japanese, graded tiers only. The floor here rests on market structure
  // rather than on any claim about Japanese pricing: a professionally
  // graded gem-mint card does not sell for less than 60% of the same card's
  // RAW market price, in any language. That argument sidesteps the problem
  // that stopped this being guarded at all before — we have no trustworthy
  // Japanese reference price to anchor against, and card.currentPrice is
  // the English raw one.
  //
  // Found by a real listing: Gengar VMAX's Japanese PSA 10 tab returned
  // "[PSA 10] Pokemon Card Japanese Gengar VMAX 020/019 sGG High Class
  // Deck" at $365 from KR, against three genuine listings at $2,749-$3,474
  // and a raw reference of $1,037. Cheapest-first sorting put it at the top
  // of the panel.
  //
  // NOT applied to Japanese Raw, deliberately: the Japanese raw market
  // genuinely can trade below 60% of the English raw price, so the same
  // floor there would discard real listings. Nothing about graded pricing
  // makes that true, which is why the split is by condition and not by
  // language.
  //
  // No excludeCountries either — a Japanese card shipping from Japan is
  // exactly what this tab wants, unlike the English one.
  if (condition === "Raw") return undefined;
  return { minPrice: floor };
}

async function fetchActiveTier(
  card: Card,
  condition: EbayCondition,
  language: EbayLanguage,
  nameOverride?: string,
  numberOverride?: string,
  variantTags?: string[]
): Promise<GradedMarketTypeData> {
  try {
    const { listings, total } = await searchActiveListings(
      card,
      condition,
      language,
      nameOverride,
      numberOverride,
      variantTags,
      marketGuardFor(card, condition, language)
    );
    if (listings.length === 0) {
      console.warn(
        `[ebay] 0 active listings for ${card.id} [${condition}/${language}] — search succeeded but returned nothing. ` +
          `Reporting an empty market rather than preview figures.`
      );
      // The search WORKED and found nothing. That is a real answer, so it is
      // reported as one instead of falling through to the illustrative block
      // below — which is reserved for the case where the request itself
      // failed and we genuinely do not know what the market looks like.
      return {
        isReal: true,
        noListings: true,
        medianPrice: 0,
        currency: card.currency,
        count: 0,
        seeAllUrl: conditionSearchLink(card, condition, language, nameOverride, numberOverride),
        rows: [],
      };
    }
    const med = listings.length > 0 ? median(listings.map((l) => l.price)) : null;
    if (med !== null) {
      return {
        isReal: true,
        medianPrice: med,
        currency: card.currency,
        count: total,
        seeAllUrl: conditionSearchLink(card, condition, language, nameOverride, numberOverride),
        rows: listings.map((listing) => ({
          date: listing.listedDate
            ? new Date(listing.listedDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "Active",
          description: listing.title,
          price: listing.price,
          currency: listing.currency,
          url: listing.url,
        })),
      };
    }
  } catch (err) {
    console.error(`[ebay] failed to fetch active ${condition}/${language} listings for ${card.id}:`, err);
  }

  const { rows, total } = illustrativeActiveListings(card, condition);
  return {
    isReal: false,
    medianPrice: median(rows.map((r) => r.price))!,
    currency: card.currency,
    count: total,
    seeAllUrl: conditionSearchLink(card, condition, language, nameOverride, numberOverride),
    rows: rows.map((row) => ({ ...row, currency: card.currency })),
  };
}

/**
 * Always illustrative — see lib/illustrative.ts's comment on why sold data
 * can't be real here (eBay's sold-data API is restricted, closed to new
 * applicants).
 *
 * `nameOverride`/`numberOverride` only affect seeAllUrl (the rows
 * themselves are always illustrative) — same reasoning as fetchActiveTier's
 * own comment, so a reader clicking through lands on a search for the
 * card's real print name/number, not a mismatched one.
 */
function buildSoldTier(
  card: Card,
  condition: EbayCondition,
  language: EbayLanguage,
  nameOverride?: string,
  numberOverride?: string
): GradedMarketTypeData {
  const { rows, total } = illustrativeSoldListings(card, condition);
  return {
    isReal: false,
    medianPrice: median(rows.map((r) => r.price))!,
    currency: card.currency,
    count: total,
    seeAllUrl: conditionSearchLink(card, condition, language, nameOverride, numberOverride),
    rows: rows.map((row) => ({ ...row, currency: card.currency })),
  };
}

// A listing more than 8% below the feed's own rolling average reads as a
// good deal, more than 8% above reads as pricey, everything in between is
// unremarkable — thresholds are a judgment call, not derived from anything,
// same as the codebase's other illustrative-tuning constants.
const VINTED_DEAL_THRESHOLD_PCT = 8;

function vintedDealTier(deltaPct: number): VintedDealTier {
  if (deltaPct <= -VINTED_DEAL_THRESHOLD_PCT) return "good";
  if (deltaPct >= VINTED_DEAL_THRESHOLD_PCT) return "high";
  return "fair";
}

/**
 * Reduces a feed to one reference price plus each row's distance from it.
 *
 * The reference is an arithmetic MEAN — a genuine average asking price,
 * which is what a reader assumes when they see "Avg". That is only safe
 * because the one class of row that reliably destroyed a mean is now
 * excluded upstream: 1 EUR hidden auctions, where the number is bait for
 * private offers rather than a price (lib/vinted-listings.ts). With those
 * gone, every remaining row is a real asking price and belongs in the
 * average.
 *
 * This briefly used a median instead. That was the right call while the
 * hidden auctions were still in the sample — the live Gengar feed read
 * 1, 780, 780, 875, and a mean of 609 sat below every credible listing on
 * screen. Filtering the cause rather than damping the symptom is better,
 * and it lets the number go back to being the plain thing it claims to be.
 *
 * If another outlier class turns up that can't be characterised and
 * excluded, median() from lib/roi.ts is one line away — that's what the
 * eBay half of this panel uses.
 */
function summarizeVintedFeed(
  prices: number[],
  toRow: (price: number, index: number, dealPct: number, dealTier: VintedDealTier) => VintedFeedRow
): { rows: VintedFeedRow[]; avgPrice: number; belowAverageCount: number } {
  const avgPrice = Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length);
  const rows = prices.map((price, i) => {
    const dealPct = Math.round(((price - avgPrice) / avgPrice) * 100);
    return toRow(price, i, dealPct, vintedDealTier(dealPct));
  });
  return { rows, avgPrice, belowAverageCount: prices.filter((price) => price < avgPrice).length };
}

/**
 * French/Vinted market view — structurally nothing like the PSA-tiered eBay
 * data above: no grading concept, no active/sold split, and exactly one
 * condition, "Très bon état". That single condition is the point of this
 * view rather than an incidental filter: it answers "what can I buy right
 * now that the seller has clearly described as very good condition", not
 * "what does the French market look like". Everything below Très bon état
 * is dropped before it reaches here (lib/vinted-listings.ts).
 *
 * Real listings come from Lobstr's Vinted Products Scraper, read back from
 * the most recent finished run (see lib/lobstr.ts for why a page render
 * reads results rather than triggering a scrape). When there are none —
 * no API key, no run yet, or genuinely nothing in that condition right now
 * — this degrades to the illustrative feed, tagged as a preview in every
 * surface that renders it. Never a silent mix: the whole feed is real or
 * the whole feed is preview.
 *
 * Searches in French when TCGdex has a French name for the card (a French
 * marketplace gets searched in French), English otherwise — see
 * vintedQueryForCard.
 */
async function buildVintedMarket(card: Card): Promise<VintedMarketData> {
  const { query, displayName, searchUrl } = await vintedQueryForCard(card);

  const real = await getVintedListingsForCard(card, displayName, searchUrl);

  if (real.length > 0) {
    const { rows, avgPrice, belowAverageCount } = summarizeVintedFeed(
      real.map((listing) => listing.price),
      (price, i, dealPct, dealTier) => ({
        timeAgo: relativeTimeLabel(real[i].listedAtMs),
        condition: real[i].condition,
        price,
        // Per-listing currency, not card.currency: Vinted France trades in
        // euros while card.currentPrice is TCGPlayer USD. Mislabelling €
        // as $ on a price comparison page would be a real error, not a
        // cosmetic one.
        currency: real[i].currency,
        dealPct,
        dealTier,
        title: real[i].title,
        url: real[i].url,
        imageUrl: real[i].imageUrl,
      })
    );

    return {
      isReal: true,
      searchUrl,
      title: query,
      imageUrl: card.imageUrl,
      character: card.character,
      avgPrice,
      currency: real[0].currency,
      rows,
      belowAverageCount,
      collectedAtMs: real.find((listing) => listing.collectedAtMs !== undefined)?.collectedAtMs,
      conditionFilter: TRES_BON_ETAT,
    };
  }

  const feed = illustrativeVintedFeed(card);
  const { rows, avgPrice, belowAverageCount } = summarizeVintedFeed(
    feed.map((listing) => listing.price),
    (price, i, dealPct, dealTier) => ({
      timeAgo: feed[i].minutesAgo === 0 ? "now" : `${feed[i].minutesAgo} min`,
      condition: feed[i].condition,
      price,
      currency: card.currency,
      dealPct,
      dealTier,
    })
  );

  return {
    isReal: false,
    searchUrl,
    title: query,
    imageUrl: card.imageUrl,
    character: card.character,
    avgPrice,
    currency: card.currency,
    rows,
    belowAverageCount,
    conditionFilter: TRES_BON_ETAT,
  };
}

/**
 * The single source of truth for graded-market data — fetches real active
 * listings per condition tier x language (falling back to illustrative
 * preview per combination) and pairs them with illustrative sold data, plus
 * a separate illustrative Vinted market view. Consumed identically by the
 * React panel (components/retro/graded-market-panel.tsx), the markdown
 * export (lib/markdown.ts), the JSON API (/api/[franchise]/[id]), and the
 * MCP get_graded_market tool — one fetch path, one set of real/illustrative
 * rules, so none of those surfaces can drift out of sync with each other or
 * re-implement the eBay call.
 *
 * Cost note: 4 conditions x 2 languages = 8 real eBay searches per card
 * (down from 12 now that French no longer goes through eBay at all — sold
 * stays illustrative-only regardless of language, so it adds no API cost).
 * Those 4 consumers each independently calling this for the same card during
 * static generation used to mean 4x that cost per card, per build, with
 * nothing shared between them — confirmed live as a major contributor to the
 * eBay 429s in the same incident that produced upstream.ts's
 * RATE_LIMIT_BREAKER_OPEN_MS. `getGradedMarketData` below is the thin
 * buildCached wrapper (see that module's own header comment) that collapses
 * those 4 calls back down to one real resolution per card per build; this
 * function is the actual implementation, called through that wrapper only.
 *
 * ONE_PIECE_MARKET_ENABLED above gates One Piece, not a permanent
 * Pokémon-only design — this function's PSA/eBay/Vinted shape covers both
 * franchises now that One Piece's own identity resolution (BerryWallet, see
 * cards.ts) is settled, and every consumer (the panel, the markdown export,
 * the JSON API, the MCP tool) renders it under a franchise-aware
 * "<Franchise> Market Overview" header (franchiseLabel(card.franchise)),
 * not a hardcoded Pokémon one. The flag stays here as an off switch — same
 * "only build what's ready" rule this codebase already applies to
 * JAPANESE_MARKET_ENABLED — for the same reason it existed before: running
 * the 8 eBay searches + Vinted read is only worth doing once the identity
 * behind a card is trustworthy, so flipping it back off (e.g. mid-regression
 * on the identity work) makes every caller skip the section cleanly again
 * rather than showing it half-working. One Piece already has its own real
 * "current price" from BerryWallet regardless of this flag
 * (resolveBerryWalletCard/berryWalletPrice in lib/cards.ts) — this function
 * was never that franchise's only source of real market data, just the only
 * source of this particular one.
 */
async function resolveGradedMarketData(card: Card): Promise<GradedMarketData | undefined> {
  if (card.franchise !== "pokemon" && !ONE_PIECE_MARKET_ENABLED) return undefined;

  const conditionTiers = conditionsFor(card);

  // The Japanese tier searches need the card's own Japanese set number, not
  // its English one — see getJapaneseCardText's own comment (lib/cards.ts)
  // on why those are genuinely different numbers for Pokémon (One Piece
  // uses one universal code across regions, so this stays undefined there
  // and fetchActiveTier just falls back to card.number, same as English).
  // Resolved once here rather than per condition/tier: it's the same lookup
  // every time, and 4 conditions x an identical PokéWallet call would be
  // pure waste.
  let japaneseNumberOverride: string | undefined;
  if (card.franchise === "pokemon" && GRADED_MARKET_LANGUAGES.includes("Japanese")) {
    const ref = cardRefs.find((r) => r.slug === card.slug);
    if (ref) {
      const ja = await getJapaneseCardText(card, ref);
      if (ja.translated && ja.number) japaneseNumberOverride = ja.number;
    }
  }

  // The specific print variant this card_number resolves to (e.g.
  // ["Wanted Poster"]) — see CardRef's own doc comment (data/card-refs.ts).
  // Only One Piece refs use the "code" lookup shape that carries this.
  // Whatever real tag a future card carries here — Manga, SP Gold, Treasure
  // Rare, a numbered Anniversary special, anything — flows straight through
  // to both places below with no per-tag handling needed.
  //
  // ref.ebayVariantTags, when set, overrides lookup.variantTags for this
  // eBay-specific use only — see its own doc comment (data/card-refs.ts) for
  // why BerryWallet's own catalog vocabulary and real eBay seller vocabulary
  // aren't always the same words for the same real product.
  const oneVariantTags =
    card.franchise === "one-piece"
      ? (() => {
          const ref = cardRefs.find((r) => r.slug === card.slug);
          if (!ref) return undefined;
          return ref.ebayVariantTags ?? (ref.lookup.by === "code" ? ref.lookup.variantTags : undefined);
        })()
      : undefined;

  // One Piece's own query text: the card's own universal code plus its
  // variant tag(s), nothing else — no character name, no set name.
  // cardSearchTerms treats an explicit "" nameOverride as "no name" (not
  // "use the default"; only `undefined` means that), so with no
  // variantTags this produces a bare "OP09-093 [condition]".
  //
  // The variant tag matters in the query text itself, not just as a filter
  // on what comes back — confirmed live: a bare number query sorted newest-
  // first can return 20 results spanning every print of that card_number,
  // with the one variant actually being tracked barely represented (Shanks'
  // own Manga print: 1 real survivor). Adding the variant word to the query
  // — "OP09-004 Manga PSA 10" — narrows eBay's own match set to (mostly)
  // that variant *before* the newest-first sort and fetch limit apply, so
  // the fetched window is no longer diluted by every other print sharing
  // the number. Same search jumped from 1 real result to 7. titleMatchesCard
  // still checks variantTags independently below — eBay's own text
  // matching isn't exact-phrase, so a query hint narrows the field but
  // doesn't guarantee every result that comes back is actually the right
  // print; the title check is what actually enforces that.
  //
  // tagFirstWord, not the tag verbatim — confirmed live this isn't just a
  // precision nicety, the full phrase is actively worse: "Wanted Poster
  // OP09-093 PSA 10" returned 3 results and 0 survived the title check,
  // where "Wanted OP09-093 PSA 10" (first word only) returned 7 real,
  // correctly-filtered matches. Real sellers write the short form, never
  // the full official variant name, so asking eBay to match the full phrase
  // asks it to match a word ("Poster") that doesn't actually appear
  // anywhere in the real listings this is trying to find.
  //
  // Not translated per language, same reasoning precisionAspectFilter's own
  // comment gives for Pokémon — `language` (the structured aspect_filter)
  // is what distinguishes the English tab from the Japanese one, not query
  // text, and neither the number nor the variant tag needs translation
  // anyway (see cards.ts's own comment on why the code is language-
  // universal for One Piece; variant tags are BerryWallet's own English-
  // side naming, used as a search hint only, not shown anywhere as JP text).
  //
  // Pokémon keeps `undefined` (the default: cleanCardName(card) + number),
  // unaffected — its own printed fraction already reliably appears in real
  // listing titles, so it never needed any of this.
  const oneNameOverride =
    card.franchise === "one-piece" ? (oneVariantTags?.map(tagFirstWord).join(" ") ?? "") : undefined;

  const activeResults = await Promise.all(
    conditionTiers.flatMap((condition) =>
      GRADED_MARKET_LANGUAGES.map((language) =>
        fetchActiveTier(
          card,
          condition,
          language,
          oneNameOverride,
          language === "Japanese" ? japaneseNumberOverride : undefined,
          oneVariantTags
        )
      )
    )
  );
  // flatMap order is condition-major, language-minor — same order as the
  // nested loop above, so this index math recovers [condition][language].
  const activeByKey = new Map<string, GradedMarketTypeData>();
  let i = 0;
  for (const condition of conditionTiers) {
    for (const language of GRADED_MARKET_LANGUAGES) {
      activeByKey.set(`${condition}:${language}`, activeResults[i++]);
    }
  }

  const conditions: GradedMarketConditionData[] = conditionTiers.map((condition) => ({
    condition,
    languages: GRADED_MARKET_LANGUAGES.map((language) => ({
      language,
      active: activeByKey.get(`${condition}:${language}`)!,
      sold: buildSoldTier(card, condition, language, oneNameOverride, language === "Japanese" ? japaneseNumberOverride : undefined),
    })),
  }));

  // ROI always compares English active listings — the default/primary
  // market, and the only one guaranteed to exist for every card. Never
  // mixes a real median with an illustrative one: if either PSA 10 or Raw
  // failed to resolve real data (in English), both fall back to
  // illustrative together, so the result is always fully real or fully
  // (and visibly) illustrative.
  const psa10 = activeByKey.get("PSA 10:English")!;
  const raw = activeByKey.get("Raw:English")!;
  const roiIsReal = psa10.isReal && raw.isReal;
  const psa10Median = roiIsReal ? psa10.medianPrice : median(illustrativeActiveListings(card, "PSA 10").rows.map((r) => r.price))!;
  const rawMedian = roiIsReal ? raw.medianPrice : median(illustrativeActiveListings(card, "Raw").rows.map((r) => r.price))!;

  const vinted = await buildVintedMarket(card);

  return {
    conditions,
    roi: {
      isReal: roiIsReal,
      percent: gradingRoi(psa10Median, rawMedian) * 100,
      psa10Median,
      rawMedian,
      gradingCostUsd: DEFAULT_PSA_GRADING_COST_USD,
      currency: card.currency,
    },
    vinted,
  };
}

/**
 * buildCached-wrapped (see that module's own header comment) — the public
 * entry point every consumer actually calls. Keyed by `card.slug`, which is
 * stable and unique per card regardless of which route resolved this
 * particular `Card` object.
 */
export async function getGradedMarketData(card: Card): Promise<GradedMarketData | undefined> {
  return buildCached(`graded-market:${card.slug}`, () => resolveGradedMarketData(card), allIllustrative);
}

/**
 * True when every active tier fell back to illustrative preview data —
 * which means eBay produced nothing real, not that this card genuinely has
 * no listings. Marks the result negative so it takes build-cache.ts's short
 * TTL instead of the 24h one.
 *
 * Confirmed live why this matters: an expired/invalid eBay OAuth credential
 * 401s every search, the circuit breaker opens after the first few, and
 * every tier lands on illustrative. Cached for a full day, that turns a
 * fixable credential problem into a day of preview-labelled panels on every
 * card with no signal that anything changed. `undefined` is NOT negative —
 * that's the deliberate franchise gate (ONE_PIECE_MARKET_ENABLED), a real
 * answer meaning "this section is switched off", and re-asking it costs
 * calls to learn nothing.
 */
function allIllustrative(data: GradedMarketData | undefined): boolean {
  if (!data) return false;
  return data.conditions.every((c) => c.languages.every((l) => !l.active.isReal));
}

export type MarketplaceOfferJsonLd = {
  "@type": "Offer";
  url: string;
  price: number;
  priceCurrency: string;
  availability: "https://schema.org/InStock";
  itemCondition: "https://schema.org/UsedCondition";
  seller: { "@type": "Organization"; name: string };
};

/**
 * Real per-listing Offer objects for embedding in this card's Product
 * JSON-LD — eBay active + Vinted, only ever built from `isReal` rows (never
 * fabricates an Offer for an illustrative preview row — same real/
 * illustrative honesty rule every other surface on this site follows).
 *
 * Why this exists: a browsing AI agent reading the rendered page or its
 * markdown mirror can still hallucinate an exact listing URL even when the
 * real one is sitting right there in a table — confirmed live (ChatGPT
 * invented a wrong Vinted listing count/average for a card whose real data
 * was correct). Models are unreliable at verbatim-transcribing long,
 * unfamiliar third-party URLs out of prose, especially deep in a long
 * document. JSON-LD is parsed mechanically rather than read, so a listing's
 * `url` field here can't be mistranscribed the way a table cell can — this
 * is the same `rows[].url` data already in the JSON API and the
 * `get_graded_market` MCP tool, just also reachable by anything that only
 * parses structured data in place rather than following a second link.
 *
 * `data` is undefined for a One Piece card (getGradedMarketData's own
 * franchise gate) — no offers to contribute, same as any other card whose
 * active listings all came back illustrative.
 */
export function gradedMarketOffersJsonLd(data: GradedMarketData | undefined): MarketplaceOfferJsonLd[] {
  if (!data) return [];
  const offers: MarketplaceOfferJsonLd[] = [];

  for (const condition of data.conditions) {
    const english = condition.languages.find((l) => l.language === "English");
    if (!english?.active.isReal) continue;
    for (const row of english.active.rows) {
      if (!row.url) continue;
      offers.push({
        "@type": "Offer",
        url: row.url,
        price: row.price,
        priceCurrency: row.currency,
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/UsedCondition",
        seller: { "@type": "Organization", name: "eBay" },
      });
    }
  }

  if (data.vinted.isReal) {
    for (const row of data.vinted.rows) {
      if (!row.url) continue;
      offers.push({
        "@type": "Offer",
        url: row.url,
        price: row.price,
        priceCurrency: row.currency,
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/UsedCondition",
        seller: { "@type": "Organization", name: "Vinted" },
      });
    }
  }

  return offers;
}
