import type { Metadata } from "next";
import Link from "next/link";
import { catalogStats } from "@/lib/catalog";
import { officialStats } from "@/lib/one-piece-official";
import { absoluteUrl } from "@/lib/site";

/**
 * Browse Sets — pick a game.
 *
 * This used to BE the Pokémon index. It became a chooser when One Piece got a
 * catalogue of its own, so the two now sit as siblings under `/sets/pokemon`
 * and `/sets/onepiece` rather than one owning the parent route and the other
 * living somewhere else entirely.
 *
 * `/sets/[setId]` is deliberately NOT moved under `/sets/pokemon/[setId]`.
 * Those 203 URLs are prerendered and indexed; renaming them to tidy the tree
 * would trade real search traffic for symmetry. Next resolves static segments
 * before dynamic ones, and no set id is "pokemon" or "onepiece" (checked
 * against all 203), so the three coexist safely.
 *
 * Costs nothing to render: both figures are counted from catalogues on disk.
 */

// One year. The counts change when a catalogue is re-crawled, which is a commit
// and therefore a deploy.
export const revalidate = 31536000;

export const metadata: Metadata = {
  title: "Browse TCG sets — Pokémon and One Piece",
  description:
    "Every Pokémon TCG set and every One Piece Card Game pack, with card counts. Pick a game to browse its sets.",
  alternates: { canonical: "/sets" },
};

export default function SetsHubPage() {
  const pokemon = catalogStats();
  const onePiece = officialStats("english");

  const games = [
    {
      href: "/sets/pokemon",
      name: "Pokémon",
      blurb: "From the 1999 Base Set to the latest drop, with live Cardmarket and TCGplayer prices on every card.",
      sets: pokemon.sets,
      cards: pokemon.cards,
      cardsLabel: "cards catalogued",
      accent: true,
    },
    {
      href: "/sets/onepiece",
      name: "One Piece",
      blurb:
        "Every booster, starter deck and promo set from Bandai's own card list. Card data only — Bandai does not sell singles.",
      sets: onePiece.packs,
      cards: onePiece.printings,
      cardsLabel: "printings, parallels included",
      accent: false,
    },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "TCG set catalogues",
    url: absoluteUrl("/sets"),
    numberOfItems: games.length,
    itemListElement: games.map((game, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: absoluteUrl(game.href),
      name: `${game.name} sets`,
    })),
  };

  return (
    <main className="mx-auto w-full max-w-[1180px] px-6 py-6 pb-24">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mb-8">
        <h1 className="text-[32px] font-black tracking-[-0.8px]">Browse Sets</h1>
        <p className="mt-1 text-sm text-muted-text">Pick a game to see every set in it.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {games.map((game) => (
          <Link
            key={game.href}
            href={game.href}
            className={`flex flex-col rounded-xl border-2 border-black p-6 transition-transform hover:-translate-y-0.5 ${
              game.accent ? "bg-accent-surface" : "bg-surface"
            }`}
            style={{ boxShadow: "4px 4px 0 0 #000" }}
          >
            <span className="text-2xl font-black tracking-[-0.5px]">{game.name}</span>
            <span className="mt-2 text-sm text-muted-text">{game.blurb}</span>

            <span className="mt-6 flex items-baseline gap-6">
              <span>
                <span className="block text-2xl font-black tabular-nums">{game.sets.toLocaleString("en-US")}</span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-text">sets</span>
              </span>
              <span>
                <span className="block text-2xl font-black tabular-nums">{game.cards.toLocaleString("en-US")}</span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-text">{game.cardsLabel}</span>
              </span>
            </span>

            <span className="mt-6 text-xs font-black underline underline-offset-4">Browse {game.name} sets →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
