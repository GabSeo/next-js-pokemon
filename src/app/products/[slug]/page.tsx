import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPageContent, type LocaleVariant } from "@/components/product-page-content";
import { getGradedMarketData, gradedMarketOffersJsonLd } from "@/lib/graded-market";
import { franchiseLabel, getAllCards, getCardBySlug, getFrenchCardText, getJapaneseCardText, getOnePieceJapaneseText } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";
import { priceStatement } from "@/lib/price-display";
import { cardRefs } from "@/data/card-refs";
import type { Card } from "@/lib/types";

// 24 hours (must be a literal — Next.js statically parses this export).
// Kept in sync with apitcg.ts's REVALIDATE_SECONDS.
export const revalidate = 86400;

export async function generateStaticParams() {
  const cards = await getAllCards();
  return cards.map((card) => ({ slug: card.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };

/**
 * The card's French and Japanese *display* identity, resolved once and
 * shared by generateMetadata and the page body — both run in the same
 * request scope, so the `cache()` wrappers inside cards.ts collapse this to
 * a single real resolution per card per render, and buildCached collapses
 * it further to one per card per build (see lib/build-cache.ts).
 *
 * This is the whole product page's translation cost, and it is the same
 * cost the page already paid before the /fr and /ja routes were removed —
 * it needed both answers then too, to decide whether each flag in the
 * toggle was a live link or an inert placeholder. What went away with those
 * routes is four *additional* static-generation render scopes per card
 * (/fr, /fr/index.md, /ja, /ja/index.md — each with its own
 * generateStaticParams as well as its own render), every one of which could
 * pay for the same PokéWallet/BerryWallet lookup again on a different build
 * worker. See components/product-locale.tsx's header comment for the full
 * accounting and docs/i18n-deferred.md for what a real per-language-URL
 * implementation has to restore.
 */
async function localeVariantsFor(card: Card): Promise<LocaleVariant[]> {
  const ref = cardRefs.find((r) => r.slug === card.slug);

  // French: TCGdex only, and TCGdex has zero One Piece coverage — confirmed
  // live, BerryWallet has no French sets either, so a One Piece card has no
  // French source anywhere and its FR toggle is permanently inert rather
  // than a fabricated translation (see lib/berrywallet.ts's file header).
  const fr = await getFrenchCardText(card);

  // Japanese: PokéWallet for Pokémon (via the hand-confirmed
  // pokeWalletCardId on the ref), BerryWallet for One Piece. Both are real,
  // separately-catalogued Japanese prints with their own numbers, never a
  // translation of the English row.
  const ja = ref
    ? card.franchise === "one-piece"
      ? await getOnePieceJapaneseText(card, ref)
      : await getJapaneseCardText(card, ref)
    : undefined;

  // Fixed US -> FR -> JP order regardless of franchise or which entries are
  // real — a flag's position shifting depending on the page (confirmed
  // live: One Piece was rendering JP before FR while Pokémon rendered it
  // after) reads as a UI bug even when every individual state is correct.
  return [
    { code: "US", card, available: true },
    {
      code: "FR",
      available: fr.translated,
      card: fr.translated
        ? {
            ...card,
            name: fr.name,
            set: fr.set,
            rarity: fr.rarity,
            imageUrl: fr.imageUrl,
            types: fr.types,
            number: fr.number ?? card.number,
            setCode: fr.setCode ?? card.setCode,
          }
        : card,
    },
    {
      code: "JP",
      available: !!ja?.translated,
      card:
        ja?.translated
          ? {
              ...card,
              name: ja.name,
              // One Piece only (undefined for Pokémon — getJapaneseCardText
              // never sets it): the real Japanese print name, e.g. "Shanks
              // (OP09-004) (V.4)". Falls back to the English card's own
              // printName rather than ja.name so a Pokémon card's H1 is
              // unaffected either way.
              printName: ja.printName ?? card.printName,
              set: ja.set,
              rarity: ja.rarity,
              imageUrl: ja.imageUrl,
              // Genuinely different from the English number for Pokémon
              // (Ethan's Typhlosion is 190/182 internationally and 070/063
              // in its real Japanese set); identical for One Piece, which
              // uses one universal card code across every region.
              number: ja.number ?? card.number,
              setCode: ja.setCode ?? card.setCode,
              // One Piece only — the Japanese print's own real Cardmarket
              // listing (different real numbers and a different real
              // product_url from the English print's, not a relabeling —
              // see getOnePieceJapaneseText's own comment). Falls back to
              // the English card's cardmarket rather than undefined so a
              // Japanese row with no cardmarket block of its own still
              // shows something real instead of the panel disappearing.
              cardmarket: ja.cardmarket ?? card.cardmarket,
            }
          : card,
    },
  ];
}

/**
 * No `languages` / hreflang block, deliberately. There is exactly one
 * indexable URL per card and it is this English one — the French and
 * Japanese identities are rendered into this same page behind a client-side
 * toggle rather than living at their own addresses. Declaring hreflang
 * alternates that point at URLs which no longer exist would be strictly
 * worse than declaring none, which is the same "only claim what's real"
 * rule the old alternates block already followed when it gated each entry
 * on a real translation. docs/i18n-deferred.md records what has to come
 * back — real per-language URLs first, then hreflang on top of them — when
 * that work is picked up.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) return {};

  return {
    title: `${card.name} (${card.number ?? ""}) price`,
    description: `${card.name} — ${card.set} ${card.number ?? ""}. ${priceStatement(card)}`,
    alternates: {
      canonical: `/products/${card.slug}`,
      types: { "text/markdown": `/products/${card.slug}/index.md` },
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) notFound();

  const label = franchiseLabel(card.franchise);
  const gradedMarket = await getGradedMarketData(card);
  const localeVariants = await localeVariantsFor(card);

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

  return (
    <ProductPageContent
      card={card}
      localeVariants={localeVariants}
      franchiseLabel={label}
      collectionHref={`/collections/${card.franchise}`}
      markdownHref={`/products/${card.slug}/index.md`}
      jsonHref={`/api/${card.franchise}/${card.id}`}
      okfHref={`/okf/products/${card.slug}`}
      structuredData={{ product: productJsonLd, breadcrumb: breadcrumbJsonLd, faq: faqJsonLd }}
    />
  );
}
