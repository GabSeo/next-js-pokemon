import sharp from "sharp";

import { japaneseOfficialCard } from "@/lib/pokemon-ja-official";

/**
 * Serve a Japanese Pokemon card's official artwork, resized, without hotlinking.
 *
 * WHY A PROXY RATHER THAN THE URL ITSELF. The official site sets no hotlink
 * protection, so `<img src="https://www.pokemon-card.com/...">` would work —
 * and would put every page view on their servers, at 129 KB of JPEG where 60 KB
 * of webp does the job. This is the arrangement app/api/one-piece-image already
 * has with Bandai, for the same reasons and with the same shape.
 *
 * WHY NOT REPATRIATE, when One Piece's promos were. There the pictures existed
 * nowhere else and the corpus was 945 files; here it is 4,569 official scans at
 * ~270 MB, and the publisher serves them reliably. Copying that into the
 * repository would be a different kind of claim over somebody else's artwork
 * for no availability gained.
 *
 * FREE ROUTE. Imports `sharp` and one tier-1 loader — no market client, so
 * scripts/check-free-tier.mts can prove it spends no quota.
 *
 * THE PATH IS `setId#localId` (url-encoded), the same key the catalogue joins
 * on, so a caller never has to know the official site's internal card ids.
 */

export const runtime = "nodejs";

/** A card's artwork does not change; the publisher issues a new card instead. */
export const revalidate = 31536000;

const UPSTREAM_TIMEOUT_MS = 10_000;

/** Kept in step with the One Piece route: same grid, same viewports, same cache-density argument. */
const WIDTHS = [320, 480, 640] as const;

const WEBP_QUALITY = 72;

export async function GET(request: Request, { params }: { params: Promise<{ cardKey: string }> }) {
  const { cardKey } = await params;
  const decoded = decodeURIComponent(cardKey);
  const hash = decoded.lastIndexOf("#");
  if (hash <= 0) return new Response("Expected setId#number", { status: 400 });

  const card = japaneseOfficialCard(decoded.slice(0, hash), decoded.slice(hash + 1));
  if (!card) return new Response("Unknown card", { status: 404 });

  const query = new URL(request.url).searchParams;
  const requested = Number(query.get("w"));
  const width = WIDTHS.find((w) => w === requested);
  if (query.has("w") && !width) {
    return new Response(`Unsupported width. Use one of: ${WIDTHS.join(", ")}`, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(card.img, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { Accept: "image/avif,image/webp,image/jpeg,*/*" },
      // Cache the SOURCE, not just our output — the fetch dominates a cold
      // request and the file never changes. `force-cache` explicitly, because
      // this route reads `request.url` before the fetch and Next does not
      // cache a fetch discovered after a request-time API unless told to.
      cache: "force-cache",
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }

  if (!response.ok) return new Response("Upstream error", { status: 502 });

  const source = Buffer.from(await response.arrayBuffer());
  const passthrough = () =>
    new Response(new Uint8Array(source), {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });

  if (!width) return passthrough();

  try {
    const resized = await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return new Response(new Uint8Array(resized), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    // A source sharp cannot decode is still a real card: heavier, but visible.
    return passthrough();
  }
}
