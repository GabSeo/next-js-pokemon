"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import type { CodeCandidate } from "@/lib/card-code-ocr";
import type { CardView } from "@/lib/card-view";
import { ALL_INDEXES, bitmapOf, clipHitGame, clipHitId, matchCard } from "@/lib/clip-client";
import { CLIP_MAX_TIED, clipTied, clipVerdict } from "@/lib/clip-search";
import { LiveScanner } from "@/app/scan/live-scanner";
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
  | { via: "text" }
  /**
   * The number could not be read, so these cards were found by NAME alone.
   *
   * A separate route rather than a flag on `text`, because it is a different
   * promise: a resolved number names the card, a name names an arbitrary few of
   * however many share it — 166 cards are called Pikachu. Presenting the two
   * identically is what made six wrong Pikachus look like an answer.
   */
  | { via: "name" };

type Status =
  | { phase: "idle" }
  | { phase: "matching" }
  | { phase: "reading" }
  | { phase: "done"; candidates: CodeCandidate[]; cards: CardView[]; note?: string; route?: Route };

/** Long edge in pixels. Comfortably more detail than a card code needs. */
const UPLOAD_MAX_EDGE = 1600;

/**
 * How many artwork candidates are worth putting in front of someone.
 *
 * Not a confidence threshold — `CLIP_MAX_TIED` is that, and it is deliberately
 * three. This is a LAYOUT limit: the comparison grid wraps to two columns on a
 * phone, so six is three rows and still scannable, where the full eight the
 * matcher returns is a wall.
 */
const SHORTLIST = 6;

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
 * A TIE IS AN ANSWER — AND ON A PHOTO IT IS STILL THE SECOND-BEST ONE.
 *
 * The first version escalated to the server reader whenever the margin was
 * small. That was wrong on its own terms: measured, 28% of Japanese cards and
 * 4% of English ones have a near-twin inside that margin, because a reprint
 * carries the SAME artwork under a new number — `SM12a-052` is `SM11-029`
 * unchanged, and that card's own official scan ranks the other one first by
 * 0.0015. Refusing there threw away a correct result for having a companion.
 *
 * THE CORRECTION OVERSHOT. Treating every tie as a finished answer removed the
 * escalation entirely, and with it Cloud Vision — so a photograph whose artwork
 * match was merely a guess got a confident-looking card list and the printed
 * number was never read. Reported as "take a photo isn't working like before",
 * and it is the same bug seen from the front.
 *
 * The argument for removing it does not transfer from the live view to a photo.
 * Vision is a metered per-image call that cannot run thirty times a second —
 * true, and the reason the camera loop has no reader. A photo is ONE image, on
 * purpose, at a moment a person chose. It can afford the call.
 *
 * So the split is by CONFIDENCE, not by tie:
 *
 *   identified   one card, clear of the floor and the margin -> answer, no call
 *   tie / unsure -> read the printed number, and keep the artwork as the
 *                   fallback if the reader comes back with nothing
 *
 * `clipVerdict` rather than `clipTied` alone is the load-bearing half. `clipTied`
 * filters on the MARGIN only; it has no score floor, so a photograph the matcher
 * could not place at all still produced one to three near-tied cards and looked
 * exactly like a reprint. See CLIP_CARD_FLOOR for why a margin cannot do this
 * job on its own.
 */
