"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CHIP_COLORS } from "@/lib/chip-colors";

/**
 * The Grade Analysis / Verdict design system, ported from the CardTrace
 * Verdict reference.
 *
 * SQUARE CORNERS, ON PURPOSE. Nothing in these two screens has a border
 * radius. The rest of the product page is `rounded-lg`, so there is a visible
 * seam where this section begins — that is the reference's own call, kept
 * deliberately rather than softened, and the two screens read as one system
 * with each other even while they differ from their neighbours.
 *
 * THREE SHADOW STEPS AND NO MIXING, which is what keeps the hierarchy
 * readable without a single extra word: 6px for the one focal card on each
 * screen, 4px for chart cards, and flat — border only — for secondary stats.
 * A stat card that borrowed the chart's shadow would compete with the number
 * it is supposed to support.
 *
 * Colours and type live here as constants rather than as Tailwind tokens.
 * The site's own palette is close but not identical (its green is #21c45d
 * against this system's #0F9E57, its surfaces are warmer), and quietly
 * substituting near-matches would have produced a section that looked like a
 * bad copy of the reference rather than the reference. When these values are
 * adopted site-wide they move into globals.css; until then they are scoped
 * here so exactly one part of the site changes.
 */

export const DS = {
  ink: "#111111",
  ground: "#F1F1F0",
  surface: "#FFFFFF",
  lane: "#F4F4F1",
  yellow: "#FFD400",
  red: "#DE3122",
  green: "#0F9E57",
  greenDeep: "#0C8A4C",
  blue: "#3B5BA5",
  text2: "#4A4A45",
  meta: "#8B8B86",
  metaSoft: "#77776F",
  disabled: "#C0C0BB",
  kicker: "#6E6E68",
  rule: "#C9C9C4",
  hairline: "#E2E2DC",
  slabTop: "#E7E7E1",
  /** The hero rail's "after" column — the side worth money takes a warmer ground. */
  afterTint: "#FCFBF4",
  /**
   * The two hover grounds for the hero's raw / PSA 10 columns. Each is its own
   * resting ground stepped one notch, never a shared highlight: the columns
   * are a cool before and a warm after, and washing both to the same colour on
   * hover would undo the one cue that says which side is which.
   */
  beforeTintHover: "#F4F4F1",
  afterTintHover: "#F8F4E4",
  /** The well a listing photo sits in before it loads. */
  photoWell: "#EDEDE8",
} as const;

export const SHADOW = { focal: "6px 6px 0 #111", chart: "4px 4px 0 #111" } as const;

/** The two market marks, drawn in-system with the 2px stroke — never emoji, which render as letters on Windows. */
export function FlagMark({ market }: { market: "english" | "japanese" }) {
  if (market === "japanese") {
    return (
      <span
        aria-hidden
        className="relative flex h-3 w-[18px] flex-none items-center justify-center border-2"
        style={{ borderColor: DS.ink, background: DS.surface }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: DS.red }} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="relative h-3 w-[18px] flex-none border-2"
      style={{
        borderColor: DS.ink,
        background: `repeating-linear-gradient(180deg,${DS.red} 0 2px,#fff 2px 4px)`,
      }}
    >
      <span className="absolute top-0 left-0 h-[5px] w-2" style={{ background: DS.blue }} />
    </span>
  );
}

/** The numbered rail that opens each screen. */
export function ScreenHeader({
  step,
  title,
  tone,
  right,
}: {
  step: string;
  title: string;
  tone: "red" | "yellow";
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span
        className="grid h-[26px] w-[26px] flex-none place-items-center text-[13px] font-black"
        style={
          tone === "red"
            ? { background: DS.red, color: "#fff" }
            : { background: DS.yellow, color: DS.ink, border: `2px solid ${DS.ink}` }
        }
      >
        {step}
      </span>
      <span className="text-sm font-black tracking-[0.1em]">{title}</span>
      <span className="h-px min-w-5 flex-1" style={{ background: DS.rule }} />
      {right}
    </div>
  );
}

