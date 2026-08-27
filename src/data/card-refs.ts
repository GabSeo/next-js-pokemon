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
};

/**
 * The 6 tracked cards. Slugs are precomputed here (not derived from a live
 * API call) so generateStaticParams never depends on network access at
 * build time — only rendering the page content does.
 */
export const cardRefs: CardRef[] = [
  {
    franchise: "pokemon",
    tcg: "pokemon",
    slug: "gengar-vmax-271",
    displayName: "Gengar VMAX",
    character: "Gengar",
    lookup: { by: "nameSet", name: "Gengar VMAX", setName: "Fusion Strike", number: "271" },
  },
  {
    franchise: "pokemon",
    tcg: "pokemon",
    slug: "lugia-v-186",
    displayName: "Lugia V",
    character: "Lugia",
    lookup: { by: "nameSet", name: "Lugia V", setName: "Silver Tempest", number: "186" },
  },
  {
    franchise: "pokemon",
    tcg: "pokemon",
    slug: "ethans-typhlosion-190",
    displayName: "Ethan's Typhlosion",
    character: "Typhlosion",
    lookup: { by: "nameSet", name: "Ethan's Typhlosion", setName: "Destined Rivals", number: "190" },
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
