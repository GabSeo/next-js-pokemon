/**
 * TIER 1 — the offline Pokémon catalogue.
 *
 * Answers "what is this card" for all 23,546 cards in `data/catalog/pokemon/`
 * (written by scripts/catalog-crawl.mts) without making a single network call,
 * metered or otherwise.
 *
 * THE INVARIANT THIS MODULE EXISTS TO HOLD
 *
 * Every metered call this app makes is a function of how many cards someone
 * actually tracks — never of how many cards the catalogue contains. Browsing,
 * searching or rendering all 23,546 costs zero API quota.
 *
 * Two things enforce that, and neither is discipline:
 *
 * 1. **The imports.** This file imports `node:fs` and `node:path` and nothing
 *    else. It cannot reach apitcg.ts, pokewallet.ts, berrywallet.ts,
 *    ebay-browse.ts or upstream.ts, so it cannot spend quota even by mistake.
 *    Adding a market client to this import list is the one change that breaks
 *    the invariant — don't, and if you must, move it to a tier-2 module.
 *
 * 2. **The type.** `CatalogCard` carries NO price field of any kind. A page
 *    holding one cannot render a price, because there is nothing to render —
 *    the same separation lib/types.ts already keeps between `Card` and
 *    `LocalizedCardText`. Prices live in tier 2 and arrive through an explicit
 *    call that takes a tracked identifier, so every crossing is greppable.
 *
 * WHAT IT HOLDS INSTEAD OF PRICES: pointers. `cardmarketProductId` and
 * `tcgplayerProductId` say WHERE a price can be read, and go stale loudly. The
 * figures themselves are never stored — see the crawler's own header for why
 * that is the same "pointers may be stored by hand, content may not" rule
 * docs/adding-a-card.md is built on.
 *
 * SERVER ONLY. The `node:fs` import already makes a Client Component importing
 * this a build error, which is the enforcement that matters. (`import
 * "server-only"` would produce a friendlier message; the package is not a
 * dependency here and one is not worth adding for the error text alone.)
 *
 * LOADING. All 218 files are read and parsed on first access and kept for the
 * life of the process: measured 2026-09-05 at 44ms and ~17MB of heap for the
 * full corpus. A generated index file would be faster and is not worth the
 * second artifact to keep in sync at that cost — revisit if the corpus grows
 * by an order of magnitude or Japanese/One Piece corpora land beside it.
 *
 * NOT DEPLOYED-PATH TESTED. Reading from `data/` works at build time (static
 * generation runs from the project root). A DYNAMIC route reading this on
 * Vercel needs the corpus traced into its bundle via
 * `outputFileTracingIncludes` in next.config.ts — see Next's `output` config
 * reference. Nothing takes that path yet, so no config was added for a
 * consumer that does not exist.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CATALOG_DIR = path.join(process.cwd(), "data", "catalog", "pokemon");
const SETS_FILE = "_sets.json";

/**
 * One printing variant of a card, and the marketplace products that price it.
 *
 * `cardmarketProductId` is deliberately NOT unique per variant — Cardmarket
 * sells the normal and reverse-holo printings of one card under a single
 * product, and TCGdex reports the same id on both. See
 * `cardmarketPriceFields` for where the two printings' figures actually
 * diverge.
 */
export type CatalogVariant = {
  /** "normal" | "reverse" | "holo" — TCGdex's own vocabulary, passed through rather than normalised. */
  type?: string;
  /** "standard" | "jumbo". */
  size?: string;
  /**
   * TCGdex's variant taxonomy id. NOT a per-card identifier — measured
   * 2026-09-05, 18 distinct values cover 743 cards, because it names the
   * variant KIND ("holo/standard") and is reused across every card sharing it.
   * Never use this as a print key; use `tcgdexId` + `type`.
   */
  variantId?: string;
  cardmarketProductId?: number;
  tcgplayerProductId?: number;
};

