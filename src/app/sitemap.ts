import type { MetadataRoute } from "next";
import { cardRefs } from "@/data/card-refs";
import { absoluteUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Only slugs are needed to build URLs — no live price data belongs in a
  // sitemap, so this is built from cardRefs instead of resolving the whole
  // catalog against apitcg.com.
  const staticEntries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/") },
    { url: absoluteUrl("/index.md") },
    { url: absoluteUrl("/about") },
    { url: absoluteUrl("/collections/pokemon") },
    { url: absoluteUrl("/collections/pokemon/index.md") },
    { url: absoluteUrl("/collections/one-piece") },
    { url: absoluteUrl("/collections/one-piece/index.md") },
    { url: absoluteUrl("/tools/price-checker") },
    { url: absoluteUrl("/tools/price-checker.md") },
    { url: absoluteUrl("/llms.txt") },
  ];

  const productEntries: MetadataRoute.Sitemap = cardRefs.flatMap((ref) => [
    { url: absoluteUrl(`/products/${ref.slug}`) },
    { url: absoluteUrl(`/products/${ref.slug}/index.md`) },
  ]);

  return [...staticEntries, ...productEntries];
}
