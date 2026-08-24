"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { MasterballIcon } from "@/components/retro/masterball-icon";
import type { VintedFeedRowSummary, VintedSummary } from "@/components/retro/graded-market-tabs";
import { VINTED_LOGO_URL } from "@/lib/marketplace-logos";

/**
 * The France/Vinted content of the Market Overview panel — rendered by
 * graded-market-tabs.tsx inside its own `hidden={market !== "France"}`
 * branch, so it inherits that branch's border/shadow-free nesting inside
 * GradedMarketPanel's single shared card rather than getting a second outer
 * border of its own. English/Japanese eBay data lives entirely in the
 * sibling branch and never touches this file.
 *
 * The one filter that matters (see graded-market-tabs.tsx's own header
 * comment) still applies unchanged: only "Très bon état" listings ever
 * reach `vinted.rows`. What's new here is presentation only — how the real
 * rows past a free cap get revealed — not what counts as a real row.
 */

// One small, deliberately restrained color language, reused for both chip
// systems in this feed (deal quality and condition) rather than inventing a
// second competing palette — good/Très bon état share the green read, high/
// Satisfaisant share the amber "pay attention" read. Kept as resolved hex
// rather than theme utility classes because these are chip *tints*, one
// step lighter than any --color-* token in the theme, and the paired text
// shade is chosen for contrast at 10-11px, not just borrowed from the
// nearest brand color.
const CHIP_COLORS = {
  green: { bg: "#e9f8ee", text: "#1f9d55" },
  amber: { bg: "#fbf1e3", text: "#a15c0c" },
  grey: { bg: "#f4f5f8", text: "#6b7280" },
} as const;

const DEAL_TIER_COLORS: Record<VintedFeedRowSummary["dealTier"], (typeof CHIP_COLORS)[keyof typeof CHIP_COLORS]> = {
  good: CHIP_COLORS.green,
  fair: CHIP_COLORS.grey,
  high: CHIP_COLORS.amber,
};

// One tier only. Vinted has three (Très bon état / Bon état / Satisfaisant)
// and this feed shows exclusively the first — see lib/vinted-listings.ts.
// The map is kept rather than inlined so an unexpected condition string
// still renders in neutral grey via the CHIP_COLORS.grey fallback below
// instead of crashing on a missing key.
const CONDITION_COLORS: Record<string, (typeof CHIP_COLORS)[keyof typeof CHIP_COLORS]> = {
  "Très bon état": CHIP_COLORS.green,
};

