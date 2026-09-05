import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

const NAV_LINKS = [
  { href: "/tools/price-checker", label: "Price Checker" },
  { href: "/cards", label: "Search Cards" },
  // NOTE: this points at the 11 tracked cards, not at sets. /sets is the
  // catalogue's own 218-set index and is arguably what this label promises —
  // left as-is rather than repointed, since the destination is a product call.
  { href: "/collections/pokemon", label: "Browse Sets" },
  { href: "/tools/grading-calculator", label: "Grading" },
  { href: "/#movers", label: "Market Movers" },
  { href: "/collection", label: "My Collection" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-black bg-[var(--color-nav-dark)] text-white">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-xl font-black tracking-[-0.5px]">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border-2 border-white bg-pokemon-red text-base">
            ⚡
          </span>
          {SITE_NAME}
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-10 text-sm font-bold tracking-[0.35px] md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="opacity-80 transition-opacity hover:opacity-100">
              {link.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/tools/price-checker"
          className="rounded-md border-2 border-black bg-pokemon-red px-4.5 py-2.5 text-sm font-black text-white shadow-hard-sm transition-[transform,box-shadow] duration-100 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-md active:translate-x-0 active:translate-y-0 active:shadow-none"
        >
          Start Tracking
        </Link>
      </div>
    </header>
  );
}
