"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * The Browse Sets grid — search, sort, era grouping and the set cards.
 *
 * CLIENT-SIDE FILTERING IS FINE HERE, and it is the opposite call from /cards
 * on purpose: this list is 203 sets, not 21,066 cards. The whole thing is
 * already in the DOM, so filtering it is a array pass rather than a round trip,
 * and a set list has no pagination to keep in a URL.
 *
 * LOGOS, NOT SYMBOLS. The first version rendered `symbol.png` and it was a
 * measured mistake: every one of 25 sampled sets 404s on that path, and TCGdex
 * serves the 404 as `content-type: image/png` with a 146-byte body, which
 * Chrome's Opaque Response Blocking rejects — a page of ERR_BLOCKED_BY_ORB in
 * the network panel. Worse, React 19 emits a `<link rel="preload">` for every
 * `<img>` it renders during SSR, so the built page eagerly requested 166 of
 * them before anything was on screen.
 *
 * `logo.webp` is the right asset twice over: it exists for most sets, and it is
 * 40KB against `logo.png`'s 131KB. THE URL ARRIVES COMPLETE now — resolving
 * which host and which extension is lib/pokemon-image.ts's job, because a
 * Japanese set has no TCGdex logo at all and takes its mark from Limitless
 * instead. Appending an extension here appended it to that one too, and
 * `M6.png.webp` is a 404 nobody sees until they look at the page.
 *
 * Sets with no mark anywhere still get `onError` and a lettered tile rather
 * than a broken image — which is also why these cards are a client component.
 */

export type BrowseSet = {
  id: string;
  /**
   * The URL segment for this set, when it differs from the id.
   *
   * `neo1` names a set in BOTH catalogues, so a Japanese set links as
   * `ja~neo1` — the same qualifier a Japanese card id already carries. The id
   * itself stays bare, because the tile's lettered fallback is built from it
   * and `ja` is not a set's initials.
   */
  slug?: string;
  name: string;
  /**
   * Which catalogue this set belongs to. Absent means English, for the One
   * Piece browser and anything written before the Japanese sets were listed.
   */
  language?: "en" | "ja";
  serie: string;
  releaseDate?: string;
  cardCount: number;
  /** The full URL of the set's mark. Absent for sets that have none anywhere. */
  logo?: string;
  /**
   * A wordmark or the small expansion symbol — they need different sizes.
   * TCGdex's logo fills the tile's width; Limitless's symbol is ~1.5 KB and
   * would be a blurry smear stretched to the same box.
   */
  logoKind?: "logo" | "symbol";
};

type SortId = "newest" | "oldest" | "cards" | "name";

const SORTS: { id: SortId; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "cards", label: "Card count" },
  { id: "name", label: "Name A–Z" },
];

/** Stable per-era accent, so a set's tile keeps its colour between visits rather than shuffling. */
const ACCENTS = ["bg-pokemon-red text-white", "bg-pokemon-blue text-white", "bg-pokemon-yellow text-black"];
function accentFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}

function yearOf(set: BrowseSet): string {
  return set.releaseDate?.slice(0, 4) ?? "";
}

/**
 * The tile's second line: the release month, or nothing at all.
 *
 * Returning "" rather than "Release date unknown" is deliberate. The Pokémon
 * catalogue has a date for every set; the One Piece one has none, because
 * Bandai's card list does not publish them — so that placeholder was about to
 * appear on all 60 tiles, saying nothing 60 times. An absent fact should take
 * no room. The caller drops the separator when this is empty.
 */
