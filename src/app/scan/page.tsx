import type { Metadata } from "next";
import Link from "next/link";
import { ScanClient } from "@/app/scan/scan-client";

/**
 * Scan a card — the camera end of the lookup.
 *
 * PHASE 5 OF docs/free-tier-catalogue.md, and deliberately the thinnest phase
 * of the six. The pipeline is capture → read → match → choose → store, and
 * Phase 4 already shipped match/choose against a text box. All that is added
 * here is capture and read: the camera fills the same field, and everything
 * downstream is the code path `/lookup` has been serving since.
 *
 * THE PAGE IS A STATIC SHELL; the reading happens in /api/scan/ocr, which is
 * metered and declared as such in scripts/check-free-tier.mts. This route has
 * no data loader in its import graph at all — the client component posts a
 * photo and renders what comes back.
 *
 * The photo is downscaled in the browser, sent once, read, and not stored.
 */

// One year. The page is a shell; nothing in it is data.
export const revalidate = 31536000;

export const metadata: Metadata = {
  title: "Scan a card",
  description:
    "Photograph a Pokémon or One Piece card, we read its code, and you get every printing of it.",
  alternates: { canonical: "/scan" },
};

export default function ScanPage() {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-6 py-6 pb-24">
      <div className="mb-2">
        <h1 className="text-[32px] font-black tracking-[-0.8px]">Scan a card</h1>
        <p className="mt-1 text-sm text-muted-text">
          Photograph the card and we read its code. The photo is sent once, read, and not kept.
        </p>
      </div>

      <p className="mt-4 rounded-lg border-2 border-black bg-muted-surface p-3 text-xs">
        Get the <b>bottom corner</b> in frame — that is where the code sits. One Piece cards carry something like{" "}
        <b>OP05-119</b>; Pokémon cards carry a printed number like <b>190/182</b>. The photo is sent once, read, and
        not stored. You can always{" "}
        <Link href="/lookup" className="font-black underline underline-offset-4">
          type the code instead
        </Link>
        .
      </p>

      <ScanClient />
    </main>
  );
}
