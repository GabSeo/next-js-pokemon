import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPageContent, type LocaleLink } from "@/components/product-page-content";
import { JAPANESE_MARKET_ENABLED, getGradedMarketData, gradedMarketOffersJsonLd } from "@/lib/graded-market";
import { franchiseLabel, getAllCards, getCardBySlug, getFrenchCardText } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";
import { priceStatement } from "@/lib/price-display";

// 36 hours (must be a literal — Next.js statically parses this export).
// Kept in sync with apitcg.ts's REVALIDATE_SECONDS.
export const revalidate = 129600;

export async function generateStaticParams() {
  const cards = await getAllCards();
  return cards.map((card) => ({ slug: card.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) return {};

  // Only claim an "fr" alternate when a real TCGdex translation exists —
  // an hreflang pointing at a URL that doesn't get built (see the /fr
  // route's dynamicParams = false) would be worse than not listing it.
  const fr = await getFrenchCardText(card);
  const languages: Record<string, string> = {
    "x-default": absoluteUrl(`/products/${card.slug}`),
    en: absoluteUrl(`/products/${card.slug}`),
  };
  if (fr.translated) languages.fr = absoluteUrl(`/products/${card.slug}/fr`);

  return {
    title: `${card.name} (${card.number ?? ""}) price`,
    description: `${card.name} — ${card.set} ${card.number ?? ""}. ${priceStatement(card)}`,
    alternates: {
      canonical: `/products/${card.slug}`,
      languages,
      types: { "text/markdown": `/products/${card.slug}/index.md` },
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) notFound();

  const label = franchiseLabel(card.franchise);
  const fr = await getFrenchCardText(card);
  const gradedMarket = await getGradedMarketData(card);

  // An Offer with the placeholder price would publish "this card costs 0
  // USD" as structured data — the one representation search engines and
  // assistants are most likely to quote without the page's own caveat next
  // to it — so a card with no readable price contributes no canonical
  // offer. Real eBay/Vinted listings (each carrying its own real price) are
  // unaffected by apitcg/TCGdex being down and still get included either
  // way. If neither source has anything real, `offers` is omitted entirely
  // rather than published as an empty array.
  const offers = [
    ...(card.priceUnavailable
      ? []
      : [
          {
            "@type": "Offer" as const,
            price: card.currentPrice,
            priceCurrency: card.currency,
            priceValidUntil: card.asOfDate,
            availability: "https://schema.org/InStock",
            url: absoluteUrl(`/products/${card.slug}`),
          },
        ]),
    ...gradedMarketOffersJsonLd(gradedMarket),
  ];

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: card.name,
    sku: card.id,
    category: label,
    description: card.description ?? `${card.name} — ${card.set} ${card.number ?? ""}`,
    url: absoluteUrl(`/products/${card.slug}`),
    ...(offers.length > 0 ? { offers } : {}),
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      {
        "@type": "ListItem",
        position: 2,
        name: `${label} collection`,
        item: absoluteUrl(`/collections/${card.franchise}`),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: card.name,
        item: absoluteUrl(`/products/${card.slug}`),
      },
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `How much is ${card.name} (${card.number ?? ""}) worth right now?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: card.priceUnavailable
            ? `The market price for ${card.name} (${card.set}, ${card.number ?? ""}) is temporarily unavailable — no price source could be reached.`
            : `The current market price for ${card.name} (${card.set}, ${card.number ?? ""}) is ${card.currency} ${card.currentPrice} as of ${card.asOfDate}, sourced from TCGPlayer.`,
        },
      },
    ],
  };

  const localeLinks: LocaleLink[] = [
    { code: "US", href: `/products/${card.slug}`, active: true },
    ...(fr.translated ? [{ code: "FR", href: `/products/${card.slug}/fr`, active: false }] : []),
    ...(JAPANESE_MARKET_ENABLED ? [{ code: "JP", href: `/products/${card.slug}/ja`, active: false }] : []),
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
      structuredData={{ product: productJsonLd, breadcrumb: breadcrumbJsonLd, faq: faqJsonLd }}
    />
  );
}
