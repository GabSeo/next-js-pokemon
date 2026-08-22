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

  // French variant — real, canonical-to-itself content (see
  // /products/[slug]/fr/page.tsx), so it belongs in the sitemap like any
  // other indexable page. Gated on `tcg === "pokemon"` rather than a live
  // TCGdex call, matching this file's existing "no live calls" design (the
  // comment above on why price data doesn't belong here applies the same
  // way to a translation lookup) — safe today since every current Pokémon
  // ref is confirmed to resolve a real TCGdex match; a future Pokémon ref
  // that TCGdex can't translate would need this gate tightened.
  //
  // /ja is deliberately NOT listed here: it canonicalizes back to the
  // English page (see that route's own doc comment) rather than asserting
  // itself as separately-indexable content, and a sitemap should only ever
  // list canonical URLs.
  const frenchEntries: MetadataRoute.Sitemap = cardRefs
    .filter((ref) => ref.tcg === "pokemon")
    .flatMap((ref) => [
      { url: absoluteUrl(`/products/${ref.slug}/fr`) },
      { url: absoluteUrl(`/products/${ref.slug}/fr/index.md`) },
    ]);

  return [...staticEntries, ...productEntries, ...frenchEntries];
}
