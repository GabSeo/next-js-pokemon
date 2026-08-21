import type { Metadata } from "next";
import { ComingSoon } from "@/components/retro/coming-soon";

export const metadata: Metadata = {
  title: "When to Grade",
  description: "Market signals that tell you grading makes sense — coming soon.",
};

export default function WhenToGradePage() {
  return (
    <ComingSoon
      eyebrow="Grade with Confidence"
      title="When to Grade"
      description="Learn the market signals that tell you grading makes sense."
      dataNote="needs graded-card sales history to compute signals from — not available in the current data source yet."
    />
  );
}
