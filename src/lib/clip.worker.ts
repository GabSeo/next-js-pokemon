/// <reference lib="webworker" />

import { detectCard, rectify, type Quad } from "@/lib/card-detect";
import { CLIP_DIM, clipIndexFrom, clipSearch, type ClipIndex } from "@/lib/clip-search";

/**
 * The matcher, on a thread that is not the one drawing the page.
 *
 * WHY THIS FILE EXISTS. Inference took ~450 ms and ran where React runs, so the
 * camera preview stuttered, scrolling stalled, and the whole page felt broken
 * while it worked. A 60 ms yield between frames kept the tab alive and did not
 * make it smooth: the block is the match itself, not the gap between matches.
 * No amount of yielding fixes a 450 ms synchronous stretch on the thread that
 * paints video.
 *
 * WHAT MOVES HERE: the model, the index, the resize, and the search. What stays
 * on the main thread is one `createImageBitmap` — which decodes off-thread
 * anyway — and a `postMessage` of a transferable, which copies nothing.
 *
 * OffscreenCanvas does the 256x256 resize here rather than on the main thread,
 * so the crop, the rescale and the embed are all on this side. The recipe is
 * the same one `pokemon-clip-embed.mts` used to build the index: stretch to
 * 256, rescale to 0..1, no channel normalisation. It is written twice — once in
 * Node, once here — and that is the one duplication in this pipeline worth
 * watching, because a silent disagreement makes every comparison meaningless.
 */

type VisionModel = (input: { pixel_values: unknown }) => Promise<{ image_embeds: { data: Float32Array } }>;
type TensorCtor = new (type: string, data: Float32Array, dims: number[]) => unknown;

const SIDE = 256;

let vision: VisionModel | undefined;
let Tensor: TensorCtor | undefined;
/** Which backend actually loaded, reported so it can be seen rather than assumed. */
let backend: "webgpu" | "wasm" = "wasm";
let index: ClipIndex | undefined;
let indexKey: string | undefined;

/** One canvas reused for every frame; allocating per frame is a garbage-collection stall. */
let canvas: OffscreenCanvas | undefined;

type InitMessage = { type: "init"; key: string };
type MatchMessage = {
  type: "match";
  id: number;
  bitmap: ImageBitmap;
  limit: number;
  /**
   * Find the card in the frame rather than trusting the caller's crop.
   *
   * When set, the bitmap is a WHOLE FRAME and this side locates the card,
   * straightens it, and embeds that. When absent the bitmap is already the
   * region to read — which is what the photo upload sends, because a person
   * framed it when they took it.
   */
  detect?: boolean;
};
type Incoming = InitMessage | MatchMessage;

/**
 * Load the model, on the GPU if this browser has one.
 *
 * WHY IT IS WORTH TRYING. WASM runs the same ~450 ms on a laptop and on a phone,
 * which is the signature of a runtime rather than of a processor — a faster
 * device does not help. WebGPU is a different execution path, not a faster one
 * of the same kind.
 *
 * AND WHY IT MATTERS MORE SINCE THE DECISION CHANGED. The live view accumulates
 * evidence across frames, so frames per second and confidence are now the same
 * quantity: at 2 fps three frames take a second and a half, at 8 fps they take
 * four hundred milliseconds. Speed here buys correctness, not just smoothness.
 *
 * THE FALLBACK IS NOT OPTIONAL. WebGPU is absent on most iOS, behind a flag in
 * places, and can fail at adapter request even where the API exists. Every one
 * of those must land on WASM rather than on a broken scanner, so the attempt is
 * wrapped and the result reported rather than assumed.
 */
async function ensureModel(): Promise<void> {
  if (vision) return;
  const transformers = await import("@huggingface/transformers");
  transformers.env.allowLocalModels = false;

  const onProgress = (report: { status?: string; progress?: number }) => {
    if (report?.status === "progress" && typeof report.progress === "number") {
      self.postMessage({ type: "progress", stage: "model", ratio: report.progress / 100 });
    }
  };

  const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  if (hasGpu) {
    try {
      vision = (await transformers.CLIPVisionModelWithProjection.from_pretrained("Xenova/mobileclip_s2", {
        dtype: "fp16",
        device: "webgpu",
        progress_callback: onProgress,
      })) as unknown as VisionModel;
      backend = "webgpu";
    } catch {
      // An adapter that would not come up, or an operator this export uses that
      // the backend does not implement. Neither is a reason to have no scanner.
      vision = undefined;
    }
  }

  if (!vision) {
    vision = (await transformers.CLIPVisionModelWithProjection.from_pretrained("Xenova/mobileclip_s2", {
      dtype: "fp16",
      progress_callback: onProgress,
    })) as unknown as VisionModel;
    backend = "wasm";
  }

  Tensor = transformers.Tensor as unknown as TensorCtor;
}

