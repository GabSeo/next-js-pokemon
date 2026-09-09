"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CardView } from "@/lib/card-view";
import { cardRect, cardRectInView, matchCard, prepareMatcher, type ClipIndexKey, type ClipProgress } from "@/lib/clip-client";
import { clipVerdict, CLIP_MAX_TIED, type ClipVerdict } from "@/lib/clip-search";

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
 * hands move and focus hunts, so the same card has to win `AGREEING_FRAMES` of
 * the last `WINDOW` frames. Requiring them CONSECUTIVELY was the first version
 * and was reported as impossible to use — see the constant for why a window
 * forgives a shaky hand where a run does not.
 */

/**
 * EVIDENCE ADDS UP ACROSS FRAMES. No single frame has to be confident.
 *
 * THE THREE VERSIONS BEFORE THIS ONE all asked the same wrong question — does
 * THIS frame, alone, clear both thresholds? First two consecutive frames had to;
 * then two of the last six. Both were still a conjunction of two rare events on
 * a moving camera: a frame sharp enough to clear the score floor AND separated
 * enough to clear the margin. Handheld over a table, a frame rarely does both,
 * so the answer never came and the scan read as broken.
 *
 * The margin is the part that does not survive live video. It was calibrated on
 * five still photographs; a frame with any motion in it has its top two
 * candidates within noise of each other, whichever card is really there.
 *
 * So: every frame adds each candidate's similarity to a running total, and the
 * card that is actually in front of the camera pulls ahead over a second or two
 * even though no single frame ever settled it. Noise does not accumulate —
 * a blurred frame's spurious best is a different card each time, and scattered
 * votes cancel where a consistent one compounds.
 */

/** Frames before any answer, whatever the evidence says. At ~2 fps, about 1.5 s. */
const MIN_FRAMES = 3;

/**
 * How far ahead the leader must be, per frame, to be called.
 *
 * An AVERAGE lead rather than a single frame's margin — 0.008 sustained across
 * four frames is a far stronger claim than 0.015 in one, because the noise that
 * produces a lucky margin does not repeat and a real card does.
 */
const ACCEPT_LEAD = 0.008;

/** Below this score a frame is not looking at a card and contributes nothing. */
const VOTE_FLOOR = 0.45;

/** Older evidence fades, so pointing at a second card does not wait out the first. */
const DECAY = 0.85;

