import { Button } from "@/components/ui/button";
import { cardRefs } from "@/data/card-refs";

type PriceCheckerFormProps = {
  defaultValue?: string;
};

// Real example slugs instead of made-up ones, so the placeholder and the
// hint text are actually valid queries, not just plausible-looking text.
const EXAMPLE_SLUGS = cardRefs.slice(0, 2).map((r) => r.slug).join(" or ");

/**
 * Real <form> with a GET method — works with zero client JS. The target
 * page reads `cardId` from searchParams server-side, so an agent that never
 * executes JavaScript can still "use" this tool by submitting the form or
 * calling /tools/price-checker?cardId=... / /api/price-check?cardId=...
 * directly. See PLAN.md §5.
 *
 * Deliberately not `required`: submitting with an empty cardId is a valid
 * way to reach the "Available card IDs" list on the target page, not an
 * error — required would block that intentional browse-all path.
 */
export function PriceCheckerForm({
  defaultValue,
}: PriceCheckerFormProps) {
  return (
    <form
      role="search"
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
        minLength={2}
        maxLength={64}
        aria-describedby="cardId-hint"
        defaultValue={defaultValue}
        placeholder={`Card ID, e.g. ${EXAMPLE_SLUGS}`}
        className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <p id="cardId-hint" className="sr-only">
        Enter a card slug, name, number, or numeric id — for example {EXAMPLE_SLUGS}. Leave blank and submit to see every available card ID.
      </p>
      <Button type="submit" size="sm">
        Check price
      </Button>
    </form>
  );
}
