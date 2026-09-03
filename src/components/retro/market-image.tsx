"use client";

import { useState } from "react";
import { MARKET_ASSET_FALLBACK, type MarketAsset } from "@/lib/market-assets";

/**
 * One image slot in the market section — a real `<img>`, in a box that never
 * moves.
 *
 * THREE THINGS THIS GUARANTEES, all of them about the preview surviving the
 * assets it does not have yet:
 *
 * 1. The box is reserved before the file loads. `width`/`height` are the
 *    asset's own intrinsic box from lib/market-assets.ts, set as attributes
 *    and as inline dimensions, so the row is laid out at its final size on
 *    first paint whether the image arrives, arrives late, or never arrives.
 *    Swapping a placeholder for the final artwork is then a file change and
 *    nothing else.
 * 2. A missing file never shows a broken-image icon. `onError` swaps in the
 *    neutral placeholder once — `once` matters, because a fallback that
 *    itself fails would otherwise loop.
 * 3. A placeholder looks like a placeholder. While `asset.placeholder` is
 *    true the slot carries a muted tint, so nobody mistakes the stand-in for
 *    finished artwork in a review.
 *
 * `next/image` deliberately not used here: these are small fixed-size local
 * SVGs and one PNG, so there is no responsive variant to pick, and the
 * optimizer refuses SVG outright unless `dangerouslyAllowSVG` is turned on
 * globally (next.config.ts) — a site-wide loosening to render four
 * decorations. The same reasoning and the same eslint exemption the eBay
 * wordmark already carries in graded-market-tabs.tsx.
 */
export function MarketImage({ asset, className = "" }: { asset: MarketAsset; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? MARKET_ASSET_FALLBACK : asset.src;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- fixed-size local asset, no responsive variants to pick; see this file's header
    <img
      alt={asset.alt}
      className={`object-contain ${asset.placeholder ? "opacity-90" : ""} ${className}`}
      decoding="async"
      height={asset.height}
      loading="lazy"
      onError={() => setFailed(true)}
      src={src}
      style={{ width: asset.width, height: asset.height }}
      width={asset.width}
    />
  );
}
