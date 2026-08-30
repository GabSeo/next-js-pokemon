export const SITE_NAME = "CardTrace";
export const SITE_DESCRIPTION =
  "Agent-readable Pokémon and One Piece TCG card catalog with live last-sold price tracking.";
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

/** Bare hostname (no protocol, no port) — the identifier segment did:web and every ARD URN are built from. */
export function siteHost(): string {
  return new URL(SITE_URL).hostname;
}

/**
 * How long a surface carrying market data stays valid, in seconds.
 *
 * MUST match `export const revalidate` on the routes serving it — all 86400.
 * Next statically parses that export and requires a literal, so it cannot be
 * imported from here; this is a deliberate mirror.
 */
export const CONTENT_REVALIDATE_SECONDS = 86_400;

/**
 * When this copy was built, and when a consumer should come back.
 *
 * Exists because the three agent-facing surfaces each answered the freshness
 * question differently, and two of them did not answer it at all: only OKF
 * carried `generated`/`stale_after`, and its promise was seven days against a
 * 24-hour window. Markdown and JSON said nothing, so an agent could not tell
 * how old its copy was or when to return.
 *
 * Distinct from a card's `asOfDate`, which is the UPSTREAM's pricing
 * timestamp (when TCGplayer last priced the card) — neither our fetch time
 * nor our generation time, and not a statement about this document.
 */
export function freshness(now: Date = new Date()): { generated: string; refreshBy: string } {
  return {
    generated: now.toISOString(),
    refreshBy: new Date(now.getTime() + CONTENT_REVALIDATE_SECONDS * 1000).toISOString(),
  };
}
