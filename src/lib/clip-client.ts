import { CLIP_DIM, clipIndexFrom, clipSearch, type ClipHit, type ClipIndex, type ClipResult } from "@/lib/clip-search";

/**
 * Identify a card from a picture, entirely in the browser.
 *
 * WHAT THIS REPLACES. The scan used to post a photograph to Google Vision, read
 * the printed number out of the text, and ask the catalogue which cards carry
 * that number — a metered call on the critical path, and a number that names
 * more than one card 53% of the time. This looks at the artwork instead, on the
 * device, against 51,528 reference vectors, and spends nothing.
 *
 * IT RUNS IN A WORKER, AND THAT IS NOT AN OPTIMISATION. Inference takes ~450 ms
 * and used to run where React runs, so the camera preview stuttered and the page
 * felt broken while it worked — reported from a real phone as "everything seems
 * laggy", which was exactly right. A yield between frames kept the tab alive
 * without making it smooth: the block is the match itself, not the gap between
 * matches, and no amount of yielding fixes a 450 ms synchronous stretch on the
 * thread that paints video.
 *
 * The main thread now does one thing per frame — `createImageBitmap`, which
 * decodes off-thread and crops in the same call — and transfers the result,
 * which copies nothing. The model, the index, the resize and the search all live
 * in lib/clip.worker.ts.
 *
 * THE INLINE PATH IS STILL HERE, for a browser with no Worker or no
 * OffscreenCanvas. It is slower and it blocks, and it is better than a scan that
 * does not work at all.
 *
 * THE PREPROCESSING IS THE CONTRACT, wherever it runs. Four steps, and they must
 * match scripts/pokemon-clip-embed.mts exactly or every comparison is
 * meaningless:
 *
 *   1  resize to 256x256 by STRETCHING, not cropping   (sharp `fit: "fill"`)
 *   2  rescale bytes to 0..1
 *   3  NO channel normalisation — MobileCLIP's `do_normalize` is false, which
 *      is where it differs from CLIP ViT-B/32 and where reusing CLIP's recipe
 *      would be silently wrong
 *   4  channel-first layout, [1, 3, 256, 256]
 *
 * The one step that cannot match is the resampling kernel: ingestion uses
 * sharp's cubic and a canvas uses whatever the browser does. Measured
 * (scripts/clip-resample-lab.mts) across cubic, mitchell, lanczos3 and nearest:
 * identical identifications, margins within 0.003. So the gap is real and does
 * not matter.
 */

const SIDE = 256;

/**
 * WHICH INDEX TO SEARCH — a catalogue, not a language.
 *
 * It began as a language because there was one game. There are two now, keyed
 * differently on purpose: Pokemon on the CARD (0 of 10,110 multi-variant cards
 * have a distinct image per variant) and One Piece on the PRINTING (945 of 945
 * multi-printing codes do). Calling this a language would have made the One
 * Piece indexes look like Japanese ones.
 */
export type ClipIndexKey = "en" | "ja" | "op-en" | "op-ja";

/** @deprecated Kept so existing callers keep compiling; `ClipIndexKey` is the shape. */
export type ClipLanguage = ClipIndexKey;

export type ClipProgress = {
  /** `model` while weights download, `index` while vectors do, `ready` after. */
  stage: "model" | "index" | "ready";
  /** 0..1 where the underlying loader reports it, otherwise undefined. */
  ratio?: number;
};

export type ClipMatch = ClipResult & {
  /** Milliseconds spent embedding and searching, once everything is loaded. */
  elapsed: number;
};

/**
 * The part of the source to look at.
 *
 * WHY IT IS NOT ALWAYS THE WHOLE FRAME. A camera frame is 4:3 or 16:9 and a
 * card is 300:420, so matching the whole thing feeds the model mostly room.
 * Measured (scripts/clip-floor-lab.mts): a card filling a fifth of the frame
 * scores 0.759 with a margin of 0.0012 — recognisable as a card, impossible to
 * name. Cropping to a card-shaped region is what a detector will eventually do
 * automatically, and until one exists a guide drawn on screen lets the person
 * holding the phone do it instead.
 */
export type SourceRect = { x: number; y: number; width: number; height: number };

/** A card's proportions: 63 x 88 mm. */
export const CARD_ASPECT = 63 / 88;

/**
 * The largest card-shaped rectangle inside a frame, centred, at `fill` of the
 * dimension that binds. This is the region the on-screen guide draws.
 */
