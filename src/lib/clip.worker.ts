/// <reference lib="webworker" />

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
let index: ClipIndex | undefined;
let indexKey: string | undefined;

/** One canvas reused for every frame; allocating per frame is a garbage-collection stall. */
let canvas: OffscreenCanvas | undefined;

type InitMessage = { type: "init"; key: string };
type MatchMessage = { type: "match"; id: number; bitmap: ImageBitmap; limit: number };
type Incoming = InitMessage | MatchMessage;

async function ensureModel(): Promise<void> {
  if (vision) return;
  const transformers = await import("@huggingface/transformers");
  transformers.env.allowLocalModels = false;
  vision = (await transformers.CLIPVisionModelWithProjection.from_pretrained("Xenova/mobileclip_s2", {
    dtype: "fp16",
    progress_callback: (report: { status?: string; progress?: number }) => {
      if (report?.status === "progress" && typeof report.progress === "number") {
        self.postMessage({ type: "progress", stage: "model", ratio: report.progress / 100 });
      }
    },
  })) as unknown as VisionModel;
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

/** The ingestion recipe, on this side of the thread boundary. */
function pixelsOf(bitmap: ImageBitmap): Float32Array {
  if (!canvas) canvas = new OffscreenCanvas(SIDE, SIDE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no offscreen 2d context");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // The bitmap arrives already cropped to the card region — `createImageBitmap`
  // on the main thread takes the source rectangle, so no framing decision is
  // repeated here and the two cannot drift apart.
  ctx.drawImage(bitmap, 0, 0, SIDE, SIDE);

  const { data } = ctx.getImageData(0, 0, SIDE, SIDE);
  const pixels = new Float32Array(3 * SIDE * SIDE);
  const plane = SIDE * SIDE;
  for (let i = 0; i < plane; i++) {
    const at = i * 4;
    pixels[i] = data[at] / 255;
    pixels[plane + i] = data[at + 1] / 255;
    pixels[2 * plane + i] = data[at + 2] / 255;
  }
  return pixels;
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
      self.postMessage({ type: "ready" });
      return;
    }

    if (message.type === "match") {
      await ensureModel();
      const started = performance.now();
      const pixels = pixelsOf(message.bitmap);
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
