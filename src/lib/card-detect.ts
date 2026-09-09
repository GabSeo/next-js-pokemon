/**
 * Find the four corners of a card in a frame, and straighten it.
 *
 * WHY THIS IS NOT A MODEL. A trading card is a bright convex quadrilateral with
 * hard edges against whatever is behind it — the same problem every document
 * scanner solves, and it has had a classical answer since long before anything
 * had weights. Gradient, threshold, convex hull, simplify to four points. It
 * runs in a few milliseconds, needs no download, carries no licence, and cannot
 * be wrong about a card it has never seen because it does not know what a card
 * looks like in the first place.
 *
 * The trained detectors available to us are cards LYING FLAT, often slabbed.
 * That is a real dataset and it is not the situation: a card held up to a phone
 * is tilted, and the thing tilt costs is exactly what corners buy back. This
 * finds corners in the situation we have.
 *
 * WHAT IT REPLACES. A card-shaped guide drawn on screen, with the person holding
 * the phone doing the framing. That worked and asked the wrong thing of them.
 *
 * NO DOM, NO CANVAS, NO IMPORTS. Pixels in, corners out — which is what lets the
 * same code run in the worker, in Node against real photographs, and in a test.
 * The measurement that matters (scripts/detect-lab.mts) compares what this finds
 * against corners read off those photographs by hand.
 */

export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];

/**
 * Long edge of the image the detector actually looks at.
 *
 * A card's outline survives brutal downscaling — it is the largest structure in
 * the frame — and everything here is per-pixel, so this is the difference
 * between 3 ms and 300 ms. 240 keeps a card's edge several pixels thick at any
 * distance where identification could work anyway.
 */
const WORK_EDGE = 240;

/** Gradient pixels kept, as a fraction of the frame. Above this is "an edge". */
const EDGE_FRACTION = 0.1;

/** A quad smaller than this fraction of the frame is a detail, not the subject. */
const MIN_AREA_FRACTION = 0.12;

/** 63 x 88 mm. A found quad far from this ratio is not a card. */
const CARD_ASPECT = 63 / 88;

/**
 * How far the found quad's aspect may sit from a card's before it is refused.
 *
 * Generous on purpose: perspective genuinely changes the apparent ratio of a
 * tilted card, and refusing those would refuse the exact case corners exist to
 * fix. The embedding's own score floor is the second opinion.
 */
const ASPECT_TOLERANCE = 0.55;

// --- geometry -------------------------------------------------------------

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Andrew's monotone chain. Returns the hull counter-clockwise, no repeat point. */
function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((p, q) => (p[0] === q[0] ? p[1] - q[1] : p[0] - q[0]));

  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker on an open run of points. */
function simplifyRun(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], points[0], points[points.length - 1]);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplifyRun(points.slice(0, at + 1), epsilon);
  const right = simplifyRun(points.slice(at), epsilon);
  return left.slice(0, -1).concat(right);
}

/**
 * Simplify a closed hull until exactly four corners remain.
 *
 * THE EPSILON IS SEARCHED, NOT CHOSEN. The right tolerance depends on how big
 * the card is in the frame and how noisy its edge is, and a fixed value gets one
 * of those wrong. Doubling from a small start and stopping at four is a handful
 * of iterations and has no magic number in it.
 */
function cornersFromHull(hull: Point[], scale: number): Quad | undefined {
  if (hull.length < 4) return undefined;
  if (hull.length === 4) return hull as Quad;

  let epsilon = scale * 0.005;
  for (let attempt = 0; attempt < 24; attempt++) {
    // Closed polygon: simplify the run and drop the duplicated end point.
    const simplified = simplifyRun([...hull, hull[0]], epsilon);
    const closed = simplified.slice(0, -1);
    if (closed.length === 4) return closed as Quad;
    if (closed.length < 4) return undefined;
    epsilon *= 1.35;
  }
  return undefined;
}

/** Clockwise from the top-left, which is the order the homography expects. */
function orderCorners(quad: Quad): Quad {
  const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
  const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
  const byAngle = [...quad].sort(
    (a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)
  );
  // `atan2` starts at the negative x axis going down, so the smallest sum of
  // coordinates is the top-left and rotating to it puts the rest in order.
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const sum = byAngle[i][0] + byAngle[i][1];
    if (sum < best) {
      best = sum;
      start = i;
    }
  }
  return [byAngle[start], byAngle[(start + 1) % 4], byAngle[(start + 2) % 4], byAngle[(start + 3) % 4]];
}

