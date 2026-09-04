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
   * already follows), Japanese becomes the real JP entry in that page's own
   * language toggle (see cards.ts's getOnePieceJapaneseText, the One Piece
   * counterpart to getFrenchCardText — it used to be a separate
   * `/products/[slug]/ja` route; see components/product-locale.tsx for why
   * it isn't any more). French gets neither: confirmed live,
   * BerryWallet has zero French sets, so a One Piece card's FR toggle is
   * always the inert "no real source" placeholder, never a fabricated
   * translation — same honesty rule getFrenchCardText already follows.
   *
   * Omitted keeps the plain apitcg-only path (every Pokémon ref).
   */
  berryWalletEnabled?: boolean;
  /**
   * One Piece only: BerryWallet's real `set_code` for this card, per
   * language — the One Piece counterpart to `pokeWalletCardId` below, and
   * the same "store the verified answer, don't re-derive a fragile one
   * live" choice for the same reason.
   *
   * What it costs when this is missing: findCardInLanguage
   * (lib/berrywallet.ts) has to find the containing set itself. Its guess is
   * the card_number's own prefix (`OP09-004` -> `OP09`, `-JP` appended for
   * Japanese), which is right for an ordinary numbered set and wrong for a
   * promo — `P-033` guesses `P`, but the real set is `OP-PR` ("One Piece
   * Promotion Cards"). A missed guess falls back to walking sets one
   * `getSetCards` call at a time, and English has 77 of them. Confirmed
   * live on 2026-08-29: four ordinary cards resolved in ~2 calls each, then
   * P-033's walk alone consumed the rest of a 60-call ceiling before being
   * cut off — one promo card is enough to exhaust an hourly quota that four
   * normal cards barely touched.
   *
   * With a code stored here the lookup is one `getSetCards` call (the
   * `getSets` call it also needs is shared across every card in the build,
   * memoized by path — see lib/memo-fetch.ts), so this is the difference
   * between ~1 call per card and up to ~77.
   *
   * Only fill in a value CONFIRMED from a real resolution — the `setCode`
   * on an actually-resolved card, not a guess. Leaving a language out is
   * always safe: the prefix guess still runs, and the fallback walk is
   * bounded now (see BOUNDED_SET_WALK in lib/berrywallet.ts) so a wrong or
   * missing code degrades to "not found", never to a drained quota.
   *
   * `jp` is deliberately unset on every ref below: BerryWallet's Japanese
   * sets are separate entries with their own codes (`OP09` vs `OP09-JP`,
   * per lib/berrywallet.ts's file header), and no Japanese resolution has
   * been confirmed since this field was added — the `-JP` guess covers the
   * ordinary numbered sets meanwhile. Fill each one in as it's confirmed,
   * the same way each pokeWalletCardId was.
   */
  berryWalletSetCode?: { en?: string; jp?: string };
  /**
   * Pokémon only: a confirmed PokéWallet card id (`pk_...`) for this card's
   * real Japanese-print counterpart — powers the real Japanese view behind
   * the product page's JP toggle, the same role berryWalletEnabled plays
   * for One Piece.
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
   * file header for the full worked examples). Omitted leaves that card's
   * JP toggle inert rather than echoing English text under a Japanese flag.
   */
  pokeWalletCardId?: string;
  /**
   * Pokémon only: the same card's WESTERN PokéWallet id — the print Cardmarket
   * sells as one listing covering English, French, Italian, German, Spanish and
   * Portuguese copies. `pokeWalletCardId` above is the Japanese counterpart,
   * which Cardmarket treats as a different product entirely, so the two carry
   * genuinely different prices and neither can stand in for the other.
   *
   * Stored rather than searched live for the same reason as the Japanese id,
   * though it was far cheaper to find: the Western print keeps this card's own
   * set and number, so `/search?q={name}` filtered to a matching
   * `card_number` returned exactly one candidate for each of the three cards
   * here, with no rarity/price cross-referencing needed. Re-run that search to
   * add a card; omitting it simply leaves the Cardmarket panel off that page.
   */
  pokeWalletWesternCardId?: string;
  /**
   * ESCAPE HATCH 1 of 2 — a hand-confirmed BerryWallet row id (`op_...`)
   * whose Cardmarket product is the right one for this card, per print.
   *
   * The derivation is expected to handle this on its own and nearly always
   * does: a row with no usable Cardmarket block borrows one from a row that
   * is provably the same TCGplayer product (findCardmarketSiblings), and the
   * Japanese product is reached the same way (findJapaneseCardmarket). Reach
   * for this field ONLY after `npx tsx scripts/card-audit.mts <slug>` shows
   * the gap and shows that nothing links the two rows — an id stored where a
   * rule would have worked is the thing this codebase has already had to
   * unwind once.
   *
   * Use it when the row exists upstream but nothing connects it: no shared
   * TCGplayer product, no matching card_number, no set relationship. Real
   * figures still flow, because a real row is being read — this pins which
   * row, it does not invent one.
   *
   * Takes precedence over the derivation when set, because a human confirmed
   * it against the live catalogue and the derivation is a heuristic. The
   * audit script reports an id the derivation now reaches by itself, so a
   * pin that has become redundant can be deleted rather than quietly kept.
   */
  berryWalletCardmarketId?: { en?: string; jp?: string };
  /**
   * ESCAPE HATCH 2 of 2, and the last one — a hand-verified Cardmarket product
   * URL, for a print whose real product nothing here can reach correctly.
   *
   * Two separate cases, both confirmed on cardmarket.com by hand on
   * 2026-09-02, which is the only way they can be confirmed (Cardmarket
   * answers automated requests with a CDN bot challenge):
   *
   * 1. NO ROW EXISTS. Cardmarket sells Monkey D. Luffy OP09-061 under
   *    `Premium-Bandai-Products-Asia-Region-Legal`; BerryWallet has no row on
   *    that set at all — its `CM-PREMIUM-BANDAI` maps only to
   *    `Premium-Bandai-Products`, and the only `-Asia-Region-Legal` sets it
   *    carries are Starter-Deck-Egghead, Heroines-Edition and Egghead-Crisis.
   *    No shared TCGplayer product, no code, no set to join on.
   *
   * 2. THE ROW IS WRONG. BerryWallet's Japanese rows for the One Piece promo
   *    sets carry product URLs that do not survive contact with Cardmarket:
   *    `Unnumbered-Promos-Japanese/MonkeyDLuffy-OP09-061` redirects to root,
   *    and `Promos-Japanese/MonkeyDLuffy-P-033-V1` opens a product listing
   *    Chinese copies — the real Japanese product is `-V2`.
   *
   * CORRECTS THE LINK AND KEEPS THE FIGURES. In case 2 the row is not the
   * wrong CARD — it is the right card's prices behind a URL that has gone
   * bad, confirmed by checking both rows' euros against the real product
   * pages. So the figures stay and only the URL is replaced.
   *
   * That makes a value here an assertion, and the comment beside it must say
   * the prices were checked against the pinned product. Nothing in the code
   * can check it: Cardmarket answers automated requests with a CDN bot
   * challenge, so a URL and its figures can only ever be verified by a person
   * opening the page. In case 1, where there is no row at all, there are no
   * figures to keep and the panel says so.
   *
   * Nothing is ever read FROM this URL and no price is typed in beside it.
   */
  cardmarketProductUrl?: { western?: string; japanese?: string };
  /**
   * One Piece only: overrides `lookup.variantTags` specifically for eBay's
   * query text and title filter (graded-market.ts's `oneVariantTags`) —
   * everything else (BerryWallet's own pickVariantByTag/
   * findVariantAcrossProducts, apitcg's findProductByCode) keeps using
   * `lookup.variantTags` unchanged.
   *
   * Exists because those are genuinely two different vocabularies for the
   * same real product, not one. `lookup.variantTags` has to match words
   * BerryWallet's own catalog `name` field actually contains (that's what
   * disambiguates which of several same-code products a live BerryWallet
   * lookup resolves to) — but real eBay sellers don't title their listings
   * after BerryWallet's internal product name, they title them after
   * whatever the card's real-world packaging says.
   *
   * Confirmed live for monkey-d-luffy-p-033: BerryWallet's own catalog
   * disambiguates this product from its two P-033 siblings via "Event Pack"
   * + "Vol. 2" (see `lookup.variantTags`'s own value below) — real,
   * necessary for that lookup. But every real eBay listing for this exact
   * card (PSA 10, Japanese) instead says "Weekly Shonen Jump" — the
   * magazine this card actually shipped as a promo insert in — and never
   * "Event"/"Vol." at all. Searching eBay for "Event Vol P-033 PSA 10"
   * (what `lookup.variantTags` alone would produce) returns zero matches
   * even on eBay's own website search; "Shonen Jump" finds them
   * immediately. Without this override, both graded-market.ts's query text
   * and titleMatchesCard's (lib/ebay-browse.ts) filter would keep rejecting
   * every one of this card's real listings, forever.
   *
   * KEYED BY LANGUAGE, because the two tiers can need opposite vocabulary —
   * proven on P-033 below, where each language's winning tag returns exactly
   * zero for the other. A single value cannot express that.
   *
   * USED VERBATIM, unlike `lookup.variantTags`, which graded-market.ts puts
   * through `tagFirstWord` first. That transform exists to turn BerryWallet's
   * catalog naming into what sellers actually write ("Wanted Poster" ->
   * "Wanted", measured: 6 results vs 0 for the full phrase). A value here is
   * already written in seller vocabulary by a human who checked, so applying
   * the transform to it only corrupts multi-word product names — it is what
   * turned "Shonen Jump" into "Shonen" and "Event Pack Vol. 2" into
   * "Event Vol".
   *
   * Use scripts/ebay-query-lab.mts to pick a value rather than guessing; it
   * compares candidate query shapes against the live API and scores them on
   * grade and number only, never on the tags themselves.
   *
   * Omitted (the default) means `lookup.variantTags` is right for eBay too
   * — true for every other tracked One Piece card so far, where BerryWallet's
   * catalog naming and real seller vocabulary happen to agree.
   */
  ebayVariantTags?: { en?: string[]; jp?: string[] };
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
    // "Gengar VMAX (Alternate Art Secret)", SWSH08: Fusion Strike 271/264.
    pokeWalletWesternCardId: "pk_fcf663828d2352957442b3d07dfc5ffb9d23a528d5a71a8f4fcce0ab5ec1195122b354cfdd01a47b666d17ec392a1d",
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
    // "Lugia V (Alternate Full Art)", SWSH12: Silver Tempest 186/195.
    pokeWalletWesternCardId: "pk_a3829acca533caec5434c07aeeb7a197d797619efb12c127ad00f8207a3d70f9363c5f28284d52e6f618eea2a36e89",
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
    // "Ethan's Typhlosion - 190/182", SV10: Destined Rivals 190/182.
    pokeWalletWesternCardId: "pk_dfffc82c6fc4e6a880b57f83ff1b8a97ebf0d84418898beda60d1634a9a2be86e33c87f5c3a10eb61cc22605a97e2fe8",
  },
  {
    // Both English and Japanese identity real, via BerryWallet — confirmed
    // live: card_number OP09-004 has 4 real Japanese variants (V.1-V.4),
    // and V.4 is the Manga print — the same V-number as the English side's
    // separately-listed Manga variant, which is how the two are actually
    // matched now (see lib/berrywallet.ts's pickVariantForJapanese doc
    // comment; this pairing was the confirming half of that fix, alongside
    // Marshall D. Teach's OP09-093, whose requested English variant is NOT
    // the highest V-number). The canonical page shows English (see CardRef's
    // own doc comment on why); Japanese is the JP toggle on that same page.
    franchise: "one-piece",
    tcg: "one-piece",
    slug: "shanks-op09-004",
    displayName: "Shanks",
    character: "Shanks",
    lookup: { by: "code", code: "OP09-004", variantTags: ["Manga"] },
    berryWalletSetCode: { en: "OP09" },
    berryWalletEnabled: true,
  },
  {
    franchise: "one-piece",
    tcg: "one-piece",
    slug: "eustass-captain-kid-op05-074",
    displayName: 'Eustass "Captain" Kid',
    character: 'Eustass "Captain" Kid',
    lookup: { by: "code", code: "OP05-074", variantTags: ["Manga"] },
    berryWalletSetCode: { en: "OP05" },
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
    berryWalletSetCode: { en: "OP09" },
    berryWalletEnabled: true,
  },
  {
    // A real, separately-catalogued promo product, not one of the ordinary
    // V.1-V.4 tiered prints OP09-061's own guessed set lists — confirmed
    // live via searchCards (BerryWallet's flat, cross-product index), not
    // getSetCards on the guessed set alone, which never surfaces it (see
    // findVariantAcrossProducts's own comment, lib/berrywallet.ts, for why
    // and how this is found generally rather than hand-picked here). No
    // Japanese counterpart found this way — this card's JP toggle stays
    // inert rather than guessing one, same honesty rule pickVariantForJapanese's own comment
    // documents for exactly this case.
    franchise: "one-piece",
    tcg: "one-piece",
    slug: "monkey-d-luffy-op09-061",
    displayName: "Monkey D. Luffy",
    character: "Monkey D. Luffy",
    // Not the same card as the P-033 ref below despite the same character —
    // confirmed via BerryWallet: different card_number, different card_type
    // (Leader vs Character), different color, different real price.
    lookup: { by: "code", code: "OP09-061", variantTags: ["2nd Anniversary Set"] },
    berryWalletSetCode: { en: "OP09" },
    berryWalletEnabled: true,
    // The derivation reaches `Unnumbered-Promos-Japanese/MonkeyDLuffy-OP09-061`
    // through the shared TCGplayer product, and Cardmarket redirects that URL
    // to root — the product does not exist. The real one, confirmed by hand,
    // is the Premium Bandai Asia-region listing below, which BerryWallet has
    // no row for at all (its CM-PREMIUM-BANDAI set maps only to
    // `Premium-Bandai-Products`), so nothing here can reach it automatically.
    //
    // The row's PRICES were checked against that page and are correct, so only
    // the URL is replaced; the JP tab's euros are still BerryWallet's own live
    // figures.
    cardmarketProductUrl: {
      japanese:
        "https://www.cardmarket.com/en/OnePiece/Products/Singles/Premium-Bandai-Products-Asia-Region-Legal/MonkeyDLuffy-OP09-061",
    },
  },
  {
    // A different card_number and product entirely from OP09-061 above,
    // despite being the same character — P-033 (BerryWallet's generic
    // promo-number series) has 3 real, separate products sharing that one
    // code: "Event Pack Vol. 2" (this one — matches the real reference,
    // French "Pack Événement Vol.2"), "CS 2023 Event Pack", and "CS 2023
    // Event Pack Finalist Ver.". All three names share the substring "Event
    // Pack", so ["Event Pack"] alone wouldn't disambiguate — "Vol. 2" is
    // the one string only this specific product's name contains.
    franchise: "one-piece",
    tcg: "one-piece",
    slug: "monkey-d-luffy-p-033",
    displayName: "Monkey D. Luffy",
    character: "Monkey D. Luffy",
    lookup: { by: "code", code: "P-033", variantTags: ["Event Pack", "Vol. 2"] },
    berryWalletSetCode: { en: "OP-PR" },
    berryWalletEnabled: true,
    // The derivation reaches `Promos-Japanese/MonkeyDLuffy-P-033-V1` through
    // the shared TCGplayer product, and that URL opens the wrong product —
    // checked by hand on cardmarket.com, it lists Chinese copies. The real
    // Japanese product is -V2.
    //
    // The row's PRICES were checked against that -V2 page and are correct, so
    // only the URL is replaced; the euros on the JP tab are still BerryWallet's
    // own live figures. See cardmarketProductUrl's own comment.
    cardmarketProductUrl: {
      japanese: "https://www.cardmarket.com/en/OnePiece/Products/Singles/Promos-Japanese/MonkeyDLuffy-P-033-V2",
    },
    // Per language, because this card's two tiers need OPPOSITE vocabulary
    // and a single value can only ever serve one of them. Measured with
    // scripts/ebay-query-lab.mts on 2026-08-30, PSA 10, both tiers:
    //   English  "Event Pack Vol. 2" -> 8 raw / 7 real; "Shonen Jump" -> 0
    //   Japanese "Shonen Jump"       -> 20 raw / 20 real; "Event Pack..." -> 0
    // The card shipped as a Weekly Shonen Jump insert in Japan and as an
    // event-pack promo in English, so sellers in each market title it after
    // a different real-world product. Before this was per-language the
    // single "Shonen Jump" value served Japanese and left the English tier
    // with zero listings.
    //
    // See CardRef's own ebayVariantTags doc comment — real eBay listings
    // for this exact print say "Weekly Shonen Jump", never "Event"/"Vol.".
    ebayVariantTags: { en: ["Event Pack Vol. 2"], jp: ["Shonen Jump"] },
  },
];
