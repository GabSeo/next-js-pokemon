import { conditionSearchLink } from "@/lib/ebay-search";
import { searchActiveListings, type EbayCondition, type EbayLanguage } from "@/lib/ebay-browse";
import { illustrativeActiveListings, illustrativeSoldListings, illustrativeVintedFeed } from "@/lib/illustrative";
import { DEFAULT_PSA_GRADING_COST_USD, gradingRoi, median } from "@/lib/roi";
import { getVintedListingsForCard, relativeTimeLabel, TRES_BON_ETAT, vintedQueryForCard } from "@/lib/vinted-listings";
import { getJapaneseCardText } from "@/lib/cards";
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
 * One flag: the market tab, the /products/[slug]/ja route, and the JP
 * locale links all read from here.
 */
export const JAPANESE_MARKET_ENABLED = true;

/**
 * One Piece is OFF — not an architectural decision (this function's own
 * PSA/eBay/Vinted shape is meant to cover both franchises eventually, same
 * as everything else on a product page), just not ready yet: One Piece
 * identity resolution (BerryWallet, see cards.ts's resolveBerryWalletCard/
 * getOnePieceJapaneseText) still has open card-detail issues being worked on
 * separately, and shipping the graded-market panel on top of an identity
 * that isn't settled yet would mean re-verifying eBay/Vinted match quality
 * twice. Until then, this saves the 8 eBay searches + Vinted read a One
 * Piece render would otherwise make for a section that isn't ready to show
 * — same "one flag gates a whole feature" shape as JAPANESE_MARKET_ENABLED
 * above. Flip to true once the identity work lands; nothing else in this
 * file needs to change.
 */
export const ONE_PIECE_MARKET_ENABLED = false;

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
 * `numberOverride` is the Japanese print's own set number (resolved by the
 * caller via getJapaneseCardText — Pokémon only, see that function's own
 * comment on why it's genuinely different from card.number) — see
 * cardSearchTerms's doc comment (lib/ebay-search.ts) for why searching or
 * title-matching on card.number's English number would silently reject real
 * Japanese listings.
 *
 * `termsOverride` is One Piece's own fully pre-built query — "<real print
 * name> <set name>", both per-language — in place of numberOverride's
 * narrower name+number swap. The two are mutually exclusive per call
 * (Pokémon passes numberOverride, One Piece passes termsOverride), so both
 * are threaded straight through rather than merged into one parameter.
 */
async function fetchActiveTier(
  card: Card,
  condition: EbayCondition,
  language: EbayLanguage,
  numberOverride?: string,
  termsOverride?: string
): Promise<GradedMarketTypeData> {
  try {
    const { listings, total } = await searchActiveListings(card, condition, language, undefined, numberOverride, termsOverride);
    if (listings.length === 0) {
      console.warn(
        `[ebay] 0 active listings for ${card.id} [${condition}/${language}] — search succeeded but returned nothing. ` +
          `Likely conditionIds/aspect_filter/query mismatch for this card. Falling back to preview.`
      );
    }
    const med = listings.length > 0 ? median(listings.map((l) => l.price)) : null;
    if (med !== null) {
      return {
        isReal: true,
        medianPrice: med,
        currency: card.currency,
        count: total,
        seeAllUrl: conditionSearchLink(card, condition, language, undefined, numberOverride, termsOverride),
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
    seeAllUrl: conditionSearchLink(card, condition, language, undefined, numberOverride, termsOverride),
    rows: rows.map((row) => ({ ...row, currency: card.currency })),
  };
}

/**
 * Always illustrative — see lib/illustrative.ts's comment on why sold data
 * can't be real here (eBay's sold-data API is restricted, closed to new
 * applicants).
 *
 * `numberOverride`/`termsOverride` only affect seeAllUrl (the rows
 * themselves are always illustrative) — same reasoning as fetchActiveTier's
 * own comment, so a reader clicking through lands on a search for the
 * card's real number/print name, not a mismatched one.
 */
function buildSoldTier(
  card: Card,
  condition: EbayCondition,
  language: EbayLanguage,
  numberOverride?: string,
  termsOverride?: string
): GradedMarketTypeData {
  const { rows, total } = illustrativeSoldListings(card, condition);
  return {
    isReal: false,
    medianPrice: median(rows.map((r) => r.price))!,
    currency: card.currency,
    count: total,
    seeAllUrl: conditionSearchLink(card, condition, language, undefined, numberOverride, termsOverride),
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
 * Cost note: this is 4 conditions x 2 languages = 8 real eBay searches per
 * card (down from 12 now that French no longer goes through eBay at all —
 * sold stays illustrative-only regardless of language, so it adds no API
 * cost), each cached for 1h. Fine at this site's scale; worth revisiting if
 * traffic grows enough to approach eBay's 5,000 calls/day default limit.
 *
 * One Piece is gated off by ONE_PIECE_MARKET_ENABLED above, not a permanent
 * Pokémon-only design — this function's PSA/eBay/Vinted shape is meant to
 * cover both franchises once One Piece's own identity resolution
 * (BerryWallet, see cards.ts) is settled. Until then, running the same 8
 * eBay searches + Vinted read against an identity still being debugged would
 * mean re-verifying match quality twice — once now, again once the identity
 * work lands — for a section a One Piece page can't show correctly yet
 * anyway (every consumer of this data renders it under a "Pokémon Market
 * Overview" header). Returning undefined while the flag is off is the same
 * "only build what's ready" rule this codebase already applies to
 * JAPANESE_MARKET_ENABLED — every caller (the panel, the markdown export,
 * the JSON API, the MCP tool) skips the section cleanly rather than showing
 * it half-working. One Piece already has its own real "current price" from
 * BerryWallet regardless (resolveBerryWalletCard/berryWalletPrice in
 * lib/cards.ts) — this function was never that franchise's only source of
 * real market data, just the only source of this particular one. The query
 * shape and tier list below (conditionsFor, the One Piece terms block) are
 * already built for both franchises even while the flag is off, so flipping
 * it is the only step left once the identity work lands.
 */
export async function getGradedMarketData(card: Card): Promise<GradedMarketData | undefined> {
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

  // One Piece's own query shape: "<real print name> <set name>" — one fixed
  // string, reused for every language exactly the way Pokémon's own query
  // TEXT never changes for Japanese either (only numberOverride does, above
  // — see cardSearchTerms's own comment, lib/ebay-search.ts). NOT
  // translated per language: same reasoning ebay-browse.ts's
  // precisionAspectFilter comment already gives for Pokémon — sellers write
  // English listing titles ("PSA 10", the card number/name) even for a
  // genuine Japanese print, so translating our own query text would match
  // real listings *worse*, not better. `language` alone (the structured
  // aspect_filter, already threaded through fetchActiveTier below) is what
  // actually distinguishes the English tab from the Japanese one.
  const oneTerms = card.franchise === "one-piece" && card.printName ? `${card.printName} ${card.set}` : undefined;

  const activeResults = await Promise.all(
    conditionTiers.flatMap((condition) =>
      GRADED_MARKET_LANGUAGES.map((language) =>
        fetchActiveTier(card, condition, language, language === "Japanese" ? japaneseNumberOverride : undefined, oneTerms)
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
      sold: buildSoldTier(card, condition, language, language === "Japanese" ? japaneseNumberOverride : undefined, oneTerms),
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
