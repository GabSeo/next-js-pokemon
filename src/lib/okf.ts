import { findCard, getAllCards, getCardBySlug, getCardsByFranchise, franchiseLabel } from "@/lib/cards";
import {
  cardToMarkdown,
  collectionToMarkdown,
  homepageMarkdown,
  priceCheckResultMarkdown,
  priceCheckerMarkdown,
} from "@/lib/markdown";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/site";
import type { Franchise } from "@/lib/types";

/**
 * Open Knowledge Format v0.2 (Google Cloud, June 2026) — a markdown bundle,
 * one concept per page, YAML frontmatter on top of the same clean markdown
 * lib/markdown.ts already generates for the .md mirrors. That's the whole
 * reason this is cheap here: most sites building OKF have to solve "turn my
 * HTML into clean markdown" first. CardTrace solved that months ago.
 */

type OkfConceptType = "WebSite" | "AboutPage" | "CollectionPage" | "Product" | "WebApplication";

type OkfFrontmatter = {
  type: OkfConceptType;
  title: string;
  description: string;
  resource: string;
  tags: string[];
  generated: { by: string; at: string };
  stale_after: string;
};

// Machine-attributed, not "human:<name>" — the actual payload of every
// price-driven concept is live-fetched from apitcg.com, not authored prose.
// Suganthan's own honesty rule for v0.2 applies in reverse here: claiming a
// human wrote numbers a script fetched would be the inflation the field
// exists to catch.
const GENERATED_BY = "system:cardtrace-build";

/**
 * How long a concept carrying market data stays valid, in seconds.
 *
 * MUST match `export const revalidate` on the routes that serve this content
 * (`products/[slug]/page.tsx`, `products/[slug]/index.md/route.ts`,
 * `collections/[franchise]/page.tsx` — all 86400). Next requires a literal
 * for that export and statically parses it, so it cannot be imported from
 * here; this is a deliberate mirror, and drifting from it is exactly the bug
 * this constant was introduced to fix.
 *
 * That bug: every price-bearing concept promised `stale_after = now + 7 days`
 * against a 24-hour window, overstating freshness by 7x. It was the only
 * machine-readable freshness claim the site made, so an agent honouring it
 * would cache a day-old price for a week.
 */
const CONTENT_REVALIDATE_SECONDS = 86_400;

/**
 * For concepts whose text is hand-written and does not carry market data —
 * the about page, the price-checker's cardless form. These genuinely change
 * on the order of months, and claiming a day would send agents back for
 * nothing.
 */
const STATIC_CONCEPT_SECONDS = 180 * 24 * 60 * 60;

/**
 * Full ISO timestamp, not a date. A date-only `stale_after` is useless at a
 * 24-hour window: "2026-08-31" is anywhere from 0 to 24 hours away depending
 * on when it is read, so an agent cannot tell whether the copy it holds is
 * still valid.
 */
function staleAfter(from: Date, seconds: number): string {
  return new Date(from.getTime() + seconds * 1000).toISOString();
}

function withFrontmatter(fm: OkfFrontmatter, body: string): string {
  const tagsYaml = fm.tags.map((t) => `"${t}"`).join(", ");
  return `---
type: "${fm.type}"
title: "${fm.title.replace(/"/g, '\\"')}"
description: "${fm.description.replace(/"/g, '\\"')}"
resource: "${fm.resource}"
tags: [${tagsYaml}]
generated: { by: "${fm.generated.by}", at: "${fm.generated.at}" }
stale_after: ${fm.stale_after}
---

${body}`;
}

export async function okfHomeConcept(): Promise<string> {
  const now = new Date();
  const body = await homepageMarkdown();
  return withFrontmatter(
    {
      type: "WebSite",
      title: `${SITE_NAME} — Pokémon & One Piece card prices`,
      description: SITE_DESCRIPTION,
      resource: absoluteUrl("/"),
      tags: ["pokemon", "one-piece", "tcg", "price-tracking"],
      generated: { by: GENERATED_BY, at: now.toISOString() },
      // Price-driven concept — days, not months, matching the 24h Data
      // Cache reality rather than the evergreen cadence a blog post gets.
      stale_after: staleAfter(now, CONTENT_REVALIDATE_SECONDS),
    },
    body
  );
}

