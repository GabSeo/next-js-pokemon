import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPageContent, type LocaleLink } from "@/components/product-page-content";
import { cardRefs } from "@/data/card-refs";
import { franchiseLabel, getAllCards, getCardBySlug, getFrenchCardText, getOnePieceJapaneseText } from "@/lib/cards";
import { JAPANESE_MARKET_ENABLED } from "@/lib/graded-market";
import type { Card } from "@/lib/types";

// Same window as the base product page — see its own comment.
export const revalidate = 129600;

/**
 * One /ja route, two genuinely different things behind it — see this file's
 * own default-export doc comment for the full explanation. Pokémon: gated
 * behind JAPANESE_MARKET_ENABLED, no real Japanese identity source exists
 * yet (TCGdex has zero Japanese coverage). One Piece: real BerryWallet
 * Japanese identity, built for whichever refs actually have a real match —
 * same "only build what's real" gate /fr's own generateStaticParams uses
 * for fr.translated.
 */
export async function generateStaticParams() {
  const cards = await getAllCards();
  const params: { slug: string }[] = [];

  if (JAPANESE_MARKET_ENABLED) {
    params.push(...cards.filter((c) => c.franchise === "pokemon").map((c) => ({ slug: c.slug })));
  }

  const oneRefs = cardRefs.filter((r) => r.franchise === "one-piece" && r.berryWalletEnabled);
  for (const ref of oneRefs) {
    const card = cards.find((c) => c.slug === ref.slug);
    if (!card) continue;
    const ja = await getOnePieceJapaneseText(card, ref);
    if (ja.translated) params.push({ slug: ref.slug });
  }

  return params;
}

export const dynamicParams = false;

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Two different things behind one route, by franchise:
 *
 * Pokémon: NOT a Japanese-language page. No source wired into this codebase
 * has real Japanese Pokémon identity — TCGdex has zero Japanese coverage at
 * all (confirmed live: api.tcgdex.net/v2/ja/... and assets.tcgdex.net/ja/...
 * both 404, not just undocumented), and neither apitcg nor TCGGO carry one
 * either. Every identity field here is exactly the English original — see
 * `displayCard === card` in that branch below — so this route makes no
 * hreflang="ja" claim and canonicalizes back to the English page. What it's
 * actually for: a real, reachable URL whose Graded Market panel opens
 * straight to the Japanese eBay tab — a jumping-off point for an eBay.jp
 * query workflow later, not an SEO play.
 *
 * One Piece: a REAL Japanese-language page — genuine BerryWallet-sourced
 * name/set/rarity/image, the One Piece counterpart to the Pokémon /fr route
 * (see getOnePieceJapaneseText's own doc comment). Canonicalizes to the
 * English page too, but for a different reason: the canonical page is
 * always English by design (see data/card-refs.ts's berryWalletEnabled
 * comment), not because this page's content isn't real.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) return {};

  if (card.franchise === "one-piece") {
    const ref = cardRefs.find((r) => r.slug === slug);
    if (!ref) return {};
    const ja = await getOnePieceJapaneseText(card, ref);
    if (!ja.translated) return {};
    return {
      title: `${ja.name} (${card.number ?? ""}) — 日本語`,
      description: `${ja.name} — ${ja.set} ${card.number ?? ""}.`,
      alternates: {
        canonical: `/products/${card.slug}`,
        languages: { "x-default": `/products/${card.slug}`, en: `/products/${card.slug}`, ja: `/products/${card.slug}/ja` },
        types: { "text/markdown": `/products/${card.slug}/ja/index.md` },
      },
    };
  }

  if (!JAPANESE_MARKET_ENABLED) return {};
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

  if (card.franchise === "one-piece") {
    const ref = cardRefs.find((r) => r.slug === slug);
    if (!ref) notFound();
    const ja = await getOnePieceJapaneseText(card, ref);
    if (!ja.translated) notFound();

    const displayCard: Card = { ...card, name: ja.name, set: ja.set, rarity: ja.rarity, imageUrl: ja.imageUrl };
    const localeLinks: LocaleLink[] = [
      { code: "US", href: `/products/${card.slug}`, active: false },
      { code: "JP", href: `/products/${card.slug}/ja`, active: true },
      { code: "FR", active: false, disabled: true },
    ];

    return (
      <ProductPageContent
        card={card}
        displayCard={displayCard}
        franchiseLabel={label}
        collectionHref={`/collections/${card.franchise}`}
        markdownHref={`/products/${card.slug}/ja/index.md`}
        jsonHref={`/api/${card.franchise}/${card.id}`}
        okfHref={`/okf/products/${card.slug}`}
        localeLinks={localeLinks}
      />
    );
  }

  if (!JAPANESE_MARKET_ENABLED) notFound();
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
      defaultMarketTab="Japanese"
    />
  );
}
