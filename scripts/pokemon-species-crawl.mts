#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * Every Pokemon species name in English, by National Pokedex number.
 *
 * WHY THIS EXISTS. Every label on this site is Latin, and TCGdex romanises only
 * SOME Japanese card names: `Gengar Ex` for PCG1-048, but `ナゾノクサ` for
 * SV4a-001. A Japanese card's label was therefore Japanese about half the time.
 *
 * A Pokedex number is the same integer in every language, and TCGdex publishes
 * it on Japanese cards too, so the English label is a LOOKUP rather than a
 * translation — no guessing, no matching, no second catalogue.
 *
 * ONE REQUEST, and it is the whole point of using this source: PokeAPI returns
 * all 1,025 species in a single unauthenticated call. It is free, public, needs
 * no key, and this runs by hand when a generation ships rather than per
 * request.
 *
 * A SPECIES IS NOT A CARD. `リザードンex` is Charizard with a suffix, and the
 * suffix is written in Latin on the card itself, so callers carry it across
 * from the card's own name rather than inventing it.
 *
 *   npm run catalog:pokemon-species
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const URL_ = "https://pokeapi.co/api/v2/pokemon-species/?limit=1200";

/**
 * The same species, named in Japanese AND English, in one GraphQL query.
 *
 * WHY BOTH. Labelling by Pokedex number covers most Japanese cards, but TCGdex
 * publishes no dex for 450 of them — `イーユイex`, `メガユキノオーex`,
 * `ブリガロンV` — and the official Japanese data has none either. Their NAME
 * still contains the species, so a Japanese-to-English species map labels them
 * without translating anything: it is the same lookup, keyed differently.
 *
 * language_id 1 is Japanese, 11 the katakana form card faces actually use, and
 * 9 English. One request for all three.
 */
const GRAPHQL = "https://graphql.pokeapi.co/v1beta2";
const QUERY =
  "{ pokemonspeciesname(where: {language_id: {_in: [1, 9, 11]}}) " +
  "{ name language_id pokemon_species_id } }";
const OUT_DIR = path.join(process.cwd(), "data", "catalog");

const response = await fetch(URL_, { headers: { Accept: "application/json" } });
if (!response.ok) {
  console.error(`[species] ${URL_} -> ${response.status}`);
  process.exit(1);
}

const parsed = (await response.json()) as { count?: number; results?: { name?: string }[] };
const names: Record<number, string> = {};

(parsed.results ?? []).forEach((entry, index) => {
  const slug = entry.name;
  if (!slug) return;
  // `mr-mime` -> `Mr Mime`, `nidoran-f` -> `Nidoran F`. The dex number is the
  // position in this list, which is what `?limit=` guarantees.
  names[index + 1] = slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
});

/** `ja` -> `en`, for the cards no source gives a dex number for. */
const japanese: Record<string, string> = {};

try {
  const gql = await fetch(GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!gql.ok) throw new Error(String(gql.status));
  const rows = ((await gql.json()) as {
    data?: { pokemonspeciesname?: { name: string; language_id: number; pokemon_species_id: number }[] };
  }).data?.pokemonspeciesname;

  const english = new Map<number, string>();
  const jaNames: { id: number; name: string }[] = [];
  for (const row of rows ?? []) {
    if (row.language_id === 9) english.set(row.pokemon_species_id, row.name);
    else jaNames.push({ id: row.pokemon_species_id, name: row.name });
  }
  for (const { id, name } of jaNames) {
    const en = english.get(id);
    // Longest Japanese spelling wins where two forms map to one species: a
    // caller matches the longest name inside a card's title.
    if (en && (!japanese[name] || japanese[name].length < en.length)) japanese[name] = en;
  }
} catch (error) {
  console.warn(`[species] Japanese names unavailable (${error}) — dex-number labelling only.`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  path.join(OUT_DIR, "pokemon-species.json"),
  JSON.stringify({ crawledAt: new Date().toISOString(), source: URL_, names, japanese })
);

console.log(
  `[species] ${Object.keys(names).length} species by dex (upstream reports ${parsed.count ?? "?"}), ` +
    `${Object.keys(japanese).length} Japanese spellings mapped to English`
);
