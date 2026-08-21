import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

const NAV_LINKS = [
  { href: "/collections/pokemon", label: "Pokémon" },
  { href: "/collections/one-piece", label: "One Piece" },
  { href: "/tools/price-checker", label: "Price checker" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-sm font-normal uppercase tracking-[0.08em]">
          {SITE_NAME}
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-3 text-xs uppercase tracking-[0.08em]">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
