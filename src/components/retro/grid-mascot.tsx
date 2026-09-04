"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A mascot that roams the raw-vs-PSA10 comparison grid, chasing the cursor.
 *
 * IT IS A GIF, AND THE GIF IS NOT ANIMATED BY US. A sprite sheet was tried
 * first, because a sheet lets code choose the frame and a GIF does not — the
 * browser owns a GIF's playhead and nothing in CSS or JS can seek it. But
 * choosing frames only matters if you have frames worth choosing: the sprites
 * this site already self-hosts (lib/pokemon-sprite.ts) are single idle loops
 * with no directional art in them, so a sheet bought addressability over
 * frames that do not exist.
 *
 * So the GIF plays its own idle animation, untouched, and every part of the
 * movement is the wrapper around it:
 *
 * - POSITION is interpolated every frame toward the cursor, not stepped on a
 *   tick. With no walk cycle to keep in sync there is nothing to quantise to,
 *   and per-frame motion is simply smoother.
 * - FACING IS LEFT ALONE. No horizontal flip. The sprite is a render of a 3D
 *   model, not a flat 2D sprite: its lighting comes from one side and its
 *   markings are not symmetric, so mirroring it does not turn it around, it
 *   just makes a visibly wrong copy. It keeps the pose the artwork was drawn
 *   in and the movement carries the direction on its own.
 * - A BOB while moving, from a sine of elapsed time, so it walks rather than
 *   slides. It settles to zero when idle.
 * - A SHADOW that tightens as the bob lifts, which is what sells the bob as
 *   height rather than as jitter.
 *
 * PENNED, NEVER FIXED. Position is `absolute` inside the grid and both the
 * mascot and its target are clamped to the grid's own
 * `getBoundingClientRect()`, so it cannot reach the prices or the page, and a
 * cursor outside the grid pulls it to the nearest edge and no further.
 *
 * Everything touching `window` happens inside effects, so this renders
 * server-side as nothing and starts moving on hydration.
 */
export function GridMascot({
  boundsRef,
  src,
  size = 40,
  /** Pixels per second while walking. */
  speed = 340,
  /** How close it gets before settling. */
  stopDistance = 16,
}: {
  /** The element the mascot is penned inside — the comparison grid. */
  boundsRef: React.RefObject<HTMLElement | null>;
  /** A self-hosted animated GIF, via lib/pokemon-sprite.ts. */
  src: string;
  /** The mascot's HEIGHT. Width follows the sprite's own aspect ratio. */
  size?: number;
  speed?: number;
  stopDistance?: number;
}) {
  /** null until the sprite has loaded and reported its natural size. */
  const [aspect, setAspect] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const spriteRef = useRef<HTMLImageElement | null>(null);
  const shadowRef = useRef<HTMLDivElement | null>(null);

  const cursor = useRef<{ x: number; y: number } | null>(null);
  const self = useRef({ x: -1, y: 0 });

  /**
   * Probe before rendering, for two reasons.
   *
   * A missing file would otherwise leave a hole in the middle of the
   * comparison grid with nothing to explain it. And the box has to match the
   * sprite's own proportions: `interact.gif` is 75x49, landscape, so a square
   * box with `object-contain` would centre the art and leave the shadow
   * floating well below its feet. Height is the fixed dimension and width is
   * derived, so swapping in a taller sprite later needs no other change.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !src) return;
    const probe = new window.Image();
    probe.onload = () => {
      if (probe.naturalHeight > 0) setAspect(probe.naturalWidth / probe.naturalHeight);
    };
    probe.src = src;
    return () => {
      probe.onload = null;
    };
  }, [src]);

  useEffect(() => {
    if (aspect === null || typeof window === "undefined") return;

    const onMove = (e: PointerEvent) => {
      cursor.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      raf = window.requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); // clamped so a backgrounded tab cannot teleport it
      last = now;

      const box = boundsRef.current?.getBoundingClientRect();
      const wrap = wrapRef.current;
      if (!box || !wrap || box.width === 0) return;

      const maxX = Math.max(0, box.width - size * aspect);
      const maxY = Math.max(0, box.height - size);
      const me = self.current;
      if (me.x < 0) {
        // First frame: start parked in the middle rail rather than at 0,0.
        me.x = maxX / 2;
        me.y = maxY;
      }

      const point = cursor.current;
      const targetX = point ? clamp(point.x - box.left - (size * aspect) / 2, 0, maxX) : me.x;
      const targetY = point ? clamp(point.y - box.top - size / 2, 0, maxY) : me.y;

      const dx = targetX - me.x;
      const dy = targetY - me.y;
      const dist = Math.hypot(dx, dy);
      const moving = dist > stopDistance;

      if (moving) {
        const stepPx = Math.min(dist - stopDistance, speed * dt);
        me.x = clamp(me.x + (dx / dist) * stepPx, 0, maxX);
        me.y = clamp(me.y + (dy / dist) * stepPx, 0, maxY);
      }

      // Bob is a function of TIME, not of distance travelled, so the gait
      // stays even whatever the framerate. It eases to nothing when idle.
      const bob = moving ? Math.abs(Math.sin(now / 80)) * (size * 0.09) : 0;

      wrap.style.transform = `translate3d(${me.x}px, ${me.y}px, 0)`;
      if (spriteRef.current) {
        spriteRef.current.style.transform = `translateY(${-bob}px)`;
      }
      if (shadowRef.current) {
        // Tighter and fainter as it lifts — the thing that reads as height.
        const lift = bob / (size * 0.09);
        shadowRef.current.style.transform = `scaleX(${1 - lift * 0.25})`;
        shadowRef.current.style.opacity = String(0.28 - lift * 0.12);
      }
    };

    raf = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [aspect, boundsRef, size, speed, stopDistance]);

  if (aspect === null) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 z-10"
      ref={wrapRef}
      style={{ width: size * aspect, height: size, willChange: "transform" }}
    >
      <div
        className="absolute bottom-0 left-1/2 w-[62%] -translate-x-1/2 rounded-[50%] bg-black"
        ref={shadowRef}
        // Scaled off `size` like the bob is, so the shadow stays a shadow
        // rather than a smudge when the mascot is made smaller.
        style={{ height: Math.max(3, size * 0.1), opacity: 0.28, filter: "blur(1.5px)" }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- animated GIF; next/image would freeze it on the first frame */}
      <img
        alt=""
        className="relative h-full w-full object-contain"
        ref={spriteRef}
        src={src}
        style={{ transformOrigin: "50% 100%" }}
      />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
