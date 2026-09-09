import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Hand the MobileCLIP index to the browser, so the match happens on the phone.
 *
 * WHY THE CLIENT AND NOT HERE. The model is 68 MB of ONNX weights. On Vercel
 * that is re-downloaded on every cold start of a serverless function, which
 * puts an unpredictable multi-second penalty in front of a feature whose entire
 * proposition is speed. In a browser it is fetched once and cached by the
 * browser, and after that the match costs a network round trip of zero.
 *
 * That is also where this has to end up regardless: the goal is a live video
 * feed, and a video feed cannot post every frame to a server.
 *
 * WHY IT IS SAFE TO SHIP. Measured (scripts/clip-resample-lab.mts): the index
 * was built with sharp's cubic resampling and a browser has only canvas, whose
 * scaling is implementation-defined. Embedding the same photographs with cubic,
 * mitchell, lanczos3 and even nearest gives IDENTICAL identifications, with
 * margins agreeing to within 0.003. So the client can resize however it likes
 * and still be comparing like with like.
 *
 * TWO FILES, NOT ONE. `<lang>.json` is the ids, `<lang>.i8` is the vectors.
 * 20 MB of numbers as JSON would be ~120 MB and parse in seconds; as a typed
 * array it is one allocation. They are versioned together — a manifest whose id
 * count disagrees with the blob length is a truncated download, and
 * `clipIndexFrom` refuses it rather than misaligning every id.
 *
 * FREE ROUTE. Reads two files and returns them. No client, no quota, nothing
 * for scripts/check-free-tier.mts to object to.
 */

export const runtime = "nodejs";

/**
 * The index changes only when the catalogue is re-embedded, which is a deploy.
 * A year is the honest cache lifetime, and a deploy changes the bytes rather
 * than the URL — so `must-revalidate` is deliberately absent and the client is
 * told to check the ETag instead.
 */
export const revalidate = 31536000;

const DIR = path.join(process.cwd(), "data", "catalog", "pokemon-clip");

/** Exactly what may be served. A path segment is not a filename until it is on this list. */
const ALLOWED = new Set(["en.json", "en.i8", "ja.json", "ja.i8"]);

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;

  // AN ALLOWLIST, NOT A SANITISER. This segment reaches the filesystem, and the
  // set of things worth serving is four strings — so naming them is both the
  // simplest implementation and the one with no traversal to reason about.
  if (!ALLOWED.has(file)) {
    return Response.json({ error: "No such index" }, { status: 404 });
  }

  const full = path.join(DIR, file);
  if (!existsSync(full)) {
    return Response.json(
      { error: `${file} has not been built — run npm run catalog:pokemon-clip` },
      { status: 503 }
    );
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(full);
  } catch {
    return Response.json({ error: "Index unreadable" }, { status: 500 });
  }

  // Weak, because the length alone identifies a rebuild well enough to save a
  // 10 MB transfer and nothing here depends on byte-exact revalidation.
  const etag = `W/"${file}-${bytes.length}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.endsWith(".json") ? "application/json" : "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
    },
  });
}
