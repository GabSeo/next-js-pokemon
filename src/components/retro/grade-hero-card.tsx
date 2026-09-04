"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";

import { DS, FlagMark, ListingPhoto, SHADOW } from "@/components/retro/grading-ds";
import { GridMascot } from "@/components/retro/grid-mascot";
import { MASCOT_SPRITE_URL } from "@/lib/pokemon-sprite";

/**
 * The hero card that opens Grade Analysis — "1a" from the hero-options
 * reference, ported exactly.
 *
 * WHAT THE LAYOUT IS DOING. The card reads top to bottom as one argument: the
 * multiple, then the two things it compares, then the way out. The middle
 * column is the join — a vertical GRADE IT rail with the cash gap in a yellow
 * box and an arrow — so the two photo columns are not merely side by side but
 * visibly a before and an after.
 *
 * The photo columns are deliberately asymmetric in alignment, not by
 * accident: raw is flush RIGHT against the rail and PSA 10 flush LEFT, so
 * both press toward the transformation between them. The PSA side also takes
 * a warmer ground (#FCFBF4) — the after is the side worth money.
 *
 * `container-type: inline-size` on the wrapper is what makes the two `cqw`
 * clamps below size against THIS CARD rather than the viewport. The card sits
 * in the product page's right-hand column, so viewport units would size the
 * figure against a width it never has.
 */

export type HeroSide = {
  price: string;
  listings: string;
  imageUrl?: string;
  href?: string;
};

