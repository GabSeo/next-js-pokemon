import type { Metadata } from "next";
import { CollectionList } from "@/components/collection-list";

/**
 * The cards you own.
 *
 * This was a "coming soon" placeholder whose own note said the add button
 * "already saves card IDs locally — this page will read that list next". It now
 * does, and the list it reads holds PRINTINGS rather than cards, which is the
 * change that made the page worth building: a collection of card ids cannot say
 * whether you own the EUR 0.04 Exeggcute or the EUR 0.15 one, and a page
 * rendering that would look complete while being wrong.
 *
 * FREE, AND COSTS NOTHING TO RENDER. The page is a static shell; the list is
 * read from localStorage in the browser. No metered call is reachable from
 * here, which `scripts/check-free-tier.mts` enforces rather than trusts.
 *
 * NO VALUATION, deliberately — see components/collection-list.tsx.
 */

// One year. The shell never changes; its contents live in the visitor's browser.
export const revalidate = 31536000;

export const metadata: Metadata = {
  title: "My Collection",
  description: "The card printings you own, saved in your browser.",
  alternates: { canonical: "/collection" },
};

export default function CollectionPage() {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-6 py-6 pb-24">
      <div>
        <h1 className="text-[32px] font-black tracking-[-0.8px]">My Collection</h1>
        <p className="mt-1 text-sm text-muted-text">
          The exact printings you own — not just which cards, but which version of each.
        </p>
      </div>

      <CollectionList />
    </main>
  );
}
