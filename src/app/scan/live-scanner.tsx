"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CardView } from "@/lib/card-view";
import { cardRect, matchCard, prepareMatcher, type ClipIndexKey, type ClipProgress } from "@/lib/clip-client";
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
 * IT YIELDS BETWEEN FRAMES, and that is not politeness. Inference runs on the
 * main thread — ONNX Runtime's WASM backend has no worker here — so a ~500 ms
 * match is a ~500 ms block. Looping without a gap starves paint and input
 * entirely: driving this from a test harness at full tilt made the page
 * unresponsive to the point that the tooling could not read it. `BREATH_MS`
 * costs a tenth of a frame and gives the browser a turn.
 *
 * The real fix is a worker, and it is not this. Documented rather than hidden:
 * see docs/how-the-scan-works.md.
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

/**
 * A turn for the event loop between frames, so the page stays alive.
 *
 * Long enough for a paint and a tap to be handled, short against a ~500 ms
 * match. Not a frame rate limiter — the loop is already limited by how fast the
 * device can embed.
 */
const BREATH_MS = 60;

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
   * Everything the loop mutates lives in a ref, not in state.
   *
   * The loop runs across renders and must not restart when one happens —
   * putting the run flag or the agreement counter in state would tear the loop
   * down and build a new one on every frame, and two loops racing one camera is
   * a bug that looks like the matcher being wrong.
   */
  const loop = useRef({ running: false, lastId: "", agreed: 0 });

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
          result = await matchCard(video, cardRect(width, height), indexKey, { limit: 8 });
        } catch {
          // A frame the browser could not read is not a reason to stop.
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        if (!loop.current.running || cancelled) break;

        // Give the browser a turn before doing anything with the result — this
        // is the only point in the cycle where the main thread is free.
        await new Promise((resolve) => setTimeout(resolve, BREATH_MS));
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
  }, [indexKey, tcg, stop]);

  const hint =
    reading.state !== "scanning"
      ? ""
      : reading.verdict === "empty"
        ? "Point the camera at a card"
        : reading.verdict === "unsure"
          ? "Hold steady — fill the frame with the card"
          : "Got it…";

  return (
    <div className="mt-3 rounded-lg border-2 border-black bg-white p-3" style={{ boxShadow: "3px 3px 0 0 #000" }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-black uppercase tracking-wide text-muted-text">Live camera</span>
        <button type="button" onClick={onClose} className="text-[11px] font-black underline underline-offset-4">
          Stop
        </button>
      </div>

      <div className="relative mt-2 overflow-hidden rounded-md border-2 border-black bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          // `object-cover` on a fixed aspect keeps the guide and the crop in
          // agreement — a letterboxed video would put black inside the region
          // the matcher reads.
          className="block aspect-[3/4] w-full object-cover"
        />

        {/* THE GUIDE IS THE CROP, drawn at the same 63:88 and the same 82% the
            matcher reads. If the two ever disagree the person is framing one
            rectangle while the model looks at another. */}
        {reading.state === "scanning" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="rounded-md border-[3px] transition-colors duration-200"
              style={{
                aspectRatio: "63 / 88",
                height: "82%",
                borderColor:
                  reading.verdict === "empty" ? "rgba(255,255,255,.55)" : reading.verdict === "unsure" ? "#f5c518" : "#3ddc84",
                boxShadow: "0 0 0 9999px rgba(0,0,0,.35)",
              }}
            />
          </div>
        ) : null}

        {reading.state !== "scanning" ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="text-sm font-black text-white">
              {reading.state === "starting"
                ? "Starting…"
                : reading.state === "loading"
                  ? `Loading the matcher${
                      reading.progress?.ratio ? ` — ${Math.round(reading.progress.ratio * 100)}%` : "…"
                    }`
                  : reading.state === "denied"
                    ? reading.reason
                    : ""}
              {reading.state === "loading" ? (
                <span className="mt-1 block text-[11px] font-normal text-white/70">
                  About 68 MB, once per browser. Everything after this is instant and offline.
                </span>
              ) : null}
            </p>
          </div>
        ) : null}
      </div>

      {reading.state === "scanning" ? (
        <p className="mt-2 text-[11px] text-muted-text">
          <b>{hint}</b>
          {reading.fps ? ` · ${reading.fps.toFixed(1)} frames a second on this device` : ""} · nothing leaves your
          phone
        </p>
      ) : null}

      {reading.state === "found" ? (
        <div className="mt-3">
          <p className="text-[11px] text-muted-text">
            {reading.tied > 1
              ? `${reading.tied} cards share this artwork — check the number in the corner.`
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
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full rounded-md border-2 border-black bg-foreground px-3 py-2 text-xs font-black text-white"
          >
            Scan another
          </button>
        </div>
      ) : null}
    </div>
  );
}
