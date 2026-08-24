import { cardRefs } from "@/data/card-refs";
import { getCardBySlug } from "@/lib/cards";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/site";
import type { Franchise } from "@/lib/types";

/**
 * EntityMap v1.0 (entitymap.org, stable — co-edited by Dixon Jones and Fred
 * Laurent, CC BY 4.0). Schema shape confirmed against a live implementation
 * at suganthan.com/entitymap.json, not guessed from the spec prose alone.
 *
 * "core" profile, "self-declared" verification — the same tier Suganthan's
 * own site uses. No third-party attestation implied.
 */
const SCHEMA_VERSION = "1.0";
const SCHEMA_URI = "https://entitymap.org/spec/v1.0";

type Relation = { predicate: string; targetId: string; targetName: string };
type Chunk = {
  chunkId: string;
  text: string;
  sourceUrl: string;
  pageTitle: string;
  publisher: string;
  retrieved: string;
  relevanceScore: number;
  contentType: "definition" | "evidence";
};
type Entity = {
  entityId: string;
  "@type": "Organization" | "Concept";
  name: string;
  description: string;
  sameAs?: string;
  audienceType: string;
  relations?: Relation[];
  hasChunks?: Chunk[];
};

/**
 * Franchise-level entities. sameAs are real, verified Wikidata QIDs — not
 * guessed. urls fetched and confirmed against Wikidata's search API before
 * writing this.
 */
const FRANCHISE_ENTITIES: Record<
  Franchise,
  { entityId: string; name: string; description: string; sameAs: string }
> = {
  pokemon: {
    entityId: "e_pokemon",
    name: "Pokémon",
    description:
      "Japanese media franchise centered on collectible creatures, encompassing video games, an anime series, and the Pokémon Trading Card Game.",
    sameAs: "https://www.wikidata.org/wiki/Q864",
  },
  "one-piece": {
    entityId: "e_one-piece",
    name: "One Piece",
    description:
      "Japanese media franchise built around Eiichiro Oda's manga, encompassing an anime series and the One Piece Card Game.",
    sameAs: "https://www.wikidata.org/wiki/Q673",
  },
};

/**
 * Character entities — the actual disambiguation value of EntityMap for a
 * card site: a card is already an unambiguous SKU, but the character
 * printed on it is a real-world concept worth unifying across cards. Verified
 * Wikidata QIDs, same as the franchises above. Keyed by CardRef.character.
 */
const CHARACTER_ENTITIES: Record<string, { entityId: string; description: string; sameAs: string }> = {
  Gengar: {
    entityId: "e_gengar",
    description: "A Ghost/Poison-type Pokémon species.",
    sameAs: "https://www.wikidata.org/wiki/Q2250743",
  },
  Lugia: {
    entityId: "e_lugia",
    description: "A Psychic/Flying-type Legendary Pokémon species.",
    sameAs: "https://www.wikidata.org/wiki/Q1207792",
  },
  Typhlosion: {
    entityId: "e_typhlosion",
    description: "A Fire-type Pokémon species, the final evolution of Cyndaquil.",
    sameAs: "https://www.wikidata.org/wiki/Q2295649",
  },
  "Roronoa Zoro": {
    entityId: "e_roronoa-zoro",
    description: "A fictional character from the One Piece manga and anime, one of the Straw Hat Pirates.",
    sameAs: "https://www.wikidata.org/wiki/Q858432",
  },
  "Monkey D. Luffy": {
    entityId: "e_monkey-d-luffy",
    description: "A fictional character from the One Piece manga and anime, captain of the Straw Hat Pirates.",
    sameAs: "https://www.wikidata.org/wiki/Q477948",
  },
};

function isoDate(dateOnly: string): string {
  return `${dateOnly}T00:00:00Z`;
}

