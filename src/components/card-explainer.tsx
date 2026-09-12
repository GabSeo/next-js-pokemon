"use client";

import { useState } from "react";

/**
 * "Explain this card" — the generative half of the scan.
 *
 * WHY IT IS A BUTTON AND NOT AUTOMATIC, and there are three separate reasons
 * that happen to agree:
 *
 *   it is metered — free, on Groq's free tier, but a free allowance is a
 *                ceiling and it should not be spent on a card somebody scanned
 *                by accident
 *   it is slow — the match is 70 ms and this is TEN TO TWELVE SECONDS, measured
 *                on real cards; running it automatically would make every
 *                identification feel that slow
 *   it is not always wanted — somebody cataloguing forty cards wants the
 *                identification and nothing else, forty times over
 *
 * WHY THE FACTS ARE SHOWN. This is the first thing on the site a reader has any
 * reason to distrust: everything else is a measurement or a record, and this is
 * a model writing sentences. The sheet it was given folds open underneath, so
 * "where did that number come from" is one tap rather than an act of faith. It
 * is also how a wrong answer gets diagnosed — if the figure is wrong ON the
 * sheet, the fault is ours and not the model's.
 */

type Printing = {
  finish?: string;
  origin: string;
  rarity?: string;
  cardmarketEur?: number;
  tcgplayerUsd?: number;
};

type Facts = {
  game: string;
  name: string;
  code: string;
  priceNote: string;
  printings: Printing[];
  context?: {
    set?: { name: string; releaseDate?: string; cardCount?: number };
    standing?: { rank: number; outOf: number; setLowEur: number; setMedianEur: number; setHighEur: number };
    history?: { date: string; eur?: number }[];
  };
  graded?: {
    languages: string[];
    rows: { condition: string; cells: Record<string, { median?: number; currency?: string; count?: number }> }[];
    psa10Multiple: Record<string, number>;
    note: string;
  };
};

/**
 * Every eBay reading that went into the answer, as a table.
 *
 * THE WHOLE TABLE, NOT A SUMMARY. An earlier version kept only PSA 10 and raw
 * and dropped PSA 9 and PSA 8 — which is throwing away evidence to save four
 * lines. This block is the eBay counterpart of "what it was told": its job is
 * to let a reader check the sentences above against the numbers behind them,
 * and a summary cannot do that.
 *
 * TIERS DOWN, LANGUAGES ACROSS, because the comparison a collector actually
 * makes is between conditions of the same card, and a column is read faster
 * than a row. Japanese beside English in the same row makes the other
 * comparison — the two markets for one card — free.
 *
 * THE COUNT IS SHOWN under each figure. A median of two asks is not a market,
 * and a bare price gives the reader no way to tell that from a median of sixty.
 *
 * IT SCROLLS SIDEWAYS RATHER THAN WRAPPING. Two languages fit a phone; a third
 * would not, and a table that reflows into unreadable columns is worse than one
 * that admits it is wider than the screen.
 */
