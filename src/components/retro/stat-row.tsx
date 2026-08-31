/**
 * The figures under a chart, in one typography system.
 *
 * The grade ladder and the market gap carry differently shaped data — four
 * single prices against a handful of two-market comparisons — and each had
 * grown its own layout for it: a flat four-column row with the label inline,
 * against a two-column list with the label baseline-aligned beside the value.
 * Same job, same card, two typefaces' worth of difference between them.
 *
 * The shape stays different because the data is different; only the column
 * count varies. Everything else — label size, value size, the gap between
 * them, the rule above — is fixed here so the two rows read as one family.
 *
 * These rows are not a caption. Both charts render to SVG, so their numbers
 * exist as geometry rather than text; this is where an agent parsing raw
 * HTML actually finds them.
 */
export function StatRow({ columns, children }: { columns: 2 | 4; children: React.ReactNode }) {
  return (
    <dl
      className={`mt-3 grid gap-x-5 gap-y-3 border-t border-border-subtle pt-3 ${
        columns === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-2"
      }`}
    >
      {children}
    </dl>
  );
}

/** Label above, value below — never inline, so a long value cannot shove the label out of line. */
export function StatCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-black tracking-[-0.2px] tabular-nums">{children}</dd>
    </div>
  );
}
