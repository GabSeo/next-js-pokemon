import { GradingCenterTools } from "@/components/retro/grading-center-tools";
import type { GradedMarketData } from "@/lib/graded-market";

/** Ash's cap, self-hosted under /public — the section's mascot in the mockup. */
const CAP_SRC = "/pokemon-cap-grading-center.png";

/** The dashed rule either side of the section-break pill. */
const DASH_RULE = "bg-[repeating-linear-gradient(90deg,#0a0a0a_0_10px,transparent_10px_18px)]";

/** A dashed placeholder for something the mockup specifies but this build does not implement. */
function RoadmapChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-dashed border-[#9aa6bf] bg-white px-3 py-1.5 text-[10px] font-black tracking-[0.5px] text-muted-text">
      {children}
    </span>
  );
}

function FutureBadge({ tone }: { tone: "red" | "blue" }) {
  return (
    <span
      className={`rounded-[4px] px-2 py-1 text-[9px] font-black tracking-[0.8px] text-white uppercase ${
        tone === "red" ? "bg-pokemon-red" : "bg-pokemon-blue"
      }`}
    >
      Future feature
    </span>
  );
}

/**
 * The Grading Center, built to the "Grading Center v2" mockup: a section
 * break, a header card, then one panel that runs 01 Grade analysis -> 02 The
 * verdict, and closes on a roadmap block.
 *
 * The roadmap half is DESIGN ONLY and deliberately so. Scan &amp; estimate,
 * the recommendation engine and editable assumptions are drawn exactly as the
 * mockup draws them — dashed borders, "Future feature" badges, illustrative
 * copy — and none of them are wired to anything. That is the honest way to
 * show a plan: they look unmistakably unlike the working tools two blocks
 * above, so nobody mistakes a sketch for a feature. Each one names what it
 * would need before it could be built, which is also why they are not built:
 * a vision model, PSA population data, a rules layer, user cost inputs.
 * Nothing on this site has population data — see tcggo-integration-plan.md.
 */