async function matchLocally(
  file: File
): Promise<{ cards: CardView[]; route: Route; confident: boolean } | undefined> {
  const { source, width, height } = await bitmapOf(file);
  try {
    // More hits than we can show, so "everything I asked for is tied" is
    // distinguishable from "three things are tied".
    // THE WHOLE PICTURE for an uploaded photo — the person framed it when they
    // took it. The live view crops to a guide instead, because a camera frame
    // is mostly room.
    const result = await matchCard(source, { x: 0, y: 0, width, height }, ALL_INDEXES, { limit: 8 });
    const verdict = clipVerdict(result);
    // Nothing card-like in the picture at all. No list is worth showing and the
    // reader will not find a code either, but it is allowed to try.
    if (verdict === "empty") return undefined;

    // TWO DIFFERENT QUESTIONS, AND THEY USED TO SHARE ONE ANSWER.
    //
    //   how confident is this?   -> `tied`, capped at CLIP_MAX_TIED
    //   what should I show?      -> `shortlist`, up to SHORTLIST
    //
    // A spread of eight near-ties means the matcher cannot name the card, and
    // it used to mean the whole local match was discarded — so a photograph
    // with eight plausible readings showed nothing at all while one with three
    // showed three. That was the confidence rule deciding the display, and once
    // the search covers four catalogues it fires far more often: the Galarian
    // Gallery photo on file ties EIGHT ways at a margin of 0.0004.
    //
    // The confidence rule is unchanged and still gates the short-circuit past
    // the printed-number reader. What changes is that a diffuse spread is now
    // kept as a shortlist for after the reader has had its turn, instead of
    // being thrown away before it.
    const tied = clipTied(result);
    if (tied.length === 0) return undefined;
    const shortlist = tied.slice(0, SHORTLIST);

    // The matcher decided WHICH cards; the resolver only fetches them.
    //
    // EACH HIT CARRIES ITS OWN CATALOGUE, which is what lets one result list
    // hold a Pokemon card and a One Piece card at once. `clipHitId` applies the
    // `ja~` qualifier where it is needed and `clipHitGame` says which lookup to
    // use — both are the matcher's knowledge, not a guess made here.
    const response = await fetch("/api/scan/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: shortlist.map(clipHitId), games: shortlist.map(clipHitGame) }),
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
      // Only an `identified` single card ends the scan here. Everything else is
      // held as the fallback while the printed number gets its turn — including
      // the diffuse spread, which is a shortlist rather than an answer.
      confident: verdict === "identified" && tied.length <= CLIP_MAX_TIED && cards.length === 1,
    };
  } finally {
    source.close();
  }
}

/**
 * The chooser for cards that share one artwork.
 *
 * WHY IT IS NOT THE NORMAL RESULT LIST. That list is a reading layout — one
 * full-width block per card, its printings below, priced and expandable. It is
 * right for an answer and wrong for a question: stacked, it turns two identical
 * Mewtwos into two screens of scrolling, and seeing them at the same time is
 * the entire task.
 *
 * So this is a comparison instead: equal tiles, side by side, in one window.
 * What DIFFERS between the candidates is on the tile; what does not — prices,
 * other printings, the full breakdown — is one tap away rather than doubling
 * the height of a choice.
 *
 * THE NUMBER GETS THE EMPHASIS, because it is the only thing that separates
 * them. The pictures are identical by definition and the names usually are too,
 * so the number printed in the card's bottom corner is the answer, and it is
 * what the line above sends the reader to go and look at.
 */