export function cardRect(width: number, height: number, fill = 0.82): SourceRect {
  const byHeight = height * fill;
  const byWidth = (width * fill) / CARD_ASPECT;
  const h = Math.min(byHeight, byWidth);
  const w = h * CARD_ASPECT;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

// --- the worker -----------------------------------------------------------

type Pending = { resolve: (match: ClipMatch) => void; reject: (error: Error) => void };

type WorkerReply =
  | { type: "ready" }
  | { type: "progress"; stage: "model" | "index"; ratio?: number }
  | { type: "match"; id: number; hits: ClipHit[]; margin: number; elapsed: number }
  | { type: "error"; id?: number; message: string };

let worker: Worker | undefined;
let workerBroken = false;
let nextRequest = 1;
const pending = new Map<number, Pending>();
const readyFor = new Map<ClipIndexKey, Promise<void>>();
let reportProgress: ((progress: ClipProgress) => void) | undefined;

function supportsWorker(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function"
  );
}

function getWorker(): Worker | undefined {
  if (workerBroken || !supportsWorker()) return undefined;
  if (worker) return worker;

  try {
    worker = new Worker(new URL("./clip.worker.ts", import.meta.url), { type: "module" });
  } catch {
    // A bundler or a browser that will not give us one. The inline path stands.
    workerBroken = true;
    return undefined;
  }

  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    if (reply.type === "progress") {
      reportProgress?.({ stage: reply.stage, ratio: reply.ratio });
      return;
    }
    if (reply.type === "match") {
      const waiting = pending.get(reply.id);
      pending.delete(reply.id);
      waiting?.resolve({ hits: reply.hits, margin: reply.margin, elapsed: reply.elapsed });
      return;
    }
    if (reply.type === "error" && reply.id !== undefined) {
      const waiting = pending.get(reply.id);
      pending.delete(reply.id);
      waiting?.reject(new Error(reply.message));
    }
  };

  worker.onerror = () => {
    // A worker that died takes its pending work with it. Everything in flight is
    // rejected rather than left hanging, and the next call falls inline.
    workerBroken = true;
    for (const waiting of pending.values()) waiting.reject(new Error("the matcher worker stopped"));
    pending.clear();
    readyFor.clear();
    worker?.terminate();
    worker = undefined;
  };

  return worker;
}

function warmWorker(active: Worker, key: ClipIndexKey): Promise<void> {
  const held = readyFor.get(key);
  if (held) return held;

  const warming = new Promise<void>((resolve, reject) => {
    const settle = (event: MessageEvent<WorkerReply>) => {
      if (event.data.type === "ready") {
        active.removeEventListener("message", settle);
        resolve();
      } else if (event.data.type === "error" && event.data.id === undefined) {
        active.removeEventListener("message", settle);
        readyFor.delete(key);
        reject(new Error(event.data.message));
      }
    };
    active.addEventListener("message", settle);
    active.postMessage({ type: "init", key });
  });

  readyFor.set(key, warming);
  return warming;
}

// --- the inline fallback --------------------------------------------------

type VisionModel = (input: { pixel_values: unknown }) => Promise<{ image_embeds: { data: Float32Array } }>;

let modelPromise:
  | Promise<{ vision: VisionModel; Tensor: new (t: string, d: Float32Array, dims: number[]) => unknown }>
  | undefined;
const indexPromises = new Map<ClipIndexKey, Promise<ClipIndex>>();

async function loadModel(onProgress?: (p: ClipProgress) => void) {
  if (!modelPromise) {
    modelPromise = (async () => {
      const transformers = await import("@huggingface/transformers");
      transformers.env.allowLocalModels = false;
      const vision = (await transformers.CLIPVisionModelWithProjection.from_pretrained("Xenova/mobileclip_s2", {
        dtype: "fp16",
        progress_callback: (report: { status?: string; progress?: number }) => {
          if (report?.status === "progress" && typeof report.progress === "number") {
            onProgress?.({ stage: "model", ratio: report.progress / 100 });
          }
        },
      })) as unknown as VisionModel;
      return { vision, Tensor: transformers.Tensor as never };
    })().catch((error) => {
      // A failed load must not poison every later attempt — the usual cause is
      // a dropped connection mid-download, and the next try should re-download.
      modelPromise = undefined;
      throw error;
    });
  }
  return modelPromise;
}

async function loadIndex(key: ClipIndexKey): Promise<ClipIndex> {
  let held = indexPromises.get(key);
  if (!held) {
    held = (async () => {
      const [manifest, blob] = await Promise.all([
        fetch(`/api/scan/index/${key}.json`).then((r) => {
          if (!r.ok) throw new Error(`index manifest ${r.status}`);
          return r.json() as Promise<{ ids?: string[] }>;
        }),
        fetch(`/api/scan/index/${key}.i8`).then((r) => {
          if (!r.ok) throw new Error(`index vectors ${r.status}`);
          return r.arrayBuffer();
        }),
      ]);
      return clipIndexFrom(manifest, blob);
    })().catch((error) => {
      indexPromises.delete(key);
      throw error;
    });
    indexPromises.set(key, held);
  }
  return held;
}

