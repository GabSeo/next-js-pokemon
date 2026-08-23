"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The Master Ball SVG used by the Vinted "catch 'em all" reveal
 * (vinted-listings-section.tsx) — not the same file as masterball-bg.tsx's
 * decorative page background, which renders public/masterball.png as an
 * <Image>. This one is inline SVG so its glint sweep can be driven by the
 * same `motion/react` the rest of the reveal interaction already uses,
 * rather than mixing in a styled-jsx keyframe (unused anywhere else in this
 * codebase) for one component.
 *
 * Colors are literal hex, not theme tokens — a Master Ball's purple/pink/
 * black/white is a fixed real-world design, not a brand color that should
 * follow a future palette change the way bg-pokemon-red etc. do.
 */
export function MasterballIcon({ size = 56 }: { size?: number }) {
  const reduce = useReducedMotion();

  return (
    <span className="relative block overflow-hidden" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <circle cx="32" cy="32" r="29" fill="#fff" />
        <path d="M3 32a29 29 0 0 1 58 0Z" fill="#6b21a8" />
        <circle cx="19" cy="17" r="4.5" fill="#ec4899" />
        <circle cx="45" cy="17" r="4.5" fill="#ec4899" />
        <text x="32" y="24" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="900" fill="#ec4899">
          M
        </text>
        <rect x="3" y="27.5" width="58" height="9" fill="#0a0a0a" />
        <circle cx="32" cy="32" r="10" fill="#fff" stroke="#0a0a0a" strokeWidth="3.5" />
        <circle cx="32" cy="32" r="3.4" fill="#e4e4e4" />
        <circle cx="32" cy="32" r="29" fill="none" stroke="#0a0a0a" strokeWidth="3.5" />
      </svg>
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
