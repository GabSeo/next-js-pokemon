import { cardRefs } from "@/data/card-refs";
import { getGradedMarketData } from "@/lib/graded-market";
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
  "Monkey D. Luffy": {
    entityId: "e_monkey-d-luffy",
    description: "A fictional character from the One Piece manga and anime, captain of the Straw Hat Pirates.",
    sameAs: "https://www.wikidata.org/wiki/Q477948",
  },
  Shanks: {
    entityId: "e_shanks",
    description: "A fictional character from the One Piece manga and anime, captain of the Red Haired Pirates and one of the Four Emperors.",
    sameAs: "https://www.wikidata.org/wiki/Q2321523",
  },
  'Eustass "Captain" Kid': {
    entityId: "e_eustass-captain-kid",
    description: "A fictional character from the One Piece manga and anime, captain of the Kid Pirates.",
    sameAs: "https://www.wikidata.org/wiki/Q5148704",
  },
  "Marshall D. Teach": {
    entityId: "e_marshall-d-teach",
    description: "A fictional character from the One Piece manga and anime, known as Blackbeard, captain of the Blackbeard Pirates and one of the Four Emperors.",
    sameAs: "https://www.wikidata.org/wiki/Q4991940",
  },
};

/**
 * Currency to at most two decimals, without forcing them on a round number.
 *
 * A median over an even number of listings lands on a half-cent — PSA 10
 * figures came out as "USD 2449.995" and "USD 384.995" — and quoting that in
 * evidence prose implies a precision the underlying market does not have.
 * Rounds rather than truncates, so the figure stays the nearest true cent.
 */
function money(value: number): string {
  return String(Number(value.toFixed(2)));
}

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
    if (!meta) {
      // Fail open rather than crash the document — but say so. Monkey D.
      // Luffy was missing from CHARACTER_ENTITIES for as long as this was
      // silent, which dropped him and both of his cards' evidence chunks
      // while the document still validated and still looked complete.
      console.warn(
        `[entitymap] no CHARACTER_ENTITIES entry for "${characterName}" — this character and its cards are ` +
          `absent from the entity map. Add it (with a verified Wikidata QID) in src/lib/entitymap.ts.`
      );
      continue;
    }
    const refs = cardRefs.filter((ref) => ref.character === characterName);
    const franchise = refs[0].franchise;

    const chunks: Chunk[] = [];
    for (const ref of refs) {
      const card = await getCardBySlug(ref.slug);
      if (!card) continue; // matches the site-wide pattern: a resolution failure omits data rather than crashing
      // Full print name, not the character name. Both of Monkey D. Luffy's
      // cards rendered as the link text "Monkey D. Luffy price", so the two
      // pieces of evidence on his entity were indistinguishable — the same
      // one-name-for-two-things problem the entity ids exist to prevent.
      // printName is BerryWallet's real print string ("Monkey.D.Luffy (Event
      // Pack Vol. 2)"); Pokémon has none and falls back to the card name,
      // which is already print-specific there ("Lugia V").
      const label = `${card.printName ?? card.name}${card.number ? ` — ${card.number}` : ""}`;

      // Which tier the quoted price belongs to, stated rather than implied.
      // card.currentPrice is the UNGRADED reference from TCGdex/BerryWallet;
      // a reader comparing it to a graded listing without that label is
      // comparing two different markets. The PSA 10 figure comes from the
      // same getGradedMarketData every product page uses — buildCached, so
      // sharing it here costs no additional upstream calls.
      const graded = await getGradedMarketData(card);
      const psa10 = graded?.conditions
        .find((c) => c.condition === "PSA 10")
        ?.languages.find((l) => l.language === "English")?.active;

      // Only a real observation is quoted. `noListings` is a genuine answer
      // and says so; an illustrative tier is omitted entirely rather than
      // presented as evidence — see lib/illustrative.ts on why preview
      // figures never leave the surfaces that label them.
      const psa10Text = !psa10
        ? ""
        : psa10.noListings
          ? " No PSA 10 listings are currently active."
          : psa10.isReal
            ? ` PSA 10: ${psa10.currency} ${money(psa10.medianPrice)} median across ${psa10.count} active eBay listings.`
            : "";

      chunks.push({
        chunkId: `c_${ref.slug}`,
        text: card.priceUnavailable
          ? `${label} (${card.set}). Raw market price temporarily unavailable — no price source could be reached.`
          : `${label} (${card.set}). Raw market price ${card.currency} ${money(card.currentPrice)} as of ${card.asOfDate}.${psa10Text}`,
        sourceUrl: absoluteUrl(`/products/${ref.slug}`),
        pageTitle: label,
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
