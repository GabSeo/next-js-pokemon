import { ApiBudgetExceededError } from "@/lib/api-budget";
import { explainCard, factsFor, ExplainNotConfiguredError } from "@/lib/card-explain";
import { getCardView } from "@/lib/card-view";

/**
 * Turn one identified card into a short explanation a beginner can act on.
 *
 * IT TAKES AN ID, NEVER A PHOTOGRAPH OR A QUESTION. The scan has already
 * decided which card this is — by artwork on the device, or by the printed
 * number through Vision — and that decision is the whole reason this can be
 * grounded. An endpoint that took free text would be a chatbot about Pokémon,
 * which is the thing being replaced rather than the thing being built.
 *
 * SO THE FACTS ARE ASSEMBLED HERE, on the server, from `getCardView` — the same
 * function the card page renders from. The client cannot choose or add to them.
 * A client that could would be a way to put words in the model's mouth and get
 * them back wearing this site's voice.
 *
 * METERED BUT FREE. The default provider is Groq's free tier, so this spends
 * an allowance rather than money — and an allowance is still a ceiling, so it is
 * listed in scripts/check-free-tier.mts as a decision rather than an accident
 * and budgeted in lib/api-budget.ts at 40 a day.
 *
 * ON DEMAND, NOT AUTOMATIC. The scan does not call this when it identifies a
 * card; a person asks for it. A live view that explained every settled match
 * would bill for every card swept past the lens.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: { code?: unknown; tcg?: unknown };
  try {
    payload = (await request.json()) as { code?: unknown; tcg?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const code = typeof payload.code === "string" ? payload.code : "";
  const tcg: "pokemon" | "onepiece" = payload.tcg === "onepiece" ? "onepiece" : "pokemon";
  if (!code) return Response.json({ error: "Expected a card code." }, { status: 400 });

  // THE CATALOGUE DECIDES WHETHER THIS CARD EXISTS, before anything is spent.
  // A code that resolves to nothing is a 404 rather than a model asked to
  // explain a card nobody has.
  const card = await getCardView(tcg, code);
  if (!card) return Response.json({ error: "No such card." }, { status: 404 });

  const facts = factsFor(card);

  try {
    const text = await explainCard(facts);
    // `facts` travels back with the answer so the page can show what the model
    // was given. An explanation whose evidence is inspectable is a different
    // kind of claim from one that is not, and this is the first feature here
    // that a reader has any reason to distrust.
    return Response.json({ text, facts });
  } catch (error) {
    if (error instanceof ExplainNotConfiguredError) {
      return Response.json({ error: "The explainer is not configured on this deployment." }, { status: 501 });
    }
    if (error instanceof ApiBudgetExceededError) {
      return Response.json({ error: "The explainer has spent its budget for now." }, { status: 429 });
    }
    const message = error instanceof Error ? error.message : "The explainer failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
