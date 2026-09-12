/**
 * Cosine search over the MobileCLIP index. Pure arithmetic, no DOM, no `node:fs`.
 *
 * WHY IT HAS NO DEPENDENCIES. This runs in a BROWSER, against an index built in
 * Node. The two sides must agree exactly on what a match is, so the comparison
 * lives in one file that both can import rather than being written twice and
 * kept in step by hope.
 *
 * WHY THERE IS NO VECTOR DATABASE. Measured: a full scan of 41,500 x 512 int8
 * values is ~8 ms in plain JavaScript. pgvector and Qdrant solve a problem that
 * starts a thousand times further up, and either would add a 20-50 ms network
 * hop to a search that takes eight. The index is 20 MB and ships to the client.
 *
 * INT8 AGAINST FLOAT32, ON PURPOSE. The stored vectors are quantised; the query
 * is not. Multiplying them and dividing once by 127 is the same dot product
 * with one rescale at the end, and it avoids quantising the query — which is
 * the one vector we have at full precision.
 *
 * BOTH VECTORS ARE L2-NORMALISED, so a dot product IS the cosine similarity and
 * there is no magnitude to divide out per candidate.
 */

/** Every vector in the index has this many dimensions. Set by the model, not by us. */
export const CLIP_DIM = 512;

export type ClipIndex = {
  /** Catalogue ids, in the same order as the vector blob. */
  ids: string[];
  /** `ids.length * CLIP_DIM` signed bytes. */
  vectors: Int8Array;
};

export type ClipHit = {
  id: string;
  /** Cosine similarity in [-1, 1]. Absolute value means little; see `margin`. */
  score: number;
};

export type ClipResult = {
  hits: ClipHit[];
  /**
   * The gap between the best and second-best score.
   *
   * THIS IS THE NUMBER TO THRESHOLD ON, not the score. A photograph of a card
   * scores 0.6-0.9 against half the catalogue because every Pokemon card looks
   * like a Pokemon card; what separates an answer from a guess is how far the
   * winner stands clear of the runner-up.
   */
  margin: number;
};

/**
 * The `margin` below which a match should be treated as "not sure".
 *
 * PROVISIONAL, AND THE SAMPLE IS FIVE PHOTOGRAPHS. Measured against the full
 * index (scripts/clip-resample-lab.mts):
 *
 *   correct answers   0.018, 0.036, 0.072
 *   wrong answers     0.006, 0.007
 *
 * 0.015 separates those two groups, and on n=5 that is a hypothesis rather than
 * a calibration. It is exported so it can be moved from one place once there
 * are enough labelled photographs to fit it properly, and so a caller can see
 * what it is trusting.
 */
export const CLIP_CONFIDENT_MARGIN = 0.015;

/**
 * Above this many indistinguishable cards, the matcher has not found a tie — it
 * has found nothing. Two or three cards sharing one artwork is a reprint; eight
 * is a photograph the model could not read at all, and offering eight cards is
 * worse than admitting that.
 */
export const CLIP_MAX_TIED = 3;

/**
 * Below this SCORE there is no card in front of the camera.
 *
 * WHY A SECOND THRESHOLD, WHEN THE MARGIN ALREADY EXISTS. A cosine search always
 * returns a nearest neighbour. Point a phone at a grey wall and the index names
 * its closest card and hands back a number; nothing in the arithmetic says
 * "that was a wall". A photo scan hid this, because a person only presses the
 * button when a card is in frame. A video feed runs whether or not anything is
 * there.
 *
 * And the margin cannot do this job. Measured (scripts/clip-floor-lab.mts)
 * against the full English index:
 *
 *   flat grey         score 0.3568   margin 0.0231   <- CLEARS the margin test
 *   flat dark         score 0.3668   margin 0.0060
 *   random noise      score 0.3642   margin 0.0009
 *   card, blurred     score 0.6774   margin 0.0286
 *   card, in frame    score 0.9985   margin 0.0772
 *
 * A flat grey wall passes `CLIP_CONFIDENT_MARGIN` outright. Without a score
 * floor a live view would name a card, confidently, at a wall.
 *
 * 0.50 sits between the noise ceiling (0.367) and a badly blurred real card
 * (0.677), deliberately nearer the card side: the floor only decides whether
 * something card-shaped is present, and the margin still decides whether it can
 * be named. Being generous here costs a "hold steady", not a wrong answer.
 */
export const CLIP_CARD_FLOOR = 0.5;

/**
 * The three things a live view can honestly say, in order of how much it knows.
 *
 * `empty`      nothing card-like in frame — say so, do not guess
 * `unsure`     a card is there and cannot be named yet: too far, too blurred,
 *              or genuinely tied with a reprint. Measured: a card filling a
 *              fifth of the frame scores 0.759 with a margin of 0.0012, which
 *              is exactly this state and exactly the moment to say "move closer"
 * `identified` above both thresholds
 */
export type ClipVerdict = "empty" | "unsure" | "identified";

export function clipVerdict(result: { hits: ClipHit[]; margin: number }): ClipVerdict {
  const best = result.hits[0];
  if (!best || best.score < CLIP_CARD_FLOOR) return "empty";
  return result.margin >= CLIP_CONFIDENT_MARGIN ? "identified" : "unsure";
}

