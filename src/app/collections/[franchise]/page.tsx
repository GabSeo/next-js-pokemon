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
    <div className="mx-auto max-w-5xl px-4 py-12">
      <StructuredData data={itemListJsonLd} />

      <nav aria-label="Breadcrumb" className="mb-3 text-xs uppercase tracking-[0.08em] text-muted-foreground">
        <Link href="/" className="hover:text-foreground hover:underline">
          Home
        </Link>
        <span className="px-1.5">/</span>
        <span>{label}</span>
      </nav>

      <h1 className="text-[40px] font-normal leading-none tracking-[0.025em] sm:text-[48px] lg:text-[54px]">
        {label} collection
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-[1.2] text-muted-foreground">
        {cards.length} cards tracked in this catalog, each with live market
        pricing. Looking for something else? See the{" "}
        <Link href={`/collections/${other}`} className="underline underline-offset-4">
          {otherLabel} collection
        </Link>{" "}
        instead.
      </p>
      <OpenDataLinks
        markdownHref={`/collections/${franchise}/index.md`}
        jsonHref={`/api/${franchise}`}
        okfHref={`/okf/collections/${franchise}`}
        className="mt-3"
      />

      <div className="mt-20 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <CardTile key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}