async function ensureIndex(key: string): Promise<void> {
  if (index && indexKey === key) return;
  self.postMessage({ type: "progress", stage: "index" });
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
  index = clipIndexFrom(manifest, blob);
  indexKey = key;
}

/** The ingestion recipe: an RGBA square becomes the tensor the model wants. */
function pixelsFrom(rgba: Uint8ClampedArray): Float32Array {
  const pixels = new Float32Array(3 * SIDE * SIDE);
  const plane = SIDE * SIDE;
  for (let i = 0; i < plane; i++) {
    const at = i * 4;
    pixels[i] = rgba[at] / 255;
    pixels[plane + i] = rgba[at + 1] / 255;
    pixels[2 * plane + i] = rgba[at + 2] / 255;
  }
  return pixels;
}

/** Stretch a bitmap to the model's square. Used when the caller already cropped. */
function squareOf(bitmap: ImageBitmap): Uint8ClampedArray {
  if (!canvas) canvas = new OffscreenCanvas(SIDE, SIDE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no offscreen 2d context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, SIDE, SIDE);
  return ctx.getImageData(0, 0, SIDE, SIDE).data;
}

/** A frame at its own size, for the detector to look at. */
let frameCanvas: OffscreenCanvas | undefined;
function frameOf(bitmap: ImageBitmap): { rgba: Uint8ClampedArray; width: number; height: number } {
  if (!frameCanvas || frameCanvas.width !== bitmap.width || frameCanvas.height !== bitmap.height) {
    frameCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  }
  const ctx = frameCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no offscreen 2d context");
  ctx.drawImage(bitmap, 0, 0);
  return { rgba: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
}

function normalise(raw: Float32Array): Float32Array {
  let norm = 0;
  for (const value of raw) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] / norm;
  return out;
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data;

  try {
    if (message.type === "init") {
      await ensureModel();
      await ensureIndex(message.key);
      self.postMessage({ type: "ready", backend });
      return;
    }

    if (message.type === "match") {
      await ensureModel();
      const started = performance.now();

      // FIND THE CARD, or fall back to what was sent. Graded on 1,341 annotated
      // photographs (scripts/detect-grade.mts): it locates a quadrilateral in
      // 90% of them, median IoU 0.784 against the outline a person drew. When
      // it declines, the centre of the frame is a better guess than nothing —
      // that is what the manual guide was.
      let square: Uint8ClampedArray;
      let corners: Quad | undefined;
      if (message.detect) {
        const frame = frameOf(message.bitmap);
        const found = detectCard(frame.rgba, frame.width, frame.height);
        const straight = found ? rectify(frame.rgba, frame.width, frame.height, found.corners, SIDE) : undefined;
        if (found && straight) {
          corners = found.corners;
          square = straight;
        } else {
          square = squareOf(message.bitmap);
        }
      } else {
        square = squareOf(message.bitmap);
      }
      const pixels = pixelsFrom(square);

      // A bitmap is a resource, not a value: leaving them unclosed at two a
      // second is a leak the tab notices within a minute.
      message.bitmap.close();

      const output = await vision!({ pixel_values: new Tensor!("float32", pixels, [1, 3, SIDE, SIDE]) });
      const query = normalise(output.image_embeds.data);
      if (query.length !== CLIP_DIM) throw new Error(`model returned ${query.length} dimensions`);

      const result = clipSearch(index!, query, message.limit);
      self.postMessage({
        type: "match",
        id: message.id,
        hits: result.hits,
        margin: result.margin,
        elapsed: performance.now() - started,
        backend,
        // Sent back so the view can draw what was actually read, rather than a
        // box the person is asked to line up with.
        corners,
      });
    }
  } catch (error) {
    if (message.type === "match") message.bitmap.close();
    self.postMessage({
      type: "error",
      id: message.type === "match" ? message.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
