import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPageContent, type LocaleLink } from "@/components/product-page-content";
import { cardRefs } from "@/data/card-refs";
import { franchiseLabel, getAllCards, getCardBySlug, getFrenchCardText, getJapaneseCardText, getOnePieceJapaneseText } from "@/lib/cards";
import { JAPANESE_MARKET_ENABLED } from "@/lib/graded-market";
import type { Card } from "@/lib/types";

// Same window as the base product page — see its own comment.
export const revalidate = 129600;

/**
 * One /ja route, real Japanese identity for both franchises now — see this
 * file's own default-export doc comment for the full explanation. Built for
 * whichever refs actually have a real match: Pokémon via a confirmed
 * `pokeWalletCardId` (see data/card-refs.ts's own doc comment on why that's
 * a stored, hand-confirmed id rather than a live search), One Piece via
 * BerryWallet — same "only build what's real" gate /fr's own
 * generateStaticParams uses for fr.translated.
 */
export async function generateStaticParams() {
  const cards = await getAllCards();
  const params: { slug: string }[] = [];

  const pokemonRefs = cardRefs.filter((r) => r.franchise === "pokemon" && r.pokeWalletCardId);
  for (const ref of pokemonRefs) {
    const card = cards.find((c) => c.slug === ref.slug);
    if (!card) continue;
    const ja = await getJapaneseCardText(card, ref);
    if (ja.translated) params.push({ slug: ref.slug });
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
 * A REAL Japanese-language page for both franchises, when a real source
 * exists — genuine name/set/rarity/image, the counterpart to the /fr route
 * (Pokémon via PokéWallet, see getJapaneseCardText's own doc comment; One
 * Piece via BerryWallet, see getOnePieceJapaneseText's). Canonicalizes to
 * the English page either way: the canonical page is always English by
 * design (see data/card-refs.ts's berryWalletEnabled comment), not because
 * this page's own content isn't real.
 *
 * JAPANESE_MARKET_ENABLED is a separate, narrower concern from identity:
 * it only gates whether the Graded Market panel opens on the Japanese eBay
 * tab by default — real eBay Japanese-market data is currently thin for the
 * specific cards tracked here (confirmed live), so this stays off the
 * critical path for whether the page itself is worth building.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) return {};

  const ref = cardRefs.find((r) => r.slug === slug);
  if (!ref) return {};
  const ja = card.franchise === "one-piece" ? await getOnePieceJapaneseText(card, ref) : await getJapaneseCardText(card, ref);
  if (!ja.translated) return {};

  const jaNumber = ja.number ?? card.number;
  return {
    title: `${ja.name} (${jaNumber ?? ""}) — 日本語`,
    description: `${ja.name} — ${ja.set} ${jaNumber ?? ""}.`,
    alternates: {
      canonical: `/products/${card.slug}`,
      languages: { "x-default": `/products/${card.slug}`, en: `/products/${card.slug}`, ja: `/products/${card.slug}/ja` },
      types: { "text/markdown": `/products/${card.slug}/ja/index.md` },
    },
  };
}

export default async function ProductPageJapan({ params }: PageProps) {
  const { slug } = await params;
  const card = await getCardBySlug(slug);
  if (!card) notFound();

  const label = franchiseLabel(card.franchise);
  const ref = cardRefs.find((r) => r.slug === slug);
  if (!ref) notFound();

  const ja = card.franchise === "one-piece" ? await getOnePieceJapaneseText(card, ref) : await getJapaneseCardText(card, ref);
  if (!ja.translated) notFound();

  const displayCard: Card = {
    ...card,
    name: ja.name,
    set: ja.set,
    rarity: ja.rarity,
    imageUrl: ja.imageUrl,
    number: ja.number ?? card.number,
    setCode: ja.setCode ?? card.setCode,
  };
  const fr = card.franchise === "pokemon" ? await getFrenchCardText(card) : undefined;
  const localeLinks: LocaleLink[] =
    card.franchise === "one-piece"
      ? [
          { code: "US", href: `/products/${card.slug}`, active: false },
          { code: "JP", href: `/products/${card.slug}/ja`, active: true },
          { code: "FR", active: false, disabled: true },
        ]
      : [
          { code: "US", href: `/products/${card.slug}`, active: false },
          { code: "JP", href: `/products/${card.slug}/ja`, active: true },
          { code: "FR", href: fr?.translated ? `/products/${card.slug}/fr` : undefined, active: false, disabled: !fr?.translated },
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
      defaultMarketTab={card.franchise === "pokemon" && JAPANESE_MARKET_ENABLED ? "Japanese" : undefined}
    />
  );
}
