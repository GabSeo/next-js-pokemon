import { ILLUSTRATIVE_CONDITIONS } from "@/lib/illustrative";

/**
 * Decorative condition chips from the mockup — Near Mint is the one real
 * condition apitcg.com's price history actually tracks, so it's the only
 * chip styled as active; the rest render inert (not clickable, no
 * `<button>`) since selecting them wouldn't change anything real yet.
 */
export function ConditionFilterChips() {
  return (
    <div className="mb-6 flex flex-wrap gap-3">
      {ILLUSTRATIVE_CONDITIONS.map((condition) => (
        <span
          key={condition}
          className={
            condition === "Near Mint"
              ? "rounded-full border-2 border-black bg-success-green px-3.5 py-1 text-xs font-black text-white"
              : "rounded-full border-2 border-black bg-white px-3.5 py-1 text-xs font-black text-muted-text opacity-50"
          }
        >
          {condition}
        </span>
      ))}
    </div>
  );
}