function TiedCards({ cards }: { cards: CardView[] }) {
  return (
    <ul
      className="mt-3 grid gap-3"
      style={{
        // AUTO-FILL WITH A FLOOR, not a fixed track count. A count-based grid
        // puts three tiles side by side on a phone at 110px each, which is too
        // small to compare two pictures — the one thing this view is for. This
        // fits as many 150px tracks as there is room for, so a phone wraps to
        // two and the third goes below.
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        // And a ceiling, so two candidates on a wide screen become two
        // readable tiles rather than two enormous ones.
        maxWidth: `${Math.min(cards.length, 3) * 230}px`,
      }}
    >
      {cards.map((card) => {
        const print = card.prints[0];
        // `ja~SM12a-052` -> `052`, which is what is printed on the card.
        const number = card.code.slice(card.code.lastIndexOf("-") + 1);

        return (
          <li
            key={`${card.tcg}:${card.code}`}
            className="flex flex-col rounded-lg border-2 border-black bg-white p-2.5"
            style={{ boxShadow: "3px 3px 0 0 #000" }}
          >
            {print?.image ? (
              /* eslint-disable-next-line @next/next/no-img-element -- both sources are pre-sized; see docs/free-tier-catalogue.md §7 */
              <img
                src={card.tcg === "onepiece" ? onePieceSrc(print.image, 320) : print.image}
                alt={card.name}
                loading="lazy"
                className="aspect-[300/420] w-full rounded object-contain"
              />
            ) : (
              <div className="flex aspect-[300/420] w-full items-center justify-center rounded bg-muted-surface p-2 text-center text-[10px] text-muted-text">
                No picture published
              </div>
            )}

            <div className="mt-2 flex items-baseline gap-2">
              <span className="shrink-0 rounded border-2 border-black bg-pokemon-yellow px-1.5 py-0.5 text-[13px] font-black tabular-nums text-black">
                {number}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-black" title={card.name}>
                {card.name}
              </span>
            </div>

            <div className="mt-0.5 truncate text-[11px] text-muted-text" title={print?.origin}>
              {print?.origin ?? card.code}
            </div>

            <div className="mt-auto pt-2.5">
              {print ? (
                <AddToCollectionButton tcg={card.tcg} code={card.code} printKey={print.key} size="sm" />
              ) : null}
              <Link
                href={`/card/${card.tcg}/${encodeURIComponent(card.code)}`}
                className="mt-1.5 block text-[11px] font-black underline underline-offset-4"
              >
                Full page
                {card.prints.length > 1 ? ` · ${card.prints.length} printings` : ""}
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ScanClient() {
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [preview, setPreview] = useState<string | undefined>();
  const [typed, setTyped] = useState("");
  /**
   * WHAT WAS ASKED HERE, AND IS NOT ANY MORE.
   *
   * Two pieces of state stood here: `language` and `game`. Both were honest —
   * an English card and its Japanese release share artwork exactly, and nothing
   * in a picture says which game it is; when One Piece had no index a
   * photographed Luffy came back a Koffing. Both are gone because the matcher
   * now searches every catalogue and reports which one answered, so the
   * question is the machine's again.
   *
   * The ambiguity they were hiding has not been solved. It has been SHOWN: an
   * English card and its Japanese twin both come back, as candidates, exactly
   * the way two reprints of one artwork do. The picture cannot separate them
   * and never could — putting that behind a toggle only moved the guess onto
   * the person.
   */

  const [live, setLive] = useState(false);
  const objectUrl = useRef<string | undefined>(undefined);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);

    // THE ARTWORK FIRST, ON THE DEVICE, FOR BOTH GAMES NOW. It costs no quota,
    // sends no photograph anywhere, and answers in milliseconds once the model
    // is warm. Cloud Vision is the fallback for a picture the artwork cannot
    // place, not the first move.
    setStatus({ phase: "matching" });
    /**
     * The artwork's answer when it was NOT confident enough to end the scan.
     *
     * Kept rather than discarded, because the reader can fail too — no key on
     * the deployment, no code in frame, a code Vision misreads into a card that
     * does not exist. A tied pair of reprints is a far better last word than
     * "the card reader failed", so it waits here for that case.
     */
    let unsure: { cards: CardView[]; route: Route } | undefined;
    try {
      const local = await matchLocally(file);
      if (local?.confident) {
        setStatus({ phase: "done", candidates: [], cards: local.cards, route: local.route });
        return;
      }
      if (local) unsure = { cards: local.cards, route: local.route };
    } catch {
      // No WebGPU, a failed model download, an image this browser will not
      // decode. None of that should cost the visitor their scan — fall through
      // to the reader that runs on a server.
    }

    setStatus({ phase: "reading" });

    let candidates: CodeCandidate[] = [];
    let cards: CardView[] = [];
    let note: string | undefined;
    let byNameOnly = false;

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
        const payload = (await response.json()) as {
          candidates?: CodeCandidate[];
          cards?: CardView[];
          byNameOnly?: boolean;
        };
        candidates = payload.candidates ?? [];
        cards = payload.cards ?? [];
        byNameOnly = payload.byNameOnly === true;
      }
    } catch {
      note = "Could not reach the card reader. Check your connection, or type the code below.";
    }

    // THE PRINTED NUMBER WINS WHEN IT EXISTS, because it is the only evidence in
    // the picture that is unambiguous — artwork is shared between reprints and
    // between a card and its Japanese release; the number in the corner is not.
    if (cards.length === 0 && unsure) {
      setStatus({
        phase: "done",
        candidates,
        cards: unsure.cards,
        note:
          "Couldn't read the number printed on the card, so this is the closest artwork — " +
          "check the number in the corner of yours, or type it below.",
        route: unsure.route,
      });
      return;
    }

    setStatus({
      phase: "done",
      candidates,
      cards,
      note,
      route: { via: byNameOnly ? "name" : "text" },
    });
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

        <button
          type="button"
          onClick={() => setLive((on) => !on)}
          aria-pressed={live}
          className={`mt-3 w-full rounded-lg border-2 border-black px-3 py-2.5 text-sm font-black transition-colors ${
            live ? "bg-foreground text-white" : "bg-card-surface hover:bg-muted-surface"
          }`}
          style={{ boxShadow: "3px 3px 0 0 #000" }}
        >
          {live ? "Close the live camera" : "Scan live with the camera"}
        </button>

        {/* NOTHING IS ASKED ANY MORE.
            Two fieldsets stood here — Game, and Card language — and the
            reasoning for them was sound and is now obsolete rather than wrong.
            Neither answer is recoverable from a picture, so the person was
            asked; but the person cannot recover it any faster than the matcher
            can, and two taps in front of "point the camera at a card" is the
            feature arguing with its own proposition.

            What replaced them is a search across all four catalogues at once,
            gated on a measurement rather than on optimism: 1,008 reference
            vectors, one answered by the wrong catalogue, and that one was the
            same One Piece card in its other language. See matchCard. */}

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
        {/* THE LIVE VIEW OWNS THE RIGHT COLUMN while it is open. Running it
            above a stale photo result invites reading one and acting on the
            other. */}
        {live ? (
          <LiveScanner onClose={() => setLive(false)} />
        ) : null}

        {!live && status.phase === "matching" ? (
          <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm font-bold">
            Looking at the artwork…
            <span className="mt-1 block text-xs font-normal text-muted-text">
              This runs on your device and the photo does not leave it. The first card of a session also
              downloads the matcher, which takes a moment; every one after is instant.
            </span>
          </p>
        ) : null}

        {!live && status.phase === "reading" ? (
          <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm font-bold">
            Reading the card…
            <span className="mt-1 block text-xs font-normal text-muted-text">
              {/* WHY the photo is being sent differs by game, and saying the
                  wrong reason is worse than saying none. One Piece never had a
                  local attempt to fail. */}
              The artwork was not a clear enough match, so the printed code is being read instead. The photo is
              sent once, read, and not stored.
            </span>
          </p>
        ) : null}

        {!live && status.phase === "done" ? (
          status.cards.length === 0 && status.candidates.length === 0 ? (
            <p className="rounded-lg border-2 border-black bg-muted-surface p-3 text-sm">
              No card code found in that photo. The code sits in a bottom corner — <b>OP05-119</b> on a One Piece
              card, <b>190/182</b> on a Pokémon one. Try again with that corner in frame, or type it below.
              {status.note ? <span className="mt-2 block text-xs text-muted-text">{status.note}</span> : null}
            </p>
          ) : (
            <>
              <p className="text-xs font-black uppercase tracking-wide text-muted-text">
                {status.route?.via === "name"
                  ? "Couldn't read the number — cards with this name"
                  : status.cards.length === 1
                    ? "Your card"
                    : "Which of these is yours?"}
              </p>

              {/* THE HONEST VERSION OF A GUESS. These cards were not identified;
                  they were listed because something on the photograph matched
                  their name. Saying so is the difference between a shortlist and
                  six wrong answers with an "I own this" button under each. */}
              {status.route?.via === "name" ? (
                <p className="mt-1 text-[11px] text-muted-text">
                  The number in the bottom corner is what names a card, and it was not readable in this photo.
                  These share the name that was read, and there may be many more. Retake the photo with that
                  corner in frame, or type the code below.
                </p>
              ) : null}

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

              {/* TWO LAYOUTS, BECAUSE THERE ARE TWO DIFFERENT JOBS. Several
                  candidates is a COMPARISON — equal tiles, side by side, one
                  window, nothing to scroll past. One card is a READING — its
                  printings, their prices, the button that records which is in
                  your hand.

                  Using the reading layout for a comparison is what turned two
                  identical Mewtwos into two screens of scrolling, and comparing
                  two things you cannot see at once is the one thing the reader
                  actually has to do here. */}
              {status.cards.length > 1 ? (
                <TiedCards cards={status.cards} />
              ) : (
              /* THE PRINTINGS, not just the code. A code names a card; a card
                 is several printings and they are not worth the same — a
                 reverse holo is a median 3.4x its normal twin. Showing them
                 here is what lets someone finish in one place: read, recognise,
                 and record which one is actually in their hand. */
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
              )}

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
