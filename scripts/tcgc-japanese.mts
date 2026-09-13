#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Complete the Japanese catalogue from TCG Collector — cards and pictures.
 *
 * WHAT IS MISSING AND WHY IT MATTERS. TCGdex is the backbone of the Japanese
 * corpus and it is incomplete in two different ways. It publishes 25 sets with
 * a name, a date, a card count and ZERO cards — every card of ADV Expansion
 * Pack, Collection X, Gaia Volcano, Blue Shock, GX Battle Boost. And across 119
 * of the sets it does fill, it lists fewer cards than were printed: 2,850
 * cards' worth of secret rares and promos, which are precisely the cards worth
 * photographing. A card the catalogue does not contain cannot be scanned,
 * cannot be priced, and cannot be told apart from the card actually in hand.
 *
 * WHAT THIS WRITES. Cards into data/catalog/pokemon-ja/<set>.json, pictures
 * into public/card-images/pokemon-ja/<set>-<number>.webp. Existing cards are
 * never touched: TCGdex's row for a card stays TCGdex's row, with its
 * illustrator, its Cardmarket product and its variants. This only ever adds.
 *
 * THE SET JOIN IS lib/tcgc-sets.ts, and it refuses to guess — see the rules
 * there. The card join is exact: every tile on their page carries the number
 * printed on the card, which is the one fact a 1996 card and a 2026 database
 * both know.
 *
 * NAMES COME BACK IN ENGLISH, and that is a real cost stated plainly. Their
 * pages carry no kana at all, so an imported card is filed as `Cacnea` beside a
 * TCGdex card filed as `ナゾノクサ`. The name is a label; the number is what the
 * scanner matches and the picture is what the comparison ranks, and both of
 * those are right. A card with an English label beats a card that is not there.
 *
 * PACING lives in scripts/tcgc-fetch.mts. Read it before changing anything here.
 *
 * Usage:
 *   npx tsx scripts/tcgc-japanese.mts                   audit, fetches nothing new
 *   npx tsx scripts/tcgc-japanese.mts --cards           write the missing cards
 *   npx tsx scripts/tcgc-japanese.mts --cards --images  and fetch their pictures
 *   npx tsx scripts/tcgc-japanese.mts --set XY9 --cards --images
 *   npx tsx scripts/tcgc-japanese.mts --images --limit 200    stop after 200 downloads
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { getCatalogSets, getCatalogSetCards, type CatalogCard } from "../src/lib/catalog";
import { pokemonImageUrl } from "../src/lib/pokemon-image";
import { parseTcgcSetPage, type TcgcCard } from "../src/lib/tcgc-cards";
import { tcgcCounterpart } from "../src/lib/tcgc-sets";
import { get, pause, IMAGE_PAUSE, PAGE_PAUSE, requestsMade } from "./tcgc-fetch.mjs";

const CATALOG = path.join(process.cwd(), "data", "catalog", "pokemon-ja");
const IMAGES = path.join(process.cwd(), "public", "card-images", "pokemon-ja");
const PAGES = path.join(process.cwd(), "data", "catalog", "tcgc-pages");

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);

const writeCards = flag("cards");
const writeImages = flag("images");
const onlySet = value("set");
const limit = Number(value("limit") ?? Infinity);

/** Their set page, from disk if we have already paid for it. */
async function setPage(theirId: string, slug: string): Promise<string | undefined> {
  mkdirSync(PAGES, { recursive: true });
  const cache = path.join(PAGES, `${theirId}.html`);
  if (existsSync(cache)) return readFileSync(cache, "utf8");
  if (!writeCards && !writeImages) return undefined;

  const body = get(`https://www.tcgcollector.com/sets/${theirId}/${slug}?setCardCountMode=anyCardVariant`);
  if (body.length < 10_000) {
    console.error(`  set page ${theirId} came back ${body.length} bytes`);
    return undefined;
  }
  writeFileSync(cache, body);
  await pause(PAGE_PAUSE);
  return body.toString("utf8");
}

/** A card row in the shape the catalogue files, from one of their tiles. */
function asCatalogCard(setId: string, card: TcgcCard): CatalogCard {
  return {
    tcgdexId: `${setId}-${card.localId}`,
    localId: card.localId,
    name: card.name,
    rarity: card.rarity,
    // No image URL: their CDN is not ours to hot-link, so the picture is
    // fetched into public/ and found there by lib/pokemon-ja-images.ts.
    addedFrom: "tcgcollector",
    variants: [],
  };
}