/** One card's identity and its market pointers. No prices — see this file's header. */
export type CatalogCard = {
  tcgdexId: string;
  localId: string;
  name: string;
  rarity?: string;
  category?: string;
  illustrator?: string;
  image?: string;
  /**
   * Cardmarket's product id, from TCGdex's CARD-level price block.
   *
   * This, not `variants[].cardmarketProductId`, is the field to count when
   * asking "can this card be priced". The per-variant `thirdParty` ids are
   * populated only on modern sets — measured 2026-09-05, they are empty across
   * XY, Black & White, Diamond & Pearl and most of Sun & Moon, while this one
   * is populated throughout. Counting the wrong one produced a "four dead eras,
   * 7,186 unusable cards" conclusion that a 12-card-per-era sample flatly
   * contradicted (11-12 of 12 priced fine in every one of them).
   */
  cardmarketProductId?: number;
  tcgplayerProductId?: number;
  sourceUpdated?: string;
  variants: CatalogVariant[];
  /** The crawl could not fetch this card's detail. Kept so a partial corpus looks partial rather than small. */
  unresolved?: true;
  unresolvedReason?: string;
};

export type CatalogSet = {
  id: string;
  name: string;
  serie?: { id: string; name: string };
  releaseDate?: string;
  abbreviation?: { official?: string; localized?: string };
  cardCount?: { total?: number; official?: number };
  logo?: string;
  symbol?: string;
};

/** A card with the set it belongs to — what every lookup returns, since a card alone cannot name its set. */
export type CatalogEntry = { card: CatalogCard; set: CatalogSet };

type CatalogSetFile = { crawledAt: string; source: string; set: CatalogSet; cards: CatalogCard[] };

type Loaded = {
  sets: CatalogSet[];
  entries: CatalogEntry[];
  byTcgdexId: Map<string, CatalogEntry>;
  /** `${setId}\u0000${localId}` — a separator that cannot appear in either half. */
  bySetAndNumber: Map<string, CatalogEntry>;
  setsById: Map<string, CatalogSet>;
  crawledAt?: string;
};

let cache: Loaded | undefined;

function loadCatalog(): Loaded {
  if (cache) return cache;

  const sets: CatalogSet[] = [];
  const entries: CatalogEntry[] = [];
  const byTcgdexId = new Map<string, CatalogEntry>();
  const bySetAndNumber = new Map<string, CatalogEntry>();
  const setsById = new Map<string, CatalogSet>();
  let crawledAt: string | undefined;

  if (!existsSync(CATALOG_DIR)) {
    // An absent corpus is an empty catalogue, not a crash. It is a build
    // artifact (see scripts/catalog-crawl.mts); a checkout that has not run
    // the crawl yet should degrade the way an upstream outage does, not fail
    // the build. Callers already handle "no match".
    cache = { sets, entries, byTcgdexId, bySetAndNumber, setsById };
    return cache;
  }

  for (const file of readdirSync(CATALOG_DIR)) {
    if (file === SETS_FILE || !file.endsWith(".json")) continue;
    let parsed: CatalogSetFile;
    try {
      parsed = JSON.parse(readFileSync(path.join(CATALOG_DIR, file), "utf8")) as CatalogSetFile;
    } catch {
      // One unreadable set file must not take the other 217 down with it.
      continue;
    }
    sets.push(parsed.set);
    setsById.set(parsed.set.id, parsed.set);
    if (!crawledAt || parsed.crawledAt < crawledAt) crawledAt = parsed.crawledAt;

    for (const card of parsed.cards) {
      const entry: CatalogEntry = { card, set: parsed.set };
      entries.push(entry);
      byTcgdexId.set(card.tcgdexId, entry);
      bySetAndNumber.set(`${parsed.set.id}\u0000${card.localId}`, entry);
    }
  }

  cache = { sets, entries, byTcgdexId, bySetAndNumber, setsById, crawledAt };
  return cache;
}

/** One card by its TCGdex id (`swsh12-186`). The cheapest lookup and the one to prefer. */
export function getCatalogCard(tcgdexId: string): CatalogEntry | undefined {
  return loadCatalog().byTcgdexId.get(tcgdexId);
}

/**
 * One card by its set id and printed number — the join a scan or a CardRef
 * naturally has. `localId` is TCGdex's own bare number ("186"), not the
 * printed fraction ("186/195").
 */
export function getCatalogCardByNumber(setId: string, localId: string): CatalogEntry | undefined {
  return loadCatalog().bySetAndNumber.get(`${setId}\u0000${localId}`);
}

