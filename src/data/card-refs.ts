import type { Franchise } from "@/lib/types";

type CodeLookup = { by: "code"; code: string };
type NameSetLookup = { by: "nameSet"; name: string; setName: string; number: string };

export type CardRef = {
  franchise: Franchise;
  tcg: "pokemon" | "one-piece";
  slug: string;
  displayName: string;
  /** The real-world character this card depicts — the EntityMap entity it's evidence for. Two cards can share a character (see the two Luffy cards below); that's the point, not a duplicate. */
  character: string;
  lookup: CodeLookup | NameSetLookup;
};

/**
 * The 6 tracked cards. Slugs are precomputed here (not derived from a live
 * API call) so generateStaticParams never depends on network access at
 * build time — only rendering the page content does.
 */
export const cardRefs: CardRef[] = [
  {
    franchise: "pokemon",
    tcg: "pokemon",
    slug: "gengar-vmax-271",
    displayName: "Gengar VMAX",
    character: "Gengar",
    lookup: { by: "nameSet", name: "Gengar VMAX", setName: "Fusion Strike", number: "271" },
  },
  {
    franchise: "pokemon",
    tcg: "pokemon",
    slug: "lugia-v-186",
    displayName: "Lugia V",
    character: "Lugia",
    lookup: { by: "nameSet", name: "Lugia V", setName: "Silver Tempest", number: "186" },
  },
  {
    franchise: "pokemon",
    tcg: "pokemon",
    slug: "ethans-typhlosion-190",
    displayName: "Ethan's Typhlosion",
    character: "Typhlosion",
    lookup: { by: "nameSet", name: "Ethan's Typhlosion", setName: "Destined Rivals", number: "190" },
  },
  {
    franchise: "one-piece",
    tcg: "one-piece",
    slug: "roronoa-zoro-op07-113",
    displayName: "Roronoa Zoro",
    character: "Roronoa Zoro",
    lookup: { by: "code", code: "OP07-113" },
  },
  {
    franchise: "one-piece",
    tcg: "one-piece",
    slug: "monkey-d-luffy-st01-001",
    displayName: "Monkey.D.Luffy",
    character: "Monkey D. Luffy",
    lookup: { by: "code", code: "ST01-001" },
  },
  {
    franchise: "one-piece",
    tcg: "one-piece",
    slug: "monkey-d-luffy-op05-119",
    displayName: "Monkey.D.Luffy",
    character: "Monkey D. Luffy",
    lookup: { by: "code", code: "OP05-119" },
  },
];