/**
 * The one card per screen that carries the focal number.
 *
 * The number is sized with `cqw` against a container query rather than `vw`:
 * this section renders inside the product page's right-hand column, not at
 * viewport width, so viewport units would size it against a width it never
 * has. The wrapper below establishes the container.
 */
export function FocalCard({ children }: { children: ReactNode }) {
  return (
    <div style={{ containerType: "inline-size" }}>
      <div className="border-2" style={{ borderColor: DS.ink, background: DS.surface, boxShadow: SHADOW.focal }}>
        <div className="h-[11px] border-b-2" style={{ background: DS.yellow, borderColor: DS.ink }} />
        <div className="p-6 sm:px-7 sm:pt-7 sm:pb-[26px]">{children}</div>
      </div>
    </div>
  );
}

/** Focal number + its two supporting lines, laid out the reference's way. */
export function FocalNumber({
  value,
  lead,
  arithmetic,
  max = "152px",
  min = "78px",
  cqw = "17cqw",
}: {
  /** ReactNode so the focal figure can be an AnimatedNumber rather than a fixed string. */
  value: ReactNode;
  lead: string;
  arithmetic: ReactNode;
  max?: string;
  min?: string;
  cqw?: string;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap items-end gap-6">
      <div
        className="font-black tabular-nums"
        style={{ fontSize: `clamp(${min}, ${cqw}, ${max})`, lineHeight: 0.82, letterSpacing: "-0.05em" }}
      >
        {value}
      </div>
      <div className="min-w-[220px] flex-1 pb-2.5">
        <div className="text-xl leading-[1.25] font-bold tracking-[-0.01em]">{lead}</div>
        <div className="mt-2 text-sm font-bold tabular-nums" style={{ color: DS.text2 }}>
          {arithmetic}
        </div>
      </div>
    </div>
  );
}

/** Flat, border-only. The step below the chart cards, and never given a shadow. */
/**
 * A corner tag: the grade a card is about, or that its figures are live.
 *
 * Same idiom as the eBay "Live" chip elsewhere on the page — a dot that
 * pulses, small black caps — but square and 2px-stroked like everything in
 * these two screens, rather than the pill shape the rest of the site uses.
 * The pulse rides the shared `.ct-pulse` class, which already stops under a
 * reduced-motion preference; an indefinite animation is exactly what that
 * preference is asking about.
 */
/**
 * The grade a card is about, worn as a chip.
 *
 * Deliberately the SAME shape as the Live/Preview badge the eBay listings
 * box carries (components/retro/market-data-badge.tsx) — pill, 10px black
 * caps, the same tracking — because these three cards sit a screen away from
 * that box and a second, differently-shaped status chip would read as a
 * second, different kind of thing.
 *
 * Amber comes from lib/chip-colors.ts rather than this section's own yellow.
 * That file exists precisely to stop each chip system inventing a competing
 * tint, and its amber is the tint in that palette closest to the yellow used
 * elsewhere here — matching the shape but then hand-picking a new colour for
 * it would have reintroduced the mismatch the shared palette prevents.
 */
export function CardTag({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex flex-none items-center rounded-full px-2 py-0.5 text-[10px] font-black tracking-[0.3px] uppercase"
      style={{ backgroundColor: CHIP_COLORS.amber.bg, color: CHIP_COLORS.amber.text }}
    >
      {children}
    </span>
  );
}

