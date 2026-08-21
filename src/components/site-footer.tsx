import Link from "next/link";
import { PriceCheckerForm } from "@/components/price-checker-form";
import { OpenDataLinks } from "@/components/open-data-links";
import { SITE_NAME } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-8">
        <div className="space-y-3">
          <h2 className="text-[26px] font-medium uppercase leading-[1.2] tracking-[0.18em]">Price checker</h2>
          <p className="text-base leading-[1.2] text-muted-foreground">
            Look up any of the {SITE_NAME} cards by ID to see last-sold
            prices, chart, and set a price alert.
          </p>
          <PriceCheckerForm />
        </div>

        <div className="flex flex-col gap-3 border-t border-border text-xs uppercase tracking-[0.08em] sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <Link href="/collections/pokemon" className="hover:text-foreground hover:underline">
              Pokémon collection
            </Link>
            <Link href="/collections/one-piece" className="hover:text-foreground hover:underline">
              One Piece collection
            </Link>
            <Link href="/tools/price-checker" className="hover:text-foreground hover:underline">
              Price checker
            </Link>
            <Link href="/about" className="hover:text-foreground hover:underline">
              About
            </Link>
            <Link href="/entitymap" className="hover:text-foreground hover:underline">
              Entity map
            </Link>
            <Link href="/okf" className="hover:text-foreground hover:underline">
              OKF
            </Link>
          </nav>
          <OpenDataLinks markdownHref="/index.md" jsonHref="/api/site" okfHref="/okf/home" />
        </div>
        <p className="text-[10px] tracking-[0.02em] text-muted-foreground">
          Prototype catalog — placeholder pricing data, not a real business.
        </p>
      </div>
    </footer>
  );
}
