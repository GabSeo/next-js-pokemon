import type { Metadata } from "next";
import { ComingSoon } from "@/components/retro/coming-soon";

export const metadata: Metadata = {
  title: "Market Movers",
  description: "See which cards are trending — coming soon.",
};

export default function MarketMoversPage() {
  return (
    <ComingSoon
      eyebrow="Invest Smarter"
      title="Market Movers"
      description="See which cards are trending and which prices just spiked or dipped."
      dataNote="cross-catalog trend ranking isn't built yet — the homepage's Market Movers section shows illustrative sample rows only."
    />
  );
}
