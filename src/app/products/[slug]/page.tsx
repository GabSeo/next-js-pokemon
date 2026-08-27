import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPageContent, type LocaleLink, japanLocaleLink } from "@/components/product-page-content";
import { getGradedMarketData, gradedMarketOffersJsonLd } from "@/lib/graded-market";
import { franchiseLabel, getAllCards, getCardBySlug, getFrenchCardText, getJapaneseCardText, getOnePieceJapaneseText } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";
import { priceStatement } from "@/lib/price-display";
import { cardRefs } from "@/data/card-refs";

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

  // Only claim an "fr"/"ja" alternate when a real translation exists — an
  // hreflang pointing at a URL that doesn't get built (see the /fr and /ja
  // routes' own dynamicParams = false) would be worse than not listing it.
  const fr = await getFrenchCardText(card);
  const languages: Record<string, string> = {
    "x-default": absoluteUrl(`/products/${card.slug}`),
    en: absoluteUrl(`/products/${card.slug}`),
  };
  if (fr.translated) languages.fr = absoluteUrl(`/products/${card.slug}/fr`);
  const metaRef = cardRefs.find((r) => r.slug === card.slug);
  const ja = metaRef
    ? card.franchise === "one-piece"
      ? await getOnePieceJapaneseText(card, metaRef)
      : await getJapaneseCardText(card, metaRef)
    : undefined;
  if (ja?.translated) languages.ja = absoluteUrl(`/products/${card.slug}/ja`);

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

  // One Piece: the canonical page is always English (see data/card-refs.ts's
  // berryWalletEnabled comment on why), and JP is a real link to /ja
  // whenever BerryWallet actually has a Japanese match for this card — same
  // "only link to what's real" rule /fr already follows for Pokémon. FR
  // stays a permanent inert placeholder: confirmed live, BerryWallet has
  // zero French sets, so there's no real source to link to at all (see
  // lib/berrywallet.ts's file header).
  const ref = cardRefs.find((r) => r.slug === card.slug);
  const oneJapanese = card.franchise === "one-piece" && ref ? await getOnePieceJapaneseText(card, ref) : undefined;
  const pokemonJapanese = card.franchise === "pokemon" && ref ? await getJapaneseCardText(card, ref) : undefined;

  // Fixed US -> FR -> JP order everywhere, regardless of franchise or which
  // one is active/real — a flag's position shifting depending on the page
  // (confirmed live: One Piece was rendering JP before FR while Pokémon
  // rendered it after) reads as a UI bug even when every individual state
  // is correct.
  const localeLinks: LocaleLink[] =
    card.franchise === "one-piece"
      ? [
          { code: "US", href: `/products/${card.slug}`, active: true },
          { code: "FR", active: false, disabled: true },
          { code: "JP", href: oneJapanese?.translated ? `/products/${card.slug}/ja` : undefined, active: false, disabled: !oneJapanese?.translated },
        ]
      : [
          { code: "US", href: `/products/${card.slug}`, active: true },
          // Always rendered (even when no real match exists), same reason
          // japanLocaleLink always renders JP — an omitted flag would also
          // shift FR/JP's fixed positions for whichever Pokémon card (none
          // currently) has no real French match.
          { code: "FR", href: fr.translated ? `/products/${card.slug}/fr` : undefined, active: false, disabled: !fr.translated },
          japanLocaleLink(`/products/${card.slug}/ja`, false, !!pokemonJapanese?.translated),
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
