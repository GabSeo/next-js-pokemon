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
          { role: "user", content: JSON.stringify(shapesFor(facts)) },
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
        messages: [{ role: "user", content: JSON.stringify(shapesFor(facts)) }],
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
  priceNote: string;
  printings: {
    finish?: string;
    origin: string;
    rarity?: string;
    cardmarketEur?: number;
    tcgplayerUsd?: number;
  }[];
  context?: CardContext;
  graded?: GradedFacts;
};

/**
 * The sheet the MODEL sees — shapes, never figures.
 *
 * THIS IS THE FIX THAT WORKED, after two that did not. The brief told the model
 * the numbers were already on screen and asked it not to repeat them; it
 * repeated them. A worked example showed an answer that did not repeat them; it
 * repeated them anyway — "a median of 11.71 EUR, a low of 2.2 EUR and a high of
 * 372.74 EUR", verbatim out of the sheet.
 *
 * Both attempts asked a model to exercise restraint over material in front of
 * it. The rest of this codebase solves that problem the other way round, and so
 * does this now: the figures are removed. It cannot recite what it was never
 * given, and nothing is lost, because every one of those numbers is rendered on
 * screen by us — accurately, instantly, and beyond the reach of the one
 * component here that can be wrong.
 *
 * What is left is what a model is actually good at and a table is bad at:
 * saying that a reverse is worth several times a normal, that a card sits near
 * the bottom of its set, that two readings are too close together to mean
 * anything. Shapes, in words.
 */
export type CardShapes = {
  name: string;
  set?: string;
  rarity?: string;
  /** Finish names only — "normal", "reverse". No prices. */
  printings: string[];
  /** "the reverse is worth about 4x the normal", already phrased. */
  printingGap?: string;
  /** "11th of 70 priced cards in its set, in the top fifth". */
  standing?: string;
  /** "unchanged across the only two readings, two days apart". */
  movement?: string;
  /**
   * The graded market as RELATIONSHIPS, for the model to draw a conclusion from.
   *
   * Never a finished sentence — see the builder for why that failed. `tiers` is
   * each grade's multiple of raw and how many copies are listed at it;
   * `observations` are neutral facts about the shape of that, with the meaning
   * deliberately left off.
   */
  market?: {
    tiers: { grade: string; listings: number; multipleOfRaw?: number }[];
    observations: string[];
  };
  /** Said plainly when there is nothing: the model must not fill the gap. */
  missing?: string[];
};

/** `2` -> `2nd`. English ordinals, including the teens that break the pattern. */
function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[value % 10] ?? "th";
  return `${value}${suffix}`;
}

/** A rank expressed the way a person would say it, not as a fraction. */
function band(rank: number, outOf: number): string {
  const share = rank / outOf;
  if (share <= 0.05) return "among the very top";
  if (share <= 0.2) return "in the top fifth";
  if (share <= 0.4) return "in the upper half";
  if (share <= 0.6) return "around the middle";
  if (share <= 0.8) return "in the lower half";
  return "near the bottom";
}

