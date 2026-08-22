import { pokemonTypeColor } from "@/lib/pokemon-types";

/**
 * `colorKey` and `label` are split because TCGdex localizes the type name
 * (e.g. French "Obscurité" for "Darkness") but the color palette in
 * lib/pokemon-types.ts is keyed by the canonical English name — so the
 * French product page passes the real English type as `colorKey` and the
 * translated text as `label`, same real-data-drives-logic /
 * localized-text-drives-display split used for name/set/rarity elsewhere.
 */
export function TypeBadge({ colorKey, label }: { colorKey: string; label: string }) {
  const { bg, text } = pokemonTypeColor(colorKey);
  return (
    <span
      className="rounded-full border-2 border-black px-3 py-1 text-xs font-black tracking-[0.35px] uppercase"
      style={{ backgroundColor: bg, color: text }}
    >
      {label}
    </span>
  );
}
