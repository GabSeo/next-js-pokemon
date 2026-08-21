import type { Metadata } from "next";
import { ComingSoon } from "@/components/retro/coming-soon";

export const metadata: Metadata = {
  title: "PSA Analysis",
  description: "Analyze PSA graded card values, population data, and ROI — coming soon.",
};

export default function PsaAnalysisPage() {
  return (
    <ComingSoon
      eyebrow="Grade with Confidence"
      title="PSA Analysis"
      description="Analyze PSA graded card values, population data, and ROI."
      dataNote="graded-card pricing isn't in the catalog's current data source — this needs a provider that tracks eBay/Cardmarket graded sales, still being evaluated."
    />
  );
}
