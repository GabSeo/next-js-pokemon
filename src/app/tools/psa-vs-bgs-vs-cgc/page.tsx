import type { Metadata } from "next";
import { ComingSoon } from "@/components/retro/coming-soon";

export const metadata: Metadata = {
  title: "PSA vs BGS vs CGC",
  description: "Compare pricing and premiums across grading companies — coming soon.",
};

export default function PsaVsBgsVsCgcPage() {
  return (
    <ComingSoon
      eyebrow="Grade with Confidence"
      title="PSA vs BGS vs CGC"
      description="Compare pricing, turnaround, and premiums across grading companies."
      dataNote="needs multi-grader sold-price data (PSA/BGS/CGC/SGC), which the current data source doesn't provide yet."
    />
  );
}