export function GradingCenterSection({ data }: { data: GradedMarketData }) {
  return (
    <div className="flex flex-col gap-5">
      {/* Section break — the page changes subject here, from what the card is
          worth to whether grading it pays. */}
      <div className="flex items-center gap-3 pt-2">
        <span className={`h-1.5 flex-1 ${DASH_RULE}`} />
        <span className="inline-flex items-center gap-2 rounded-full border-2 border-black bg-foreground px-3.5 py-[7px] text-[11px] font-black tracking-[1px] whitespace-nowrap text-white uppercase">
          {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted under /public, not an optimizable remote domain */}
          <img alt="" className="w-6 saturate-[1.2]" src={CAP_SRC} />
          Grading intelligence
        </span>
        <span className={`h-1.5 flex-1 ${DASH_RULE}`} />
      </div>

      {/* Header card. The cap bleeds off the bottom-right corner rather than
          sitting inside a box — the one place on this page where an image is
          allowed to break the grid.

          The text column reserves the cap's width as padding rather than
          relying on a fixed max-width. The mockup's 640px column cleared a
          300px cap at 1080px wide; this section renders at ~716px inside the
          product page's right-hand column, where that same column ran the
          description straight under the brim and made the last line
          unreadable. Padding scales with the breakpoint, so the gap holds
          whatever width the section ends up at — and the cap is dropped
          entirely below `sm`, where reserving 200px would leave the
          paragraph too narrow to read. */}
      <header className="relative overflow-hidden rounded-lg border-2 border-black bg-card-surface p-8 shadow-hard-lg">
        {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted under /public, not an optimizable remote domain */}
        <img
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -right-[30px] -bottom-10 hidden w-[230px] saturate-110 sm:block lg:w-[300px]"
          src={CAP_SRC}
        />
        <div className="relative flex flex-col gap-3 sm:pr-[210px] lg:pr-[280px]">
          <span className="inline-flex items-center gap-2 text-[11px] font-black tracking-[1px] text-muted-text uppercase">
            <span className="h-2.5 w-2.5 border-2 border-black bg-pokemon-red" />
            MintDex Tools · Grading
          </span>
          {/* 48px is the mockup's size at full width; on a phone column that
              is two heavy lines, so it steps down rather than dominating. */}
          <h2 className="text-4xl font-black tracking-[-1.2px] sm:text-5xl">Grading Center</h2>
          <p className="max-w-[60ch] text-base leading-6 text-pretty text-muted-text">
            Decide whether paying to grade this card pays you back — what each grade is actually selling for, how English
            and Japanese markets differ, and what you keep after fees.
          </p>
        </div>
      </header>

      {/* No card around this. Every block inside it already has its own hard
          border and shadow — the Grading economics panel, the verdict, each
          roadmap sketch — so wrapping them in one more produced a frame around
          a set of frames, and cost 28px of padding on either side that the
          charts inside could have used. The heading, the rule and the toggle
          are enough to say where the section starts. */}
      <section className="flex flex-col gap-5">
        <GradingCenterTools conditions={data.conditions} roi={data.roi} />

        {/* ---- roadmap: drawn, not built ---- */}
        <div className="mt-1 flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-dashed border-pokemon-blue bg-white px-3 py-1.5 text-[10px] font-black tracking-[0.8px] whitespace-nowrap text-pokemon-blue uppercase">
            Roadmap · not in this build
          </span>
          <span className="h-px flex-1 bg-border-subtle" />
          <span className="text-[11px] font-bold text-muted-text">Concepts for a later release — copy below is illustrative</span>
        </div>

        <div className="relative flex flex-wrap items-center gap-5 overflow-hidden rounded-lg border-2 border-dashed border-[#9aa6bf] bg-[#fafafa] p-5">
          <div className="flex min-w-[280px] flex-[1_1_54%] flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <FutureBadge tone="red" />
              <span className="text-[10px] font-bold tracking-[1px] text-muted-text uppercase">Scan &amp; estimate</span>
            </div>
            <h3 className="max-w-[22ch] text-[26px] leading-[30px] font-black tracking-[-0.7px]">
              What grade could your card get?
            </h3>
            <p className="text-[13px] leading-5 text-pretty text-muted-text">
              Photograph the card front and back, and MintDex estimates the grade band before you pay a submission fee —
              then feeds that band straight into the ROI banner above so the return you see is the one you would actually
              get.
            </p>
            <div className="mt-0.5 flex flex-wrap gap-2">
              <RoadmapChip>
                <span className="text-pokemon-red">01</span> UPLOAD FRONT &amp; BACK
              </RoadmapChip>
              <RoadmapChip>
                <span className="text-pokemon-red">02</span> CENTERING &amp; EDGE READ
              </RoadmapChip>
              <RoadmapChip>
                <span className="text-pokemon-red">03</span> GRADE BAND + ODDS
              </RoadmapChip>
            </div>
          </div>

          <div className="flex min-w-[260px] flex-[1_1_34%] flex-col gap-2.5">
            <div className="flex gap-2.5">
              <div className="flex aspect-[5/7] flex-1 flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-[#9aa6bf] bg-white p-2 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted under /public, not an optimizable remote domain */}
                <img alt="" className="w-11 opacity-50" src={CAP_SRC} />
                <span className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">Drop front</span>
              </div>
              <div className="flex aspect-[5/7] flex-1 flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-[#9aa6bf] bg-white p-2 text-center">
                <span className="text-[22px] font-black text-[#c3cbdb]">+</span>
                <span className="text-[10px] font-black tracking-[0.6px] text-muted-text uppercase">Drop back</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border-2 border-dashed border-[#9aa6bf] bg-white px-3 py-2.5">
              <span className="text-[10px] font-black tracking-[0.8px] text-muted-text uppercase">Predicted band</span>
              <span className="flex gap-1.5">
                {["PSA 8", "9", "10"].map((g) => (
                  <span
                    key={g}
                    className="rounded-[4px] border-2 border-dashed border-[#9aa6bf] px-1.5 py-0.5 text-[10px] font-black text-[#9a9a9a]"
                  >
                    {g}
                  </span>
                ))}
              </span>
            </div>
            <span className="text-center text-[10px] font-bold text-[#9a9a9a]">Needs vision model + PSA population data</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="relative flex min-w-[280px] flex-[1_1_56%] flex-col gap-2 overflow-hidden rounded-lg border-2 border-dashed border-[#9aa6bf] bg-[#fafafa] px-5 py-[18px]">
            {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted under /public, not an optimizable remote domain */}
            <img alt="" aria-hidden="true" className="pointer-events-none absolute -top-2.5 -right-2.5 w-28 rotate-6 opacity-35" src={CAP_SRC} />
            <div className="flex flex-wrap items-center gap-2">
              <FutureBadge tone="blue" />
              <span className="text-[10px] font-bold tracking-[1px] text-muted-text uppercase">
                Why grade this card — recommendation engine
              </span>
            </div>
            <h3 className="max-w-[30ch] text-lg leading-6 font-black tracking-[-0.45px]">
              A written call on whether this card is worth grading.
            </h3>
            <p className="text-xs leading-[19px] text-pretty text-muted-text">
              Would read the grade spread and population data and say it in one sentence — e.g. &ldquo;a PSA 10 asks 2.5×
              raw while a 9 barely clears the fee, so grade only if centering is clean.&rdquo; Needs a rules layer plus
              condition input from the user; nothing to wire up yet.
            </p>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              {["Centering input", "Pop report", "Conviction score"].map((t) => (
                <span
                  key={t}
                  className="rounded-full border-2 border-dashed border-[#9aa6bf] px-2.5 py-1 text-[10px] font-black tracking-[0.5px] text-muted-text uppercase"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="flex min-w-[260px] flex-[1_1_36%] flex-col gap-2 rounded-lg border-2 border-dashed border-[#9aa6bf] bg-[#fafafa] px-5 py-[18px]">
            <div className="flex flex-wrap items-center gap-2">
              <FutureBadge tone="blue" />
              <span className="text-[10px] font-bold tracking-[1px] text-muted-text uppercase">Editable assumptions</span>
            </div>
            <p className="text-xs leading-[19px] text-pretty text-muted-text">
              Lets the user override what the ROI maths assumes, so the verdict recomputes against their own costs.
            </p>
            {[
              ["Grading fee", `${data.roi.currency} ${data.roi.gradingCostUsd} · PSA Value`],
              ["Shipping + insurance", "user input"],
              ["Sale fees", "user input"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-3 border-b border-dashed border-[#d8d8d8] pb-[7px] text-xs font-bold"
              >
                <span className="text-muted-text">{label}</span>
                <span className="text-[#9a9a9a]">{value}</span>
              </div>
            ))}
            <p className="text-[11px] leading-[17px] text-pretty text-muted-text">
              Today the ROI banner ships with fixed estimates — eBay asks, not completed sales.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 text-[11px] font-black tracking-[0.6px] text-muted-text uppercase">
          Powered by eBay
        </div>
      </section>
    </div>
  );
}
