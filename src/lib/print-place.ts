import type { CardPrint } from "@/lib/card-view";

/**
 * Where a printing comes from, as one line: "OP-05 · Awakening of the New Era".
 *
 * TWO FACTS, NOT ONE. `origin` is Bandai's pack code and is always there;
 * `setName` is the mirror's full set name and is there for the 69.4% of
 * non-base printings it has a row for. A reader who knows the game reads the
 * code faster; everyone else reads the name. Showing both costs one line and
 * spares us choosing which reader to serve.
 *
 * IN ITS OWN FILE BECAUSE OF WHO RENDERS IT. Three tiles show this — the card
 * page and both grids on the scan — and the scan's is a client component. Its
 * natural home, lib/card-view.ts, reaches node:fs through the catalogue
 * loaders, so a value import there would pull a server-only module into the
 * browser bundle. A type import is erased and costs nothing, which is why the
 * CardPrint above is safe and the function would not have been.
 */
export function printPlace(print: CardPrint): string {
  if (!print.setName || print.setName === print.origin) return print.origin;
  return `${print.origin} · ${print.setName}`;
}
