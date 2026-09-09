"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CardView } from "@/lib/card-view";
import { cardRect, cardRectInView, matchCard, prepareMatcher, type ClipIndexKey, type ClipProgress } from "@/lib/clip-client";
import { clipTied, clipVerdict, CLIP_MAX_TIED, type ClipVerdict } from "@/lib/clip-search";

/**
 * Point the camera at a card and see what it is, without pressing anything.
 *
 * WHY THIS CAN EXIST AT ALL. The matcher runs on the device against an index
 * the browser already has, so a frame costs no network call, no quota, and no
 * upload. That is the whole reason the photo scan was moved off the server
 * first: a video feed cannot post thirty frames a second to anybody.
 *
 * WHAT IT DOES NOT HAVE: a card detector. Nothing here finds the four corners
 * of a card in a frame. Instead a card-shaped guide is drawn on screen and only
 * that region is read — the person holding the phone does the framing. It is
 * not a placeholder for a detector so much as the honest version of the same
 * job: measured, a card filling a fifth of the frame scores 0.759 with a margin
 * of 0.0012, recognisable as a card and impossible to name. Cropping is what
 * closes that gap, and a detector would do it automatically rather than better.
 *
 * ONE FRAME AT A TIME, NOT THIRTY A SECOND. The loop reads a frame only when
 * the previous match has finished, so it self-paces to whatever the device can
 * do — measured at roughly 500 ms, so about two frames a second. Firing on a
 * timer instead would queue work faster than it completes and the view would
 * fall further behind the camera every second it ran.
 *
 * THE MATCH RUNS ON ANOTHER THREAD, which is what makes the preview watchable.
 * The first version ran it here and the camera stuttered — reported from a real
 * phone as "everything seems laggy". A 60 ms yield between frames was tried and
 * did not help, because the block is the 450 ms match itself, not the gap
 * between matches. lib/clip-client.ts posts each frame to a worker now, so this
 * loop only decodes a bitmap and waits.
 *
 * AND IT DOES NOT ANSWER ON ONE FRAME. A single frame's verdict flickers as
 * hands move and focus hunts. An answer has to hold for `AGREEING_FRAMES` in a
 * row before it is shown, which costs about a second and removes the class of
 * bug where a card flashes up because one blurred frame happened to land near
 * something.
 */

/**
 * How many consecutive frames must agree before an answer is shown.
 *
 * Two is enough to kill the flicker and cheap at ~500 ms a frame. Three would
 * be steadier and would make the view feel slow — this is the number to raise
 * if real use shows wrong answers slipping through, and the reason it is named.
 */
const AGREEING_FRAMES = 2;

type Reading =
  | { state: "starting" }
  | { state: "denied"; reason: string }
  | { state: "loading"; progress?: ClipProgress }
  | { state: "scanning"; verdict: ClipVerdict; fps?: number }
  | { state: "found"; cards: CardView[]; tied: number; elapsed: number };