function dealPctLabel(pct: number): string {
  if (pct === 0) return "±0%";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/**
 * The single most-discounted "good"-tier row, not just the first one found
 * in display order (rows are sorted newest-first, not by deal quality — an
 * earlier version used `.find()`, which surfaced a -9% row ahead of a -11%
 * row sitting later in the list purely because it was scraped/listed more
 * recently, not because it was the better deal). Ties broken by lower price.
 */
function strongestGoodDeal(rows: VintedFeedRowSummary[]): VintedFeedRowSummary | undefined {
  return rows
    .filter((r) => r.dealTier === "good")
    .sort((a, b) => a.dealPct - b.dealPct || a.price - b.price)[0];
}

/**
 * Rows kept free before the catch-'em-all reveal. Only real, scraped rows
 * are ever capped (see the `vinted.isReal` gate in the main component) — the
 * illustrative preview is already a small fake set, and teasing an unlock
 * over invented data would be a real dishonesty stacked on a fake one. `2`
 * is a starting point, not a measured number — revisit once actual
 * conversion data exists to look at.
 */
const FREE_VINTED_ROWS = 2;

/* ------------------------------------------------------------------ rows */

function Thumbnail({ src }: { src?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- TCGdex/apitcg or Vinted CDN image, domain not allowlisted for next/image (same as CardImage)
    return <img src={src} alt="" className="h-[60px] w-11 flex-none rounded-sm border-2 border-black object-cover shadow-hard-sm" />;
  }
  return <div className="h-[60px] w-11 flex-none rounded-sm border-2 border-black bg-white shadow-hard-sm" />;
}

function Row({ row, cardImageUrl }: { row: VintedFeedRowSummary; cardImageUrl?: string }) {
  const dealColors = DEAL_TIER_COLORS[row.dealTier];
  const conditionColors = CONDITION_COLORS[row.condition] ?? CHIP_COLORS.grey;
  // A real row shows its own scraped photo; a preview row falls back to the
  // card's own image — same physical card, different sellers, never a
  // fabricated per-listing photo.
  const thumbnail = row.imageUrl ?? cardImageUrl;

  return (
    <div className="flex items-center gap-3.5 border-t border-dashed border-border-subtle py-2.5 first:border-t-0">
      <Thumbnail src={thumbnail} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-black tracking-[0.3px] uppercase"
            style={{ backgroundColor: conditionColors.bg, color: conditionColors.text }}
          >
            {row.condition}
          </span>
          {row.timeAgo && <span className="text-[10px] font-bold text-muted-text">{row.timeAgo}</span>}
        </div>
        {/* Only real rows carry a title and a link. A preview row gets
            neither — a fabricated seller title or a dead item link is a
            worse kind of placeholder than an invented number, since it
            looks clickable. */}
        {row.title &&
          (row.url ? (
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block truncate text-[13px] font-bold hover:text-pokemon-blue hover:underline"
            >
              {row.title} ↗
            </a>
          ) : (
            <span className="mt-1 block truncate text-[13px] font-bold">{row.title}</span>
          ))}
      </div>
      <div className="flex flex-none flex-col items-end gap-1">
        <span className="text-[15px] font-black tabular-nums">{row.priceLabel}</span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums"
          style={{ backgroundColor: dealColors.bg, color: dealColors.text }}
        >
          {dealPctLabel(row.dealPct)}
        </span>
      </div>
    </div>
  );
}

/** Skeleton stand-in for a held row — pure decoration, never real data. Widths vary so three in a row don't read as a repeated tile. */
function GhostRow({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-3.5 border-t border-dashed border-border-subtle py-2.5 first:border-t-0">
      <div className="h-[60px] w-11 flex-none rounded-sm bg-border-subtle" />
      <div className="flex-1">
        <div className="h-3 w-24 rounded-full" style={{ backgroundColor: CHIP_COLORS.green.bg }} />
        <div className="mt-1.5 h-[13px] rounded-full bg-border-subtle" style={{ width }} />
      </div>
      <div className="h-4 w-[58px] flex-none rounded-full bg-border-subtle" />
    </div>
  );
}

const revealChild = (reduce: boolean | null, delay = 0) => ({
  hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 7, filter: "blur(5px)" },
  shown: reduce
    ? { opacity: 1, transition: { duration: 0.15 } }
    : { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.34, ease: "easeOut" as const, delay } },
});

/* -------------------------------------------------- catch-'em-all reveal */

/**
 * The free hook: `held` listings stay blurred behind ghost rows, with the
 * Master Ball centered on top of the thing it unlocks. Press it (click,
 * Enter, Space) and it shakes 3x over ~1.15s, the blur clears, the held rows
 * stagger in, and a yellow confirmation strip lands. This step is entirely
 * free — see ModelSignalPanel below for the actual premium CTA, which only
 * appears after this reveal, deliberately as an afterthought rather than the
 * point.
 *
 * `held` is prop-drilled from the server-rendered `vinted` summary just like
 * `visible` — nothing is fetched on click. The interaction is a pure
 * visibility/animation state change over data already present in the
 * initial HTML, so an AI crawler reading raw HTML (or a human with
 * reduced-motion/no-JS) still has the full real feed, just not laid out the
 * way a sighted, animated visit sees it.
 *
 * `visible` is also passed in, purely so the post-reveal "Caught all N"
 * strip can compute the true cheapest ask across every row now on screen —
 * an earlier version computed it from `held` alone and silently missed a
 * cheaper row that happened to sit in the always-visible set.
 */
