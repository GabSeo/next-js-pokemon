"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { extractCardCodes, type CodeCandidate } from "@/lib/card-code-ocr";

/**
 * Photograph a card, read its code, hand it to the lookup.
 *
 * OCR RUNS IN THE BROWSER, and that is a cost decision rather than a technical
 * preference. GCP Vision's free tier is 1,000 units/month — about 33 scans a
 * day across every user — which cannot serve a free tier at all
 * (docs/free-tier-catalogue.md §4, GCP-CONTEXT.md §4.8). Tesseract runs on the
 * visitor's own machine, so the cost per scan is zero and capacity scales with
 * users instead of against them.
 *
 * THE ENGINE IS IMPORTED LAZILY, only once a photo exists. It is several MB of
 * wasm plus a trained-data download, and nobody should pay for that to read the
 * instructions or to type a code into the box below.
 *
 * FAILURE IS A DESIGNED STATE, NOT AN ERROR PATH. Every exit lands on the same
 * text field: no photo, an unreadable photo, a code that matches nothing, an
 * engine that will not load. The scan is a convenience over the keyboard, so a
 * bad read degrades to typing — which is why Phase 4 shipped first, and why
 * this component holds no matching logic of its own. It finds a string and
 * hands it to /lookup exactly as if it had been typed.
 */

/**
 * The bottom band of the photo, upscaled and flattened to hard grey.
 *
 * WHY NOT JUST READ THE WHOLE PHOTO, which is what this did first and why the
 * first real scan failed. Measured against an actual card on 2026-09-07: OCR of
 * the full image returned `"<4 VN 16000k g 7 = 4 - = \ Vg | | REN Ey"` — pure
 * noise from the artwork, with the code nowhere in it. The same photo cropped
 * to its bottom band returned `aOP09-1198H`, which contains OP09-119 exactly.
 *
 * The reason is proportion rather than resolution. A card code occupies roughly
 * 1% of a photo of a card, and an OCR engine handed the whole frame spends its
 * effort on the 99% that is illustration. Cropping to the band where the code
 * always sits changes what the engine is looking at, not how hard it looks.
 *
 * SEVERAL CROPS, NOT ONE, and that is measured rather than cautious. Swept
 * across five real cards on 2026-09-07, no single region won: a band at
 * 0.90–0.99 and a bottom-right box each read 3 of 5, the wider 0.86–1.0 band
 * read 1, and they did not succeed on the SAME cards. Alt arts bleed
 * illustration into the footer and a wide crop drowns the code in it; plain
 * cards carry a clean strip a wide crop reads easily. Trying a few in order and
 * stopping at the first real card costs a few hundred milliseconds and covers
 * more ground than any single choice.
 *
 * Grayscale and a hard contrast curve because the code is dark text over
 * artwork that is frequently neither dark nor light. Everything here runs in
 * the visitor's browser on a canvas, so it stays free.
 */
type Region = { top: number; left: number; width: number; height: number };

/** Ordered by measured hit rate. Fractions of the photo, not pixels. */
const REGIONS: Region[] = [
  { left: 0, top: 0.9, width: 1, height: 0.09 },
  { left: 0.55, top: 0.915, width: 0.45, height: 0.075 },
  { left: 0, top: 0.86, width: 1, height: 0.14 },
];

async function cropped(file: File, region: Region): Promise<HTMLCanvasElement | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const sx = Math.round(bitmap.width * region.left);
    const sy = Math.round(bitmap.height * region.top);
    const sw = Math.round(bitmap.width * region.width);
    const sh = Math.round(bitmap.height * region.height);

    // Upscale so the code is large enough for the engine to resolve, capped so
    // a 4000px phone photo does not produce a canvas nothing can hold.
    const scale = Math.min(4, Math.max(1, 1800 / sw));
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(2400, Math.round(sw * scale));
    canvas.height = Math.round(sh * (canvas.width / sw));

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const grey = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      // Push mid-tones apart so thin dark glyphs separate from busy artwork.
      const contrasted = Math.max(0, Math.min(255, (grey - 128) * 1.8 + 128));
      pixels[i] = pixels[i + 1] = pixels[i + 2] = contrasted;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  } catch {
    // No createImageBitmap, a canvas the browser will not give us, or an image
    // it cannot decode. The caller falls back to the untouched file.
    return undefined;
  }
}

/**
 * The photo, downscaled to something worth uploading.
 *
 * A phone photo is 2-6 MB and Vision reads a card code from a fraction of that.
 * Sending the original would cost the visitor seconds of mobile upload for no
 * extra accuracy. 1600px across is comfortably more detail than the code needs.
 *
 * The FULL frame, not a crop: the crops in REGIONS are tuned for Tesseract,
 * which needs the code isolated. Vision handles a whole card well and a wrong
 * crop would hide the very code we are asking it to find.
 */
