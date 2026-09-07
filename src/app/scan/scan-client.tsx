"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import type { CodeCandidate } from "@/lib/card-code-ocr";
import type { CardView } from "@/lib/card-view";

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
 * ONE VIEW, NO NAVIGATION. A successful scan used to push straight to /lookup,
 * which threw away the photo, the context and the sense of one continuous
 * action — the page you were on vanished at the moment it succeeded.
 * Photographing a card and choosing which printing you own are two halves of
 * one gesture, so the results now appear beneath the photo and the collection
 * button sits on each printing. Nothing moves; the page only grows.
 *
 * FAILURE IS A DESIGNED STATE. No photo, an unreadable photo, no key on the
 * deployment, an exhausted budget — every exit lands on the same text field,
 * present at every stage, and says which of those happened instead of showing
 * an unexplained blank.
 */

type Status =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "done"; candidates: CodeCandidate[]; cards: CardView[]; note?: string };

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
 * The real cards behind a set of scanned codes, with every printing of each.
 *
 * Vision misreads glyphs, and a misread often lands on a code-SHAPED string
 * that is not a card, so this both filters and fetches: what survives is what
 * the catalogue recognises, and it comes back complete enough to render without
 * another request. Free route — it reads off disk.
 *
 * On any failure the candidates pass through unfiltered with no cards, so a
 * network blip shows the codes it read rather than claiming it read nothing.
 */
async function resolveCards(
  candidates: CodeCandidate[]
): Promise<{ candidates: CodeCandidate[]; cards: CardView[] }> {
  if (candidates.length === 0) return { candidates, cards: [] };
  try {
    const response = await fetch("/api/scan/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: candidates.map((c) => c.value) }),
    });
    if (!response.ok) return { candidates, cards: [] };
    const { real, cards } = (await response.json()) as { real?: string[]; cards?: CardView[] };
    if (!Array.isArray(real)) return { candidates, cards: cards ?? [] };
    return { candidates: candidates.filter((c) => real.includes(c.value)), cards: cards ?? [] };
  } catch {
    return { candidates, cards: [] };
  }
}

export function ScanClient() {
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
    let cards: CardView[] = [];
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
        const resolved = await resolveCards(payload.candidates ?? []);
        candidates = resolved.candidates;
        cards = resolved.cards;
      }
    } catch {
      note = "Could not reach the card reader. Check your connection, or type the code below.";
    }

    setStatus({ phase: "done", candidates, cards, note });
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
          status.cards.length === 0 && status.candidates.length === 0 ? (
            <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm">
              No card code found in that photo. The code sits in a bottom corner — <b>OP05-119</b> on a One Piece
              card, <b>190/182</b> on a Pokémon one. Try again with that corner in frame, or type it below.
              {status.note ? <span className="mt-2 block text-xs text-muted-text">{status.note}</span> : null}
            </p>
          ) : (
            <>
              <p className="text-xs font-black uppercase tracking-wide text-muted-text">
                {status.cards.length === 1 ? "Your card" : "Which of these is yours?"}
              </p>

              {/* THE PRINTINGS, not just the code. A code names a card; a card
                  is several printings and they are not worth the same — a
                  reverse holo is a median 3.4x its normal twin. Showing them
                  here is what lets someone finish in one place: read, recognise,
                  and record which one is actually in their hand. */}
              <div className="mt-3 grid gap-4">
                {status.cards.map((card) => (
                  <div
                    key={`${card.tcg}:${card.code}`}
                    className="rounded-lg border-2 border-black bg-white p-3"
                    style={{ boxShadow: "3px 3px 0 0 #000" }}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black">{card.name}</div>
                        <div className="text-[11px] text-muted-text">
                          {card.code} · {card.prints.length} printing{card.prints.length === 1 ? "" : "s"}
                        </div>
                      </div>
                      <Link
                        href={`/card/${card.tcg}/${encodeURIComponent(card.code)}`}
                        className="shrink-0 text-[11px] font-black underline underline-offset-4"
                      >
                        Full page
                      </Link>
                    </div>

                    <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {card.prints.map((print) => {
                        const cm = print.price?.cardmarket?.avg;
                        const tp = print.price?.tcgplayer?.market;
                        const money =
                          cm !== undefined
                            ? new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(cm)
                            : tp !== undefined
                              ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(tp)
                              : undefined;

                        return (
                          <li key={print.key} className="rounded-md border-2 border-black bg-muted-surface p-1.5">
                            {print.image ? (
                              /* eslint-disable-next-line @next/next/no-img-element -- both sources are pre-sized; see docs/free-tier-catalogue.md §7 */
                              <img
                                src={card.tcg === "onepiece" ? `${print.image}&w=320` : print.image}
                                alt={print.origin}
                                loading="lazy"
                                className="aspect-[300/420] w-full rounded object-contain"
                              />
                            ) : (
                              <div className="aspect-[300/420] w-full rounded" />
                            )}
                            <div className="mt-1 truncate text-[11px] font-black" title={print.label ?? print.origin}>
                              {print.label ?? print.origin}
                            </div>
                            <div className="text-[11px] text-muted-text">{money ?? "No price"}</div>
                            <div className="mt-1.5">
                              <AddToCollectionButton
                                tcg={card.tcg}
                                code={card.code}
                                printKey={print.key}
                                size="sm"
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>

              {/* The codes are still worth showing when they did not all resolve
                  to a card — it is the difference between "unreadable" and
                  "read, but not in our catalogue". */}
              {status.cards.length === 0 && status.candidates.length > 0 ? (
                <p className="mt-3 rounded-lg border-2 border-black bg-muted-surface p-3 text-sm">
                  Read {status.candidates.map((c) => c.value).join(", ")}, but no card in the catalogue matches.
                </p>
              ) : null}
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