export function StatCard({
  label,
  sub,
  tag,
  children,
}: {
  /** The small caps kicker. Omit it when the title alone carries the card. */
  label?: string;
  /** The card's title — "Japanese vs English". Becomes the heading when there is no label. */
  sub?: string;
  /** Sits opposite the heading, on its bottom edge. */
  tag?: ReactNode;
  children: ReactNode;
}) {
  // Whichever line is the top one gets the tag beside it. The comparison
  // cards dropped their kicker (the title said the same thing twice, once in
  // caps), so there the title IS the top line; the verdict's cards still lead
  // with a kicker and have no title at all.
  const headingIsLabel = Boolean(label);

  return (
    // A LIGHTER TREATMENT THAN THE REST OF THE SECTION, on purpose. The focal
    // card, the chart cards and the assumptions panel keep the 2px stroke,
    // square corners and hard shadow; these three carry a hairline, a 14px
    // radius and a white surface against the page's warm ground instead. They
    // are the supporting tier, and reading as a quieter module is what lets
    // the focal number above them stay the loudest thing on screen.
    //
    // h-full because the grid stretches the entrance wrapper, not this card.
    <div
      className="flex h-full flex-col rounded-[14px] px-6 py-5"
      style={{ background: DS.surface, boxShadow: `inset 0 0 0 1px ${DS.hairline}` }}
    >
      {/* The tag sits ABOVE its heading, not opposite it. Beside the title it
          was competing for the same line as the thing it qualifies, and on a
          220px card that line had to hold both — which is what kept forcing
          the title to wrap. Stacked on top, it reads as the card's subject
          ("PSA 10 — Japanese vs English") and the title gets the full width. */}
      <div>
        {/* Full width, deliberately. Both CardTag and MarketDataBadge are
            `display:flex` — block-level — so in a plain block wrapper they
            span the card and read as a banner across the top of it rather
            than a chip in a corner. That is the intent here: the tag names
            what the whole card is about, so it gets the whole card's width. */}
        {tag && <div className="mb-2.5">{tag}</div>}
        {headingIsLabel ? (
          <div
            className="flex min-h-[2lh] items-end text-[9.5px] leading-none font-medium tracking-[0.12em] uppercase"
            style={{ color: DS.meta }}
          >
            {label}
          </div>
        ) : (
          // min-h of two lines: "Total listings by grade" wraps at widths
          // where "Japanese vs English" does not, and without the reservation
          // every row beneath it in that one card starts a line lower than in
          // the two beside it.
          <div
            className="flex min-h-[2lh] items-end text-[13px] leading-snug font-semibold"
            style={{ color: DS.ink }}
          >
            {sub}
          </div>
        )}
      </div>
      {headingIsLabel && sub && (
        <div className="mt-3 text-[13px] leading-snug font-semibold" style={{ color: DS.ink }}>
          {sub}
        </div>
      )}
      {children}
    </div>
  );
}

/** A card card — the 4px step, for anything holding a chart. */
export function ChartCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="border-2 p-5 sm:px-[22px] sm:pt-5 sm:pb-[18px]"
      style={{ borderColor: DS.ink, background: DS.surface, boxShadow: SHADOW.chart }}
    >
      {children}
    </div>
  );
}

/** The small steel-blue outlined tag that names where a number came from. */
export function SourceTag({ children }: { children: ReactNode }) {
  return (
    <span
      className="mt-2 inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[9px] font-black tracking-[0.08em]"
      style={{ color: DS.blue, borderColor: DS.blue }}
    >
      <span className="h-1.5 w-1.5" style={{ background: DS.blue }} />
      {children}
    </span>
  );
}

/**
 * A PSA slab as a chip — the grade ladder's axis label.
 *
 * Raw gets a DASHED sleeve rather than a solid one because it is the one
 * grade that is not in a slab; the border weight carries that without a word
 * of explanation.
 */
