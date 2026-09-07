"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { CodeCandidate } from "@/lib/card-code-ocr";

/**
 * Photograph a card, read its code, hand it to the lookup.
 *
 * ONE READER, NOT TWO. This ran Tesseract in the browser first and called Cloud
 * Vision only when that failed. The second engine existed to protect Vision's
 * 1,000 units/month — and at this project's real scale, roughly 150 scans in
 * total, there is no quota to protect. So the fallback bought nothing and cost
 * a multi-megabyte wasm download on every visit, three hand-tuned crop regions,
 * a preprocessing pass, and two code paths to reason about whenever a scan went
 * wrong.
 *
 * Removing it also removed the failure that prompted all of it: on a real photo
 * Tesseract returned two code-shaped strings that were not cards, the scan
 * counted that as success, and it never escalated. Fewer engines, fewer ways to
 * be confidently wrong.
 *
 * WHAT SURVIVES FROM THAT WORK, because none of it was engine-specific:
 * `lib/card-code-ocr.ts` still extracts the code from whatever text comes back,
 * repairing the digit/letter confusions every OCR makes and trimming the stray
 * glyph that gets welded onto a code read off artwork. And `/api/scan/resolve`
 * still asks the catalogue whether a candidate is a real card before it is
 * shown. Vision is better; it is not infallible.
 *
 * THE PHOTO IS DOWNSCALED BEFORE UPLOAD. A phone photo is 2–6 MB and a card
 * code needs a fraction of that, so sending the original costs seconds of
 * mobile upload for no extra accuracy.
 *
 * FAILURE IS A DESIGNED STATE. No photo, an unreadable photo, no key on the
 * deployment, an exhausted budget — every exit lands on the same text field,
 * present at every stage, and says which of those happened instead of showing
 * an unexplained blank.
 */

type Status =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "done"; candidates: CodeCandidate[]; note?: string };

/** Long edge in pixels. Comfortably more detail than a card code needs. */
const UPLOAD_MAX_EDGE = 1600;

async function uploadable(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
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
    // A format this browser will not decode, or no canvas available. Send the
    // original: Vision reads more formats than createImageBitmap does.
    return file;
  }
}

/**
 * Which candidates the catalogue recognises as real cards.
 *
 * Vision misreads glyphs too, and a misread often lands on a code-SHAPED string
 * that is not a card. Free route — it reads the catalogue off disk and spends
 * nothing.
 *
 * Returns the input unchanged on any failure, so a network blip cannot make a
 * real card look unreal.
 */
async function keepReal(candidates: CodeCandidate[]): Promise<CodeCandidate[]> {
  if (candidates.length === 0) return candidates;
  try {
    const response = await fetch("/api/scan/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: candidates.map((c) => c.value) }),
    });
    if (!response.ok) return candidates;
    const { real } = (await response.json()) as { real?: string[] };
    if (!Array.isArray(real)) return candidates;
    return candidates.filter((c) => real.includes(c.value));
  } catch {
    return candidates;
  }
}

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
    setStatus({ phase: "reading" });

    let candidates: CodeCandidate[] = [];
    let note: string | undefined;

    try {
      const image = await uploadable(file);
      const response = await fetch("/api/scan/ocr", {
        method: "POST",
        headers: { "Content-Type": image.type || "image/jpeg" },
        body: image,
      });

      if (response.status === 501) {
        note = "The card reader is not configured on this deployment.";
      } else if (!response.ok) {
        const { error } = (await response.json().catch(() => ({}))) as { error?: string };
        note = `The card reader failed: ${error ?? response.status}`;
      } else {
        const payload = (await response.json()) as { candidates?: CodeCandidate[] };
        candidates = await keepReal(payload.candidates ?? []);
      }
    } catch {
      note = "Could not reach the card reader. Check your connection, or type the code below.";
    }

    setStatus({ phase: "done", candidates, note });

    // One unambiguous read goes straight through. Anything else is a choice,
    // and a choice belongs to the person holding the card.
    if (candidates.length === 1) {
      router.push(`/lookup?q=${encodeURIComponent(candidates[0].value)}`);
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
        {status.phase === "reading" ? (
          <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm font-bold">
            Reading the card…
            <span className="mt-1 block text-xs font-normal text-muted-text">
              The photo is sent once, read, and not stored.
            </span>
          </p>
        ) : null}

        {status.phase === "done" ? (
          status.candidates.length === 0 ? (
            <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm">
              No card code found in that photo. The code sits in a bottom corner — <b>OP05-119</b> on a One Piece
              card, <b>190/182</b> on a Pokémon one. Try again with that corner in frame, or type it below.
              {status.note ? <span className="mt-2 block text-xs text-muted-text">{status.note}</span> : null}
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