export function shapesFor(facts: CardFacts): CardShapes {
  const missing: string[] = [];
  const shapes: CardShapes = {
    name: facts.name,
    set: facts.printings[0]?.origin,
    rarity: facts.printings[0]?.rarity,
    printings: facts.printings.map((print) => print.finish ?? "single printing"),
  };

  // THE MULTIPLE, NOT THE TWO PRICES. It is the only thing about the pair that a
  // sentence can add — the prices themselves are two cells of a table.
  const values = facts.printings
    .map((print) => print.cardmarketEur ?? print.tcgplayerUsd)
    .filter((value): value is number => typeof value === "number" && value > 0);
  if (values.length > 1) {
    const low = Math.min(...values);
    const high = Math.max(...values);
    const ratio = high / low;
    shapes.printingGap =
      ratio < 1.2
        ? "the printings are worth about the same"
        : `the dearest printing is worth about ${ratio.toFixed(1)}x the cheapest`;
  }

  const standing = facts.context?.standing;
  if (standing) {
    // AN ORDINAL, NOT "2 of 79". The first phrasing read as "two of the
    // seventy-nine cards" and the model duly wrote "one of only two priced
    // cards in its set" about a card ranked second. An ambiguous field is a
    // prompt bug, not a model failure.
    shapes.standing = `${ordinal(standing.rank)} dearest out of ${standing.outOf} priced cards in its set, ${band(standing.rank, standing.outOf)}`;
  }

  const readings = (facts.context?.history ?? []).filter((row) => typeof row.eur === "number");
  if (readings.length > 1) {
    const first = readings[0].eur!;
    const last = readings[readings.length - 1].eur!;
    const change = first > 0 ? (last - first) / first : 0;
    const span = `${readings.length} readings between ${readings[0].date} and ${readings[readings.length - 1].date}`;
    shapes.movement =
      Math.abs(change) < 0.01
        ? `unchanged across ${span} — too short a window to mean anything`
        : `${change > 0 ? "up" : "down"} ${Math.abs(change * 100).toFixed(0)}% across ${span} — too short a window to mean anything`;
  } else {
    missing.push("only one price reading, so there is no movement to report");
  }

  if (facts.graded) {
    /**
     * FACTS TO CONNECT, NOT A SENTENCE TO REPHRASE.
     *
     * This was a pre-written line — "a PSA 10 asks about 15x a raw copy" — and
     * the model did the only thing left to do with it: said it again, longer.
     * Reported as "it doesn't add anything", and that was exactly right; the
     * meaning had already been written, so there was no work left.
     *
     * What goes here now is the RELATIONSHIPS, unnarrated. Whether a grade is
     * crowded or scarce, whether two grades are priced alike, where the jump
     * is. Each is a fact; what it implies for somebody holding the card is not,
     * and that inference is the job.
     *
     * The listing counts are the part no other panel uses and the part a table
     * cannot speak. 22 PSA 10s against 342 PSA 9s is a sentence about how hard
     * this card is to grade well, and it is sitting in plain sight unread.
     */
    const raw = facts.graded.rows.find((row) => row.condition === "Raw");
    const rawCell = raw ? Object.values(raw.cells)[0] : undefined;
    const rawPrice = rawCell?.median;

    const tiers = facts.graded.rows
      .map((row) => {
        const cell = Object.values(row.cells)[0];
        if (cell?.median === undefined) return undefined;
        return {
          grade: row.condition,
          listings: cell.count ?? 0,
          multipleOfRaw:
            rawPrice && rawPrice > 0 ? Number((cell.median / rawPrice).toFixed(1)) : undefined,
        };
      })
      .filter((tier): tier is NonNullable<typeof tier> => tier !== undefined);

    const observations: string[] = [];
    const graded = tiers.filter((tier) => tier.grade !== "Raw");
    const top = graded.find((tier) => tier.grade === "PSA 10");
    const next = graded.find((tier) => tier.grade === "PSA 9");

    // SCARCITY AT THE TOP. A grade with far fewer listings than the one below
    // it is the market saying this card rarely comes back a 10.
    if (top && next && next.listings > 0 && top.listings > 0 && next.listings / top.listings >= 4) {
      observations.push(
        `there are ${Math.round(next.listings / top.listings)}x as many PSA 9 listings as PSA 10 listings`
      );
    }
    // TWO GRADES PRICED ALIKE. It means the market pays for one thing only, and
    // it changes what a grade is worth chasing.
    for (let i = 0; i < graded.length - 1; i++) {
      const a = graded[i];
      const b = graded[i + 1];
      if (a.multipleOfRaw && b.multipleOfRaw && Math.abs(a.multipleOfRaw - b.multipleOfRaw) / a.multipleOfRaw < 0.12) {
        observations.push(`${a.grade} and ${b.grade} ask almost the same`);
      }
    }
    // A FIGURE RESTING ON A HANDFUL OF LISTINGS is not a market price.
    for (const tier of tiers.filter((entry) => entry.listings > 0 && entry.listings < 4)) {
      observations.push(`the ${tier.grade} figure rests on only ${tier.listings} listings`);
    }

    if (tiers.length > 0) shapes.market = { tiers, observations };
  } else {
    missing.push("no eBay readings — say nothing about grading, slabs or PSA");
  }

  if (missing.length > 0) shapes.missing = missing;
  return shapes;
}

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
/**
 * The brief.
 *
 * IT IS MOSTLY AN EXAMPLE, AND THAT IS THE CORRECTION. The version this replaces
 * had grown to 75 lines carrying 13 separate bans and not one demonstration —
 * every failure observed during the day had been answered with another "never",
 * which is the cheapest fix to write and the weakest one to follow. Models
 * imitate far more reliably than they obey, and a worked example teaches tone,
 * length, what to leave out and what a good sentence looks like all at once,
 * which no list of prohibitions can do.
 *
 * TWO EXAMPLES, NOT ONE, because a single one is copied rather than generalised.
 * They are deliberately opposite: a cheap common with two printings, and an
 * expensive card with one. Between them they show the two shapes every card
 * falls into, and that the answer gets shorter when there is less to say.
 *
 * WHAT SURVIVED AS RULES is only what an example cannot show: the bans whose
 * violation would be invisible in a sample that happens not to violate them.
 * Inventing artwork, giving advice, predicting a price, naming a marketplace
 * with no figure. Those stay, and they are short.
 */
