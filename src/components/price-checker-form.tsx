import { Button } from "@/components/ui/button";

type PriceCheckerFormProps = {
  defaultValue?: string;
  compact?: boolean;
};

/**
 * Real <form> with a GET method — works with zero client JS. The target
 * page reads `cardId` from searchParams server-side, so an agent that never
 * executes JavaScript can still "use" this tool by submitting the form or
 * calling /tools/price-checker?cardId=... / /api/price-check?cardId=...
 * directly. See PLAN.md §5.
 */
export function PriceCheckerForm({
  defaultValue,
  compact,
}: PriceCheckerFormProps) {
  return (
    <form
      action="/tools/price-checker"
      method="GET"
      className="flex w-full max-w-md items-center gap-2"
    >
      <label htmlFor="cardId" className="sr-only">
        Card ID
      </label>
      <input
        id="cardId"
        name="cardId"
        type="text"
        defaultValue={defaultValue}
        placeholder="Card ID, e.g. base1-4 or op01-025"
        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <Button type="submit" size={compact ? "sm" : "default"}>
        Check price
      </Button>
    </form>
  );
}
