"use client";

import { useState } from "react";
import type { EbayCondition } from "@/lib/ebay-browse";

/**
 * All 4 condition panels are always rendered in the DOM (passed in as
 * already-server-rendered `content`) — only the active one is visible, via
 * the `hidden` attribute. Same pattern as components/price-data-tabs.tsx:
 * an AI crawler reading raw HTML sees every tier regardless of which tab a
 * human has open, and switching tabs is a pure client-side state change,
 * not a fetch.
 */
export function GradedMarketTabs({
  tabs,
}: {
  tabs: { id: EbayCondition; label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState<EbayCondition>(tabs[0].id);

  return (
    <div>
      <div role="tablist" aria-label="Condition" className="flex flex-wrap gap-1 border-b-2 border-black">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={`-mb-0.5 border-b-4 px-3.5 py-2.5 text-xs font-black tracking-[0.35px] uppercase transition-colors ${
              active === tab.id
                ? "border-pokemon-red text-foreground"
                : "border-transparent text-muted-text hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {tabs.map((tab) => (
          <section key={tab.id} role="tabpanel" hidden={active !== tab.id}>
            {tab.content}
          </section>
        ))}
      </div>
    </div>
  );
}