export function GradeHeroCard({
  market,
  multiple,
  lead,
  caption,
  raw,
  psa10,
  gap,
  expanded,
  onToggle,
  distributionId,
  footnote,
  children,
}: {
  market: string;
  /** The focal figure, already formatted — "18×". */
  multiple: string;
  lead: string;
  caption: string;
  raw: HeroSide;
  psa10: HeroSide;
  /** The cash difference, formatted with its sign — "+319". */
  gap: string | null;
  expanded: boolean;
  onToggle: () => void;
  distributionId: string;
  footnote: string;
  /** The market-distribution region, revealed by the footer's control. */
  children?: ReactNode;
}) {
  /**
   * The mascot's pen. It is measured from this element's own box every tick,
   * so the comparison grid — and nothing else on the card — is where it can
   * go.
   */
  const gridRef = useRef<HTMLDivElement | null>(null);

  return (
    <div style={{ containerType: "inline-size" }}>
      <div className="border-2" style={{ borderColor: DS.ink, background: DS.surface, boxShadow: SHADOW.focal }}>
        <div className="h-[11px] border-b-2" style={{ background: DS.yellow, borderColor: DS.ink }} />

        {/* Header rail. The 34px sprite slot the reference carried here is
            gone: the mascot that replaced it belongs to the comparison grid
            below, where it has somewhere to walk. */}
        <div className="flex flex-wrap items-center gap-2.5 px-6 pt-[22px]">
          <FlagMark market={market.toLowerCase() === "japanese" ? "japanese" : "english"} />
          <span className="text-[11px] font-black tracking-[0.12em]">
            PSA 10 (GRADED) VS RAW · {market.toUpperCase()} PRINT
          </span>
          <span className="min-w-2 flex-1" />
          <span
            className="inline-flex items-center gap-1.5 text-[9.5px] font-bold tracking-[0.1em]"
            style={{ color: DS.kicker }}
          >
            <span className="ct-pulse h-[7px] w-[7px] rounded-full" style={{ background: DS.green }} />
            LIVE
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-5 px-6 pt-1.5 pb-5">
          <div
            className="font-black tabular-nums"
            style={{ fontSize: "clamp(74px, 15cqw, 124px)", lineHeight: 0.8, letterSpacing: "-0.05em" }}
          >
            {multiple}
          </div>
          <div className="min-w-[200px] flex-1 pb-2">
            <div className="text-[19px] leading-[1.25] font-bold tracking-[-0.01em]">{lead}</div>
            <div className="mt-[5px] text-[12.5px] font-semibold" style={{ color: DS.meta }}>
              {caption}
            </div>
          </div>
        </div>

        {/* ---- the before → after rail ---- */}
        <div
          className="relative grid items-stretch border-t-2"
          ref={gridRef}
          style={{ borderColor: DS.ink, gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)" }}
        >
          <SideColumn align="end" hoverTint={DS.beforeTintHover} side={raw}>
            <span
              className="inline-flex h-7 items-center justify-center border-2 border-dashed px-[11px] text-[10px] font-black tracking-[0.1em]"
              style={{ borderColor: DS.ink }}
            >
              RAW
            </span>
          </SideColumn>

          {/* The join. Vertical type, the gap in cash, and an arrow that says
              which way the transformation runs. */}
          <div
            className="flex min-w-[64px] flex-col items-center justify-center gap-2 border-r-2 border-l-2 px-2 py-3.5"
            style={{ borderColor: DS.ink, background: DS.lane }}
          >
            <div
              className="text-[10px] font-black tracking-[0.1em]"
              style={{ color: DS.kicker, writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              GRADE IT
            </div>
            <div className="w-0.5 min-h-4 flex-1" style={{ background: DS.disabled }} />
            {gap && (
              <div className="border-2 px-1.5 py-1 text-center" style={{ borderColor: DS.ink, background: DS.yellow }}>
                <div className="text-[8px] font-black tracking-[0.1em]">GAP</div>
                <div className="text-[13px] leading-[1.1] font-black tracking-[-0.02em] tabular-nums">{gap}</div>
              </div>
            )}
            <div className="w-0.5 min-h-4 flex-1" style={{ background: DS.disabled }} />
            <div className="text-[17px] leading-none font-black">↓</div>
          </div>

          <SideColumn align="start" hoverTint={DS.afterTintHover} side={psa10} tint={DS.afterTint}>
            <span
              className="inline-flex min-w-[52px] flex-col items-stretch border-2 text-center"
              style={{ borderColor: DS.ink, background: DS.surface }}
            >
              <span
                className="border-b-2 text-[6.5px] font-black tracking-[0.16em]"
                style={{ background: DS.slabTop, borderColor: DS.ink, color: DS.text2, lineHeight: "10px" }}
              >
                PSA
              </span>
              <span className="px-1.5 pt-[3px] pb-1 text-[12px] leading-none font-black">10</span>
            </span>
          </SideColumn>

          <GridMascot boundsRef={gridRef} src={MASCOT_SPRITE_URL} />
        </div>

        <div className="flex flex-wrap items-center gap-3.5 border-t-2 px-[18px] py-3" style={{ borderColor: DS.ink }}>
          <button
            aria-controls={distributionId}
            aria-expanded={expanded}
            className="ct-focus ct-hero-btn inline-flex cursor-pointer items-center gap-[9px] border-2 px-3.5 py-[9px] text-[11px] font-black tracking-[0.1em]"
            onClick={onToggle}
            style={{ borderColor: DS.ink, background: DS.surface, boxShadow: "3px 3px 0 #111" }}
            type="button"
          >
            <span className="text-sm leading-none">{expanded ? "−" : "+"}</span>
            {expanded ? "HIDE MARKET DISTRIBUTION" : "SEE MARKET DISTRIBUTION"}
          </button>
          <span className="min-w-2 flex-1" />
          <span className="text-[10.5px] font-semibold" style={{ color: DS.meta }}>
            {footnote}
          </span>
        </div>

        {children}
      </div>
    </div>
  );
}

/**
 * One photo column: chip, 5:7 photo, then the price and its depth.
 *
 * The whole column is the link when a listing backs it, not just the photo.
 * The chip says WHICH condition, the photo shows WHOSE copy and the price says
 * WHAT IT COSTS — three parts of a single claim, and the listing they all come
 * from is the same one. Making only the middle part clickable left the two
 * cheapest facts on the card inert next to a picture that was not.
 */
function SideColumn({
  side,
  align,
  tint,
  hoverTint,
  children,
}: {
  side: HeroSide;
  align: "start" | "end";
  tint?: string;
  /** The column's ground while hovered or focused — see .ct-side in globals.css. */
  hoverTint: string;
  children: ReactNode;
}) {
  const inner = (
    <>
      <div className="flex h-8 w-full max-w-[150px] items-center">{children}</div>

      <div className="mt-2.5 w-full max-w-[150px]">
        <ListingPhoto
          alt="Cheapest live listing"
          // Same caption the collector insight's frame carries, for the same
          // reason: these are photographs of a real seller's copy, and a
          // photograph reads as evidence unless it says what it is. "Live ask"
          // names it as the cheapest ask on the market right now rather than
          // stock art of the card.
          caption="Live ask"
          className="ct-side-photo w-full max-w-[150px] border-2"
          fallback={
            <span
              className="flex aspect-[5/7] w-full max-w-[150px] items-center justify-center border-2 text-[10px] font-semibold"
              style={{ borderColor: DS.ink, background: DS.photoWell, color: DS.disabled }}
            >
              no photo
            </span>
          }
          imageUrl={side.imageUrl ?? ""}
          style={{ borderColor: DS.ink, background: DS.photoWell, aspectRatio: "5 / 7" }}
        />
      </div>

      <div className="mt-2.5 flex w-full max-w-[150px] flex-wrap items-baseline gap-2">
        <span className="font-black tabular-nums" style={{ fontSize: "clamp(26px, 5.4cqw, 32px)", letterSpacing: "-0.03em" }}>
          {side.price}
        </span>
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: DS.meta }}>
          {side.listings}
        </span>
      </div>
    </>
  );

  const className = `ct-side flex min-w-0 flex-col px-4 pt-3.5 pb-4 ${align === "end" ? "items-end" : "items-start"}`;
  // Custom properties rather than a background in `style`: an inline
  // background would outrank the :hover rule and the column would never
  // change ground.
  const ground = {
    "--ct-side-bg": tint ?? "transparent",
    "--ct-side-bg-hover": hoverTint,
  } as CSSProperties;

  if (side.imageUrl && side.href) {
    return (
      <a
        className={`ct-focus ${className}`}
        href={side.href}
        rel="noopener noreferrer"
        style={ground}
        target="_blank"
        title="Open this listing on eBay"
      >
        {inner}
      </a>
    );
  }

  return (
    <div className={className} style={ground}>
      {inner}
    </div>
  );
}
