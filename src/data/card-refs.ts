import type { Franchise } from "@/lib/types";

type CodeLookup = {
  by: "code";
  code: string;
  /**
   * Disambiguates among multiple real print variants sharing the same code
   * — apitcg's `findProductByCode` and BerryWallet's `findCardInLanguage`
   * both take this as a full-combination match (every tag must appear in
   * the candidate's name), not any-of. See either function's own doc
   * comment for why "SP" and the other named variants never co-occur on one
   * card, so a request naming two mutually-exclusive tags has to pick one.
   */
  variantTags?: string[];
};
type NameSetLookup = { by: "nameSet"; name: string; setName: string; number: string };

export type CardRef = {
  franchise: Franchise;
  tcg: "pokemon" | "one-piece";
  slug: string;
  displayName: string;
  /** The real-world character this card depicts — the EntityMap entity it's evidence for. Two cards can share a character; that's the point, not a duplicate. */
  character: string;
  lookup: CodeLookup | NameSetLookup;
  /**
   * One Piece only: card identity (name/set/rarity/image/current price)
   * comes from BerryWallet instead of apitcg's English-only TCGPlayer
   * catalog — apitcg's own `lookup.code` (+ `variantTags`) match still
   * supplies price HISTORY regardless, since BerryWallet has no history
   * endpoint on its free tier (see lib/berrywallet.ts's file header).
   *
   * When true, BOTH English and Japanese identity get resolved — English is
   * always the canonical `/products/[slug]` page (same "the page/UI is
   * English regardless of a card's real data language" rule the French page
   * already follows), Japanese becomes the real `/products/[slug]/ja`
   * alternate (see cards.ts's getOnePieceJapaneseText, the One Piece
   * counterpart to getFrenchCardText). French gets neither: confirmed live,
   * BerryWallet has zero French sets, so a One Piece card's FR toggle is
   * always the inert "no real source" placeholder, never a fabricated
   * translation — same honesty rule getFrenchCardText already follows.
   *
   * Omitted keeps the plain apitcg-only path (every Pokémon ref).
   */
  berryWalletEnabled?: boolean;
  /**
   * Pokémon only: a confirmed PokéWallet card id (`pk_...`) for this card's
   * real Japanese-print counterpart — powers the real `/products/[slug]/ja`
   * alternate, the same role berryWalletEnabled plays for One Piece.
   *
   * Deliberately a stored, hand-confirmed id, not a live search — confirmed
   * during this integration's own research that automated English->Japanese
   * matching isn't reliable for the specific alt-art/secret-rare chase
   * prints this site tracks (ordinary base-set cards map cleanly by
   * sequence number across a consistent set pairing, e.g. English "SV10:
   * Destined Rivals" 001/182 = Japanese "SV9a: Heat Wave Arena" 001/063 —
   * but a chase card routinely doesn't follow that pairing at all: Gengar
   * VMAX's real match isn't in the mainline Japanese set corresponding to
   * "Fusion Strike," it's a standalone "High-Class Deck" promotional
   * product; Ethan's Typhlosion's is in the mainline Japanese set but at an
   * unrelated number). Each id below was found by hand — search PokéWallet
   * by character name, then cross-reference rarity tier and real price
   * against this card's own known price to confirm which of several
   * same-name candidates is actually the right one (see lib/pokewallet.ts's
   * file header for the full worked examples). Omitted keeps the /ja route
   * on its existing English-echo placeholder for that card.
   */
  pokeWalletCardId?: string;
};

/**
 * The 6 tracked cards. Slugs are precomputed here (not derived from a live
 * API call) so generateStaticParams never depends on network access at
 * build time — only rendering the page content does.
 */
