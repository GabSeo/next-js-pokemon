import type { Metadata } from "next";
import { ComingSoon } from "@/components/retro/coming-soon";

export const metadata: Metadata = {
  title: "Price Guides",
  description: "Complete price guides for every Pokémon set — coming soon.",
};

export default function PriceGuidesPage() {
  return (
    <ComingSoon
      eyebrow="Track & Value"
      title="Price Guides"
      description="Complete price guides for every Pokémon set, from Base to the latest drop."
      dataNote="a per-set price index isn't built yet — today only individually tracked cards resolve to live prices."
    />
  );
}
