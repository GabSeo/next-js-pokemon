# CardTrace design system

Adapted from 099 SUPPLY (https://styles.refero.design/style/e4a7b5f3-f393-4f6d-b4a5-ecf874024bed) onto the existing shadcn/Tailwind v4 token architecture in [globals.css](src/app/globals.css). The system critic checks every rendered page against this file — nothing here is aspirational, it's what the codebase must actually match.

## Hard rule — no-JS visibility (overrides the reference on this point)

The reference imposes no constraint here; CardTrace does. Every price, date, name, and label an AI agent needs must be present in server-rendered HTML with JavaScript disabled. `motion` (installed, currently unused) may only ever animate a layer that is **additive** — e.g. a hover tooltip whose data already exists elsewhere on the page (JSON/Markdown mirrors, a visible tab). It must never gate the initial visibility of primary content (a price, a line on a chart, a label) behind a client-side animation state. This was already violated once and reverted — see [price-chart.tsx:109-117](src/components/price-chart.tsx#L109).

## Colors

Structure (background, ink, borders) stays monochrome, straight from 099 SUPPLY. Chroma is deliberate, not accidental: CardTrace's one chromatic palette is a fixed three-color triad referencing the classic color-named Pokémon game versions — **FireRed, Sapphire, Emerald**. No hue outside this triad is permitted anywhere on the site.

**Monochrome structure** — mapped onto the existing `--color-*` variable names (values below are the target; current values are shadcn's default oklch grays and differ slightly):

| Token | Value | Role |
|---|---|---|
| `--background` | `#ffffff` | Page background, card surfaces — the gallery wall |
| `--foreground` | `#101010` | Primary headings, body text, icon fills |
| `--muted-foreground` | `#555555` | Secondary/supporting copy |
| `--border` | `#e0e0e0` | Default hairline — card edges, dividers (default state) |
| *(new)* `--border-hover` | `#999999` | Hover border state |
| *(new)* `--border-emphasis` | `#101010` | Strong-emphasis border |
| `--card` | `#ffffff` | Card surface (flat, no shadow) |
| `--primary` | `#101010` | Button fill |
| `--primary-foreground` | `#ffffff` | Button label |

**The FireRed / Sapphire / Emerald triad** — already in the codebase as the price-trend palette in [price-chart.tsx](src/components/price-chart.tsx) (dataviz-skill validated, same hex on light and dark surfaces). Reused as-is, not re-derived, and its role widens from "trend chart only" to the site's one deliberate chromatic system:

| Token | Value | Game reference | Roles |
|---|---|---|---|
| `COLOR_FIRERED` (was `COLOR_CRITICAL`) | `#d03b3b` | Pokémon FireRed | Bearish trend; reserved as the "hot/attention" accent |
| `COLOR_SAPPHIRE` (was `COLOR_STABLE`) | `#2a78d6` | Pokémon Sapphire | Stable trend; primary interactive accent (links, active tab, focus) |
| `COLOR_EMERALD` (was `COLOR_GOOD`) | `#0ca30c` | Pokémon Emerald | Bullish trend; "good/confirmed" accent |
| `COLOR_NEUTRAL` | `#898781` | — | No-trend-data / inactive state |

Usage rule: the triad may appear on trend signals (as today), franchise/category identity (e.g. distinguishing Pokémon vs. One Piece tags), and primary interactive accents (active states, focus rings, one CTA per screen) — never as arbitrary decoration, never more than the triad's three hues, and never diluted into tints/shades that read as a fourth color. If a piece seems to need a color outside this set, that's a signal to come back and re-open this decision, not to add one quietly.

## Typography

**One typeface, everywhere.** Geist Mono is already loaded in [layout.tsx](src/app/layout.tsx) as `--font-geist-mono` — no new font dependency needed. It becomes the *only* face: `--font-sans` and `--font-heading` both resolve to it, replacing Geist Sans for body and headings alike (matching the reference's "mono is non-negotiable, used for every heading, body, badge, link, icon, and label").

Weight 400 by default. Weight 500 reserved for exactly one heading tier (the Section label, 26px, fixed — see below) — never on body text, never stacked with a second 500-weight tier at a different size on the same screen. This is a rule about not having two *competing* named tiers, not about a single tier scaling responsively.

¹ The Display tier (H1, weight 400) is the one deliberate exception to "one fixed size": it scales across three breakpoints — `40px` (mobile) → `48px` (`sm:`) → `54px` (`lg:`) — identically on every page that uses it. This is still one tier (one weight, one tracking, one role), just fluid, because a page title fixed at 54px would overflow or wrap badly on a narrow viewport, and 099 SUPPLY's reference has no page shell to make that tradeoff against. The Section-label tier (weight 500) has no such exception: it must render at the same fixed 26px on every viewport, because that's the tier the "never mix section heading style" rule actually governs.

| Style | Size | Weight | Line-height | Tracking | Case |
|---|---|---|---|---|---|
| Display (hero h1) | 40px → 48px → 54px¹ | 400 | 1.0 | 0.025em | Sentence |
| Section label | 26px | 500 | 1.2 | 0.18em | UPPERCASE |
| Body | 16px | 400 | 1.2 | normal | Sentence |
| Badge / tab label | 12px | 400 | 1.2 | 0.08em | UPPERCASE |
| Caption / meta | 10px | 400 | 1.2 | 0.02em | Sentence |

## Spacing

099 SUPPLY documents exactly two spacing *tokens* — Section gap and Element gap — because its reference is a gallery of isolated component tiles with no page shell to speak of. CardTrace is a real multi-section product, so the rule below has the same two tokens but a stated scope: it governs page rhythm, not every pixel of padding on the site.

**Rhythm (bound by the two-token rule — no third value invented here):**

- **Section gap:** exactly 80px between major page sections (hero → card grid → "how it works", product's chart → data tabs → alerts, etc.). Where a section is introduced with a `border-t` divider, the divider itself carries the full 80px — don't stack an additional top-padding value on top of it (e.g. an `mt-20` gap plus a separate `pt-8` after the border is two rhythm values pretending to be one; collapse to a single 80px gap).
- **Element gap:** exactly 12px between elements grouped within one section — a heading and the paragraph under it, a breadcrumb and the H1 below it, items in a stack. Any smaller ad hoc gap here (8px, 16px, 24px) that isn't actually a section transition should collapse to 12px.

**Not bound by the two-token rule (a separate, legitimate category):**

- Page-shell container padding (`mx-auto max-w-* px-4 py-12`-style wrapper margins) — every page needs edge margins; the reference never specifies this because it has no page shell.
- Component-internal padding (button/input/card interior padding, icon-to-label gaps inside one small component) — ordinary Tailwind spacing is fine here.

If you're unsure which category a given gap falls into: does it separate two sections/elements from each other (rhythm — must be 80 or 12), or does it sit *inside* one component/container (padding — unrestricted)? That question resolves it.

## Border radius

Two values only, replacing the current uniform `--radius` scale:

- **Buttons:** `9999px` (full pill)
- **Cards / tiles / inputs:** `8px`

No radius between 8px and 9999px appears anywhere.

## Shadows

None. `--shadow-*` utilities are not used. All depth comes from the border tokens above (`--border`, `--border-hover`, `--border-emphasis`).

## Dark mode

The reference is light-only. CardTrace's existing `.dark` block in globals.css stays as the inverse of this same token set (swap `--background`/`--foreground`, keep the trend-status colors identical in both modes since they're validated for both light and dark surfaces already — see the dataviz-skill comment in price-chart.tsx).
