import { getCatalogCard, type CatalogCard } from "@/lib/catalog";
import { getCatalogPricesByVariant, type CatalogPrice } from "@/lib/catalog-prices";
import { opRowsForCode, opTreatment } from "@/lib/one-piece-catalog";
import { officialCode, officialRowsForCode } from "@/lib/one-piece-official";
import { productOf } from "@/lib/one-piece-variants";

/**
 * The card→print shape both games render through — see
 * docs/free-tier-catalogue.md §2.
 *
 * WHY THIS EXISTS. Both catalogues store CARDS. A collection holds PRINTS, and
 * the two are not the same object: a reverse holo is worth a median 3.36x its
 * normal twin, and a PRB-01 alt art about half its original. Every page below
 * this point — the card page now, the scan's candidate grid later, a collection
 * row after that — needs a print, so the normalising happens once, here, rather
 * than in each of them.
 *
 * THE TWO GAMES ARE MIRROR IMAGES, measured 2026-09-07 (§1), and this shape is
 * built to hold both rather than to hide the difference:
 *
 *   One Piece   every print has its own IMAGE and no label   (945/945 groups)
 *   Pokémon     every print has a LABEL and no image of its own  (0/10,110)
 *
 * So `image` is per-print for One Piece and shared for Pokémon, and `label` is
 * meaningful for Pokémon and deliberately absent for One Piece. Neither is a
 * gap to fill in later; they are what the sources actually contain.
 *
 * TIER 1: files on disk plus a price snapshot, so nothing here can spend a
 * metered call. `getCatalogPricesByVariant` may fall back to TCGdex for a card
 * added upstream since the last refresh, which has no ceiling in api-budget.ts.
 */

export type CardPrint = {
  /** Stable within a card. The One Piece printing id, or the Pokémon variant type. */
  key: string;
  /**
   * What to call this printing, where the source says. "reverse", "holo",
   * "1st-edition" for Pokémon. **Undefined for One Piece**: Bandai records that
   * a code has three printings and not which is the Alternate Art — 0 of 945
   * multi-printing groups differ by name. The picture is the label there.
   */
  label?: string;
  /** Where this printing was printed — a Pokémon set, a One Piece pack. */
  origin: string;
  rarity?: string;
  /** Per-print for One Piece; the card's shared artwork for Pokémon. */
  image?: string;
  /** Snapshot figures. Pokémon only today — see §6 on the One Piece join. */
  price?: CatalogPrice;
};

export type CardView = {
  tcg: "pokemon" | "onepiece";
  /** The address of this card: a TCGdex id, or a One Piece card code. */
  code: string;
  name: string;
  prints: CardPrint[];
  /**
   * Stated rather than implied, because absence has two different causes and a
   * reader deserves to know which. Pokémon: prices are a local snapshot.
   * One Piece: Bandai does not sell singles, and our price corpus is keyed on
   * ids we have not proved joinable to Bandai's (§6).
   */
  priceNote: string;
};

/** Pokémon: one card, its variants, each variant's own figures. */
function pokemonView(tcgdexId: string, prices: Map<string, CatalogPrice[]>): CardView | undefined {
  const entry = getCatalogCard(tcgdexId);
  if (!entry) return undefined;

  const { card, set } = entry;
  const byVariant = prices.get(card.tcgdexId) ?? [];

  return {
    tcg: "pokemon",
    code: card.tcgdexId,
    name: card.name,
    priceNote: "Cardmarket and TCGplayer, from our latest snapshot. Each printing is priced separately.",
    prints: variantPrints(card, set.name, byVariant),
  };
}

/**
 * ONE TILE PER VARIANT TYPE, which is fewer than `card.variants` holds.
 *
 * Base Set Charizard carries FOUR `holo` variants, and they are real, separate
 * printings — the first points at Cardmarket product 273699 and the rest at
 * 660224, which is 1st Edition against Unlimited. But TCGdex types all four
 * identically, and `variantId` is a taxonomy key reused across cards rather
 * than a per-card identifier (see CatalogVariant), so nothing in our data can
 * NAME which is which. Rendering four tiles all reading "holo" would show a
 * distinction we cannot explain and invite the reader to guess.
 *
 * This is the Pokémon mirror of the One Piece gap in §1: printings that
 * genuinely differ, with no label to tell them apart. There it is solved by the
 * artwork; here the artwork is identical too, so the honest move is one tile.
 * `getCatalogPricesByVariant` already dedupes the same way, so the two agree.
 *
 * Not a permanent answer. The TCGplayer block names Phase 1 resolves through
 * (`1st-edition-holofoil`, `unlimited-holofoil`) ARE the missing vocabulary,
 * and turning those into named printings is its own piece of work.
 *
 * Variants the snapshot could not price are still listed, with the gap showing
 * rather than dropped — a printing we cannot price and a printing that does not
 * exist are different claims.
 */
function variantPrints(card: CatalogCard, setName: string, byVariant: CatalogPrice[]): CardPrint[] {
  const seen = new Set<string>();
  const prints: CardPrint[] = [];

  for (const variant of card.variants) {
    const key = variant.type ?? "unknown";
    if (seen.has(key)) continue;
    seen.add(key);

    prints.push({
      key,
      label: variant.type,
      origin: setName,
      rarity: card.rarity,
      image: card.image ? `${card.image}/high.webp` : undefined,
      price: byVariant.find((p) => p.variantType === variant.type),
    });
  }

  return prints;
}