export function SlabChip({ grade }: { grade: string }) {
  const raw = /raw/i.test(grade);
  if (raw) {
    return (
      <div
        className="inline-flex h-[34px] min-w-[54px] items-center justify-center border-2 border-dashed px-2 text-[11px] font-black tracking-[0.1em]"
        style={{ borderColor: DS.ink, background: DS.surface }}
      >
        RAW
      </div>
    );
  }
  const number = grade.replace(/[^0-9]/g, "") || grade;
  return (
    <div
      className="inline-flex h-[34px] min-w-[54px] flex-col items-stretch overflow-hidden border-2 text-center"
      style={{ borderColor: DS.ink, background: DS.surface }}
    >
      <div
        className="border-b-2 text-[7.5px] font-black tracking-[0.16em]"
        style={{ background: DS.slabTop, borderColor: DS.ink, color: DS.text2, lineHeight: "11px" }}
      >
        PSA
      </div>
      <div className="flex flex-1 items-center justify-center px-2 text-sm font-black tracking-[-0.01em]">{number}</div>
    </div>
  );
}

/**
 * Caveats, collapsed behind a hairline-topped row.
 *
 * The methodology used to sit in a bordered sidebar carrying the same 2px
 * stroke as the headline statistics, which gave a disclaimer the same visual
 * rank as the answer. One quiet disclosure per screen states the count up
 * front — so nothing is hidden — and costs a click only to the reader who
 * wants it.
 */
export function CaveatDisclosure({
  title,
  aside,
  open,
  onToggle,
  children,
}: {
  title: string;
  aside: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 border-t border-dashed bg-transparent px-0.5 pt-[11px] text-left"
        onClick={onToggle}
        style={{ borderColor: DS.disabled, color: DS.kicker }}
        type="button"
      >
        <span className="w-[13px] text-[13px] leading-none font-black">{open ? "−" : "+"}</span>
        <span className="text-[10px] font-black tracking-[0.1em]">{title}</span>
        <span className="flex-1" />
        <span className="text-[10px] font-semibold tracking-[0.08em]">{aside}</span>
      </button>
      {open && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4 px-0.5 pt-3">{children}</div>
      )}
    </div>
  );
}

/** One caveat: a bolded claim, then the qualification. */
export function Caveat({ claim, children }: { claim: string; children: ReactNode }) {
  return (
    <p className="text-[11.5px] leading-[1.5] font-semibold" style={{ color: DS.metaSoft }}>
      <span className="font-black" style={{ color: DS.text2 }}>
        {claim}
      </span>{" "}
      {children}
    </p>
  );
}

/**
 * A number that counts to its new value instead of cutting to it.
 *
 * The point is not decoration — it is that these figures change while the
 * reader is looking at them. Typing a card cost rewrites the ROI, the net
 * profit, the break-even and four bars at once, and a hard cut gives no clue
 * which way anything moved. A short travel does, and it costs nothing to
 * read because the digits are tabular: the box cannot reflow mid-count, so
 * the number grows without the layout twitching.
 *
 * Mount is deliberately NOT animated. The first paint should be the answer,
 * not a slot machine; only subsequent changes travel.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  style,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = useReducedMotion();
  /**
   * `null` means "show the prop as given" — the resting state. Only a running
   * tween puts a number here, and only from its own callbacks: writing state
   * synchronously inside the effect body would cascade a second render on
   * every value change, which React rightly complains about and which this
   * component does not need.
   */
  const [tweened, setTweened] = useState<number | null>(null);
  const from = useRef(value);
  const mounted = useRef(false);

  useEffect(() => {
    // First paint should be the answer, not a count from zero.
    if (!mounted.current) {
      mounted.current = true;
      from.current = value;
      return;
    }
    if (reduced || !Number.isFinite(value)) {
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.5,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => setTweened(v),
      // Hand the exact prop value back at the end, so the resting figure is
      // never a rounding of the animation's last frame.
      onComplete: () => setTweened(null),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduced]);

  const shown = tweened ?? value;

  return (
    <span className={`tabular-nums ${className ?? ""}`} style={style}>
      {format(shown)}
    </span>
  );
}

/**
 * The system's tooltip: same 2px stroke, square corners and hard shadow as
 * everything else, shown on hover AND on focus.
 *
 * Focus parity is the part that matters. A chip that only reveals its
 * listing counts to a mouse hides them from anyone using a keyboard, so the
 * trigger is a real button and both events open the same panel.
 */
