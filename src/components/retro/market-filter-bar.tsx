"use client";

import { flagSvgUrl, MARKET_LABEL, useProductLocaleOptional } from "@/components/product-locale";

/**
 * The page's one control: which market you are looking at.
 *
 * ONE AXIS, because the data only has one. A currency filter sat here briefly
 * and was removed: the currency is not a choice, it is a property of the market
 * — US is priced by American marketplaces in dollars, EU by Cardmarket in
 * euros, and offering the other one on either just gave a reader two routes to
 * the same wrong answer. The Japanese print is the single case genuinely
 * carried by both, and its view shows both at once instead of asking.
 *
 * ALWAYS VISIBLE, because it governs the whole page. It used to sit in the
 * Real-time market data heading and scroll away, so by the time a reader
 * reached the eBay tiers or the grading table there was no way to see what
 * state they were in, let alone change it.
 *
 * It rides in the breadcrumb row, which is the page-level line and where a
 * page-level control belongs. It briefly had a bar of its own, pinned under the
 * site header along with the breadcrumb and the identity strip; that came to
 * 250px of chrome before any content, and it went.
 *
 * The group label is desktop only; on a 375px screen it costs width to say what
 * the flags already say.
 */
export function MarketFilterBar() {
  const ctx = useProductLocaleOptional();
  if (!ctx || ctx.options.length === 0) return null;
  const { active, setActive, options } = ctx;

  return (
    <div className="flex items-center gap-3">
        <Group label="Market">
          {options.map((option) => (
            <Segment active={option.code === active} key={option.code} onClick={() => setActive(option.code)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- external CDN image, domain not allowlisted for next/image */}
              <img alt="" className="h-3 w-4 rounded-[1px] object-cover" src={flagSvgUrl(option.code)} />
              {MARKET_LABEL[option.code]}
            </Segment>
          ))}
        </Group>
    </div>
  );
}

/** A labelled cluster. The label is the axis; without it two rows of segments read as one long list of options. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-[10px] font-black tracking-[0.6px] text-muted-text uppercase sm:inline">{label}</span>
      <div aria-label={label} className="flex overflow-hidden rounded-md border-2 border-black" role="group">
        {children}
      </div>
    </div>
  );
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-black tracking-[0.3px] uppercase transition-colors not-first:border-l-2 not-first:border-black ${
        active ? "bg-pokemon-red text-white" : "bg-white text-foreground hover:bg-muted-surface"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
