"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The primary navigation, grouped.
 *
 * WHY IT IS GROUPED. The flat list had grown to ten links at `gap-10`, which
 * overflows the 1180px container it sits in — every phase of the catalogue work
 * added another entry and nothing ever removed one. Ten peers also say nothing
 * about how the site is organised: "Scan a Card", "Find a Card" and "Search
 * Cards" read as three near-synonyms until you know they are three steps of one
 * flow. Three groups of three or four say it.
 *
 * WHY IT IS A CLIENT COMPONENT, when the header was happily static. A dropdown
 * that opens on hover alone is unusable by keyboard and unreliable on touch,
 * and `<details>` cannot be dismissed by clicking away from it. Escape,
 * outside-click and close-on-navigate are the three behaviours that make a menu
 * feel like a menu, and all three need state.
 *
 * WHY MOBILE GETS A MENU AT ALL. It did not have one. The old nav was
 * `hidden … md:flex` with no counterpart, so a phone saw the logo, the
 * "Start Tracking" button and nothing else — /scan, the one page most likely to
 * be opened ON a phone, was unreachable from it.
 */

type NavItem = { href: string; label: string; hint?: string };
type NavGroup = { id: string; label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    id: "find",
    label: "Find cards",
    // The three steps of one flow, in the order a person meets them, followed
    // by the browse surface for when they have nothing to look up. Their
    // labels are near-synonyms in isolation, so each carries a hint.
    items: [
      { href: "/scan", label: "Scan a Card", hint: "Photograph it — read on your device" },
      { href: "/lookup", label: "Find a Card", hint: "By code, printed number or name" },
      { href: "/cards", label: "Search Cards", hint: "Browse Pokémon with filters" },
      { href: "/sets", label: "Browse Sets", hint: "Every set and pack, both games" },
    ],
  },
  {
    id: "market",
    label: "Market",
    items: [
      { href: "/tools/price-checker", label: "Price Checker", hint: "Live prices for a tracked card" },
      { href: "/#movers", label: "Market Movers", hint: "What moved today" },
      { href: "/tools/grading-calculator", label: "Grading", hint: "What a grade is worth" },
    ],
  },
  {
    id: "collection",
    label: "Collection",
    // The tracked cards, per game, plus the personal collection. These were
    // reachable only from the footer for a long time.
    items: [
      { href: "/collection", label: "My Collection", hint: "The printings YOU own" },
      { href: "/tracked/pokemon", label: "Tracked Pokémon", hint: "Cards WE track, with full market data" },
      { href: "/tracked/one-piece", label: "Tracked One Piece", hint: "Cards WE track, with full market data" },
    ],
  },
];

/** True when `href` is the page being viewed, so the menu can say where you are. */
function isCurrent(pathname: string, href: string): boolean {
  const path = href.split("#")[0];
  if (path === "/" || path === "") return false;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function SiteNav() {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | undefined>();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  // Escape closes whatever is open, and a click outside the nav closes the
  // desktop dropdown. Both are what makes it behave like a menu rather than a
  // panel that appeared.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenGroup(undefined);
      setMobileOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (navRef.current?.contains(event.target as Node)) return;
      setOpenGroup(undefined);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // Navigating is the end of a menu's job. Without this the panel survives the
  // route change and covers the page you just asked for.
  //
  // Adjusted DURING RENDER rather than in an effect. Each link already closes
  // the menu in its own onClick, so this only catches navigation that happens
  // another way — browser back/forward, or a link elsewhere on the page. React
  // 19's `react-hooks/set-state-in-effect` rejects the effect form, and it is
  // right to: this is derived state, and the documented pattern for "reset when
  // a value changes" is to compare against the previous value while rendering.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpenGroup(undefined);
    setMobileOpen(false);
  }

  return (
    <div ref={navRef} className="flex items-center">
      {/* Desktop: three buttons, each opening a vertical panel. */}
      <nav aria-label="Primary" className="hidden items-center gap-2 text-sm font-bold md:flex">
        {GROUPS.map((group) => {
          const open = openGroup === group.id;
          const active = group.items.some((item) => isCurrent(pathname, item.href));

          return (
            <div key={group.id} className="relative">
              <button
                type="button"
                aria-expanded={open}
                aria-haspopup="menu"
                onClick={() => setOpenGroup(open ? undefined : group.id)}
                className={`flex items-center gap-1.5 rounded-md border-2 px-3 py-2 transition-colors ${
                  open
                    ? "border-white bg-white text-[var(--color-nav-dark)]"
                    : active
                      ? "border-white/60 bg-white/10 text-white"
                      : "border-transparent text-white/85 hover:border-white/40 hover:bg-white/10 hover:text-white"
                }`}
              >
                {group.label}
                <span aria-hidden className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>
                  ▼
                </span>
              </button>

              {open ? (
                <div
                  role="menu"
                  aria-label={group.label}
                  className="absolute right-0 top-full z-[100] mt-2 w-80 rounded-lg border-2 border-black bg-white p-2 text-foreground"
                  style={{ boxShadow: "4px 4px 0 0 #000" }}
                >
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                      onClick={() => setOpenGroup(undefined)}
                      className={`block rounded-md border-2 px-3 py-2.5 transition-colors ${
                        isCurrent(pathname, item.href)
                          ? "border-black bg-muted-surface"
                          : "border-transparent hover:border-black hover:bg-muted-surface"
                      }`}
                    >
                      <span className="block text-sm font-black">{item.label}</span>
                      {item.hint ? (
                        <span className="mt-0.5 block text-xs font-medium text-muted-text">{item.hint}</span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      {/* Mobile: one button, one vertical sheet with every group expanded.
          Nothing is hidden behind a second tap — there are only ten links, and
          a phone is where /scan matters most. */}
      <button
        type="button"
        aria-expanded={mobileOpen}
        aria-controls="mobile-nav"
        onClick={() => setMobileOpen((wasOpen) => !wasOpen)}
        className="rounded-md border-2 border-white px-3 py-1.5 text-sm font-black md:hidden"
      >
        {mobileOpen ? "Close" : "Menu"}
      </button>

      {mobileOpen ? (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="absolute left-0 right-0 top-16 z-[100] max-h-[calc(100vh-4rem)] overflow-y-auto border-b-2 border-black bg-white p-4 text-foreground md:hidden"
        >
          {GROUPS.map((group) => (
            <div key={group.id} className="mb-4 last:mb-0">
              <p className="border-b-2 border-black px-1 pb-1 text-xs font-black uppercase tracking-wide">{group.label}</p>
              <div className="mt-1.5">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={`block rounded-md border-2 px-3 py-3 ${
                      isCurrent(pathname, item.href) ? "border-black bg-muted-surface" : "border-transparent"
                    }`}
                  >
                    <span className="block text-sm font-black">{item.label}</span>
                    {item.hint ? (
                      <span className="mt-0.5 block text-xs font-medium text-muted-text">{item.hint}</span>
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
