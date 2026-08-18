import { NextResponse } from "next/server";
import { findCard } from "@/lib/cards";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Body = { cardId?: unknown; email?: unknown };

/**
 * MVP stub: validates the request and confirms subscription, but does not
 * send email or persist anywhere yet. Phase 7 (see PLAN.md) wires this to
 * Resend + Upstash/Supabase so alerts actually fire when a card's price
 * crosses one of its alert bands.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { cardId, email } = body;

  if (typeof cardId !== "string" || !cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const card = await findCard(cardId);
  if (!card) {
    return NextResponse.json({ error: `No card found for cardId "${cardId}"` }, { status: 404 });
  }

  return NextResponse.json({ subscribed: true, cardId: card.id, email });
}
