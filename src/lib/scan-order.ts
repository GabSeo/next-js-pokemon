/**
 * The order a scan's candidates come back in.
 *
 * EXTRACTED SO IT CAN BE CHECKED. These four passes decide which card a person
 * is told they are holding, and they changed three times in one evening — twice
 * correctly, once turning an N's Reshiram into a Wooper. Nothing caught that; it
 * was found by replaying every photograph in `img test/` by hand. Living inside
 * a route handler, none of it could be replayed by anything but a real request
 * with a real image and a real Vision unit.
 *
 * Out here, `scripts/check-scan-order.mts` runs all of it against frozen
 * fixtures on every build, for free.
 *
 * THE SIGNATURE IS PASSED IN, not computed. The route used to hash the
 * photograph twice — once here and once for the printing ranker — and a checker
 * that has no image at all cannot hash anything. Taking the signature as an
 * argument fixes both: one hash per scan, and a caller that can supply a frozen
 * one.
 */
import { artDistance, type ArtSignature } from "@/lib/art-rank";
import { extractCardCodes, type CodeCandidate } from "@/lib/card-code-ocr";
import { namesInText } from "@/lib/card-name-match";
import { lookupCards } from "@/lib/card-lookup";
import { getCardView } from "@/lib/card-view";
import { japaneseName } from "@/lib/pokemon-ja-official";
import { pokemonSignature } from "@/lib/pokemon-art";
import type { CardView } from "@/lib/card-view";

/** Kana and kanji. Latin-only text has none; a Japanese card face is full of them. */
export const JAPANESE_SCRIPT = /[぀-ゟ゠-ヿ一-鿿]/;

/** Every word of `name`, present in an already-tokenised text. */
export function nameIsInText(name: string | undefined, words: Set<string>): boolean {
  const parts = (name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return parts.length > 0 && parts.every((part) => words.has(part));
}

/**
 * Move the candidates the text NAMES to the front, and touch nothing else.
 *
 * The name-matching half of `orderCandidates`, on its own, to run after the
 * artwork. It is the half that is evidence: a card whose name Vision read off
 * the photograph is that card far more often than a card that merely resembles
 * it. The script half is a tie-break, so it stays where it was — see the call
 * site for what happened when both ran late.
 *
 * A STABLE PARTITION, not a sort, so the picture's ranking survives inside both
 * groups and a photograph that names nothing comes out exactly as it went in.
 */
export function liftNamedCandidates(cards: CardView[], text: string): void {
  const words = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const isNamed = (card: CardView) =>
    (card.tcg === "pokemon" && japanesePrintedName(card.code) !== undefined && text.includes(japanesePrintedName(card.code)!)) ||
    nameIsInText(card.name, words);
  const named = cards.filter(isNamed);
  if (named.length === 0 || named.length === cards.length) return;
  const rest = cards.filter((card) => !isNamed(card));
  cards.length = 0;
  cards.push(...named, ...rest);
}

/**
 * Put the candidate that best matches what Vision actually read first.
 *
 * WHY ORDERING IS THE ANSWER. What is printed on a Pokemon card is `048/082` —
 * a number and a set size, never the set, which is carried by a symbol no OCR
 * reads. 154 of 216 English sets share their printed total with another English
 * set and 152 of 182 Japanese ones do, so one photographed number genuinely
 * names several cards. The scan shows the FIRST as "your card", so the order is
 * the answer, and both signals below were already in hand and thrown away.
 *
 * THE NAME, the stronger of the two: a candidate whose name appears in the text
 * Vision returned is the card, not a card with the same number. The Japanese
 * corpus holds names AS PRINTED for exactly this — the labels on screen stay
 * romanised, but `ゲンガーex` is what the camera sees.
 *
 * THE SCRIPT, for the 4,330 Japanese cards no source names in Japanese: a card
 * face written in kana is not an English Team Rocket card.
 *
 * ORDERS, NEVER FILTERS — the same rule as the rarity boost. Vision misreads,
 * cards carry both scripts, and a card can be photographed beside other text. A
 * wrong guess costs position, which a person can see past; filtering would cost
 * availability, which they cannot.
 */
export function orderCandidates(cards: CardView[], text: string): void {
  const japanese = JAPANESE_SCRIPT.test(text);
  // Tokenised once: a name match is checked per candidate and the text is long.
  const words = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

  /**
   * Does the text carry this card's name — EVERY WORD OF IT, in any order?
   *
   * A CARD DOES NOT PRINT ITS NAME AS ONE STRING, and matching it as one was
   * costing the name signal entirely on the cards that need it most. Vision's
   * output for a photographed Champion's Path Charizard VMAX begins
   *
   *   VMAX Charizard VY Evolves from Charizard V Gigantamax 330 Claw Slash ...
   *
   * because the VMAX badge sits above the name rather than after it. The
   * catalogue calls that card "Charizard VMAX", `text.includes("Charizard
   * VMAX")` is false, and the whole candidate list fell through to the artwork —
   * which put Tropius first, at 0.779 against 0.812 for the Charizard, on a
   * photograph of an orange dragon. All three distances were above 0.77: the
   * signature was not choosing, it was guessing.
   *
   * WHOLE WORDS, NOT SUBSTRINGS, so a one-letter suffix cannot match on nothing:
   * "Charizard V" needs a standalone `V` in the text, and gets one here from
   * "Evolves from Charizard V". That is correct — both printings are genuinely
   * plausible readings of this photograph, and the artwork ranks between them.
   * What is not acceptable is a card sharing neither word leading both.
   *
   * Unchanged for the single-word names that are most of the catalogue: the old
   * substring test and this one agree on "Pikachu".
   */
  const named = (name: string | undefined): boolean => nameIsInText(name, words);

  const rank = (card: CardView): number => {
    // 0 — the name Vision read is this card's name, in either spelling.
    const printed = card.tcg === "pokemon" ? japanesePrintedName(card.code) : undefined;
    if (printed && text.includes(printed)) return 0;
    if (named(card.name)) return 0;
    if (card.tcg !== "pokemon") return 1;
    // 1 — written in the script Vision read. 2 — written in the other one.
    return card.code.startsWith("ja~") === japanese ? 1 : 2;
  };

  // Stable: equal ranks keep the order the catalogue gave them.
  cards.sort((a, b) => rank(a) - rank(b));
}

/**
 * The name printed on a Japanese card, for a `ja~<tcgdexId>` code.
 *
 * The catalogue romanises it and the UI keeps that romanisation; this is the
 * spelling the camera actually sees, and it lives here rather than on screen.
 */
export function japanesePrintedName(code: string): string | undefined {
  if (!code.startsWith("ja~")) return undefined;
  const id = code.slice(3);
  const dash = id.lastIndexOf("-");
  if (dash <= 0) return undefined;
  return japaneseName(id.slice(0, dash), id.slice(dash + 1));
}

/**
 * Order the Pokemon candidates by how much each LOOKS like the photograph.
 *
 * WHY THIS IS THE RIGHT SIGNAL. What is printed on a Pokemon card is `048/082`
 * — a number and a set size, never the set, which is carried by a symbol no OCR
 * reads. 154 of 216 English sets share their printed total with another English
 * set, so one photographed number genuinely names several cards. Until now the
 * only thing separating them was the script the text was written in, which
 * answers "which catalogue" and not "which card".
 *
 * ALL OR NOTHING, like the One Piece ranker and for the same reason: a
 * candidate with no signature cannot lose a comparison it never entered, so
 * ranking a partial set would quietly promote whichever cards happen to be
 * covered. 4,330 Japanese cards are pictured nowhere public; when one of them
 * is a candidate, the whole group keeps the order the name and script gave it.
 *
 * THE CARD, NEVER THE PRINTING. 0 of 10,110 multi-variant Pokemon cards have a
 * distinct image, so this cannot tell a normal from its reverse holo. That is
 * Vision's job, once, on confirmation.
 */
export function rankPokemonCards(cards: CardView[], photo: ArtSignature | undefined): void {
  const pokemon = cards.filter((card) => card.tcg === "pokemon");
  if (pokemon.length < 2 || !photo) return;

  // Every candidate first: one unsigned card leaves the whole group alone.
  const signatures = pokemon.map((card) => pokemonSignature(card.code));
  if (signatures.some((signature) => signature === undefined)) return;


  const scored = pokemon
    .map((card, index) => ({ card, distance: artDistance(photo, signatures[index]!) }))
    .sort((a, b) => a.distance - b.distance);

  // Rewrite only the Pokemon slots, in place, so One Piece candidates keep the
  // position `orderCandidates` gave them.
  const ordered = scored.map((entry) => entry.card);
  let next = 0;
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].tcg === "pokemon") cards[i] = ordered[next++];
  }
}

