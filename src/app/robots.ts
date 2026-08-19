import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const dataPaths = ["/api/", "/*.md", "/llms.txt", "/.well-known/"];

  return {
    rules: [
      { userAgent: "Googlebot", allow: ["/", ...dataPaths] },
      { userAgent: "GPTBot", allow: ["/", ...dataPaths] },
      { userAgent: "ClaudeBot", allow: ["/", ...dataPaths] },
      { userAgent: "PerplexityBot", allow: ["/", ...dataPaths] },
      { userAgent: "Google-Extended", allow: "/" },
      { userAgent: "*", allow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
