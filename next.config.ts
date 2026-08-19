import type { NextConfig } from "next";

// Duplicated from lib/site.ts rather than imported — next.config.ts loads
// outside the app's normal module graph, so this stays self-contained
// instead of risking a build-time resolution issue with the @/ path alias.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // ARD discovery signal on every response, mirroring the <link
        // rel="ai-catalog"> tag in the root layout's <head> — an agent
        // scanning headers before bothering with HTML finds it either way.
        source: "/:path*",
        headers: [
          {
            key: "Link",
            value: `<${new URL("/.well-known/ai-catalog.json", SITE_URL).toString()}>; rel="ai-catalog"`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