export function HoverTip({
  label,
  children,
  align = "left",
}: {
  /** What the tooltip says. */
  label: ReactNode;
  /** The trigger. */
  children: ReactNode;
  align?: "left" | "center";
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      {/* inline-flex, not the button default. A button lays its child out as
          an inline box, and an inline box whose `overflow` is not `visible`
          takes its baseline from its bottom edge — so the PSA slab chips
          (which clip their two rows) picked up a line-box descender beneath
          them and sat 8px lower than the RAW chip, which has no overflow and
          no such shift. As a flex container there is no baseline to
          synthesise and every trigger is exactly its child's height. */}
      <button
        className="ct-focus inline-flex cursor-help border-0 bg-transparent p-0 text-left"
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        type="button"
      >
        {children}
      </button>
      {open && (
        <span
          className={`absolute top-full z-30 mt-1.5 block w-max max-w-[230px] border-2 p-2 text-[10.5px] leading-[1.45] font-semibold ${
            align === "center" ? "left-1/2 -translate-x-1/2" : "left-0"
          }`}
          role="tooltip"
          style={{ borderColor: DS.ink, background: DS.surface, boxShadow: SHADOW.chart, color: DS.text2 }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/**
 * A real eBay listing's own photo, in a frame that looks the same whatever
 * eBay returns.
 *
 * Lifted out of market-panel-parts.tsx when the Grade Analysis pair needed
 * the same treatment. Two components framing listing photos by two copies of
 * the same rules is how the two drift, and these rules were expensive to
 * arrive at:
 *
 * THE PROBLEM IS NOT ASPECT RATIO, though that is the visible half. Measured
 * on two real listings for one card: the Japanese one is a clean 104x225
 * photograph of the slab; the English one is a 225x225 SELLER MARKETING
 * TEMPLATE — a collage with "PERFECT CONDITION" badges pasted around a card
 * render. Neither the shape nor the content can be relied on, so the frame
 * carries the polish and the image is allowed to be whatever it is.
 *
 * Hence CONTAIN, never cover. Cover fills the box perfectly and crops a tall
 * slab photo by ~38% of its height — taking the top and bottom of the slab,
 * which is exactly where PSA prints the grade. Cropping the evidence out of
 * the evidence.
 *
 * The dead space contain leaves is filled by the SAME IMAGE, blown up and
 * blurred behind it, so the frame is always full and always colour-matched
 * to its own photo rather than showing white letterboxing.
 *
 * `className` and `style` carry the size and shape, because the two callers
 * need different ones — a fixed 78px rounded chip beside the collector
 * insight, a responsive square inside the Grade Analysis pair — while
 * everything that makes the frame trustworthy stays here.
 */
export function ListingPhoto({
  imageUrl,
  alt,
  caption,
  className = "",
  style,
  fallback = null,
}: {
  imageUrl: string;
  alt: string;
  /** Small caps line across the foot of the frame, over a scrim. */
  caption?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Shown instead when the image fails — a seller can end a listing at any moment. */
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;

  return (
    <span className={`relative block overflow-hidden ${className}`} style={style}>
      <span
        aria-hidden
        className="absolute inset-0 scale-[1.35] bg-cover bg-center blur-[11px] brightness-90 saturate-[1.35]"
        style={{ backgroundImage: `url(${imageUrl})` }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- remote eBay CDN host, not allowlisted for next/image; see market-image.tsx */}
      <img
        alt={alt}
        className="relative h-full w-full object-contain drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)]"
        decoding="async"
        onError={() => setFailed(true)}
        src={imageUrl}
      />
      {caption && (
        <>
          {/* Scrim first, caption on top of it: the caption is white and the
              photo underneath could be any colour, so the gradient is what
              makes the word legible rather than luck. */}
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 py-0.5 text-center text-[8px] leading-none font-black tracking-[0.4px] text-white uppercase"
          >
            {caption}
          </span>
        </>
      )}
    </span>
  );
}
