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

type Status =
  | { phase: "idle" }
  | { phase: "reading"; progress: number }
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

      const { data } = await worker.recognize(file);
      await worker.terminate();

      const candidates = extractCardCodes(data.text ?? "");
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
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-black bg-accent-surface p-6 text-center"
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
                      className="flex items-baseline gap-3 rounded-lg border-2 border-black bg-surface p-3 transition-transform hover:-translate-y-0.5"
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
              className="w-full rounded-lg border-2 border-black bg-surface px-3 py-2 text-sm font-bold"
              style={{ boxShadow: "3px 3px 0 0 #000" }}
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg border-2 border-black bg-accent-surface px-4 py-2 text-sm font-black"
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