/**
 * Every candidate a photograph's TEXT produces, in the order the reader sees.
 *
 * ONE FUNCTION SO THERE IS ONE PIPELINE. This lived inside the route, which
 * meant a checker could only approximate it — and an approximated pipeline
 * agrees with the real one right up until the moment it matters. Route and
 * check now call this, so a fixture proves what a request would do.
 *
 * `photo` is the photograph's own art signature, or undefined when there is
 * none: the ranking then leaves the order the code and the name produced, which
 * is what happens on a device that cannot hash the image.
 */
export async function resolveCards(input: {
  text: string;
  photo?: ArtSignature;
  game?: "pokemon" | "onepiece";
  /** Extra candidates the caller derived — a Wizards promo number off a slab. */
  extra?: CodeCandidate[];
}): Promise<{ candidates: CodeCandidate[]; cards: CardView[]; byNameOnly: boolean }> {
  const { text, photo, game } = input;
  const candidates = [...extractCardCodes(text), ...(input.extra ?? [])];

  // Kana is evidence; its absence is not — see the route's own comment.
  const language = JAPANESE_SCRIPT.test(text) ? "ja" : undefined;

  const cards: CardView[] = [];
  const seen = new Set<string>();
  const take = async (query: string) => {
    for (const match of lookupCards(query, game, language).matches.slice(0, 6)) {
      const id = `${match.tcg}:${match.code}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const view = await getCardView(match.tcg, match.code);
      if (view) cards.push(view);
    }
  };

  for (const candidate of candidates) await take(candidate.value);

  let byNameOnly = false;
  if (cards.length === 0) {
    for (const hit of namesInText(text)) await take(hit.name);
    byNameOnly = cards.length > 0;
  }

  orderCandidates(cards, text);
  rankPokemonCards(cards, photo);
  liftNamedCandidates(cards, text);

  return { candidates, cards, byNameOnly };
}
