"use client";

import { animate, scroll } from "motion";
import Image from "next/image";
import { useEffect, useRef } from "react";

/**
 * Fixed-position background pokéball, rotating in lockstep with scroll
 * progress (not time) — same Motion pattern as the mockup's
 * `scroll(animate(ball, {rotate: 360}, {ease:"linear"}))` in
 * mintdex-mvp-mockup.html, using the installed `motion` package instead of
 * the mockup's CDN import.
 *
 * Rendered from public/masterball.png (340x339, background keyed to
 * transparent + tight-cropped from the original flat-background source
 * asset). Purely decorative: `pointer-events: none`, low opacity. Nothing on
 * the page depends on this running — it sits behind content that's already
 * fully server-rendered, so JS-disabled visitors and crawlers lose only the
 * spin, never any information.
 */
export function MasterballBg() {
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return scroll(animate(el, { rotate: 360 }, { ease: "linear" }));
  }, []);

  return (
    <Image
      ref={ref}
      src="/masterball.png"
      alt=""
      width={340}
      height={339}
      priority
      className="pointer-events-none fixed top-[8%] right-[-12%] z-0 h-auto w-[680px] max-w-[70vw] opacity-10 motion-reduce:hidden"
      style={{ willChange: "transform" }}
    />
  );
}
