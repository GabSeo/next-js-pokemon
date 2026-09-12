#!/usr/bin/env -S UNUSED=1 npx tsx
/**
 * List the model ids Groq will actually accept, from Groq.
 *
 * WHY THIS IS A SCRIPT AND NOT A NOTE IN A README. Hosted model catalogues turn
 * over fast: an earlier provider's default was retired mid-session, and Groq's
 * Llama models were gone from the console by the time the provider was written.
 * A name in a document is wrong the week after it is written; the endpoint is
 * right by definition.
 *
 * THE DISPLAY NAME IS NOT THE ID. The console shows "GPT OSS 20B"; the API
 * wants something like `openai/gpt-oss-20b`. Guessing the mapping is how a
 * working key produces a 404 that reads like a broken integration.
 *
 * Costs nothing — a GET against the model list, no generation, no quota.
 *
 *   npx tsx scripts/groq-models.mts
 *
 * Then put the id you want in .env.local as GROQ_MODEL, or leave it and take
 * the default in lib/card-explain.ts.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && match[2]) process.env[match[1]] ??= match[2];
}

const key = process.env.GROQ_API_KEY;
if (!key) {
  console.error("GROQ_API_KEY is not set in .env.local — get one at console.groq.com");
  process.exit(1);
}

const response = await fetch("https://api.groq.com/openai/v1/models", {
  headers: { authorization: `Bearer ${key}` },
});

if (!response.ok) {
  console.error(`[groq] HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}

type Model = { id: string; owned_by?: string; context_window?: number; active?: boolean };
const { data = [] } = (await response.json()) as { data?: Model[] };

// Speech and moderation models cannot answer a chat completion, so listing them
// beside the ones that can is an invitation to pick a broken id.
const AUDIO = /whisper|tts|orpheus|playai|speech/i;
const text = data.filter((m) => !AUDIO.test(m.id)).sort((a, b) => a.id.localeCompare(b.id));

console.log(`[groq] ${text.length} text models available:\n`);
for (const model of text) {
  const context = model.context_window ? `${Math.round(model.context_window / 1000)}k ctx` : "";
  console.log(`  ${model.id.padEnd(42)} ${(model.owned_by ?? "").padEnd(14)} ${context}`);
}
console.log("\n[groq] Put one in .env.local as GROQ_MODEL to override the default.");
