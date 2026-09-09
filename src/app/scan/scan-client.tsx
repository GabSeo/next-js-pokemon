"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import type { CodeCandidate } from "@/lib/card-code-ocr";
import type { CardView } from "@/lib/card-view";
import { bitmapOf, matchCard, type ClipLanguage } from "@/lib/clip-client";
import { CLIP_MAX_TIED, clipTied } from "@/lib/clip-search";
import { onePieceSrc } from "@/lib/one-piece-image-url";

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

/**
 * How the card was identified, which the reader deserves to be told.
 *
 * `artwork` never left the device and cost nothing. `text` went to Google
 * Vision. They are different promises about privacy and about what could go
 * wrong, so they are not collapsed into one "scanned" state.
 */
type Route =
  | { via: "artwork"; margin: number; elapsed: number }
  /** Several cards share one artwork and no photograph can separate them. */
  | { via: "artwork-tie"; tied: number; elapsed: number }
  | { via: "text" };

type Status =
  | { phase: "idle" }
  | { phase: "matching" }
  | { phase: "reading" }
  | { phase: "done"; candidates: CodeCandidate[]; cards: CardView[]; note?: string; route?: Route };

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
 * Ask the artwork matcher, on this device.
 *
 * A TIE IS AN ANSWER, NOT A FAILURE — this is the correction that matters here.
 * The first version refused whenever the margin was small and escalated to the
 * server-side reader. Measured afterwards: 28% of Japanese cards and 4% of
 * English ones have a near-twin inside that margin, because a reprint carries
 * the SAME artwork under a new number. `SM12a-052` is `SM11-029` unchanged, and
 * that card's own official scan ranks the other one first by 0.0015.
 *
 * Escalating there was doubly wrong. It threw away a correct result for having
 * a companion — and it escalated to something the live camera view will not
 * have, because the printed-number reader is a metered per-image API call that
 * cannot run thirty times a second.
 *
 * So: one candidate is an answer, two or three are an answer with a question,
 * and only a diffuse spread falls through.
 */