function inlinePixels(source: CanvasImageSource, rect: SourceRect): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser did not give us a 2D canvas");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, SIDE, SIDE);

  const { data } = ctx.getImageData(0, 0, SIDE, SIDE);
  const pixels = new Float32Array(3 * SIDE * SIDE);
  const plane = SIDE * SIDE;
  for (let i = 0; i < plane; i++) {
    const at = i * 4;
    // Rescale only. See the module comment on why there is no normalisation.
    pixels[i] = data[at] / 255;
    pixels[plane + i] = data[at + 1] / 255;
    pixels[2 * plane + i] = data[at + 2] / 255;
  }
  return pixels;
}

/** L2-normalise, so the search's dot product is a cosine similarity. */
function normalise(raw: Float32Array): Float32Array {
  let norm = 0;
  for (const value of raw) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] / norm;
  return out;
}

async function matchInline(
  source: CanvasImageSource,
  rect: SourceRect,
  key: ClipIndexKey,
  limit: number,
  onProgress?: (p: ClipProgress) => void
): Promise<ClipMatch> {
  const [{ vision, Tensor }, index] = await Promise.all([
    loadModel(onProgress),
    (async () => {
      onProgress?.({ stage: "index" });
      return loadIndex(key);
    })(),
  ]);
  onProgress?.({ stage: "ready" });

  const started = performance.now();
  const pixels = inlinePixels(source, rect);
  const output = await vision({ pixel_values: new Tensor("float32", pixels, [1, 3, SIDE, SIDE]) });
  const query = normalise(output.image_embeds.data);
  if (query.length !== CLIP_DIM) throw new Error(`model returned ${query.length} dimensions, expected ${CLIP_DIM}`);

  const result = clipSearch(index, query, limit);
  return { ...result, elapsed: performance.now() - started };
}

// --- what callers use -----------------------------------------------------

/**
 * Embed one image and search one catalogue's index.
 *
 * ONE CATALOGUE, NEVER TWO — the same rule the OCR path follows, for the same
 * measured reason: an English card and its Japanese release share artwork
 * exactly, so searching both returns two answers for one card and forces the
 * reader to break the tie with information the picture does not contain.
 */
export async function matchCard(
  source: CanvasImageSource,
  /** The region to read. Pass the whole image for a photo, `cardRect` for a frame. */
  rect: SourceRect,
  key: ClipIndexKey,
  options?: { limit?: number; onProgress?: (p: ClipProgress) => void }
): Promise<ClipMatch> {
  const limit = options?.limit ?? 5;
  const active = getWorker();

  if (active) {
    try {
      reportProgress = options?.onProgress;
      await warmWorker(active, key);
      options?.onProgress?.({ stage: "ready" });

      // THE CROP HAPPENS HERE, in `createImageBitmap`, which decodes off the
      // main thread and hands back exactly the region the guide draws. Sending
      // the whole frame and cropping in the worker would transfer several times
      // the bytes for the same answer.
      const bitmap = await createImageBitmap(
        source,
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.width),
        Math.round(rect.height)
      );

      const id = nextRequest++;
      return await new Promise<ClipMatch>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        active.postMessage({ type: "match", id, bitmap, limit }, [bitmap]);
      });
    } catch {
      // The worker refused this frame. Fall through rather than lose the scan;
      // if it died, `onerror` has already marked it broken.
    }
  }

  return matchInline(source, rect, key, limit, options?.onProgress);
}

/** Warm the model and one catalogue before the user takes a picture. */
export async function prepareMatcher(key: ClipIndexKey, onProgress?: (p: ClipProgress) => void): Promise<void> {
  const active = getWorker();
  if (active) {
    try {
      reportProgress = onProgress;
      await warmWorker(active, key);
      onProgress?.({ stage: "ready" });
      return;
    } catch {
      // fall through and warm the inline path instead
    }
  }
  await Promise.all([loadModel(onProgress), loadIndex(key)]);
  onProgress?.({ stage: "ready" });
}

/** Decode a File into something `matchCard` can paint, and report its size. */
export async function bitmapOf(file: Blob): Promise<{ source: ImageBitmap; width: number; height: number }> {
  const source = await createImageBitmap(file);
  return { source, width: source.width, height: source.height };
}