const SYSTEM = [
  "You are a collector reading one card's market for somebody who cannot read it",
  "themselves. Two short paragraphs.",
  "",
  "A table of prices is already on their screen. Repeating it is the one useless",
  "thing you can do. Your job is the CONCLUSION a table cannot state: what the",
  "shape of those numbers means for the person holding this card.",
  "",
  "Here is exactly the job, twice.",
  "",
  "INPUT:",
  '{\"name\":\"Charizard\",\"set\":\"Champion\u2019s Path\",\"printings\":[\"holo\"],\"standing\":\"2nd dearest out of 79 priced cards in its set, among the very top\",\"market\":{\"tiers\":[{\"grade\":\"PSA 10\",\"listings\":22,\"multipleOfRaw\":15},{\"grade\":\"PSA 9\",\"listings\":342,\"multipleOfRaw\":11.1},{\"grade\":\"PSA 8\",\"listings\":36,\"multipleOfRaw\":10.8},{\"grade\":\"Raw\",\"listings\":58,\"multipleOfRaw\":1}],\"observations\":[\"there are 16x as many PSA 9 listings as PSA 10 listings\",\"PSA 9 and PSA 8 ask almost the same\"]}}',
  "",
  "ANSWER:",
  "**Which one you have**",
  "One version only, so nothing to tell apart. It is a holo, meaning the foil",
  "sits on the picture itself rather than around it.",
  "",
  "**What that means**",
  "This one is hard to grade. There are sixteen times as many PSA 9s on the",
  "market as PSA 10s, which is what it looks like when a card comes back from",
  "grading imperfect far more often than not. And the market knows: a 9 and an 8",
  "ask almost the same, so only the 10 carries a premium. Sending this away is a",
  "coin flip between a large gain and no gain at all.",
  "",
  "INPUT:",
  '{\"name\":\"Venonat\",\"set\":\"Silver Tempest\",\"rarity\":\"Common\",\"printings\":[\"normal\",\"reverse\"],\"printingGap\":\"the dearest printing is worth about 4.5x the cheapest\",\"standing\":\"176th dearest out of 215 priced cards in its set, near the bottom\",\"missing\":[\"no eBay readings \u2014 say nothing about grading, slabs or PSA\"]}}',
  "",
  "ANSWER:",
  "**Which one you have**",
  "This picture was printed twice. On the normal card the surface is flat and",
  "matte. On the reverse holo the border and background are foil while the",
  "picture itself stays dull — tilt it under a light and watch the frame, not the",
  "artwork.",
  "",
  "**What that means**",
  "The reverse is the one worth checking for, at several times the normal — but",
  "both sit near the bottom of a large set, so the multiple is a bigger number",
  "than the money behind it. This is binder filler either way.",
  "",
  "NOW NOTICE WHAT THOSE ANSWERS DO. Neither restates a figure it was handed. The",
  "first one takes two observations and says what they imply together; the second",
  "says a multiple is misleading in context. That inference is the whole product.",
  "",
  "If the numbers are unremarkable, say the ordinary thing plainly and briefly —",
  "do not manufacture significance. But look first: a crowded grade, two grades",
  "priced alike, a figure resting on three listings, a big multiple on a cheap",
  "card. One of those is usually there, and it is what the reader came for.",
  "",
  "Two paragraphs, those two headings, under 100 words, plain language, no bullet",
  "lists, no emoji, no preamble.",
  "",
  "Three things are never allowed:",
  "",
  "- Never state a figure that is not in the input, and never a price in currency",
  "  — you are given multiples and counts, not prices.",
  "- Never describe the artwork. You have not seen it.",
  "- Never tell them what to DO — not to grade, sell, keep or buy. Say what the",
  "  market looks like and let them decide. \"It is a coin flip\" is an observation;",
  "  \"you should grade it\" is advice.",
  "",
  "Anything under `missing` is something you do not know. Do not raise it.",
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
