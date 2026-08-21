import type { Metadata } from "next";
import { ComingSoon } from "@/components/retro/coming-soon";

export const metadata: Metadata = {
  title: "Set EV Calculator",
  description: "Crunch the expected value of a booster box — coming soon.",
};

export default function SetEvCalculatorPage() {
  return (
    <ComingSoon
      eyebrow="Invest Smarter"
      title="Set EV Calculator"
      description="Crunch the expected value of a booster box before you rip a single pack."
      dataNote="sealed-product pricing per set isn't wired into the catalog yet — only single cards resolve today."
    />
  );
}