async function matchLocally(
  file: File,
  language: ClipLanguage
): Promise<{ cards: CardView[]; route: Route } | undefined> {
  const { source, width, height } = await bitmapOf(file);
  try {
    // More hits than we can show, so "everything I asked for is tied" is
    // distinguishable from "three things are tied".
    const result = await matchCard(source, { width, height }, language, { limit: 8 });
    const tied = clipTied(result);
    if (tied.length === 0 || tied.length > CLIP_MAX_TIED) return undefined;

    // The matcher decided WHICH cards; the resolver only fetches them. The
    // Japanese catalogue is addressed with a `ja~` prefix, the same qualifier
    // every other link on the site uses.
    const ids = tied.map((hit) => (language === "ja" ? `ja~${hit.id}` : hit.id));
    const response = await fetch("/api/scan/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) return undefined;

    const { cards } = (await response.json()) as { cards?: CardView[] };
    if (!cards || cards.length === 0) return undefined;

    return {
      cards,
      route:
        cards.length === 1
          ? { via: "artwork", margin: result.margin, elapsed: result.elapsed }
          : { via: "artwork-tie", tied: cards.length, elapsed: result.elapsed },
    };
  } finally {
    source.close();
  }
}

export function ScanClient() {
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [preview, setPreview] = useState<string | undefined>();
  const [typed, setTyped] = useState("");
  /**
   * ONE LANGUAGE, NEVER BOTH. An English card and its Japanese release share
   * artwork exactly, so a search across both returns two answers for one card
   * and asks the reader to break a tie the picture cannot break.
   */
  const [language, setLanguage] = useState<ClipLanguage>("en");
  const objectUrl = useRef<string | undefined>(undefined);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);

    // THE ARTWORK FIRST, ON THE DEVICE. It costs no quota, sends no photograph
    // anywhere, and answers in milliseconds once the model is warm. Cloud
    // Vision is now the fallback rather than the first move — which is the
    // whole point of shipping the index to the client.
    setStatus({ phase: "matching" });
    try {
      const local = await matchLocally(file, language);
      if (local) {
        setStatus({ phase: "done", candidates: [], cards: local.cards, route: local.route });
        return;
      }
    } catch {
      // No WebGPU, a failed model download, an image this browser will not
      // decode. None of that should cost the visitor their scan — fall through
      // to the reader that runs on a server.
    }

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
        // The reader returns the cards already resolved and their printings
        // already ordered by how much each looks like the photo — one upload,
        // one response, no second round trip.
        const payload = (await response.json()) as { candidates?: CodeCandidate[]; cards?: CardView[] };
        candidates = payload.candidates ?? [];
        cards = payload.cards ?? [];
      }
    } catch {
      note = "Could not reach the card reader. Check your connection, or type the code below.";
    }

    setStatus({ phase: "done", candidates, cards, note, route: { via: "text" } });
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

        {/* WHICH CATALOGUE TO SEARCH, asked rather than guessed. The artwork
            matcher has no text to infer a language from — an English card and
            its Japanese release are the same picture — so this is the one thing
            it needs from the reader and cannot work out for itself. */}
        <fieldset className="mt-3 rounded-lg border-2 border-black bg-white p-2">
          <legend className="px-1 text-[10px] font-black uppercase tracking-wide text-muted-text">
            Card language
          </legend>
          <div className="flex gap-1">
            {(
              [
                ["en", "English"],
                ["ja", "Japanese"],
              ] as const
            ).map(([value, name]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLanguage(value)}
                aria-pressed={language === value}
                className={`flex-1 rounded border-2 border-black px-2 py-1.5 text-xs font-black transition-colors ${
                  language === value ? "bg-black text-white" : "bg-muted-surface hover:bg-white"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>

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
        {status.phase === "matching" ? (
          <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm font-bold">
            Looking at the artwork…
            <span className="mt-1 block text-xs font-normal text-muted-text">
              This runs on your device and the photo does not leave it. The first card of a session also
              downloads the matcher, which takes a moment; every one after is instant.
            </span>
          </p>
        ) : null}

        {status.phase === "reading" ? (
          <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm font-bold">
            Reading the card…
            <span className="mt-1 block text-xs font-normal text-muted-text">
              The artwork was not a clear enough match, so the printed number is being read instead. The
              photo is sent once, read, and not stored.
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

              {/* WHY THERE ARE TWO, said out loud. Without this the screen
                  reads as the scanner hedging. It is not hedging: these cards
                  carry the identical picture, so nothing a camera can see will
                  ever separate them, and the number in the corner is the only
                  thing that does. Telling someone what to look at beats
                  apologising for not knowing. */}
              {status.route?.via === "artwork-tie" ? (
                <p className="mt-1 text-[11px] text-muted-text">
                  These {status.route.tied} cards share the same artwork — one is a reprint of the other. Check
                  the number in the bottom corner of your card to tell them apart. Matched on your device in{" "}
                  {Math.round(status.route.elapsed)} ms; the photo was not uploaded.
                </p>
              ) : null}

              {/* HOW IT WAS FOUND, said plainly. One route kept the photo on the
                  device and one sent it to Google — that difference belongs to
                  the person who took the picture, not in a log. */}
              {status.route?.via === "artwork" ? (
                <p className="mt-1 text-[11px] text-muted-text">
                  Matched by artwork on your device in {Math.round(status.route.elapsed)} ms · margin{" "}
                  {status.route.margin.toFixed(3)} · the photo was not uploaded
                </p>
              ) : null}

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
                          {/* THE SET, not just the code. `print.origin` carries
                              it but only renders when a printing has no variant
                              name, which for Pokemon is never — so two cards
                              tied on identical artwork showed as two identical
                              lines, and the set is the thing that tells them
                              apart. */}
                          {card.prints[0]?.origin ? `${card.prints[0].origin} · ` : ""}
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

                    {/* THE MATCH, ALONE. The grid used to show every printing
                        ranked best-first, which asked the reader to re-do the
                        comparison the ranking had already made. When the top
                        match is right — and on real cards it is — the other six
                        are noise between the person and the button they want.

                        The rest stay one tap away rather than deleted, because
                        the ranking is a best guess and the honest recovery from
                        a wrong guess is "show me the others", not "start the
                        scan again". `details` because that needs no state and
                        works before hydration. */}
                    <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {card.prints.slice(0, 1).map((print, index) => {
                        const cm = print.price?.cardmarket?.avg;
                        const tp = print.price?.tcgplayer?.market;
                        const money =
                          cm !== undefined
                            ? new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(cm)
                            : tp !== undefined
                              ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(tp)
                              : undefined;

                        return (
                          <li
                            key={print.key}
                            className={`rounded-md border-2 p-1.5 ${
                              index === 0 && card.tcg === "onepiece" && card.prints.length > 1
                                ? "border-black bg-white"
                                : "border-black bg-muted-surface"
                            }`}
                          >
                            {print.image ? (
                              /* eslint-disable-next-line @next/next/no-img-element -- both sources are pre-sized; see docs/free-tier-catalogue.md §7 */
                              <img
                                src={card.tcg === "onepiece" ? onePieceSrc(print.image, 320) : print.image}
                                alt={print.origin}
                                loading="lazy"
                                className="aspect-[300/420] w-full rounded object-contain"
                              />
                            ) : (
                              <div className="aspect-[300/420] w-full rounded" />
                            )}
                            <div className="mt-1 truncate text-[11px] font-black" title={print.label ?? print.origin}>
                              {index === 0 && card.tcg === "onepiece" && card.prints.length > 1 ? "★ " : ""}
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

                    {card.prints.length > 1 ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-[11px] font-black underline underline-offset-4">
                          Not this one? Show the other {card.prints.length - 1} printing
                          {card.prints.length - 1 === 1 ? "" : "s"}
                        </summary>
                        <p className="mt-2 text-[11px] text-muted-text">
                          Ordered by how much each looks like your photo. Bandai gives every printing the same name,
                          so the picture is the only difference between them.
                        </p>
                        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {card.prints.slice(1).map((print) => (
                            <li key={print.key} className="rounded-md border-2 border-black bg-muted-surface p-1.5">
                              {print.image ? (
                                /* eslint-disable-next-line @next/next/no-img-element -- both sources are pre-sized; see docs/free-tier-catalogue.md §7 */
                                <img
                                  src={card.tcg === "onepiece" ? onePieceSrc(print.image, 320) : print.image}
                                  alt={print.origin}
                                  loading="lazy"
                                  className="aspect-[300/420] w-full rounded object-contain"
                                />
                              ) : (
                                <div className="aspect-[300/420] w-full rounded" />
                              )}
                              <div className="mt-1 truncate text-[11px] font-black">{print.label ?? print.origin}</div>
                              <div className="mt-1.5">
                                <AddToCollectionButton
                                  tcg={card.tcg}
                                  code={card.code}
                                  printKey={print.key}
                                  size="sm"
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
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
