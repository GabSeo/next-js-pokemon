/**
 * A numbered step marker — 01, 02. Square, hard-bordered, because the Grading
 * Center is a sequence and not a pile of cards: read the grades, then read the
 * verdict they add up to.
 *
 * In its own module rather than beside the section that lays them out, and
 * that is not tidiness. grading-center-section.tsx is a server component that
 * reaches lib/cards for franchiseLabel, which reaches build-cache and
 * `node:fs`; the client component rendering these steps imported the marker
 * from there and dragged that whole graph into the browser bundle. Turbopack
 * caught it as "the chunking context does not support external modules
 * (request: node:fs)" — a build failure, not a warning. A presentational
 * component shared across the server/client line has to sit somewhere that
 * imports neither.
 */
export function StepHeading({ step, title, tone }: { step: string; title: string; tone: "red" | "yellow" }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span
        className={`flex h-6 w-6 items-center justify-center border-2 border-black text-[11px] font-black ${
          tone === "red" ? "bg-pokemon-red text-white" : "bg-pokemon-yellow text-foreground"
        }`}
      >
        {step}
      </span>
      <span className="text-[13px] font-black tracking-[0.6px] whitespace-nowrap uppercase">{title}</span>
      <span className="h-px min-w-4 flex-1 bg-border-subtle" />
    </div>
  );
}
