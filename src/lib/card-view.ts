import { getCatalogCard, type CatalogCard } from "@/lib/catalog";
import { getCatalogPricesByVariant, type CatalogPrice } from "@/lib/catalog-prices";
import { officialCode, officialRowsForCode } from "@/lib/one-piece-official";
import { onePieceImageUrl, onePiecePictureUrl } from "@/lib/one-piece-images";
import { isBandaiPicture, optcgRowsForCode, pictureKey, printAlias } from "@/lib/one-piece-optcg";
import { productOf, treatmentsOf } from "@/lib/one-piece-variants";

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

/**
 * What to call this printing: its product, else the treatment it carries.
 *
 * A treatment is not a product — `lib/one-piece-variants.ts` keeps them apart
 * because the distinction was measured against live eBay listings, and blurring
 * it once appended four phantom printings to OP05-119. But "no product" is not
 * the same as "nothing to say": OP09-061's Jumbo has artwork of its own and,
 * without this, arrived as an unlabelled tile beside a named one.
 *
 * The treatment vocabulary is closed and measured, so naming a printing from it
 * repeats a source rather than inventing a description. It only ever fills a
 * label that would otherwise be empty; a product always wins.
 */
function printingLabel(name: string): string | undefined {
  const product = namedProduct(name);
  if (product) return product;
  const treatments = treatmentsOf(name);
  if (treatments.length === 0) return undefined;
  return treatments
    .map((id) =>
      id
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    )
    .join(" · ");
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
 * WHAT A PRINTING IS IDENTIFIED BY, and getting this wrong cost a week. Not
 * optcgapi's `card_image_id` — that names a FILE and is reused across products.
 * A printing is identified by the PICTURE its source points at, because that is
 * the only thing that distinguishes One Piece printings at all: Bandai gives
 * every printing of a code the same name (0 of 945 multi-printing groups differ
 * by name), so the artwork is the label.
 *
 * Measured 2026-09-07: 857 optcgapi rows share a `card_image_id` with a
 * sibling, and every one of those 857 carries a DIFFERENT `card_image` URL —
 *
 *   ST21-014  base                  ->  ST21-014.jpg
 *   ST21-014  3rd Anniversary Pack  ->  Monkey.D.Luffy_-_ST21-014_3rd_Anni….jpg
 *   OP09-061  Jumbo                 ->  Monkey.D.Luffy_Jumbo_img.jpg
 *
 * Keyed on the id, those collapsed onto the base printing and the page showed
 * the base artwork for a card that looks nothing like it. Keyed on the picture,
 * they are what they are.
 *
 * NO PRINTING EVER BORROWS ANOTHER'S PICTURE. A printing shows the artwork its
 * source points at, or it shows none and says so. The rule has one apparent
 * exception that is not one: when optcgapi explicitly points a product at
 * Bandai's file, the two really do share a picture, and saying so is repeating
 * the source rather than filling a hole. 139 rows point at nothing, and those
 * render an honest gap — a printing we cannot picture and a printing that does
 * not exist are different claims.
 *
 * Coverage across all 5,223 distinct pictures optcgapi names: 4,235 served by
 * Bandai unmetered, 945 held here, 43 unavailable anywhere.
 */
function onePiecePrints(code: string, rows: ReturnType<typeof officialRowsForCode>): CardPrint[] {
  type Entry = { print: CardPrint; bucketed: boolean };

  const entries: Entry[] = rows.map(({ card, pack }) => ({
    print: {
      key: card.id,
      // Deliberately no label yet. Bandai records that a code has three
      // printings and not which is the Alternate Art; optcgapi may name it below.
      origin: pack.label ?? pack.title,
      rarity: card.rarity ?? undefined,
      image: onePieceImageUrl(card.id),
      price: undefined,
    },
    bucketed: GENERIC_PROMO_PACK.test(pack.title),
  }));

  const byId = new Map(entries.map((entry) => [entry.print.key, entry]));
  const seenPictures = new Set<string>();
  const namedProducts = new Set<string>();
  /** Anonymous Bandai rows a named printing turned out to be a second copy of. */
  const retired = new Set<string>();

  for (const row of optcgRowsForCode(code)) {
    const product = namedProduct(row.name);
    const picture = row.image ? pictureKey(row.image) : undefined;

    // A row with no picture at all. Worth a tile only when it names a product
    // nothing else here does — otherwise it is an unnamed, unpictured claim.
    if (!picture) {
      if (!product || namedProducts.has(product)) continue;
      namedProducts.add(product);
      entries.push({
        print: { key: `optcg:${product}`, label: product, origin: row.setName, rarity: row.rarity },
        bucketed: false,
      });
      continue;
    }

    if (seenPictures.has(picture)) continue;
    seenPictures.add(picture);

    // The picture IS Bandai's file for a printing. Two sub-cases, and the
    // difference is whether Bandai's own list mentions that printing.
    if (isBandaiPicture(row.image!, row.imageId)) {
      const existing = byId.get(row.imageId!);

      if (existing) {
        if (!product || namedProducts.has(product)) continue;
        namedProducts.add(product);

        // Name the anonymous row in place rather than beside it. P-033 arrives
        // from Bandai as one unlabelled "Promotion card"; optcgapi says it is
        // the CS 2023 Event Pack Finalist Ver.
        if (!existing.print.label && existing.bucketed) {
          existing.print.label = product;
          existing.print.origin = row.setName;
          continue;
        }

        // A separate product the source points at the same file — a Jumbo, an
        // oversized event print. Sharing the picture here repeats optcgapi
        // rather than guessing.
        entries.push({
          print: {
            key: `${row.imageId}~${product}`,
            label: product,
            origin: row.setName,
            rarity: row.rarity,
            image: existing.print.image,
          },
          bucketed: false,
        });
        continue;
      }

      // Bandai-named picture for a printing Bandai's list omits: the image
      // route still finds it, unmetered.
      const entry: Entry = {
        print: {
          key: row.imageId!,
          label: product,
          origin: row.setName,
          rarity: row.rarity,
          image: onePieceImageUrl(row.imageId!),
        },
        bucketed: false,
      };
      byId.set(row.imageId!, entry);
      entries.push(entry);
      if (product) namedProducts.add(product);
      continue;
    }

    // Its own artwork, held here because it exists nowhere else public.
    const entry: Entry = {
      print: {
        key: picture,
        label: printingLabel(row.name),
        origin: row.setName,
        rarity: row.rarity,
        image: onePiecePictureUrl(picture),
      },
      bucketed: false,
    };
    entries.push(entry);
    if (product) namedProducts.add(product);

    // A NAMED printing may retire an ANONYMOUS one it duplicates — never the
    // reverse, and never when it has no picture to offer in its place. See
    // scripts/one-piece-print-aliases.mts for how the pairing is measured.
    const twin = product && entry.print.image ? printAlias(picture) : undefined;
    const twinEntry = twin ? byId.get(twin) : undefined;
    if (twin && twinEntry && !twinEntry.print.label && twinEntry.bucketed) retired.add(twin);
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
