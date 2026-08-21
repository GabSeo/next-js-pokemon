/**
 * Small inline label marking a value as illustrative placeholder data, not
 * a real fetched fact — pairs with everything in lib/illustrative.ts.
 * Deliberately plain text (not hidden, not decorative-only) so it's just as
 * visible to an AI agent reading raw HTML as it is to a human, matching the
 * site's no-JS-visible-data rule: if a number isn't real, that has to be
 * real too.
 */
export function IllustrativeTag({ label = "Illustrative — not connected" }: { label?: string }) {
  return (
    <span className="inline-block rounded-full border-2 border-black bg-muted-surface px-2 py-0.5 text-[10px] font-black tracking-[0.25px] text-muted-text uppercase">
      {label}
    </span>
  );
}
