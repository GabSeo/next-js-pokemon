"use client";

import type { ReactNode } from "react";

/**
 * The pieces both market panels are built from, so TCGplayer and Cardmarket
 * read as one system rather than two components that happen to sit together.
 *
 * They publish different metrics and must never be merged into a single
 * "global price" — but the SHAPE they are presented in should be identical,
 * because a reader switching markets is comparing marketplaces, and any
 * difference in layout would read as a difference in the data.
 */

/**
 * The headline figure.
 *
 * The currency is a muted suffix rather than a prefix so the number is what
 * the eye lands on — led with "USD", every price on the page starts with the
 * same three characters and the digits arrive late.
 *
 * `data value` carries the exact unformatted number, so an agent parsing the
 * markup reads the precise figure while a person reads the formatted one.
 */
export function Headline({ label, amount, currency }: { label: string; amount: number; currency: string }) {
  return (
    <div>
      <p className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">{label}</p>
      <data
        className="block text-[clamp(30px,4.5vw,42px)] leading-none font-black tracking-[-1.5px] tabular-nums"
        value={String(amount)}
      >
        {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <span className="ml-2 align-middle text-[14px] font-bold tracking-normal text-muted-text">{currency}</span>
      </data>
    </div>
  );
}

/** A stated non-price: an absent listing, or a source we could not reach. Never a blank. */
export function Stated({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <p className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">{label}</p>
      <p className="text-2xl font-black tracking-[-0.6px]">{value}</p>
      <Note>{note}</Note>
    </div>
  );
}

/**
 * The secondary figures as a hairline grid rather than loose rows.
 *
 * Two columns, with the last cell widening to fill the row when the count is
 * odd. TCGplayer publishes four of these and Cardmarket five, so any fixed
 * column count orphans one of them into a half-empty final row — four in three
 * columns leaves a gap, five in two columns leaves a gap. Letting the odd one
 * out span instead means neither panel ever shows a hole.
 */
export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="mt-4 grid grid-cols-2 border-t-2 border-l-2 border-border-subtle [&>*:last-child:nth-child(odd)]:col-span-2">
      {children}
    </dl>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r-2 border-b-2 border-border-subtle px-3 py-2">
      <dt className="text-[10px] font-black tracking-[0.4px] text-muted-text uppercase">{label}</dt>
      <dd className="text-sm font-black whitespace-nowrap tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The caveat, on a coloured rule so it reads as commentary rather than as one
 * more figure. It is the sentence that stops a number being misread, so it has
 * to be visibly not-a-number.
 */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 border-l-4 border-pokemon-blue bg-muted-surface px-3 py-2 text-[12px] font-bold text-pretty">
      {children}
    </p>
  );
}
