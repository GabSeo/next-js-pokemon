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
 * Read an index out of the two files the ingestion writes.
 *
 * The manifest and the blob are separate because 20 MB of numbers as JSON would
 * be ~120 MB and parse in seconds; as a typed array it is a single allocation.
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
  return { ids, vectors };
}
