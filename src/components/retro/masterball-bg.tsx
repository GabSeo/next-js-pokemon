"use client";

import { animate, scroll } from "motion";
import { useEffect, useRef } from "react";

/**
 * Fixed-position background pokéball, rotating in lockstep with scroll
 * progress (not time) — same Motion pattern as the mockup's
 * `scroll(animate(ball, {rotate: 360}, {ease:"linear"}))` in
 * mintdex-mvp-mockup.html, using the installed `motion` package instead of
 * the mockup's CDN import.
 *
 * Purely decorative: `pointer-events: none`, low opacity, and rendered from
 * an inline SVG (no external asset — the mockup's masterball.png isn't
 * available here yet; swap the <svg> below for a real <img> once real
 * artwork exists, same wrapper/positioning). Nothing on the page depends on
 * this running — it sits behind content that's already fully server-
 * rendered, so JS-disabled visitors and crawlers lose only the spin, never
 * any information.
 */
export function MasterballBg() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return scroll(animate(el, { rotate: 360 }, { ease: "linear" }));
  }, []);

  return (
    <svg
      ref={ref}
      className="pointer-events-none fixed top-[8%] right-[-12%] z-0 h-auto w-[680px] max-w-[70vw] opacity-10 motion-reduce:hidden"
      viewBox="0 0 200 200"
      aria-hidden="true"
      style={{ willChange: "transform" }}
    >
      <circle cx="100" cy="100" r="96" fill="#fff" stroke="#000" strokeWidth="6" />
      <path d="M4 100a96 96 0 0 1 192 0Z" fill="#000" />
      <rect x="4" y="92" width="192" height="16" fill="#000" />
      <circle cx="100" cy="100" r="28" fill="#fff" stroke="#000" strokeWidth="6" />
      <circle cx="100" cy="100" r="12" fill="#fff" stroke="#000" strokeWidth="4" />
    </svg>
  );
}
