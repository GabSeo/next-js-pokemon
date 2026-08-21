import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: `What ${SITE_NAME} is and how its data is structured.`,
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-[40px] font-normal leading-none tracking-[0.025em] sm:text-[48px] lg:text-[54px]">
        About {SITE_NAME}
      </h1>
      <div className="mt-3 space-y-3 text-base leading-[1.2] text-muted-foreground">
        <p>
          {SITE_NAME} is a prototype card catalog for Pokémon and One Piece
          trading cards, built to demonstrate a commerce site that is equally
          legible to human visitors and AI agents.
        </p>
        <p>
          Every product, collection, and tool page on this site ships as
          three synchronized representations: an HTML page for people, a
          Markdown mirror, and a JSON endpoint — all generated from the same
          underlying data, so none of them can drift out of sync. Look for
          the &ldquo;Open data for AI agents&rdquo; links near the top of any
          page.
        </p>
        <p>
          This is a demo built with generic product data. It is not a real
          business, and pricing figures are placeholder values.
        </p>
      </div>
    </div>
  );
}
