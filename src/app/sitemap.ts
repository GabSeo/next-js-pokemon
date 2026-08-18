import type { MetadataRoute } from "next";
import { getAllCards } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const cards = await getAllCards();

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

  const productEntries: MetadataRoute.Sitemap = cards.flatMap((card) => [
    { url: absoluteUrl(`/products/${card.slug}`) },
    { url: absoluteUrl(`/products/${card.slug}/index.md`) },
  ]);

  return [...staticEntries, ...productEntries];
}