/**
 * The cards the matcher genuinely cannot tell apart.
 *
 * WHY THIS EXISTS. Refusing on a small margin was the right instinct and the
 * wrong action. Measured on the full Japanese index, 28% of cards have a
 * near-twin closer than `CLIP_CONFIDENT_MARGIN` — 4% in English — because
 * Japanese sets reprint aggressively and a reprint is the SAME ARTWORK under a
 * new number. `SM12a-052` is `SM11-029` repainted not at all; searching with
 * that card's own official reference image ranks the other one first, by 0.0015.
 *
 * So a small margin usually does not mean "bad photograph". It means "these two
 * cards look identical because they ARE identical", and no camera will ever
 * separate them. Showing both is the honest answer and the only one that can be
 * given; showing nothing throws away a correct result because it came with a
 * companion.
 *
 * One returned hit is a confident answer. Two or three is a real tie to put in
 * front of a person. More than `CLIP_MAX_TIED` is noise, and the caller should
 * treat it as no match.
 */
export function clipTied<T extends ClipHit>(result: { hits: T[]; margin: number }): T[] {
  const best = result.hits[0];
  if (!best) return [];
  return result.hits.filter((hit) => best.score - hit.score < CLIP_CONFIDENT_MARGIN);
}

/**
 * Top matches for one query vector.
 *
 * A partial selection rather than a sort: `limit` is 5 and the index is 20,000+,
 * so sorting the whole thing to discard 99.98% of it costs more than the search.
 */
export function clipSearch(index: ClipIndex, query: Float32Array, limit = 5): ClipResult {
  const count = index.ids.length;
  if (count === 0 || query.length !== CLIP_DIM) return { hits: [], margin: 0 };

  const best: ClipHit[] = [];
  let worstKept = -Infinity;
  // Tracked separately from `best`: the runner-up may have been evicted from a
  // short list, and the margin must not silently widen when `limit` shrinks.
  let top = -Infinity;
  let second = -Infinity;

  for (let card = 0; card < count; card++) {
    const offset = card * CLIP_DIM;
    let total = 0;
    for (let k = 0; k < CLIP_DIM; k++) total += index.vectors[offset + k] * query[k];
    const score = total / 127;

    if (score > top) {
      second = top;
      top = score;
    } else if (score > second) {
      second = score;
    }

    if (best.length < limit || score > worstKept) {
      const hit = { id: index.ids[card], score };
      let at = best.length;
      while (at > 0 && best[at - 1].score < score) at--;
      best.splice(at, 0, hit);
      if (best.length > limit) best.pop();
      worstKept = best[best.length - 1].score;
    }
  }

  return { hits: best, margin: second === -Infinity ? 0 : top - second };
}

/**
 * The magnitude every stored vector is supposed to have.
 *
 * The ingestion L2-normalises each embedding and multiplies by 127, so a
 * correct vector's norm is 127 give or take rounding — measured across the
 * Pokemon indexes, min 126.4, median 127.2, max 128.2.
 */
const EXPECTED_NORM = 127;

/** Beyond this far from `EXPECTED_NORM`, a vector was not written by the current recipe. */
const NORM_TOLERANCE = 1.1;

/**
 * Read an index out of the two files the ingestion writes.
 *
 * The manifest and the blob are separate because 20 MB of numbers as JSON would
 * be ~120 MB and parse in seconds; as a typed array it is a single allocation.
 *
 * EVERY VECTOR IS RE-NORMALISED HERE, and that is not belt-and-braces — it is
 * repairing a live fault. A dot product only equals the cosine when both
 * vectors are unit length; the moment one is not, its score scales with its
 * MAGNITUDE and it beats everything in the index regardless of what the picture
 * shows.
 *
 * Measured across the four shipped indexes: 40 of 5,809 One Piece English
 * vectors (0.7%) carry a norm of ~2,255 instead of 127, which is a self-score
 * of 316 where the maximum should be 1.0. All forty are alternate printings
 * (`OP01-101_p1`, `EB02-010_p2`, …), scattered rather than contiguous, and the
 * current embedder cannot produce them — it divides by the norm explicitly. They
 * are stale vectors from an earlier recipe, kept alive by the ingestion's
 * incremental cache, which skips a printing that is already embedded.
 *
 * So forty cards were winning every English One Piece search, whatever was in
 * frame. Re-embedding them is the real fix and needs the network; this makes the
 * arithmetic true whatever the file happens to hold, which is where the
 * guarantee belongs — the search is the thing that depends on unit length, so
 * the search is what should insist on it.
 *
 * A repaired vector is still the wrong embedding for its card. It just stops
 * being everyone else's answer.
 */
export function clipIndexFrom(manifest: { ids?: string[] }, blob: ArrayBuffer): ClipIndex {
  const ids = manifest.ids ?? [];
  const vectors = new Int8Array(blob);
  // A blob that does not divide evenly by the id count is a truncated download,
  // not a smaller index — returning it would silently misalign every id with
  // somebody else's vector.
  if (vectors.length !== ids.length * CLIP_DIM) {
    throw new Error(
      `CLIP index is inconsistent: ${ids.length} ids against ${vectors.length} bytes ` +
        `(expected ${ids.length * CLIP_DIM})`
    );
  }

  for (let card = 0; card < ids.length; card++) {
    const offset = card * CLIP_DIM;
    let total = 0;
    for (let k = 0; k < CLIP_DIM; k++) total += vectors[offset + k] * vectors[offset + k];
    const norm = Math.sqrt(total);
    // A norm of zero is an absent embedding, not a wrong one — rescaling it
    // would divide by zero, and it already scores zero against everything,
    // which is the correct answer for a card with no picture.
    if (norm === 0 || Math.abs(norm - EXPECTED_NORM) <= NORM_TOLERANCE) continue;
    const scale = EXPECTED_NORM / norm;
    for (let k = 0; k < CLIP_DIM; k++) vectors[offset + k] = Math.round(vectors[offset + k] * scale);
  }

  return { ids, vectors };
}
