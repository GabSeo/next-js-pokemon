import { createHash } from "node:crypto";

import { chargeApiBudget } from "@/lib/api-budget";
import { contextFor, type CardContext } from "@/lib/card-context";
import type { GradedFacts } from "@/lib/card-graded";
import type { CardView } from "@/lib/card-view";

/**
 * Explain a scanned card to somebody who has never collected one.
 *
 * THE FIRST GENERATIVE THING IN THIS CODEBASE, and it is deliberately the
 * narrowest possible one: it is handed a FACT SHEET built from our own files
 * and asked to put it in plain language. It is not asked what the card is, what
 * it is worth, or whether it is rare. Those are answered before it is called.
 *
 * WHY THIS IS NOT RAG, even though it looks like it. Retrieval-augmented
 * generation retrieves PROSE that resembles a question and asks a model to sort
 * out what is relevant — which is where its hallucinations come from, because
 * the model is guessing which passage applies. Here the retrieval is an
 * identity: the scan resolves a photograph to `swsh12.5gg-GG30`, and a card id
 * joins to exactly one row of prices and one list of printings. There is no
 * relevance to judge and nothing to mix up.
 *
 * SO THE GROUNDING IS STRUCTURAL, NOT A POLITE INSTRUCTION. The model never
 * sees the catalogue, the internet, or a search result. It sees the JSON below
 * and nothing else, and every figure it can print is a figure we measured. A
 * model that invents a price here would have to invent it from an empty field
 * rather than from a plausible-looking neighbour.
 *
 * IT STAYS FREE, which took a second pass. The first version reached for a paid
 * API and would have been the only thing in this project that bills money —
 * every other path is free by construction: TCGdex is keyless, the matcher runs
 * on the visitor's device, the catalogue is on disk. Groq's free tier keeps
 * the rule intact. It is still METERED, so it is budgeted in lib/api-budget.ts
 * like Vision is and scripts/check-free-tier.mts counts any route reaching it —
 * a free allowance is a ceiling to respect, not an absence of one.
 *
 * NOT IN THE LIVE LOOP. The camera reads a frame every 70 ms; a model answers in
 * one to three seconds. The explanation belongs AFTER an identification, on
 * demand, which is also what keeps a live scan from billing thirty times a
 * second.
 */

/**
 * TWO PROVIDERS, FREE FIRST.
 *
 * This project's rule is that everything is free and legal, and this feature was
 * the first thing to break it. Groq's free tier restores it, serving open-weight
 * models at no cost under a published limit — an offer rather than a loophole.
 *
 * GEMINI WAS TRIED AND DROPPED, and the reason is worth keeping because it is
 * the kind of thing only measurement tells you. Its free tier on this account
 * allowed TWENTY requests a day — not the 250 its public pages describe — which
 * is a personal tool rather than something a visitor can be offered. It also
 * answered in 10 to 12 seconds against Groq's 1 to 2, because it thinks before
 * it writes and this task has nothing to think about.
 *
 * ANTHROPIC STAYS AS THE PAID ESCAPE HATCH. The prompt and the fact sheet are
 * identical and only the HTTP shape differs, so a second provider is twenty
 * lines — and that is what makes a quota change, a price change or a
 * disappointing paragraph a key swap rather than a rewrite. That shape has
 * already paid for itself twice in one afternoon: once when a model name was
 * retired mid-test, once when a free tier turned out to be twenty a day.
 */
type Provider = {
  name: string;
  /** The budget bucket in lib/api-budget.ts. Separate, because the limits are unrelated. */
  bucket: string;
  request: (key: string, facts: CardFacts) => { url: string; init: RequestInit };
  read: (payload: unknown) => string;
};

/**
 * Groq — open-weight models on somebody else's hardware, and the free tier this
 * feature runs on.
 *
 * OPEN WEIGHTS, WHICH MATTERS BEYOND THE PRICE. The model is published and can
 * be run elsewhere — a laptop, a rented GPU, a different host — so the feature
 * is not hostage to one company's free tier ending. That is the same property
 * MobileCLIP gives the matcher, and it is why the scan itself costs nothing.
 *
 * AND IT IS FAST, which turned out to be the deciding number rather than the
 * price. Measured on the same two cards and the same sheet: 1.2 and 1.7 seconds
 * against 10 to 12 for the provider this replaced. Ten seconds of "writing it
 * out" is a different feature from one second of it.
 *
 * THE OPENAI MESSAGE SHAPE, which Groq serves deliberately. It costs nothing
 * here and means adding OpenAI itself, or any of the several hosts that copy
 * that shape, is a URL and a model name rather than a third branch.
 */