/**
 * The offline counterpart to tcgdex.ts's `findCardByNameAndSet` — the lookup
 * every Pokémon CardRef is written in terms of, answered from the corpus
 * instead of over the network.
 *
 * MATCHING IS DELIBERATELY IDENTICAL to the live function's, including the
 * parts that are loose: `localId` must equal `number` exactly, and the set is
 * matched by case-insensitive SUBSTRING. Mirroring it rather than improving it
 * is the point — this runs BEFORE the live call as an accelerator, so any
 * difference in matching would make a card resolve to one printing offline and
 * a different one on the fallback path, which is the class of bug that is
 * invisible until it prices the wrong object.
 *
 * Searches the WHOLE corpus including digital-only sets: this answers "which
 * card is this ref", not "what may a visitor browse", and a ref naming a
 * Pocket card should still resolve rather than silently missing.
 */
export function findCatalogCardByNameAndSet(
  name: string,
  setName: string,
  number: string
): CatalogEntry | undefined {
  const wantedName = name.toLowerCase();
  const wantedSet = setName.toLowerCase();
  return loadCatalog().entries.find(
    (e) =>
      e.card.localId === number &&
      e.card.name.toLowerCase() === wantedName &&
      e.set.name.toLowerCase().includes(wantedSet)
  );
}

/**
 * This card's Cardmarket product id, from whichever of the two places TCGdex
 * actually put it.
 *
 * THE TWO FIELDS ARE COMPLEMENTARY, not one superseding the other, and using
 * either alone gives a badly wrong coverage picture. Measured 2026-09-05:
 *
 *   XY / Black & White / Diamond & Pearl / Sun & Moon
 *       card-level `pricing.cardmarket.idProduct`  present
 *       per-variant `thirdParty.cardmarket`        absent
 *
 *   Gym Heroes (and the rest of the Gym series)
 *       card-level `pricing.cardmarket.idProduct`  ABSENT
 *       per-variant `thirdParty.cardmarket`        present (274137)
 *
 * Counting only `thirdParty` said 58% of physical cards were priceable and
 * declared four eras dead; counting only the card-level id said 94% but
 * dropped the whole Gym series to zero. Either is the answer to a question
 * nobody asked.
 *
 * Note this is a POINTER, and a pointer existing does not guarantee FIGURES
 * exist — a Gym card has an id here and no readable price block, so it is
 * correctly counted as reachable and still renders "No price".
 */
export function cardmarketProductIdFor(card: CatalogCard): number | undefined {
  return card.cardmarketProductId ?? card.variants.find((v) => v.cardmarketProductId !== undefined)?.cardmarketProductId;
}

/** The same two-place lookup for TCGplayer. */
export function tcgplayerProductIdFor(card: CatalogCard): number | undefined {
  return card.tcgplayerProductId ?? card.variants.find((v) => v.tcgplayerProductId !== undefined)?.tcgplayerProductId;
}

/**
 * Pokémon TCG Pocket — a digital-only game with no physical market.
 *
 * 2,480 cards across 15 sets, and none of them can be owned, graded, sold or
 * priced: they carry no Cardmarket or TCGplayer product because there is
 * nothing to buy. On a browse surface for collectors they are noise.
 *
 * THEY STAY IN THE CORPUS. The crawler filters nothing, deliberately — a set
 * dropped at crawl time is a judgement baked into the data where nobody can
 * see or revisit it. Excluding them HERE is a query, stated in one predicate,
 * and reversible by deleting a call. That distinction is the whole reason
 * every set record carries `serie`.
 */
export function isDigitalOnlySet(set: CatalogSet): boolean {
  return /pocket/i.test(set.serie?.name ?? "");
}

/**
 * Every set in the corpus.
 *
 * Excludes digital-only sets by default, because every caller so far is a
 * browse surface for physical cards. Pass `includeDigital` for the corpus as
 * crawled — `catalogStats` uses it to report what is actually held.
 */
export function getCatalogSets(options?: { includeDigital?: boolean }): CatalogSet[] {
  const sets = loadCatalog().sets;
  return options?.includeDigital ? sets : sets.filter((set) => !isDigitalOnlySet(set));
}

export function getCatalogSet(setId: string): CatalogSet | undefined {
  return loadCatalog().setsById.get(setId);
}

