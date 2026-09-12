import { chargeApiBudget } from "@/lib/api-budget";
import type { CardFacts } from "@/lib/card-explain";

/**
 * The one question our own data cannot answer: why does this card matter?
 *
 * THE SECOND STAGE, AND IT IS DELIBERATELY NOT "GIVE THE MODEL INTERNET".
 * Retrieval-augmented generation hands a model a pile of prose and asks it to
 * judge what is relevant — which is where its hallucinations come from, because
 * the judgement is a guess. Here the identity is already settled: the scan
 * resolved a photograph to `swsh12.5gg-GG30`, and this stage is told that
 * identification is final. It may look up THAT card. It may not decide the
 * photograph was of something else.
 *
 * So the grounding is unchanged. What moves is the SCOPE of the question.
 *
 * WHAT THIS STAGE MAY NEVER DO, and the first rule is the load-bearing one:
 *
 *   no prices        We have prices, measured, dated and shown on screen. A
 *                    figure scraped from a page is stale, from another market,
 *                    or another printing — and a reader cannot tell which
 *                    number to believe when two disagree. One source of prices,
 *                    and it is ours.
 *   no rarity        Same reason. It is on the sheet.
 *   no identity      It may not suggest this is a different card, a different
 *                    printing, or a fake. That decision was made upstream with
 *                    better evidence than a search result.
 *
 * WHAT IT IS FOR: tournament history, why a set is remembered, whether an
 * artwork is unusual, whether a card has a story. None of that is in any
 * catalogue we hold, none of it is derivable from a price, and all of it is
 * what somebody actually wants to know when they find a card in a drawer.
 *
 * "NOTHING NOTABLE" IS A RESULT. Most cards have no story, and a model that
 * must produce one will invent it. Saying so plainly is the answer for the
 * majority of the catalogue and it has to be made an acceptable one.
 *
 * SEPARATE FROM THE FIRST STAGE ON PURPOSE — separate call, separate budget,
 * separate block on screen, and it arrives later. A reader must always be able
 * to tell which sentences came from our records and which came from the open
 * web, because they are different kinds of claim and only one of them is
 * checkable in the panel below.
 */

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Groq's agentic model — it searches the web itself rather than being handed
 * pages. 250 requests a day, which is the ceiling this stage lives under; the
 * grounded first stage uses a different model and its own budget, so a busy day
 * for one does not starve the other.
 *
 * THE FULL COMPOUND, AND THE MINI WAS TRIED AND REJECTED. That is worth writing
 * down because the mini looked strictly better on every visible measure: five
 * of five cards answered, 1.2 to 1.8 seconds, no rate limits, a source cited
 * every time. The full model had failed two of four — once a 429 on the
 * gpt-oss-120b it routes to internally, once a 413 because it had pulled in more
 * page content than a request may carry.
 *
 * Then the five answers were read side by side. Every one of them said the card
 * was illustrated by Mitsuhiro Arita — Charizard, Venonat, Pikachu, Machamp,
 * Venomoth. It is true of Base Set Charizard and of none of the others; the full
 * model had correctly named Ken Sugimori for Machamp an hour earlier. The mini
 * was not searching. It was pattern-matching a plausible name and attaching a
 * citation to it.
 *
 * A 429 costs a reader one paragraph they never knew was coming. A confident
 * false attribution, sourced, on every card, cannot be told from the truth by
 * the person reading it — and it would be cached. Slow is recoverable;
 * wrong-and-cached is not, which is the rule this codebase has followed since
 * empty prices were frozen into static HTML for a day.
 *
 * So: the model that sometimes fails, over the model that always answers.
 */
const MODEL = process.env.GROQ_WEB_MODEL || "groq/compound";

/** Short: this is a footnote under an answer, not a second answer. */
const MAX_TOKENS = 1200;

const SYSTEM = [
  "You add context about ONE trading card that has already been identified.",
  "",
  "The identification is FINAL and was made from the card itself, not from a",
  "search. Never question it, never suggest the reader has a different card, a",
  "different printing, or a counterfeit. Search for the card you are given and",
  "nothing else.",
  "",
  "START FROM THE ASSUMPTION THAT THERE IS NOTHING TO SAY. Most cards ever",
  "printed have no story, and that is the honest answer for most of them. You",
  "are looking for a reason to break that assumption, not for words to fill.",
  "",
  "Only these count as notable, and only if you actually find them stated:",
  "",
  "- it saw real competitive play, in a named format or event",
  "- a named illustrator, where that name means something to collectors",
  "- a documented misprint, error, recall or production oddity",
  "- a specific story collectors tell about this card, not about its set",
  "",
  "These do NOT count, and writing any of them is a failure:",
  "",
  "- its position in the set, including being the first or last card",
  "- the finish, foil or treatment its set normally uses",
  "- the set being popular, recent, well regarded or nostalgic",
  "- the Pokemon or character itself being popular",
  "- being a full art, alternate art or special subset card, on its own",
  "- anything that would be equally true of fifty other cards in the same set",
  "",
  "NEVER include, whatever you find:",
  "",
  "- Any price, value, estimate or market figure, in any currency. Prices are",
  "  measured elsewhere in this product, dated, and shown on the same screen as",
  "  your text. A figure from a web page is from another date, another market or",
  "  another printing, and two disagreeing numbers on one screen is worse than",
  "  one number alone.",
  "- Any claim about rarity, print run size, or how hard the card is to find.",
  "- Advice. Never say whether to keep, sell, grade, sleeve or hold it.",
  "- A prediction about what it will be worth or how it will perform.",
  "- A description of the artwork as though you had seen it.",
  "",
  "IF NOTHING ON THE LIST ABOVE IS FOUND, reply with exactly this and nothing",
  "else: Nothing particular is recorded about this card.",
  "",
  "That reply is a success, not a shortfall. It is expected to be the answer",
  "most of the time, and a reader is far better served by it than by a",
  "paragraph of general background arranged to sound specific.",
  "",
  "Write two or three sentences, plain language, no headings, no bullet lists,",
  "no emoji, no preamble. UNDER 60 WORDS. End with the source you used, as a",
  "bare domain in parentheses, like (bulbapedia.bulbagarden.net). One source.",
].join("\n");

export class WebContextUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebContextUnavailableError";
  }
}

/**
 * The search terms, built from OUR identifiers rather than from the model's
 * reading of them.
 *
 * This is the whole safety property in one function. The model never chooses
 * what to look for; it is handed a name, a set and a number that came out of
 * the catalogue, so a search cannot drift onto a different card however the
 * results read.
 */
function query(facts: CardFacts): string {
  const origin = facts.printings[0]?.origin;
  const game = facts.game === "onepiece" ? "One Piece card game" : "Pokemon TCG";
  return [facts.name, origin, facts.code, game].filter(Boolean).join(" · ");
}

export async function webContextFor(facts: CardFacts): Promise<string | undefined> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return undefined;

  chargeApiBudget("api.groq.com#compound");

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Card: ${query(facts)}` },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new WebContextUnavailableError(`${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }

  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content?.trim();
  return text || undefined;
}
