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
 * The artwork is matched in the browser against 41,500 reference vectors and the
 * photo never leaves the device. Only an unclear picture is downscaled, sent
 * once to be read for its printed code, and not stored.
 */

// One year. The page is a shell; nothing in it is data.
export const revalidate = 31536000;

export const metadata: Metadata = {
  title: "Scan a card",
  description:
    "Photograph a Pokémon or One Piece card, we recognise it on your device, and you get every printing of it.",
  alternates: { canonical: "/scan" },
};

export default function ScanPage() {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-6 py-7 pb-24">
      {/* THE INSTRUCTIONS MOVED INTO THE STEPS. A paragraph explaining the
          whole pipeline stood here — which catalogue to pick, how to hold the
          card, what happens when the artwork fails, where the printed code is —
          and every sentence of it now sits inside the numbered panel it
          describes, where it is read at the moment it applies rather than
          before any of it is relevant. */}
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex max-w-[620px] flex-col gap-2">
          <span className="text-[11px] font-black uppercase tracking-[1px] text-muted-text">
            Tools · Identify
          </span>
          <h1 className="text-[40px] font-black leading-[42px] tracking-[-1.1px]">Scan a card</h1>
          <p className="text-[15px] leading-[22px] text-muted-text">
            Artwork is matched on your device. The photo only leaves your phone if that fails and we fall back
            to reading the printed code — or you can{" "}
            <Link href="/lookup" className="font-black underline underline-offset-4">
              type it instead
            </Link>
            .
          </p>
        </div>
        {/* THE PRIVACY CLAIM AS A BADGE, because it is the single most
            surprising thing about this feature and it was buried mid-paragraph.
            The pulsing dot is the only decoration on it and it is earned: the
            matcher genuinely is running locally. */}
        <span
          className="inline-flex items-center gap-2 rounded-full border-2 border-foreground px-3.5 py-2 text-[11px] font-black tracking-[0.6px]"
          style={{
            background: "color-mix(in srgb, var(--success-green) 14%, white)",
            color: "#0a5c2c",
            boxShadow: "3px 3px 0 0 #000",
          }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--success-green)", animation: "livepulse 2s ease-in-out infinite" }}
          />
          ON-DEVICE · NOTHING UPLOADED
        </span>
      </header>

      <ScanClient />
    </main>
  );
}
