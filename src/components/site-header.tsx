import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SITE_NAME } from "@/lib/site";

/**
 * The site header: logo, primary navigation, one call to action.
 *
 * The navigation itself lives in components/site-nav.tsx and is a client
 * component — see its header for why it is grouped and why it needs state.
 * This shell stays a server component, so the only JavaScript the header ships
 * is the menu's own behaviour.
 *
 * `z-[60]`, not `z-50`, and the number is load-bearing rather than arbitrary:
 * the chart tooltips also sit at z-50, so at equal height the later element in
 * the DOM won and a tooltip could paint over an open menu. The menu panel
 * inside sits higher still, but that only orders it against its siblings —
 * a positioned ancestor caps everything it contains, so the header itself had
 * to clear the tooltips.
 *
 * No `relative` here, deliberately: `sticky` is already a positioned value, so
 * it is the containing block the mobile sheet measures its `absolute … top-16`
 * against. Adding `relative` would not help and would collide — both set
 * `position`, and which one wins depends on CSS source order rather than the
 * order they are written in the class attribute.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-[60] border-b-2 border-black bg-[var(--color-nav-dark)] text-white">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-4 px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-xl font-black tracking-[-0.5px]">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border-2 border-white bg-pokemon-red text-base">
            ⚡
          </span>
          {SITE_NAME}
        </Link>

        <div className="flex items-center gap-4">
          <SiteNav />
          {/* Unchanged destination and wording. Grouping the nav was the task;
              where the call to action points is a separate decision. It hides
              below `sm` so the menu button has room on a phone. */}
          <Link
            href="/tools/price-checker"
            className="hidden rounded-md border-2 border-black bg-pokemon-red px-4.5 py-2.5 text-sm font-black text-white shadow-hard-sm transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md active:translate-x-0 active:translate-y-0 active:shadow-none sm:block"
          >
            Start Tracking
          </Link>
        </div>
      </div>
    </header>
  );
}