const GROQ: Provider = {
  name: "groq",
  bucket: "api.groq.com",
  request: (key, facts) => ({
    url: "https://api.groq.com/openai/v1/chat/completions",
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify(facts) },
        ],
      }),
    },
  }),
  read: (payload) => {
    const body = payload as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "";
  },
};

const ANTHROPIC: Provider = {
  name: "anthropic",
  bucket: "api.anthropic.com",
  request: (key, facts) => ({
    url: "https://api.anthropic.com/v1/messages",
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(facts) }],
      }),
    },
  }),
  read: (payload) => {
    const body = payload as { content?: { type: string; text?: string }[] };
    return (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  },
};

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const ANTHROPIC_MODEL = "claude-sonnet-5";

/**
 * The output ceiling, and it is NOT the length control.
 *
 * The prompt asks for under 150 words — about 200 tokens — and that is what
 * keeps the answer short. This is a safety ceiling, and it has to be generous
 * because on a thinking model the same allowance pays for the thinking: at 700
 * the thoughts consumed it and the answers arrived cut off mid-sentence, which
 * reads as a broken feature rather than a long one.
 *
 * So it is set from the THINKING, not from the brief. Measured at thinkingLevel
 * medium with the full sheet: 1,372 tokens of thought against 205 of answer —
 * the thinking is six times the reply. 4,000 leaves room for a card with more
 * printings than any measured here.
 *
 * Every truncation in this feature's history came from sizing this against the
 * visible answer instead of against the invisible thinking, twice.
 */
const MAX_TOKENS = 4000;

/**
 * The free provider first.
 *
 * A DELIBERATE ORDER, not a fallback chain — it does not try one and then the
 * other. Falling through on an error would mean a Groq outage silently starts
 * spending money, which is the one thing a person who set both keys would not
 * expect.
 */
function provider(): { provider: Provider; key: string } | undefined {
  const groq = process.env.GROQ_API_KEY;
  if (groq) return { provider: GROQ, key: groq };
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (anthropic) return { provider: ANTHROPIC, key: anthropic };
  return undefined;
}

export class ExplainNotConfiguredError extends Error {
  constructor() {
    super("no explainer key is set — GROQ_API_KEY or ANTHROPIC_API_KEY");
    this.name = "ExplainNotConfiguredError";
  }
}

/**
 * Exactly what the model is allowed to know.
 *
 * BUILT FROM `CardView`, WHICH IS ALREADY THE TRUTH. It is what the card page
 * renders, so an explanation cannot disagree with the page beside it — a
 * separate extraction would be a second thing to keep in step.
 *
 * PRINTINGS ARE SEPARATE ROWS, because that is the whole difficulty for a
 * beginner: one picture, several objects, and measured across the snapshot a
 * reverse holo trades at a median 3.45x its normal twin. Flattening them to one
 * price is precisely the confusion this feature exists to remove.
 *
 * CURRENCIES ARE LABELLED, never converted. Cardmarket quotes euros and
 * TCGplayer dollars; a conversion would be a number we invented, and the two
 * marketplaces are different markets rather than one price in two units.
 */
export type CardFacts = {
  game: "pokemon" | "onepiece";
  name: string;
  code: string;
  /** Why a price may be missing, in our own words rather than the model's guess. */
  priceNote: string;
  printings: {
    /**
     * The FINISH: "normal", "reverse", "holo" — absent for One Piece.
     *
     * NAMED `finish` AND NOT `label`, which it was for an afternoon. A model
     * reading `label` took it for something printed on the card and told the
     * reader to look for the word "reverse" in the bottom corner. No card
     * carries that. The field name is part of the prompt whether or not it was
     * written as one.
     */
    finish?: string;
    /** The set or pack this printing came from. */
    origin: string;
    rarity?: string;
    cardmarketEur?: number;
    tcgplayerUsd?: number;
  }[];
  /**
   * Everything else we hold — see lib/card-context.ts.
   *
   * THE ROOM WAS ALWAYS THERE. The free tier's binding limit is five REQUESTS a
   * minute against a 250,000-token minute, so the original 445-token sheet used
   * a fifth of one percent of what one call could carry. More context is free;
   * more calls are not.
   */
  context?: CardContext;
  /**
   * Live eBay asking prices — PSA 10 and raw, English and Japanese.
   *
   * THE THIRD KIND OF PRICE and the one a collector reaches for first: the gap
   * between a raw copy and the same card in a slab. Absent for most cards, and
   * the prompt treats an absence like any other.
   */
  graded?: GradedFacts;
};