export const cardRefs: CardRef[] = [
  {
    // Japanese counterpart: "Gengar VMAX - 020/019", SS: Gengar VMAX
    // High-Class Deck (set_code sGG) — a standalone promotional product, not
    // the mainline Japanese Fusion Strike counterpart. Confirmed by hand:
    // real Cardmarket pricing (avg €2200) in the same tier as this card's
    // own real chase-card price.
    franchise: "pokemon",
    tcg: "pokemon",
    slug: "gengar-vmax-271",
    displayName: "Gengar VMAX",
    character: "Gengar",
    lookup: { by: "nameSet", name: "Gengar VMAX", setName: "Fusion Strike", number: "271" },
    pokeWalletCardId: "pk_50b5047203194416e4c69f82722dcb9ec4a2fcc8626f50e7059c66ffba22f7ab44e0725622462923379d4833b2c194",
  },
  {
    // Japanese counterpart: "Lugia V - 110/098", S12: Paradigm Trigger,
    // rarity Super Rare — confirmed by hand: real price ($474.99 TCGPlayer /
    // €818.50 Cardmarket) nearly matches this card's own real $526.43,
    // versus a same-set, same-rarity-tier-name decoy candidate (109/098) at
    // just $16 — the price match is what actually confirms this is the
    // right one among several same-name results.
    franchise: "pokemon",
    tcg: "pokemon",
    slug: "lugia-v-186",
    displayName: "Lugia V",
    character: "Lugia",
    lookup: { by: "nameSet", name: "Lugia V", setName: "Silver Tempest", number: "186" },
    pokeWalletCardId: "pk_e88868d2c977bac87817cde39138f729bb1cd10824fcb08241d47c722c2c1a1fb566c0d9f9f343eae836188d9acb02c7",
  },
  {
    // Japanese counterpart: "Ethan's Typhlosion - 070/063", SV9a: Heat Wave
    // Arena, rarity Art Rare (the direct Japanese-rarity equivalent of
    // English "Illustration Rare") — confirmed by hand: real price ($13.98)
    // in the same tier as this card's own $24.89, versus the same set's
    // plain "Rare" 017/063 at $0.37, which is a different, ordinary print.
    franchise: "pokemon",
    tcg: "pokemon",
    slug: "ethans-typhlosion-190",
    displayName: "Ethan's Typhlosion",
    character: "Typhlosion",
    lookup: { by: "nameSet", name: "Ethan's Typhlosion", setName: "Destined Rivals", number: "190" },
    pokeWalletCardId: "pk_c7a601e8ac53e07dad8f184bdd431dc8aabadf6572cb198b19a3b62594a69dbc0e43347324b52f347ebf32f01c8022",
  },
  {
    // Both English and Japanese identity real, via BerryWallet — confirmed
    // live: card_number OP09-004 has 4 real Japanese variants (V.1-V.4),
    // and the highest (V.4) is the Manga print (price-confirmed against the
    // English side's separately-listed Manga variant — see
    // lib/berrywallet.ts's pickVariant doc comment). The canonical page
    // shows English (see CardRef's own doc comment on why); Japanese lives
    // at /products/shanks-op09-004/ja.
    franchise: "one-piece",
    tcg: "one-piece",
    slug: "shanks-op09-004",
    displayName: "Shanks",
    character: "Shanks",
    lookup: { by: "code", code: "OP09-004", variantTags: ["Manga"] },
    berryWalletEnabled: true,
  },
  {
    franchise: "one-piece",
    tcg: "one-piece",
    slug: "eustass-captain-kid-op05-074",
    displayName: 'Eustass "Captain" Kid',
    character: 'Eustass "Captain" Kid',
    lookup: { by: "code", code: "OP05-074", variantTags: ["Manga"] },
    berryWalletEnabled: true,
  },
  {
    // variantTags picks the Wanted Poster print specifically — apitcg's own
    // catalog for OP09-093 also has an SP Gold/Silver variant, but Wanted
    // Poster is the one actually wanted here, not SP (the two names were
    // originally given together despite being mutually exclusive prints;
    // Wanted Poster wins per that clarification).
    franchise: "one-piece",
    tcg: "one-piece",
    slug: "marshall-d-teach-op09-093",
    displayName: "Marshall D. Teach",
    character: "Marshall D. Teach",
    lookup: { by: "code", code: "OP09-093", variantTags: ["Wanted Poster"] },
    berryWalletEnabled: true,
  },
];