export async function entityMapDocument() {
  const generated = new Date().toISOString();

  const cardTraceEntity: Entity = {
    entityId: "e_cardtrace",
    "@type": "Organization",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    sameAs: absoluteUrl("/about"),
    audienceType: "general",
    relations: [
      { predicate: "COVERS", targetId: "e_pokemon", targetName: "Pokémon" },
      { predicate: "COVERS", targetId: "e_one-piece", targetName: "One Piece" },
    ],
    hasChunks: [
      {
        chunkId: "c_cardtrace-about",
        text: SITE_DESCRIPTION,
        sourceUrl: absoluteUrl("/about"),
        pageTitle: `About ${SITE_NAME}`,
        publisher: SITE_NAME,
        retrieved: generated,
        relevanceScore: 0.95,
        contentType: "definition",
      },
    ],
  };

  const franchiseEntities: Entity[] = (Object.keys(FRANCHISE_ENTITIES) as Franchise[]).map((franchise) => {
    const f = FRANCHISE_ENTITIES[franchise];
    return {
      entityId: f.entityId,
      "@type": "Concept",
      name: f.name,
      description: f.description,
      sameAs: f.sameAs,
      audienceType: "general",
      relations: [{ predicate: "TRACKED_BY", targetId: "e_cardtrace", targetName: SITE_NAME }],
      hasChunks: [
        {
          chunkId: `c_${franchise}-collection`,
          text: `${SITE_NAME} tracks the current market price and price history for ${f.name} trading cards.`,
          sourceUrl: absoluteUrl(`/collections/${franchise}`),
          pageTitle: `${f.name} collection`,
          publisher: SITE_NAME,
          retrieved: generated,
          relevanceScore: 0.9,
          contentType: "definition",
        },
      ],
    };
  });

  // Group cardRefs by character — this is the concrete unification EntityMap
  // is for: the two Luffy cards below become one entity with two evidence
  // chunks, not two separate, undisambiguated entities.
  const characterNames = [...new Set(cardRefs.map((ref) => ref.character))];
  const characterEntities: Entity[] = [];

  for (const characterName of characterNames) {
    const meta = CHARACTER_ENTITIES[characterName];
    if (!meta) continue; // no unmapped character should exist, but fail open rather than crash the document
    const refs = cardRefs.filter((ref) => ref.character === characterName);
    const franchise = refs[0].franchise;

    const chunks: Chunk[] = [];
    for (const ref of refs) {
      const card = await getCardBySlug(ref.slug);
      if (!card) continue; // matches the site-wide pattern: a resolution failure omits data rather than crashing
      chunks.push({
        chunkId: `c_${ref.slug}`,
        text: card.priceUnavailable
          ? `${card.name} (${card.set}, ${card.number ?? ""}) — market price temporarily unavailable, no price source could be reached.`
          : `The current market price for ${card.name} (${card.set}, ${card.number ?? ""}) is ${card.currency} ${card.currentPrice} as of ${card.asOfDate}.`,
        sourceUrl: absoluteUrl(`/products/${ref.slug}`),
        pageTitle: `${card.name} price`,
        publisher: SITE_NAME,
        retrieved: isoDate(card.asOfDate),
        relevanceScore: 0.95,
        contentType: "evidence",
      });
    }

    characterEntities.push({
      entityId: meta.entityId,
      "@type": "Concept",
      name: characterName,
      description: meta.description,
      sameAs: meta.sameAs,
      audienceType: "general",
      relations: [
        {
          predicate: "PART_OF",
          targetId: FRANCHISE_ENTITIES[franchise].entityId,
          targetName: FRANCHISE_ENTITIES[franchise].name,
        },
      ],
      hasChunks: chunks,
    });
  }

  return {
    version: SCHEMA_VERSION,
    schema: SCHEMA_URI,
    publisher: {
      name: SITE_NAME,
      url: absoluteUrl("/"),
      sameAs: absoluteUrl("/"),
    },
    generated,
    profile: "core",
    verificationStatus: "self-declared",
    entities: [cardTraceEntity, ...franchiseEntities, ...characterEntities],
  };
}