export async function okfAboutConcept(): Promise<string> {
  const now = new Date();
  const body = `# About ${SITE_NAME}

${SITE_NAME} is a prototype card catalog for Pokémon and One Piece trading cards, built to demonstrate a commerce site that is equally legible to human visitors and AI agents.

Every product, collection, and tool page on this site ships as three synchronized representations: an HTML page for people, a Markdown mirror, and a JSON endpoint — all generated from the same underlying data, so none of them can drift out of sync.

This is a demo built with generic product data. It is not a real business, and pricing figures are placeholder values.
`;
  return withFrontmatter(
    {
      type: "AboutPage",
      title: `About ${SITE_NAME}`,
      description: `What ${SITE_NAME} is and how its data is structured.`,
      resource: absoluteUrl("/about"),
      tags: ["about"],
      generated: { by: GENERATED_BY, at: now.toISOString() },
      // Genuinely evergreen prose, not price data — a longer window here is
      // honest, not lazy, the mirror image of the 7-day window above.
      stale_after: staleAfter(now, STATIC_CONCEPT_SECONDS),
    },
    body
  );
}

export async function okfCollectionConcept(franchise: Franchise): Promise<string> {
  const now = new Date();
  const label = franchiseLabel(franchise);
  const body = await collectionToMarkdown(franchise);
  const cards = await getCardsByFranchise(franchise);
  return withFrontmatter(
    {
      type: "CollectionPage",
      title: `${label} collection`,
      description: `${cards.length} tracked ${label} cards with current price and history.`,
      resource: absoluteUrl(`/collections/${franchise}`),
      tags: [franchise, "tcg", "collection"],
      generated: { by: GENERATED_BY, at: now.toISOString() },
      stale_after: staleAfter(now, CONTENT_REVALIDATE_SECONDS),
    },
    body
  );
}

export async function okfProductConcept(slug: string): Promise<string | undefined> {
  const card = await getCardBySlug(slug);
  if (!card) return undefined;
  const now = new Date();
  const body = await cardToMarkdown(card);
  return withFrontmatter(
    {
      type: "Product",
      title: `${card.name} — ${card.set}`,
      description: card.description ?? `${card.name} — ${card.set} (${card.number ?? ""}).`,
      resource: absoluteUrl(`/products/${card.slug}`),
      tags: [card.franchise, "tcg", card.rarity ?? ""].filter(Boolean),
      generated: { by: GENERATED_BY, at: now.toISOString() },
      stale_after: staleAfter(now, CONTENT_REVALIDATE_SECONDS),
    },
    body
  );
}

export async function okfPriceCheckerConcept(cardId?: string): Promise<string> {
  const now = new Date();
  const card = cardId ? await findCard(cardId) : undefined;
  const body = card
    ? await priceCheckResultMarkdown(card)
    : await priceCheckerMarkdown();

  return withFrontmatter(
    {
      type: "WebApplication",
      title: card ? `Price checker — ${card.name}` : "Price checker",
      description: card
        ? `Current price, alert bands, and history for ${card.name} via the ${SITE_NAME} price checker.`
        : "Look up any tracked card by ID to see current price, history, and alert bands.",
      resource: absoluteUrl(`/tools/price-checker${cardId ? `?cardId=${cardId}` : ""}`),
      tags: ["tool", "price-checker"],
      generated: { by: GENERATED_BY, at: now.toISOString() },
      // Only price-driven once a card is resolved — the bare tool index (no
      // cardId) is just a list of IDs, as evergreen as the About page.
      stale_after: staleAfter(now, card ? CONTENT_REVALIDATE_SECONDS : STATIC_CONCEPT_SECONDS),
    },
    body
  );
}

/** Bundle table of contents — lists every concept before an agent opens any of them, matching the convention Google's own spec examples use. */
export async function okfIndex(): Promise<string> {
  const cards = await getAllCards();
  const cardLines = cards
    .map((c) => `- [${c.name}](${absoluteUrl(`/okf/products/${c.slug}`)}) — ${franchiseLabel(c.franchise)}`)
    .join("\n");

  return `# ${SITE_NAME} — Open Knowledge Format bundle

One concept per page, plain markdown with YAML frontmatter, cross-linked back to the canonical HTML page each one mirrors.

## Site

- [Home](${absoluteUrl("/okf/home")})
- [About](${absoluteUrl("/okf/about")})
- [Price checker](${absoluteUrl("/okf/tools/price-checker")})

## Collections

- [Pokémon](${absoluteUrl("/okf/collections/pokemon")})
- [One Piece](${absoluteUrl("/okf/collections/one-piece")})

## Cards (${cards.length})

${cardLines}
`;
}
