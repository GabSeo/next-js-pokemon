import type { Metadata } from "next";
import { cardRefs } from "@/data/card-refs";
import { franchiseLabel } from "@/lib/cards";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Open Knowledge Format",
  description: `${SITE_NAME}'s Open Knowledge Format bundle — one concept per page, plain markdown with YAML frontmatter.`,
  alternates: { canonical: "/okf" },
};

const FRANCHISES = ["pokemon", "one-piece"] as const;

export default function OkfIndexPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Open Knowledge Format</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        A markdown bundle, one concept per page, with YAML frontmatter identifying its type, source, and how long
        its content stays fresh. Each concept mirrors a canonical HTML page on {SITE_NAME}.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        Machine-readable:{" "}
        <a href="/okf/index.md" className="underline underline-offset-4 hover:text-foreground">
          /okf/index.md
        </a>{" "}
        · Open Knowledge Format v0.2
      </p>

      <div className="mt-8 space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Site</h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              <a href="/okf/home" className="underline underline-offset-4 hover:text-foreground">
                Home
              </a>
            </li>
            <li>
              <a href="/okf/about" className="underline underline-offset-4 hover:text-foreground">
                About
              </a>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Collections</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {FRANCHISES.map((franchise) => (
              <li key={franchise}>
                <a href={`/okf/collections/${franchise}`} className="underline underline-offset-4 hover:text-foreground">
                  {franchiseLabel(franchise)}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Cards ({cardRefs.length})</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {cardRefs.map((ref) => (
              <li key={ref.slug}>
                <a href={`/okf/products/${ref.slug}`} className="underline underline-offset-4 hover:text-foreground">
                  {ref.displayName}
                </a>{" "}
                <span className="text-muted-foreground">— {franchiseLabel(ref.franchise)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
