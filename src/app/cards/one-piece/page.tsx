import type { Metadata } from "next";
import Link from "next/link";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
import { officialCardsInPack, officialCode, officialPacks } from "@/lib/one-piece-official";
import { onePieceImageUrl, onePieceSrc, onePieceSrcSet } from "@/lib/one-piece-images";

/**
 * Search the One Piece catalogue by name, filtered by pack.
 *
 * WHY A SEPARATE PAGE FROM /cards. The two games do not share a search because
 * they do not share a shape. A Pokemon card has one picture and several named
 * printings; a One Piece code has several pictures and no names at all
 * (0 of 945 multi-printing groups differ by name). So /cards filters by
 * language and set, and this filters by pack — the only axis Bandai's own data
 * offers.
 *
 * NO LANGUAGE FILTER, and that is a gap rather than a decision. Bandai
 * publishes three catalogues and we hold English and Japanese, but the two are
 * keyed on the same printing ids and a code resolves across both, so there is
 * nothing here to switch BETWEEN. Pokemon's Japanese cards are a different
 * catalogue; One Piece's are the same cards photographed for another market.
 *
 * FREE AND REQUEST-TIME. Reading searchParams makes this dynamic, and it costs
 * nothing: the whole answer comes from data/catalog/one-piece-official/.
 */

export const metadata: Metadata = {
  title: "Search One Piece cards",
  description: "Search every One Piece card by name, filtered by pack. Every printing of a code, side by side.",
};

const LIMIT = 60;
const LANGUAGE = "english";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OnePieceSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = one(raw.q)?.trim() ?? "";
  const pack = one(raw.pack) ?? "";

  const packs = officialPacks(LANGUAGE);

  // One row per CODE, not per printing: a code is what someone searches for,
  // and the card page is where its printings are compared.
  const seen = new Set<string>();
  const rows: { code: string; name: string; pack: string; printings: number }[] = [];

  for (const { pack: p } of packs) {
    if (pack && p.id !== pack) continue;
    for (const card of officialCardsInPack(p.id, LANGUAGE)) {
      const code = officialCode(card.id);
      if (seen.has(code)) continue;
      if (q && !card.name.toLowerCase().includes(q.toLowerCase()) && !code.toLowerCase().includes(q.toLowerCase())) {
        continue;
      }
      seen.add(code);
      rows.push({
        code,
        name: card.name,
        pack: p.label ?? p.title,
        printings: officialCardsInPack(p.id, LANGUAGE).filter((c) => officialCode(c.id) === code).length,
      });
      if (rows.length >= LIMIT) break;
    }
    if (rows.length >= LIMIT) break;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <EyebrowTitle tone="blue">One Piece</EyebrowTitle>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Search One Piece cards</h1>

      <form method="get" className="mt-6 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by card name or code…"
          aria-label="Search One Piece cards"
          className="min-w-0 flex-1 rounded-lg border-2 border-black bg-card-surface px-3 py-2 text-sm shadow-hard-sm outline-none"
        />
        <select
          name="pack"
          defaultValue={pack}
          aria-label="Filter by pack"
          className="rounded-lg border-2 border-black bg-card-surface px-3 py-2 text-sm shadow-hard-sm outline-none"
        >
          <option value="">All packs</option>
          {packs.map(({ pack: p, cardCount }) => (
            <option key={p.id} value={p.id}>
              {p.label ?? p.title} ({cardCount})
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg border-2 border-black bg-pokemon-yellow px-4 py-2 text-sm font-black shadow-hard-sm"
        >
          Search
        </button>
      </form>

      <p className="mt-4 text-xs text-muted-text">
        {rows.length === LIMIT ? `First ${LIMIT}` : rows.length} card{rows.length === 1 ? "" : "s"}
        {q || pack ? " matching" : " in the catalogue"}. Open one to see every printing of it side by side.
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted-text">
          Nothing matches. Bandai names every printing of a code the same way, so try the code itself — `OP05-119`.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {rows.map((row) => {
            const image = onePieceImageUrl(row.code);
            return (
              <li key={row.code}>
                <Link
                  href={`/card/onepiece/${encodeURIComponent(row.code)}`}
                  className="flex h-full flex-col rounded-lg border-2 border-black bg-white p-2 shadow-hard-sm transition-[transform,box-shadow] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
                >
                  <div className="mb-2 overflow-hidden rounded border-2 border-black bg-muted-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized by /api/one-piece-image (sharp -> webp); next/image would re-optimize on a metered quota */}
                    <img
                      src={onePieceSrc(image, 320)}
                      srcSet={onePieceSrcSet(image)}
                      sizes="(min-width: 1024px) 20vw, (min-width: 640px) 28vw, 45vw"
                      alt={`${row.name} ${row.code}`}
                      width={300}
                      height={420}
                      loading="lazy"
                      className="aspect-[300/420] w-full object-contain"
                    />
                  </div>
                  <p className="text-sm font-black leading-tight">{row.name}</p>
                  <p className="mt-1 text-[11px] text-muted-text">
                    {row.code} · {row.pack}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
