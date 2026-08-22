"use client";

import { animate } from "motion";
import { useEffect, useRef } from "react";

/**
 * Cursor-tilt + idle-float wrapper, porting the mockup's #psaCard behavior
 * (mintdex-mvp-mockup.html) to Motion + React: mousemove tracks pointer
 * position and writes rotateX/rotateY directly, throttled to one write per
 * animation frame (the mockup's own comment explains why — calling
 * animate() on every raw mousemove queues up competing tweens instead of
 * following the cursor 1:1); mouseleave hands off to an actual Motion
 * spring back to flat; a slow y-bob loop runs while idle so the card feels
 * alive at rest. The same rAF-batched handler also writes --spot-x/--spot-y
 * custom properties, which the .psa-spotlight radial-gradient layer in
 * globals.css reads to light up the area under the cursor — same "circle at
 * var(--x) var(--y)" technique as scrydex.com's card holo effect.
 *
 * The idle bob and the raw mousemove writes both target `transform` on the
 * same element without knowing about each other — the idle animation is a
 * Motion tween that recomposes the whole transform from its own tracked
 * state every tick, so left running during a hover it stomps the raw
 * rotate/scale back to flat every ~16ms, fighting the tilt writes and
 * showing up as a flicker (worst right at the edges, where the tilt angle —
 * and so the jump between the two competing values — is largest). Pausing
 * the idle animation for the duration of the hover, and stopping any
 * in-flight leave-spring the moment a new hover starts, keeps only one
 * system writing `transform` at a time.
 *
 * Tilt sign: for `rotateY(θ)`, positive θ moves the *right* edge of the
 * element away from the viewer (standard CSS rotation matrix — right-handed,
 * X right / Y down / Z toward viewer). To make the corner under the cursor
 * read as the *nearest* point, hovering the right half needs a *negative*
 * rotateY (right edge tips toward the viewer), and hovering the bottom half
 * needs a *positive* rotateX (bottom edge tips toward the viewer).
 *
 * `children` is the real card image/content — always rendered, unconditional
 * on JS. This component only ever adds transform styling on top of it.
 */
export function PsaTiltCard({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const card = cardRef.current;
    if (!wrap || !card) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let targetRotateX = 0;
    let targetRotateY = 0;
    let targetSpotX = 50;
    let targetSpotY = 50;
    let rafId: number | null = null;
    let isHovering = false;
    let leaveSpring: ReturnType<typeof animate> | null = null;

    const idleAnimation = animate(card, { y: [0, -8, 0] }, { duration: 4, repeat: Infinity, ease: "easeInOut" });

    function applyTilt() {
      if (card) {
        card.style.transform = `rotateY(${targetRotateY}deg) rotateX(${targetRotateX}deg) scale(1.05)`;
        card.style.setProperty("--spot-x", `${targetSpotX}%`);
        card.style.setProperty("--spot-y", `${targetSpotY}%`);
      }
      rafId = null;
    }

    function handleMouseMove(e: MouseEvent) {
      if (!isHovering) {
        isHovering = true;
        idleAnimation.pause();
        leaveSpring?.stop();
        leaveSpring = null;
      }
      const rect = wrap!.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      targetRotateY = (0.5 - px) * 26;
      targetRotateX = (py - 0.5) * 26;
      targetSpotX = px * 100;
      targetSpotY = py * 100;
      if (rafId === null) rafId = requestAnimationFrame(applyTilt);
    }

    function handleMouseLeave() {
      isHovering = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      leaveSpring = animate(
        card!,
        { rotateY: 0, rotateX: 0, scale: 1 },
        { type: "spring", stiffness: 180, damping: 14, onComplete: () => idleAnimation.play() }
      );
      card!.style.setProperty("--spot-x", "50%");
      card!.style.setProperty("--spot-y", "50%");
    }

    wrap.addEventListener("mousemove", handleMouseMove);
    wrap.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      wrap.removeEventListener("mousemove", handleMouseMove);
      wrap.removeEventListener("mouseleave", handleMouseLeave);
      if (rafId !== null) cancelAnimationFrame(rafId);
      leaveSpring?.stop();
      idleAnimation.stop();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="psa-card-wrap relative w-full max-w-[300px]"
      style={{ perspective: "1000px", transformStyle: "preserve-3d" }}
    >
      <div
        ref={cardRef}
        className="relative overflow-hidden rounded-[14px] border-2 border-black"
        style={{ boxShadow: "0 25px 50px -12px rgba(0,0,0,.45), 6px 6px 0px 0px #000", willChange: "transform" }}
      >
        {children}
        <div className="psa-glare pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300" />
        <div className="psa-spotlight pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300" />
      </div>
    </div>
  );
}
