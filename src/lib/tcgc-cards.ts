/**
 * Reading a TCG Collector set page into cards.
 *
 * THE PAGE IS THE API. There is no public feed, so the join is made against the
 * HTML a browser gets, in the `anyCardVariant` mode their own set links use.
 * Every field below is taken from a place the page shows a human — the number
 * printed in the tile's corner, the name in the link's title, the rarity in the
 * symbol's alt text — because a field a person can check is a field a person
 * can catch us getting wrong.
 *
 * ONE ANCHOR PER CARD, and that is measured rather than assumed: `data-card-id`
 * appears 288 times on a 62-card page (the tile, the details button, the
 * dropdown), while `card-image-grid-item-link` appears exactly 62 times, on all
 * six pages checked. Splitting on the anchor is what makes the count come out
 * equal to the count their own set list publishes.
 *
 * TWO SPELLINGS OF A CARD NUMBER, because the cards themselves have two:
 *
 *   Oddish (Wind from the Sea 001/087)            a fraction
 *   Ekans (Mystery of the Fossils No. 001)        a bare number
 *
 * The second is the era that prints no denominator — the same 658-card
 * distinction that defeats a fraction pattern in the scanner. Matching only the
 * fraction skipped whole sets in silence: Neo Destiny once reported "113
 * missing, 0 fetched" with its set correctly matched and every image on the
 * page.
 */

export type TcgcCard = {
  /** The number as printed, zero-padded the way the catalogue pads: "001". */
  localId: string;
  /** Their English name. Japanese sets are named in Japanese by TCGdex; this is not that. */
  name: string;
  /** "Common", "Ultra Rare"... or undefined where the page shows no symbol. */
  rarity?: string;
  /** The 320px-wide JPEG their grid serves. */
  image: string;
};

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));

/**
 * A printed number as the catalogue files it.
 *
 * TCGdex pads Japanese numbers to three digits in every set checked, from
 * PMCG1 in 1996 to SM12a in 2019, so a two-digit read would join to nothing.
 * Anything that is not a plain number — a promo's `XY-P` suffix, a letter
 * prefix — is passed through untouched: padding something we cannot parse
 * would invent a number the card does not print.
 */
export function tcgcLocalId(printed: string): string {
  const digits = /^\d{1,3}$/.exec(printed.trim());
  return digits ? printed.trim().padStart(3, "0") : printed.trim();
}

/** Every card on one of their set pages, in the order the page lists them. */
export function parseTcgcSetPage(html: string): TcgcCard[] {
  const out: TcgcCard[] = [];
  const seen = new Set<string>();
  const blocks = html.split('class="card-image-grid-item-link"');

  for (let i = 1; i < blocks.length; i++) {
    // The title precedes the class on the anchor; the image and the number
    // follow it, before the next anchor begins.
    const head = blocks[i - 1];
    const body = blocks[i];

    const title = /title="([^"]+)"\s*$/.exec(head.trimEnd()) ?? /title="([^"]+)"[^"]*$/.exec(head);
    const image = /src="(https:\/\/static\.tcgcollector\.com\/content\/images\/[^"]+\.(?:jpg|webp|png))"/.exec(body);
    const printed = /card-image-grid-item-info-overlay-number">\s*([^<]+?)\s*<\/div>/.exec(body);
    if (!title || !image || !printed) continue;

    // "Ekans (Mystery of the Fossils No. 001)" — the name is everything before
    // the last parenthesis, because Pokemon names contain them: "Unown (A)".
    const full = decode(title[1]);
    const open = full.lastIndexOf(" (");
    const name = open > 0 ? full.slice(0, open) : full;

    const localId = tcgcLocalId(printed[1].replace(/^No\.\s*/i, "").split("/")[0]);
    if (!localId || seen.has(localId)) continue;
    seen.add(localId);

    // The rarity symbol is the next image after the number, and some eras print
    // no symbol at all — an absent rarity is recorded as absent, not guessed.
    // The LAST alt before the symbol, not the first: the card image carries
    // one too, and a lazy match finds that one instead.
    const rarity = /alt="([^"]+)"(?:(?!alt=")[\s\S])*?class="card-rarity-symbol/.exec(body);

    out.push({
      localId,
      name,
      // "Common (C)" on modern sets, "Common" on the old ones: the letter in
      // brackets is their shorthand, not part of the name.
      rarity: rarity ? decode(rarity[1]).replace(/\s*\([^)]*\)$/, "") : undefined,
      image: image[1],
    });
  }
  return out;
}
