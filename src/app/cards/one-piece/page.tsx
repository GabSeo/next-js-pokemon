import type { Metadata } from "next";
import Link from "next/link";
import { EyebrowTitle } from "@/components/retro/eyebrow-title";
import { SearchControls } from "@/components/search-controls";
import { isSortId, PAGE_SIZE, type SortId } from "@/lib/catalog-query";
import { officialCardsInPack, officialCode, officialPacks } from "@/lib/one-piece-official";
import { onePieceImageUrl, onePieceSrc, onePieceSrcSet } from "@/lib/one-piece-images";

/**
 * Search the One Piece catalogue — the same surface as /cards, one game over.
 *
 * THE TWO PAGES ARE DELIBERATELY IDENTICAL except for the language toggle,
 * which exists only on the Pokemon side. Pokemon has an English and a Japanese
 * CATALOGUE — different sets, different numbering, 12,781 cards published only
 * in Japanese. Bandai publishes the same cards in three languages rather than
 * three catalogues, so there is nothing here to switch between, and inventing a
 * toggle that filters nothing would be worse than its absence.
 *
 * ONE ROW PER CODE, not per printing, which is the real difference from the
 * Pokemon grid underneath the shared layout. A code is what somebody searches
 * for; its printings differ by picture and by as much as 200x in price, and the
 * card page is where they are compared side by side. So a row shows the RANGE.
 *
 * NO PRICES. Browsing is for finding a card; a One Piece code spans as much as
 * 200x across its printings, so one figure on a tile would be the exact claim
 * this project refuses to make. The card page shows them per printing.
 *
 * FREE AND REQUEST-TIME. Reading searchParams makes this dynamic, and it costs
 * nothing — the whole answer is two files on disk.
 */

export const metadata: Metadata = {
  title: "Search One Piece cards",
  description:
    "Search every One Piece card by name or code, filtered by pack. " +
    "Every printing of a code, side by side.",
};

const LANGUAGE = "english";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Row = { code: string; name: string; pack: string; printings: number };

export default async function OnePieceSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q = one(raw.q)?.trim() ?? "";
  const pack = one(raw.pack) ?? "";
  const sortParam = one(raw.sort);
  const sort: SortId = isSortId(sortParam) ? sortParam : "name";
  const page = Math.max(1, Number(one(raw.page)) || 1);

  const packs = officialPacks(LANGUAGE);
  const needle = q.toLowerCase();

  // One row per code. A code appears in several packs when it was reprinted,
  // and the first pack that carries it names it here; the card page lists them
  // all.
  const seen = new Set<string>();
  const rows: Row[] = [];

  for (const { pack: p } of packs) {
    if (pack && p.id !== pack) continue;
    const cards = officialCardsInPack(p.id, LANGUAGE);
    for (const card of cards) {
      const code = officialCode(card.id);
      if (seen.has(code)) continue;
      if (needle && !card.name.toLowerCase().includes(needle) && !code.toLowerCase().includes(needle)) continue;
      seen.add(code);
      rows.push({
        code,
        name: card.name,
        pack: p.label ?? p.title,
        printings: cards.filter((c) => officialCode(c.id) === code).length,
      });
    }
  }

  if (sort === "name-desc") rows.sort((a, b) => b.name.localeCompare(a.name) || a.code.localeCompare(b.code));
  else rows.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const entries = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <EyebrowTitle tone="blue">Catalogue</EyebrowTitle>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Search One Piece cards</h1>
      <p className="mt-2 text-sm text-muted-text">
        {seen.size.toLocaleString("en-US")} cards across {packs.length} packs. Identity is Bandai&apos;s;
every printing of a code is one click away.{" "}
        <Link href="/sets/onepiece" className="font-bold underline underline-offset-4">
          Browse by pack
        </Link>
        .
      </p>

      <div className="mt-6">
        <SearchControls
          basePath="/cards/one-piece"
          total={rows.length}
          placeholder="Search by card name or code…"
          filter={{
            param: "pack",
            label: "Pack",
            options: packs.map(({ pack: p, cardCount }) => ({
              value: p.id,
              label: p.label ?? p.title,
              count: cardCount,
            })),
          }}
        />
      </div>

      <div className="mt-6">
        {entries.length === 0 ? (
          <p className="rounded-lg border-2 border-black bg-muted-surface p-4 text-sm">
            No cards match those filters. Bandai names every printing of a code the same way, so the code itself —
            <code className="px-1 font-mono">OP05-119</code> — is often the surer search.
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {entries.map((row) => {
                const image = onePieceImageUrl(row.code);
                return (
                  <li key={row.code}>
                    <Link
                      href={`/card/onepiece/${encodeURIComponent(row.code)}`}
                      className="flex h-full flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface shadow-hard-sm transition-transform hover:-translate-y-0.5"
                    >
                      <div className="bg-muted-surface p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized by /api/one-piece-image (sharp -> webp); next/image would re-optimize on a metered quota */}
                        <img
                          src={onePieceSrc(image, 320)}
                          srcSet={onePieceSrcSet(image)}
                          sizes="(min-width: 1280px) 20vw, (min-width: 640px) 28vw, 45vw"
                          alt={`${row.name} ${row.code}`}
                          loading="lazy"
                          className="aspect-[300/420] w-full rounded object-contain"
                        />
                      </div>
                      <div className="flex flex-1 flex-col gap-0.5 border-t-2 border-black p-2">
                        <span className="truncate text-xs font-bold" title={row.name}>
                          {row.name}
                        </span>
                        <span className="truncate text-[10px] text-muted-text" title={row.pack}>
                          {row.pack} · {row.code}
                        </span>
                        <span className="mt-auto pt-1 text-[10px] text-muted-text">
                          {row.printings} printing
                          {row.printings === 1 ? "" : "s"} in this pack
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {pageCount > 1 && (
              <nav className="mt-6 flex items-center justify-between gap-2 text-sm" aria-label="Pagination">
                <PageLink params={raw} target={current - 1} disabled={current <= 1} label="Previous" />
                <span className="text-xs text-muted-text">
                  Page {current} of {pageCount}
                </span>
                <PageLink params={raw} target={current + 1} disabled={current >= pageCount} label="Next" />
              </nav>
            )}
          </>
        )}
      </div>
    </main>
  );
}

/** Plain links, not buttons — a page of results is a URL, and this survives JavaScript being off. */
function PageLink({
  params,
  target,
  disabled,
  label,
}: {
  params: Record<string, string | string[] | undefined>;
  target: number;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return <span className="rounded-lg border-2 border-black/20 px-3 py-1 text-muted-text">{label}</span>;
  }
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single !== undefined && key !== "page") next.set(key, single);
  }
  if (target > 1) next.set("page", String(target));
  return (
    <Link
      href={`/cards/one-piece?${next.toString()}`}
      className="rounded-lg border-2 border-black bg-card-surface px-3 py-1 font-bold shadow-hard-sm"
    >
      {label}
    </Link>
  );
}