/** Every card in one set, in the order the crawl wrote them (TCGdex's own set order). */
export function getCatalogSetCards(setId: string): CatalogEntry[] {
  return loadCatalog().entries.filter((e) => e.set.id === setId);
}

/**
 * WHERE a variant's prices are read from — a pointer, like everything else
 * here. Reads nothing and calls nothing.
 *
 * Measured 2026-09-05, and it is not what the shape suggests. Cardmarket
 * prices the normal and reverse-holo printings of one card under ONE product,
 * and TCGdex returns the identical price block on both variants; the two
 * printings are separated by FIELD SUFFIX inside that block, not by product:
 *
 *   Venonat swsh12-001   normal   avg 0.04    reverse   avg-holo 0.18   (4.5x)
 *
 * So a consumer that reads `avg` for a reverse holo reads the normal card's
 * price. That matters at scale rather than today: 42.9% of the corpus is
 * multi-variant, while all three currently-tracked Pokémon cards are holo-only
 * and unambiguous.
 *
 * The holo-only case is the subtlety. When a card has no `normal` variant the
 * PLAIN fields carry the holo price and the `-holo` fields are null — so the
 * suffix does not mean "holo", it means "the reverse-holo printing of a card
 * that also exists unfoiled". Hence the branch on the card's own variant list
 * rather than on the variant type alone.
 *
 * Returns the Cardmarket field suffix and the TCGplayer sub-type key, which is
 * everything a tier-2 reader needs to pick the right numbers out of a live
 * response.
 */
export function cardmarketPriceFields(card: CatalogCard, variantType: string | undefined): {
  /** Append to "avg" / "low" / "trend" / "avg1" / "avg7" / "avg30". Empty string means the plain field. */
  cardmarketSuffix: "" | "-holo";
  /** The key under TCGdex's `pricing.tcgplayer` for this printing. */
  tcgplayerKey: "normal" | "reverse-holofoil" | "holofoil";
} {
  const hasNormal = card.variants.some((v) => v.type === "normal");
  if (variantType === "reverse") {
    // Only meaningful alongside a normal printing; a reverse-only card would
    // be a shape this codebase has not seen, and the plain fields are the
    // honest answer for it rather than a guess at a suffix that is null.
    return hasNormal
      ? { cardmarketSuffix: "-holo", tcgplayerKey: "reverse-holofoil" }
      : { cardmarketSuffix: "", tcgplayerKey: "reverse-holofoil" };
  }
  if (variantType === "normal") return { cardmarketSuffix: "", tcgplayerKey: "normal" };
  return { cardmarketSuffix: "", tcgplayerKey: "holofoil" };
}

/**
 * Counts for "how much do we actually cover".
 *
 * Excludes digital-only sets by default so the figure a browse page prints
 * matches the number of sets it is willing to show — a header reading "23,546
 * cards across 218 sets" above a list of 203 is its own small lie. Pass
 * `includeDigital` for the corpus as crawled.
 */
export function catalogStats(options?: { includeDigital?: boolean }): {
  sets: number;
  cards: number;
  unresolved: number;
  withCardmarketPointer: number;
  withTcgplayerPointer: number;
  multiVariant: number;
  crawledAt?: string;
} {
  const loaded = loadCatalog();
  const crawledAt = loaded.crawledAt;
  const sets = options?.includeDigital ? loaded.sets : loaded.sets.filter((set) => !isDigitalOnlySet(set));
  const included = new Set(sets.map((set) => set.id));
  const entries = loaded.entries.filter((entry) => included.has(entry.set.id));
  let unresolved = 0;
  let withCardmarketPointer = 0;
  let withTcgplayerPointer = 0;
  let multiVariant = 0;
  for (const { card } of entries) {
    if (card.unresolved) unresolved++;
    // Either place — see cardmarketProductIdFor on why checking one field
    // alone gives a badly wrong answer in two opposite directions.
    if (cardmarketProductIdFor(card) !== undefined) withCardmarketPointer++;
    if (tcgplayerProductIdFor(card) !== undefined) withTcgplayerPointer++;
    if (card.variants.length > 1) multiVariant++;
  }
  return {
    sets: sets.length,
    cards: entries.length,
    unresolved,
    withCardmarketPointer,
    withTcgplayerPointer,
    multiVariant,
    crawledAt,
  };
}
