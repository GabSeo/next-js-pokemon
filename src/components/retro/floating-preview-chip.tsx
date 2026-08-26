"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A pill that reveals a small floating card on hover, focus or tap.
 *
 * Deliberately generic: it owns *when* and *where* a preview appears and
 * nothing about what is in it. The grading-tier pills are the first caller
 * (graded-market-tabs.tsx); the condition pills are meant to be the second,
 * which is why the trigger is a render prop rather than a styled button
 * baked in here — every caller keeps its own markup, roles and classes, and
 * this component only hands back the props that make the preview work.
 *
 * Three decisions worth knowing about:
 *
 * 1. It renders into a PORTAL on document.body, positioned `fixed`. An
 *    absolutely-positioned card would be clipped by any ancestor with
 *    `overflow: hidden` (the Market Overview panel has several) and, worse,
 *    `position: fixed` silently becomes relative-to-ancestor as soon as any
 *    ancestor has a transform — which the site's pressable() hover styles
 *    apply all over this page. A portal sidesteps both.
 *
 * 2. Closing is DELAYED and cancellable. Moving the pointer between the
 *    pill and the card, or flicking across two pills, would otherwise
 *    unmount and remount the card and read as a flicker. The close timer is
 *    cleared by any re-entry, and AnimatePresence interrupts an exit that is
 *    already running rather than queueing behind it.
 *
 * 3. Focus is a first-class trigger, not an afterthought. These pills are
 *    real tabs — a keyboard user arrows through them — so the preview has to
 *    answer to focus/blur exactly as it does to the pointer, and the card is
 *    wired to the trigger with aria-describedby so a screen reader reads it
 *    rather than discovering a floating div with no owner.
 */

export type FloatingPreviewPlacement = "top" | "bottom" | "left" | "right";

/**
 * Spread onto whatever element the caller wants the preview anchored to.
 *
 * Generic over the trigger element so `ref` lands on a `<button>` (or an
 * `<a>`, or whatever the next caller uses) without a cast. A plain
 * `RefObject<HTMLElement>` would not assign to `Ref<HTMLButtonElement>` —
 * `current` is mutable, so the type is invariant, not covariant.
 */
export type FloatingPreviewTriggerProps<T extends HTMLElement> = {
  ref: React.RefObject<T | null>;
  "aria-describedby"?: string;
  onPointerEnter: (event: React.PointerEvent) => void;
  onPointerLeave: (event: React.PointerEvent) => void;
  onPointerDown: (event: React.PointerEvent) => void;
  onFocus: () => void;
  onBlur: () => void;
};

/** Distance between the anchor and the card. */
const GAP_PX = 10;
/** Smallest gap the card will leave between itself and the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;
/**
 * How long the card lingers after the pointer leaves. Long enough to cross
 * the gap between pill and card without the card vanishing underneath the
 * cursor, short enough that it doesn't feel stuck.
 */
const CLOSE_DELAY_MS = 120;
/**
 * Touch has no hover and no blur, so a tapped preview needs to dismiss
 * itself. It also closes on the next tap anywhere else — this is only the
 * backstop for a tap followed by nothing at all.
 */
const TOUCH_DISMISS_MS = 2600;

type Position = { top: number; left: number; originX: number; originY: number };

/**
 * The card's LAYOUT size, deliberately not a DOMRect.
 *
 * getBoundingClientRect() reports the post-transform box, and this card is
 * measured while its entrance transform is still at scale 0.9 — so a rect
 * gives back 90% of the real size and the card is placed 10% of its height
 * too close to the pill, then grows over it as the spring settles. Live
 * proof before this was fixed: a 133.5px card measured 120.15px and landed
 * 13px low, overlapping the very pill it was describing. offsetWidth /
 * offsetHeight are layout values and ignore transforms entirely.
 */
type Size = { width: number; height: number };

