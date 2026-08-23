import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPageContent, type LocaleLink } from "@/components/product-page-content";
import { JAPANESE_MARKET_ENABLED } from "@/lib/graded-market";
import { franchiseLabel, getAllCards, getCardBySlug, getFrenchCardText } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";
import type { Card } from "@/lib/types";

// Same window as the base product page — see its own comment.
export const revalidate = 129600;

export async function generateStaticParams() {
  const cards = await getAllCards();
  const withFrench = await Promise.all(cards.map(async (card) => ({ slug: card.slug, fr: await getFrenchCardText(card) })));
  return withFrench.filter((c) => c.fr.translated).map((c) => ({ slug: c.slug }));
}

// No French route for a card TCGdex can't translate (any One Piece card —
// TCGdex has zero coverage — or a Pokémon card with no TCGdex match): an
// on-demand render would just notFound() anyway, this makes it explicit and
// avoids the cost of trying.
export const dynamicParams = false;

type PageProps = { params: Promise<{ slug: string }> };

async function resolveFrench(slug: string) {
  const card = await getCardBySlug(slug);
  if (!card) return undefined;
  const fr = await getFrenchCardText(card);
  if (!fr.translated) return undefined;
  return { card, fr };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveFrench(slug);
  if (!resolved) return {};
  const { card, fr } = resolved;

  return {
    title: `${fr.name} (${card.number ?? ""}) prix`,
    description: `${fr.name} — ${fr.set} ${card.number ?? ""}. Prix actuel du marché : ${card.currency} ${card.currentPrice} au ${card.asOfDate}.`,
    alternates: {
      canonical: `/products/${card.slug}/fr`,
      languages: {
        "x-default": absoluteUrl(`/products/${card.slug}`),
        en: absoluteUrl(`/products/${card.slug}`),
        fr: absoluteUrl(`/products/${card.slug}/fr`),
      },
      types: { "text/markdown": `/products/${card.slug}/fr/index.md` },
    },
  };
}

/**
 * Real, distinct French page — a genuine TCGdex-sourced name/set/rarity/
 * image, not English text with hreflang="fr" slapped on it (see the
 * conversation that led here: Google's own guidance treats that as a weak,
 * arguably misleading signal). What's still English on purpose: the
 * surrounding UI chrome (labels, price-panel headings) and card.description
 * — no French source exists for either, and inventing one would be exactly
 * the kind of fabrication this site's real/illustrative honesty rules exist
 * to prevent elsewhere (see lib/illustrative.ts).
 */
export default async function ProductPageFrench({ params }: PageProps) {
  const { slug } = await params;
  const resolved = await resolveFrench(slug);
  if (!resolved) notFound();
  const { card, fr } = resolved;

  const displayCard: Card = { ...card, name: fr.name, set: fr.set, rarity: fr.rarity, imageUrl: fr.imageUrl, types: fr.types };
  const label = franchiseLabel(card.franchise);

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: fr.name,
    sku: card.id,
    category: label,
    description: card.description ?? `${fr.name} — ${fr.set} ${card.number ?? ""}`,
    url: absoluteUrl(`/products/${card.slug}/fr`),
    offers: {
      "@type": "Offer",
      price: card.currentPrice,
      priceCurrency: card.currency,
      priceValidUntil: card.asOfDate,
      availability: "https://schema.org/InStock",
      url: absoluteUrl(`/products/${card.slug}/fr`),
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
        name: fr.name,
        item: absoluteUrl(`/products/${card.slug}/fr`),
      },
    ],
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `How much is ${fr.name} (${card.number ?? ""}) worth right now?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `The current market price for ${fr.name} (${fr.set}, ${card.number ?? ""}) is ${card.currency} ${card.currentPrice} as of ${card.asOfDate}, sourced from TCGPlayer.`,
        },
      },
    ],
  };

  const localeLinks: LocaleLink[] = [
    { code: "US", href: `/products/${card.slug}`, active: false },
    { code: "FR", href: `/products/${card.slug}/fr`, active: true },
    ...(JAPANESE_MARKET_ENABLED ? [{ code: "JP", href: `/products/${card.slug}/ja`, active: false }] : []),
  ];

  return (
    <ProductPageContent
      card={card}
      displayCard={displayCard}
      franchiseLabel={label}
      collectionHref={`/collections/${card.franchise}`}
      markdownHref={`/products/${card.slug}/fr/index.md`}
      jsonHref={`/api/${card.franchise}/${card.id}`}
      okfHref={`/okf/products/${card.slug}`}
      localeLinks={localeLinks}
      defaultMarketTab="France"
      structuredData={{ product: productJsonLd, breadcrumb: breadcrumbJsonLd, faq: faqJsonLd }}
    />
  );
}
