import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
import { officialCardsInPack, officialCode, officialPacks, type OfficialCard } from "@/lib/one-piece-official";
import { absoluteUrl } from "@/lib/site";

/**
 * One One Piece pack, every printing inside it.
 *
 * PRERENDERED AND FREE, like its Pokémon counterpart and for the same reason:
 * the build makes no request. `data/catalog/one-piece-official/` is on disk and
 * lib/one-piece-official.ts cannot reach a network at all.
 *
 * NO PRICES, and unlike the Pokémon set page that is not a cost decision.
 * Bandai publishes what a card IS and does not sell singles, so there is no
 * marketplace figure attached to a printing here. What this page can show
 * instead is the thing our own eBay query model spent weeks learning to
 * reconstruct from parentheses in a name: which printing is which, side by
 * side, with its rarity and its own image.
 *
 * ENGLISH ONLY, matching the index. The catalogue holds Japanese and French,
 * and `officialCardsInPack` takes a language, so this is one parameter away
 * once the rest of the site is localised.
 */

// One year. Nothing here changes until the catalogue is re-crawled, which is a
// commit and therefore a deploy.
export const revalidate = 31536000;

const LANGUAGE = "english";

export function generateStaticParams() {
  return officialPacks(LANGUAGE).map(({ pack }) => ({ packId: pack.id }));
}

type PageProps = { params: Promise<{ packId: string }> };

function findPack(packId: string) {
  return officialPacks(LANGUAGE).find(({ pack }) => pack.id === decodeURIComponent(packId));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { packId } = await params;
  const found = findPack(packId);
  if (!found) return {};
  const { pack, cardCount } = found;
  const name = pack.label ? `${pack.title} [${pack.label}]` : pack.title;
  return {
    title: `${name} — every card in the set`,
    description: `All ${cardCount} printings in ${name}, with rarity, colour, cost and power for each.`,
    alternates: { canonical: `/sets/onepiece/${pack.id}` },
  };
}

export default async function OnePiecePackPage({ params }: PageProps) {
  const { packId } = await params;
  const found = findPack(packId);
  if (!found) notFound();

  const { pack } = found;
  const cards = officialCardsInPack(pack.id, LANGUAGE);
  const name = pack.label ? `${pack.title} [${pack.label}]` : pack.title;

  // A code can appear several times in one pack — the base print and its
  // parallels. Counting distinct codes alongside printings is the honest way to
  // say how big a set is, since "319 cards" and "319 different cards" are not
  // the same claim.
  const distinctCodes = new Set(cards.map((c) => c.id.split("_")[0])).size;

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url: absoluteUrl(`/sets/onepiece/${pack.id}`),
    numberOfItems: cards.length,
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />

      <Link href="/sets/onepiece" className="text-xs font-bold text-muted-text underline underline-offset-4">
        ← All One Piece sets
      </Link>

      <div className="mt-4">
        <EyebrowTitle tone="blue">{pack.prefix ?? "One Piece"}</EyebrowTitle>
        <h1 className="mt-2 text-3xl font-black tracking-tight">{name}</h1>
        <p className="mt-1 text-xs text-muted-text">
          {cards.length} printings · {distinctCodes} distinct cards
          {pack.label ? ` · ${pack.label}` : ""}
        </p>
      </div>

      <p className="mt-6 rounded-lg border-2 border-black bg-muted-surface p-3 text-xs">
        Card data and images are Bandai&apos;s official One Piece Card Game list. Parallels and alternate arts are
        listed as separate printings, because that is what they are — and since each carries its own artwork, the
        picture is what tells them apart. No prices: Bandai does not sell singles.
      </p>

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((card) => (
          <li key={card.id}>
            <PrintingTile card={card} />
          </li>
        ))}
      </ul>
    </main>
  );
}

/** Must match WIDTHS in app/api/one-piece-image — the route rejects anything else with a 400. */
const IMAGE_WIDTHS = [320, 480, 640];