function quadArea(quad: Quad): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = quad[i];
    const [x2, y2] = quad[(i + 1) % 4];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

// --- the detector ---------------------------------------------------------

/**
 * Is this quadrilateral card-shaped?
 *
 * Measured along the ACTUAL SIDES rather than a bounding box, so a tilted card
 * is judged by what it is. A card seen at an angle has two short sides of
 * different lengths, and averaging them is what makes the test survive the very
 * perspective the corners exist to correct.
 */
function cardShaped(quad: Quad): boolean {
  const top = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const bottom = Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1]);
  const left = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]);
  const right = Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1]);
  const shortSide = (top + bottom) / 2;
  const longSide = (left + right) / 2;
  if (shortSide < 8 || longSide < 8) return false;
  return Math.abs(shortSide / longSide - CARD_ASPECT) <= ASPECT_TOLERANCE;
}

export type Detection = {
  /** Clockwise from the top left, in the SOURCE image's own pixels. */
  corners: Quad;
  /** Fraction of the frame the card occupies. Useful for a "move closer" hint. */
  coverage: number;
};

/**
 * The card in this frame, or nothing.
 *
 * `nothing` is a real answer and the common one: an empty room has no dominant
 * quadrilateral, and returning a guess there would put a card on screen because
 * someone pointed a phone at a wall.
 */
export function detectCard(rgba: Uint8ClampedArray, width: number, height: number): Detection | undefined {
  // 1. Downscale to the working size, in grey. Nearest-neighbour on purpose:
  //    an edge is a step, and smoothing it before measuring gradients is
  //    throwing away the thing being measured.
  const scale = Math.min(1, WORK_EDGE / Math.max(width, height));
  const w = Math.max(16, Math.round(width * scale));
  const h = Math.max(16, Math.round(height * scale));
  const grey = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.round(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.round(x / scale));
      const at = (sy * width + sx) * 4;
      grey[y * w + x] = 0.299 * rgba[at] + 0.587 * rgba[at + 1] + 0.114 * rgba[at + 2];
    }
  }

  // 2. Sobel magnitude. The card's border is the strongest closed contour in
  //    almost any frame containing one.
  const magnitude = new Float32Array(w * h);
  let biggest = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -grey[i - w - 1] - 2 * grey[i - 1] - grey[i + w - 1] + grey[i - w + 1] + 2 * grey[i + 1] + grey[i + w + 1];
      const gy =
        -grey[i - w - 1] - 2 * grey[i - w] - grey[i - w + 1] + grey[i + w - 1] + 2 * grey[i + w] + grey[i + w + 1];
      const m = Math.abs(gx) + Math.abs(gy);
      magnitude[i] = m;
      if (m > biggest) biggest = m;
    }
  }
  if (biggest === 0) return undefined;

  // 3. Keep the strongest EDGE_FRACTION of pixels. A RELATIVE threshold, not an
  //    absolute one — a card under a lamp and a card in a dim room have wildly
  //    different gradients and the same outline.
  const wanted = Math.max(64, Math.floor(w * h * EDGE_FRACTION));
  const histogram = new Int32Array(257);
  const scaleToBucket = 256 / biggest;
  for (let i = 0; i < magnitude.length; i++) histogram[Math.min(256, Math.floor(magnitude[i] * scaleToBucket))]++;
  let kept = 0;
  let cutoff = 256;
  for (let bucket = 256; bucket >= 0; bucket--) {
    kept += histogram[bucket];
    if (kept >= wanted) {
      cutoff = bucket;
      break;
    }
  }
  const threshold = (cutoff / scaleToBucket) || 0;

  const edges: Point[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (magnitude[y * w + x] >= threshold) edges.push([x, y]);
    }
  }
  if (edges.length < 16) return undefined;

  // 4. CONNECTED COMPONENTS, NOT ONE HULL OVER EVERYTHING.
  //
  //    The first version hulled every edge pixel in the frame and was measured
  //    at 10-19% corner error, taking 4/4 detections down to 2/4
  //    identifications. The reason is not subtle in hindsight: a photograph
  //    contains a hand, a table and a room, all of which have edges, and the
  //    hull of the whole scene is the hull of the scene. It found a beautiful
  //    quadrilateral around the wrong object.
  //
  //    A card's border is a CLOSED LOOP and the largest connected edge
  //    structure in a frame that contains one. Labelling first and hulling each
  //    component separately asks "which of these things is a card" instead of
  //    "what shape is everything".
  const mask = new Uint8Array(w * h);
  for (const [x, y] of edges) mask[y * w + x] = 1;

  // Dilate once, so a border broken by glare or a low-contrast corner still
  // joins into one component. A card outline with a gap is two components and
  // neither of them is card-shaped.
  const closed = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (
        mask[i] ||
        mask[i - 1] ||
        mask[i + 1] ||
        mask[i - w] ||
        mask[i + w] ||
        mask[i - w - 1] ||
        mask[i - w + 1] ||
        mask[i + w - 1] ||
        mask[i + w + 1]
      ) {
        closed[i] = 1;
      }
    }
  }

  const label = new Int32Array(w * h).fill(-1);
  const components: Point[][] = [];
  const queue = new Int32Array(w * h);
  for (let start = 0; start < closed.length; start++) {
    if (!closed[start] || label[start] !== -1) continue;
    const id = components.length;
    const points: Point[] = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i - x) / w;
      points.push([x, y]);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (closed[j] && label[j] === -1) {
            label[j] = id;
            queue[tail++] = j;
          }
        }
      }
    }
    components.push(points);
  }

  // 5. The best card-shaped component wins. Sorted biggest-first so the common
  //    case settles on the first candidate, and every candidate must pass the
  //    same shape test rather than the largest one being trusted.
  components.sort((a, b) => b.length - a.length);

  let best: { corners: Quad; coverage: number } | undefined;
  for (const component of components.slice(0, 6)) {
    if (component.length < 32) continue;
    const candidate = cornersFromHull(convexHull(component), Math.max(w, h));
    if (!candidate) continue;

    const ordered = orderCorners(candidate);
    const coverage = quadArea(ordered) / (w * h);
    if (coverage < MIN_AREA_FRACTION) continue;
    if (!cardShaped(ordered)) continue;
    if (!best || coverage > best.coverage) best = { corners: ordered, coverage };
  }
  if (!best) return undefined;

  const { corners: ordered, coverage } = best;

  // Back to the source image's own pixels, which is what the caller can draw
  // and what the warp needs.
  const back = (p: Point): Point => [p[0] / scale, p[1] / scale];
  return { corners: [back(ordered[0]), back(ordered[1]), back(ordered[2]), back(ordered[3])], coverage };
}

