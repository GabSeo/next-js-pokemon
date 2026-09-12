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
};

/**
 * The figures, rendered by US rather than written by the model.
 *
 * WHY THIS IS THE IMPORTANT HALF. A collector wants four numbers and wants them
 * in half a second: what it costs, where it ranks, how far apart the printings
 * are, which way it moved. A paragraph is the wrong shape for that — it has to
 * be read to be scanned. And a model writing numbers is the one part of this
 * feature that can be wrong, so the numbers that matter most are the ones it
 * never touches.
 *
 * THE MODEL IS TOLD THIS STRIP EXISTS and asked not to repeat it, which is what
 * lets its two paragraphs be under ninety words. It writes the reading; the
 * strip carries the reading material.
 *
 * SO ONE PANEL SERVES BOTH READERS without being twice as long: somebody who
 * has never collected reads the sentences and ignores the strip, somebody who
 * has collected for years reads the strip and may never reach the sentences.
 */
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
      className="grid gap-1.5 border-b-2 border-muted-surface pb-3"
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
  | { phase: "done"; text: string; facts: Facts }
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
    <div className="grid gap-2">
      {text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block, index) => {
          const heading = /^\*\*(.+?)\*\*\s*(?:—|-|:)?\s*([\s\S]*)$/.exec(block);
          if (!heading) {
            return (
              <p key={index} className="text-[13px] leading-relaxed">
                {block}
              </p>
            );
          }
          return (
            <div key={index}>
              <div className="text-[11px] font-black uppercase tracking-wide text-muted-text">{heading[1]}</div>
              <p className="mt-0.5 text-[13px] leading-relaxed">{heading[2]}</p>
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
        error?: string;
      };
      if (!response.ok || !payload.text || !payload.facts) {
        setState({ phase: "failed", reason: payload.error ?? `The explainer returned ${response.status}.` });
        return;
      }
      setState({ phase: "done", text: payload.text, facts: payload.facts });
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
    <div className="mt-3 rounded-md border-2 border-black bg-white p-3">
      <Figures facts={state.facts} />
      <div className="mt-3">
        <Rendered text={state.text} />
      </div>

      {/* THE EVIDENCE, FOLDED. `details` needs no state and works before
          hydration, and the closed state is the right default: somebody who
          trusts the answer should not have to scroll past its footnotes. */}
      <details className="mt-3 border-t-2 border-muted-surface pt-2">
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
