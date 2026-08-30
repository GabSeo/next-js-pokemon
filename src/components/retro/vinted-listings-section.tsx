"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { MarketDataBadge } from "@/components/retro/market-data-badge";
import { MasterballIcon } from "@/components/retro/masterball-icon";
import type { VintedFeedRowSummary, VintedSummary } from "@/components/retro/graded-market-tabs";
import { CHIP_COLORS } from "@/lib/chip-colors";
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
  character,
}: {
  visible: VintedFeedRowSummary[];
  held: VintedFeedRowSummary[];
  cardImageUrl?: string;
  nameFull: string;
  totalCount: number;
  character: string;
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
                {/* No halo behind the ball. A filled 62px circle sitting
                    behind a 56px ball reads as a second, softer Master Ball
                    rather than as a glow — it has the ball's own silhouette,
                    and pulsing its opacity and scale gives that silhouette
                    an out-of-focus edge. Matching it to the ball's real
                    purple (the state before this) made the resemblance
                    stronger, not weaker. The button already announces itself
                    through its hover lift, tap scale, the ball's idle wobble
                    and the glint sweeping across it. */}
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

      {/* Always rendered, never conditionally mounted — `display: none`
          while locked, shown by the reveal. Nothing about the design
          changes: a display:none subtree takes no layout space, so the
          locked panel looks and measures exactly as it did when this block
          didn't exist, and the reveal still runs the same staggered
          entrance.

          What changes is the HTML. Gating the mount on `phase` meant these
          rows existed only after a human clicked the ball, so the
          server-rendered markup — the thing an AI agent or Googlebot
          actually reads — never contained them. Now they ship in the SSR
          output like the rest of the page. Same bytes for every requester,
          no user-agent branch.

          `phase` only ever moves locked -> catching -> open and never back,
          so this block has no exit animation to preserve and no longer
          needs AnimatePresence around it. */}
      <motion.div
        className={phase === "open" ? undefined : "hidden"}
        initial="hidden"
        animate={phase === "open" ? "shown" : "hidden"}
        variants={{ shown: { transition: { staggerChildren: reduce ? 0 : 0.07 } } }}
      >
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
          <ModelSignalPanel nameFull={nameFull} bestDeal={strongestGoodDeal(allRows)} character={character} />
        </motion.div>
      </motion.div>
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

/**
 * Self-hosted copy of Pokémon Showdown's animated sprite for whichever
 * character this card depicts (Card.character — "Gengar", "Lugia",
 * "Typhlosion" for the cards tracked today), replacing the one static
 * gengar.gif every card's panel used to show regardless of which Pokémon
 * the page was actually about.
 *
 * Self-hosted under /public/pokemon-sprites rather than linked straight to
 * play.pokemonshowdown.com: confirmed live, Showdown serves these with
 * Cache-Control: max-age=691200 (8 days, not theirs to change for us) —
 * flagged by PageSpeed Insights as a real repeat-visit cost for an asset
 * that never changes. Serving our own copy from /public gets Vercel's
 * standard far-future immutable caching instead (see next.config.ts).
 *
 * Showdown's filenames are the character name lowercased with every
 * non-alphanumeric character stripped — confirmed against the three real
 * cases this site currently has (all single, plain words) and matching
 * Showdown's own documented convention for the harder ones ("Mr. Mime" ->
 * mrmime, "Ho-Oh" -> hooh, "Farfetch'd" -> farfetchd). Not exhaustively
 * verified against every regional form/gender-variant naming edge case —
 * <img>'s onError below hides the mascot entirely rather than showing a
 * broken-image icon if a given name doesn't resolve to a real sprite.
 *
 * Trade-off of self-hosting: a NEW character (a new card added later) needs
 * its sprite downloaded into /public/pokemon-sprites by hand before it'll
 * show — same one-time manual step lib/entitymap.ts's CHARACTER_ENTITIES
 * map already requires per new character, not a new maintenance pattern.
 * Until that file exists, onError just hides the mascot, same as today.
 *
 * Only ever called for Pokémon cards in practice: this mascot only renders
 * inside the Vinted "France" panel, which only ever gets real data (the
 * isReal gate this sits behind) for Pokémon refs — One Piece characters
 * like "Roronoa Zoro" would never reach this function today, but the
 * onError fallback means it wouldn't render a broken image if it ever did.
 */
function pokemonShowdownSpriteUrl(character: string): string {
  const slug = character.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `/pokemon-sprites/${slug}.gif`;
}

function ModelSignalPanel({ nameFull, bestDeal, character }: { nameFull: string; bestDeal?: VintedFeedRowSummary; character: string }) {
  const firstSignal = bestDeal ? `${bestDeal.priceLabel} ask entered under fair value` : "New ask entered under fair value";
  // Hides the mascot entirely (rather than a broken-image icon) if this
  // character's name doesn't resolve to a real Showdown sprite — see
  // pokemonShowdownSpriteUrl's own doc comment on why that's not guaranteed
  // for every possible character name.
  const [spriteFailed, setSpriteFailed] = useState(false);

  return (
    <div className="mt-3.5 rounded-md border-2 border-black bg-foreground p-6" style={{ boxShadow: "6px 6px 0 0 rgba(10,10,10,.3)" }}>
      <div className="flex flex-wrap items-center gap-3">
        {/* Name alone here — "Premium" said once, by the pill, not twice. */}
        <span className="text-[10px] font-black tracking-[1.1px] text-pokemon-yellow uppercase">{nameFull}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-pokemon-yellow bg-pokemon-yellow/15 px-2 py-px">
          <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-pokemon-yellow" />
          <span className="text-[9px] font-black tracking-[0.7px] text-pokemon-yellow uppercase">Premium</span>
        </span>
      </div>

      {/* No trailing periods — these two lines read as one continuous
          headline, and a mid-headline full stop breaks that read. */}
      <div className="mt-2.5 text-[22px] font-black tracking-[-0.6px] text-pretty">
        <span className="text-white">Something&rsquo;s up with {nameFull}</span>
        <br />
        <span className="text-pokemon-yellow">Premium tells you what</span>
      </div>
      <p className="mt-2.5 max-w-[460px] text-xs leading-[18px] text-[#b9b9b9] text-pretty">
        Every time a new listing lands, we check if it&rsquo;s worth acting on — and Premium members see the call, plus the reasoning, right when it happens.
      </p>

      <div className="mt-5 flex items-stretch gap-4">
        {/* conviction score — no real model behind it, see PREMIUM_TEASER_NOTICE */}
        <div className="w-[120px] flex-none rounded-[5px] border-2 border-[#2a2a2a] bg-[#161616] px-3.5 py-3">
          <div className="text-[9px] font-bold tracking-[0.8px] text-[#8b8b8b] uppercase">Conviction</div>
          <div aria-hidden="true" className="mt-1 flex items-baseline gap-0.5 blur-[5px] select-none">
            <span className="text-[32px] font-black tracking-[-1.4px] text-pokemon-yellow">84</span>
            <span className="text-xs font-black text-[#8b8b8b]">/100</span>
          </div>
          <div className="mt-2 flex gap-[3px]">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-sm ${i < 3 ? "bg-pokemon-yellow" : "bg-[#2a2a2a]"}`} />
            ))}
          </div>
        </div>

        {/* signal log — one real (the best held deal, if any), two illustrative */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2.5 rounded-[5px] border-2 border-[#2a2a2a] bg-[#161616] px-3 py-2.5">
            <span className="flex-none rounded-sm border-[1.5px] border-black bg-success-green px-1.5 text-[9px] font-black tracking-[0.6px] text-black uppercase">
              Buy
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[#e4e4e4]">{firstSignal}</span>
          </div>
          <div aria-hidden="true" className="flex flex-col gap-2 blur-[4px]">
            {(["Buy", "Sell"] as const).map((k) => (
              <div key={k} className="flex items-center gap-2.5 rounded-[5px] border-2 border-[#2a2a2a] bg-[#161616] px-3 py-2.5">
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
      <div className="mt-7 grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col items-start gap-2.5">
          {/* Compact single-line CTA — lead + separator + value + arrow, no
              leading icon (Gengar is this panel's one mascot now, not a
              second ball here too). flex-wrap so it folds onto two lines on
              a narrow card instead of overflowing the panel. */}
          <button
            type="button"
            className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border-2 border-pokemon-yellow bg-pokemon-yellow py-3 pr-4 pl-4 text-foreground transition-all duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pokemon-yellow"
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
          <div className="flex flex-wrap items-center gap-2 text-[9.5px] font-bold tracking-[0.5px] text-[#8b8b8b] uppercase">
            <span>No card needed</span>
            <span>·</span>
            <span>30 seconds</span>
            <span>·</span>
            <span className="text-[#8b8b8b]">Already a member?</span>
          </div>

          <p className="mt-1.5 text-[9px] font-bold tracking-[0.2px] text-[#6b6b6b]">{PREMIUM_TEASER_NOTICE}</p>
        </div>

        {/* Mascot — second column of the grid scoped just above, so it's
            vertically centered on the button/fine-print/footnote block
            specifically, not stretched to the bottom of the whole panel. */}
        {!spriteFailed && (
          <div aria-hidden="true" className="relative flex-none justify-self-start sm:justify-self-end">
            <span className="absolute -inset-2.5 rounded-full bg-pokemon-yellow/20 blur-md" />
            {/* eslint-disable-next-line @next/next/no-img-element -- external Showdown CDN, not a next/image-allowlisted domain, and it's an animated GIF (next/image can't animate) either way */}
            <img
              src={pokemonShowdownSpriteUrl(character)}
              alt=""
              className="relative h-16 w-16 [image-rendering:pixelated]"
              style={{ filter: "drop-shadow(3px 3px 0 rgba(0,0,0,0.45))" }}
              onError={() => setSpriteFailed(true)}
            />
          </div>
        )}
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
      {/* This section is the France branch of the same panel the English and
          Japanese markets render into, and a visitor flips between them with
          one toggle click — so the blocks are pinned to the same vertical
          rhythm as the eBay branch in graded-market-tabs.tsx rather than
          spaced to their own taste: mt-7 to the panel heading, this row
          wearing that branch's condition-tablist styling (so it is exactly
          as tall), then mt-7 again. This heading therefore starts on the
          same line as PSA 10 and the summary card below starts on the same
          line as the Active/Sold pair, so toggling markets doesn't shuffle
          the page under the reader's eye. The listing rows further down are
          content-height and can't align — nor should they.

          The heading is styled as the selected tab of that row, not as a
          heading, because that is what it is: France has exactly one feed,
          so there is nothing to switch between and no button here. It reads
          as the single filter this market offers rather than as a dead tab
          bar — hence a plain span with the selected look, never a
          role="tab"/aria-selected an assistive reader could take for a
          control that does something. */}
      <div className="mt-7 flex flex-wrap items-center justify-between gap-2 border-b-2 border-border-subtle">
        {/* Card first, marketplace second, because the card is what the
            reader came for and the marketplace is the qualifier — the same
            order as the eBay branch's "Active listings · English", where
            the market is also the trailing half. Deliberately not "Just
            listed" or anything else implying recency: Lobstr reads Vinted's
            search-results cards, which carry no listing date, so nothing
            here knows how old a listing is, and claiming recency we can't
            measure is the same class of error as showing an illustrative
            price as real.

            "on Vinted" drops out of the upper-case the card name is set in
            so the two halves read as subject and qualifier rather than as
            one long shouted string — normal-case has to be explicit because
            the tab styling this row borrows is uppercase. The capital V is
            not the sentence case slipping: Vinted is the company's own
            spelling of its name, and lower-casing a brand in body text is a
            typo everywhere else on this page too. */}
        <span className="-mb-0.5 border-b-[3px] border-pokemon-red pb-3.5 text-sm font-black tracking-[0.3px] uppercase">
          {vinted.title}
          <span className="font-bold text-muted-text normal-case"> · on Vinted</span>
        </span>
      </div>

      <div className="mt-7 flex flex-wrap items-end justify-between gap-3 rounded-md border-2 border-black bg-pokemon-blue p-5 shadow-hard-md">
        <div>
          <div className="mb-1.5 text-[11px] font-black tracking-[0.5px] text-white/70 uppercase">Avg ask · {vinted.totalCount} listings</div>
          {/* text-2xl, not text-3xl — same size as the Active/Sold figures this card sits in place of, which is also what keeps the two cards the same height. */}
          <div className="text-2xl font-black tracking-[-0.6px] text-white tabular-nums">{vinted.avgLabel}</div>
        </div>
        <div className="text-right text-[11px] font-bold text-white/70 uppercase">
          {vinted.isReal ? `asking prices${vinted.collectedLabel ? ` · collected ${vinted.collectedLabel} ago` : ""}` : "estimate, not real-time"}
        </div>
      </div>

      <div className="mt-6 rounded-md bg-white p-5">
        {/* Badge opposite the label, exactly as the English and Japanese
            markets head their own listings box (graded-market-tabs.tsx) —
            it answers for these rows, so it sits on them. */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {/* Worded exactly like the eBay markets' own listings header
              ("Active listings · English") rather than naming the condition
              tier here — same box, same position, same sentence shape, so
              the three markets read as one panel. Every row still carries
              its own "Très bon état" chip, and the markdown/MCP exports
              still state the filter in full (lib/markdown.ts), so nothing
              about how narrow this feed is has become invisible.

              "Active" is literal, not borrowed: these are listings currently
              for sale. Vinted has no public sold feed, which is why this
              market has no Active/Sold split to mirror. */}
          <span className="text-[10px] font-black tracking-[0.5px] text-muted-text uppercase">Active listings · France</span>
          <MarketDataBadge isReal={vinted.isReal} />
        </div>

        <div>
          {visible.map((row, i) => (
            <Row key={row.url ?? i} row={row} cardImageUrl={vinted.imageUrl} />
          ))}
        </div>

        {vinted.isReal && held.length > 0 && (
          <CatchEmAllReveal
            visible={visible}
            held={held}
            cardImageUrl={vinted.imageUrl}
            nameFull={vinted.title}
            totalCount={vinted.totalCount}
            character={vinted.character}
          />
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
          </span>
        </div>
      </div>

      <div className="mt-6 rounded-md border-2 border-black p-5" style={{ backgroundColor: CHIP_COLORS.green.bg }}>
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
