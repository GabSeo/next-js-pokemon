import { getCatalogCard, type CatalogCard } from "@/lib/catalog";
import { getCatalogPricesByVariant, type CatalogPrice } from "@/lib/catalog-prices";
import { officialCode, officialRowsForCode } from "@/lib/one-piece-official";

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
    prints: rows.map(({ card, pack }) => ({
      key: card.id,
      // Deliberately no label. See CardPrint.label.
      origin: pack.label ?? pack.title,
      rarity: card.rarity ?? undefined,
      image: `/api/one-piece-image/${encodeURIComponent(card.id)}?lang=english`,
      price: undefined,
    })),
  };
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
