/**
 * Pokémon TCG energy-type colors — the TCG's own 11-type set, not the video
 * games' 18-type chart. Confirmed against real TCGdex card responses
 * (`types` returns "Darkness" and "Fire", not "Dark"/"Fire"): the TCG uses
 * "Lightning" instead of Electric, "Metal" instead of Steel, "Darkness"
 * instead of Dark, has no Bug/Flying/Ghost/Ground/Ice/Normal/Poison/Rock —
 * everything outside these 11 collapses into "Colorless". Colors are a
 * flat, black-bordered adaptation of the familiar type-chart palette (not a
 * glossy 3D pill) to match this site's existing badge style.
 */
export const POKEMON_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  Grass: { bg: "#4e9a51", text: "#ffffff" },
  Fire: { bg: "#e0562f", text: "#ffffff" },
  Water: { bg: "#4f86c6", text: "#ffffff" },
  Lightning: { bg: "#f0c419", text: "#1a1a1a" },
  Psychic: { bg: "#e5588a", text: "#ffffff" },
  Fighting: { bg: "#8a5138", text: "#ffffff" },
  Darkness: { bg: "#4a4256", text: "#ffffff" },
  Metal: { bg: "#a3a9b0", text: "#1a1a1a" },
  Fairy: { bg: "#ee9ed6", text: "#1a1a1a" },
  Dragon: { bg: "#6f4fc4", text: "#ffffff" },
  Colorless: { bg: "#c7c5a8", text: "#1a1a1a" },
};

/** Falls back to a neutral grey for any type name not in the TCG's own 11 (shouldn't happen for a real TCGdex response, but keeps a bad value from breaking rendering). */
export function pokemonTypeColor(type: string): { bg: string; text: string } {
  return POKEMON_TYPE_COLORS[type] ?? { bg: "#d9d9d9", text: "#1a1a1a" };
}
