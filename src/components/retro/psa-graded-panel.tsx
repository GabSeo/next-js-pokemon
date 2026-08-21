import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { illustrativePsaGraded } from "@/lib/illustrative";
import type { Card } from "@/lib/types";

const GRADE_CLASSES: Record<string, string> = {
  "PSA 10": "bg-success-green",
  "PSA 9": "bg-pokemon-blue",
  "PSA 8": "bg-pokemon-red",
};

export function PsaGradedPanel({ card }: { card: Card }) {
  const graded = illustrativePsaGraded(card);
  return (
    <div className="rounded-lg border-2 border-black bg-pokemon-yellow p-6 shadow-hard-md">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-black tracking-[0.6px] text-[#5a4600] uppercase">🏅 PSA Graded Prices</span>
        <IllustrativeTag />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {graded.map((g) => (
          <div key={g.grade} className="rounded-md border-2 border-black bg-white p-4 text-center shadow-hard-sm">
            <span
              className={`mb-2 inline-block rounded-full border-2 border-black px-3 py-1 text-xs font-black tracking-[0.35px] text-white ${GRADE_CLASSES[g.grade] ?? "bg-foreground"}`}
            >
              {g.grade}
            </span>
            <div className="text-2xl font-black tracking-[-0.5px] tabular-nums">
              {card.currency} {g.price.toLocaleString()}
            </div>
            <div className="mt-1 text-xs font-bold text-muted-text">{g.sales} sales</div>
          </div>
        ))}
      </div>
    </div>
  );
}
