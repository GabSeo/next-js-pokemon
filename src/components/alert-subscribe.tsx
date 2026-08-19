"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AlertBand } from "@/lib/types";

type AlertSubscribeProps = {
  cardId: string;
  currency: string;
  bands: AlertBand[];
};

export function AlertSubscribe({ cardId, currency, bands }: AlertSubscribeProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle"
  );

  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/price-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, email }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Get notified when the price crosses one of these bands (25% steps,
        from -75% to +150% of the current price):
      </p>
      <ul className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-5 lg:grid-cols-9">
        {bands.map((band) => (
          <li
            key={band.pct}
            className="rounded-md border border-border px-2 py-1.5 text-center"
          >
            <div
              className={
                band.pct < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
              }
            >
              {band.pct > 0 ? "+" : ""}
              {band.pct}%
            </div>
            <data value={String(band.price)} className="block text-muted-foreground">
              {currency} {band.price}
            </data>
          </li>
        ))}
      </ul>
      <form onSubmit={subscribe} className="flex max-w-sm items-center gap-2">
        <label htmlFor="alert-email" className="sr-only">
          Email address
        </label>
        <input
          id="alert-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button type="submit" size="sm" disabled={status === "sending"}>
          {status === "done" ? "Subscribed ✓" : "Notify me"}
        </Button>
      </form>
      {status === "error" && (
        <p className="text-xs text-destructive">
          Something went wrong — try again.
        </p>
      )}
    </div>
  );
}
