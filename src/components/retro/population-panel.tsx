import { IllustrativeTag } from "@/components/retro/illustrative-tag";
import { illustrativePopulation } from "@/lib/illustrative";
import type { Card } from "@/lib/types";

export function PopulationPanel({ card }: { card: Card }) {
  const pop = illustrativePopulation(card);
  return (
    <div className="rounded-lg border-2 border-black bg-pokemon-yellow p-6 shadow-hard-md">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black tracking-[0.6px] text-[#5a4600] uppercase">👥 Population</span>
          <IllustrativeTag />
        </div>
        <div className="flex gap-1.5">
          {["BGS", "CGC", "PSA", "SGC"].map((g) => (
            <span key={g} className="rounded-full border-2 border-black bg-white px-2 py-0.5 text-[11px] font-black">
              {g}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-5 flex gap-10">
        <div>
          <div className="text-2xl font-black tabular-nums">{pop.total.toLocaleString()}</div>
          <div className="text-[11px] font-bold tracking-[0.35px] text-[#5a4600] uppercase">Total</div>
        </div>
        <div>
          <div className="text-2xl font-black text-pokemon-red tabular-nums">{pop.gemRatePct}%</div>
          <div className="text-[11px] font-bold tracking-[0.35px] text-[#5a4600] uppercase">Gem Rate</div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {pop.bars.map((bar) => (
          <div
            key={bar.grade}
            className="grid grid-cols-[24px_1fr_50px] items-center gap-3 rounded-sm border-2 border-black bg-white px-2 py-1"
          >
            <span className="text-sm font-black">{bar.grade}</span>
            <span className="h-2.5 overflow-hidden rounded-full border border-black bg-muted-surface">
              <span
                className={`block h-full ${bar.grade === "10" ? "bg-success-green" : "bg-pokemon-red"}`}
                style={{ width: `${bar.widthPct}%` }}
              />
            </span>
            <span className="text-right text-sm font-black tabular-nums">{bar.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