async function uploadable(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * Ask the server to read the photo with Google Vision.
 *
 * Called ONLY when the on-device pass found nothing. Vision is capped at 1,000
 * units/month across the billing account, so spending one on a card the browser
 * already read would be paying for an answer we have.
 *
 * Every failure returns an empty list rather than throwing: not configured on
 * this deployment, budget exhausted, offline. The scan then behaves exactly as
 * it did before this existed, which is the point — Vision is an improvement on
 * the fallback path, never a dependency of it.
 */
async function readWithVision(file: File): Promise<CodeCandidate[]> {
  try {
    const image = await uploadable(file);
    const response = await fetch("/api/scan/ocr", {
      method: "POST",
      headers: { "Content-Type": image.type || "image/jpeg" },
      body: image,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { candidates?: CodeCandidate[] };
    return payload.candidates ?? [];
  } catch {
    return [];
  }
}

type Status =
  | { phase: "idle" }
  | { phase: "reading"; progress: number }
  | { phase: "escalating" }
  | { phase: "done"; candidates: CodeCandidate[] }
  | { phase: "failed"; reason: string };

export function ScanClient() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [preview, setPreview] = useState<string | undefined>();
  const [typed, setTyped] = useState("");
  const objectUrl = useRef<string | undefined>(undefined);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);
    setStatus({ phase: "reading", progress: 0 });

    try {
      // Lazy: the wasm bundle is only fetched once there is something to read.
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: (message: { status: string; progress: number }) => {
          if (message.status === "recognizing text") {
            setStatus({ phase: "reading", progress: Math.round(message.progress * 100) });
          }
        },
      });

      // Crops first, in measured order, stopping at the first that yields
      // anything. The whole photo is the last resort rather than the default —
      // it is what failed on the first real card, and it stays only because a
      // crop cannot help a photo framed some other way.
      let candidates: CodeCandidate[] = [];
      for (const region of REGIONS) {
        const canvas = await cropped(file, region);
        if (!canvas) continue;
        candidates = extractCardCodes((await worker.recognize(canvas)).data.text ?? "");
        if (candidates.length > 0) break;
      }
      if (candidates.length === 0) {
        candidates = extractCardCodes((await worker.recognize(file)).data.text ?? "");
      }
      await worker.terminate();

      // Nothing on the device. This is the only path that spends a Vision unit.
      if (candidates.length === 0) {
        setStatus({ phase: "escalating" });
        candidates = await readWithVision(file);
      }
      setStatus({ phase: "done", candidates });

      // One unambiguous read goes straight through. Anything else is a choice,
      // and a choice belongs to the person holding the card.
      if (candidates.length === 1) {
        router.push(`/lookup?q=${encodeURIComponent(candidates[0].value)}`);
      }
    } catch {
      setStatus({
        phase: "failed",
        reason: "The reader could not start. Type the code instead — it reaches the same place.",
      });
    }
  }

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-[320px_1fr]">
      <div>
        <label
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-black bg-muted-surface p-6 text-center"
          style={{ boxShadow: "3px 3px 0 0 #000" }}
        >
          <span className="text-2xl" aria-hidden>
            &#128247;
          </span>
          <span className="mt-2 text-sm font-black">Take a photo of the card</span>
          <span className="mt-1 text-[11px] text-muted-text">or choose one from your device</span>
          {/* `capture` asks a phone for its back camera and is ignored on
              desktop, where this stays an ordinary file picker. */}
          <input type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
        </label>

        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a local object URL for a file the visitor just chose; there is no remote asset to optimize */
          <img
            src={preview}
            alt="The card you photographed"
            className="mt-4 w-full rounded-lg border-2 border-black object-contain"
          />
        ) : null}
      </div>

      <div>
        {status.phase === "escalating" ? (
          <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm font-bold">
            Trying a stronger reader…
            <span className="mt-1 block text-xs font-normal text-muted-text">
              Your device could not find the code, so the photo is being read on the server.
            </span>
          </p>
        ) : null}

        {status.phase === "reading" ? (
          <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm font-bold">
            Reading the card… {status.progress}%
            <span className="mt-1 block text-xs font-normal text-muted-text">
              This happens on your device. Nothing is uploaded.
            </span>
          </p>
        ) : null}

        {status.phase === "failed" ? (
          <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm">{status.reason}</p>
        ) : null}

        {status.phase === "done" ? (
          status.candidates.length === 0 ? (
            <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm">
              No card code found in that photo. The code sits in a bottom corner — <b>OP05-119</b> on a One Piece
              card, <b>190/182</b> on a Pokémon one. Try again with that corner in frame, or type it below.
            </p>
          ) : (
            <>
              <p className="text-xs font-black uppercase tracking-wide text-muted-text">
                {status.candidates.length === 1 ? "Found" : "Which of these is on your card?"}
              </p>
              <ul className="mt-3 grid gap-2">
                {status.candidates.map((candidate) => (
                  <li key={candidate.value}>
                    <Link
                      href={`/lookup?q=${encodeURIComponent(candidate.value)}`}
                      className="flex items-baseline gap-3 rounded-lg border-2 border-black bg-white p-3 transition-transform hover:-translate-y-0.5"
                      style={{ boxShadow: "3px 3px 0 0 #000" }}
                    >
                      <span className="font-black">{candidate.value}</span>
                      <span className="text-xs text-muted-text">
                        {candidate.kind === "one-piece-code" ? "One Piece card code" : "Pokémon printed number"}
                        {candidate.raw !== candidate.value ? ` · read as ${candidate.raw}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : null}

        {/* Always present, at every stage. The scan is a convenience over the
            keyboard, and the keyboard never stops working. */}
        <form action="/lookup" method="get" className="mt-6">
          <label htmlFor="typed" className="text-xs font-black uppercase tracking-wide text-muted-text">
            Or type the code
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="typed"
              type="search"
              name="q"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="OP05-119 or 190/182"
              className="w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-sm font-bold"
              style={{ boxShadow: "3px 3px 0 0 #000" }}
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg border-2 border-black bg-muted-surface px-4 py-2 text-sm font-black"
              style={{ boxShadow: "3px 3px 0 0 #000" }}
            >
              Find
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
