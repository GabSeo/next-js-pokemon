"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True only once running in the browser, without the setState-in-an-effect
 * that this project's react-hooks config rejects.
 *
 * Every bklit Gauge on this site needs it. The gauge computes each notch's
 * path from trigonometry and emits full-precision floats, and the last unit
 * in the last place does not always agree between V8 on Node and V8 in
 * Chrome — the server sends `53.81143880104836` where the client renders
 * `53.81143880104837`. React reads that as a hydration mismatch and repairs
 * it by discarding and re-rendering the tree. Confirmed live against the dev
 * overlay, on the notch paths specifically; nothing in tsc, eslint or
 * `next build` catches it.
 *
 * The bar and radar charts escape it by animating in from a collapsed
 * origin, so their first painted geometry is `M 0,0` on both sides. Gauges
 * draw their real arc immediately.
 *
 * Skipping SSR costs nothing here as long as every number a gauge encodes is
 * also on the page as text — which is the rule this site holds to anyway.
 */
export function useIsBrowser(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
