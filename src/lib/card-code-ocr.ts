/**
 * Pull card-code candidates out of whatever OCR returns.
 *
 * WHY THIS IS A PURE MODULE. The scan page needs a camera, a wasm OCR engine
 * and a browser; none of that can be tested and all of it can be swapped. What
 * actually decides whether a scan works is this: given a page of noisy text off
 * a card photo, does the right code come out on top? That question is answerable
 * in a script, so it lives here rather than inside a component.
 *
 * WE ARE NOT READING THE CARD. We are finding one high-contrast, fixed-format
 * token on it. That is why code-first beats image-similarity as a foundation
 * (docs/free-tier-catalogue.md §4): OCR can mangle every word of the card's
 * name and still hand back `OP05-119`, because the code's SHAPE is the signal.
 *
 * DIGIT/LETTER CONFUSION IS THE WHOLE DIFFICULTY. OCR reads `O` for `0`, `I`
 * and `l` for `1`, `S` for `5`, `B` for `8` — and a card code is exactly the
 * kind of short alphanumeric string where that is most likely and most fatal.
 * So candidates are normalised POSITIONALLY: in a slot that must be a letter,
 * `0` becomes `O`; in a slot that must be a digit, `O` becomes `0`. Doing it by
 * position rather than globally is what keeps `OP05` from becoming `0P05`.
 *
 * ORDER IS A CONFIDENCE RANKING, not a list. The caller sends the first
 * candidate straight to the lookup and offers the rest, so a wrong first guess
 * costs a tap rather than a dead end.
 */

/** OCR mistakes, in the direction "seen → meant", per slot type. */
const TO_DIGIT: Record<string, string> = { O: "0", o: "0", Q: "0", D: "0", I: "1", l: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2", G: "6", T: "7" };
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G" };

function asDigits(text: string): string {
  return [...text].map((ch) => TO_DIGIT[ch] ?? ch).join("");
}

function asLetters(text: string): string {
  return [...text].map((ch) => TO_LETTER[ch] ?? ch).join("").toUpperCase();
}

/**
 * `AOP` -> ["AOP", "OP", "P"]. The prefix as read, then with leading characters
 * peeled off one at a time, because OCR reliably welds a stray glyph from the
 * artwork onto the front of a code it otherwise read correctly.
 */
function prefixVariants(letters: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < letters.length; i++) out.push(letters.slice(i));
  return out;
}

export type CodeCandidate = {
  /** Ready to hand to lookupCards. */
  value: string;
  /** What kind of thing this is, for the UI to explain itself. */
  kind: "one-piece-code" | "pokemon-number";
  /** The substring it came from, before repair — shown when a guess looks wrong. */
  raw: string;
};

/**
 * A One Piece code as OCR might mangle it: 1-4 letter-ish characters, two
 * digit-ish, a dash, three digit-ish. The separator is generous because a card's
 * dash is often read as an en dash, an underscore or a space.
 *
 * DELIBERATELY UNANCHORED AT BOTH ENDS, and both ends cost a real scan to
 * learn. Photographed off an actual card (OP09-119, 2026-09-07), Tesseract
 * returned `aOP09-1198H` and `aOP09-110tH`: the code is read correctly and
 * arrives welded to whatever the surrounding artwork resolved to.
 *
 * A leading `\b` did not help -- `a` and `O` are both word characters, so no
 * boundary exists between them and the prefix silently absorbed the `a`,
 * yielding `AOP09-110`, which is not a card. A trailing `(?![0-9])` was worse:
 * it rejected `1198H` outright rather than taking the first three digits, so a
 * perfectly readable code produced nothing at all.
 *
 * So the pattern floats, and the LETTER PREFIX IS TRIMMED afterwards instead --
 * see `prefixVariants`. Structure cannot tell `aOP` from `AOP`; only the
 * catalogue can, and that lives downstream in the lookup.
 */
const OP_LOOSE = /([A-Za-z0OQDIl|S5B]{1,4})([0-9OoQDIlSsBZGT]{2})\s*[-–—_ ]\s*([0-9OoQDIlSsBZGT]{3})/g;

