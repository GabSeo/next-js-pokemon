import type { Metadata } from "next";
import { ComingSoon } from "@/components/retro/coming-soon";

export const metadata: Metadata = {
  title: "Sealed Products",
  description: "Track booster box, ETB, and sealed product prices — coming soon.",
};

export default function SealedProductsPage() {
  return (
    <ComingSoon
      eyebrow="Invest Smarter"
      title="Sealed Products"
      description="Track booster box, ETB, and sealed product prices over time."
      dataNote="sealed-product tracking isn't wired into the catalog yet — only single cards resolve today."
    />
  );
}
