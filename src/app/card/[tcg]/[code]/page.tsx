import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCollectionButton } from "@/components/add-to-collection-button";
import { getCardView, type CardPrint, type CardView } from "@/lib/card-view";
import { absoluteUrl } from "@/lib/site";
import { onePieceSrc, onePieceSrcSet } from "@/lib/one-piece-images";

/**
 * One card, every printing of it, side by side. Free.
 *
 * THE POINT OF THE PAGE. A code is not a collectible (§1): `ST21-014` returns
 * four real printings that trade across a 204x spread, and a Pokémon card's
 * reverse holo is a median 3.36x its normal twin. Anywhere the site shows one
 * number for a card, it is answering a question nobody asked. This page shows
 * the printings instead and lets a person pick the one in their hand — the same
 * step the scan will land on, built first without a camera in the way.
 *
 * NOT PRERENDERED, and that is a scale decision rather than a caching one.
 * 21,066 Pokémon cards and 2,785 One Piece codes is ~24k pages; the whole site
 * is 393 today and builds in 3.1s. `generateStaticParams` returns nothing, so
 * each page is rendered on its first request and cached from then on. It costs
 * no quota to render, so an uncached first hit is slow at worst, never
 * expensive.
 *
 * ZERO METERED CALLS. Everything comes from lib/card-view, which reads the two
 * catalogues and the price snapshot off disk. `scripts/check-free-tier.mts`
 * enforces this rather than trusting it.
 */

// One year. The catalogues change when they are re-crawled, which is a commit
// and therefore a deploy.
export const revalidate = 31536000;

const GAMES: Record<string, string> = { pokemon: "Pokémon", onepiece: "One Piece" };

export function generateStaticParams() {
  // Intentionally empty — see the header. Every page is on-demand ISR.
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tcg: string; code: string }>;
}): Promise<Metadata> {
  const { tcg, code } = await params;
  const view = await getCardView(tcg, code);
  if (!view) return { title: "Card not found" };

  const count = view.prints.length;
  return {
    title: `${view.name} (${view.code}) — every printing`,
    description:
      `${view.name}, ${view.code}: ${count} known printing${count === 1 ? "" : "s"} in the ` +
      `${GAMES[view.tcg]} catalogue, listed side by side with set, rarity and artwork.`,
    alternates: { canonical: `/card/${view.tcg}/${view.code}` },
  };
}

export default async function CardPage({ params }: { params: Promise<{ tcg: string; code: string }> }) {
  const { tcg, code } = await params;
  const view = await getCardView(tcg, code);
  if (!view) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${view.name} (${view.code}) printings`,
    url: absoluteUrl(`/card/${view.tcg}/${view.code}`),
    numberOfItems: view.prints.length,
    itemListElement: view.prints.map((print, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: [print.label, print.origin].filter(Boolean).join(" · "),
    })),
  };

  return (
    <main className="mx-auto w-full max-w-[1180px] px-6 py-6 pb-24">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Link href={`/sets/${view.tcg}`} className="text-xs font-black underline underline-offset-4">
        ← {GAMES[view.tcg]} sets
      </Link>

      <div className="mt-4">
        <h1 className="text-[32px] font-black tracking-[-0.8px]">{view.name}</h1>
        <p className="mt-1 text-sm text-muted-text">
          {view.code} · {view.prints.length} printing{view.prints.length === 1 ? "" : "s"}
        </p>
      </div>

      <p className="mt-6 rounded-lg border-2 border-black bg-muted-surface p-3 text-xs">{view.priceNote}</p>

      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {view.prints.map((print) => (
          <li key={print.key}>
            <PrintTile print={print} tcg={view.tcg} code={view.code} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function PrintTile({ print, tcg, code }: { print: CardPrint; tcg: CardView["tcg"]; code: string }) {
  const cm = print.price?.cardmarket?.avg;
  const tp = print.price?.tcgplayer?.market;
  const money =
    cm !== undefined
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(cm)
      : tp !== undefined
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(tp)
        : undefined;

  return (
    <div
      className="flex h-full flex-col rounded-lg border-2 border-black bg-white p-2"
      style={{ boxShadow: "3px 3px 0 0 #000" }}
    >
      <div className="mb-2 overflow-hidden rounded border-2 border-black bg-muted-surface">
        {print.image ? (
          /* eslint-disable-next-line @next/next/no-img-element -- both sources are pre-sized: TCGdex publishes quality tiers, and /api/one-piece-image resizes with sharp. next/image would re-optimize an already-optimized file on a metered Vercel quota (docs/free-tier-catalogue.md §7) */
          <img
            src={tcg === "onepiece" ? onePieceSrc(print.image, 320) : print.image}
            srcSet={tcg === "onepiece" ? onePieceSrcSet(print.image) : undefined}
            sizes={tcg === "onepiece" ? "(min-width: 1024px) 20vw, (min-width: 640px) 28vw, 45vw" : undefined}
            alt={`${print.origin} printing`}
            width={300}
            height={420}
            loading="lazy"
            className="aspect-[300/420] w-full object-contain"
          />
        ) : (
          // A printing the mirror names and nobody pictures — 80 of them, all
          // promos. Saying so beats an empty frame the reader has to interpret.
          <div className="flex aspect-[300/420] w-full items-center justify-center p-3 text-center text-[11px] text-muted-text">
            No picture published for this printing
          </div>
        )}
      </div>

      <div className="flex-1">
        {/* The label is the distinguishing fact for Pokémon and does not exist
            for One Piece, where the picture above is doing that job. Rendering
            the pack name in its place keeps every tile answering "which one is
            this" with whatever the source actually knows. */}
        <div className="text-xs font-black leading-tight">{print.label ?? print.origin}</div>
        {print.label ? <div className="mt-0.5 text-[11px] text-muted-text">{print.origin}</div> : null}
        {print.rarity ? <div className="mt-1 text-[11px] text-muted-text">{print.rarity}</div> : null}
      </div>

      <div className="mt-2 text-xs font-black">
        {money ?? <span className="font-bold text-muted-text">No price</span>}
      </div>

      {/* THE POINT OF THIS PAGE. Every other surface can only offer "add this
          card", which cannot say whether you hold the EUR 0.04 printing or the
          EUR 0.15 one. This is the only place that knows the printings apart,
          so it is the only place that can record one honestly. */}
      <div className="mt-2">
        <AddToCollectionButton tcg={tcg} code={code} printKey={print.key} size="sm" />
      </div>
    </div>
  );
}