// --- straightening --------------------------------------------------------

/** Solve `A x = b` by Gaussian elimination with partial pivoting. */
function solve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    if (Math.abs(a[col][col]) < 1e-9) return [];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}

/**
 * The homography taking DESTINATION corners back to source corners.
 *
 * The inverse direction on purpose: the warp walks the destination and asks
 * where each pixel came from. Sampling forwards leaves holes wherever the
 * source stretches.
 */
function homography(from: Point[], to: Point[]): number[] | undefined {
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const solved = solve(rows, rhs);
  return solved.length === 8 ? [...solved, 1] : undefined;
}

/**
 * Straighten a detected card into a square of `side`, bilinear.
 *
 * STRETCHED TO A SQUARE, not to a card's proportions, because that is what the
 * index was built from: `sharp`'s `fit: "fill"` at 256x256. Correcting the
 * aspect here would put the query in a different space from every reference.
 */
export function rectify(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  corners: Quad,
  side: number
): Uint8ClampedArray | undefined {
  const destination: Point[] = [
    [0, 0],
    [side, 0],
    [side, side],
    [0, side],
  ];
  const h = homography(destination, corners);
  if (!h) return undefined;

  const out = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const denominator = h[6] * x + h[7] * y + h[8];
      const sx = (h[0] * x + h[1] * y + h[2]) / denominator;
      const sy = (h[3] * x + h[4] * y + h[5]) / denominator;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const target = (y * side + x) * 4;
      out[target + 3] = 255;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) continue;

      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const p = (row: number, col: number) => rgba[(row * width + col) * 4 + c];
        const top = p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx;
        const bottom = p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx;
        out[target + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return out;
}
