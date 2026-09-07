import { getCatalogCard, type CatalogCard } from "@/lib/catalog";
import { getCatalogPricesByVariant, type CatalogPrice } from "@/lib/catalog-prices";
import { officialCode, officialRowsForCode } from "@/lib/one-piece-official";
import { onePieceImageUrl, onePieceImageUrlOrNone } from "@/lib/one-piece-images";
import { optcgRowsForCode, printAlias } from "@/lib/one-piece-optcg";
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
   * One Piece: Bandai does not sell singles. optcgapi carries prices keyed by
   * card code and joinable to Bandai's printing ids, which is new — wiring them
   * in is its own piece of work (ARCHITECTURE_AUDIT.md §3).
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

/**
 * The product a row names, or undefined when its parenthetical is not one.
 *
 * `productOf` carries the treatment table measured against live eBay listings —
 * Parallel, Manga, SP, Gold, Wanted Poster are treatments Bandai already lists
 * as separate printings with their own artwork, and admitting them here once
 * appended four phantom tiles to OP05-119. What survives that can still be the
 * card's own identity repeated (`119`, `OP05-119`), so both shapes are dropped.
 */
function namedProduct(name: string): string | undefined {
  const product = productOf(name);
  if (!product) return undefined;
  if (/^\d{1,3}$/.test(product) || /^[A-Z]{1,4}\d{0,2}-?\d{2,3}$/i.test(product)) return undefined;
  return product;
}

/** One Piece: every printing of a code, across every pack that holds one. */
function onePieceView(code: string): CardView | undefined {
  const rows = officialRowsForCode(code, "english");

  // 17 codes exist in optcgapi and not in Bandai's English list. Returning
  // "not found" for a card somebody is holding is worse than returning it from
  // the mirror — and since the merge below keys on Bandai's own printing ids,
  // this path is the same code with an empty left side.
  if (rows.length === 0) {
    const fallback = optcgRowsForCode(code);
    if (fallback.length === 0) return undefined;
    return {
      tcg: "onepiece",
      code,
      name: fallback[0].name.replace(/\s*\([^)]*\)\s*$/, ""),
      priceNote:
        "Not in Bandai's English card list — details from optcgapi, an independent mirror. " +
        "Each printing below is a different product.",
      prints: onePiecePrints(code, []),
    };
  }

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

/**
 * THE MERGE: one printing list per code, from both catalogues at once.
 *
 * WHY A JOIN IS POSSIBLE AT ALL, and it is the finding this rests on: optcgapi's
 * `card_image_id` is BANDAI'S OWN printing id — `P-033_pr1`, `OP09-061_pr1`,
 * `OP05-119_p6` — the same string punk-records stores as `card.id`. So the two
 * sources can be joined on identity rather than matched on names, which is what
 * every earlier attempt did and why it kept inventing printings.
 *
 * Measured 2026-09-07 across all 4,930 distinct printings optcgapi knows:
 *
 *   4,299  already in punk-records          image from Bandai, unmetered
 *     541  Bandai's list does not carry      image repatriated into this repo
 *      10  outside the list, Bandai has it   image from Bandai
 *      80  no image anywhere public          listed, with the gap showing
 *
 * That is 98.4% of printings rendering their own artwork. Before this, the 551
 * in the middle two rows either did not appear or showed a different card's
 * picture — which is the failure that started this: scanning a card you are
 * holding and getting no reference for it.
 *
 * TWO KINDS OF optcgapi ROW, and they are not interchangeable:
 *
 *   a NEW imageId      a printing Bandai's list omits entirely. Genuinely its
 *                      own artwork, so it becomes its own tile.
 *   a KNOWN imageId    the same picture as a printing already listed. A Jumbo
 *                      promo is a real, separate product that reuses the art.
 *                      Worth a tile only when it NAMES something.
 *
 * Rows are never dropped for lack of a name and never invented from one.
 */
function onePiecePrints(code: string, rows: ReturnType<typeof officialRowsForCode>): CardPrint[] {
  type Entry = { print: CardPrint; bucketed: boolean };

  const entries: Entry[] = rows.map(({ card, pack }) => ({
    print: {
      key: card.id,
      // Deliberately no label yet. See CardPrint.label — Bandai records that a
      // code has three printings and not which is the Alternate Art. optcgapi
      // may fill this in below.
      origin: pack.label ?? pack.title,
      rarity: card.rarity ?? undefined,
      image: onePieceImageUrl(card.id),
      price: undefined,
    },
    bucketed: GENERIC_PROMO_PACK.test(pack.title),
  }));

  const byId = new Map(entries.map((entry) => [entry.print.key, entry]));
  const namedProducts = new Set<string>();
  /** Anonymous Bandai rows a named printing turned out to be a second copy of. */
  const retired = new Set<string>();

  for (const row of optcgRowsForCode(code)) {
    const product = namedProduct(row.name);
    const existing = row.imageId ? byId.get(row.imageId) : undefined;

    if (row.imageId && !existing) {
      // Bandai's list does not have this printing. `onePieceImageUrl` resolves
      // it to the file we repatriated, or to Bandai when they serve it after
      // all — the caller never needs to know which.
      const entry: Entry = {
        print: {
          key: row.imageId,
          label: product,
          origin: row.setName,
          rarity: row.rarity,
          // May be undefined: 80 of these printings are named by the mirror and
          // pictured by nobody. See onePieceImageUrlOrNone.
          image: onePieceImageUrlOrNone(row.imageId, Boolean(row.image)),
          price: undefined,
        },
        bucketed: false,
      };
      byId.set(row.imageId, entry);
      entries.push(entry);
      if (product) namedProducts.add(product);

      // THE DUPLICATE THIS RETIRES. Bandai lists six Spandine promo printings
      // and names none of them; optcgapi lists seven and names all of them,
      // under different ids. Several are the same picture, so listing both
      // sides showed the card fifteen times. A NAMED printing may retire the
      // ANONYMOUS one it duplicates — never the reverse, and never when this
      // tile has no picture to offer in its place.
      const twin = product && entry.print.image ? printAlias(row.imageId) : undefined;
      const twinEntry = twin ? byId.get(twin) : undefined;
      if (twin && twinEntry && !twinEntry.print.label && twinEntry.bucketed) retired.add(twin);
      continue;
    }

    if (!product || namedProducts.has(product)) continue;
    namedProducts.add(product);

    // NAME IN PLACE rather than beside, when the row we already show is the
    // anonymous one this product describes. P-033 arrives from Bandai as a
    // single unlabelled "Promotion card"; optcgapi says it is the CS 2023 Event
    // Pack Finalist Ver. Adding a second tile would show the same picture twice
    // and leave one of them nameless.
    if (existing && !existing.print.label && existing.bucketed) {
      existing.print.label = product;
      existing.print.origin = row.setName;
      continue;
    }

    // A separate product that reuses artwork we already show — a Jumbo, an
    // oversized event print. Its own tile, its own name, the shared picture.
    entries.push({
      print: {
        key: `optcg:${product}`,
        label: product,
        origin: row.setName,
        rarity: row.rarity,
        image: existing?.print.image ?? onePieceImageUrl(code),
        price: undefined,
      },
      bucketed: false,
    });
  }

  return entries.filter((entry) => !retired.has(entry.print.key)).map((entry) => entry.print);
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