export function factsFor(card: CardView, graded?: GradedFacts): CardFacts {
  return {
    game: card.tcg,
    name: card.name,
    code: card.code,
    priceNote: card.priceNote,
    printings: card.prints.map((print) => ({
      finish: print.label,
      origin: print.origin,
      rarity: print.rarity,
      cardmarketEur: print.price?.cardmarket?.avg,
      tcgplayerUsd: print.price?.tcgplayer?.market,
    })),
    // Pokemon only: the context is built from the Pokemon catalogue and the
    // Pokemon price archives. A One Piece card gets the printings and nothing
    // more, which the prompt handles as an absent field like any other.
    context: card.tcg === "pokemon" ? contextFor(card.code) : undefined,
    graded,
  };
}

/**
 * The brief.
 *
 * THE FAILURE BEING DESIGNED AGAINST IS LENGTH, not accuracy. Asking a general
 * assistant about a card returns six paragraphs of correct-sounding context that
 * a beginner cannot act on, and somewhere inside it a confidently wrong price.
 * The grounding above removes the second problem; only the instructions can
 * remove the first.
 *
 * SO IT IS SHAPED, NOT JUST SHORT. Three fixed questions, in the order a person
 * holding a card actually asks them — which one is this, what is it worth, is it
 * special — because a beginner does not know what to ask and a wall of prose
 * does not tell them.
 *
 * AND IT IS TOLD TO SAY "I DON'T KNOW" IN A SPECIFIC WAY. A model handed a sheet
 * with no prices will reach for its own training rather than leave a gap, which
 * is exactly the hallucination this design removes everywhere else. Naming the
 * empty field as the thing to report makes the absence the answer.
 */
const SYSTEM = [
  "You explain a trading card to someone holding it, in a few plain sentences.",
  "",
  "You are given a JSON fact sheet about ONE card that somebody has just",
  "photographed. Every FACT must come from that sheet. Never state a number that",
  "is not in it. If the sheet does not contain something, you do not know it.",
  "",
  "You MAY explain what a general collecting term means — what a reverse holo",
  "is, what a holo is, how a set number works. That is vocabulary, not a claim",
  "about this card.",
  "",
  "THE NUMBERS ARE ALREADY ON SCREEN, in a table directly above your text: the",
  "prices, the rank in the set, the spread between printings, the change since",
  "the last reading. The reader can see all of them without you.",
  "",
  "So quote AT MOST ONE figure, and only where a sentence collapses without it.",
  "Never recite the set low, median and high — that is the table's whole job.",
  "Your paragraphs are the part a table cannot say: what the reader is holding,",
  "and what the shape of those numbers means for them.",
  "",
  "Two short paragraphs, each under a bold heading, and nothing else:",
  "",
  "**Which one you have** — if the sheet lists several printings, say this",
  "artwork exists in more than one version and explain what those words mean",
  "physically, so the reader can look at their own card and tell which they are",
  "holding. Give them something to DO: where to look, what they would see —",
  "described from what the WORD means, never from the artwork, which you have",
  "not seen. If there is only one printing, say so in one sentence and move on.",
  "",
  "If the sheet has a `graded` block, it holds LIVE EBAY ASKING PRICES: what a",
  "PSA 10 copy and a raw copy are being listed at today, per language. These are",
  "asks, not sales — say so if you mention them. Where a psa10Multiple exists,",
  "it is how many times the raw price a slabbed copy asks. Report it; never turn",
  "it into a recommendation to grade. Grading costs money and takes months and",
  "neither is in that number.",
  "",
  "**What that means** — the reading of the figures, not the figures. Where this",
  "card sits in its set and whether that is high or low. Whether one printing is",
  "worth notably more than another and which to check first. Whether the price",
  "moved between readings, and if they are days apart, that this is too short to",
  "mean anything. Say it the way you would to a friend who does not know if they",
  "are holding something worth keeping.",
  "",
  "NEVER, whatever the figures say:",
  "",
  "- Advise. Do not say whether to keep, sell, sleeve, grade or hold a card, and",
  "  never call it a good investment or a long-term hold. Report what the sheet",
  "  shows and stop. What somebody does with their own card is theirs.",
  "- Predict. No claim about where a price is going, what a card will be worth,",
  "  or whether it is rising in popularity.",
  "- Describe the artwork. You have not seen it. No borders, no colours, no",
  "  poses, no gold, no frames — the reader is looking at the card and you are",
  "  not.",
  "- Claim anything about the OTHER cards in the set beyond the rank and the",
  "  price range the sheet gives. You do not know what else is in it.",
  "",
  "Rules: no preamble, no summary, no bullet lists, no emoji, no headings other",
  "than the two above. Name a marketplace only when the sheet has its field for",
  "that printing. Write currencies as EUR and USD, never symbols, never",
  "converted. UNDER 90 WORDS IN TOTAL — this sits under a table, not instead of",
  "one. Never state a number that does not appear in the sheet.",
].join("\n");

