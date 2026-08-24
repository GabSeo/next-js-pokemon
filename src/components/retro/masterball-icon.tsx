"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The Master Ball used by the Vinted "catch 'em all" reveal
 * (vinted-listings-section.tsx) — renders the same public/masterball.png
 * asset masterball-bg.tsx uses for the site's decorative page background,
 * rather than a separate hand-drawn inline SVG recreation of it (what this
 * file used to be). One real asset, one look, instead of two Master Balls
 * that don't quite match.
 *
 * Plain <img>, not next/image: this asset already goes through next/image
 * elsewhere (masterball-bg.tsx), but here it's small, decorative, and
 * layered under a Motion-animated glint overlay — next/image's automatic
 * sizing/loading machinery buys nothing for that and only adds a layout
 * wrapper the glint's absolute positioning would have to fight.
 */
export function MasterballIcon({ size = 56 }: { size?: number }) {
  const reduce = useReducedMotion();

  return (
    <span className="relative block overflow-hidden rounded-full" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted under /public, same asset as masterball-bg.tsx */}
      <img src="/masterball.png" alt="" width={size} height={size} className="h-full w-full object-contain" />
      {/* Sweeping glint — a bright diagonal band drifting left to right on a
          loop, pure decoration. Off entirely under reduced motion rather
          than a static remnant, same rule the rotation/shake in the parent
          component follows. */}
      {!reduce && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-3"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)",
            rotate: 22,
          }}
          animate={{ x: ["-160%", "-160%", "170%", "170%"], opacity: [0, 0.85, 0, 0] }}
          transition={{ duration: 4.6, repeat: Infinity, ease: "easeInOut", times: [0, 0.66, 0.88, 1] }}
        />
      )}
    </span>
  );
}
