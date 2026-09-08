import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ArtSignature } from "@/lib/art-rank";

/**
 * Artwork signatures for Pokemon cards, by TCGdex id.
 *
 * WHY THEY EXIST. Until these, the scan could rank One Piece printings by
 * LOOKING at them and could only order Pokemon candidates by the script they
 * are printed in. What is printed on a Pokemon card is `048/082` — a number and
 * a set size, never the set, which is carried by a symbol no OCR reads — so one
 * photographed number names several cards, and "is this text kana" was the only
 * thing separating a Japanese Gengar ex from Team Rocket Porygon.
 *
 * WHAT THEY IDENTIFY: the CARD, never the printing. 0 of 10,110 multi-variant
 * Pokemon cards have a distinct image (docs/free-tier-catalogue.md §1), so a
 * normal and its reverse holo are the same picture. Telling those apart is
 * Vision's job, once, on confirmation.
 *
 * TIER 1: two files, `node:fs` and nothing else.
 */

const DIR = path.join(process.cwd(), "data", "catalog", "pokemon-art");

type StoredSignature = { c: [number, number, number]; h: string };

const loaded = new Map<string, Map<string, ArtSignature>>();

function fromHex(hex: string): number[] {
  const bits: number[] = [];
  for (const character of hex) {
    const value = parseInt(character, 16);
    bits.push((value >> 3) & 1, (value >> 2) & 1, (value >> 1) & 1, value & 1);
  }
  return bits;
}

function load(language: string): Map<string, ArtSignature> {
  const cached = loaded.get(language);
  if (cached) return cached;

  const map = new Map<string, ArtSignature>();
  const file = path.join(DIR, `${language}.json`);
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { signatures?: Record<string, StoredSignature> };
      for (const [id, stored] of Object.entries(parsed.signatures ?? {})) {
        map.set(id, { chroma: stored.c, bits: fromHex(stored.h) });
      }
    }
  } catch {
    // A corrupt or absent file behaves as an empty one: the scan falls back to
    // the ordering it used before signatures existed.
  }

  loaded.set(language, map);
  return map;
}

/**
 * The signature for a card view's code — `swsh12-186`, or `ja~PCG1-048`.
 *
 * The qualified form is what a CardView carries, so the prefix is stripped here
 * rather than at every call site.
 */
export function pokemonSignature(code: string): ArtSignature | undefined {
  if (code.startsWith("ja~")) return load("ja").get(code.slice(3));
  return load("en").get(code);
}

export function pokemonSignatureCount(): number {
  return load("en").size + load("ja").size;
}
