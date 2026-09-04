"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
export function StatCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="border-2 p-4" style={{ borderColor: DS.ink }}>
      <div className="text-[10px] font-black tracking-[0.1em]" style={{ color: DS.kicker }}>
        {label}
      </div>
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
      <button
        className="ct-focus cursor-help border-0 bg-transparent p-0 text-left"
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
