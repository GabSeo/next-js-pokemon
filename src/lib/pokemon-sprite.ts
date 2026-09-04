/**
 * Where a card's mascot sprite lives.
 *
 * Lifted out of vinted-listings-section.tsx when the Grade Analysis screen's
 * 38px asset slot needed the same sprite: two components resolving the same
 * filename by two copies of the same rule is exactly how the two drift.
 */

/**
 * Self-hosted copy of Pokémon Showdown's animated sprite for whichever
 * character this card depicts (Card.character — "Gengar", "Lugia",
 * "Typhlosion" for the cards tracked today), replacing the one static
 * gengar.gif every card's panel used to show regardless of which Pokémon
 * the page was actually about.
 *
 * Self-hosted under /public/pokemon-sprites rather than linked straight to
 * play.pokemonshowdown.com: confirmed live, Showdown serves these with
 * Cache-Control: max-age=691200 (8 days, not theirs to change for us) —
 * flagged by PageSpeed Insights as a real repeat-visit cost for an asset
 * that never changes. Serving our own copy from /public gets Vercel's
 * standard far-future immutable caching instead (see next.config.ts).
 *
 * Showdown's filenames are the character name lowercased with every
 * non-alphanumeric character stripped — confirmed against the three real
 * cases this site currently has (all single, plain words) and matching
 * Showdown's own documented convention for the harder ones ("Mr. Mime" ->
 * mrmime, "Ho-Oh" -> hooh, "Farfetch'd" -> farfetchd). Not exhaustively
 * verified against every regional form/gender-variant naming edge case —
 * <img>'s onError below hides the mascot entirely rather than showing a
 * broken-image icon if a given name doesn't resolve to a real sprite.
 *
 * Trade-off of self-hosting: a NEW character (a new card added later) needs
 * its sprite downloaded into /public/pokemon-sprites by hand before it'll
 * show — same one-time manual step lib/entitymap.ts's CHARACTER_ENTITIES
 * map already requires per new character, not a new maintenance pattern.
 * Until that file exists, onError just hides the mascot, same as today.
 *
 * Only ever called for Pokémon cards in practice: this mascot only renders
 * inside the Vinted "France" panel, which only ever gets real data (the
 * isReal gate this sits behind) for Pokémon refs — One Piece characters
 * like "Roronoa Zoro" would never reach this function today, but the
 * onError fallback means it wouldn't render a broken image if it ever did.
 */
export function pokemonShowdownSpriteUrl(character: string): string {
  const slug = character.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `/pokemon-sprites/${slug}.gif`;
}

/**
 * The roaming mascot in the Grade Analysis hero's comparison grid.
 *
 * ONE FILE FOR EVERY CARD, not the card's own character. The mascot is a
 * piece of interaction rather than a statement about the card — it chases the
 * cursor, it is decorative, and it is `aria-hidden`. Deriving it from
 * `Card.character` would have meant no mascot at all on every One Piece card
 * (no Showdown sprite exists for them) and a per-character asset to source
 * before any new card could show one, for a flourish that identifies nothing.
 */
export const MASCOT_SPRITE_URL = "/pokemon-sprites/interact.gif";