type Reading =
  | { state: "starting" }
  | { state: "denied"; reason: string }
  | { state: "loading"; progress?: ClipProgress }
  | {
      state: "scanning";
      verdict: ClipVerdict;
      fps?: number;
      /** Votes gathered for the current best card, out of `AGREEING_FRAMES`. */
      /** 0..1, how close the accumulated evidence is to naming a card. */
      progress?: number;
      /** The card currently ahead, shown before it is settled so the view looks alive. */
      leading?: string;
      /** The quadrilateral the detector found, in the downscaled frame's pixels. */
      found?: { corners: number[][]; width: number };
      /** What the matcher thinks it is looking at, whether or not it will say so. */
      peek?: { id: string; score: number; margin: number };
    }
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
   * SHOW WHAT THE MATCHER SEES, not what the camera sees.
   *
   * Measured on synthetic frames this worked; measured on twenty real cards it
   * found one. That gap is not a threshold to nudge — it means the crop being
   * embedded is not the picture anyone thinks it is, and no amount of reasoning
   * about it from here beats looking at it. A slabbed card laid flat, framed to
   * fill the guide, puts a plastic border and a grading label inside the crop;
   * whether that is what is happening is a question a thumbnail answers in one
   * glance.
   */
  const peekRef = useRef<HTMLCanvasElement>(null);

  /**
   * How much of the frame the guide covers, adjustable.
   *
   * A FIXED FRACTION CANNOT FIT BOTH CASES. A bare card fills the guide at 82%;
   * the same card inside a graded slab sits in maybe two thirds of the case, so
   * framing the CASE at 82% puts a plastic border and a label inside the crop
   * and framing the CARD means the case overflows the screen. The person can
   * see which they have; the code cannot.
   *
   * Read by both the crop and the drawn rectangle, so they stay the same
   * rectangle at every setting.
   */
  const [fill, setFill] = useState(0.82);

  /**
   * Everything the loop mutates lives in a ref, not in state.
   *
   * The loop runs across renders and must not restart when one happens —
   * putting the run flag or the agreement counter in state would tear the loop
   * down and build a new one on every frame, and two loops racing one camera is
   * a bug that looks like the matcher being wrong.
   */
  const loop = useRef<{ running: boolean; frames: number; tally: Map<string, { sum: number; seen: number }> }>({
    running: false,
    frames: 0,
    tally: new Map(),
  });

  // The loop outlives a re-render, so it reads the current fill through a ref
  // rather than closing over the value it started with. Written in an effect,
  // not during render: a render can be discarded, and a ref written by a
  // discarded render keeps the value anyway.
  const fillRef = useRef(0.82);
  useEffect(() => {
    fillRef.current = fill;
  }, [fill]);

  // Recomputed on mount and on rotation. A ResizeObserver rather than a resize
  // listener, because the box also changes when the result sheet opens under it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const measure = () => {
      const box = video.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        const rect = cardRect(box.width, box.height, fill);
        setGuide({ width: rect.width, height: rect.height });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(video);
    return () => observer.disconnect();
  }, [attempt, fill]);

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

      loop.current = { running: true, frames: 0, tally: new Map() };
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
          const rect = cardRectInView(width, height, box.width, box.height, fillRef.current);
          // FIND THE CARD RATHER THAN ASK FOR IT. `rect` is still the fallback
          // for the frames the detector declines.
          result = await matchCard(video, rect, indexKey, { limit: 8, detect: true });

          // Paint the SAME rectangle into the on-screen thumbnail. Same source,
          // same numbers — if the preview shows a label or a table, that is
          // literally what was embedded.
          const peek = peekRef.current;
          const peekCtx = peek?.getContext("2d");
          if (peek && peekCtx) {
            peekCtx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, peek.width, peek.height);
          }
        } catch {
          // A frame the browser could not read is not a reason to stop.
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        if (!loop.current.running || cancelled) break;

        const verdict = clipVerdict(result);

        // EVERY CANDIDATE THIS FRAME SAW gets its similarity added, not just the
        // winner. A card that comes second in every frame and first in none is
        // still the card in front of the camera, and per-frame winner-takes-all
        // threw that away.
        const tally = loop.current.tally;
        if (verdict !== "empty") {
          for (const [, entry] of tally) {
            entry.sum *= DECAY;
            entry.seen *= DECAY;
          }
          for (const hit of result.hits) {
            if (hit.score < VOTE_FLOOR) continue;
            const entry = tally.get(hit.id) ?? { sum: 0, seen: 0 };
            entry.sum += hit.score;
            entry.seen += 1;
            tally.set(hit.id, entry);
          }
          loop.current.frames++;
        }

        const ranked = [...tally.entries()].sort((a, b) => b[1].sum - a[1].sum);
        const leader = ranked[0];
        const runnerUp = ranked[1];
        const lead = leader ? (leader[1].sum - (runnerUp?.[1].sum ?? 0)) / Math.max(1, loop.current.frames) : 0;
        const settled = Boolean(leader && loop.current.frames >= MIN_FRAMES && leader[1].seen >= 2 && lead >= ACCEPT_LEAD);

        if (settled && leader) {
          // A REPRINT STILL SHOWS BOTH. Two cards with the same artwork run
          // neck and neck forever, so anything inside the accept threshold of
          // the leader is offered alongside it rather than waited out.
          const tied = ranked
            .filter(([, entry]) => (leader[1].sum - entry.sum) / Math.max(1, loop.current.frames) < ACCEPT_LEAD)
            .slice(0, CLIP_MAX_TIED)
            .map(([id]) => id);
          const ids = tied.map((id) => (indexKey === "ja" ? `ja~${id}` : id));
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
              // keeps the phone warm and invites the next frame to overwrite an
              // answer the reader is still reading.
              stop();
              setReading({ state: "found", cards, tied: cards.length, elapsed: result.elapsed });
              return;
            }
          } catch {
            // The catalogue was unreachable; keep scanning rather than stop.
          }
          loop.current.tally.clear();
          loop.current.frames = 0;
        } else {
          setReading({
            state: "scanning",
            verdict,
            fps: result.elapsed > 0 ? 1000 / result.elapsed : undefined,
            // How close the leader is to being called, 0..1 — so a scan that is
            // one frame away looks different from one that is stuck.
            progress: leader
              ? Math.min(1, (loop.current.frames / MIN_FRAMES) * 0.5 + Math.min(1, lead / ACCEPT_LEAD) * 0.5)
              : 0,
            leading: leader?.[0],
            found: result.corners ? { corners: result.corners, width: 640 } : undefined,
            peek: result.hits[0]
              ? { id: result.hits[0].id, score: result.hits[0].score, margin: result.margin }
              : undefined,
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
        // "Unsure" no longer means "do something differently" — evidence is
        // accumulating and the honest thing to say is that it is working.
        : "Reading…";

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

        {/* THE GUIDE IS NOW THE FALLBACK, not the instruction. The detector
            finds the card on about nine frames in ten; the box is what gets
            read on the tenth, so it stays on screen and fades when the detector
            is answering — otherwise a person lines up a rectangle that nothing
            is using. */}
        {reading.state === "scanning" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="rounded-lg border-[3px] transition-all duration-300"
              style={{
                width: guide?.width ?? 0,
                height: guide?.height ?? 0,
                opacity: reading.found ? 0.18 : 1,
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
        {/* SIZE THE BOX TO THE CARD, wherever the card actually is. Two taps
            rather than a slider: a slider on a viewfinder is a thing to fight
            while holding a phone over a table. */}
        {reading.state === "scanning" ? (
          <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-2">
            <button
              type="button"
              onClick={() => setFill((f) => Math.max(0.45, +(f - 0.07).toFixed(2)))}
              aria-label="Smaller box"
              className="h-11 w-11 rounded-full border-2 border-white/70 bg-black/50 text-lg font-black text-white backdrop-blur"
            >
              −
            </button>
            <span className="rounded-full bg-black/50 px-3 py-1 text-[11px] font-black text-white/80 backdrop-blur">
              box {Math.round(fill * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setFill((f) => Math.min(0.98, +(f + 0.07).toFixed(2)))}
              aria-label="Bigger box"
              className="h-11 w-11 rounded-full border-2 border-white/70 bg-black/50 text-lg font-black text-white backdrop-blur"
            >
              +
            </button>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close the camera"
          className="absolute right-4 top-4 rounded-full border-2 border-white/70 bg-black/50 px-4 py-2 text-sm font-black text-white backdrop-blur"
        >
          Close
        </button>

        {/* WHAT IT IS ACTUALLY LOOKING AT. Small, out of the way, and the
            single most useful thing on this screen when a scan is not working:
            a crop full of grading label or table says so instantly, where a
            failure count says nothing at all. */}
        {reading.state === "scanning" ? (
          <div className="pointer-events-none absolute left-4 top-4 flex items-start gap-2">
            <canvas
              ref={peekRef}
              width={96}
              height={96}
              className="h-24 w-24 rounded-md border-2 border-white/70 bg-black object-cover"
            />
            <div className="rounded-md bg-black/55 px-2 py-1.5 text-[10px] leading-relaxed text-white/85 backdrop-blur">
              <div className="font-black uppercase tracking-wide text-white/60">What it reads</div>
              {reading.peek ? (
                <>
                  <div className="tabular-nums">score {reading.peek.score.toFixed(3)}</div>
                  <div className="tabular-nums">margin {reading.peek.margin.toFixed(3)}</div>
                  <div className="max-w-[7rem] truncate">{reading.peek.id}</div>
                </>
              ) : (
                <div>…</div>
              )}
            </div>
          </div>
        ) : null}

        {reading.state === "scanning" ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-6 pb-8 text-center">
            <p className="text-base font-black text-white drop-shadow">{hint}</p>
            <p className="mt-1 text-[11px] text-white/70">
              {reading.fps ? `${reading.fps.toFixed(1)} frames a second · ` : ""}nothing leaves your phone
            </p>
            {/* The vote, visible. Without it a scanner that is one frame from an
                answer looks identical to one that is stuck. */}
            {/* One continuous bar, not a row of pips. Evidence arrives by
                degrees now, and a bar that creeps forward while the camera
                moves is the difference between "working" and "stuck". */}
            <div className="mx-auto mt-2 h-1 w-32 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-[#3ddc84] transition-[width] duration-200"
                style={{ width: `${Math.round((reading.progress ?? 0) * 100)}%` }}
              />
            </div>
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
