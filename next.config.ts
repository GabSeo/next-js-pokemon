import type { NextConfig } from "next";

// Duplicated from lib/site.ts rather than imported — next.config.ts loads
// outside the app's normal module graph, so this stays self-contained
// instead of risking a build-time resolution issue with the @/ path alias.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
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
    ];
  },
};

export default nextConfig;