function imageSrc(printingId: string): string {
  return `/api/one-piece-image/${encodeURIComponent(printingId)}?lang=english`;
}

function PrintingTile({ card }: { card: OfficialCard }) {
  // `_p2` / `_r1` mark a parallel or a reprint printing of the same code. Worth
  // surfacing: it is the whole reason one code can span a 200x price range, and
  // a grid that hid it would show the same card five times for no visible
  // reason.
  const suffix = card.id.includes("_") ? card.id.split("_")[1] : undefined;

  // Links to the code, not the printing: /card/onepiece/OP05-119 shows all
  // nine of its printings side by side, which is the question a tile in a pack
  // grid raises and cannot answer on its own.
  return (
    <Link
      href={`/card/onepiece/${encodeURIComponent(officialCode(card.id))}`}
      className="flex h-full flex-col rounded-lg border-2 border-black bg-white p-2 transition-transform hover:-translate-y-0.5"
      style={{ boxShadow: "3px 3px 0 0 #000" }}
    >
      {/* THE IMAGE IS THE POINT OF THIS GRID. Every printing of a One Piece
          code carries its own artwork — measured, 945 of 945 multi-printing
          groups differ by image while 0 differ by name — so a text tile showed
          the same card five times for no visible reason. Bandai's own bytes,
          through our proxy: see app/api/one-piece-image for why a proxy is
          needed (same-site policy) and why it costs no quota.

          A plain <img> with our own srcset, matching the Pokemon tile rather
          than next/image. The route resizes with sharp and returns webp, so the
          optimizer would be a second resize of an already-right-sized file — and
          it would spend Vercel's Image Optimization quota, a metered resource
          our budget report cannot see, on a page any free user can open. Bandai
          publishes one size (~285 KB PNG), which is the only reason this needs
          resizing at all where TCGdex does not. `sizes` matches the grid below —
          2 up on mobile, 4 at lg — so no viewport fetches a file bigger than it
          paints. See docs/free-tier-catalogue.md §7. */}
      <div className="mb-2 overflow-hidden rounded border-2 border-black bg-muted-surface">
        {/* eslint-disable-next-line @next/next/no-img-element -- resizing happens in /api/one-piece-image (sharp -> webp); next/image would re-optimize an already-optimized file on a metered Vercel quota */}
        <img
          src={`${imageSrc(card.id)}&w=320`}
          srcSet={IMAGE_WIDTHS.map((w) => `${imageSrc(card.id)}&w=${w} ${w}w`).join(", ")}
          sizes="(min-width: 1024px) 20vw, (min-width: 640px) 28vw, 45vw"
          alt={`${card.name} (${card.id})`}
          width={300}
          height={420}
          loading="lazy"
          className="aspect-[300/420] w-full object-contain"
        />
      </div>

      <div className="flex-1">
        <div className="text-xs font-black leading-tight">{card.name}</div>
        <div className="mt-0.5 text-[11px] text-muted-text">
          {card.id}
          {suffix ? <span className="ml-1 font-bold text-accent-text">{suffix}</span> : null}
        </div>
        {card.category ? <div className="mt-1 text-[11px] text-muted-text">{card.category}</div> : null}
        {card.cost !== null || card.power !== null ? (
          <div className="mt-1 text-[11px] tabular-nums text-muted-text">
            {card.cost !== null ? `cost ${card.cost}` : ""}
            {card.cost !== null && card.power !== null ? " · " : ""}
            {card.power !== null ? `${card.power} power` : ""}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {card.rarity ? (
          <span className="rounded-full border-2 border-black bg-muted-surface px-2 py-0.5 text-[10px] font-black">
            {card.rarity}
          </span>
        ) : null}
        {(card.colors ?? []).map((colour) => (
          <span key={colour} className="rounded-full border-2 border-black px-2 py-0.5 text-[10px] font-black">
            {colour}
          </span>
        ))}
      </div>
    </Link>
  );
}