let setsSeen = 0;
let setsJoined = 0;
let cardsAdded = 0;
let imagesFetched = 0;
let cardsMissing = 0;
let picturesMissing = 0;
let unjoined = 0;

for (const set of getCatalogSets({ language: "ja" })) {
  if (onlySet && set.id !== onlySet) continue;
  setsSeen++;

  const held = getCatalogSetCards(set.id, "ja");
  const size = set.cardCount?.total ?? held.length;
  const match = tcgcCounterpart(set.id, size, set.releaseDate ?? "");
  if (!match) {
    unjoined++;
    continue;
  }
  setsJoined++;

  const have = new Set(held.map((entry) => entry.card.localId));
  const needPicture = held.filter(({ card }) => !pokemonImageUrl(card, set, 320));
  const behind = match.set.cards - held.length;
  if (behind <= 0 && needPicture.length === 0) continue;

  const html = await setPage(match.set.id, match.set.slug);
  if (!html) {
    cardsMissing += Math.max(0, behind);
    picturesMissing += needPicture.length;
    continue;
  }

  const theirs = parseTcgcSetPage(html);
  if (theirs.length < match.set.cards) {
    // Their set list and their set page disagree. A page that paginated would
    // import a set half-missing and report it as a success.
    console.error(`  ${set.id}: page holds ${theirs.length} of the ${match.set.cards} they list — skipped`);
    continue;
  }

  const fresh = theirs.filter((card) => !have.has(card.localId));
  cardsMissing += fresh.length;

  if (writeCards && fresh.length > 0) {
    const file = path.join(CATALOG, `${set.id}.json`);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      set: { cardCount?: { total?: number; official?: number } };
      cards: CatalogCard[];
    };
    parsed.cards = [...parsed.cards, ...fresh.map((card) => asCatalogCard(set.id, card))].sort((a, b) =>
      a.localId.localeCompare(b.localId, "en", { numeric: true })
    );
    // `official` is the total printed on the cards and stays upstream's claim.
    // `total` is how many the set is known to hold, which is now this.
    parsed.set.cardCount = { ...parsed.set.cardCount, total: parsed.cards.length };
    writeFileSync(file, `${JSON.stringify(parsed, null, 1)}\n`, "utf8");
    cardsAdded += fresh.length;
  }

  // Every card with no picture: the ones already held, plus the new ones, which
  // by definition have none.
  const byNumber = new Map(theirs.map((card) => [card.localId, card] as const));
  const wanted = [...needPicture.map(({ card }) => card.localId), ...fresh.map((card) => card.localId)];

  let got = 0;
  for (const localId of wanted) {
    const file = path.join(IMAGES, `${set.id}-${localId}.webp`);
    if (existsSync(file)) continue;
    const source = byNumber.get(localId);
    if (!source) continue;
    picturesMissing++;
    if (!writeImages || imagesFetched >= limit) continue;

    const bytes = get(source.image);
    if (bytes.length < 2_000) continue;
    mkdirSync(IMAGES, { recursive: true });
    // They serve JPEG at 320x458, the largest their card list offers. WebP
    // takes 20% off for no visible difference and makes the extension honest.
    writeFileSync(file, await sharp(bytes).webp({ quality: 82 }).toBuffer());
    imagesFetched++;
    got++;
    await pause(IMAGE_PAUSE);
  }

  console.log(
    `  ${set.id.padEnd(9)} ${match.how.padEnd(9)} ${match.set.name.slice(0, 30).padEnd(32)} ` +
      `+${String(fresh.length).padStart(3)} cards  +${String(got).padStart(3)} pictures`
  );
}

console.log(
  `\n${setsSeen} Japanese sets, ${setsJoined} joined to one of theirs, ${unjoined} with no counterpart.` +
    `\n${cardsMissing} card(s) they list and we do not${writeCards ? `, ${cardsAdded} written` : ""}.` +
    `\n${picturesMissing} card(s) with no picture${writeImages ? `, ${imagesFetched} fetched` : ""}.` +
    `\n${requestsMade()} request(s) made.`
);
if (!writeCards && !writeImages) console.log("\nNothing was written. Add --cards and/or --images.");
