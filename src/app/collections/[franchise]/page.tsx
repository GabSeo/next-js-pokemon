import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardTile } from "@/components/card-tile";
import { OpenDataLinks } from "@/components/open-data-links";
import { StructuredData } from "@/components/structured-data";
import { franchiseLabel, getCardsByFranchise } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";
import type { Franchise } from "@/lib/types";

const FRANCHISES: Franchise[] = ["pokemon", "one-piece"];

// 36 hours (must be a literal — Next.js statically parses this export).
// Kept in sync with apitcg.ts's REVALIDATE_SECONDS.
export const revalidate = 129600;

export function generateStaticParams() {
  return FRANCHISES.map((franchise) => ({ franchise }));
}

function isFranchise(value: string): value is Franchise {
  return FRANCHISES.includes(value as Franchise);
}

type PageProps = { params: Promise<{ franchise: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { franchise } = await params;
  if (!isFranchise(franchise)) return {};
  const label = franchiseLabel(franchise);
  return {
    title: `${label} card collection`,
    description: `Browse the ${label} card collection with live market prices.`,
    alternates: {
      canonical: `/collections/${franchise}`,
      types: { "text/markdown": `/collections/${franchise}/index.md` },
    },
  };
}

export default async function CollectionPage({ params }: PageProps) {
  const { franchise } = await params;
  if (!isFranchise(franchise)) notFound();

  const cards = await getCardsByFranchise(franchise);
  const label = franchiseLabel(franchise);
  const other: Franchise = franchise === "pokemon" ? "one-piece" : "pokemon";
  const otherLabel = franchiseLabel(other);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${label} collection`,
    url: absoluteUrl(`/collections/${franchise}`),
    numberOfItems: cards.length,
    itemListElement: cards.map((card, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: absoluteUrl(`/products/${card.slug}`),
      name: card.name,
    })),
  };

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-16">
      <StructuredData data={itemListJsonLd} />

      <nav aria-label="Breadcrumb" className="mb-6 text-sm font-bold text-muted-text">
        <Link href="/" className="hover:text-foreground hover:underline">
          Home
        </Link>
        <span className="px-1.5">/</span>
        <span className="text-foreground">{label}</span>
      </nav>

      <h1 className="text-[32px] leading-tight font-black tracking-[-1px] sm:text-[40px]">
        {label} collection
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-6 text-muted-text">
        {cards.length} cards tracked in this catalog, each with live market
        pricing. Looking for something else? See the{" "}
        <Link href={`/collections/${other}`} className="font-bold underline underline-offset-4">
          {otherLabel} collection
        </Link>{" "}
        instead.
      </p>
      <OpenDataLinks
        markdownHref={`/collections/${franchise}/index.md`}
        jsonHref={`/api/${franchise}`}
        okfHref={`/okf/collections/${franchise}`}
        className="mt-5"
      />

      <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-3">
        {cards.map((card) => (
          <CardTile key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}
