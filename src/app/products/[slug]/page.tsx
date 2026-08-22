import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPageContent, type LocaleLink } from "@/components/product-page-content";
import { franchiseLabel, getAllCards, getCardBySlug, getFrenchCardText } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";

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
    description: `${card.name} — ${card.set} ${card.number ?? ""}. Current market price: ${card.currency} ${card.currentPrice} as of ${card.asOfDate}.`,
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

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: card.name,
    sku: card.id,
    category: label,
    description: card.description ?? `${card.name} — ${card.set} ${card.number ?? ""}`,
    url: absoluteUrl(`/products/${card.slug}`),
    offers: {
      "@type": "Offer",
      price: card.currentPrice,
      priceCurrency: card.currency,
      priceValidUntil: card.asOfDate,
      availability: "https://schema.org/InStock",
      url: absoluteUrl(`/products/${card.slug}`),
    },
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
          text: `The current market price for ${card.name} (${card.set}, ${card.number ?? ""}) is ${card.currency} ${card.currentPrice} as of ${card.asOfDate}, sourced from TCGPlayer.`,
        },
      },
    ],
  };

  const localeLinks: LocaleLink[] = [
    { code: "US", flag: "🇺🇸", href: `/products/${card.slug}`, active: true },
    ...(fr.translated ? [{ code: "FR", flag: "🇫🇷", href: `/products/${card.slug}/fr`, active: false }] : []),
    { code: "JP", flag: "🇯🇵", href: `/products/${card.slug}/ja`, active: false },
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
