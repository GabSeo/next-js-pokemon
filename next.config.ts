import type { NextConfig } from "next";

// Duplicated from lib/site.ts rather than imported — next.config.ts loads
// outside the app's normal module graph, so this stays self-contained
// instead of risking a build-time resolution issue with the @/ path alias.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  images: {
    // Lets next/image optimize the two real card-image sources (CardImage
    // renders card.imageUrl directly) instead of the plain <img> it used to
    // fall back to — confirmed live via PageSpeed Insights: the TCGdex LCP
    // image on a product page was both over-compressed-for-its-quality-tier
    // and larger than its displayed box (588x825 served vs 535x735 shown,
    // ~54 KiB of avoidable weight on the very asset LCP is measured on).
    // next/image's on-the-fly resizing/re-encoding fixes both at once,
    // instead of hand-picking a smaller TCGdex/apitcg quality tier that
    // wouldn't track the actual rendered size across every layout CardImage
    // appears in (hero, grid tile, homepage feature).
    remotePatterns: [
      { protocol: "https", hostname: "assets.tcgdex.net" },
      { protocol: "https", hostname: "tcgplayer-cdn.tcgplayer.com" },
    ],
  },
  async headers() {
    // rel="index" is the IANA-registered relation for "the index of this
    // resource's collection" — generic crawlers/link-followers that already
    // know standard rel values (not just AI-specific tooling) recognize it.
    // Listed alongside the custom rel="ai-catalog" one so /llms.txt is a
    // single hop from *any* page on the site, not two (page -> ai-catalog.json
    // -> read its documentationUrl field -> llms.txt) — the second hop
    // requires fetching and reasoning over a JSON body, which a client that
    // only follows Link headers will never do.
    const links = [
      { url: "/.well-known/ai-catalog.json", rel: "ai-catalog" },
      { url: "/llms.txt", rel: "index" },
    ]
      .map(({ url, rel }) => `<${new URL(url, SITE_URL).toString()}>; rel="${rel}"`)
      .join(", ");

    return [
      {
        // ARD + llms.txt discovery signal on every response, mirroring the
        // matching <link> tags in the root layout's <head> — an agent
        // scanning headers before bothering with HTML finds it either way.
        source: "/:path*",
        headers: [{ key: "Link", value: links }],
      },
      {
        // Vercel's default for anything under /public is `max-age=0,
        // must-revalidate` (confirmed live) — fine for content that can
        // change, but a real repeat-visit cost (flagged by PageSpeed
        // Insights) for these self-hosted Pokémon Showdown sprites, which
        // never change once downloaded (see vinted-listings-section.tsx's
        // pokemonShowdownSpriteUrl). Safe to mark immutable for exactly
        // that reason — a filename here only ever gets a new GIF by a code
        // change, which is itself a new deployment/URL generation, not a
        // mutation in place.
        source: "/pokemon-sprites/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