/** Bandai promos: `P-033`. Separate because it has no two-digit set number. */
const OP_PROMO = /\bP\s*[-–—_ ]\s*([0-9OoQDIlSsBZGT]{3})\b/gi;

/** The printed number on a Pokémon card: `190/182`. */
const PKM_NUMBER = /\b([0-9OoQDIlSsBZGT]{1,3})\s*\/\s*([0-9OoQDIlSsBZGT]{1,3})\b/g;

/**
 * The same number with something stuck to the front of it: `560003/069`.
 *
 * `PKM_NUMBER` opens with `\b`, so a numerator glued to preceding digits cannot
 * match anywhere — not at the run's start, where `560` is not followed by a
 * slash, and not inside it, where there is no word boundary to anchor to. The
 * number is right there in the text and the reader returns nothing.
 *
 * That is not hypothetical. Vision's output for img test/pokemon
 * japanese/leapheon vmax 003-069.jpeg, a holo photographed at an angle, reads
 *
 *   ...VMAXIU-J UNT PLANETA The 560003/069 RRR MAX...
 *
 * and `003/069` resolves to ja~S6a-003, Leafeon VMAX — the card in the picture.
 * The scan told its owner it had found no card number at all.
 *
 * FOUR DIGITS IS THE TELL. No Pokémon card carries a numerator longer than
 * three, so a longer run is glue by definition and its last three digits are
 * the number. Shorter runs are left to `PKM_NUMBER`, which reads them exactly.
 *
 * OVER-GENERATING IS THE DESIGNED FAILURE HERE, as the denominator comment in
 * the loop below already sets out: a wrong split resolves to nothing, ranks
 * last and costs a line on screen, while a missed one costs the whole scan.
 * `12345/678` becomes `345/678`, which no set with 678 cards can answer.
 */
const PKM_GLUED = /([0-9OoQDIlSsBZGT]{4,})\s*\/\s*([0-9OoQDIlSsBZGT]{1,3})\b/g;

/**
 * A PROMO CODE, WHICH IS A WHOLE NUMBER WITH NO DENOMINATOR: `SWSH262`.
 *
 * Every pattern above wants a fraction, because that is what a Pokémon card
 * prints — 42,791 of them do. A promo does not: a SWSH Black Star Promo prints
 * `SWSH262` and nothing else, and the set total our catalogue knows (307) was
 * never printed on the cardboard. So the reader returned no code at all and the
 * scan fell through to matching by name, which for a Charizard means twelve
 * Charizards.
 *
 * 1,536 cards carry a prefixed id of this shape. Their prefixes are a CLOSED
 * SET OF SIXTEEN, measured from the catalogue rather than guessed — AR, BW, CC,
 * DP, GG, H, HGSS, RC, RT, SH, SL, SM, SV, SWSH, TG, XY — and each lives in an
 * identifiable set: SWSH in swshp, XY in xyp, TG in the Trainer Gallery
 * subsets, and so on. Some of those DO print a denominator (`GG30/GG70`) and
 * PKM_SUBSET above reads them first; this catches the ones that do not.
 *
 * THE LOOKUP IS THE VALIDATOR, which is what makes reading a bare token safe
 * here. `lookupCards` resolves `SWSH262` to swshp-SWSH262 exactly, and every
 * adversarial token a real card face prints resolves to nothing — measured:
 * `HP90`, `HP310`, `LV23`, `SP2`, `V717`, `AU7`, `PV60`, `NM10` and `GEM10`
 * each return no card. A false reading costs a line that ranks last, which is
 * the failure this file already chooses everywhere else.
 *
 * A BARE `#9` IS NOT HANDLED and must not be. On a slab label it is the card
 * number; on the card face it is the Pokédex number — a Wizards promo Mew
 * prints `#151` and a Birthday Pikachu prints `#25`, neither of which is its
 * card number. Separating those needs the set name off the grading label, not
 * a wider regex.
 *
 * NEVER BESIDE A SLASH, and leaving that out was a real regression rather than
 * a theoretical one. `GG30/GG70` is one number that PKM_SUBSET already reads
 * correctly, and without the guards this pattern also read its two halves —
 * emitting `GG70`, which resolves to swsh12.5gg-GG70, a real card that is not
 * the one in the photograph. A token touching a slash is part of a fraction
 * somebody else has already read.
 *
 * AND NO LEADING `\b`, for the reason PKM_GLUED exists. Vision's output for
 * img test/pokemon english/not working/71JwDRIWAqL.jpg — a Pikachu VMAX —
 * contains `FSWSH286`: the set symbol beside the code came back as a letter and
 * glued itself to the front. A word boundary cannot see inside a run of
 * letters, so the code was invisible for the same reason `560003/069` was.
 *
 * `H` IS DELIBERATELY ABSENT from the vocabulary even though 64 e-Card cards
 * use it. A one-letter prefix with no boundary in front of it matches inside
 * ordinary words — `MATCH12` would read as `H12`, which resolves to a real
 * card — and one letter carries no distinctiveness to survive that. The other
 * fifteen prefixes are two characters or more.
 *
 * TWO LETTERS IS NOT IMMUNITY, only a much smaller target: `PRISM158` still
 * reads as `SM158`. That is the price of reading a glued code at all, it is
 * paid in a candidate that ranks last, and it buys the 305 SWSH promos, 248 SM
 * and 211 XY that were unreadable before.
 */
