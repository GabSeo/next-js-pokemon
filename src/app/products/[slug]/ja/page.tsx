import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPageContent, type LocaleLink } from "@/components/product-page-content";
import { franchiseLabel, getAllCards, getCardBySlug, getFrenchCardText } from "@/lib/cards";

// Same window as the base product page — see its own comment.
export const revalidate = 129600;

export async function generateStaticParams() {
  const cards = await getAllCards();
  return cards.map((card) => ({ slug: card.slug }));
}

export const dynamicParams = false;

type PageProps = { params: Promise<{ slug: string }> };

/**
 * NOT a Japanese-language page. No source wired into this codebase has a
 * real Japanese card name, set name, or card image — TCGdex has zero
 * Japanese coverage at all (confirmed live: api.tcgdex.net/v2/ja/... and
 * assets.tcgdex.net/ja/... both 404, not just undocumented), and neither
 * apitcg nor TCGGO carry one either. Every identity field here is exactly
 * the English original — see ProductPageContent's `displayCard === card`
 * below — so this route makes no hreflang="ja" claim and canonicalizes back
 * to the English page rather than asserting itself as distinct content.
 *
 * What it's actually for: a real, reachable URL whose Graded Market panel
 * opens straight to the Japanese eBay tab (real active-listing data,
 * already live via lib/graded-market.ts) — a dedicated jumping-off point
 * for building an eBay.jp query workflow later, not an SEO play.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) return {};

  return {
    title: `${card.name} (${card.number ?? ""}) — Japan market data`,
    description: `Japanese active-listing eBay data for ${card.name} — ${card.set} ${card.number ?? ""}.`,
    alternates: {
      canonical: `/products/${card.slug}`,
    },
    robots: { index: false, follow: true },
  };
}

export default async function ProductPageJapan({ params }: PageProps) {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) notFound();

  const label = franchiseLabel(card.franchise);
  const fr = await getFrenchCardText(card);

  const localeLinks: LocaleLink[] = [
    { code: "US", href: `/products/${card.slug}`, active: false },
    ...(fr.translated ? [{ code: "FR", href: `/products/${card.slug}/fr`, active: false }] : []),
    { code: "JP", href: `/products/${card.slug}/ja`, active: true },
  ];

  return (
    <ProductPageContent
      card={card}
      displayCard={card}
      franchiseLabel={label}
      collectionHref={`/collections/${card.franchise}`}
      markdownHref={`/products/${card.slug}/index.md`}
      jsonHref={`/api/${card.franchise}/${card.id}`}
      okfHref={`/okf/products/${card.slug}`}
      localeLinks={localeLinks}
      defaultGradedMarketLanguage="Japanese"
    />
  );
}
