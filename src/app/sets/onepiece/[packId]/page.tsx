import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
import { officialCardsInPack, officialPacks, type OfficialCard } from "@/lib/one-piece-official";
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
        Card data is Bandai&apos;s official One Piece Card Game list. Parallels and alternate arts are listed as
        separate printings, because that is what they are. No prices — Bandai does not sell singles — and no card
        images, because Bandai serves them with a same-site policy that blocks them anywhere but their own site.
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

function PrintingTile({ card }: { card: OfficialCard }) {
  // `_p2` / `_r1` mark a parallel or a reprint printing of the same code. Worth
  // surfacing: it is the whole reason one code can span a 200x price range, and
  // a grid that hid it would show the same card five times for no visible
  // reason.
  const suffix = card.id.includes("_") ? card.id.split("_")[1] : undefined;

  return (
    <div className="flex h-full flex-col rounded-lg border-2 border-black bg-surface p-2" style={{ boxShadow: "3px 3px 0 0 #000" }}>
      {/* NO CARD IMAGE, and not by oversight. Bandai serves every card image
          with `Cross-Origin-Resource-Policy: same-site`, so a browser refuses
          to render it on our domain — measured, every one of the 319 here came
          back ERR_BLOCKED_BY_RESPONSE.NotSameSite with naturalWidth 0. The two
          ways around it both cost somebody: proxying through our own route puts
          319 images per page view on our bandwidth, and optcgapi's mirror is
          one person's VPS whose author asks people not to hammer it. Neither is
          worth deciding by default, so the tile leads with what the catalogue
          actually gives us for free. */}
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
    </div>
  );
}
