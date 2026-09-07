import type { Metadata } from "next";
import Link from "next/link";
import { SetsBrowser, type BrowseSet } from "@/components/sets-browser";
import { officialPacks, officialStats } from "@/lib/one-piece-official";
import { absoluteUrl } from "@/lib/site";

/**
 * Browse Sets — every One Piece pack we hold.
 *
 * COSTS NOTHING TO RENDER, and that is the point of the whole exercise it came
 * out of. It reads `data/catalog/one-piece-official/` off disk and makes no
 * network call at all. Its Pokémon counterpart has worked this way for a while;
 * One Piece could not, because its catalogue lived on BerryWallet — the same
 * host we buy PRICES from, metered at 100 calls an hour. A browse page backed
 * by that host would have spent the card-tracking quota on a card nobody
 * tracks.
 *
 * NO PRICES HERE, deliberately, and not only for cost. Bandai publishes what a
 * card IS; it does not sell singles, so there is no marketplace figure to
 * attach. The Pokémon set pages show prices because TCGdex carries Cardmarket
 * and TCGplayer product ids and we snapshot them at deploy. The honest
 * equivalent here is a card count, so that is what this shows.
 *
 * ENGLISH ONLY for now. The catalogue holds Japanese and French too — and
 * French is data BerryWallet never had at all — but nothing else in the app is
 * localised per franchise yet, so shipping a language switch here would be the
 * only one on the site. The loader takes a language argument, so it is one
 * parameter away when the rest of the UI is ready.
 */

// One year. Nothing here changes until the catalogue is re-crawled, which is a
// commit and therefore a deploy.
export const revalidate = 31536000;

export const metadata: Metadata = {
  title: "One Piece TCG sets — every pack and how many cards it holds",
  description:
    "Every One Piece Card Game booster, starter deck, premium booster and promo set, with the number of printings in each.",
  alternates: { canonical: "/sets/onepiece" },
};

export default function OnePieceSetsPage() {
  const stats = officialStats("english");

  const browse: BrowseSet[] = officialPacks("english")
    // Real sets first, newest to oldest, then the two catch-all buckets. Pack
    // ids run in release order, but "Promotion card" and "Other Product Card"
    // carry the highest ones and are not sets anybody browses for — sorting on
    // the id alone put them at the top of the page.
    .sort((a, b) => Number(Boolean(b.pack.label)) - Number(Boolean(a.pack.label)))
    .map(({ pack, cardCount }) => ({
    id: pack.id,
    // The label is the set code a person actually says — "OP-05", not 569105.
    // One source row has no title of its own ("BOOSTER PACK [OP15-EB04]"), so
    // repeating it either side of the brackets would read as a stutter.
    name: !pack.label ? pack.title : pack.title === pack.prefix || !pack.prefix ? pack.label : `${pack.title} [${pack.label}]`,
    // Bandai's own product line, which is a better grouping than anything we
    // could invent: BOOSTER PACK / STARTER DECK / PREMIUM BOOSTER / EXTRA
    // BOOSTER. Where `prefix` is absent the raw title still starts with it —
    // "BOOSTER PACK [OP15-EB04]" — and reading it back keeps two real booster
    // sets out of a catch-all group, and gives the promo buckets their own
    // honest names instead of lumping them under "Other".
    serie: pack.prefix ?? pack.rawTitle.split(/[[【]/)[0].trim() ?? "Other",
    cardCount,
    // No logo: Bandai publishes card images, not set logos. SetsBrowser falls
    // back to a lettered tile, which is why that fallback exists.
    }));

  const eras: string[] = [];
  for (const set of browse) if (!eras.includes(set.serie)) eras.push(set.serie);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "One Piece Card Game sets",
    url: absoluteUrl("/sets/onepiece"),
    numberOfItems: browse.length,
    itemListElement: browse.slice(0, 50).map((set, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: set.name,
    })),
  };

  return (
    <main className="mx-auto w-full max-w-[1180px] px-6 py-6 pb-24">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />

      <div className="mb-6">
        <Link href="/sets" className="text-xs font-bold text-muted-text underline underline-offset-4">
          ← All games
        </Link>
        <h1 className="mt-3 text-[32px] font-black tracking-[-0.8px]">One Piece Sets</h1>
        <p className="mt-1 text-sm text-muted-text">
          Every booster, starter deck and promo set in the One Piece Card Game — {stats.printings.toLocaleString("en-US")}{" "}
          printings across {stats.codes.toLocaleString("en-US")} cards.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat label="Total Sets" value={String(browse.length)} sub="Boosters, decks & promos" accent />
        <Stat label="Printings" value={stats.printings.toLocaleString("en-US")} sub="Including every parallel" />
        <Stat label="Distinct Cards" value={stats.codes.toLocaleString("en-US")} sub="By card code" />
        <Stat label="Languages Held" value={String(stats.languages.length)} sub={stats.languages.join(", ")} />
      </div>

      {/* Says where the data comes from, because it is not ours and the
          distinction matters: this is Bandai's own published card list, read
          from a maintained mirror rather than scraped by us. */}
      <p className="mb-6 rounded-lg border-2 border-black bg-muted-surface p-3 text-xs">
        Card data comes from Bandai&apos;s published card list, mirrored by punk-records — an independent project, not
        affiliated with Bandai. No prices here: Bandai publishes what a card is,
        not what it sells for. Marketplace figures live on the individual card pages.
      </p>

      <SetsBrowser sets={browse} eras={eras} hrefBase="/sets/onepiece" />
    </main>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-xl border-2 border-black p-4 ${accent ? "bg-muted-surface" : "bg-white"}`}
      style={{ boxShadow: "3px 3px 0 0 #000" }}
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-text">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-text">{sub}</div>
    </div>
  );
}
