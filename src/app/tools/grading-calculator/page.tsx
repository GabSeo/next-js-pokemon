import type { Metadata } from "next";
import { ComingSoon } from "@/components/retro/coming-soon";

export const metadata: Metadata = {
  title: "Grading Calculator",
  description: "Find out if grading your card is worth the fee — coming soon.",
};

export default function GradingCalculatorPage() {
  return (
    <ComingSoon
      eyebrow="Grade with Confidence"
      title="Grading Calculator"
      description="Find out if grading your card is actually worth the fee."
      dataNote="needs graded-vs-raw price deltas, which the current data source doesn't provide yet."
    />
  );
}