/**
 * Ask for the explanation.
 *
 * THE BUDGET IS CHARGED BEFORE THE CALL, not after, which over-counts a failed
 * request on purpose — the same rule every other bucket follows. A ledger that
 * charges on success can be walked past by a loop that keeps failing.
 */
/**
 * Explanations already written, keyed by the exact sheet that produced them.
 *
 * WHY CACHING IS NOT AN OPTIMISATION HERE — it is what makes the feature exist.
 * The account's real quota is 20 requests a DAY. Uncached, that is twenty
 * explanations shared across everybody who ever opens the site, and the
 * twenty-first person gets an error. Cached, it is twenty NEW cards a day with
 * unlimited repeats: the same card explained again costs nothing, and a
 * reloaded page, a second look, or two people scanning the same Charizard all
 * come back instantly and free.
 *
 * KEYED ON THE WHOLE FACT SHEET, not the card id. The sheet carries prices, a
 * standing within the set and a price history, so it changes when the snapshot
 * is refreshed — and an explanation quoting last week's figure beside this
 * week's price is exactly the kind of quiet wrongness this codebase spends its
 * effort avoiding. Hashing the sheet means a refresh invalidates precisely the
 * cards whose numbers moved and nothing else.
 *
 * IN MEMORY, WHICH IS HONEST ABOUT WHAT IT IS. A serverless instance loses this
 * when it goes cold, so it is a hit rate rather than a guarantee, and the budget
 * below is still the real protection. Persisting it belongs with a store this
 * project does not have yet; an in-process map costs nothing and already turns
 * the common case — one person, one session, several looks — free.
 */
const written = new Map<string, string>();

/** Bounded so a long-lived instance cannot grow one card at a time without end. */
const CACHE_LIMIT = 500;

function cacheKey(facts: CardFacts): string {
  return createHash("sha1").update(JSON.stringify(facts)).digest("hex");
}

export async function explainCard(facts: CardFacts): Promise<string> {
  const key = cacheKey(facts);
  const held = written.get(key);
  // BEFORE the provider check and before the budget charge — a cached answer
  // costs no quota and works even once the day's allowance is spent.
  if (held) return held;

  const chosen = provider();
  if (!chosen) throw new ExplainNotConfiguredError();

  chargeApiBudget(chosen.provider.bucket);

  const { url, init } = chosen.provider.request(chosen.key, facts);
  const response = await fetch(url, init);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `the explainer (${chosen.provider.name}) returned ${response.status}` +
        (detail ? `: ${detail.slice(0, 200)}` : "")
    );
  }

  const text = chosen.provider.read(await response.json()).trim();
  if (!text) throw new Error("the explainer returned nothing");

  // Oldest out first. A Map iterates in insertion order, so the first key is the
  // least recently WRITTEN — which is the right thing to drop here, because a
  // re-read is served from the cache and never refreshes its position anyway.
  if (written.size >= CACHE_LIMIT) {
    const oldest = written.keys().next().value;
    if (oldest !== undefined) written.delete(oldest);
  }
  written.set(key, text);
  return text;
}
