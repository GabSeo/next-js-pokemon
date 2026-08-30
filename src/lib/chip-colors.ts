/**
 * One small, deliberately restrained color language for the Market Overview
 * panel's chips, rather than each chip system inventing a competing palette
 * — deal quality, Vinted condition and the Live/Preview data badge all share
 * the same green "good" read and the same neutral grey.
 *
 * Kept as resolved hex rather than theme utility classes because these are
 * chip *tints*, one step lighter than any --color-* token in the theme, and
 * the paired text shade is chosen for contrast at 10-11px, not just borrowed
 * from the nearest brand color.
 *
 * Lifted out of vinted-listings-section.tsx when the data badge moved into
 * components/retro/market-data-badge.tsx: the badge renders directly above
 * rows wearing these exact tints, so a second hand-picked green there would
 * have been visible as a mismatch within one box.
 */
export const CHIP_COLORS = {
  green: { bg: "#e9f8ee", text: "#1f9d55" },
  amber: { bg: "#fbf1e3", text: "#a15c0c" },
  grey: { bg: "#f4f5f8", text: "#6b7280" },
} as const;