function clamp(value: number, min: number, max: number): number {
  // max < min when the card is wider/taller than the viewport allows; the
  // margin is a preference, staying on screen is not, so min wins.
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/**
 * Picks the first side with room for the card, preferring the caller's
 * choice and falling back through the perpendicular sides.
 *
 * When nothing fits (a short viewport, a tall card) it returns whichever
 * side is least short rather than giving up on the preferred one — the card
 * is clamped into the viewport afterwards either way, so "least bad" is a
 * real improvement over "preferred regardless".
 */
function resolvePlacement(anchor: DOMRect, card: Size, preferred: FloatingPreviewPlacement): FloatingPreviewPlacement {
  const space: Record<FloatingPreviewPlacement, number> = {
    top: anchor.top,
    bottom: window.innerHeight - anchor.bottom,
    left: anchor.left,
    right: window.innerWidth - anchor.right,
  };
  const needed: Record<FloatingPreviewPlacement, number> = {
    top: card.height + GAP_PX + VIEWPORT_MARGIN_PX,
    bottom: card.height + GAP_PX + VIEWPORT_MARGIN_PX,
    left: card.width + GAP_PX + VIEWPORT_MARGIN_PX,
    right: card.width + GAP_PX + VIEWPORT_MARGIN_PX,
  };

  const fallbacks: Record<FloatingPreviewPlacement, FloatingPreviewPlacement[]> = {
    top: ["top", "bottom", "right", "left"],
    bottom: ["bottom", "top", "right", "left"],
    left: ["left", "right", "top", "bottom"],
    right: ["right", "left", "top", "bottom"],
  };

  const order = fallbacks[preferred];
  const fits = order.find((side) => space[side] >= needed[side]);
  if (fits) return fits;
  return order.reduce((best, side) => (space[side] - needed[side] > space[best] - needed[best] ? side : best), order[0]);
}

/**
 * Viewport coordinates for the card, plus the transform origin.
 *
 * The origin matters more than it looks: a card that scales up from its own
 * centre reads as an unrelated thing appearing nearby, while one that grows
 * out of the point closest to the pill reads as belonging to it. So the
 * origin tracks the anchor's centre even after the card has been clamped
 * sideways to stay on screen.
 */
function positionFor(placement: FloatingPreviewPlacement, anchor: DOMRect, card: Size): Position {
  const vertical = placement === "top" || placement === "bottom";

  const unclampedTop = vertical
    ? placement === "top"
      ? anchor.top - card.height - GAP_PX
      : anchor.bottom + GAP_PX
    : anchor.top + anchor.height / 2 - card.height / 2;

  const unclampedLeft = vertical
    ? anchor.left + anchor.width / 2 - card.width / 2
    : placement === "left"
      ? anchor.left - card.width - GAP_PX
      : anchor.right + GAP_PX;

  const top = clamp(unclampedTop, VIEWPORT_MARGIN_PX, window.innerHeight - card.height - VIEWPORT_MARGIN_PX);
  const left = clamp(unclampedLeft, VIEWPORT_MARGIN_PX, window.innerWidth - card.width - VIEWPORT_MARGIN_PX);

  return {
    top,
    left,
    originX: clamp(anchor.left + anchor.width / 2 - left, 0, card.width),
    originY: vertical
      ? placement === "top"
        ? card.height
        : 0
      : clamp(anchor.top + anchor.height / 2 - top, 0, card.height),
  };
}

export function FloatingPreviewChip<T extends HTMLElement = HTMLButtonElement>({
  preview,
  placement = "top",
  disabled = false,
  children,
}: {
  /** Card contents. Rendered only while open, so a caller can build it eagerly without paying for it on every pill. */
  preview: ReactNode;
  /** Preferred side. Flipped automatically when there isn't room — see resolvePlacement. */
  placement?: FloatingPreviewPlacement;
  /** Turns the chip into a plain pass-through, for a pill with nothing worth previewing. */
  disabled?: boolean;
  children: (trigger: FloatingPreviewTriggerProps<T>) => ReactNode;
}) {
  const describedById = useId();
  const reduce = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  /**
   * Latches true the first time the chip opens, and never goes back.
   *
   * It does two jobs at once. createPortal needs a document, and this can
   * only flip inside a pointer/focus handler — which cannot run on the
   * server — so the portal is never reached during SSR or hydration without
   * a mount effect to announce it. And because it never flips back, the
   * portal outlives `open` going false, which is what lets AnimatePresence
   * actually play the exit instead of having the whole subtree yanked out
   * from under it.
   */
  const [everOpened, setEverOpened] = useState(false);

  const anchorRef = useRef<T | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);


  const clearTimers = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (touchTimer.current) clearTimeout(touchTimer.current);
    closeTimer.current = null;
    touchTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const show = useCallback(() => {
    if (disabled) return;
    clearTimers();
    setEverOpened(true);
    setOpen(true);
  }, [disabled, clearTimers]);

  /** Delayed so crossing the gap to the card, or flicking to the next pill, doesn't unmount anything. */
  const scheduleClose = useCallback(() => {
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [clearTimers]);

  const closeNow = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);

  // Measure and place. useLayoutEffect rather than useEffect so the card is
  // positioned in the same frame it mounts — with useEffect it paints once
  // at the top-left of the viewport before jumping into place.
  useLayoutEffect(() => {
    // Nothing to measure while closed, and deliberately no reset of the last
    // position: the card isn't rendered, and on the next open this effect
    // re-measures before the browser paints, so a stale value is never seen.
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const cardEl = cardRef.current;
      if (!anchor || !cardEl) return;
      // Layout size, not the animated rect — see Size.
      const card: Size = { width: cardEl.offsetWidth, height: cardEl.offsetHeight };
      setPosition(positionFor(resolvePlacement(anchor, card, placement), anchor, card));
    };
    place();

    // The anchor moves under the card on scroll or resize. Capture phase so
    // scrolls inside any container count, not just the window's own.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, placement]);

  // Escape closes, and a tap anywhere else does too — the touch path has no
  // pointerleave or blur to rely on.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNow();
    };
    const onPointerDownOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (anchorRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      closeNow();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDownOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDownOutside);
    };
  }, [open, closeNow]);

  const trigger: FloatingPreviewTriggerProps<T> = {
    ref: anchorRef,
    "aria-describedby": open ? describedById : undefined,
    onPointerEnter: (event) => {
      // Touch fires a synthetic pointerenter right before the tap; letting it
      // open here would race the pointerdown handler below and re-open a card
      // the user is dismissing.
      if (event.pointerType === "touch") return;
      show();
    },
    onPointerLeave: (event) => {
      if (event.pointerType === "touch") return;
      scheduleClose();
    },
    onPointerDown: (event) => {
      if (event.pointerType !== "touch") return;
      // Tap is the hover substitute, not a replacement for the pill's own
      // click — this never preventDefaults, so selecting the tab still works.
      show();
      touchTimer.current = setTimeout(() => setOpen(false), TOUCH_DISMISS_MS);
    },
    onFocus: show,
    onBlur: scheduleClose,
  };

  return (
    <>
      {children(trigger)}
      {everOpened &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                // A single stable key per chip: re-hovering during the exit
                // interrupts that exit rather than mounting a second card.
                key="floating-preview"
                ref={cardRef}
                id={describedById}
                role="tooltip"
                // Keeping the pointer on the card keeps it open, which is what
                // makes the content selectable rather than a thing that
                // evaporates when you reach for it.
                onPointerEnter={show}
                onPointerLeave={scheduleClose}
                initial={{ opacity: 0, scale: reduce ? 1 : 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: reduce ? 1 : 0.96 }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : {
                        // Spring rather than a linear fade: the entrance should
                        // settle, not arrive. visualDuration is the perceived
                        // length (~180ms) with a little overshoot on top.
                        type: "spring",
                        visualDuration: 0.18,
                        bounce: 0.28,
                        // Exit is a plain quick fade — a spring on the way out
                        // reads as hesitation.
                        opacity: { duration: 0.12, ease: "easeOut" },
                      }
                }
                style={{
                  position: "fixed",
                  top: position?.top ?? 0,
                  left: position?.left ?? 0,
                  transformOrigin: position ? `${position.originX}px ${position.originY}px` : "center",
                  // Hidden for the one layout pass between mounting (needed to
                  // measure it) and knowing where it goes.
                  visibility: position ? "visible" : "hidden",
                  zIndex: 60,
                }}
                className="pointer-events-auto w-max max-w-[min(17rem,calc(100vw-1rem))] rounded-md border-2 border-black bg-card-surface p-3 shadow-hard-md"
              >
                {preview}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
