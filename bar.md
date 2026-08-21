# Craft bar — extracted from 099 SUPPLY (styles.refero.design)

Source: https://styles.refero.design/style/e4a7b5f3-f393-4f6d-b4a5-ecf874024bed
Screenshot on file, homepage + token panel, captured 2026-08-21.

Checkable mechanisms. The craft critic checks the rendered page against these, nothing else.

1. **Structure is monochrome; chroma is the fixed FireRed/Sapphire/Emerald triad, nothing else.** `#101010` (near-black) is the only color used for headings, body text, borders, and icon fills. The one chromatic system on the whole site is the three-color triad defined in `design-system.md` (trend signals, franchise identity, interactive accents) — no hue outside that triad appears anywhere.
2. **Every non-body text style is uppercase with tracking.** Section headings, badges, labels, and metadata strips render uppercase, letter-spacing between 0.02em and 0.18em. Body copy stays sentence case.
3. **Exactly one typeface family, weight 400 by default.** Every heading, label, badge, button, and body string uses the same monospace family. Weight 500 appears in at most one heading tier — never on body text, never on two different tiers at once.
4. **Zero shadows.** No `box-shadow`, no `drop-shadow`, no elevation effect anywhere. All depth comes from 1px hairline borders: `#e0e0e0` default, `#999999` on hover, `#101010` for strong emphasis.
5. **Two border-radius values, nothing between them.** Buttons render at pill radius (9999px). Cards and tiles render at 8px. No component uses an in-between radius.
6. **One large gap, one small gap.** Major sections are separated by a wide gap (~80px); elements within a section use a tight gap (~12px). No third, invented spacing value between the two.
7. **Numbers align in columns.** Every price, date, or metric renders in tabular-nums so digits line up vertically wherever two or more appear stacked (price history rows, trend windows, calculator outputs).

## Resolved tension with the reference

099 SUPPLY's own rule is "never introduce chromatic color — no blues, greens, reds, or any hue." CardTrace deliberately breaks this one rule: the FireRed/Sapphire/Emerald triad (Pokémon game-version colors) is the site's chromatic identity, defined in `design-system.md`. Every other 099 SUPPLY mechanism above (mono type, hairline borders, zero shadow, fixed radii, fixed spacing) still applies at full strength.