function Graded({ graded }: { graded: NonNullable<Facts["graded"]> }) {
  const money = (cell?: { median?: number; currency?: string }) =>
    cell?.median === undefined ? "—" : `${cell.currency ?? ""} ${cell.median.toFixed(2)}`.trim();

  return (
    <div className="mt-3 border-t border-black/15 pt-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-muted-text">Asking on eBay now</span>
        {Object.entries(graded.psa10Multiple).map(([language, multiple]) => (
          <span key={language} className="shrink-0 text-[10px] font-black">
            PSA 10 = {multiple}x raw
            {graded.languages.length > 1 ? ` (${language.slice(0, 2).toUpperCase()})` : ""}
          </span>
        ))}
      </div>

      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted-text">
              <th className="pb-1 pr-2 font-black uppercase tracking-wide">Grade</th>
              {graded.languages.map((language) => (
                <th key={language} className="pb-1 pl-2 text-right font-black uppercase tracking-wide">
                  {language}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {graded.rows.map((row) => (
              <tr key={row.condition} className="border-t border-muted-surface">
                <td className="py-1 pr-2 font-black">{row.condition}</td>
                {graded.languages.map((language) => {
                  const cell = row.cells[language];
                  return (
                    <td key={language} className="py-1 pl-2 text-right tabular-nums">
                      {money(cell)}
                      {cell?.count ? (
                        <span className="block text-[9px] font-normal text-muted-text">{cell.count} listed</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-text">{graded.note}</p>
    </div>
  );
}

function Figures({ facts }: { facts: Facts }) {
  const priced = facts.printings.filter((p) => p.cardmarketEur !== undefined || p.tcgplayerUsd !== undefined);
  const standing = facts.context?.standing;
  const history = (facts.context?.history ?? []).filter((h) => typeof h.eur === "number");

  // THE SPREAD, not each printing's price — the printings are listed below in
  // full. What a glance needs is whether the versions differ enough to matter,
  // and measured across the catalogue 60.3% of priced cards differ by a median
  // 3.45x, so the multiple is the number that carries.
  const eur = priced.map((p) => p.cardmarketEur).filter((v): v is number => v !== undefined);
  const spread = eur.length > 1 ? Math.max(...eur) / Math.min(...eur) : undefined;

  const first = history[0]?.eur;
  const last = history[history.length - 1]?.eur;
  const moved = first !== undefined && last !== undefined && first !== 0 ? (last - first) / first : undefined;

  const cells: { label: string; value: string; tone?: "up" | "down" }[] = [];

  const headline = priced[0];
  if (headline?.cardmarketEur !== undefined) {
    cells.push({ label: "Cardmarket", value: `EUR ${headline.cardmarketEur.toFixed(2)}` });
  }
  if (headline?.tcgplayerUsd !== undefined) {
    cells.push({ label: "TCGplayer", value: `USD ${headline.tcgplayerUsd.toFixed(2)}` });
  }
  if (standing) {
    cells.push({ label: "In its set", value: `#${standing.rank} of ${standing.outOf}` });
  }
  if (spread !== undefined && spread >= 1.05) {
    cells.push({ label: "Printings differ", value: `${spread.toFixed(1)}x` });
  }
  if (moved !== undefined) {
    cells.push({
      label: history.length > 1 ? `Since ${history[0].date}` : "Last reading",
      // ZERO IS SAID AS "no change", not as "0.0%". A percentage of nothing
      // reads like a measurement failed; the words say the reading held.
      value: moved === 0 ? "no change" : `${moved > 0 ? "+" : ""}${(moved * 100).toFixed(1)}%`,
      tone: moved === 0 ? undefined : moved > 0 ? "up" : "down",
    });
  }

  if (cells.length === 0) return null;

  return (
    <ul
      className="grid gap-1.5"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))" }}
    >
      {cells.map((cell) => (
        <li key={cell.label} className="min-w-0">
          <div className="truncate text-[9px] font-black uppercase tracking-wide text-muted-text">{cell.label}</div>
          <div
            className="truncate text-[14px] font-black tabular-nums"
            style={cell.tone === "up" ? { color: "#1d7a4f" } : cell.tone === "down" ? { color: "#a32d2d" } : undefined}
          >
            {cell.value}
          </div>
        </li>
      ))}
    </ul>
  );
}

type State =
  | { phase: "idle" }
  | { phase: "asking" }
  | { phase: "done"; text: string; facts: Facts; web?: string }
  | { phase: "failed"; reason: string };

/**
 * The model is asked for bold headings and paragraphs, and gets markdown.
 *
 * A PARSER RATHER THAN A LIBRARY, because the shape is fixed by the prompt:
 * `**heading**` on its own line, then prose. Pulling in a markdown renderer to
 * read three bold lines would ship a parser for a grammar nothing here emits,
 * and it would also render whatever ELSE a model decided to write — links,
 * images, HTML — which is a much wider door than this needs.
 *
 * Anything that is not a heading renders as plain text, so a model that ignores
 * the format produces something readable rather than something broken.
 */
function Rendered({ text }: { text: string }) {
  return (
    <div className="grid gap-3">
      {text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block, index) => {
          const heading = /^\*\*(.+?)\*\*\s*(?:—|-|:)?\s*([\s\S]*)$/.exec(block);
          if (!heading) {
            return (
              <p key={index} className="text-[14px] leading-[1.6]">
                {block}
              </p>
            );
          }
          return (
            <div key={index}>
              <div className="text-[10px] font-black uppercase tracking-[0.08em] text-muted-text">{heading[1]}</div>
              <p className="mt-1 text-[14px] leading-[1.6]">{heading[2]}</p>
            </div>
          );
        })}
    </div>
  );
}

export function CardExplainer({ tcg, code }: { tcg: "pokemon" | "onepiece"; code: string }) {
  const [state, setState] = useState<State>({ phase: "idle" });

  async function ask() {
    setState({ phase: "asking" });
    try {
      const response = await fetch("/api/scan/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tcg, code }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        text?: string;
        facts?: Facts;
        web?: string;
        error?: string;
      };
      if (!response.ok || !payload.text || !payload.facts) {
        setState({ phase: "failed", reason: payload.error ?? `The explainer returned ${response.status}.` });
        return;
      }
      setState({ phase: "done", text: payload.text, facts: payload.facts, web: payload.web });
    } catch {
      setState({ phase: "failed", reason: "Could not reach the explainer. Check your connection." });
    }
  }

  if (state.phase === "idle" || state.phase === "failed") {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={ask}
          className="w-full rounded-md border-2 border-black bg-muted-surface px-3 py-2 text-[12px] font-black hover:bg-white"
        >
          {state.phase === "failed" ? "Try explaining it again" : "Explain this card to me"}
        </button>
        {state.phase === "failed" ? (
          <p className="mt-1 text-[11px] text-muted-text">{state.reason}</p>
        ) : null}
      </div>
    );
  }

  if (state.phase === "asking") {
    return (
      <p className="mt-3 rounded-md border-2 border-black bg-muted-surface px-3 py-2 text-[12px] font-black">
        Writing it out… about ten seconds
        <span className="mt-0.5 block text-[11px] font-normal text-muted-text">
          {/* THE WAIT IS NAMED, because an unlabelled ten seconds reads as a
              hang. Measured on real cards: 10.1 s and 12.5 s. */}
          Only this card&rsquo;s own record is sent — no photo, and nothing about you.
        </span>
      </p>
    );
  }

  return (
    /* THREE LAYERS, NOT SEVEN BLOCKS. Reported as "insanely difficult to read
       with 0 UX structure", and the reading was right: every section had the
       same tiny uppercase label, the same hairline rule and the same type size,
       so a panel with five things in it presented five things of equal weight
       and let the reader sort it out.

       The hierarchy is now the one the content already has:

         the ANSWER      prose, largest type, white ground, nothing above it
         the EVIDENCE    tables, recessed on a tinted ground, smaller
         the ASIDE       the web note, quietest, dashed rule, visibly elsewhere

       Nothing is hidden — the tables were asked for explicitly — but a table
       reads as reference rather than as prose once it sits on its own ground,
       and the eye stops treating it as something to read start to finish. */
    <div className="mt-3 overflow-hidden rounded-md border-2 border-black bg-white">
      {/* THE ANSWER FIRST. It was under the figures strip, which put a row of
          numbers between the reader and the sentences written for them. */}
      <div className="p-3.5">
        <Rendered text={state.text} />
      </div>

      {/* THE EVIDENCE, RECESSED. One ground, one heading, both tables inside —
          rather than two sibling blocks each announcing itself. */}
      <div className="border-t-2 border-black bg-muted-surface px-3.5 py-3">
        <div className="text-[10px] font-black uppercase tracking-wide text-muted-text">The numbers</div>
        <div className="mt-2">
          <Figures facts={state.facts} />
        </div>
        {state.facts.graded ? <Graded graded={state.facts.graded} /> : null}
      </div>

      {/* WHAT THE WEB ADDS, AND VISIBLY FROM SOMEWHERE ELSE.
          THE SEPARATION IS THE FEATURE, not decoration. Everything above this
          line is checkable against the panel below — every figure came from our
          own files and the reader can open them and look. This paragraph
          cannot be checked that way: it came from the open web, through a model
          that searched it. Those are different kinds of claim, and running them
          together in one block would quietly lend the second the first's
          credibility.
          So it is ruled off, labelled, and given the quieter type. It is also
          allowed to be absent — most cards have no story, and the stage is told
          that saying so is the right answer rather than a failure. */}
      {state.web ? (
        <div className="border-t-2 border-dashed border-black/25 bg-muted-surface px-3.5 pb-3 pt-2.5">
          <div className="text-[10px] font-black uppercase tracking-wide text-muted-text">
            From the web, not from our records
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-text">{state.web}</p>
        </div>
      ) : null}

      {/* THE EVIDENCE, FOLDED. `details` needs no state and works before
          hydration, and the closed state is the right default: somebody who
          trusts the answer should not have to scroll past its footnotes. */}
      <details className="border-t-2 border-black bg-muted-surface px-3.5 py-2.5">
        <summary className="cursor-pointer text-[11px] font-black uppercase tracking-wide text-muted-text">
          What it was told
        </summary>
        <ul className="mt-1.5 grid gap-1">
          {state.facts.printings.map((print, index) => (
            <li key={index} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate">
                {print.finish ?? "single printing"}
                <span className="text-muted-text">
                  {" · "}
                  {print.origin}
                  {print.rarity ? ` · ${print.rarity}` : ""}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {print.cardmarketEur !== undefined ? `EUR ${print.cardmarketEur.toFixed(2)}` : ""}
                {print.cardmarketEur !== undefined && print.tcgplayerUsd !== undefined ? " · " : ""}
                {print.tcgplayerUsd !== undefined ? `USD ${print.tcgplayerUsd.toFixed(2)}` : ""}
                {print.cardmarketEur === undefined && print.tcgplayerUsd === undefined ? "no figure" : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-text">
          {state.facts.priceNote} Written from this list and nothing else — it has no access to the internet
          and was told not to use anything it remembers about this card.
        </p>
      </details>
    </div>
  );
}
