import { CLIP_DIM, clipIndexFrom, clipSearch, type ClipIndex, type ClipResult } from "@/lib/clip-search";

/**
 * Identify a card from a picture, entirely in the browser.
 *
 * WHAT THIS REPLACES. The scan currently posts a photograph to Google Vision,
 * reads the printed number out of the text, and asks the catalogue which cards
 * carry that number — a metered call on the critical path, and a number that
 * names more than one card 53% of the time. This looks at the artwork instead,
 * on the device, against 41,500 reference vectors, and spends nothing.
 *
 * THE PREPROCESSING IS THE CONTRACT. These four steps must match
 * scripts/pokemon-clip-embed.mts exactly or every comparison is meaningless:
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
 *
 * EVERYTHING IS LOADED ONCE AND LAZILY. The model is 68 MB and the index 10 MB
 * per language; neither is touched until something actually asks for a match,
 * and both are cached by the browser afterwards.
 */

const SIDE = 256;

export type ClipLanguage = "en" | "ja";

export type ClipProgress = {
  /** `model` while weights download, `index` while vectors do, `ready` after. */
  stage: "model" | "index" | "ready";
  /** 0..1 where the underlying loader reports it, otherwise undefined. */
  ratio?: number;
};

type VisionModel = (input: { pixel_values: unknown }) => Promise<{ image_embeds: { data: Float32Array } }>;

let modelPromise: Promise<{ vision: VisionModel; Tensor: new (t: string, d: Float32Array, dims: number[]) => unknown }> | undefined;
const indexPromises = new Map<ClipLanguage, Promise<ClipIndex>>();

/**
 * The model, downloaded once per browser.
 *
 * `@huggingface/transformers` is imported dynamically so that 68 MB of ONNX
 * runtime plumbing is not in the bundle of every page that merely links to the
 * scanner. `allowLocalModels` is off because there is no local model directory
 * on a CDN deployment, and leaving it on makes the library probe for one and
 * log a failure before falling back.
 */
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

/** One language's vectors, downloaded once per browser and cached immutably by the route. */
async function loadIndex(language: ClipLanguage): Promise<ClipIndex> {
  let held = indexPromises.get(language);
  if (!held) {
    held = (async () => {
      const [manifest, blob] = await Promise.all([
        fetch(`/api/scan/index/${language}.json`).then((r) => {
          if (!r.ok) throw new Error(`index manifest ${r.status}`);
          return r.json() as Promise<{ ids?: string[] }>;
        }),
        fetch(`/api/scan/index/${language}.i8`).then((r) => {
          if (!r.ok) throw new Error(`index vectors ${r.status}`);
          return r.arrayBuffer();
        }),
      ]);
      return clipIndexFrom(manifest, blob);
    })().catch((error) => {
      indexPromises.delete(language);
      throw error;
    });
    indexPromises.set(language, held);
  }
  return held;
}

/**
 * Pixels from anything paintable — a File, a video frame, a canvas.
 *
 * `drawImage` with explicit width and height STRETCHES to fill, which is what
 * `fit: "fill"` does on the ingestion side. Cropping to preserve the aspect
 * ratio here would be a different transform and would put the query in a
 * different space from the references.
 */
function pixelsOf(source: CanvasImageSource, width: number, height: number): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser did not give us a 2D canvas");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height, 0, 0, SIDE, SIDE);

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

export type ClipMatch = ClipResult & {
  /** Milliseconds spent embedding and searching, once everything is loaded. */
  elapsed: number;
};

/**
 * Embed one image and search one language's index.
 *
 * ONE LANGUAGE, NEVER BOTH — the same rule the OCR path follows, for the same
 * measured reason: an English card and its Japanese release share artwork
 * exactly, so searching both returns two answers for one card and forces the
 * reader to break the tie with information the picture does not contain.
 */
export async function matchCard(
  source: CanvasImageSource,
  size: { width: number; height: number },
  language: ClipLanguage,
  options?: { limit?: number; onProgress?: (p: ClipProgress) => void }
): Promise<ClipMatch> {
  const { onProgress } = options ?? {};

  const [{ vision, Tensor }, index] = await Promise.all([
    loadModel(onProgress),
    (async () => {
      onProgress?.({ stage: "index" });
      return loadIndex(language);
    })(),
  ]);
  onProgress?.({ stage: "ready" });

  const started = performance.now();
  const pixels = pixelsOf(source, size.width, size.height);
  const output = await vision({ pixel_values: new Tensor("float32", pixels, [1, 3, SIDE, SIDE]) });
  const query = normalise(output.image_embeds.data);
  if (query.length !== CLIP_DIM) throw new Error(`model returned ${query.length} dimensions, expected ${CLIP_DIM}`);

  const result = clipSearch(index, query, options?.limit ?? 5);
  return { ...result, elapsed: performance.now() - started };
}

/** Decode a File into something `matchCard` can paint, and report its size. */
export async function bitmapOf(file: Blob): Promise<{ source: ImageBitmap; width: number; height: number }> {
  const source = await createImageBitmap(file);
  return { source, width: source.width, height: source.height };
}

/** Warm the model and one index before the user takes a picture. */
export async function prepareMatcher(language: ClipLanguage, onProgress?: (p: ClipProgress) => void): Promise<void> {
  await Promise.all([loadModel(onProgress), loadIndex(language)]);
  onProgress?.({ stage: "ready" });
}