function monthYear(set: BrowseSet): string {
  if (!set.releaseDate) return "";
  const d = new Date(set.releaseDate);
  return Number.isNaN(d.getTime())
    ? set.releaseDate
    : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * `hrefBase` exists because this grid now serves two catalogues that live on
 * different routes. Without it every One Piece tile linked to `/sets/569301`,
 * which lands in the POKÉMON `[setId]` route and 404s — the set id is real, but
 * for the wrong catalogue.
 */
export function SetsBrowser({
  sets,
  eras,
  hrefBase = "/sets",
}: {
  sets: BrowseSet[];
  eras: string[];
  hrefBase?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("newest");
  const [era, setEra] = useState<string | null>(null);
  /**
   * ONE LANGUAGE AT A TIME, never both. A Japanese set and the English set it
   * became are the same cards released twice — listing them together doubles
   * the grid with near-duplicates and makes "which Stellar Crown is this"
   * a question the reader has to answer instead of the page.
   */
  const [language, setLanguage] = useState<"en" | "ja">("en");

  // Only offered when there is something to switch to, so the One Piece
  // browser — which passes no languages — does not grow a control for a
  // choice it does not have.
  const bilingual = useMemo(() => sets.some((s) => s.language === "ja"), [sets]);

  /**
   * THE ERAS OF THE LANGUAGE ON SCREEN, not of the whole corpus.
   *
   * The `eras` prop is built server-side from every set the page holds, and
   * with both catalogues in one list that offered "Trainer kits" and
   * "McDonald's Collection" while the Japanese grid was showing — choices that
   * could only ever empty it. An option that cannot match anything is not a
   * filter, it is a trap.
   *
   * Derived from the sets themselves so it cannot fall out of step, in the
   * order the grid already sorts them (newest first) so the list reads the same
   * way the page does.
   */
  const visibleEras = useMemo(() => {
    const seen: string[] = [];
    for (const set of sets) {
      if (bilingual && (set.language ?? "en") !== language) continue;
      if (!seen.includes(set.serie)) seen.push(set.serie);
    }
    return seen.length > 0 ? seen : eras;
  }, [sets, eras, language, bilingual]);

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = sets.filter(
      (s) =>
        (!bilingual || (s.language ?? "en") === language) &&
        // The id is searchable alongside the name because 157 Japanese sets
        // have no published English name and are labelled by their code — the
        // only handle a reader has on those.
        (!needle || s.name.toLowerCase().includes(needle) || s.id.toLowerCase().includes(needle)) &&
        (!era || s.serie === era)
    );
    filtered.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "");
        case "cards":
          return b.cardCount - a.cardCount;
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
      }
    });

    // Grouping only makes sense while the order is chronological — sorting by
    // card count or name deliberately flattens into one list, because era
    // headings over a name-sorted list would imply an order that isn't there.
    if (sort === "cards" || sort === "name") return [{ era: null as string | null, sets: filtered }];

    const byEra = new Map<string, BrowseSet[]>();
    for (const s of filtered) {
      const list = byEra.get(s.serie) ?? [];
      list.push(s);
      byEra.set(s.serie, list);
    }
    return [...byEra.entries()].map(([name, list]) => ({ era: name, sets: list }));
  }, [sets, query, sort, era, language, bilingual]);

  const total = grouped.reduce((n, g) => n + g.sets.length, 0);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        {bilingual ? (
          <div className="flex overflow-hidden rounded-full border-2 border-black shadow-hard-sm">
            {(
              [
                ["en", "English"],
                ["ja", "Japanese"],
              ] as const
            ).map(([value, name]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setLanguage(value);
                  // The eras are different on each side — "Sword & Shield"
                  // does not name a Japanese series — so a filter carried
                  // across would silently empty the grid.
                  setEra(null);
                }}
                aria-pressed={language === value}
                className={`px-4 py-2 text-[13px] font-black ${
                  language === value ? "bg-foreground text-white" : "bg-card-surface"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sets by name…"
          aria-label="Search sets"
          className="min-w-[220px] flex-1 rounded-md border-2 border-black bg-card-surface px-3.5 py-2.5 text-sm shadow-hard-sm outline-none"
        />
        <button
          type="button"
          onClick={() => setEra(null)}
          aria-pressed={era === null}
          className={`rounded-full border-2 border-black px-4 py-2 text-[13px] font-black ${era === null ? "bg-foreground text-white" : "bg-card-surface"}`}
        >
          All Eras
        </button>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortId)}
          aria-label="Sort sets"
          className="rounded-md border-2 border-black bg-card-surface px-3.5 py-2.5 text-[13px] font-bold shadow-hard-sm"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              Sort: {s.label}
            </option>
          ))}
        </select>
        <select
          value={era ?? ""}
          onChange={(e) => setEra(e.target.value || null)}
          aria-label="Filter by era"
          className="rounded-md border-2 border-black bg-card-surface px-3.5 py-2.5 text-[13px] font-bold shadow-hard-sm"
        >
          <option value="">All eras</option>
          {visibleEras.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>

      {total === 0 ? (
        <p className="rounded-lg border-2 border-black bg-card-surface p-4 text-sm shadow-hard-sm">
          No sets match “{query}”.
        </p>
      ) : (
        grouped.map((group, groupIndex) => (
          <section key={group.era ?? "all"} className={groupIndex > 0 ? "mt-14" : ""}>
            {group.era && (
              <div className="mb-6 flex items-baseline gap-3">
                <h2 className="text-[22px] font-black tracking-[-0.55px]">{group.era}</h2>
                <span className="border-l-2 border-border-subtle pl-3 text-xs font-bold tracking-[0.6px] text-muted-text uppercase">
                  {eraRange(group.sets)}
                </span>
              </div>
            )}
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {group.sets.map((set, i) => (
                <SetCard key={`${set.language ?? "en"}~${set.id}`} set={set} index={i} hrefBase={hrefBase} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function eraRange(sets: BrowseSet[]): string {
  const years = sets.map(yearOf).filter(Boolean).sort();
  if (years.length === 0) return "";
  const first = years[0];
  const last = years[years.length - 1];
  return first === last ? first : `${first} – ${last}`;
}

function SetCard({ set, index, hrefBase }: { set: BrowseSet; index: number; hrefBase: string }) {
  const [logoFailed, setLogoFailed] = useState(false);
  // Only the first row or so animates — see globals.css's set-card-enter for
  // why this is CSS and not a JS whileInView (the motion version rendered
  // opacity:0 into the server HTML for all 203 cards).
  const animated = index < 8;

  return (
    <li
      className={animated ? "set-card-enter" : undefined}
      style={animated ? { animationDelay: `${index * 0.06}s` } : undefined}
    >
      <Link
        href={`${hrefBase}/${encodeURIComponent(set.slug ?? set.id)}`}
        className="group relative flex h-full flex-col overflow-hidden rounded-lg border-2 border-black bg-card-surface p-5 shadow-hard-md transition-[transform,box-shadow] duration-150 hover:-translate-x-[3px] hover:-translate-y-[3px] hover:shadow-hard-lg"
      >
        {/* The logo sits unboxed and left-aligned: a set logo is already a
            finished piece of artwork with its own outline, and the 48px
            bordered tile it used to sit in both cropped it and fought it.
            A set with NO logo still needs a shape to occupy the same space,
            so only the fallback keeps the tile. */}
        {set.logo && !logoFailed ? (
          /* eslint-disable-next-line @next/next/no-img-element -- two upstream hosts serving pre-sized files; lazy + onError are what this needs and next/image cannot express the fallback */
          <img
            src={set.logo}
            alt=""
            loading="lazy"
            decoding="async"
            className={
              set.logoKind === "symbol"
                ? "mb-4 h-14 w-14 self-start object-contain object-left"
                : "mb-4 h-14 w-auto max-w-[70%] self-start object-contain object-left"
            }
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span
            className={`mb-4 flex h-14 w-14 items-center justify-center rounded-md border-2 border-black text-base font-black ${accentFor(set.id)}`}
          >
            {set.name.slice(0, 2).toUpperCase()}
          </span>
        )}

        <span className="mb-0.5 text-base font-black tracking-[-0.3px]">{set.name}</span>
        <span className="mb-3 text-xs font-bold text-muted-text">
          {monthYear(set) ? `${monthYear(set)} · ` : ""}
          {set.cardCount} cards
        </span>

        <span className="mt-auto flex items-center justify-between">
          <span className="rounded-full border-2 border-black bg-muted-surface px-2.5 py-0.5 text-xs font-black">
            {set.cardCount}
          </span>
          {/* Where a price movement will go once there is one to show. It is
              deliberately not a number: this codebase does not render a figure
              it has not measured, and trend data needs a price history the
              catalogue does not have (see docs/pokemon-catalogue.md §7). */}
          <span className="text-[11px] font-bold text-muted-text opacity-0 transition-opacity group-hover:opacity-100">
            Trends soon
          </span>
        </span>
      </Link>
    </li>
  );
}
