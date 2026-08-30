"use client";

import { motion, useReducedMotion } from "motion/react";
import { CHIP_COLORS } from "@/lib/chip-colors";

/**
 * Whether the listings on screen were actually fetched, said once in one
 * fixed place: the top-right corner of the listings box itself, opposite
 * that box's own label, in every market.
 *
 * On the rows rather than up in the panel chrome because that is what it
 * describes — the reader is looking at a list of prices and the question the
 * badge answers is "are THESE real". Sitting on the box makes the claim and
 * its subject impossible to mismatch, and it keeps the badge honest when the
 * answer differs between two views of the same market (see below).
 *
 * It used to exist only inside the France/Vinted branch, which made the
 * absence of a badge on the English and Japanese markets read as a claim —
 * a reader who learns that "Live" means scraped-today on one tab has no way
 * to know that the tab next to it is equally live, or isn't. A status that
 * appears for one branch and not the others is worse than no status at all,
 * so this is now rendered for all three from the same component.
 *
 * Sized and coloured as a chip, not as a callout: it sits inside the
 * listings box's own 10px header, so it wears the same tint palette as the
 * condition and deal chips in the rows below it (lib/chip-colors.ts) and
 * carries no border or hard shadow. A heavier badge here competed with the
 * prices, which are the thing on this box worth looking at — the status only
 * has to be findable, not loud.
 *
 * The badge tracks the DATA, not the layout, and re-reads on every tab
 * change — eBay's sold listings are illustrative everywhere on this site
 * (its sold API is closed, see lib/illustrative.ts), so switching Active →
 * Sold genuinely flips this to Preview, which is the honest answer and not
 * a bug. Real data gets the confident solid pill that real connected data
 * gets elsewhere on this page; anything illustrative gets a dashed, muted
 * one, because a "Live" badge over invented numbers would contradict every
 * other real/illustrative signal on the site.
 *
 * The per-block IllustrativeTag markers stay where they are. This says
 * *what* the panel is showing at a glance; those say *why* a specific
 * number is a placeholder, right next to that number.
 */
export function MarketDataBadge({ isReal }: { isReal: boolean }) {
  // Respected explicitly rather than left to the browser: this dot pulses
  // forever, and an indefinite animation is exactly what a reduced-motion
  // preference is asking about. The colour alone still carries the state.
  const reduceMotion = useReducedMotion();

  const tint = isReal ? CHIP_COLORS.green : CHIP_COLORS.grey;

  return (
    <span
      className="flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black tracking-[0.3px] uppercase"
      style={{ backgroundColor: tint.bg, color: tint.text }}
    >
      {/* bg-current, so the dot is always the chip's own text shade and the
          two states can never drift apart. */}
      {isReal ? (
        <motion.span
          className="h-1.5 w-1.5 rounded-full bg-current"
          animate={reduceMotion ? undefined : { opacity: [1, 0.25, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {isReal ? "Live" : "Preview"}
    </span>
  );
}