/**
 * Packs Bandai uses as a bucket rather than a product.
 *
 * A promo card's real origin — Event Pack Vol. 2, Treasure Cup 2024, an Offline
 * Regional Participation Pack — is what a collector calls it and what a
 * marketplace listing says. Bandai's own card list files all of them under one
 * of these, so three physically different cards arrive as one row named
 * "Promotion card".
 */
const GENERIC_PROMO_PACK = /promotion|other product|限定商品|プロモーション/i;

/** `(P-033)` is a code repeated in the name, not a product. */
const CODE_LIKE = /^[A-Z]{1,4}\d{0,2}-?\d{2,3}$/i;

/**
 * The printings the BerryWallet corpus knows for a code Bandai lumped.
 *
 * MEASURED 2026-09-07, and it is the largest single gap in our One Piece data.
 * Bandai files 349 codes under a generic promo bucket; for 343 of them (98%)
 * the corpus names an actual product, and for 322 it holds MORE printings than
 * Bandai lists at all:
 *
 *   P-033     Bandai 1  ->  corpus 5: Event Pack Vol. 2, CS 2023 Event Pack,
 *                           CS 2023 Event Pack Finalist Ver., …
 *   EB01-043  Bandai 7  ->  corpus 10: Offline Regional Participation Pack
 *                           2025 Vol.1, Finalist Card Set, Champion Card Set
 *
 * These are precisely the cards people search for and the ones tracked in
 * card-refs.ts, so showing them as one anonymous "Promotion card" was the
 * catalogue's most visible failure.
 *
 * THE IMAGE STAYS BANDAI'S BASE PRINTING, and that is not a shortcut: verified,
 * Bandai serves P-033.png and 404s on P-033_pr1 and P-033_pr2. No distinct
 * artwork exists publicly for these products. A competitor with the same
 * product names shows the same base image for the same reason.
 *
 * Applied ONLY to lumped codes. Everywhere else Bandai's own printing list is
 * richer and carries real per-printing artwork, and the corpus row ids cannot
 * be joined to Bandai's printing ids anyway (ARCHITECTURE_AUDIT.md §6) — so
 * this replaces a list that says nothing rather than merging two that disagree.
 */
function promoPrintsFromCorpus(code: string, image: string): CardPrint[] {
  const seen = new Set<string>();
  const prints: CardPrint[] = [];

  for (const row of opRowsForCode(code)) {
    const product = productOf(row.card.name);
    if (!product || CODE_LIKE.test(product)) continue;
    if (seen.has(product)) continue;
    seen.add(product);

    const treatment = opTreatment(row.card.name);
    prints.push({
      key: `corpus:${product}`,
      // The product IS the label here — it is the only thing separating these.
      label: treatment && treatment !== product ? `${product} · ${treatment}` : product,
      origin: row.set.name,
      rarity: row.card.rarity,
      image,
      price: undefined,
    });
  }

  return prints;
}

/** One Piece: every printing of a code, across every pack that holds one. */
function onePieceView(code: string): CardView | undefined {
  const rows = officialRowsForCode(code, "english");
  if (rows.length === 0) return undefined;

  return {
    tcg: "onepiece",
    code,
    name: rows[0].card.name,
    priceNote:
      "No prices: Bandai publishes what a card is and does not sell singles. " +
      "Each printing below is a different picture — that is what tells them apart.",
    prints: onePiecePrints(code, rows),
  };
}

function onePiecePrints(code: string, rows: ReturnType<typeof officialRowsForCode>): CardPrint[] {
  const toPrint = ({ card, pack }: (typeof rows)[number]): CardPrint => ({
    key: card.id,
    // Deliberately no label. See CardPrint.label.
    origin: pack.label ?? pack.title,
    rarity: card.rarity ?? undefined,
    image: `/api/one-piece-image/${encodeURIComponent(card.id)}?lang=english`,
    price: undefined,
  });

  // Split rather than all-or-nothing: the common shape is a card that exists in
  // a real set AND in several promo products, and Bandai names the first and
  // buckets the rest. EB01-043 is one EB-01 row plus six identical "Promotion
  // card" rows. Replacing the whole list would discard the one row that carries
  // a real pack and distinct artwork; keeping the whole list leaves six
  // indistinguishable tiles.
  const fromRealPacks = rows.filter(({ pack }) => !GENERIC_PROMO_PACK.test(pack.title));
  const bucketed = rows.filter(({ pack }) => GENERIC_PROMO_PACK.test(pack.title));
  if (bucketed.length === 0) return rows.map(toPrint);

  const named = promoPrintsFromCorpus(code, `/api/one-piece-image/${encodeURIComponent(code)}?lang=english`);
  // Only trade anonymous rows for named ones when there are at least as many
  // names as rows being replaced — otherwise a card would silently lose
  // printings in exchange for labels.
  if (named.length < bucketed.length) return rows.map(toPrint);

  return [...fromRealPacks.map(toPrint), ...named];
}

/**
 * Every printing of one card, for either game.
 *
 * `code` is a TCGdex id (`sv08-001`) for Pokémon and a card code (`OP05-119`)
 * for One Piece — each game's own address, not a scheme invented here.
 */
export async function getCardView(tcg: string, code: string): Promise<CardView | undefined> {
  if (tcg === "onepiece") return onePieceView(officialCode(code));
  if (tcg !== "pokemon") return undefined;

  const entry = getCatalogCard(code);
  if (!entry) return undefined;
  const prices = await getCatalogPricesByVariant([entry.card]);
  return pokemonView(code, prices);
}