const PKM_PROMO = /(?<![/\d])(AR|BW|CC|DP|GG|HGSS|RC|RT|SH|SL|SM|SWSH|TG|XY|SV)[- ]?(\d{1,3})\b(?!\s*\/)/gi;

/**
 * The printed number of a SUBSET card: `GG30/GG70`, `TG12/TG30`, `SV30/SV94`.
 *
 * WHY `PKM_NUMBER` CANNOT READ THESE, and it was read as a mystery rather than
 * a bug for a while. Its digit class caps at three characters and starts at a
 * word boundary, so `GG30` — four characters, no boundary after the first G —
 * never matches at all. A photograph of a Galarian Gallery Pikachu therefore
 * produced NO code, fell through to the name fallback, and came back as six
 * arbitrary cards called Pikachu. Observed exactly that way.
 *
 * It is not a rare shape: 1,536 of 23,546 English cards (6.5%) are numbered in
 * a subset sequence — Galarian Gallery, Trainer Gallery, Shiny Vault, and every
 * promo run (SWSH, SM, XY, BW, DP, HGSS) — and those are disproportionately the
 * cards worth photographing.
 *
 * BOTH PREFIXES MUST AGREE. A real printed number repeats its subset on either
 * side of the slash, and requiring that is what keeps this pattern from firing
 * on ordinary text: two letter-digit runs around a slash are common, the same
 * letters on both sides are not.
 *
 * The prefix is LETTERS ONLY, with no digit repair applied to it. `GG` and `TG`
 * are exactly the shapes `asDigits` would rewrite (G to 6, T to 7), so running
 * the repair here would destroy the thing being read.
 */
const PKM_SUBSET = /\b([A-Za-z]{1,4})([0-9OoQDIlSsBZGT]{1,3})\s*\/\s*([A-Za-z]{1,4})([0-9OoQDIlSsBZGT]{1,3})\b/g;

/**
 * Every plausible card code in `text`, best first.
 *
 * Ranked by how constrained the pattern is rather than by where it appeared:
 * a full One Piece code has a letter block, a set number and a card number all
 * agreeing, so a false positive is unlikely. A bare `N/M` is two numbers and a
 * slash, which a card's attack text can produce by accident, so it ranks last.
 */
