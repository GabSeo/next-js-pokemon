type OpenDataLinksProps = {
  markdownHref: string;
  jsonHref: string;
  /** Href of this page's matching OKF concept, when one exists. */
  okfHref?: string;
  className?: string;
};

/**
 * The look of the small machine-facing metadata rows that sit under the card
 * art — these links, and the card's own ID directly below them (see
 * product-page-content.tsx). They read as one block of facts about the page
 * rather than about the card's value, so they share a class instead of each
 * restating the same four utilities and drifting apart later.
 */
export const META_ROW_CLASS = "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground";

/**
 * Visible (not sr-only) links to the machine-readable mirrors of the current
 * page. Same URL and content for humans and bots — deliberately not hidden,
 * to stay clear of cloaking. See PLAN.md §4.2.
 */
export function OpenDataLinks({
  markdownHref,
  jsonHref,
  okfHref,
  className,
}: OpenDataLinksProps) {
  return (
    <div className={`${META_ROW_CLASS} ${className ?? ""}`}>
      <span>Open data for AI agents:</span>
      <a
        href={markdownHref}
        className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
      >
        Markdown
      </a>
      <a
        href={jsonHref}
        className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
      >
        JSON
      </a>
      {okfHref && (
        <a
          href={okfHref}
          className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
        >
          OKF
        </a>
      )}
    </div>
  );
}
