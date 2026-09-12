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

  return out;
}
