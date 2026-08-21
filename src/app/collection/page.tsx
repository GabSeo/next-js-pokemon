import type { Metadata } from "next";
import { ComingSoon } from "@/components/retro/coming-soon";

export const metadata: Metadata = {
  title: "My Collection",
  description: "Track what you own and watch your collection's value grow — coming soon.",
};

export default function CollectionPage() {
  return (
    <ComingSoon
      eyebrow="Track & Value"
      title="My Collection"
      description="Track what you own and watch your collection's value grow in real time."
      dataNote="the “add to collection” button already saves card IDs locally in your browser — this page will read that list and show live totals next."
    />
  );
}
