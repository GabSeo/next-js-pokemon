import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardGridFilter } from "@/components/retro/card-grid-filter";
import { OpenDataLinks } from "@/components/open-data-links";
import { StructuredData } from "@/components/structured-data";
import { franchiseLabel, getCardsByFranchise } from "@/lib/cards";
import { absoluteUrl } from "@/lib/site";
import type { Franchise } from "@/lib/types";

const FRANCHISES: Franchise[] = ["pokemon", "one-piece"];
const FRANCHISE_ICON: Record<Franchise, string> = { pokemon: "⚡", "one-piece": "🏴‍☠️" };

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

  const setsRepresented = new Set(cards.map((c) => c.set)).size;
  // Averaging in a card whose price couldn't be read would drag the figure
  // toward 0 and present the result as the collection's real average, so
  // those cards sit the stat out entirely rather than counting as free.
  const priced = cards.filter((c) => !c.priceUnavailable);
  const avgPrice = priced.length > 0 ? Math.round((priced.reduce((sum, c) => sum + c.currentPrice, 0) / priced.length) * 100) / 100 : 0;
  const featured = priced.length > 0 ? priced.reduce((best, c) => (c.currentPrice > best.currentPrice ? c : best), priced[0]) : undefined;

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
    <div className="min-h-screen bg-muted-surface">
      <StructuredData data={itemListJsonLd} />

      <div className="mx-auto max-w-[1180px] px-6 py-16">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm font-bold text-muted-text">
          <Link href="/" className="hover:text-foreground hover:underline">
            Home
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-foreground">{label}</span>
        </nav>

        <h1 className="text-[32px] leading-tight font-black tracking-[-1px] sm:text-[40px]">{label} collection</h1>
        <p className="mt-3 max-w-2xl text-base leading-6 text-muted-text">
          Every {label} card CardTrace tracks, with live market pricing. Looking for something else? See the{" "}
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

        <div className="mt-10 grid grid-cols-2 gap-6 lg:grid-cols-4">
          <div className="rounded-lg border-2 border-black bg-pokemon-blue p-5 text-white shadow-hard-md">
            <div className="mb-3 text-[11px] font-black tracking-[0.6px] uppercase opacity-75">Cards Tracked</div>
            <div className="text-[28px] font-black tracking-[-0.6px] tabular-nums">{cards.length}</div>
            <div className="mt-1 text-xs font-bold opacity-75">In this collection</div>
          </div>
          <div className="rounded-lg border-2 border-black bg-card-surface p-5 shadow-hard-md">
            <div className="mb-3 text-[11px] font-black tracking-[0.6px] text-muted-text uppercase">Sets Represented</div>
            <div className="text-[28px] font-black tracking-[-0.6px] tabular-nums">{setsRepresented}</div>
            <div className="mt-1 text-xs font-bold text-muted-text">Across tracked cards</div>
          </div>
          <div className="rounded-lg border-2 border-black bg-card-surface p-5 shadow-hard-md">
            <div className="mb-3 text-[11px] font-black tracking-[0.6px] text-muted-text uppercase">Avg. Price</div>
            <div className="text-[28px] font-black tracking-[-0.6px] tabular-nums">
              {priced.length > 0 ? `${priced[0].currency} ${avgPrice}` : "—"}
            </div>
            <div className="mt-1 text-xs font-bold text-muted-text">
              {priced.length > 0 ? "Current market price" : "No price source reachable right now"}
            </div>
          </div>
          <div className="rounded-lg border-2 border-black bg-card-surface p-5 shadow-hard-md">
            <div className="mb-3 text-[11px] font-black tracking-[0.6px] text-muted-text uppercase">Data Formats</div>
            <div className="text-[28px] font-black tracking-[-0.6px]">3</div>
            <div className="mt-1 text-xs font-bold text-muted-text">HTML · Markdown · JSON</div>
          </div>
        </div>

        {featured && (
          <div className="relative mt-9 overflow-hidden rounded-lg border-2 border-black bg-pokemon-red p-11 text-white shadow-hard-lg">
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,.18)_1.5px,transparent_1.5px)] bg-[length:16px_16px]"
              aria-hidden="true"
            />
            <div className="relative z-[2] flex flex-wrap items-center justify-between gap-9">
              <div>
                <span className="mb-3 inline-block rounded-full border-2 border-black bg-white px-3 py-1 text-[11px] font-black tracking-[0.6px] text-pokemon-red uppercase">
                  🔥 Highest Tracked Price
                </span>
                <h2 className="mb-1 text-[32px] font-black tracking-[-0.8px]">{featured.printName ?? featured.name}</h2>
                <p className="max-w-[420px] text-sm leading-5 opacity-90">
                  {featured.set}
                  {featured.number ? `, ${featured.number}` : ""} — currently{" "}
                  <b>
                    {featured.currency} {featured.currentPrice}
                  </b>
                  , last updated {featured.asOfDate}.
                </p>
                <Link
                  href={`/products/${featured.slug}`}
                  className="mt-5 inline-block rounded-md border-2 border-black bg-foreground px-5 py-3 text-sm font-black shadow-[4px_4px_0px_0px_rgba(255,255,255,0.85)] transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.85)]"
                >
                  View this card →
                </Link>
              </div>
              <div className="relative z-[2] flex h-[120px] w-[120px] flex-shrink-0 items-center justify-center rounded-lg border-2 border-black bg-white text-5xl shadow-hard-md">
                {FRANCHISE_ICON[franchise]}
              </div>
            </div>
          </div>
        )}

        <div className="mt-14">
          <CardGridFilter cards={cards} />
        </div>
      </div>
    </div>
  );
}