export function extractCardCodes(text: string): CodeCandidate[] {
  const out: CodeCandidate[] = [];
  const seen = new Set<string>();

  const add = (value: string, kind: CodeCandidate["kind"], raw: string) => {
    if (seen.has(value)) return;
    seen.add(value);
    out.push({ value, kind, raw });
  };

  for (const m of text.matchAll(OP_LOOSE)) {
    const letters = asLetters(m[1]);
    // A One Piece set prefix is letters only. If OCR gave us something that
    // still is not, after repair, it was not a code.
    if (!/^[A-Z]{1,4}$/.test(letters)) continue;

    const tail = `${asDigits(m[2])}-${asDigits(m[3])}`;
    // Longest first: the full prefix is the likeliest reading, each trimmed
    // variant a fallback for a leading glyph that came from the artwork. `OP`
    // and `ST` are two letters, `PRB` three, so a four-letter run is usually
    // one character of noise plus a real prefix. Only the catalogue can say
    // which, so all are offered and the lookup decides.
    for (const value of prefixVariants(letters).map((prefix) => `${prefix}${tail}`)) {
      add(value, "one-piece-code", m[0].trim());
    }
  }

  for (const m of text.matchAll(OP_PROMO)) {
    add(`P-${asDigits(m[1])}`, "one-piece-code", m[0].trim());
  }

  // BEFORE the bare-number pattern, so `GG30/GG70` is offered ahead of any
  // loose `30/70` reading the same text might also yield. More constraints
  // agreeing means a likelier code, which is the ordering rule this whole
  // function follows.
  for (const m of text.matchAll(PKM_SUBSET)) {
    const prefix = m[1].toUpperCase();
    if (prefix !== m[3].toUpperCase()) continue;
    const numerator = asDigits(m[2]);
    const denominator = asDigits(m[4]);
    if (Number(numerator) === 0 || Number(denominator) === 0) continue;
    add(`${prefix}${numerator}/${prefix}${denominator}`, "pokemon-number", m[0].trim());
  }

  for (const m of text.matchAll(PKM_NUMBER)) {
    const numerator = asDigits(m[1]);
    const denominator = asDigits(m[2]);
    // Neither half is ever zero. That is the only arithmetic constraint that
    // holds: a card numbered ABOVE its set total is not an error, it is what a
    // secret rare IS — 190/182 is a real Pokémon card and the example this
    // whole feature was specified against. An earlier version of this rejected
    // exactly that, which is a good measure of how wrong the intuition is.
    if (Number(numerator) === 0 || Number(denominator) === 0) continue;
    // No lower bound on the denominator either, tempting as it is: measured
    // against the catalogue, real official totals include 1, 5, 6, 7, 8 and 9,
    // so "4/8" is a card and not noise. The cost is that body text like
    // "2/3 of remaining damage" survives as a candidate. That is the right way
    // to be wrong here -- it ranks last, resolves to nothing, and the page
    // falls back to typing, which is the designed behaviour rather than a leak.
    add(`${numerator}/${denominator}`, "pokemon-number", m[0].trim());
  }

  // AFTER the exact readings, so a clean number always ranks above a salvaged
  // one. `add` keeps the first spelling it sees, so a run that both patterns
  // can read is never listed twice.
  for (const m of text.matchAll(PKM_GLUED)) {
    const numerator = asDigits(m[1]).slice(-3);
    const denominator = asDigits(m[2]);
    if (Number(numerator) === 0 || Number(denominator) === 0) continue;
    add(`${numerator}/${denominator}`, "pokemon-number", m[0].trim());
  }

  // LAST, because a promo code is the weakest of these readings: it is a token
  // rather than a fraction, so only the catalogue can tell a real one from a
  // coincidence. Everything a fraction produced ranks above it.
  for (const m of text.matchAll(PKM_PROMO)) {
    const digits = asDigits(m[2]);
    if (Number(digits) === 0) continue;
    // Upper case and joined, which is how the catalogue stores it: `SWSH262`,
    // never `swsh-262`. A reading that does not match a real id resolves to
    // nothing, which is the intended cost.
    add(`${m[1].toUpperCase()}${digits}`, "pokemon-number", m[0].trim());
  }

  return out;
}
