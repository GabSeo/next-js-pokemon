/**
 * Decorating a One Piece image URL with a width — the rule, and only the rule.
 *
 * WHY ITS OWN FILE. `lib/one-piece-images.ts` answers "where is this printing's
 * artwork", which means reading the directory of repatriated files, which means
 * `node:fs`, which means no client component can import it. But the scan grid
 * IS a client component and it needs the same rule, so it carried its own copy
 * and got it wrong the same way the card page did:
 *
 *   /card-images/one-piece/OP09-061_pr1.webp&w=320   ->  404
 *
 * A repatriated file is one width on disk and cannot be resized per request; a
 * proxied image can. Nothing here touches the filesystem, so both sides of the
 * boundary can share the single copy of that distinction rather than each
 * keeping one.
 */

/** Widths /api/one-piece-image accepts. Any other width is a 400 from that route. */
export const ONE_PIECE_IMAGE_WIDTHS = [320, 480, 640];

/** A URL the image route serves, and can therefore resize. */
function isProxied(url: string): boolean {
  return url.startsWith("/api/one-piece-image/");
}

/** The URL to request at one width — returned unchanged for a file we cannot resize. */
export function onePieceSrc(url: string, width: number): string {
  return isProxied(url) ? `${url}&w=${width}` : url;
}

/** A srcset, or undefined when offering one would make the browser fetch the same bytes three times. */
export function onePieceSrcSet(url: string): string | undefined {
  if (!isProxied(url)) return undefined;
  return ONE_PIECE_IMAGE_WIDTHS.map((w) => `${onePieceSrc(url, w)} ${w}w`).join(", ");
}
