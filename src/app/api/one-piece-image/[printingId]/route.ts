import sharp from "sharp";

import { officialImageUrl } from "@/lib/one-piece-official";

/**
 * Serves one Bandai card image, resized and re-encoded, for free.
 *
 * WHY A PROXY IS REQUIRED AT ALL. Bandai sends every card image with
 * `Cross-Origin-Resource-Policy: same-site`, so a browser refuses to paint one
 * on our domain — measured, all 319 tiles of a pack page came back
 * `ERR_BLOCKED_BY_RESPONSE.NotSameSite` with `naturalWidth` 0. That header
 * constrains BROWSERS, not servers: a server-side fetch of the same URL is a
 * plain 200 (re-verified 2026-09-07, 247,155 bytes, `image/png`). So the bytes
 * are reachable; only the browser's direct path to them is not.
 *
 * WHY OURS AND NOT SOMEBODY ELSE'S. `arjunkai/optcg-api` advertises a public
 * card-image proxy and was evaluated as a way to skip this file. Both its
 * `/image/…` and `/v1/images/…` endpoints answer **401** — gated to their own
 * origins, key on request. Depending on one person's Cloudflare worker for
 * every image on the site is a larger commitment than this route.
 *
 * WHY IT RESIZES HERE RATHER THAN THROUGH next/image. Bandai publishes exactly
 * one size — ~285 KB of PNG per printing, no thumbnail, and no webp outside the
 * French feed — so a 319-tile pack page is ~90 MB untouched and something must
 * resize. `next/image` would do it, and the BerryWallet proxy is consumed that
 * way, but that spends Vercel's Image Optimization quota: a METERED resource
 * that `lib/api-budget.ts` cannot see, on a page any free user can open. The
 * premise of the free tier is that a free surface cannot spend a metered
 * resource, and a meter our own budget report is blind to is worse than one it
 * tracks, not better. sharp costs CPU once per (printing, width) and the CDN
 * serves every hit after — see docs/free-tier-catalogue.md §7.
 *
 * WHY IT COSTS NO API QUOTA EITHER. `onepiece-cardgame.com` has no ceiling in
 * lib/api-budget.ts. The One Piece images we serve elsewhere today go through
 * `/api/berrywallet-image`, whose `fetchCardImage` charges the 90/hour
 * BerryWallet budget PER IMAGE; a free user opening one candidate grid could
 * spend nine of them on pictures. This route exists so a free surface never
 * can. It deliberately does not import `resilientFetch` either: that would put
 * a metered module on a free route's import graph and trip
 * `scripts/check-free-tier.mts`, correctly.
 *
 * THE ID IS VALIDATED BY LOOKUP, NOT BY PATTERN. `officialImageUrl` resolves
 * through the crawled catalogue and returns undefined for anything it does not
 * hold, so a crafted `printingId` cannot turn this into an open proxy for
 * arbitrary paths on Bandai's domain. Language matters as much as the id: the
 * same printing is different bytes per language, and French is `.webp` where
 * English is `.png`, so both come from the catalogue rather than a template.
 */

// sharp is a native module; say so rather than relying on the default.
export const runtime = "nodejs";

// One year. A printing's artwork does not change; a new printing is a new id.
export const revalidate = 31536000;

const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * The only widths this route will produce.
 *
 * An allowlist rather than a clamp, and both halves matter: an open `?w=`
 * multiplies the CDN's cache entries per card by however many integers a
 * caller cares to send, and each miss is a real resize. Five sizes cover the
 * grid at 1x and 2x — it is 2 columns on mobile, 4 at `lg`, on tiles that never
 * exceed ~300 CSS px.
 */
const WIDTHS = [160, 240, 320, 480, 640] as const;

/** webp at this quality is visually clean on card art and ~5x lighter than the source PNG. */
const WEBP_QUALITY = 72;

export async function GET(request: Request, { params }: { params: Promise<{ printingId: string }> }) {
  const { printingId } = await params;
  const query = new URL(request.url).searchParams;
  const language = query.get("lang") ?? "english";

  const requested = Number(query.get("w"));
  const width = WIDTHS.find((w) => w === requested);
  if (query.has("w") && !width) {
    return new Response(`Unsupported width. Use one of: ${WIDTHS.join(", ")}`, { status: 400 });
  }

  const upstream = officialImageUrl(printingId, language);
  if (!upstream) {
    return new Response("Unknown printing", { status: 404 });
  }

  let response: Response;
  try {
    response = await fetch(upstream, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      // Bandai serves these to ordinary page loads; asking as one avoids
      // looking like something to rate-limit.
      headers: { Accept: "image/avif,image/webp,image/png,*/*" },
      // CACHE THE SOURCE, not just our output. Measured 2026-09-07 against a
      // preview deploy: the round trip to Bandai is 593 ms average while the
      // resize is 37 ms, so 94% of a cold request is spent fetching a file that
      // never changes. Without this, the five widths in the tile's srcset are
      // five separate downloads of the same PNG, and every CDN eviction pays
      // full price again. With it, a printing is fetched once and each
      // additional width costs only the 37 ms.
      //
      // `force-cache` EXPLICITLY, not a `next.revalidate` TTL, because this
      // route reads `request.url` first: per the bundled guide (02-guides/
      // caching-without-cache-components.md:111) Next does not cache a fetch
      // discovered AFTER a request-time API unless the request says so itself.
      // Never revalidating is correct here — a printing's artwork is immutable,
      // Bandai issues a new id rather than repainting one — and at 137–206 KB
      // the response sits well inside the Data Cache's per-entry limit.
      cache: "force-cache",
    });
  } catch {
    // A timeout or a network fault is upstream's, not a missing card. 502 keeps
    // those distinguishable in logs from the 404 above.
    return new Response("Upstream unavailable", { status: 502 });
  }

  if (!response.ok) {
    return new Response("Upstream error", { status: 502 });
  }

  const source = Buffer.from(await response.arrayBuffer());

  // No width asked for: hand back exactly what Bandai sent. Callers that want
  // the full-resolution original (a card detail view, a download) should not
  // have it silently re-encoded.
  if (!width) {
    return new Response(new Uint8Array(source), {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  let resized: Buffer;
  try {
    resized = await sharp(source)
      // `withoutEnlargement` so a source smaller than the requested width is
      // passed through at its own size rather than upscaled into blur.
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    // A source sharp cannot decode is still a real card. Serve the original
    // rather than a 500 — heavier, but correct, and it stays visible.
    return new Response(new Uint8Array(source), {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  return new Response(new Uint8Array(resized), {
    headers: {
      "Content-Type": "image/webp",
      // Stated here rather than inherited, so this route's contract holds
      // whatever upstream happens to send on a given request.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
