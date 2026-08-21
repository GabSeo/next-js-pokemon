import Link from "next/link";
import { PriceCheckerForm } from "@/components/price-checker-form";
import { OpenDataLinks } from "@/components/open-data-links";
import { SITE_NAME } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-2 border-black bg-[var(--color-nav-dark)] text-white">
      <div className="mx-auto max-w-[1180px] space-y-9 px-6 py-14">
        <div className="space-y-3">
          <h2 className="text-lg font-black tracking-[-0.5px]">Price checker</h2>
          <p className="max-w-md text-sm text-white/65">
            Look up any of the {SITE_NAME} cards by ID to see last-sold prices, chart, and set a price alert.
          </p>
          <PriceCheckerForm compact />
        </div>

        <div className="flex flex-col gap-4 border-t-2 border-white/15 pt-8 text-sm font-bold sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-white/70">
            <Link href="/collections/pokemon" className="hover:text-white">
              Pokémon collection
            </Link>
            <Link href="/collections/one-piece" className="hover:text-white">
              One Piece collection
            </Link>
            <Link href="/tools/price-checker" className="hover:text-white">
              Price checker
            </Link>
            <Link href="/about" className="hover:text-white">
              About
            </Link>
            <Link href="/entitymap" className="hover:text-white">
              Entity map
            </Link>
            <Link href="/okf" className="hover:text-white">
              OKF
            </Link>
          </nav>
          <OpenDataLinks markdownHref="/index.md" jsonHref="/api/site" okfHref="/okf/home" className="text-white/70 [&_a]:hover:text-white" />
        </div>
        <p className="text-xs text-white/45">
          Prototype catalog — placeholder pricing data, not a real business.
        </p>
      </div>
    </footer>
  );
}