function CatchEmAllReveal({
  visible,
  held,
  cardImageUrl,
  nameFull,
  totalCount,
}: {
  visible: VintedFeedRowSummary[];
  held: VintedFeedRowSummary[];
  cardImageUrl?: string;
  nameFull: string;
  totalCount: number;
}) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<"locked" | "catching" | "open">("locked");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Teaser (pre-reveal): cheapest among the HELD rows specifically — "here's
  // what's hidden, starting from X" is the whole point of the tease.
  const heldCheapest = held.length ? Math.min(...held.map((l) => l.price)) : undefined;
  // Confirmation (post-reveal): "Caught all N" claims to summarize every row
  // now on screen, so its cheapest must be the true minimum across visible
  // + held together — held alone silently missed a cheaper row sitting in
  // the always-visible set (confirmed live: 4 rows at 600/875/780/780, the
  // strip claimed 780 because held was only the last two).
  const allRows = visible.concat(held);
  const overallCheapest = allRows.length ? Math.min(...allRows.map((l) => l.price)) : undefined;
  const currency = held[0]?.priceLabel.split(" ")[0];

  const start = useCallback(() => {
    if (phase !== "locked") return;
    if (reduce) {
      setPhase("open");
      return;
    }
    setPhase("catching");
    timer.current = setTimeout(() => setPhase("open"), 1150);
  }, [phase, reduce]);

  return (
    <>
      <AnimatePresence initial={false}>
        {phase !== "open" && (
          <motion.div key="locked" className="relative pt-0.5" exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <div aria-hidden="true" className="pointer-events-none opacity-90 blur-[4px]">
              {["76%", "62%", "70%"].slice(0, Math.min(held.length, 3)).map((w) => (
                <GhostRow key={w} width={w} />
              ))}
            </div>

            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-gradient-to-b from-white/55 via-white/80 to-white/90">
              <motion.button
                type="button"
                onClick={start}
                aria-label={`Unlock the ${held.length} held ${nameFull} asks`}
                className="relative flex h-[62px] w-[62px] items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pokemon-blue"
                whileHover={reduce ? undefined : { y: -2 }}
                whileTap={reduce ? undefined : { scale: 0.94 }}
              >
                {!reduce && (
                  <motion.span
                    className="absolute inset-0 rounded-full bg-pokemon-yellow"
                    animate={{ scale: [1, 1.12, 1], opacity: [0.35, 0.7, 0.35] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
                <motion.span
                  className="relative"
                  style={{ filter: "drop-shadow(3px 3px 0 #0a0a0a)" }}
                  animate={
                    reduce
                      ? undefined
                      : phase === "catching"
                        ? { rotate: [0, -17, 0, 15, 0], scale: 1.06 }
                        : { rotate: [0, -12, 10, -7, 5, 0] }
                  }
                  transition={
                    phase === "catching"
                      ? { duration: 0.34, repeat: 2, ease: "easeInOut" }
                      : { duration: 0.6, repeat: Infinity, repeatDelay: 3.4, ease: "easeInOut" }
                  }
                >
                  <MasterballIcon size={56} />
                </motion.span>
              </motion.button>

              <div className="text-center">
                <div className="text-[15px] font-black leading-5 text-foreground">
                  {phase === "catching" ? "Catching…" : `Catch all ${totalCount} ${nameFull} asks`}
                </div>
                <div className="mt-0.5 text-[11px] font-bold leading-4 text-muted-text">
                  Press the ball — {held.length} held{heldCheapest !== undefined ? `, from ${currency} ${heldCheapest}` : ""}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase === "open" && (
          <motion.div initial="hidden" animate="shown" variants={{ shown: { transition: { staggerChildren: reduce ? 0 : 0.07 } } }}>
            {held.map((row, i) => (
              <motion.div key={row.url ?? i} variants={revealChild(reduce)}>
                <Row row={row} cardImageUrl={cardImageUrl} />
              </motion.div>
            ))}

            <motion.div
              variants={revealChild(reduce)}
              className="mt-3 flex items-center justify-between gap-3 rounded-md border-2 border-black bg-pokemon-yellow px-3.5 py-2.5 shadow-hard-sm"
            >
              <span className="text-xs font-black tracking-[0.4px] text-foreground">
                Caught all {totalCount}
                {overallCheapest !== undefined ? ` — cheapest ask is ${currency} ${overallCheapest}` : ""}
              </span>
            </motion.div>

            <motion.div variants={revealChild(reduce, 0.28)}>
              <ModelSignalPanel nameFull={nameFull} bestDeal={strongestGoodDeal(allRows)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* --------------------------------------------------- premium teaser panel */

/**
 * The actual premium CTA — appears only once CatchEmAllReveal has opened,
 * on purpose (see motion-notes.md: "the pause is what makes the paywall
 * feel like a second thought rather than the point").
 *
 * Nothing behind this button exists yet: no conviction-scoring model, no
 * buy/sell signal engine, no premium tier to unlock into. Built as a
 * preview of a planned feature, same as any locked-feature teaser — but
 * unlike a normal isReal:false fallback (a real metric estimated because a
 * live source isn't connected yet), there's no real metric behind these
 * numbers at all, so `PREMIUM_TEASER_NOTICE` below is machine-readable
 * plain text next to them, matching IllustrativeTag's own "as visible to a
 * crawler as to a human" rule — an agent reading raw HTML should no more
 * mistake "84/100" for a real fact about this card than a human should.
 *
 * `bestDeal` is the one exception: when a genuinely good-tier row exists
 * anywhere in the feed now on screen (visible + held together, not held
 * alone — a good deal sitting in the always-visible rows still counts),
 * its real price backs the one legible "signal" line instead of inventing
 * one — the two blurred rows below it are the only fully-fabricated part
 * of this panel.
 */
const PREMIUM_TEASER_NOTICE = "Preview of a planned feature — no live signal model behind these numbers yet.";

function ModelSignalPanel({ nameFull, bestDeal }: { nameFull: string; bestDeal?: VintedFeedRowSummary }) {
  const firstSignal = bestDeal ? `${bestDeal.priceLabel} ask entered under fair value` : "New ask entered under fair value";

  return (
    <div className="mt-3.5 rounded-md border-2 border-black bg-foreground p-5" style={{ boxShadow: "6px 6px 0 0 rgba(10,10,10,.3)" }}>
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Name alone here — "Premium" said once, by the pill, not twice. */}
        <span className="text-[10px] font-black tracking-[1.1px] text-pokemon-yellow uppercase">{nameFull}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-pokemon-yellow bg-pokemon-yellow/15 px-2 py-px">
          <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-pokemon-yellow" />
          <span className="text-[9px] font-black tracking-[0.7px] text-pokemon-yellow uppercase">Premium</span>
        </span>
      </div>

      <div className="mt-1.5 text-[22px] font-black tracking-[-0.6px] text-pretty">
        <span className="text-white">Something&rsquo;s up with {nameFull}.</span>
        <br />
        <span className="text-pokemon-yellow">Premium tells you what.</span>
      </div>
      <p className="mt-1.5 max-w-[460px] text-xs leading-[18px] text-[#b9b9b9] text-pretty">
        Every time a new listing lands, we check if it&rsquo;s worth acting on — and Premium members see the call, plus the reasoning, right when it happens.
      </p>

      <div className="mt-4 flex items-stretch gap-3">
        {/* conviction score — no real model behind it, see PREMIUM_TEASER_NOTICE */}
        <div className="w-[120px] flex-none rounded-[5px] border-2 border-[#2a2a2a] bg-[#161616] px-3 py-2.5">
          <div className="text-[9px] font-bold tracking-[0.8px] text-[#8b8b8b] uppercase">Conviction</div>
          <div aria-hidden="true" className="mt-px flex items-baseline gap-0.5 blur-[5px] select-none">
            <span className="text-[32px] font-black tracking-[-1.4px] text-pokemon-yellow">84</span>
            <span className="text-xs font-black text-[#8b8b8b]">/100</span>
          </div>
          <div className="mt-1.5 flex gap-[3px]">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-sm ${i < 3 ? "bg-pokemon-yellow" : "bg-[#2a2a2a]"}`} />
            ))}
          </div>
        </div>

        {/* signal log — one real (the best held deal, if any), two illustrative */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2.5 rounded-[5px] border-2 border-[#2a2a2a] bg-[#161616] px-2.5 py-[7px]">
            <span className="flex-none rounded-sm border-[1.5px] border-black bg-success-green px-1.5 text-[9px] font-black tracking-[0.6px] text-black uppercase">
              Buy
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[#e4e4e4]">{firstSignal}</span>
          </div>
          <div aria-hidden="true" className="flex flex-col gap-1.5 blur-[4px]">
            {(["Buy", "Sell"] as const).map((k) => (
              <div key={k} className="flex items-center gap-2.5 rounded-[5px] border-2 border-[#2a2a2a] bg-[#161616] px-2.5 py-[7px]">
                <span className={`flex-none rounded-sm px-1.5 text-[9px] font-black uppercase ${k === "Buy" ? "bg-success-green text-black" : "bg-pokemon-red text-white"}`}>
                  {k}
                </span>
                <span className="h-[11px] flex-1 rounded-[3px] bg-[#2f2f2f]" />
                <span className="h-2.5 w-10 flex-none rounded-[3px] bg-[#262626]" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scoped to just this block (button + fine print + footnote), not
          the whole panel — Gengar's row is this grid's row, so items-center
          aligns him with this block specifically, not the panel's full
          height the way a panel-wide grid would. Single column below `sm`:
          Gengar drops under the CTA instead of squeezing into a fixed
          auto-width column beside it on a narrow card. */}
      <div className="mt-6 grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col items-start gap-2">
          {/* Compact single-line CTA — lead + separator + value + arrow, no
              leading icon (Gengar is this panel's one mascot now, not a
              second ball here too). flex-wrap so it folds onto two lines on
              a narrow card instead of overflowing the panel. */}
          <button
            type="button"
            className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border-2 border-pokemon-yellow bg-pokemon-yellow py-2.5 pr-4 pl-4 text-foreground transition-all duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pokemon-yellow"
            style={{ boxShadow: "0 0 0 0 rgba(255,205,5,.3)" }}
          >
            <span className="text-[14px] font-black tracking-[-0.1px]">Create your account</span>
            <span className="hidden h-4 w-px flex-none bg-black/28 sm:block" />
            {/* Muted brown, not black — same secondary-text-on-yellow convention as the Grading ROI callout box, so this reads as the supporting value, not a second equally-loud claim. */}
            <span className="text-xs font-bold" style={{ color: "rgba(10,10,10,.72)" }}>
              Track 5 cards free
            </span>
            <span aria-hidden="true" className="text-[15px] font-black">
              →
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-1.5 text-[9.5px] font-bold tracking-[0.5px] text-[#8b8b8b] uppercase">
            <span>No card needed</span>
            <span>·</span>
            <span>30 seconds</span>
            <span>·</span>
            <span className="text-[#8b8b8b]">Already a member?</span>
          </div>

          <p className="mt-1 text-[9px] font-bold tracking-[0.2px] text-[#6b6b6b]">{PREMIUM_TEASER_NOTICE}</p>
        </div>

        {/* Gengar — second column of the grid scoped just above, so he's
            vertically centered on the button/fine-print/footnote block
            specifically, not stretched to the bottom of the whole panel. */}
        <div aria-hidden="true" className="relative flex-none justify-self-start sm:justify-self-end">
          <span className="absolute -inset-2.5 rounded-full bg-pokemon-yellow/20 blur-md" />
          {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted under /public, animated GIF (next/image can't animate) */}
          <img
            src="/gengar.gif"
            alt=""
            className="relative h-16 w-16 [image-rendering:pixelated]"
            style={{ filter: "drop-shadow(3px 3px 0 rgba(0,0,0,0.45))" }}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ main */

export function VintedListingsSection({ vinted }: { vinted: VintedSummary }) {
  const visible = vinted.isReal ? vinted.rows.slice(0, FREE_VINTED_ROWS) : vinted.rows;
  const held = vinted.isReal ? vinted.rows.slice(FREE_VINTED_ROWS) : [];

  return (
    <div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        {/* Not "Just listed": Lobstr reads Vinted's search-results cards,
            which carry no listing date, so nothing here knows how old a
            listing is. Claiming recency we can't measure is the same class
            of error as showing an illustrative price as real. */}
        <span className="text-base font-black tracking-[-0.3px]">Vinted listings — {vinted.title}</span>
        {/* The badge tracks the data, not the layout. Scraped listings get
            the confident solid pill real connected data gets elsewhere on
            this page; the fallback feed gets a dashed "Preview" pill, since
            a "Live" badge over invented numbers would contradict every
            other real/illustrative signal on this site. */}
        {vinted.isReal ? (
          <span className="flex items-center gap-1.5 rounded-full border-2 border-black bg-success-green px-2.5 py-1 text-[11px] font-black tracking-[0.3px] text-white uppercase">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-white"
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
            Live
          </span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full border border-dashed border-[#9a9a9a] bg-white px-2.5 py-1 text-[11px] font-black tracking-[0.3px] text-muted-text uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-[#9a9a9a]" />
            Preview
          </span>
        )}
      </div>

      {/* Plain text, not a tooltip or an icon — the filter is the single
          most important thing to understand about this feed, and it has to
          be as visible to an AI agent reading raw HTML as to a human. */}
      <p className="mt-2 text-xs font-bold text-muted-text">
        <span className="text-foreground">{vinted.conditionFilter} only.</span> Vinted&apos;s other condition tiers are excluded from both this feed
        and the search link below, so it&apos;s deliberately narrower than an unfiltered search.
      </p>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-md border-2 border-black bg-pokemon-blue p-5 shadow-hard-md">
        <div>
          <div className="mb-1.5 text-[11px] font-black tracking-[0.5px] text-white/70 uppercase">Avg ask · {vinted.totalCount} listings</div>
          <div className="text-3xl font-black tracking-[-0.6px] text-white tabular-nums">{vinted.avgLabel}</div>
        </div>
        <div className="text-right text-[11px] font-bold text-white/70 uppercase">
          {vinted.isReal ? `asking prices${vinted.collectedLabel ? ` · collected ${vinted.collectedLabel} ago` : ""}` : "estimate, not real-time"}
        </div>
      </div>

      <div className="mt-5 rounded-md bg-white p-5">
        <div className="mb-3">
          <span className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">{vinted.conditionFilter} listings</span>
        </div>

        <div>
          {visible.map((row, i) => (
            <Row key={row.url ?? i} row={row} cardImageUrl={vinted.imageUrl} />
          ))}
        </div>

        {vinted.isReal && held.length > 0 && (
          <CatchEmAllReveal visible={visible} held={held} cardImageUrl={vinted.imageUrl} nameFull={vinted.title} totalCount={vinted.totalCount} />
        )}
      </div>

      <div className="mt-4">
        <a
          href={vinted.searchHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border-2 border-black bg-pokemon-red px-3.5 py-2 text-xs font-black tracking-[0.3px] text-white uppercase shadow-hard-sm transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md"
        >
          Search on Vinted ↗
        </a>
        <div className="mt-2 flex justify-end">
          <span className="flex items-end gap-1.5 text-[10px] font-bold text-muted-text uppercase">
            Powered by
            {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted under /public, not an optimizable remote domain */}
            <img src={VINTED_LOGO_URL} alt="Vinted" className="h-5 w-auto" />
            {/* Named, not hidden: these rows are scraped by a third party
                rather than served by Vinted, and a reader deserves to know
                which link in the chain produced the number. */}
            {vinted.isReal && <span>via Lobstr.io</span>}
          </span>
        </div>
      </div>

      <div className="mt-5 rounded-md border-2 border-black p-5" style={{ backgroundColor: CHIP_COLORS.green.bg }}>
        <div className="mb-2 text-[11px] font-black tracking-[0.5px] uppercase" style={{ color: CHIP_COLORS.green.text }}>
          Deal density · {vinted.totalCount} listings
        </div>
        <div className="mb-2.5 h-2 overflow-hidden rounded-full border-2 border-black bg-white">
          <span
            className="block h-full bg-success-green"
            style={{ width: `${Math.round((vinted.belowAverageCount / vinted.totalCount) * 100)}%` }}
          />
        </div>
        <p className="text-xs font-bold" style={{ color: CHIP_COLORS.green.text }}>
          <span className="text-foreground">
            {vinted.belowAverageCount} of {vinted.totalCount}
          </span>{" "}
          listings priced below the average.
        </p>
      </div>

      {!vinted.isReal && (
        <div className="mt-3">
          <IllustrativeTag label="Preview — no scraped Vinted listings yet" />
        </div>
      )}
    </div>
  );
}