export function LiveScanner({
  indexKey,
  tcg,
  onClose,
}: {
  indexKey: ClipIndexKey;
  tcg: "pokemon" | "onepiece";
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reading, setReading] = useState<Reading>({ state: "starting" });

  /**
   * Bumped to run the whole effect again after a result.
   *
   * "Scan another" has to reopen the camera, because finding a card stops it —
   * and re-entering the effect is the only way to do that which cannot leave a
   * half-torn-down loop behind. A boolean would not retrigger on the second
   * press.
   */
  const [attempt, setAttempt] = useState(0);

  /**
   * The guide's size in screen pixels, computed rather than styled.
   *
   * CSS COULD NOT EXPRESS THIS. `aspect-ratio` with `height: 82%` overflows a
   * tall screen — measured at 477px wide inside 375 — and adding `max-width`
   * clamps the width while leaving the height, so the box stops being
   * card-shaped (0.462 against 0.716). What is wanted is `min` of both
   * constraints, which is exactly what `cardRect` computes for the crop. Using
   * the same function for both is the only way the drawn rectangle and the read
   * rectangle cannot drift apart.
   */
  const [guide, setGuide] = useState<{ width: number; height: number } | undefined>();

  /**
   * Everything the loop mutates lives in a ref, not in state.
   *
   * The loop runs across renders and must not restart when one happens —
   * putting the run flag or the agreement counter in state would tear the loop
   * down and build a new one on every frame, and two loops racing one camera is
   * a bug that looks like the matcher being wrong.
   */
  const loop = useRef({ running: false, lastId: "", agreed: 0 });

  // Recomputed on mount and on rotation. A ResizeObserver rather than a resize
  // listener, because the box also changes when the result sheet opens under it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const measure = () => {
      const box = video.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        const rect = cardRect(box.width, box.height);
        setGuide({ width: rect.width, height: rect.height });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(video);
    return () => observer.disconnect();
  }, [attempt]);

  const stop = useCallback(() => {
    loop.current.running = false;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // THE MODEL BEFORE THE CAMERA. Opening the camera first shows a live
      // picture that does nothing for the ten seconds the weights take, which
      // reads as broken rather than as loading.
      setReading({ state: "loading" });
      try {
        await prepareMatcher(indexKey, (progress) => {
          if (!cancelled) setReading({ state: "loading", progress });
        });
      } catch {
        if (!cancelled) setReading({ state: "denied", reason: "The matcher could not be downloaded." });
        return;
      }
      if (cancelled) return;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera on a phone; ignored on a laptop, which has one.
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (error) {
        if (!cancelled) {
          const denied = error instanceof DOMException && error.name === "NotAllowedError";
          setReading({
            state: "denied",
            reason: denied
              ? "The camera was not allowed. You can still take a photo instead."
              : "No camera is available on this device.",
          });
        }
        return;
      }
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      const video = videoRef.current;
      if (!video) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      loop.current = { running: true, lastId: "", agreed: 0 };
      setReading({ state: "scanning", verdict: "empty" });

      while (loop.current.running && !cancelled) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width === 0 || height === 0) {
          // The stream has not produced a frame yet. Yield rather than spin.
          await new Promise((resolve) => setTimeout(resolve, 120));
          continue;
        }

        let result;
        try {
          // The rectangle the guide DRAWS, not the one a full frame implies —
          // `object-cover` crops the video, so the two are different questions.
          const box = video.getBoundingClientRect();
          result = await matchCard(
            video,
            cardRectInView(width, height, box.width, box.height),
            indexKey,
            { limit: 8 }
          );
        } catch {
          // A frame the browser could not read is not a reason to stop.
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        if (!loop.current.running || cancelled) break;

        const verdict = clipVerdict(result);
        const top = result.hits[0]?.id ?? "";

        // AGREEMENT, NOT A SINGLE FRAME. Anything other than a repeat of the
        // last identified card resets the count, so a flicker cannot accumulate.
        if (verdict === "identified" && top === loop.current.lastId) loop.current.agreed++;
        else loop.current.agreed = verdict === "identified" ? 1 : 0;
        loop.current.lastId = verdict === "identified" ? top : "";

        if (verdict === "identified" && loop.current.agreed >= AGREEING_FRAMES) {
          const tied = clipTied(result).slice(0, CLIP_MAX_TIED);
          const ids = tied.map((hit) => (indexKey === "ja" ? `ja~${hit.id}` : hit.id));
          try {
            const response = await fetch("/api/scan/resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids, tcg }),
            });
            const { cards } = (await response.json()) as { cards?: CardView[] };
            if (cards && cards.length > 0) {
              if (cancelled) break;
              // FOUND MEANS STOP. Leaving the camera running behind a result
              // keeps the phone warm, keeps the loop working, and invites the
              // next frame to overwrite an answer the reader is still reading.
              stop();
              setReading({ state: "found", cards, tied: cards.length, elapsed: result.elapsed });
              return;
            }
          } catch {
            // The catalogue was unreachable; keep scanning rather than stop.
          }
          loop.current.agreed = 0;
        } else {
          setReading({
            state: "scanning",
            verdict,
            fps: result.elapsed > 0 ? 1000 / result.elapsed : undefined,
          });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
      stop();
    };
  }, [indexKey, tcg, stop, attempt]);

  const hint =
    reading.state !== "scanning"
      ? ""
      : reading.verdict === "empty"
        ? "Point the camera at a card"
        : reading.verdict === "unsure"
          ? "Hold steady — fill the frame with the card"
          : "Got it…";

  return (
    /* FULL SCREEN, NOT A PANEL IN A COLUMN. A scanner is a viewfinder: the frame
       has to be big enough to fill with a card, and a card small in a panel is
       the exact state that scores 0.759 and cannot be named. Everything else on
       the page is irrelevant while the camera is open, so it is covered rather
       than competed with. `fixed inset-0` also survives the page scrolling
       underneath, which a sticky panel does not.

       `z-[70]`, and the number is load-bearing: the site header sits at
       `z-[60]` and is sticky, so anything below that renders UNDER the nav bar
       — which looked like the viewfinder being clipped rather than like a
       stacking mistake. See components/site-header.tsx, where the 60 is
       likewise explained rather than chosen. */
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      {/* The video fills the screen and the chrome floats over it. */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          // `object-cover` keeps the guide and the crop in agreement — a
          // letterboxed video would put black inside the region the matcher
          // reads.
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* THE GUIDE IS THE CROP, drawn at the same 63:88 and the same 82% the
            matcher reads. If the two ever disagree the person is framing one
            rectangle while the model looks at another. */}
        {reading.state === "scanning" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="rounded-lg border-[3px] transition-colors duration-200"
              style={{
                width: guide?.width ?? 0,
                height: guide?.height ?? 0,
                borderColor:
                  reading.verdict === "empty"
                    ? "rgba(255,255,255,.55)"
                    : reading.verdict === "unsure"
                      ? "#f5c518"
                      : "#3ddc84",
                boxShadow: "0 0 0 9999px rgba(0,0,0,.45)",
              }}
            />
          </div>
        ) : null}

        {/* Close sits top-right, where a full-screen view is expected to put it
            and where a thumb reaches without crossing the viewfinder. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the camera"
          className="absolute right-4 top-4 rounded-full border-2 border-white/70 bg-black/50 px-4 py-2 text-sm font-black text-white backdrop-blur"
        >
          Close
        </button>

        {reading.state === "scanning" ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-6 pb-8 text-center">
            <p className="text-base font-black text-white drop-shadow">{hint}</p>
            <p className="mt-1 text-[11px] text-white/70">
              {reading.fps ? `${reading.fps.toFixed(1)} frames a second · ` : ""}nothing leaves your phone
            </p>
          </div>
        ) : null}

        {reading.state !== "scanning" && reading.state !== "found" ? (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
            <p className="text-base font-black text-white">
              {reading.state === "starting"
                ? "Starting…"
                : reading.state === "loading"
                  ? `Loading the matcher${
                      reading.progress?.ratio ? ` — ${Math.round(reading.progress.ratio * 100)}%` : "…"
                    }`
                  : reading.reason}
              {reading.state === "loading" ? (
                <span className="mt-2 block text-xs font-normal text-white/70">
                  About 68 MB, once per browser. Everything after this is instant and offline.
                </span>
              ) : null}
            </p>
          </div>
        ) : null}
      </div>

      {/* THE RESULT IS A SHEET OVER THE VIEWFINDER, not a panel replacing it.
          The camera has already stopped; keeping the last frame behind the
          answer is what makes "this is the card I was just pointing at" read as
          one gesture rather than two screens. */}
      {reading.state === "found" ? (
        <div className="max-h-[62%] overflow-y-auto border-t-2 border-white/20 bg-white p-4">
          <p className="text-[11px] text-muted-text">
            {reading.tied > 1
              ? `${reading.tied} cards share this artwork — check the number in the corner of yours.`
              : `Matched in ${Math.round(reading.elapsed)} ms, on your device.`}
          </p>
          <ul className="mt-2 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
            {reading.cards.map((card) => (
              <li key={`${card.tcg}:${card.code}`} className="rounded-md border-2 border-black bg-muted-surface p-2">
                {card.prints[0]?.image ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- pre-sized upstream file */
                  <img
                    src={card.prints[0].image}
                    alt={card.name}
                    className="aspect-[300/420] w-full rounded object-contain"
                  />
                ) : null}
                <div className="mt-1 truncate text-[13px] font-black">{card.name}</div>
                <div className="truncate text-[11px] text-muted-text">{card.prints[0]?.origin ?? card.code}</div>
                <Link
                  href={`/card/${card.tcg}/${encodeURIComponent(card.code)}`}
                  className="mt-1 block text-[11px] font-black underline underline-offset-4"
                >
                  Open card
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="flex-1 rounded-md border-2 border-black bg-foreground px-3 py-2.5 text-sm font-black text-white"
            >
              Scan another
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border-2 border-black bg-card-surface px-4 py-2.5 text-sm font-black"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
