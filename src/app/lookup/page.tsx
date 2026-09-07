import type { Metadata } from "next";
import Link from "next/link";
import { lookupCards, type LookupMatch } from "@/lib/card-lookup";

/**
 * Find a card by its code, its printed number, or its name — both games.
 *
 * THIS IS THE SCAN WITHOUT THE CAMERA (docs/free-tier-catalogue.md, Phase 4).
 * The pipeline is capture → read → match → choose → store, and only the first
 * two steps need a photo. Shipping match/choose against a text box first means
 * the interaction that carries the product is in use before any OCR risk is
 * taken — and when the camera arrives, a bad read degrades to this page rather
 * than to an error. Typing `OP05-119` will always reach the same matcher.
 *
 * REQUEST-TIME BY DEFINITION, like /cards: reading `searchParams` makes the
 * route dynamic, which is right — there is no useful static shell for an
 * arbitrary query. It is still free. The whole path is catalogues on disk, and
 * `scripts/check-free-tier.mts` fails the build if that ever stops being true.
 *
 * NO PRICES HERE, deliberately. This page answers "which card do you mean";
 * the card page answers "which printing", and only that second question has an
 * honest place to put a number against it.
 */

export const metadata: Metadata = {
  title: "Find a card by code, number or name",
  description:
    "Look up any Pokémon or One Piece card by its card code (OP05-119), its printed number (190/182), " +
    "or its name, and see every printing of it.",
  alternates: { canonical: "/lookup" },
};

const EXAMPLES = [
  { q: "OP05-119", note: "a One Piece card code — 9 printings across 4 packs" },
  { q: "190/182", note: "the number printed on a Pokémon card" },
  { q: "sv08-001", note: "a Pokémon card id" },
  { q: "Monkey.D.Luffy", note: "a name, in either game" },
];

export default async function LookupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.q;
  const query = typeof raw === "string" ? raw : "";
  const result = lookupCards(query);

  return (
    <main className="mx-auto w-full max-w-[1180px] px-6 py-6 pb-24">
      <div className="mb-6">
        <h1 className="text-[32px] font-black tracking-[-0.8px]">Find a card</h1>
        <p className="mt-1 text-sm text-muted-text">
          A card code, the number printed on the card, or a name. Pokémon and One Piece.
        </p>
      </div>

      {/* A plain GET form: no client JavaScript, shareable URLs, and it works
          before hydration. The camera in Phase 5 becomes another way to fill
          this same field rather than a separate path. */}
      <form action="/lookup" method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="OP05-119, 190/182, or Charizard"
          aria-label="Card code, printed number, or name"
          autoFocus
          className="w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-sm font-bold"
          style={{ boxShadow: "3px 3px 0 0 #000" }}
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg border-2 border-black bg-muted-surface px-4 py-2 text-sm font-black"
          style={{ boxShadow: "3px 3px 0 0 #000" }}
        >
          Find
        </button>
      </form>

      <p className="mt-3 text-xs text-muted-text">
        Have the card in hand?{" "}
        <Link href="/scan" className="font-black underline underline-offset-4">
          Scan it instead
        </Link>{" "}
        — the photo is read on your device and lands right back here.
      </p>

      {query.length === 0 ? (
        <div className="mt-8">
          <p className="text-xs font-black uppercase tracking-wide text-muted-text">Try one of these</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((example) => (
              <li key={example.q}>
                <Link
                  href={`/lookup?q=${encodeURIComponent(example.q)}`}
                  className="flex flex-col rounded-lg border-2 border-black bg-white p-3 transition-transform hover:-translate-y-0.5"
                  style={{ boxShadow: "3px 3px 0 0 #000" }}
                >
                  <span className="font-black">{example.q}</span>
                  <span className="mt-0.5 text-xs text-muted-text">{example.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {/* Saying how the input was READ, so a wrong reading is visible
              rather than mysterious — "190/182" matching two sets is the
              normal case, not a bug, and the reader should be told which. */}
          <p className="mt-6 rounded-lg border-2 border-black bg-muted-surface p-3 text-xs">
            {result.matches.length === 0
              ? `No card matches “${result.query}”. Card codes look like OP05-119, printed numbers like 190/182.`
              : `${result.matches.length}${result.truncated > 0 ? "+" : ""} card${
                  result.matches.length === 1 ? "" : "s"
                } — read as ${result.interpretation}. Pick one to see every printing of it.`}
          </p>

          {result.truncated > 0 ? (
            <p className="mt-2 text-xs text-muted-text">
              {result.truncated} more not shown. Add a set name or use the card code to narrow it.
            </p>
          ) : null}

          <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {result.matches.map((match) => (
              <li key={`${match.tcg}:${match.code}`}>
                <MatchTile match={match} />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

const GAME_LABEL: Record<LookupMatch["tcg"], string> = { pokemon: "Pokémon", onepiece: "One Piece" };

function MatchTile({ match }: { match: LookupMatch }) {
  return (
    <Link
      href={`/card/${match.tcg}/${encodeURIComponent(match.code)}`}
      className="flex h-full flex-col rounded-lg border-2 border-black bg-white p-2 transition-transform hover:-translate-y-0.5"
      style={{ boxShadow: "3px 3px 0 0 #000" }}
    >
      <div className="mb-2 overflow-hidden rounded border-2 border-black bg-muted-surface">
        {match.image ? (
          /* eslint-disable-next-line @next/next/no-img-element -- both sources are pre-sized: TCGdex publishes quality tiers, and /api/one-piece-image resizes with sharp (docs/free-tier-catalogue.md §7) */
          <img
            src={match.image}
            alt={match.name}
            width={300}
            height={420}
            loading="lazy"
            className="aspect-[300/420] w-full object-contain"
          />
        ) : (
          <div className="aspect-[300/420] w-full" />
        )}
      </div>

      <div className="flex-1">
        <div className="text-xs font-black leading-tight">{match.name}</div>
        <div className="mt-0.5 text-[11px] text-muted-text">{match.code}</div>
        <div className="mt-1 text-[11px] text-muted-text">{match.origin}</div>
        {match.detail ? <div className="mt-1 text-[11px] text-muted-text">{match.detail}</div> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="rounded-full border-2 border-black bg-muted-surface px-2 py-0.5 text-[10px] font-black">
          {GAME_LABEL[match.tcg]}
        </span>
        <span className="rounded-full border-2 border-black bg-muted-surface px-2 py-0.5 text-[10px] font-black">
          {match.printings} printing{match.printings === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
  );
}
